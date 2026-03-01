"""
Gemini Live session gateway for camera preview classification.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from threading import RLock
from typing import Iterable

import requests

from backend.models.material import MATERIAL_RATES, Material

logger = logging.getLogger(__name__)

DEFAULT_LIVE_MODEL = "gemini-2.0-flash"
DEFAULT_TIMEOUT_SECONDS = 12.0
DEFAULT_SESSION_TTL_SECONDS = 600
DEFAULT_MAX_FRAME_BYTES = 1_500_000
DEFAULT_MIN_FRAME_INTERVAL_MS = 1000
DEFAULT_MIN_LBS = 0.1
DEFAULT_MAX_LBS = 500.0
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png"}
UPSTREAM_ERROR_SNIPPET_MAX = 240

FENCED_JSON_PATTERN = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)

LIVE_PROMPT = """You are a recycling material classifier for California.
Return strict JSON only:
{
  "materials": [
    {
      "type": "material_key",
      "lbs": 1.2,
      "confidence": 0.85,
      "raw_confidence": 0.91,
      "provenance": "visible_in_frame"
    }
  ],
  "notes": "short summary"
}
Valid material_key values:
cardboard, aluminum_cans, plastic_pet, plastic_hdpe, glass_bottles,
copper_wire, scrap_aluminum, ewaste_noncrt, ewaste_crt, steel_iron,
newspaper, scrap_metal_mixed
Do not include any keys outside this schema."""

MATERIAL_TYPE_ALIASES = {
    "aluminum": "aluminum_cans",
    "aluminum can": "aluminum_cans",
    "aluminum cans": "aluminum_cans",
    "aluminium can": "aluminum_cans",
    "aluminium cans": "aluminum_cans",
    "cardboard box": "cardboard",
    "cardboard boxes": "cardboard",
    "pet plastic": "plastic_pet",
    "pet bottle": "plastic_pet",
    "pet bottles": "plastic_pet",
    "hdpe plastic": "plastic_hdpe",
    "hdpe bottle": "plastic_hdpe",
    "hdpe bottles": "plastic_hdpe",
    "glass bottle": "glass_bottles",
    "glass bottles": "glass_bottles",
    "copper": "copper_wire",
    "scrap aluminum": "scrap_aluminum",
    "scrap metal": "scrap_metal_mixed",
    "mixed scrap metal": "scrap_metal_mixed",
    "steel": "steel_iron",
    "iron": "steel_iron",
    "newspaper paper": "newspaper",
    "e waste crt": "ewaste_crt",
    "e waste noncrt": "ewaste_noncrt",
    "ewaste": "ewaste_noncrt",
}


class GeminiLiveError(Exception):
    def __init__(self, *, code: str, message: str, status: int, errors: list[dict] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.errors = errors or []


@dataclass
class GeminiLiveSession:
    session_id: str
    created_at: float
    last_activity_at: float
    model: str
    timeout_seconds: float
    state: str = "starting"
    frame_seq: int = 0
    rolling_prediction_cache: list[str] = field(default_factory=list)
    source_mode: str = "live"
    fallback_reason: str = ""
    last_frame_at: float = 0.0


class GeminiLiveService:
    def __init__(self):
        self._lock = RLock()
        self._sessions: dict[str, GeminiLiveSession] = {}

    def start_session(self, *, model: str | None = None, force_demo: bool = False) -> dict:
        now = time.time()
        with self._lock:
            self._cleanup_expired_sessions(now)

            session_id = f"gls_{uuid.uuid4().hex[:12]}"
            resolved_model = (model or os.getenv("GEMINI_LIVE_MODEL", DEFAULT_LIVE_MODEL)).strip() or DEFAULT_LIVE_MODEL
            timeout_seconds = self._timeout_seconds()
            session = GeminiLiveSession(
                session_id=session_id,
                created_at=now,
                last_activity_at=now,
                model=resolved_model,
                timeout_seconds=timeout_seconds,
            )
            self._sessions[session_id] = session

            api_key = os.getenv("GEMINI_API_KEY", "").strip()
            if force_demo:
                session.source_mode = "demo"
                session.fallback_reason = "forced_demo_mode"
            elif not api_key:
                session.source_mode = "demo"
                session.fallback_reason = "gemini_api_key_missing"

            session.state = "ready"
            self._log_event(
                level="info",
                event="live_vision_session_started",
                session=session,
                stage="start",
                latency_ms=0,
                timeout=False,
                reason=session.fallback_reason or "ready",
            )
            return {
                "success": True,
                "session_id": session.session_id,
                "model": session.model,
                "state": session.state,
                "source_mode": "gemini_live_demo" if session.source_mode == "demo" else "gemini_live",
                "timeout_seconds": session.timeout_seconds,
                "session_ttl_seconds": self._session_ttl_seconds(),
                "reason": session.fallback_reason or "ready",
            }

    def classify_frame(
        self,
        *,
        session_id: str,
        frame_base64: str,
        mime_type: str,
        client_frame_seq: int | None = None,
    ) -> dict:
        start_ns = time.perf_counter_ns()
        session = self._get_session_or_raise(session_id)
        now = time.time()
        self._enforce_session_time_limit(session, now)
        self._enforce_frame_interval(session, now)

        with self._lock:
            session.last_activity_at = now
            session.last_frame_at = now
            session.frame_seq = max(session.frame_seq + 1, (client_frame_seq or 0) + 1)

        if session.source_mode == "demo":
            return self._build_demo_prediction(
                session=session,
                latency_ms=self._elapsed_ms(start_ns),
                reason=session.fallback_reason or "demo_mode",
            )

        try:
            response = self._invoke_model(
                model=session.model,
                frame_base64=frame_base64,
                mime_type=mime_type,
                timeout_seconds=session.timeout_seconds,
            )
        except requests.Timeout as exc:
            self._log_event(
                level="warning",
                event="live_vision_frame_failed",
                session=session,
                stage="frame",
                latency_ms=self._elapsed_ms(start_ns),
                timeout=True,
                reason="request_timeout",
                exception_type=type(exc).__name__,
            )
            return self._build_demo_prediction(
                session=session,
                latency_ms=self._elapsed_ms(start_ns),
                reason="upstream_timeout",
            )
        except Exception as exc:
            self._log_event(
                level="warning",
                event="live_vision_frame_failed",
                session=session,
                stage="frame",
                latency_ms=self._elapsed_ms(start_ns),
                timeout=False,
                reason="request_exception",
                exception_type=type(exc).__name__,
            )
            return self._build_demo_prediction(
                session=session,
                latency_ms=self._elapsed_ms(start_ns),
                reason="upstream_exception",
            )

        if response.status_code != 200:
            self._log_event(
                level="warning",
                event="live_vision_frame_failed",
                session=session,
                stage="frame",
                latency_ms=self._elapsed_ms(start_ns),
                timeout=False,
                reason="non_200_response",
                http_status=response.status_code,
                upstream_error=self._truncate_text(getattr(response, "text", "")),
            )
            return self._build_demo_prediction(
                session=session,
                latency_ms=self._elapsed_ms(start_ns),
                reason="upstream_non_200",
            )

        try:
            content = self._extract_model_text(response.json())
        except Exception as exc:
            self._log_event(
                level="warning",
                event="live_vision_parse_failed",
                session=session,
                stage="parse",
                latency_ms=self._elapsed_ms(start_ns),
                timeout=False,
                reason="response_parse_error",
                exception_type=type(exc).__name__,
            )
            return self._build_demo_prediction(
                session=session,
                latency_ms=self._elapsed_ms(start_ns),
                reason="response_parse_error",
            )

        parsed = self._parse_prediction(content)
        if not parsed:
            self._log_event(
                level="warning",
                event="live_vision_parse_failed",
                session=session,
                stage="parse",
                latency_ms=self._elapsed_ms(start_ns),
                timeout=False,
                reason="parse_failed",
            )
            return self._build_demo_prediction(
                session=session,
                latency_ms=self._elapsed_ms(start_ns),
                reason="parse_failed",
            )

        stable = self._update_stability(session, parsed["materials"])
        payload = {
            "success": True,
            "source": "gemini_live",
            "session_id": session.session_id,
            "frame_seq": session.frame_seq,
            "materials": parsed["materials"],
            "total_lbs": parsed["total_lbs"],
            "total_value": parsed["total_value"],
            "notes": parsed["notes"],
            "stable": stable,
            "latency_ms": self._elapsed_ms(start_ns),
        }
        self._log_event(
            level="info",
            event="live_vision_frame_processed",
            session=session,
            stage="frame",
            latency_ms=payload["latency_ms"],
            timeout=False,
            reason="ok",
            stable=stable,
        )
        return payload

    def stop_session(self, session_id: str) -> dict:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return {
                    "success": True,
                    "session_id": session_id,
                    "state": "closed",
                    "already_closed": True,
                }

            if session.state == "closed":
                return {
                    "success": True,
                    "session_id": session_id,
                    "state": "closed",
                    "already_closed": True,
                }

            session.state = "closing"
            session.last_activity_at = time.time()
            session.state = "closed"
            self._log_event(
                level="info",
                event="live_vision_session_stopped",
                session=session,
                stage="stop",
                latency_ms=0,
                timeout=False,
                reason="stopped",
            )
            return {
                "success": True,
                "session_id": session.session_id,
                "state": session.state,
                "already_closed": False,
            }

    def session_health(self, session_id: str) -> dict:
        session = self._get_session_or_raise(session_id)
        now = time.time()
        return {
            "success": True,
            "session_id": session.session_id,
            "state": session.state,
            "model": session.model,
            "source_mode": "gemini_live_demo" if session.source_mode == "demo" else "gemini_live",
            "frame_seq": session.frame_seq,
            "seconds_since_activity": round(max(0.0, now - session.last_activity_at), 3),
            "session_age_seconds": round(max(0.0, now - session.created_at), 3),
            "session_ttl_seconds": self._session_ttl_seconds(),
        }

    def frame_constraints(self) -> dict:
        return {
            "max_frame_bytes": self._max_frame_bytes(),
            "allowed_mime_types": sorted(ALLOWED_MIME_TYPES),
            "min_frame_interval_ms": self._min_frame_interval_ms(),
        }

    def _get_session_or_raise(self, session_id: str) -> GeminiLiveSession:
        with self._lock:
            self._cleanup_expired_sessions(time.time())
            session = self._sessions.get(session_id)
            if not session:
                raise GeminiLiveError(
                    code="live_session_not_found",
                    message="Live vision session was not found",
                    status=404,
                    errors=[{"field": "session_id", "message": "Unknown or expired session"}],
                )
            return session

    def _enforce_session_time_limit(self, session: GeminiLiveSession, now: float) -> None:
        max_duration = self._session_ttl_seconds()
        if now - session.created_at <= max_duration:
            return
        with self._lock:
            session.state = "closed"
            session.last_activity_at = now
        raise GeminiLiveError(
            code="live_session_expired",
            message="Live vision session expired",
            status=410,
            errors=[{"field": "session_id", "message": "Session exceeded max duration"}],
        )

    def _enforce_frame_interval(self, session: GeminiLiveSession, now: float) -> None:
        min_interval_ms = self._min_frame_interval_ms()
        if session.last_frame_at <= 0:
            return
        elapsed_ms = (now - session.last_frame_at) * 1000.0
        if elapsed_ms >= min_interval_ms:
            return
        raise GeminiLiveError(
            code="live_frame_rate_limited",
            message="Frame submitted too quickly",
            status=429,
            errors=[
                {
                    "field": "frame",
                    "message": f"Minimum interval is {min_interval_ms}ms",
                }
            ],
        )

    def _cleanup_expired_sessions(self, now: float) -> None:
        ttl = self._session_ttl_seconds()
        expired = [
            sid
            for sid, session in self._sessions.items()
            if (now - session.last_activity_at) > ttl or (now - session.created_at) > ttl
        ]
        for sid in expired:
            self._sessions.pop(sid, None)

    @staticmethod
    def _extract_model_text(payload: dict) -> str:
        candidates = payload.get("candidates", [])
        if not candidates:
            return ""
        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        if not parts:
            return ""
        text = parts[0].get("text", "")
        return str(text or "")

    def _invoke_model(self, *, model: str, frame_base64: str, mime_type: str, timeout_seconds: float):
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is missing")
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": LIVE_PROMPT},
                        {"inlineData": {"mimeType": mime_type, "data": frame_base64}},
                    ],
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 600,
                "responseMimeType": "application/json",
            },
        }
        return requests.post(endpoint, json=payload, timeout=timeout_seconds)

    def _parse_prediction(self, content: str) -> dict | None:
        candidates = self._extract_json_candidates(content)
        if not candidates:
            return None

        min_lbs, max_lbs = self._lbs_bounds()
        for candidate in candidates:
            try:
                obj = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            notes = ""
            if isinstance(obj, list):
                raw_materials = obj
            elif isinstance(obj, dict):
                notes = obj.get("notes", obj.get("summary", ""))
                if not isinstance(notes, str):
                    notes = str(notes)
                raw_materials = self._extract_material_rows(obj)
            else:
                continue
            if raw_materials is None:
                continue

            materials = []
            for item in raw_materials:
                if not isinstance(item, dict):
                    continue
                mat_type = self._normalize_material_type(
                    item.get("type")
                    or item.get("material")
                    or item.get("material_type")
                    or item.get("name")
                    or item.get("label")
                )
                if mat_type not in MATERIAL_RATES:
                    continue
                lbs_raw = self._extract_lbs(item)
                try:
                    lbs = float(lbs_raw)
                except (TypeError, ValueError):
                    continue
                lbs = round(max(min_lbs, min(max_lbs, lbs)), 1)
                material = Material(type=mat_type, lbs=lbs)
                row = material.to_dict()
                confidence = self._safe_float(
                    item.get("confidence"),
                    self._safe_float(item.get("score"), self._safe_float(item.get("probability"), 0.8)),
                )
                row["confidence"] = max(0.0, min(1.0, confidence))
                raw_confidence = self._safe_float(item.get("raw_confidence"), None)
                if raw_confidence is not None:
                    row["raw_confidence"] = raw_confidence
                provenance = item.get("provenance")
                if isinstance(provenance, str) and provenance.strip():
                    row["provenance"] = provenance.strip()
                materials.append(row)

            return {
                "materials": materials,
                "total_lbs": round(sum(m["lbs"] for m in materials), 1),
                "total_value": round(sum(m["value"] for m in materials), 2),
                "notes": notes,
            }
        return None

    @staticmethod
    def _extract_material_rows(obj: dict) -> list | None:
        preferred_keys = ("materials", "recyclable_materials", "recyclables", "items", "detections")
        for key in preferred_keys:
            rows = obj.get(key)
            if isinstance(rows, list):
                return rows

        if GeminiLiveService._looks_like_material_item(obj):
            return [obj]

        queue = [obj]
        while queue:
            current = queue.pop(0)
            if isinstance(current, dict):
                for key in preferred_keys:
                    rows = current.get(key)
                    if isinstance(rows, list):
                        return rows
                for value in current.values():
                    if isinstance(value, dict):
                        queue.append(value)
                    elif isinstance(value, list):
                        if GeminiLiveService._looks_like_material_rows(value):
                            return value
                        queue.extend(v for v in value if isinstance(v, dict))
            elif isinstance(current, list):
                if GeminiLiveService._looks_like_material_rows(current):
                    return current
                queue.extend(v for v in current if isinstance(v, dict))
        return None

    def _build_demo_prediction(self, *, session: GeminiLiveSession, latency_ms: int, reason: str) -> dict:
        return {
            "success": True,
            "source": "gemini_live_demo",
            "session_id": session.session_id,
            "frame_seq": session.frame_seq,
            "materials": [],
            "total_lbs": 0.0,
            "total_value": 0.0,
            "notes": f"Live fallback: {reason}",
            "stable": False,
            "latency_ms": latency_ms,
        }

    def _update_stability(self, session: GeminiLiveSession, materials: list[dict]) -> bool:
        signature_parts = [f"{m.get('type','')}:{float(m.get('lbs', 0.0)):.1f}" for m in materials]
        signature = "|".join(sorted(signature_parts))
        with self._lock:
            session.rolling_prediction_cache.append(signature)
            if len(session.rolling_prediction_cache) > 5:
                session.rolling_prediction_cache = session.rolling_prediction_cache[-5:]
            window = session.rolling_prediction_cache[-3:]
        return len(window) >= 3 and len(set(window)) == 1

    @staticmethod
    def _extract_json_candidates(content: str) -> list[str]:
        if not isinstance(content, str) or not content.strip():
            return []
        inputs = [content]
        inputs.extend(m.group(1) for m in FENCED_JSON_PATTERN.finditer(content))
        seen = set()
        out = []
        for text in inputs:
            stripped = text.strip()
            if stripped.startswith("[") and stripped.endswith("]") and stripped not in seen:
                seen.add(stripped)
                out.append(stripped)
            for candidate in GeminiLiveService._balanced_json_objects(text):
                normalized = candidate.strip()
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                out.append(normalized)
        return out

    @staticmethod
    def _looks_like_material_rows(rows: list) -> bool:
        if not isinstance(rows, list):
            return False
        if not rows:
            return False
        return any(GeminiLiveService._looks_like_material_item(item) for item in rows if isinstance(item, dict))

    @staticmethod
    def _looks_like_material_item(item: dict) -> bool:
        if not isinstance(item, dict):
            return False
        has_type = any(item.get(k) is not None for k in ("type", "material", "material_type", "name", "label"))
        has_weight = any(
            item.get(k) is not None
            for k in ("lbs", "weight_lbs", "estimated_weight_lbs", "weight", "estimated_weight", "pounds", "mass_lbs")
        )
        return has_type and has_weight

    @staticmethod
    def _extract_lbs(item: dict):
        for key in ("lbs", "weight_lbs", "estimated_weight_lbs", "weight", "estimated_weight", "pounds", "mass_lbs"):
            value = item.get(key)
            if value is not None:
                if isinstance(value, str):
                    token = value.strip().lower()
                    match = re.search(r"(-?\d+(?:\.\d+)?)", token)
                    if match:
                        return match.group(1)
                return value
        return None

    @staticmethod
    def _balanced_json_objects(text: str) -> Iterable[str]:
        depth = 0
        start = None
        in_string = False
        escape = False
        for idx, ch in enumerate(text):
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                continue
            if ch == "{":
                if depth == 0:
                    start = idx
                depth += 1
            elif ch == "}" and depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    yield text[start : idx + 1]
                    start = None

    def _log_event(
        self,
        *,
        level: str,
        event: str,
        session: GeminiLiveSession,
        stage: str,
        latency_ms: int,
        timeout: bool,
        reason: str,
        **extra_fields,
    ) -> None:
        extra = {
            "event": event,
            "service": "gemini_live",
            "session_id": session.session_id,
            "stage": stage,
            "latency_ms": latency_ms,
            "timeout": timeout,
            "reason": reason,
            "model": session.model,
            "state": session.state,
        }
        extra.update(extra_fields)
        log_method = getattr(logger, level, logger.info)
        log_method("gemini_live_event", extra=extra)

    def _timeout_seconds(self) -> float:
        return self._safe_float_env("GEMINI_LIVE_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, minimum=1.0)

    def _session_ttl_seconds(self) -> int:
        ttl = self._safe_float_env("GEMINI_LIVE_SESSION_TTL_SECONDS", float(DEFAULT_SESSION_TTL_SECONDS), minimum=30.0)
        return int(ttl)

    def _max_frame_bytes(self) -> int:
        value = self._safe_float_env("GEMINI_LIVE_MAX_FRAME_BYTES", float(DEFAULT_MAX_FRAME_BYTES), minimum=1024.0)
        return int(value)

    def _min_frame_interval_ms(self) -> int:
        value = self._safe_float_env("GEMINI_LIVE_MIN_FRAME_INTERVAL_MS", float(DEFAULT_MIN_FRAME_INTERVAL_MS), minimum=50.0)
        return int(value)

    def _lbs_bounds(self) -> tuple[float, float]:
        min_lbs = self._safe_float_env("GEMINI_LIVE_MIN_LBS", DEFAULT_MIN_LBS, minimum=0.01)
        max_lbs = self._safe_float_env("GEMINI_LIVE_MAX_LBS", DEFAULT_MAX_LBS, minimum=min_lbs)
        if max_lbs < min_lbs:
            max_lbs = min_lbs
        return min_lbs, max_lbs

    @staticmethod
    def _safe_float(value, default):
        if value is None:
            return default
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _safe_float_env(name: str, default: float, minimum: float) -> float:
        raw = os.getenv(name)
        if raw is None:
            return default
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return default
        if value < minimum:
            return default
        return value

    @staticmethod
    def _normalize_material_type(raw_type: object) -> str:
        text = str(raw_type or "").strip().lower()
        if not text:
            return ""
        normalized = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
        if normalized in MATERIAL_RATES:
            return normalized
        alias_key = normalized.replace("_", " ")
        return MATERIAL_TYPE_ALIASES.get(alias_key, "")

    @staticmethod
    def _truncate_text(text: str) -> str:
        compact = " ".join(str(text or "").split())
        if len(compact) <= UPSTREAM_ERROR_SNIPPET_MAX:
            return compact
        return compact[:UPSTREAM_ERROR_SNIPPET_MAX] + "..."

    @staticmethod
    def _elapsed_ms(start_ns: int) -> int:
        return int((time.perf_counter_ns() - start_ns) / 1_000_000)
