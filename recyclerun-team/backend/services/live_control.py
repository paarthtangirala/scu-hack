"""
Live API token provisioning and session policy helpers.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from backend.services.gemini_live import LIVE_PROMPT

logger = logging.getLogger(__name__)

DEFAULT_DIRECT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
DEFAULT_TOKEN_TIMEOUT_SECONDS = 10.0
DEFAULT_TOKEN_EXPIRE_MINUTES = 30
DEFAULT_NEW_SESSION_EXPIRE_MINUTES = 1
DIRECT_LIVE_WS_ENDPOINT = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"
)
AUTH_TOKEN_ENDPOINT = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens"

FRAME_TURN_PROMPT = (
    "Analyze this latest Bin2Bucks camera frame. "
    "Return strict JSON only following the established material schema. "
    "If nothing confidently matches the supported recycling taxonomy, return "
    '{"materials":[],"notes":"no supported recyclables confidently visible"}.'
)


class LiveControlError(Exception):
    def __init__(self, *, code: str, message: str, status: int, errors: list[dict] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.errors = errors or []


class LiveSessionPolicyService:
    @staticmethod
    def _int_env(name: str, default: int, minimum: int) -> int:
        raw = os.getenv(name)
        if raw is None:
            return default
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return default
        return value if value >= minimum else default

    @staticmethod
    def model_name(model: str | None = None) -> str:
        raw = (model or os.getenv("GEMINI_LIVE_MODEL", DEFAULT_DIRECT_MODEL)).strip()
        return raw or DEFAULT_DIRECT_MODEL

    @classmethod
    def session_policy(cls) -> dict[str, Any]:
        return {
            "max_concurrent_candidates": cls._int_env("GEMINI_LIVE_MAX_CONCURRENT_CANDIDATES", 3, 1),
            "remote_send_cooldown_ms": cls._int_env("GEMINI_LIVE_REMOTE_SEND_COOLDOWN_MS", 900, 100),
            "candidate_stable_frames": cls._int_env("GEMINI_LIVE_CANDIDATE_STABLE_FRAMES", 2, 1),
            "candidate_stable_ms": cls._int_env("GEMINI_LIVE_CANDIDATE_STABLE_MS", 1000, 100),
            "recheck_after_low_confidence_ms": cls._int_env("GEMINI_LIVE_RECHECK_LOW_CONFIDENCE_MS", 1500, 100),
            "max_session_seconds": cls._int_env("GEMINI_LIVE_MAX_SESSION_SECONDS", 600, 30),
            "ui_review_timeout_ms": cls._int_env("GEMINI_LIVE_UI_REVIEW_TIMEOUT_MS", 10000, 1000),
        }

    @classmethod
    def candidate_video_policy(cls) -> dict[str, Any]:
        return {
            "max_fps": cls._int_env("GEMINI_LIVE_CANDIDATE_VIDEO_MAX_FPS", 4, 1),
            "max_chunk_count": cls._int_env("GEMINI_LIVE_CANDIDATE_VIDEO_MAX_CHUNK_COUNT", 2, 1),
            "jpeg_quality": cls._int_env("GEMINI_LIVE_CANDIDATE_VIDEO_JPEG_QUALITY", 82, 30),
            "max_dimension_px": cls._int_env("GEMINI_LIVE_CANDIDATE_VIDEO_MAX_DIMENSION_PX", 960, 240),
            "context_frame_on_ambiguity": True,
        }

    @classmethod
    def session_setup(cls, *, model: str | None = None) -> dict[str, Any]:
        resolved_model = cls.model_name(model)
        return {
            "model": f"models/{resolved_model}",
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 600,
                "responseModalities": ["TEXT"],
            },
            "systemInstruction": {
                "role": "user",
                "parts": [{"text": LIVE_PROMPT}],
            },
            "sessionResumption": {},
        }


class LiveTokenService:
    def __init__(self, *, store):
        self._store = store

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    def _expire_time(cls) -> str:
        minutes = LiveSessionPolicyService._int_env(
            "GEMINI_LIVE_TOKEN_EXPIRE_MINUTES",
            DEFAULT_TOKEN_EXPIRE_MINUTES,
            1,
        )
        return (cls._now() + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")

    @classmethod
    def _new_session_expire_time(cls) -> str:
        minutes = LiveSessionPolicyService._int_env(
            "GEMINI_LIVE_TOKEN_NEW_SESSION_EXPIRE_MINUTES",
            DEFAULT_NEW_SESSION_EXPIRE_MINUTES,
            1,
        )
        return (cls._now() + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _timeout_seconds() -> float:
        raw = os.getenv("GEMINI_LIVE_TOKEN_TIMEOUT_SECONDS")
        if raw is None:
            return DEFAULT_TOKEN_TIMEOUT_SECONDS
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return DEFAULT_TOKEN_TIMEOUT_SECONDS
        return value if value >= 1.0 else DEFAULT_TOKEN_TIMEOUT_SECONDS

    @staticmethod
    def _api_key() -> str:
        return os.getenv("GEMINI_API_KEY", "").strip()

    def _request_token(self, *, expire_time: str, new_session_expire_time: str) -> dict[str, Any]:
        api_key = self._api_key()
        if not api_key:
            raise LiveControlError(
                code="live_token_unavailable",
                message="Gemini Live token provisioning is unavailable",
                status=503,
                errors=[{"field": "gemini_api_key", "message": "GEMINI_API_KEY is not configured"}],
            )

        # The current auth token REST endpoint expects the AuthToken fields at the
        # top level of the JSON body instead of a nested CreateAuthTokenRequest wrapper.
        payload = {
            "uses": 1,
            "expireTime": expire_time,
            "newSessionExpireTime": new_session_expire_time,
        }

        try:
            response = requests.post(
                f"{AUTH_TOKEN_ENDPOINT}?key={api_key}",
                json=payload,
                timeout=self._timeout_seconds(),
            )
        except requests.Timeout as exc:
            raise LiveControlError(
                code="live_token_timeout",
                message="Timed out while provisioning Gemini Live token",
                status=504,
                errors=[{"field": "token", "message": "Gemini Live token request timed out"}],
            ) from exc
        except requests.RequestException as exc:
            raise LiveControlError(
                code="live_token_request_failed",
                message="Failed to provision Gemini Live token",
                status=502,
                errors=[{"field": "token", "message": str(exc)}],
            ) from exc

        if response.status_code != 200:
            snippet = " ".join(str(getattr(response, "text", "") or "").split())[:240]
            raise LiveControlError(
                code="live_token_request_failed",
                message="Gemini Live token provisioning returned a non-200 response",
                status=502,
                errors=[{"field": "token", "message": snippet or f"HTTP {response.status_code}"}],
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise LiveControlError(
                code="live_token_parse_failed",
                message="Gemini Live token provisioning returned invalid JSON",
                status=502,
                errors=[{"field": "token", "message": "Invalid JSON from Gemini token service"}],
            ) from exc

        token_name = str(payload.get("name", "")).strip()
        if not token_name:
            raise LiveControlError(
                code="live_token_parse_failed",
                message="Gemini Live token response missing token name",
                status=502,
                errors=[{"field": "token", "message": "Token response missing name"}],
            )
        return payload

    def provision(
        self,
        *,
        model: str | None = None,
        profile_id: str = "",
        device_label: str = "",
        app_version: str = "",
        platform: str = "",
        device_tier: str = "",
        network_type: str = "",
    ) -> dict[str, Any]:
        resolved_model = LiveSessionPolicyService.model_name(model)
        expire_time = self._expire_time()
        new_session_expire_time = self._new_session_expire_time()
        token_payload = self._request_token(
            expire_time=expire_time,
            new_session_expire_time=new_session_expire_time,
        )
        session_id = f"lvs_{uuid.uuid4().hex[:12]}"
        self._store.create_live_vision_session(
            session_id,
            profile_id=profile_id,
            provider="gemini_live",
            transport="direct_websocket",
            model=resolved_model,
            token_expires_at=str(token_payload.get("expireTime") or expire_time),
            new_session_expires_at=str(token_payload.get("newSessionExpireTime") or new_session_expire_time),
            device_label=device_label,
            app_version=app_version,
            platform=platform,
            device_tier=device_tier,
            network_type=network_type,
        )
        logger.info(
            "live_token_provisioned",
            extra={
                "event": "live_token_provisioned",
                "service": "live_control",
                "session_id": session_id,
                "model": resolved_model,
                "platform": platform,
                "device_tier": device_tier,
                "network_type": network_type,
            },
        )
        return {
            "success": True,
            "provider": "gemini_live",
            "token": token_payload["name"],
            "token_expires_at": str(token_payload.get("expireTime") or expire_time),
            "new_session_expires_at": str(token_payload.get("newSessionExpireTime") or new_session_expire_time),
            "ws_endpoint": DIRECT_LIVE_WS_ENDPOINT,
            "model": resolved_model,
            "response_modality": "TEXT",
            "media_resolution": "low",
            "session_policy": LiveSessionPolicyService.session_policy(),
            "transport_version": "native_candidate_stream_v1",
            "supports_session_resumption": True,
            "candidate_video_policy": LiveSessionPolicyService.candidate_video_policy(),
            "fallback_order": ["direct_native_live", "tracking_only", "legacy_http_poll", "manual_entry"],
            "telemetry_session_id": session_id,
            "source_session_id": session_id,
            "legacy_fallback_available": True,
            "setup": LiveSessionPolicyService.session_setup(model=resolved_model),
            "frame_turn_prompt": FRAME_TURN_PROMPT,
        }

