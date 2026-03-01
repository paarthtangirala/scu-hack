"""
AI vision classification — AMD primary.
Owner: Soham
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Iterable

import requests

logger = logging.getLogger(__name__)

DEFAULT_VISION_MIN_LBS = 0.1
DEFAULT_VISION_MAX_LBS = 500.0
CLAUDE_MODEL = "claude-opus-4-6"
FENCED_JSON_PATTERN = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)

VISION_PROMPT = """You are a recycling material classifier for California.
Analyze this image and identify ALL visible recyclable materials.

Valid material keys (use ONLY these):
cardboard, aluminum_cans, plastic_pet, plastic_hdpe, glass_bottles,
copper_wire, scrap_aluminum, ewaste_noncrt, ewaste_crt, steel_iron,
newspaper, scrap_metal_mixed

Respond ONLY with valid JSON, no other text:
{
  "materials": [
    {"type": "material_key", "lbs": 5.0, "confidence": 0.85}
  ],
  "notes": "Brief description"
}"""

class VisionClassifier:
    def classify(self, base64_image: str) -> dict:
        try:
            result = self._try_amd(base64_image)
            if not result and os.environ.get("ENABLE_CLAUDE_FALLBACK", "").strip().lower() in {"1", "true", "yes"}:
                # Keep demos sponsor-forward: only use non-AMD fallback if explicitly enabled.
                result = self._try_claude(base64_image)
            return result or self._demo_result()
        except Exception as exc:  # pragma: no cover - defensive safety net
            logger.exception(
                "vision_classify_unhandled",
                extra={
                    "source": "parser",
                    "timeout": False,
                    "reason": "request_exception",
                    "exception_type": type(exc).__name__,
                },
            )
            return self._demo_result()

    def _try_amd(self, b64: str) -> dict | None:
        key = os.environ.get("AMD_API_KEY")
        if not key:
            return None
        model = os.environ.get("AMD_VISION_MODEL", "meta-llama/Llama-3.2-11B-Vision-Instruct")
        try:
            r = requests.post(
                "https://api.amd.developer.cloud/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                        {"type": "text", "text": VISION_PROMPT}
                    ]}],
                    "max_tokens": 600, "temperature": 0.1,
                },
                timeout=30
            )
        except requests.Timeout as exc:
            logger.warning(
                "vision_request_failed",
                extra={
                    "source": "amd",
                    "timeout": True,
                    "reason": "request_timeout",
                    "model": model,
                    "exception_type": type(exc).__name__,
                },
            )
            return None
        except Exception as exc:
            logger.warning(
                "vision_request_failed",
                extra={
                    "source": "amd",
                    "timeout": False,
                    "reason": "request_exception",
                    "model": model,
                    "exception_type": type(exc).__name__,
                },
            )
            return None

        if r.status_code != 200:
            logger.warning(
                "vision_request_failed",
                extra={
                    "source": "amd",
                    "timeout": False,
                    "reason": "non_200_response",
                    "model": model,
                    "http_status": r.status_code,
                },
            )
            return None

        try:
            content = r.json()["choices"][0]["message"]["content"]
        except Exception as exc:
            logger.warning(
                "vision_request_failed",
                extra={
                    "source": "amd",
                    "timeout": False,
                    "reason": "request_exception",
                    "model": model,
                    "http_status": r.status_code,
                    "exception_type": type(exc).__name__,
                },
            )
            return None

        return self._parse(content, source="amd")

    def _try_claude(self, b64: str) -> dict | None:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            return None
        try:
            r = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={
                    "model": CLAUDE_MODEL,
                    "max_tokens": 600,
                    "messages": [{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                        {"type": "text", "text": VISION_PROMPT}
                    ]}]
                },
                timeout=30
            )
        except requests.Timeout as exc:
            logger.warning(
                "vision_request_failed",
                extra={
                    "source": "claude",
                    "timeout": True,
                    "reason": "request_timeout",
                    "model": CLAUDE_MODEL,
                    "exception_type": type(exc).__name__,
                },
            )
            return None
        except Exception as exc:
            logger.warning(
                "vision_request_failed",
                extra={
                    "source": "claude",
                    "timeout": False,
                    "reason": "request_exception",
                    "model": CLAUDE_MODEL,
                    "exception_type": type(exc).__name__,
                },
            )
            return None

        if r.status_code != 200:
            logger.warning(
                "vision_request_failed",
                extra={
                    "source": "claude",
                    "timeout": False,
                    "reason": "non_200_response",
                    "model": CLAUDE_MODEL,
                    "http_status": r.status_code,
                },
            )
            return None

        try:
            content = r.json()["content"][0]["text"]
        except Exception as exc:
            logger.warning(
                "vision_request_failed",
                extra={
                    "source": "claude",
                    "timeout": False,
                    "reason": "request_exception",
                    "model": CLAUDE_MODEL,
                    "http_status": r.status_code,
                    "exception_type": type(exc).__name__,
                },
            )
            return None

        return self._parse(content, source="claude")

    def _parse(self, content: str, source: str) -> dict | None:
        from backend.models.material import MATERIAL_RATES, Material

        candidates = self._extract_json_candidates(content)
        if not candidates:
            self._log_parse_failure(reason="no_json_candidate", upstream_source=source)
            return None

        for candidate in candidates:
            try:
                data = json.loads(candidate)
            except json.JSONDecodeError:
                self._log_parse_failure(reason="json_decode_error", upstream_source=source)
                continue

            if not isinstance(data, dict):
                self._log_parse_failure(reason="root_not_object", upstream_source=source)
                continue

            raw_materials = data.get("materials", [])
            if not isinstance(raw_materials, list):
                self._log_parse_failure(reason="materials_not_list", upstream_source=source)
                continue

            min_lbs, max_lbs = self._lbs_bounds()
            materials = []
            dropped_unknown = 0
            dropped_invalid = 0

            for item in raw_materials:
                if not isinstance(item, dict):
                    dropped_invalid += 1
                    self._log_parse_failure(
                        reason="invalid_material_item",
                        upstream_source=source,
                        dropped_unknown_materials_count=dropped_unknown,
                        dropped_invalid_materials_count=dropped_invalid,
                    )
                    continue

                mat_type = str(item.get("type", "")).strip()
                if not mat_type:
                    dropped_invalid += 1
                    self._log_parse_failure(
                        reason="missing_material_type",
                        upstream_source=source,
                        dropped_unknown_materials_count=dropped_unknown,
                        dropped_invalid_materials_count=dropped_invalid,
                    )
                    continue

                if mat_type not in MATERIAL_RATES:
                    dropped_unknown += 1
                    self._log_parse_failure(
                        reason="unknown_material_type",
                        upstream_source=source,
                        dropped_unknown_materials_count=dropped_unknown,
                        dropped_invalid_materials_count=dropped_invalid,
                    )
                    continue

                if "lbs" not in item:
                    dropped_invalid += 1
                    self._log_parse_failure(
                        reason="missing_lbs",
                        upstream_source=source,
                        dropped_unknown_materials_count=dropped_unknown,
                        dropped_invalid_materials_count=dropped_invalid,
                    )
                    continue

                try:
                    lbs = float(item["lbs"])
                except (TypeError, ValueError):
                    dropped_invalid += 1
                    self._log_parse_failure(
                        reason="invalid_lbs_type",
                        upstream_source=source,
                        dropped_unknown_materials_count=dropped_unknown,
                        dropped_invalid_materials_count=dropped_invalid,
                    )
                    continue

                lbs = max(min_lbs, min(max_lbs, lbs))
                lbs = round(lbs, 1)

                mat = Material(type=mat_type, lbs=lbs)
                entry = mat.to_dict()
                try:
                    entry["confidence"] = float(item.get("confidence", 0.8))
                except (TypeError, ValueError):
                    entry["confidence"] = 0.8
                materials.append(entry)

            if not materials:
                self._log_parse_failure(
                    reason="no_valid_materials",
                    upstream_source=source,
                    dropped_unknown_materials_count=dropped_unknown,
                    dropped_invalid_materials_count=dropped_invalid,
                )
                continue

            notes = data.get("notes", "")
            if not isinstance(notes, str):
                notes = str(notes)
            total_value = round(sum(m["value"] for m in materials), 2)
            total_lbs = round(sum(m["lbs"] for m in materials), 1)
            return {
                "success": True,
                "materials": materials,
                "total_value": total_value,
                "total_lbs": total_lbs,
                "notes": notes,
                "source": source,
            }

        return None

    @staticmethod
    def _extract_json_candidates(content: str) -> list[str]:
        if not isinstance(content, str) or not content.strip():
            return []

        inputs = [content]
        inputs.extend(m.group(1) for m in FENCED_JSON_PATTERN.finditer(content))
        seen = set()
        candidates = []

        for text in inputs:
            for candidate in VisionClassifier._balanced_json_objects(text):
                normalized = candidate.strip()
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                candidates.append(normalized)
        return candidates

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
                    yield text[start: idx + 1]
                    start = None

    @staticmethod
    def _lbs_bounds() -> tuple[float, float]:
        min_lbs = VisionClassifier._safe_float_env("VISION_MIN_LBS", DEFAULT_VISION_MIN_LBS)
        max_lbs = VisionClassifier._safe_float_env("VISION_MAX_LBS", DEFAULT_VISION_MAX_LBS)

        if min_lbs <= 0:
            min_lbs = DEFAULT_VISION_MIN_LBS
        if max_lbs < min_lbs:
            max_lbs = min_lbs
        return min_lbs, max_lbs

    @staticmethod
    def _safe_float_env(name: str, default: float) -> float:
        raw = os.environ.get(name)
        if raw is None:
            return default
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _log_parse_failure(reason: str, upstream_source: str, **extra_fields) -> None:
        extra = {
            "source": "parser",
            "timeout": False,
            "reason": reason,
            "upstream_source": upstream_source,
        }
        extra.update(extra_fields)
        logger.warning("vision_parse_guardrail", extra=extra)

    def _demo_result(self) -> dict:
        return {
            "success": True, "source": "demo",
            "materials": [
                {"type": "cardboard",     "label": "Cardboard (OCC)",        "emoji": "📦",
                 "lbs": 14.0, "rate": 0.04, "value": 0.56, "confidence": 0.91},
                {"type": "aluminum_cans", "label": "Aluminum Cans (CRV)",    "emoji": "🥫",
                 "lbs": 3.5,  "rate": 1.65, "value": 5.78, "confidence": 0.87},
                {"type": "plastic_pet",   "label": "Clear PET Plastic (CRV)","emoji": "🍶",
                 "lbs": 2.0,  "rate": 1.31, "value": 2.62, "confidence": 0.79},
            ],
            "total_value": 8.96, "total_lbs": 19.5,
            "notes": "Demo mode — add AMD_API_KEY for live detection",
        }
