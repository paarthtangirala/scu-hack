"""
API contract tests for validation, lifecycle, and route acceptance behavior.
"""
from queue import Queue
from threading import Thread

from flask import Flask
import pytest

from backend.routes import listings_bp, classify_bp, optimize_bp, impact_bp
import backend.routes.classify as classify_module
import backend.routes.optimize as optimize_module
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


def _assert_structured_error_envelope(body: dict):
    assert body["success"] is False
    assert isinstance(body.get("error"), str)
    assert isinstance(body.get("code"), str)
    assert isinstance(body.get("message"), str)
    if "errors" in body:
        assert isinstance(body["errors"], list)
    if "details" in body:
        assert isinstance(body["details"], list)


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


def test_create_listing_preserves_valid_material_payload_unchanged():
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
    assert [m["type"] for m in listing["materials"]] == ["cardboard", "cardboard", "aluminum_cans"]
    assert [m["lbs"] for m in listing["materials"]] == [1.25, 2.75, 2.0]


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


def test_classify_malformed_amd_output_falls_back_to_demo(monkeypatch):
    client = _client()
    monkeypatch.delenv("ENABLE_CLAUDE_FALLBACK", raising=False)
    monkeypatch.setattr(
        classify_module.classifier,
        "_try_amd",
        lambda b64: classify_module.classifier._parse("model said hello {bad json}", source="amd"),
    )

    resp = client.post("/api/classify", json={"image_base64": "aGVsbG8="})

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["source"] == "demo"
    assert isinstance(body["materials"], list)


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
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["code"] == "validation_error"
    assert any(e["field"] == "objective" for e in body["details"])


@pytest.mark.parametrize(
    ("kwargs", "expected_field"),
    [
        ({"json": []}, "body"),
        ({"json": "not-an-object"}, "body"),
        ({"json": 42}, "body"),
        ({"data": "raw_text", "content_type": "text/plain"}, "body"),
    ],
)
def test_optimize_non_object_body_returns_structured_validation_error(kwargs, expected_field):
    client = _client()
    resp = client.post("/api/optimize-route", **kwargs)
    body = resp.get_json()

    assert resp.status_code == 400
    assert resp.status_code != 500
    _assert_structured_error_envelope(body)
    assert body["code"] == "validation_error"
    assert any(d["field"] == expected_field for d in body.get("details", []))


def test_optimize_malformed_types_and_ranges_returns_structured_details():
    client = _client()
    resp = client.post(
        "/api/optimize-route",
        json={
            "lat": "north",
            "lng": 999,
            "max_minutes": 0,
            "truck_capacity_lbs": "big",
            "objective": "fastest",
        },
    )
    body = resp.get_json()

    assert resp.status_code == 400
    assert resp.status_code != 500
    _assert_structured_error_envelope(body)
    assert body["code"] == "validation_error"
    fields = {d["field"] for d in body.get("details", [])}
    assert {"lat", "lng", "max_minutes", "truck_capacity_lbs", "objective"}.issubset(fields)


@pytest.mark.parametrize(
    "payload,expected_field",
    [
        ({"driver_name": "Driver", "stops": "invalid"}, "stops"),
        ({"driver_name": "Driver", "stops": [{"eta_minutes": 15}]}, "stops[0].listing_id"),
        ({"driver_name": "Driver", "stops": [{"listing_id": "abc", "eta_minutes": "soon"}]}, "stops[0].eta_minutes"),
    ],
)
def test_accept_route_malformed_stops_payload_returns_structured_validation_error(payload, expected_field):
    client = _client()
    resp = client.post("/api/accept-route", json=payload)
    body = resp.get_json()

    assert resp.status_code == 400
    assert resp.status_code != 500
    _assert_structured_error_envelope(body)
    assert body["code"] == "validation_error"
    assert any(d["field"] == expected_field for d in body.get("details", []))


@pytest.mark.parametrize(
    ("endpoint", "kwargs"),
    [
        ("/api/optimize-route", {"json": []}),
        ("/api/optimize-route", {"json": {"lat": "bad", "lng": -121.9, "max_minutes": 60, "truck_capacity_lbs": 500, "objective": "value"}}),
        ("/api/accept-route", {"json": {"driver_name": "D", "stops": [{"eta_minutes": 5}]}}),
        ("/api/classify", {"json": {}}),
    ],
)
def test_known_malformed_payloads_never_return_500(endpoint, kwargs):
    client = _client()
    resp = client.post(endpoint, **kwargs)
    body = resp.get_json()

    assert resp.status_code != 500
    _assert_structured_error_envelope(body)


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
    assert body["idempotent_replay"] is False


def test_accept_route_replay_with_same_request_id_is_side_effect_free(monkeypatch):
    _reset()
    client = _client()
    target_id = client.get("/api/listings?status=available").get_json()["listings"][0]["id"]
    calls = {"count": 0}

    def _fake_notify(**kwargs):
        calls["count"] += 1
        return {"success": True, "mode": "live", "call_sid": "CA_REPLAY_1"}

    monkeypatch.setattr(optimize_module.notifier, "notify", _fake_notify)

    payload = {
        "request_id": "stable-request-77",
        "driver_name": "Replay Driver",
        "stops": [{"listing_id": target_id, "eta_minutes": 12}],
    }

    first = client.post("/api/accept-route", json=payload, headers={"X-Request-ID": "stable-request-77"})
    second = client.post("/api/accept-route", json=payload, headers={"X-Request-ID": "stable-request-77"})
    assert first.status_code == 200
    assert second.status_code == 200
    body1 = first.get_json()
    body2 = second.get_json()

    assert body1["request_id"] == "stable-request-77"
    assert body2["request_id"] == "stable-request-77"
    assert body1["idempotent_replay"] is False
    assert body2["idempotent_replay"] is True
    assert body1["claimed_count"] == body2["claimed_count"] == 1
    assert body1["notifications_sent"] == body2["notifications_sent"] == 1
    assert body1["notifications_failed"] == body2["notifications_failed"] == 0
    assert body1["notifications"] == body2["notifications"]
    assert calls["count"] == 1


def test_accept_route_notification_envelope_mode_accuracy_and_retry_signal(monkeypatch):
    _reset()
    client = _client()
    available = client.get("/api/listings?status=available").get_json()["listings"]
    first_id = available[0]["id"]
    second_id = available[1]["id"]

    responses = [
        {"success": True, "mode": "live", "call_sid": "CA_MODE_1"},
        {"success": False, "mode": "failed", "error": "try again", "reason": "twilio_exception"},
        {"success": True, "mode": "demo", "message": "retry demo", "reason": "forced_demo_mode"},
    ]

    def _fake_notify(**kwargs):
        return responses.pop(0)

    monkeypatch.setattr(optimize_module.notifier, "notify", _fake_notify)

    resp = client.post(
        "/api/accept-route",
        json={
            "driver_name": "Mode Driver",
            "stops": [
                {"listing_id": first_id, "eta_minutes": 10},
                {"listing_id": second_id, "eta_minutes": 14},
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.get_json()
    first = body["notifications"][0]
    second = body["notifications"][1]

    for entry in body["notifications"]:
        assert all(k in entry for k in ("listing_id", "status_code", "retryable", "attempts", "notification", "success"))

    assert first["notification"]["mode"] == "live"
    assert first["attempts"] == 1
    assert "retry_attempt" not in first["notification"]
    assert first["status_code"] == "claimed_notified"

    assert second["notification"]["mode"] == "demo"
    assert second["attempts"] == 2
    assert second["notification"]["retry_attempt"] == 2
    assert second["status_code"] == "claimed_notified"
    assert second["notification"]["reason"] == "forced_demo_mode"


def test_accept_route_notifications_sent_counts_demo_and_live_not_failed(monkeypatch):
    _reset()
    client = _client()
    available = client.get("/api/listings?status=available").get_json()["listings"]
    first_id = available[0]["id"]
    second_id = available[1]["id"]
    third_id = available[2]["id"]
    call_count = {"value": 0}

    def _fake_notify(**kwargs):
        call_count["value"] += 1
        if call_count["value"] == 1:
            return {"success": True, "mode": "live", "call_sid": "CA_COUNT_1"}
        if call_count["value"] == 2:
            return {"success": True, "mode": "demo", "message": "demo success", "reason": "twilio_not_configured"}
        return {"success": False, "mode": "failed", "error": "twilio down", "reason": "twilio_exception"}

    monkeypatch.setattr(optimize_module.notifier, "notify", _fake_notify)

    resp = client.post(
        "/api/accept-route",
        json={
            "driver_name": "Count Driver",
            "stops": [
                {"listing_id": first_id, "eta_minutes": 10},
                {"listing_id": second_id, "eta_minutes": 11},
                {"listing_id": third_id, "eta_minutes": 12},
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.get_json()

    assert body["claimed_count"] == 3
    assert body["notifications_sent"] == 2
    assert body["notifications_failed"] == 1

    by_id = {entry["listing_id"]: entry for entry in body["notifications"]}
    assert by_id[first_id]["notification"]["mode"] == "live"
    assert by_id[second_id]["notification"]["mode"] == "demo"
    assert by_id[third_id]["notification"]["mode"] == "failed"
    assert by_id[third_id]["status_code"] == "notification_failed"
    assert by_id[third_id]["retryable"] is True
    assert by_id[third_id]["attempts"] == 2
    assert "retry_attempt" not in by_id[third_id]["notification"]


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


def test_claimed_listing_cannot_transition_back_to_available():
    _reset()
    client = _client()
    listing_id = client.get("/api/listings?status=available").get_json()["listings"][0]["id"]
    client.post(
        "/api/accept-route",
        json={"driver_name": "Lifecycle Guard", "stops": [{"listing_id": listing_id, "eta_minutes": 6}]},
    )
    with pytest.raises(ValueError):
        store.update_status(listing_id, "available")


def test_accept_route_notification_item_contract_and_eta_gap(monkeypatch):
    _reset()
    client = _client()
    available = client.get("/api/listings?status=available").get_json()["listings"]
    first_id = available[0]["id"]
    second_id = available[1]["id"]

    # Keep test deterministic and offline: no Twilio/ElevenLabs calls.
    monkeypatch.setattr(
        optimize_module.notifier,
        "notify",
        lambda **kwargs: {
            "success": True,
            "mode": "demo",
            "message": "offline contract test",
            "reason": "twilio_not_configured",
        },
    )

    first_resp = client.post(
        "/api/accept-route",
        json={
            "driver_name": "Driver Contract",
            "stops": [
                {"listing_id": first_id, "eta_minutes": 15},   # claimed
                {"listing_id": first_id, "eta_minutes": 16},   # duplicate_stop
                {"listing_id": "missing_id", "eta_minutes": 17},  # not_found
                {"listing_id": second_id, "eta_minutes": 18},  # claimed
            ],
        },
    )
    assert first_resp.status_code == 200
    first_body = first_resp.get_json()

    # Drive already_claimed branch (listing exists => household/phone included).
    second_resp = client.post(
        "/api/accept-route",
        json={"driver_name": "Driver Contract", "stops": [{"listing_id": first_id, "eta_minutes": 19}]},
    )
    assert second_resp.status_code == 200
    second_body = second_resp.get_json()

    # Move first listing to completed and verify already_completed skip path.
    complete_resp = client.post(f"/api/listings/{first_id}/complete")
    assert complete_resp.status_code == 200
    third_resp = client.post(
        "/api/accept-route",
        json={"driver_name": "Driver Contract", "stops": [{"listing_id": first_id, "eta_minutes": 20}]},
    )
    assert third_resp.status_code == 200
    third_body = third_resp.get_json()

    all_entries = (
        first_body["notifications"]
        + second_body["notifications"]
        + third_body["notifications"]
    )

    # Current contract common fields.
    for entry in all_entries:
        assert "listing_id" in entry
        assert "notification" in entry
        # Documented known delta: backend does not include eta_minutes in notification entries.
        assert "eta_minutes" not in entry

    skipped_entries = [n for n in all_entries if n["notification"]["mode"] == "skipped"]
    by_reason = {n["notification"]["reason"]: n for n in skipped_entries}
    assert set(by_reason.keys()) >= {"duplicate_stop", "not_found", "already_claimed", "already_completed"}

    # Heterogeneous shape currently emitted by backend route layer.
    assert "household" not in by_reason["duplicate_stop"]
    assert "phone" not in by_reason["duplicate_stop"]
    assert "household" not in by_reason["not_found"]
    assert "phone" not in by_reason["not_found"]
    assert "household" in by_reason["already_claimed"]
    assert "phone" in by_reason["already_claimed"]
    assert "household" in by_reason["already_completed"]
    assert "phone" in by_reason["already_completed"]


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


def test_reset_demo_restores_business_seed_listings():
    _reset()
    client = _client()
    listings = client.get("/api/listings?status=all").get_json()["listings"]
    business_count = len([l for l in listings if l.get("listing_kind") == "business"])
    assert business_count > 0
