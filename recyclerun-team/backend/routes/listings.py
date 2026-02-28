"""
Listings CRUD endpoints.
Owner: Atharva
"""
from flask import Blueprint, request, jsonify
from backend.models.listing import Listing
from backend.services.database import VALID_STATUSES
from backend.services.store import store
from backend.services.validation import validate_listing_payload
from backend.utils.http import error

listings_bp = Blueprint("listings", __name__, url_prefix="/api/listings")

@listings_bp.get("")
def get_listings():
    status = (request.args.get("status", "available") or "available").strip().lower()
    if status not in VALID_STATUSES and status != "all":
        return error(
            code="validation_error",
            message="Invalid query params",
            status=400,
            errors=[{"field": "status", "message": f"Must be one of: all, {', '.join(sorted(VALID_STATUSES))}"}],
        )

    listings = store.all(status)
    return jsonify({"success": True, "listings": [l.to_dict() for l in listings], "count": len(listings)})

@listings_bp.post("")
def create_listing():
    payload, errors = validate_listing_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid listing payload", status=400, errors=errors)

    listing = Listing(
        address=payload["address"],
        lat=payload["lat"],
        lng=payload["lng"],
        household_name=payload["household_name"],
        phone=payload["phone"],
        listing_kind=payload["listing_kind"],
        notes=payload["notes"],
        materials=payload["materials"],
    )
    store.add(listing)
    return jsonify({"success": True, "listing": listing.to_dict()}), 201

@listings_bp.post("/reset-demo")
def reset_demo():
    store.reset_demo()
    return jsonify({"success": True, "message": "Demo reset complete", "total_listings": len(store.all("all"))})

@listings_bp.post("/<listing_id>/complete")
def complete_listing(listing_id):
    listing = store.get(listing_id)
    if not listing:
        return error(
            code="not_found",
            message="Listing not found",
            status=404,
            errors=[{"field": "listing_id", "message": "No listing exists for this id"}],
        )
    if listing.status == "completed":
        return error(
            code="status_conflict",
            message="Listing is already completed",
            status=409,
            errors=[{"field": "status", "message": "Listing is already in completed state"}],
        )
    try:
        store.update_status(listing_id, "completed")
    except ValueError as exc:
        return error(
            code="status_conflict",
            message="Listing cannot transition to completed",
            status=409,
            errors=[{"field": "status", "message": str(exc)}],
        )
    return jsonify({"success": True, "listing": store.get(listing_id).to_dict()})
