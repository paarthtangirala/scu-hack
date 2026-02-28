"""
Route optimization + route acceptance endpoints.
Owner: Atharva
"""
import logging
import uuid
from typing import Dict

from flask import Blueprint, request, jsonify
from backend.services.optimizer import RouteOptimizer
from backend.services.voice import VoiceNotifier
from backend.services.store import store
from backend.services.validation import validate_accept_route_payload, validate_optimize_payload
from backend.utils.http import error

optimize_bp = Blueprint("optimize", __name__, url_prefix="/api")
optimizer = RouteOptimizer()
notifier = VoiceNotifier()
logger = logging.getLogger(__name__)


def _notify_with_retry(phone: str, household_name: str, eta_minutes: int, driver_name: str, attempts: int = 2) -> Dict:
    last_result: Dict = {"success": False, "mode": "failed", "error": "unknown"}
    for attempt in range(1, attempts + 1):
        result = notifier.notify(
            phone=phone,
            household_name=household_name,
            eta_minutes=eta_minutes,
            driver_name=driver_name,
        )
        if result.get("success"):
            if attempt > 1:
                result["retry_attempt"] = attempt
            return result
        last_result = result
    return last_result

@optimize_bp.post("/optimize-route")
def optimize_route():
    data, errors = validate_optimize_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid optimize payload", status=422, errors=errors)

    stops, summary = optimizer.optimize(
        driver_lat=data["lat"],
        driver_lng=data["lng"],
        listings=store.all("available"),
        max_minutes=data["max_minutes"],
        truck_capacity_lbs=data["truck_capacity_lbs"],
        objective=data["objective"],
    )
    return jsonify({"stops": [s.to_dict() for s in stops], "summary": summary})

@optimize_bp.post("/accept-route")
def accept_route():
    payload, errors = validate_accept_route_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid accept-route payload", status=422, errors=errors)

    request_id = f"accept_{uuid.uuid4().hex[:12]}"
    route_stops = payload["stops"]
    driver_name = payload["driver_name"]
    notifications = []
    processed_ids = set()
    claimed_count = 0
    skipped_count = 0

    for stop in route_stops:
        lid = stop["listing_id"]
        eta = stop["eta_minutes"]

        if lid in processed_ids:
            skipped_count += 1
            notifications.append(
                {
                    "listing_id": lid,
                    "notification": {"success": False, "mode": "skipped", "reason": "duplicate_stop"},
                }
            )
            continue
        processed_ids.add(lid)

        listing = store.get(lid)
        if not listing:
            skipped_count += 1
            notifications.append(
                {"listing_id": lid, "notification": {"success": False, "mode": "skipped", "reason": "not_found"}}
            )
            continue

        claim_result = store.claim_listing(lid)
        if claim_result != "claimed":
            skipped_count += 1
            notifications.append(
                {
                    "listing_id": lid,
                    "household": listing.household_name,
                    "phone": listing.phone,
                    "notification": {"success": False, "mode": "skipped", "reason": claim_result},
                }
            )
            continue

        claimed_count += 1
        result = _notify_with_retry(
            phone=listing.phone,
            household_name=listing.household_name,
            eta_minutes=eta,
            driver_name=driver_name,
            attempts=2,
        )
        notifications.append(
            {
                "listing_id": lid,
                "household": listing.household_name,
                "phone": listing.phone,
                "notification": result,
            }
        )

    logger.info(
        "accept-route processed",
        extra={
            "request_id": request_id,
            "driver_name": driver_name,
            "requested_stops": len(route_stops),
            "claimed_count": claimed_count,
            "skipped_count": skipped_count,
        },
    )

    return jsonify(
        {
            "success": True,
            "request_id": request_id,
            "driver_name": driver_name,
            "requested_stops": len(route_stops),
            "claimed_count": claimed_count,
            "skipped_count": skipped_count,
            "notifications_sent": len([n for n in notifications if n.get("notification", {}).get("success")]),
            "notifications": notifications,
        }
    )
