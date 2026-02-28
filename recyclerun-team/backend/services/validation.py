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

    name = _as_string(data.get("household_name")) or _as_string(data.get("name")) or "Anonymous"
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

    aggregated: Dict[str, float] = {}
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

        aggregated[m_type] = round(aggregated.get(m_type, 0.0) + lbs, 2)

    if errors:
        return None, errors

    materials = [Material(type=m_type, lbs=round(lbs, 1)) for m_type, lbs in aggregated.items()]
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

    driver_name = _as_string(data.get("driver_name")) or "your RecycleRun driver"
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
