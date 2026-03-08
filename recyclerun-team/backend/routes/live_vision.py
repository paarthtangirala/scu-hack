"""
Gemini live vision session endpoints.
"""
from __future__ import annotations

import logging
import uuid

from flask import Blueprint, jsonify, request

from backend.services.live_control import LiveControlError, LiveSessionPolicyService, LiveTokenService
from backend.services.gemini_live import GeminiLiveError, GeminiLiveService
from backend.services.store import store
from backend.services.validation import (
    validate_live_frame_payload,
    validate_live_session_end_payload,
    validate_live_session_start_payload,
    validate_live_telemetry_batch_payload,
    validate_live_token_payload,
)
from backend.utils.http import error, success

live_vision_bp = Blueprint("live_vision", __name__, url_prefix="/api/live-vision")
live_service = GeminiLiveService()
token_service = LiveTokenService(store=store)
logger = logging.getLogger(__name__)


@live_vision_bp.post("/token")
def create_live_token():
    payload, errors = validate_live_token_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid live token payload", status=400, errors=errors)

    if payload["force_legacy"]:
        session_id = f"lvs_{uuid.uuid4().hex[:12]}"
        store.create_live_vision_session(
            session_id,
            profile_id=payload["profile_id"],
            provider="legacy_http_poll",
            transport="legacy_http_poll",
            model=LiveSessionPolicyService.model_name(payload["model"]),
            device_label=payload["device_label"],
            app_version=payload["app_version"],
            platform=payload["platform"],
            device_tier=payload["device_tier"],
            network_type=payload["network_type"],
        )
        return success(
            {
                "provider": "legacy_http_poll",
                "direct_available": False,
                "token": "",
                "token_expires_at": "",
                "new_session_expires_at": "",
                "ws_endpoint": "",
                "model": LiveSessionPolicyService.model_name(payload["model"]),
                "response_modality": "TEXT",
                "media_resolution": "low",
                "session_policy": LiveSessionPolicyService.session_policy(),
                "transport_version": "native_candidate_stream_v1",
                "supports_session_resumption": False,
                "candidate_video_policy": LiveSessionPolicyService.candidate_video_policy(),
                "fallback_order": ["legacy_http_poll", "manual_entry"],
                "telemetry_session_id": session_id,
                "source_session_id": session_id,
                "legacy_fallback_available": True,
                "setup": LiveSessionPolicyService.session_setup(model=payload["model"]),
                "frame_turn_prompt": "",
                "fallback_reason": "forced_legacy_transport",
            }
        )

    try:
        result = token_service.provision(
            model=payload["model"],
            profile_id=payload["profile_id"],
            device_label=payload["device_label"],
            app_version=payload["app_version"],
            platform=payload["platform"],
            device_tier=payload["device_tier"],
            network_type=payload["network_type"],
        )
        result["direct_available"] = True
        return jsonify(result), 201
    except LiveControlError as exc:
        return error(code=exc.code, message=exc.message, status=exc.status, errors=exc.errors)
    except Exception as exc:  # pragma: no cover - defensive route guard
        logger.exception("live-vision token failed exception_type=%s", exc.__class__.__name__)
        return error(
            code="live_token_failed",
            message="Failed to provision live vision token",
            status=502,
            errors=[{"field": "token", "message": "Internal live token provisioning failure"}],
        )


@live_vision_bp.post("/telemetry/batch")
def ingest_live_telemetry():
    payload, errors = validate_live_telemetry_batch_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid live telemetry payload", status=400, errors=errors)
    inserted = store.record_live_vision_events(payload["telemetry_session_id"], payload["events"])
    return success(
        {
            "telemetry_session_id": payload["telemetry_session_id"],
            "accepted": inserted,
            "count": len(payload["events"]),
        },
        status=202,
    )


@live_vision_bp.post("/session/end")
def end_live_session():
    payload, errors = validate_live_session_end_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid live session end payload", status=400, errors=errors)

    session = store.finish_live_vision_session(
        payload["telemetry_session_id"],
        confirmed_count=payload["confirmed_count"],
        skipped_count=payload["skipped_count"],
        fallback_mode=payload["fallback_mode"],
        error_summary=payload["error_summary"],
    )
    if session is None:
        return error(
            code="live_session_not_found",
            message="Live vision session was not found",
            status=404,
            errors=[{"field": "telemetry_session_id", "message": "Unknown live session"}],
        )
    return success(
        {
            "telemetry_session_id": payload["telemetry_session_id"],
            "source_session_id": payload["source_session_id"],
            "duration_ms": payload["duration_ms"],
            "confirmed_count": payload["confirmed_count"],
            "skipped_count": payload["skipped_count"],
            "fallback_mode": payload["fallback_mode"],
            "session": session,
        }
    )


@live_vision_bp.post("/session/start")
def start_live_session():
    payload, errors = validate_live_session_start_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid live session start payload", status=400, errors=errors)
    try:
        result = live_service.start_session(model=payload["model"], force_demo=payload["force_demo"])
        return jsonify(result), 201
    except GeminiLiveError as exc:
        return error(code=exc.code, message=exc.message, status=exc.status, errors=exc.errors)
    except Exception as exc:  # pragma: no cover - defensive route guard
        logger.exception("live-vision start failed exception_type=%s", exc.__class__.__name__)
        return error(
            code="live_vision_start_failed",
            message="Failed to start live vision session",
            status=502,
            errors=[{"field": "session", "message": "Internal live vision failure"}],
        )


@live_vision_bp.post("/session/<session_id>/frame")
def frame_live_session(session_id: str):
    constraints = live_service.frame_constraints()
    payload, errors = validate_live_frame_payload(
        request.get_json(silent=True),
        max_bytes=constraints["max_frame_bytes"],
        allowed_mime_types=constraints["allowed_mime_types"],
    )
    if errors:
        return error(code="validation_error", message="Invalid live frame payload", status=400, errors=errors)

    try:
        result = live_service.classify_frame(
            session_id=session_id,
            frame_base64=payload["frame_base64"],
            mime_type=payload["mime_type"],
            client_frame_seq=payload["frame_seq"],
        )
        return jsonify(result), 200
    except GeminiLiveError as exc:
        return error(code=exc.code, message=exc.message, status=exc.status, errors=exc.errors)
    except Exception as exc:  # pragma: no cover - defensive route guard
        logger.exception("live-vision frame failed session_id=%s exception_type=%s", session_id, exc.__class__.__name__)
        return error(
            code="live_vision_frame_failed",
            message="Failed to process live frame",
            status=502,
            errors=[{"field": "frame", "message": "Internal live vision failure"}],
        )


@live_vision_bp.post("/session/<session_id>/stop")
def stop_live_session(session_id: str):
    try:
        result = live_service.stop_session(session_id=session_id)
        return jsonify(result), 200
    except GeminiLiveError as exc:
        return error(code=exc.code, message=exc.message, status=exc.status, errors=exc.errors)
    except Exception as exc:  # pragma: no cover - defensive route guard
        logger.exception("live-vision stop failed session_id=%s exception_type=%s", session_id, exc.__class__.__name__)
        return error(
            code="live_vision_stop_failed",
            message="Failed to stop live vision session",
            status=502,
            errors=[{"field": "session", "message": "Internal live vision failure"}],
        )


@live_vision_bp.get("/session/<session_id>/health")
def health_live_session(session_id: str):
    try:
        result = live_service.session_health(session_id=session_id)
        return jsonify(result), 200
    except GeminiLiveError as exc:
        return error(code=exc.code, message=exc.message, status=exc.status, errors=exc.errors)
    except Exception as exc:  # pragma: no cover - defensive route guard
        logger.exception("live-vision health failed session_id=%s exception_type=%s", session_id, exc.__class__.__name__)
        return error(
            code="live_vision_health_failed",
            message="Failed to read live vision session health",
            status=502,
            errors=[{"field": "session", "message": "Internal live vision failure"}],
        )
