"""
API contract tests for validation, lifecycle, and route acceptance behavior.
"""
from queue import Queue
from threading import Thread

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


def _reset():
    store.reset_demo()


def test_create_listing_requires_address():
    _reset()
    client = _client()
    resp = client.post(
        "/api/listings",
        json={
            "materials": [{"type": "cardboard", "lbs": 10}],
            "household_name": "No Address",
        },
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["error"] == "validation_error"
    assert body["code"] == "validation_error"
    assert "details" in body
    assert any(e["field"] == "address" for e in body["errors"])


def test_create_listing_requires_household_name():
    _reset()
    client = _client()
    resp = client.post(
        "/api/listings",
        json={
            "address": "No Name Blvd",
            "materials": [{"type": "cardboard", "lbs": 4}],
        },
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["code"] == "validation_error"
    assert any(e["field"] == "household_name" for e in body["details"])


def test_create_listing_aggregates_duplicate_material_types():
    _reset()
    client = _client()
    resp = client.post(
        "/api/listings",
        json={
            "address": "10 Test Ave",
            "household_name": "Normalizer",
            "materials": [
                {"type": "cardboard", "lbs": 1.25},
                {"type": "cardboard", "lbs": 2.75},
                {"type": "aluminum_cans", "lbs": 2.0},
            ],
        },
    )
    assert resp.status_code == 201
    listing = resp.get_json()["listing"]
    mats = {m["type"]: m["lbs"] for m in listing["materials"]}
    assert mats["cardboard"] == 4.0
    assert mats["aluminum_cans"] == 2.0


def test_get_listings_rejects_invalid_status():
    _reset()
    client = _client()
    resp = client.get("/api/listings?status=paused")
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["error"] == "validation_error"


def test_classify_rejects_invalid_base64():
    client = _client()
    resp = client.post("/api/classify", json={"image_base64": "not_base64"})
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["code"] == "validation_error"
    assert any(e["field"] == "image_base64" for e in body["details"])


def test_optimize_rejects_invalid_objective():
    _reset()
    client = _client()
    resp = client.post(
        "/api/optimize-route",
        json={
            "lat": 37.35,
            "lng": -121.95,
            "max_minutes": 60,
            "truck_capacity_lbs": 500,
            "objective": "speedrun",
        },
    )
    assert resp.status_code == 422
    body = resp.get_json()
    assert body["error"] == "validation_error"
    assert any(e["field"] == "objective" for e in body["errors"])


def test_accept_route_is_idempotent_for_duplicate_and_claimed_stops():
    _reset()
    client = _client()
    available = client.get("/api/listings?status=available").get_json()["listings"]
    first_id = available[0]["id"]
    second_id = available[1]["id"]

    resp = client.post(
        "/api/accept-route",
        json={
            "driver_name": "Driver A",
            "stops": [
                {"listing_id": first_id, "eta_minutes": 20},
                {"listing_id": first_id, "eta_minutes": 21},  # duplicate in same payload
                {"listing_id": "missing_id", "eta_minutes": 22},
                {"listing_id": second_id, "eta_minutes": 23},
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["claimed_count"] == 2
    assert body["skipped_count"] == 2
    assert "request_id" in body
    assert all("status_code" in n and "retryable" in n and "attempts" in n for n in body["notifications"])
    reasons = [n["notification"].get("reason") for n in body["notifications"] if n["notification"]["mode"] == "skipped"]
    assert "duplicate_stop" in reasons
    assert "not_found" in reasons

    second_resp = client.post(
        "/api/accept-route",
        json={"driver_name": "Driver B", "stops": [{"listing_id": first_id, "eta_minutes": 30}]},
    )
    second_body = second_resp.get_json()
    assert second_body["claimed_count"] == 0
    assert second_body["skipped_count"] == 1
    assert second_body["notifications"][0]["status_code"] == "already_claimed"
    assert second_body["notifications"][0]["retryable"] is False
    assert second_body["notifications"][0]["notification"]["reason"] == "already_claimed"


def test_accept_route_respects_external_correlation_id():
    _reset()
    client = _client()
    target_id = client.get("/api/listings?status=available").get_json()["listings"][0]["id"]
    resp = client.post(
        "/api/accept-route",
        json={"driver_name": "Corr Driver", "stops": [{"listing_id": target_id, "eta_minutes": 12}]},
        headers={"X-Request-ID": "demo-correlation-123"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["request_id"] == "demo-correlation-123"


def test_accept_route_prevents_double_claim_under_concurrency():
    _reset()
    listing_id = _client().get("/api/listings?status=available").get_json()["listings"][0]["id"]
    queue = Queue()

    def worker(driver_name: str):
        c = _client()
        r = c.post(
            "/api/accept-route",
            json={"driver_name": driver_name, "stops": [{"listing_id": listing_id, "eta_minutes": 5}]},
        )
        queue.put(r.get_json())

    t1 = Thread(target=worker, args=("D1",))
    t2 = Thread(target=worker, args=("D2",))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    first = queue.get()
    second = queue.get()
    claimed = sorted([first["claimed_count"], second["claimed_count"]])
    assert claimed == [0, 1]
    all_statuses = [n["status_code"] for body in (first, second) for n in body["notifications"]]
    assert "already_claimed" in all_statuses


def test_complete_listing_returns_conflict_if_already_completed():
    _reset()
    client = _client()
    created = client.post(
        "/api/listings",
        json={
            "address": "200 Completion Way",
            "household_name": "Lifecycle Test",
            "materials": [{"type": "cardboard", "lbs": 5}],
        },
    ).get_json()["listing"]
    lid = created["id"]

    first = client.post(f"/api/listings/{lid}/complete")
    assert first.status_code == 200
    second = client.post(f"/api/listings/{lid}/complete")
    assert second.status_code == 409
    assert second.get_json()["error"] == "status_conflict"


def test_health_reports_status_counts():
    _reset()
    client = _client()
    available = client.get("/api/listings?status=available").get_json()["listings"]
    target_id = available[0]["id"]
    client.post("/api/accept-route", json={"driver_name": "Driver C", "stops": [{"listing_id": target_id, "eta_minutes": 10}]})
    client.post(f"/api/listings/{target_id}/complete")

    health = client.get("/api/health")
    assert health.status_code == 200
    body = health.get_json()
    assert body["status"] == "ok"
    assert "status_counts" in body
    assert body["status_counts"]["completed"] >= 1
    impact = client.get("/api/impact").get_json()
    assert "status_counts" in impact


def test_materials_endpoint_returns_rate_catalog():
    client = _client()
    resp = client.get("/api/materials")
    assert resp.status_code == 200
    body = resp.get_json()
    assert "cardboard" in body
    assert "rate" in body["cardboard"]


def test_reset_demo_restores_seeded_inventory_after_mutation():
    _reset()
    client = _client()
    baseline = client.get("/api/health").get_json()["total_listings"]

    client.post(
        "/api/listings",
        json={
            "address": "999 Temp Listing Lane",
            "household_name": "Temp Listing",
            "materials": [{"type": "cardboard", "lbs": 11}],
        },
    )
    mutated = client.get("/api/health").get_json()["total_listings"]
    assert mutated == baseline + 1

    reset_resp = client.post("/api/listings/reset-demo")
    assert reset_resp.status_code == 200
    after_reset = client.get("/api/health").get_json()["total_listings"]
    assert after_reset == baseline
