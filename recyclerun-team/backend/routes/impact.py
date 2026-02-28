"""
Impact stats endpoint.
Owner: Atharva
"""
from flask import Blueprint, jsonify
from backend.services.database import ListingStore

impact_bp = Blueprint("impact", __name__, url_prefix="/api")
store = ListingStore()

@impact_bp.get("/impact")
def get_impact():
    return jsonify(store.impact_stats())

@impact_bp.get("/health")
def health():
    total = len(store.all("available")) + len(store.all("claimed")) + len(store.all("completed"))
    return jsonify({"status": "ok", "total_listings": total})

@impact_bp.get("/materials")
def get_materials():
    from backend.models.material import MATERIAL_RATES
    return jsonify(MATERIAL_RATES)
