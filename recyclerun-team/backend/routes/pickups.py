"""
Pickup job completion and receipt retrieval endpoints.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.services.media import media_service
from backend.services.store import store
from backend.services.validation import validate_pickup_completion_payload
from backend.utils.http import error


pickups_bp = Blueprint("pickups", __name__, url_prefix="/api")


@pickups_bp.post("/pickups/<pickup_id>/complete")
def complete_pickup(pickup_id: str):
    payload, errors = validate_pickup_completion_payload(request.get_json(silent=True))
    if errors:
        return error(
            code="validation_error",
            message="Invalid pickup completion payload",
            status=400,
            errors=errors,
        )

    job = store.get_pickup_job(pickup_id)
    if job is None:
        return error(
            code="not_found",
            message="Pickup job not found",
            status=404,
            errors=[{"field": "pickup_id", "message": "No pickup job exists for this id"}],
        )

    receipt = store.complete_pickup_job(
        pickup_id,
        actual_materials=payload["actual_materials"],
        actual_total_lbs=payload["actual_total_lbs"],
        contamination_flags=payload["contamination_flags"],
        completion_media_id=payload["completion_media_id"],
        completed_at=payload["completed_at"],
        driver_lat=payload["driver_lat"],
        driver_lng=payload["driver_lng"],
    )
    if receipt is None:
        return error(
            code="completion_failed",
            message="Pickup job could not be completed",
            status=500,
            errors=[{"field": "pickup_id", "message": "Receipt generation failed"}],
        )

    updated_job = store.get_pickup_job(pickup_id)
    enriched_receipt = media_service.enrich_receipt(receipt, store=store, request_root=request.url_root)
    return jsonify({"success": True, "pickup_job": updated_job, "receipt": enriched_receipt})


@pickups_bp.get("/receipts/<receipt_id>")
def get_receipt(receipt_id: str):
    receipt = store.get_receipt(receipt_id)
    if receipt is None:
        return error(
            code="not_found",
            message="Receipt not found",
            status=404,
            errors=[{"field": "receipt_id", "message": "No receipt exists for this id"}],
        )
    enriched_receipt = media_service.enrich_receipt(receipt, store=store, request_root=request.url_root)
    return jsonify({"success": True, "receipt": enriched_receipt})
