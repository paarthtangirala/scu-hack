"""
API regression tests for shared ListingStore consistency across blueprints.
"""
from flask import Flask

from backend.routes import listings_bp, classify_bp, optimize_bp, impact_bp
from backend.services.store import store


def _client():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(listings_bp)
    app.register_blueprint(classify_bp)
    app.register_blueprint(optimize_bp)
    app.register_blueprint(impact_bp)
    return app.test_client()


def _reset_demo():
    store.reset_demo()


def test_create_listing_is_visible_in_optimize_route():
    _reset_demo()
    client = _client()

    before = client.get("/api/listings?status=available").get_json()["count"]
    created = client.post(
        "/api/listings",
        json={
            "address": "999 Shared Store Ave, Santa Clara",
            "lat": 37.3541,
            "lng": -121.9552,
            "household_name": "Store Consistency Test",
            "phone": "+14085559999",
            "listing_kind": "household",
            "materials": [{"type": "copper_wire", "lbs": 50.0}],
            "notes": "High value near depot",
        },
    ).get_json()["listing"]
    after = client.get("/api/listings?status=available").get_json()["count"]

    assert after == before + 1

    optimized = client.post(
        "/api/optimize-route",
        json={
            "lat": 37.3541,
            "lng": -121.9552,
            "max_minutes": 90,
            "truck_capacity_lbs": 1000,
            "objective": "value",
        },
    ).get_json()

    optimized_ids = {s["listing_id"] for s in optimized["stops"]}
    assert created["id"] in optimized_ids


def test_complete_listing_updates_impact_stats():
    _reset_demo()
    client = _client()

    created = client.post(
        "/api/listings",
        json={
            "address": "321 Impact Sync Rd, Santa Clara",
            "lat": 37.355,
            "lng": -121.956,
            "household_name": "Impact Test",
            "phone": "+14085558888",
            "listing_kind": "household",
            "materials": [{"type": "cardboard", "lbs": 10.0}],
            "notes": "Impact stats route sync",
        },
    ).get_json()["listing"]

    complete_resp = client.post(f"/api/listings/{created['id']}/complete").get_json()
    assert complete_resp["success"] is True

    impact = client.get("/api/impact").get_json()
    assert impact["completed_pickups"] == 1
    assert impact["total_lbs_diverted"] == 10.0
