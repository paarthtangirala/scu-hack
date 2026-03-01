"""
Route optimization + route acceptance endpoints.
Owner: Atharva
"""
from __future__ import annotations

import logging
import uuid
from typing import Dict, Tuple

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


def _notify_with_retry(phone: str, household_name: str, eta_minutes: int, driver_name: str, attempts: int = 2) -> Tuple[Dict, int]:
    last_result: Dict = {"success": False, "mode": "failed", "error": "unknown", "reason": "unknown_failure"}
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
            return result, attempt
        last_result = result
    return last_result, attempts


def _build_stop_result(
    *,
    listing_id: str,
    status_code: str,
    retryable: bool,
    success: bool,
    notification: Dict,
    household: str | None = None,
    phone: str | None = None,
    attempts: int = 0,
) -> Dict:
    result = {
        "listing_id": listing_id,
        "status_code": status_code,
        "retryable": retryable,
        "attempts": attempts,
        "notification": notification,
    }
    if household is not None:
        result["household"] = household
    if phone is not None:
        result["phone"] = phone
    # Backward-compatibility for older frontend code paths that infer success via notification.
    result["success"] = success
    return result


def _request_id_from_context(payload: Dict | None) -> str:
    header_id = (request.headers.get("X-Request-ID") or request.headers.get("X-Correlation-ID") or "").strip()
    payload_id = ""
    if isinstance(payload, dict):
        payload_id = str(payload.get("request_id", "")).strip()

    raw_id = header_id or payload_id
    if raw_id:
        cleaned = "".join(ch for ch in raw_id if ch.isalnum() or ch in {"-", "_", "."})
        if cleaned:
            return cleaned[:64]
    return f"accept_{uuid.uuid4().hex[:12]}"

@optimize_bp.post("/optimize-route")
def optimize_route():
    data, errors = validate_optimize_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid optimize payload", status=400, errors=errors)

    try:
        stops, summary = optimizer.optimize(
            driver_lat=data["lat"],
            driver_lng=data["lng"],
            listings=store.all("available"),
            max_minutes=data["max_minutes"],
            truck_capacity_lbs=data["truck_capacity_lbs"],
            objective=data["objective"],
        )
    except Exception as exc:  # defensive guard: keep frontend-facing failure envelope structured
        logger.exception(
            "optimize-route failed objective=%s exception_type=%s",
            data.get("objective"),
            exc.__class__.__name__,
        )
        return error(
            code="optimizer_failed",
            message="Route optimizer failed to produce a route",
            status=502,
            errors=[{"field": "optimizer", "message": "Internal optimization failure"}],
        )
    return jsonify({"stops": [s.to_dict() for s in stops], "summary": summary})

@optimize_bp.post("/accept-route")
def accept_route():
    raw_payload = request.get_json(silent=True)
    payload, errors = validate_accept_route_payload(raw_payload)
    if errors:
        return error(code="validation_error", message="Invalid accept-route payload", status=400, errors=errors)

    try:
        request_id = _request_id_from_context(raw_payload)
        replay = store.get_accept_route_result(request_id)
        if replay is not None:
            replay["idempotent_replay"] = True
            return jsonify(replay)

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
                    _build_stop_result(
                        listing_id=lid,
                        status_code="duplicate_stop",
                        retryable=False,
                        success=False,
                        attempts=0,
                        notification={"success": False, "mode": "skipped", "reason": "duplicate_stop"},
                    )
                )
                continue
            processed_ids.add(lid)

            listing = store.get(lid)
            if not listing:
                skipped_count += 1
                notifications.append(
                    _build_stop_result(
                        listing_id=lid,
                        status_code="listing_not_found",
                        retryable=False,
                        success=False,
                        attempts=0,
                        notification={"success": False, "mode": "skipped", "reason": "not_found"},
                    )
                )
                continue

            claim_result = store.claim_listing(lid)
            if claim_result != "claimed":
                skipped_count += 1
                notifications.append(
                    _build_stop_result(
                        listing_id=lid,
                        status_code=claim_result,
                        retryable=False,
                        success=False,
                        household=listing.household_name,
                        phone=listing.phone,
                        attempts=0,
                        notification={"success": False, "mode": "skipped", "reason": claim_result},
                    )
                )
                continue

            claimed_count += 1
            result, attempts_used = _notify_with_retry(
                phone=listing.phone,
                household_name=listing.household_name,
                eta_minutes=eta,
                driver_name=driver_name,
                attempts=2,
            )
            status_code = "claimed_notified" if result.get("success") else "notification_failed"
            notifications.append(
                _build_stop_result(
                    listing_id=lid,
                    status_code=status_code,
                    retryable=not result.get("success", False),
                    success=bool(result.get("success")),
                    household=listing.household_name,
                    phone=listing.phone,
                    attempts=attempts_used,
                    notification=result,
                )
            )

        notifications_sent = len([n for n in notifications if n.get("notification", {}).get("success")])
        notifications_failed = len([n for n in notifications if n.get("status_code") == "notification_failed"])
        logger.info(
            "accept-route processed request_id=%s driver_name=%s requested_stops=%d claimed_count=%d skipped_count=%d notifications_sent=%d notifications_failed=%d",
            request_id,
            driver_name,
            len(route_stops),
            claimed_count,
            skipped_count,
            notifications_sent,
            notifications_failed,
        )

        response = {
            "success": True,
            "idempotent_replay": False,
            "request_id": request_id,
            "driver_name": driver_name,
            "requested_stops": len(route_stops),
            "claimed_count": claimed_count,
            "skipped_count": skipped_count,
            "notifications_sent": notifications_sent,
            "notifications_failed": notifications_failed,
            "notifications": notifications,
        }
        store.save_accept_route_result(request_id, response)
        return jsonify(response)
    except Exception as exc:  # defensive guard: prevent HTML 500 responses for clients
        logger.exception(
            "accept-route failed request_id_hint=%s exception_type=%s",
            _request_id_from_context(raw_payload) if isinstance(raw_payload, dict) else "unknown",
            exc.__class__.__name__,
        )
        return error(
            code="accept_route_failed",
            message="Failed to process accept-route request",
            status=500,
            errors=[{"field": "accept_route", "message": "Internal route processing failure"}],
        )
