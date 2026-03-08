"""
Organization dashboard and export endpoints.
"""
from __future__ import annotations

import csv
import io

from flask import Blueprint, Response, jsonify, request

from backend.services.media import media_service
from backend.services.store import store
from backend.services.validation import validate_dashboard_window
from backend.utils.http import error


orgs_bp = Blueprint("orgs", __name__, url_prefix="/api/orgs")


def _dashboard_csv(payload: dict) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "receipt_id",
            "pickup_job_id",
            "listing_id",
            "household_name",
            "driver_name",
            "actual_total_lbs",
            "actual_total_value",
            "variance_lbs",
            "estimated_confidence",
            "contamination_flags",
            "completion_media_id",
            "completion_media_url",
            "completed_at",
        ]
    )
    for receipt in payload.get("all_receipts", payload.get("latest_receipts", [])):
        writer.writerow(
            [
                receipt.get("receipt_id", ""),
                receipt.get("pickup_job_id", ""),
                receipt.get("listing_id", ""),
                receipt.get("household_name", ""),
                receipt.get("driver_name", ""),
                receipt.get("actual_total_lbs", 0),
                receipt.get("actual_total_value", 0),
                receipt.get("variance_lbs", 0),
                receipt.get("estimated_confidence", 0),
                "|".join(receipt.get("contamination_flags", []) or []),
                receipt.get("completion_media_id", ""),
                (receipt.get("completion_media") or {}).get("signed_url", ""),
                receipt.get("completed_at", ""),
            ]
        )
    return buffer.getvalue()


@orgs_bp.get("/<org_id>/dashboard")
def get_org_dashboard(org_id: str):
    window, errors = validate_dashboard_window(request.args.get("window"))
    if errors:
        return error(code="validation_error", message="Invalid dashboard query params", status=400, errors=errors)

    try:
        payload = store.org_dashboard(org_id, window=window)
    except ValueError:
        return error(
            code="not_found",
            message="Organization not found",
            status=404,
            errors=[{"field": "org_id", "message": "No organization exists for this id"}],
        )

    payload["latest_receipts"] = [
        media_service.enrich_receipt(receipt, store=store, request_root=request.url_root)
        for receipt in payload.get("latest_receipts", [])
    ]
    payload["all_receipts"] = [
        media_service.enrich_receipt(receipt, store=store, request_root=request.url_root)
        for receipt in payload.get("all_receipts", [])
    ]

    output_format = (request.args.get("format") or "json").strip().lower()
    if output_format == "csv":
        csv_text = _dashboard_csv(payload)
        return Response(
            csv_text,
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={org_id}-{window}-dashboard.csv"},
        )
    return jsonify(payload)
