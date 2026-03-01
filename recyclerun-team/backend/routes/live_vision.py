"""
Gemini live vision session endpoints.
"""
from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from backend.services.gemini_live import GeminiLiveError, GeminiLiveService
from backend.services.validation import validate_live_frame_payload, validate_live_session_start_payload
from backend.utils.http import error

live_vision_bp = Blueprint("live_vision", __name__, url_prefix="/api/live-vision")
live_service = GeminiLiveService()
logger = logging.getLogger(__name__)


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
