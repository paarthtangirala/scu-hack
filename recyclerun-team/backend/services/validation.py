"""
Central request validation + normalization helpers for API routes.
"""
from __future__ import annotations

import base64
import binascii
from typing import Any, Dict, List, Tuple

from backend.models.material import MATERIAL_RATES, Material


LISTING_KINDS = {"household", "business"}
OBJECTIVES = {"value", "profit", "earnings", "$", "lbs", "weight", "impact", "diversion"}
PROFILE_ROLES = {"giver", "driver"}
CAPTURE_MODES = {"manual", "photo_ai", "live_ai"}
CONTAMINATION_FLAGS = {"wet", "mixed_bag", "hazard_risk", "food_residue", "broken_glass"}
MEDIA_PURPOSES = {"pickup_proof", "listing_photo"}
MEDIA_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
LIVE_FALLBACK_MODES = {"", "none", "tracking_only", "legacy_http_poll", "tap_to_capture", "manual", "manual_entry"}


def _as_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _parse_float(value: Any, field: str, errors: List[Dict[str, str]]) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        errors.append({"field": field, "message": "Must be a number"})
        return None


def _parse_int(value: Any, field: str, errors: List[Dict[str, str]]) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        errors.append({"field": field, "message": "Must be an integer"})
        return None


def _parse_material_rows(
    raw_materials: Any,
    *,
    field_name: str,
    errors: List[Dict[str, str]],
    require_non_empty: bool = True,
) -> List[Material]:
    if raw_materials is None:
        raw_materials = []
    if not isinstance(raw_materials, list):
        errors.append({"field": field_name, "message": "Must be an array of material objects"})
        return []
    if require_non_empty and not raw_materials:
        errors.append({"field": field_name, "message": "At least one material is required"})
        return []

    materials: List[Material] = []
    for idx, item in enumerate(raw_materials):
        field = f"{field_name}[{idx}]"
        if not isinstance(item, dict):
            errors.append({"field": field, "message": "Each material must be an object"})
            continue

        m_type = _as_string(item.get("type"))
        if m_type not in MATERIAL_RATES:
            errors.append({"field": f"{field}.type", "message": "Unsupported material type"})
            continue

        lbs = _parse_float(item.get("lbs", item.get("weight_lbs")), f"{field}.lbs", errors)
        if lbs is None:
            continue
        if lbs <= 0:
            errors.append({"field": f"{field}.lbs", "message": "Must be > 0"})
            continue
        if lbs > 5000:
            errors.append({"field": f"{field}.lbs", "message": "Must be <= 5000"})
            continue

        materials.append(Material(type=m_type, lbs=round(float(lbs), 1)))
    return materials


def _parse_estimated_material_rows(
    raw_materials: Any,
    *,
    field_name: str,
    errors: List[Dict[str, str]],
    require_non_empty: bool = True,
) -> List[Dict[str, Any]]:
    if raw_materials is None:
        raw_materials = []
    if not isinstance(raw_materials, list):
        errors.append({"field": field_name, "message": "Must be an array of material objects"})
        return []
    if require_non_empty and not raw_materials:
        errors.append({"field": field_name, "message": "At least one material is required"})
        return []

    estimated_rows: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw_materials):
        field = f"{field_name}[{idx}]"
        if not isinstance(item, dict):
            errors.append({"field": field, "message": "Each material must be an object"})
            continue

        m_type = _as_string(item.get("type"))
        if m_type not in MATERIAL_RATES:
            errors.append({"field": f"{field}.type", "message": "Unsupported material type"})
            continue

        lbs = _parse_float(item.get("lbs", item.get("weight_lbs")), f"{field}.lbs", errors)
        if lbs is None:
            continue
        if lbs <= 0:
            errors.append({"field": f"{field}.lbs", "message": "Must be > 0"})
            continue
        if lbs > 5000:
            errors.append({"field": f"{field}.lbs", "message": "Must be <= 5000"})
            continue

        count = _parse_int(item.get("count", 1), f"{field}.count", errors)
        if count is not None and count <= 0:
            errors.append({"field": f"{field}.count", "message": "Must be >= 1"})
        confidence = _parse_float(item.get("confidence", 0.0), f"{field}.confidence", errors)
        if confidence is not None and not (0 <= confidence <= 1):
            errors.append({"field": f"{field}.confidence", "message": "Must be within [0, 1]"})
        weight_confidence = _parse_float(
            item.get("weight_confidence", confidence if confidence is not None else 0.0),
            f"{field}.weight_confidence",
            errors,
        )
        if weight_confidence is not None and not (0 <= weight_confidence <= 1):
            errors.append({"field": f"{field}.weight_confidence", "message": "Must be within [0, 1]"})
        weight_low = _parse_float(item.get("weight_low", lbs), f"{field}.weight_low", errors)
        weight_high = _parse_float(item.get("weight_high", lbs), f"{field}.weight_high", errors)
        if weight_low is not None and weight_low < 0:
            errors.append({"field": f"{field}.weight_low", "message": "Must be >= 0"})
        if weight_high is not None and weight_high < 0:
            errors.append({"field": f"{field}.weight_high", "message": "Must be >= 0"})

        estimated_rows.append(
            {
                "type": m_type,
                "lbs": round(float(lbs), 1),
                "count": max(1, int(count or 1)),
                "confidence": round(float(confidence or 0.0), 2),
                "weight_confidence": round(float(weight_confidence or confidence or 0.0), 2),
                "weight_low": round(float(weight_low or lbs), 1),
                "weight_high": round(float(weight_high or lbs), 1),
                "provenance": _as_string(item.get("provenance"))[:80],
                "candidate_id": _as_string(item.get("candidate_id"))[:80],
            }
        )
    return estimated_rows


def validate_listing_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    address = _as_string(data.get("address"))
    if not address:
        errors.append({"field": "address", "message": "Address is required"})

    name = _as_string(data.get("household_name")) or _as_string(data.get("name"))
    if not name:
        errors.append({"field": "household_name", "message": "household_name is required"})
    phone = _as_string(data.get("phone"))
    notes = _as_string(data.get("notes"))
    capture_mode = _as_string(data.get("capture_mode") or "manual").lower()
    source_session_id = _as_string(data.get("source_session_id"))

    if capture_mode not in CAPTURE_MODES:
        errors.append({"field": "capture_mode", "message": f"Must be one of: {', '.join(sorted(CAPTURE_MODES))}"})

    listing_kind = _as_string(data.get("listing_kind") or "household").lower()
    if listing_kind not in LISTING_KINDS:
        errors.append(
            {
                "field": "listing_kind",
                "message": f"Must be one of: {', '.join(sorted(LISTING_KINDS))}",
            }
        )

    lat = _parse_float(data.get("lat", 37.3541), "lat", errors)
    lng = _parse_float(data.get("lng", -121.9552), "lng", errors)
    if lat is not None and not (-90 <= lat <= 90):
        errors.append({"field": "lat", "message": "Must be within [-90, 90]"})
    if lng is not None and not (-180 <= lng <= 180):
        errors.append({"field": "lng", "message": "Must be within [-180, 180]"})

    materials = _parse_material_rows(
        data.get("materials", []),
        field_name="materials",
        errors=errors,
        require_non_empty=True,
    )

    estimated_materials = _parse_estimated_material_rows(
        data.get("estimated_materials", data.get("materials", [])),
        field_name="estimated_materials",
        errors=errors,
        require_non_empty=True,
    )
    estimated_total_lbs = _parse_float(
        data.get(
            "estimated_total_lbs",
            round(sum(float(item.get("lbs", 0) or 0) for item in estimated_materials), 1),
        ),
        "estimated_total_lbs",
        errors,
    )
    estimated_confidence = _parse_float(
        data.get("estimated_confidence", 1.0 if capture_mode == "manual" else 0.82),
        "estimated_confidence",
        errors,
    )
    if estimated_total_lbs is not None and estimated_total_lbs <= 0:
        errors.append({"field": "estimated_total_lbs", "message": "Must be > 0"})
    if estimated_confidence is not None and not (0 <= estimated_confidence <= 1):
        errors.append({"field": "estimated_confidence", "message": "Must be within [0, 1]"})

    if errors:
        return None, errors

    normalized = {
        "address": address,
        "lat": float(lat),
        "lng": float(lng),
        "household_name": name,
        "phone": phone,
        "listing_kind": listing_kind,
        "notes": notes,
        "materials": materials,
        "estimated_materials": estimated_materials or list(materials),
        "capture_mode": capture_mode,
        "source_session_id": source_session_id[:120],
        "estimated_total_lbs": round(float(estimated_total_lbs), 1),
        "estimated_confidence": round(float(estimated_confidence), 2),
    }
    return normalized, []


def validate_classify_payload(data: Any, max_bytes: int = 8_000_000) -> Tuple[str | None, List[Dict[str, str]]]:
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    image_b64 = _as_string(data.get("image_base64"))
    if not image_b64:
        return None, [{"field": "image_base64", "message": "image_base64 is required"}]
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1].strip()

    try:
        decoded = base64.b64decode(image_b64, validate=True)
    except (binascii.Error, ValueError):
        return None, [{"field": "image_base64", "message": "Invalid base64 encoding"}]

    if not decoded:
        return None, [{"field": "image_base64", "message": "Decoded image is empty"}]
    if len(decoded) > max_bytes:
        return None, [{"field": "image_base64", "message": f"Image exceeds {max_bytes} bytes"}]

    return image_b64, []


def validate_optimize_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    lat = _parse_float(data.get("lat", 37.3541), "lat", errors)
    lng = _parse_float(data.get("lng", -121.9552), "lng", errors)
    max_minutes = _parse_float(data.get("max_minutes", 120), "max_minutes", errors)
    truck_capacity_lbs = _parse_float(data.get("truck_capacity_lbs", 1000), "truck_capacity_lbs", errors)
    objective = _as_string(data.get("objective", "value")).lower()
    raw_priority_listing_ids = data.get("priority_listing_ids", [])
    priority_listing_ids: List[str] = []

    if lat is not None and not (-90 <= lat <= 90):
        errors.append({"field": "lat", "message": "Must be within [-90, 90]"})
    if lng is not None and not (-180 <= lng <= 180):
        errors.append({"field": "lng", "message": "Must be within [-180, 180]"})
    if max_minutes is not None and not (1 <= max_minutes <= 12 * 60):
        errors.append({"field": "max_minutes", "message": "Must be within [1, 720]"})
    if truck_capacity_lbs is not None and not (1 <= truck_capacity_lbs <= 20_000):
        errors.append({"field": "truck_capacity_lbs", "message": "Must be within [1, 20000]"})
    if objective not in OBJECTIVES:
        errors.append(
            {
                "field": "objective",
                "message": "Unsupported objective. Use value/profit or lbs/impact",
            }
        )

    if raw_priority_listing_ids is None:
        raw_priority_listing_ids = []
    if not isinstance(raw_priority_listing_ids, list):
        errors.append({"field": "priority_listing_ids", "message": "Must be an array of listing ids"})
    else:
        if len(raw_priority_listing_ids) > 50:
            errors.append({"field": "priority_listing_ids", "message": "Must contain at most 50 ids"})
        seen = set()
        for idx, raw_id in enumerate(raw_priority_listing_ids):
            listing_id = _as_string(raw_id)
            if not listing_id:
                errors.append({"field": f"priority_listing_ids[{idx}]", "message": "Listing id is required"})
                continue
            safe_id = "".join(ch for ch in listing_id if ch.isalnum() or ch in {"_", "-"})
            if not safe_id:
                errors.append({"field": f"priority_listing_ids[{idx}]", "message": "Listing id has invalid characters"})
                continue
            normalized = safe_id[:80]
            if normalized in seen:
                continue
            seen.add(normalized)
            priority_listing_ids.append(normalized)

    if errors:
        return None, errors

    normalized = {
        "lat": float(lat),
        "lng": float(lng),
        "max_minutes": float(max_minutes),
        "truck_capacity_lbs": float(truck_capacity_lbs),
        "objective": objective,
        "priority_listing_ids": priority_listing_ids,
    }
    return normalized, []


def validate_accept_route_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    driver_name = _as_string(data.get("driver_name")) or "your Bin2Bucks driver"
    raw_stops = data.get("stops")
    if not isinstance(raw_stops, list) or not raw_stops:
        return None, [{"field": "stops", "message": "At least one stop is required"}]

    stops: List[Dict[str, Any]] = []
    for idx, stop in enumerate(raw_stops):
        field = f"stops[{idx}]"
        if not isinstance(stop, dict):
            errors.append({"field": field, "message": "Each stop must be an object"})
            continue

        listing_id = _as_string(stop.get("listing_id") or stop.get("id"))
        if not listing_id:
            errors.append({"field": f"{field}.listing_id", "message": "listing_id is required"})
            continue

        eta_minutes = stop.get("eta_minutes", 30)
        parsed_eta = _parse_int(eta_minutes, f"{field}.eta_minutes", errors)
        if parsed_eta is None:
            continue
        if not (0 <= parsed_eta <= 24 * 60):
            errors.append({"field": f"{field}.eta_minutes", "message": "Must be within [0, 1440]"})
            continue

        stops.append({"listing_id": listing_id, "eta_minutes": parsed_eta})

    if errors:
        return None, errors

    return {"driver_name": driver_name, "stops": stops}, []


def validate_pickup_completion_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    actual_materials = _parse_material_rows(
        data.get("actual_materials"),
        field_name="actual_materials",
        errors=errors,
        require_non_empty=True,
    )
    actual_total_lbs = _parse_float(data.get("actual_total_lbs"), "actual_total_lbs", errors)
    if actual_total_lbs is not None and actual_total_lbs <= 0:
        errors.append({"field": "actual_total_lbs", "message": "Must be > 0"})

    raw_flags = data.get("contamination_flags", [])
    contamination_flags: List[str] = []
    if raw_flags is None:
        raw_flags = []
    if not isinstance(raw_flags, list):
        errors.append({"field": "contamination_flags", "message": "Must be an array of strings"})
    else:
        seen = set()
        for idx, raw_flag in enumerate(raw_flags):
            flag = _as_string(raw_flag).lower()
            if not flag:
                errors.append({"field": f"contamination_flags[{idx}]", "message": "Flag cannot be empty"})
                continue
            if flag not in CONTAMINATION_FLAGS:
                errors.append(
                    {
                        "field": f"contamination_flags[{idx}]",
                        "message": f"Must be one of: {', '.join(sorted(CONTAMINATION_FLAGS))}",
                    }
                )
                continue
            if flag in seen:
                continue
            seen.add(flag)
            contamination_flags.append(flag)

    completion_media_id = _as_string(data.get("completion_media_id"))[:160]
    completed_at = _as_string(data.get("completed_at"))
    driver_lat = None if data.get("driver_lat") is None else _parse_float(data.get("driver_lat"), "driver_lat", errors)
    driver_lng = None if data.get("driver_lng") is None else _parse_float(data.get("driver_lng"), "driver_lng", errors)
    if driver_lat is not None and not (-90 <= driver_lat <= 90):
        errors.append({"field": "driver_lat", "message": "Must be within [-90, 90]"})
    if driver_lng is not None and not (-180 <= driver_lng <= 180):
        errors.append({"field": "driver_lng", "message": "Must be within [-180, 180]"})

    if errors:
        return None, errors

    return {
        "actual_materials": actual_materials,
        "actual_total_lbs": round(float(actual_total_lbs), 1),
        "contamination_flags": contamination_flags,
        "completion_media_id": completion_media_id,
        "completed_at": completed_at,
        "driver_lat": driver_lat,
        "driver_lng": driver_lng,
    }, []


def validate_media_upload_payload(
    data: Any,
    *,
    max_bytes: int = 8_000_000,
) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    raw_image = _as_string(data.get("image_base64"))
    if not raw_image:
        return None, [{"field": "image_base64", "message": "image_base64 is required"}]

    mime_type = _as_string(data.get("mime_type")).lower() or "image/jpeg"
    if "," in raw_image:
        prefix, image_only = raw_image.split(",", 1)
        raw_image = image_only.strip()
        if prefix.startswith("data:") and ";base64" in prefix and not _as_string(data.get("mime_type")):
            inferred = prefix[5:].split(";", 1)[0].strip().lower()
            if inferred:
                mime_type = inferred

    if mime_type not in MEDIA_MIME_TYPES:
        errors.append(
            {
                "field": "mime_type",
                "message": f"Must be one of: {', '.join(sorted(MEDIA_MIME_TYPES))}",
            }
        )

    purpose = _as_string(data.get("purpose") or "pickup_proof").lower()
    if purpose not in MEDIA_PURPOSES:
        errors.append(
            {
                "field": "purpose",
                "message": f"Must be one of: {', '.join(sorted(MEDIA_PURPOSES))}",
            }
        )

    file_name = _as_string(data.get("file_name"))[:160]
    if not file_name:
        default_ext = "jpg" if mime_type == "image/jpeg" else "png" if mime_type == "image/png" else "webp"
        file_name = f"{purpose}.{default_ext}"

    try:
        content_bytes = base64.b64decode(raw_image, validate=True)
    except (binascii.Error, ValueError):
        return None, [{"field": "image_base64", "message": "Invalid base64 encoding"}]

    if not content_bytes:
        errors.append({"field": "image_base64", "message": "Decoded image is empty"})
    if len(content_bytes) > max_bytes:
        errors.append({"field": "image_base64", "message": f"Image exceeds {max_bytes} bytes"})

    if errors:
        return None, errors

    return {
        "image_base64": raw_image,
        "content_bytes": content_bytes,
        "mime_type": mime_type,
        "purpose": purpose,
        "file_name": file_name,
    }, []


def validate_dashboard_window(value: Any) -> Tuple[str, List[Dict[str, str]]]:
    window = _as_string(value or "30d").lower()
    if window not in {"7d", "30d", "90d", "all"}:
        return "", [{"field": "window", "message": "Must be one of: 7d, 30d, 90d, all"}]
    return window, []


def _normalize_profile_role(value: Any) -> str:
    role = _as_string(value).lower()
    aliases = {"user": "giver", "household": "giver", "collector": "driver"}
    return aliases.get(role, role)


def validate_profile_role(value: Any) -> Tuple[str, List[Dict[str, str]]]:
    role = _normalize_profile_role(value)
    if role not in PROFILE_ROLES:
        return "", [{"field": "role", "message": f"Must be one of: {', '.join(sorted(PROFILE_ROLES))}"}]
    return role, []


def validate_profile_session_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    role, role_errors = validate_profile_role(data.get("role"))
    if role_errors:
        errors.extend(role_errors)

    display_name = _as_string(data.get("display_name") or data.get("name"))
    email = _as_string(data.get("email")).lower()
    phone = _as_string(data.get("phone"))
    if not email and not phone:
        errors.append({"field": "email", "message": "Either email or phone is required"})

    if not display_name:
        if email:
            display_name = email.split("@", 1)[0].replace(".", " ").replace("_", " ").title()
        elif phone:
            display_name = f"{role.title()} User" if role else "Bin2Bucks User"
        else:
            errors.append({"field": "display_name", "message": "display_name is required"})

    session_id = _as_string(data.get("session_id"))
    if session_id:
        safe_session_id = "".join(ch for ch in session_id if ch.isalnum() or ch in {"-", "_", "."})
        if not safe_session_id:
            errors.append({"field": "session_id", "message": "session_id contains invalid characters"})
        session_id = safe_session_id[:80]

    device_label = _as_string(data.get("device_label")) or "mobile-app"
    device_label = device_label[:80]

    if errors:
        return None, errors

    return {
        "role": role,
        "display_name": display_name[:80],
        "email": email,
        "phone": phone,
        "session_id": session_id,
        "device_label": device_label,
    }, []


def validate_profile_update_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    payload: Dict[str, Any] = {}
    if "display_name" in data:
        name = _as_string(data.get("display_name"))
        if not name:
            errors.append({"field": "display_name", "message": "display_name must be non-empty"})
        else:
            payload["display_name"] = name[:80]

    if "email" in data:
        payload["email"] = _as_string(data.get("email")).lower()

    if "phone" in data:
        payload["phone"] = _as_string(data.get("phone"))

    if not payload:
        errors.append({"field": "body", "message": "At least one field is required: display_name, email, phone"})

    if "email" in payload and "phone" in payload and not payload["email"] and not payload["phone"]:
        errors.append({"field": "email", "message": "Either email or phone must be provided"})

    if errors:
        return None, errors

    return payload, []


def validate_live_token_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    model = _as_string(data.get("model"))
    if data.get("model") is not None and not model:
        errors.append({"field": "model", "message": "model must be a non-empty string"})

    force_legacy_raw = data.get("force_legacy", False)
    if isinstance(force_legacy_raw, bool):
        force_legacy = force_legacy_raw
    elif isinstance(force_legacy_raw, str):
        force_legacy = force_legacy_raw.strip().lower() in {"1", "true", "yes", "on"}
    else:
        errors.append({"field": "force_legacy", "message": "force_legacy must be a boolean"})
        force_legacy = False

    if errors:
        return None, errors

    return {
        "model": model or None,
        "force_legacy": force_legacy,
        "profile_id": _as_string(data.get("profile_id"))[:80],
        "device_label": _as_string(data.get("device_label"))[:80],
        "app_version": _as_string(data.get("app_version"))[:40],
        "platform": _as_string(data.get("platform"))[:40],
        "device_tier": _as_string(data.get("device_tier"))[:40],
        "network_type": _as_string(data.get("network_type"))[:40],
    }, []


def validate_live_telemetry_batch_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    telemetry_session_id = _as_string(data.get("telemetry_session_id") or data.get("source_session_id"))[:80]
    if not telemetry_session_id:
        errors.append({"field": "telemetry_session_id", "message": "telemetry_session_id is required"})

    raw_events = data.get("events")
    if not isinstance(raw_events, list) or not raw_events:
        errors.append({"field": "events", "message": "events must be a non-empty array"})
        raw_events = []
    elif len(raw_events) > 200:
        errors.append({"field": "events", "message": "events must contain at most 200 items"})

    events: List[Dict[str, Any]] = []
    for idx, raw_event in enumerate(raw_events):
        field = f"events[{idx}]"
        if not isinstance(raw_event, dict):
            errors.append({"field": field, "message": "Each event must be an object"})
            continue
        event_id = _as_string(raw_event.get("event_id"))[:80]
        event_type = _as_string(raw_event.get("event_type"))[:80]
        if not event_id:
            errors.append({"field": f"{field}.event_id", "message": "event_id is required"})
        if not event_type:
            errors.append({"field": f"{field}.event_type", "message": "event_type is required"})

        ts_ms = _parse_int(raw_event.get("ts_ms"), f"{field}.ts_ms", errors)
        latency_ms = raw_event.get("latency_ms")
        parsed_latency = None
        if latency_ms is not None:
            parsed_latency = _parse_int(latency_ms, f"{field}.latency_ms", errors)
            if parsed_latency is not None and parsed_latency < 0:
                errors.append({"field": f"{field}.latency_ms", "message": "Must be >= 0"})

        details = raw_event.get("details", {})
        if details is None:
            details = {}
        if not isinstance(details, dict):
            errors.append({"field": f"{field}.details", "message": "details must be an object"})
            details = {}

        events.append(
            {
                "event_id": event_id,
                "event_type": event_type,
                "ts_ms": ts_ms,
                "latency_ms": parsed_latency,
                "candidate_id": _as_string(raw_event.get("candidate_id"))[:80],
                "track_id": _as_string(raw_event.get("track_id"))[:80],
                "reason": _as_string(raw_event.get("reason"))[:160],
                "details": details,
                "platform": _as_string(raw_event.get("platform"))[:40],
                "device_tier": _as_string(raw_event.get("device_tier"))[:40],
                "network_type": _as_string(raw_event.get("network_type"))[:40],
                "device_model": _as_string(raw_event.get("device_model"))[:80],
                "os_version": _as_string(raw_event.get("os_version"))[:40],
                "transport_mode": _as_string(raw_event.get("transport_mode"))[:40],
                "preview_fps_p50": None if raw_event.get("preview_fps_p50") is None else _parse_float(raw_event.get("preview_fps_p50"), f"{field}.preview_fps_p50", errors),
                "preview_fps_p95": None if raw_event.get("preview_fps_p95") is None else _parse_float(raw_event.get("preview_fps_p95"), f"{field}.preview_fps_p95", errors),
                "detector_ms_p50": None if raw_event.get("detector_ms_p50") is None else _parse_float(raw_event.get("detector_ms_p50"), f"{field}.detector_ms_p50", errors),
                "detector_ms_p95": None if raw_event.get("detector_ms_p95") is None else _parse_float(raw_event.get("detector_ms_p95"), f"{field}.detector_ms_p95", errors),
                "stable_candidate_ms_p50": None if raw_event.get("stable_candidate_ms_p50") is None else _parse_float(raw_event.get("stable_candidate_ms_p50"), f"{field}.stable_candidate_ms_p50", errors),
                "stable_candidate_ms_p95": None if raw_event.get("stable_candidate_ms_p95") is None else _parse_float(raw_event.get("stable_candidate_ms_p95"), f"{field}.stable_candidate_ms_p95", errors),
                "gemini_rtt_ms_p50": None if raw_event.get("gemini_rtt_ms_p50") is None else _parse_float(raw_event.get("gemini_rtt_ms_p50"), f"{field}.gemini_rtt_ms_p50", errors),
                "gemini_rtt_ms_p95": None if raw_event.get("gemini_rtt_ms_p95") is None else _parse_float(raw_event.get("gemini_rtt_ms_p95"), f"{field}.gemini_rtt_ms_p95", errors),
                "resume_count": None if raw_event.get("resume_count") is None else _parse_int(raw_event.get("resume_count"), f"{field}.resume_count", errors),
                "fallback_reason": _as_string(raw_event.get("fallback_reason"))[:160],
            }
        )

    if errors:
        return None, errors

    summary = data.get("summary", {})
    if summary is None:
        summary = {}
    if not isinstance(summary, dict):
        errors.append({"field": "summary", "message": "summary must be an object"})
        summary = {}
    if errors:
        return None, errors

    return {"telemetry_session_id": telemetry_session_id, "events": events, "summary": summary}, []


def validate_live_session_end_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    telemetry_session_id = _as_string(data.get("telemetry_session_id") or data.get("source_session_id"))[:80]
    if not telemetry_session_id:
        errors.append({"field": "telemetry_session_id", "message": "telemetry_session_id is required"})

    confirmed_count = _parse_int(data.get("confirmed_count", 0), "confirmed_count", errors)
    skipped_count = _parse_int(data.get("skipped_count", 0), "skipped_count", errors)
    duration_ms = _parse_int(data.get("duration_ms", 0), "duration_ms", errors)
    if confirmed_count is not None and confirmed_count < 0:
        errors.append({"field": "confirmed_count", "message": "Must be >= 0"})
    if skipped_count is not None and skipped_count < 0:
        errors.append({"field": "skipped_count", "message": "Must be >= 0"})
    if duration_ms is not None and duration_ms < 0:
        errors.append({"field": "duration_ms", "message": "Must be >= 0"})

    fallback_mode = _as_string(data.get("fallback_mode") or "none").lower()
    if fallback_mode not in LIVE_FALLBACK_MODES:
        errors.append(
            {
                "field": "fallback_mode",
                "message": f"Must be one of: {', '.join(sorted(LIVE_FALLBACK_MODES - {''}))}",
            }
        )

    if errors:
        return None, errors

    return {
        "telemetry_session_id": telemetry_session_id,
        "source_session_id": _as_string(data.get("source_session_id") or telemetry_session_id)[:80],
        "duration_ms": int(duration_ms or 0),
        "confirmed_count": int(confirmed_count or 0),
        "skipped_count": int(skipped_count or 0),
        "fallback_mode": fallback_mode,
        "error_summary": _as_string(data.get("error_summary"))[:400],
        "transport_mode": _as_string(data.get("transport_mode"))[:40],
        "metrics": data.get("metrics") if isinstance(data.get("metrics"), dict) else {},
    }, []


def validate_live_session_start_payload(data: Any) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    model = _as_string(data.get("model"))
    if data.get("model") is not None and not model:
        errors.append({"field": "model", "message": "model must be a non-empty string"})

    force_demo_raw = data.get("force_demo", False)
    if isinstance(force_demo_raw, bool):
        force_demo = force_demo_raw
    elif isinstance(force_demo_raw, str):
        force_demo = force_demo_raw.strip().lower() in {"1", "true", "yes", "on"}
    else:
        errors.append({"field": "force_demo", "message": "force_demo must be a boolean"})
        force_demo = False

    if errors:
        return None, errors

    return {"model": model or None, "force_demo": force_demo}, []


def validate_live_frame_payload(
    data: Any,
    *,
    max_bytes: int,
    allowed_mime_types: list[str],
) -> Tuple[Dict[str, Any] | None, List[Dict[str, str]]]:
    errors: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return None, [{"field": "body", "message": "JSON object is required"}]

    raw_frame = _as_string(data.get("frame_base64"))
    if not raw_frame:
        return None, [{"field": "frame_base64", "message": "frame_base64 is required"}]

    mime_type = _as_string(data.get("mime_type")).lower() or "image/jpeg"
    if "," in raw_frame:
        prefix, frame_only = raw_frame.split(",", 1)
        raw_frame = frame_only.strip()
        if prefix.startswith("data:") and ";base64" in prefix and not _as_string(data.get("mime_type")):
            inferred = prefix[5:].split(";", 1)[0].strip().lower()
            if inferred:
                mime_type = inferred

    if mime_type not in set(allowed_mime_types):
        errors.append(
            {
                "field": "mime_type",
                "message": f"Unsupported mime_type. Must be one of: {', '.join(sorted(set(allowed_mime_types)))}",
            }
        )

    frame_seq = data.get("frame_seq")
    parsed_seq: int | None = None
    if frame_seq is not None:
        parsed_seq = _parse_int(frame_seq, "frame_seq", errors)
        if parsed_seq is not None and parsed_seq < 0:
            errors.append({"field": "frame_seq", "message": "Must be >= 0"})

    try:
        decoded = base64.b64decode(raw_frame, validate=True)
    except (binascii.Error, ValueError):
        errors.append({"field": "frame_base64", "message": "Invalid base64 encoding"})
        decoded = b""

    if decoded and len(decoded) > max_bytes:
        errors.append({"field": "frame_base64", "message": f"Frame exceeds {max_bytes} bytes"})

    if errors:
        return None, errors

    return {"frame_base64": raw_frame, "mime_type": mime_type, "frame_seq": parsed_seq}, []
