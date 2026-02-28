"""
Listings CRUD endpoints.
Owner: Atharva
"""
from flask import Blueprint, request, jsonify
from backend.models.listing import Listing
from backend.models.material import Material
from backend.services.database import ListingStore

listings_bp = Blueprint("listings", __name__, url_prefix="/api/listings")
store = ListingStore()

@listings_bp.get("")
def get_listings():
    status = request.args.get("status", "available")
    return jsonify({"listings": [l.to_dict() for l in store.all(status)], "count": len(store.all(status))})

@listings_bp.post("")
def create_listing():
    data = request.json
    materials = [Material(type=m["type"], lbs=m["lbs"]) for m in data.get("materials", [])]
    listing = Listing(
        address=data["address"],
        lat=data.get("lat", 37.3541),
        lng=data.get("lng", -121.9552),
        household_name=data.get("household_name", "Anonymous"),
        phone=data.get("phone", ""),
        notes=data.get("notes", ""),
        materials=materials,
    )
    store.add(listing)
    return jsonify({"success": True, "listing": listing.to_dict()}), 201

@listings_bp.post("/reset-demo")
def reset_demo():
    store.reset_all()
    return jsonify({"success": True, "message": "Demo reset complete"})

@listings_bp.post("/<listing_id>/complete")
def complete_listing(listing_id):
    store.update_status(listing_id, "completed")
    return jsonify({"success": True})
