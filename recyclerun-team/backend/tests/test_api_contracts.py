"""
API contract tests for validation, lifecycle, and route acceptance behavior.
"""
from queue import Queue
from threading import Thread

from flask import Flask
import pytest

from backend.routes import (
    listings_bp,
    classify_bp,
    optimize_bp,
    impact_bp,
    live_vision_bp,
    pickups_bp,
    orgs_bp,
    media_bp,
)
import backend.routes.classify as classify_module
import backend.routes.optimize as optimize_module
import backend.routes.live_vision as live_vision_module
from backend.services.store import store


def _client():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(listings_bp)
    app.register_blueprint(classify_bp)
    app.register_blueprint(optimize_bp)
    app.register_blueprint(impact_bp)
    app.register_blueprint(live_vision_bp)
    app.register_blueprint(pickups_bp)
    app.register_blueprint(orgs_bp)
    app.register_blueprint(media_bp)
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
    assert [m["lbs"] for m in listing["materials"]] == [1.2, 2.8, 2.0]
    assert "geocode" in listing
    assert listing["geocode"]["success"] is False


def test_create_listing_persists_estimate_metadata():
    _reset()
    client = _client()
    resp = client.post(
        "/api/listings",
        json={
            "address": "10 Estimate Ave",
            "household_name": "Estimate Household",
            "capture_mode": "live_ai",
            "source_session_id": "session_demo_123",
            "materials": [{"type": "cardboard", "lbs": 10.0}],
            "estimated_materials": [
                {
                    "type": "cardboard",
                    "lbs": 12.5,
                    "count": 2,
                    "confidence": 0.86,
                    "weight_confidence": 0.73,
                    "weight_low": 10.8,
                    "weight_high": 14.2,
                    "provenance": "live_ai_native",
                    "candidate_id": "track_12:1",
                }
            ],
            "estimated_total_lbs": 12.5,
            "estimated_confidence": 0.82,
        },
    )
    assert resp.status_code == 201
    listing = resp.get_json()["listing"]
    assert listing["capture_mode"] == "live_ai"
    assert listing["source_session_id"] == "session_demo_123"
    assert listing["estimated_total_lbs"] == 12.5
    assert listing["estimated_confidence"] == 0.82
    assert listing["estimated_materials"][0]["lbs"] == 12.5
    assert listing["estimated_materials"][0]["count"] == 2
    assert listing["estimated_materials"][0]["confidence"] == 0.86
    assert listing["estimated_materials"][0]["candidate_id"] == "track_12:1"


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


def test_optimize_rejects_invalid_priority_listing_ids_shape():
    _reset()
    client = _client()
    resp = client.post(
        "/api/optimize-route",
        json={
            "lat": 37.35,
            "lng": -121.95,
            "max_minutes": 60,
            "truck_capacity_lbs": 500,
            "objective": "value",
            "priority_listing_ids": "listing_abc",
        },
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["code"] == "validation_error"
    assert any(e["field"] == "priority_listing_ids" for e in body["details"])


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


def test_accept_route_claimed_notifications_include_pickup_job_id(monkeypatch):
    _reset()
    client = _client()
    target_id = client.get("/api/listings?status=available").get_json()["listings"][0]["id"]
    monkeypatch.setattr(
        optimize_module.notifier,
        "notify",
        lambda **kwargs: {"success": True, "mode": "demo", "message": "accepted", "reason": "test"},
    )

    resp = client.post(
        "/api/accept-route",
        json={"driver_name": "Receipt Driver", "stops": [{"listing_id": target_id, "eta_minutes": 15}]},
    )
    assert resp.status_code == 200
    notification = resp.get_json()["notifications"][0]
    assert notification["status_code"] == "claimed_notified"
    assert notification["pickup_job_id"].startswith("pickup_")


def test_pickup_completion_receipt_and_org_dashboard_contract(monkeypatch):
    _reset()
    client = _client()
    target_id = client.get("/api/listings?status=available").get_json()["listings"][0]["id"]
    monkeypatch.setattr(
        optimize_module.notifier,
        "notify",
        lambda **kwargs: {"success": True, "mode": "demo", "message": "accepted", "reason": "test"},
    )

    accept_resp = client.post(
        "/api/accept-route",
        json={"driver_name": "Receipt Driver", "stops": [{"listing_id": target_id, "eta_minutes": 15}]},
    )
    assert accept_resp.status_code == 200
    pickup_job_id = accept_resp.get_json()["notifications"][0]["pickup_job_id"]

    complete_resp = client.post(
        f"/api/pickups/{pickup_job_id}/complete",
        json={
            "actual_materials": [{"type": "cardboard", "lbs": 11.0}],
            "actual_total_lbs": 11.0,
            "completion_media_id": "demo-proof-1",
            "contamination_flags": [],
            "driver_lat": 37.35,
            "driver_lng": -121.95,
        },
    )
    assert complete_resp.status_code == 200
    complete_body = complete_resp.get_json()
    receipt = complete_body["receipt"]
    assert complete_body["pickup_job"]["status"] == "completed"
    assert receipt["pickup_job_id"] == pickup_job_id
    assert receipt["completion_media_id"] == "demo-proof-1"
    assert receipt["actual_total_lbs"] == 11.0
    assert isinstance(receipt["actual_materials"], list)
    assert receipt["receipt_id"].startswith("receipt_")

    get_receipt_resp = client.get(f"/api/receipts/{receipt['receipt_id']}")
    assert get_receipt_resp.status_code == 200
    assert get_receipt_resp.get_json()["receipt"]["receipt_id"] == receipt["receipt_id"]

    dashboard_resp = client.get("/api/orgs/org_santa_clara_demo/dashboard?window=30d")
    assert dashboard_resp.status_code == 200
    dashboard = dashboard_resp.get_json()
    assert dashboard["success"] is True
    assert dashboard["summary"]["completed_pickups"] >= 1
    assert dashboard["latest_receipts"][0]["receipt_id"] == receipt["receipt_id"]


def test_org_dashboard_invalid_window_returns_structured_error():
    _reset()
    client = _client()
    resp = client.get("/api/orgs/org_santa_clara_demo/dashboard?window=forever")
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["code"] == "validation_error"
    assert any(item["field"] == "window" for item in body["details"])


def test_org_dashboard_csv_export_returns_csv(monkeypatch):
    _reset()
    client = _client()
    target_id = client.get("/api/listings?status=available").get_json()["listings"][0]["id"]
    monkeypatch.setattr(
        optimize_module.notifier,
        "notify",
        lambda **kwargs: {"success": True, "mode": "demo", "message": "accepted", "reason": "test"},
    )
    accept_resp = client.post(
        "/api/accept-route",
        json={"driver_name": "CSV Driver", "stops": [{"listing_id": target_id, "eta_minutes": 12}]},
    )
    pickup_job_id = accept_resp.get_json()["notifications"][0]["pickup_job_id"]
    client.post(
        f"/api/pickups/{pickup_job_id}/complete",
        json={
            "actual_materials": [{"type": "cardboard", "lbs": 7.0}],
            "actual_total_lbs": 7.0,
            "completion_media_id": "csv-proof-1",
            "contamination_flags": [],
            "driver_lat": 37.35,
            "driver_lng": -121.95,
        },
    )

    resp = client.get("/api/orgs/org_santa_clara_demo/dashboard?window=30d&format=csv")
    assert resp.status_code == 200
    assert resp.mimetype == "text/csv"
    csv_body = resp.get_data(as_text=True)
    assert "receipt_id,pickup_job_id,listing_id" in csv_body
    assert pickup_job_id in csv_body


def test_media_upload_and_signed_fetch_contract():
    _reset()
    client = _client()
    upload_resp = client.post(
        "/api/media/upload",
        json={
            "image_base64": "aGVsbG8=",
            "mime_type": "image/jpeg",
            "file_name": "proof.jpg",
            "purpose": "pickup_proof",
        },
    )
    assert upload_resp.status_code == 201
    media_asset = upload_resp.get_json()["media_asset"]
    assert media_asset["media_id"].startswith("media_")
    assert media_asset["signed_url"].startswith("http://localhost")
    assert media_asset["signed_path"].startswith("/api/media/")

    signed_path = media_asset["signed_path"]
    fetch_resp = client.get(signed_path)
    assert fetch_resp.status_code == 200
    assert fetch_resp.mimetype == "image/jpeg"
    assert fetch_resp.get_data() == b"hello"


def test_receipt_includes_signed_completion_media(monkeypatch):
    _reset()
    client = _client()
    target_id = client.get("/api/listings?status=available").get_json()["listings"][0]["id"]
    monkeypatch.setattr(
        optimize_module.notifier,
        "notify",
        lambda **kwargs: {"success": True, "mode": "demo", "message": "accepted", "reason": "test"},
    )
    upload_resp = client.post(
        "/api/media/upload",
        json={
            "image_base64": "aGVsbG8=",
            "mime_type": "image/jpeg",
            "file_name": "proof.jpg",
            "purpose": "pickup_proof",
        },
    )
    media_id = upload_resp.get_json()["media_asset"]["media_id"]
    accept_resp = client.post(
        "/api/accept-route",
        json={"driver_name": "Proof Driver", "stops": [{"listing_id": target_id, "eta_minutes": 15}]},
    )
    pickup_job_id = accept_resp.get_json()["notifications"][0]["pickup_job_id"]
    complete_resp = client.post(
        f"/api/pickups/{pickup_job_id}/complete",
        json={
            "actual_materials": [{"type": "cardboard", "lbs": 6.0}],
            "actual_total_lbs": 6.0,
            "completion_media_id": media_id,
            "contamination_flags": [],
        },
    )
    assert complete_resp.status_code == 200
    receipt = complete_resp.get_json()["receipt"]
    assert receipt["completion_media_id"] == media_id
    assert receipt["completion_media"]["media_id"] == media_id
    assert receipt["completion_media"]["signed_url"].startswith("http://localhost")


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


def test_live_vision_session_start_and_frame_success_schema(monkeypatch):
    client = _client()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    live_vision_module.live_service._sessions.clear()

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": '{"materials":[{"type":"cardboard","lbs":2.2,"confidence":0.9,"provenance":"frame"}],"notes":"bin"}'
                                }
                            ]
                        }
                    }
                ]
            }

    monkeypatch.setattr(live_vision_module.live_service, "_invoke_model", lambda **kwargs: _Resp())
    start = client.post("/api/live-vision/session/start", json={})
    assert start.status_code == 201
    session_id = start.get_json()["session_id"]

    frame = client.post(
        f"/api/live-vision/session/{session_id}/frame",
        json={"frame_base64": "aGVsbG8=", "mime_type": "image/jpeg"},
    )
    assert frame.status_code == 200
    body = frame.get_json()
    assert body["success"] is True
    assert body["source"] == "gemini_live"
    assert body["session_id"] == session_id
    assert isinstance(body["frame_seq"], int)
    assert isinstance(body["materials"], list)
    assert isinstance(body["total_lbs"], (int, float))
    assert isinstance(body["total_value"], (int, float))
    assert isinstance(body["notes"], str)
    assert isinstance(body["stable"], bool)
    assert isinstance(body["latency_ms"], int)


def test_live_vision_missing_api_key_starts_demo_mode(monkeypatch):
    client = _client()
    live_vision_module.live_service._sessions.clear()
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    start = client.post("/api/live-vision/session/start", json={"force_demo": False})
    body = start.get_json()

    assert start.status_code == 201
    assert body["success"] is True
    assert body["source_mode"] == "gemini_live_demo"
    assert body["reason"] in {"gemini_api_key_missing", "forced_demo_mode"}


def test_live_vision_token_contract_shape(monkeypatch):
    client = _client()
    _reset()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(
        live_vision_module.token_service,
        "_request_token",
        lambda **kwargs: {
            "name": "ephemeral-token-xyz",
        },
    )

    resp = client.post(
        "/api/live-vision/token",
        json={
            "profile_id": "profile_demo_1",
            "platform": "ios",
            "device_tier": "mid",
            "network_type": "wifi",
        },
    )

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["success"] is True
    assert body["provider"] == "gemini_live"
    assert body["direct_available"] is True
    assert body["token"] == "ephemeral-token-xyz"
    assert body["token_expires_at"]
    assert body["new_session_expires_at"]
    assert body["telemetry_session_id"].startswith("lvs_")
    assert body["source_session_id"] == body["telemetry_session_id"]
    assert body["response_modality"] == "TEXT"
    assert body["legacy_fallback_available"] is True
    assert isinstance(body["session_policy"], dict)
    assert body["setup"]["model"].startswith("models/")
    assert body["transport_version"] == "native_candidate_stream_v1"
    assert body["supports_session_resumption"] is True
    assert isinstance(body["candidate_video_policy"], dict)
    assert "direct_native_live" in body["fallback_order"]


def test_live_vision_force_legacy_token_response_shape():
    client = _client()
    _reset()
    resp = client.post("/api/live-vision/token", json={"force_legacy": True, "platform": "android"})
    body = resp.get_json()

    assert resp.status_code == 200
    assert body["success"] is True
    assert body["provider"] == "legacy_http_poll"
    assert body["direct_available"] is False
    assert body["legacy_fallback_available"] is True
    assert body["telemetry_session_id"].startswith("lvs_")
    assert body["fallback_reason"] == "forced_legacy_transport"
    assert body["transport_version"] == "native_candidate_stream_v1"
    assert body["supports_session_resumption"] is False
    assert body["fallback_order"] == ["legacy_http_poll", "manual_entry"]


def test_live_vision_telemetry_batch_and_session_end_contract():
    client = _client()
    _reset()
    token = client.post("/api/live-vision/token", json={"force_legacy": True})
    session_id = token.get_json()["telemetry_session_id"]

    telemetry = client.post(
        "/api/live-vision/telemetry/batch",
        json={
            "telemetry_session_id": session_id,
            "events": [
                {
                    "event_id": "evt_1",
                    "event_type": "session_started",
                    "ts_ms": 1700000000000,
                    "platform": "ios",
                    "device_tier": "mid",
                    "network_type": "wifi",
                    "transport_mode": "direct_native_live",
                    "preview_fps_p50": 28.0,
                    "preview_fps_p95": 20.0,
                    "details": {"mode": "legacy_http_poll"},
                }
            ],
            "summary": {"transport_mode": "direct_native_live"},
        },
    )
    assert telemetry.status_code == 202
    telemetry_body = telemetry.get_json()
    assert telemetry_body["success"] is True
    assert telemetry_body["accepted"] == 1
    assert telemetry_body["telemetry_session_id"] == session_id

    end = client.post(
        "/api/live-vision/session/end",
        json={
            "telemetry_session_id": session_id,
            "source_session_id": session_id,
            "duration_ms": 2400,
            "confirmed_count": 2,
            "skipped_count": 1,
            "fallback_mode": "legacy_http_poll",
            "transport_mode": "direct_native_live",
            "metrics": {"preview_fps_p50": 28.0},
        },
    )
    assert end.status_code == 200
    end_body = end.get_json()
    assert end_body["success"] is True
    assert end_body["session"]["status"] == "closed"
    assert end_body["session"]["confirmed_count"] == 2
    assert end_body["session"]["fallback_mode"] == "legacy_http_poll"


def test_live_vision_frame_invalid_payload_is_structured_error():
    client = _client()
    live_vision_module.live_service._sessions.clear()
    start = client.post("/api/live-vision/session/start", json={})
    session_id = start.get_json()["session_id"]
    resp = client.post(
        f"/api/live-vision/session/{session_id}/frame",
        json={"frame_base64": "not-base64", "mime_type": "image/gif"},
    )
    body = resp.get_json()

    assert resp.status_code == 400
    _assert_structured_error_envelope(body)
    assert body["code"] == "validation_error"
    fields = {d["field"] for d in body.get("details", [])}
    assert {"frame_base64", "mime_type"}.issubset(fields)


def test_live_vision_known_malformed_requests_never_return_500():
    client = _client()
    live_vision_module.live_service._sessions.clear()
    bad_start = client.post("/api/live-vision/session/start", json="bad")
    assert bad_start.status_code != 500
    _assert_structured_error_envelope(bad_start.get_json())

    bad_frame = client.post("/api/live-vision/session/missing_session/frame", json={"frame_base64": "aGVsbG8="})
    assert bad_frame.status_code != 500
    _assert_structured_error_envelope(bad_frame.get_json())

    bad_health = client.get("/api/live-vision/session/missing_session/health")
    assert bad_health.status_code != 500
    _assert_structured_error_envelope(bad_health.get_json())

    bad_token = client.post("/api/live-vision/token", json="bad")
    assert bad_token.status_code != 500
    _assert_structured_error_envelope(bad_token.get_json())

    bad_telemetry = client.post("/api/live-vision/telemetry/batch", json={"events": "bad"})
    assert bad_telemetry.status_code != 500
    _assert_structured_error_envelope(bad_telemetry.get_json())

    bad_end = client.post("/api/live-vision/session/end", json={"confirmed_count": -1})
    assert bad_end.status_code != 500
    _assert_structured_error_envelope(bad_end.get_json())
