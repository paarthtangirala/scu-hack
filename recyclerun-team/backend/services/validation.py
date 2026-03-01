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

    raw_materials = data.get("materials", [])
    if not isinstance(raw_materials, list) or not raw_materials:
        errors.append({"field": "materials", "message": "At least one material is required"})
        raw_materials = []

    materials: List[Material] = []
    for idx, item in enumerate(raw_materials):
        field = f"materials[{idx}]"
        if not isinstance(item, dict):
            errors.append({"field": field, "message": "Each material must be an object"})
            continue

        m_type = _as_string(item.get("type"))
        if m_type not in MATERIAL_RATES:
            errors.append({"field": f"{field}.type", "message": "Unsupported material type"})
            continue

        lbs = _parse_float(item.get("lbs"), f"{field}.lbs", errors)
        if lbs is None:
            continue
        if lbs <= 0:
            errors.append({"field": f"{field}.lbs", "message": "Must be > 0"})
            continue
        if lbs > 5000:
            errors.append({"field": f"{field}.lbs", "message": "Must be <= 5000"})
            continue

        # Preserve submitted order and values for valid payloads.
        materials.append(Material(type=m_type, lbs=lbs))

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

    if errors:
        return None, errors

    normalized = {
        "lat": float(lat),
        "lng": float(lng),
        "max_minutes": float(max_minutes),
        "truck_capacity_lbs": float(truck_capacity_lbs),
        "objective": objective,
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
