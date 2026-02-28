"""
Impact stats endpoint.
Owner: Atharva
"""
from flask import Blueprint, jsonify
from backend.services.store import store

impact_bp = Blueprint("impact", __name__, url_prefix="/api")

@impact_bp.get("/impact")
def get_impact():
    return jsonify(store.impact_stats())

@impact_bp.get("/health")
def health():
    return jsonify(store.health_stats())

@impact_bp.get("/materials")
def get_materials():
    from backend.models.material import MATERIAL_RATES
    return jsonify(MATERIAL_RATES)
