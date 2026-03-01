"""
Listings CRUD endpoints.
Owner: Atharva
"""
from flask import Blueprint, request, jsonify, current_app
from backend.models.listing import Listing
from backend.services.database import VALID_STATUSES
from backend.services.geocoding import AddressGeocoder
from backend.services.store import store
from backend.services.validation import validate_listing_payload
from backend.utils.http import error

listings_bp = Blueprint("listings", __name__, url_prefix="/api/listings")
geocoder = AddressGeocoder()

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

    resolved_lat = payload["lat"]
    resolved_lng = payload["lng"]
    geocode_meta = {"success": False, "provider": "none", "error": "Geocoding skipped in test mode"}

    # Contract tests use TESTING=True; skip external geocoder calls there.
    if not current_app.config.get("TESTING", False):
        geocode_result = geocoder.geocode(payload["address"])
        if geocode_result.get("success"):
            resolved_lat = float(geocode_result["lat"])
            resolved_lng = float(geocode_result["lng"])
            geocode_meta = {
                "success": True,
                "provider": geocode_result.get("provider", "unknown"),
                "formatted_address": geocode_result.get("formatted_address", payload["address"]),
            }
        else:
            geocode_meta = {
                "success": False,
                "provider": geocode_result.get("provider", "none"),
                "error": geocode_result.get("error", "Geocoding failed"),
            }

    listing = Listing(
        address=payload["address"],
        lat=resolved_lat,
        lng=resolved_lng,
        household_name=payload["household_name"],
        phone=payload["phone"],
        listing_kind=payload["listing_kind"],
        notes=payload["notes"],
        materials=payload["materials"],
    )
    store.add(listing)
    listing_payload = listing.to_dict()
    listing_payload["geocode"] = geocode_meta
    return jsonify({"success": True, "listing": listing_payload}), 201

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
