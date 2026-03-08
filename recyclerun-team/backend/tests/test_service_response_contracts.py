"""
Service-level response contract tests for frontend/backend interface safety.
All tests are deterministic and offline.
"""
from __future__ import annotations

import sys
import types

from backend.models.listing import Listing
from backend.models.material import Material
from backend.services.optimizer import RouteOptimizer
from backend.services.vision import VisionClassifier
from backend.services.voice import VoiceNotifier
from backend.services.gemini_live import GeminiLiveService
from backend.services.media import media_service
from backend.services.store import store
import backend.routes.optimize as optimize_route_module
import backend.services.optimizer as optimizer_module


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _make_listing(id_suffix: str, lat: float, lng: float, lbs: float = 5.0) -> Listing:
    listing = Listing(
        address=f"Contract Test {id_suffix}",
        lat=lat,
        lng=lng,
        household_name="Contract Household",
        phone="+14085559999",
        materials=[Material(type="aluminum_cans", lbs=lbs)],
    )
    listing.id = f"contract_{id_suffix}"
    return listing


def test_vision_demo_fallback_contract_shape(monkeypatch):
    classifier = VisionClassifier()
    monkeypatch.setattr(VisionClassifier, "_try_amd", lambda self, b64: None)
    monkeypatch.setattr(VisionClassifier, "_try_claude", lambda self, b64: None)
    monkeypatch.delenv("ENABLE_CLAUDE_FALLBACK", raising=False)

    result = classifier.classify("fake_b64")

    assert result["success"] is True
    assert result["source"] == "demo"
    assert isinstance(result["notes"], str)
    assert _is_number(result["total_value"])
    assert _is_number(result["total_lbs"])
    assert isinstance(result["materials"], list)
    assert len(result["materials"]) > 0

    required_material_keys = {"type", "label", "emoji", "lbs", "rate", "value", "confidence"}
    for item in result["materials"]:
        assert required_material_keys.issubset(item.keys())
        assert isinstance(item["type"], str)
        assert isinstance(item["label"], str)
        assert isinstance(item["emoji"], str)
        assert _is_number(item["lbs"])
        assert _is_number(item["rate"])
        assert _is_number(item["value"])
        assert _is_number(item["confidence"])


def test_vision_source_enum_demo_and_non_demo_simulated(monkeypatch):
    classifier = VisionClassifier()

    monkeypatch.setattr(
        VisionClassifier,
        "_try_amd",
        lambda self, b64: {
            "success": True,
            "source": "amd",
            "materials": [],
            "total_value": 0.0,
            "total_lbs": 0.0,
            "notes": "simulated",
        },
    )
    monkeypatch.setattr(VisionClassifier, "_try_claude", lambda self, b64: None)
    amd_result = classifier.classify("fake_b64")
    assert amd_result["source"] == "amd"

    monkeypatch.setattr(VisionClassifier, "_try_amd", lambda self, b64: None)
    monkeypatch.delenv("ENABLE_CLAUDE_FALLBACK", raising=False)
    demo_result = classifier.classify("fake_b64")
    assert demo_result["source"] == "demo"


def test_optimizer_summary_required_keys_types_and_objective_normalization(monkeypatch):
    monkeypatch.setattr(optimizer_module, "ORTOOLS_AVAILABLE", False)
    optimizer = RouteOptimizer()
    listings = [_make_listing("a", 37.351, -121.951, lbs=8.0)]

    _, summary_value = optimizer.optimize(
        driver_lat=37.35,
        driver_lng=-121.95,
        listings=listings,
        max_minutes=120,
        truck_capacity_lbs=500,
        objective="profit",
    )
    _, summary_lbs = optimizer.optimize(
        driver_lat=37.35,
        driver_lng=-121.95,
        listings=listings,
        max_minutes=120,
        truck_capacity_lbs=500,
        objective="impact",
    )

    required_keys = {
        "total_stops",
        "total_value",
        "total_lbs",
        "total_miles",
        "truck_fill_pct",
        "estimated_minutes",
        "lbs_per_hour",
        "objective",
        "solver",
        "solve_time_ms",
    }
    assert required_keys == set(summary_value.keys())
    assert isinstance(summary_value["total_stops"], int)
    assert _is_number(summary_value["total_value"])
    assert _is_number(summary_value["total_lbs"])
    assert _is_number(summary_value["total_miles"])
    assert _is_number(summary_value["truck_fill_pct"])
    assert isinstance(summary_value["estimated_minutes"], int)
    assert _is_number(summary_value["lbs_per_hour"])
    assert isinstance(summary_value["solve_time_ms"], int)
    assert summary_value["objective"] == "value"
    assert summary_value["solver"] in {"none", "ortools", "greedy", "greedy_fallback"}

    assert summary_lbs["objective"] == "lbs"
    assert summary_lbs["solver"] in {"none", "ortools", "greedy", "greedy_fallback"}


def test_voice_notify_live_variant_shape(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.setattr(
        VoiceNotifier,
        "_make_call",
        lambda self, phone, message, timeout_seconds=None: {"success": True, "mode": "live", "call_sid": "CA123"},
    )

    result = notifier.notify("+14085550101", "Household", 20, "Driver")
    assert result == {"success": True, "mode": "live", "call_sid": "CA123"}


def test_voice_notify_demo_variant_with_message(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TWILIO_PHONE_NUMBER", raising=False)
    monkeypatch.delenv("VOICE_FORCE_DEMO", raising=False)

    result = notifier.notify("+14085550101", "Household", 20, "Driver")
    assert result["success"] is True
    assert result["mode"] == "demo"
    assert isinstance(result["message"], str)
    assert len(result["message"]) > 0
    assert result["reason"] == "twilio_not_configured"


def test_voice_make_call_demo_variant_with_message_and_reason_when_twilio_env_missing(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TWILIO_PHONE_NUMBER", raising=False)

    result = notifier._make_call("+14085550101", "message")
    assert result["success"] is True
    assert result["mode"] == "demo"
    assert result["reason"] == "twilio_not_configured"
    assert result["message"] == "message"


def test_voice_make_call_failed_variant_shape(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+14085550000")

    class _FakeCalls:
        @staticmethod
        def create(**kwargs):
            raise RuntimeError("simulated twilio failure")

    class _FakeClient:
        def __init__(self, sid, token, http_client=None):
            self.calls = _FakeCalls()

    fake_twilio = types.ModuleType("twilio")
    fake_twilio_rest = types.ModuleType("twilio.rest")
    fake_twilio_http = types.ModuleType("twilio.http")
    fake_twilio_http_client = types.ModuleType("twilio.http.http_client")
    fake_twilio_rest.Client = _FakeClient
    fake_twilio_http_client.TwilioHttpClient = lambda timeout=None: object()
    fake_twilio_http.http_client = fake_twilio_http_client
    fake_twilio.rest = fake_twilio_rest
    fake_twilio.http = fake_twilio_http

    monkeypatch.setitem(sys.modules, "twilio", fake_twilio)
    monkeypatch.setitem(sys.modules, "twilio.rest", fake_twilio_rest)
    monkeypatch.setitem(sys.modules, "twilio.http", fake_twilio_http)
    monkeypatch.setitem(sys.modules, "twilio.http.http_client", fake_twilio_http_client)

    result = notifier._make_call("+14085550101", "message")
    assert result["success"] is False
    assert result["mode"] == "failed"
    assert isinstance(result["error"], str)
    assert "simulated twilio failure" in result["error"]
    assert result["reason"] == "twilio_exception"


def test_notify_with_retry_adds_retry_attempt_only_on_retry_success(monkeypatch):
    results = [
        {"success": False, "mode": "failed", "error": "first failure", "reason": "twilio_exception"},
        {"success": True, "mode": "demo", "message": "second attempt success", "reason": "forced_demo_mode"},
    ]

    def _fake_notify(**kwargs):
        return results.pop(0)

    monkeypatch.setattr(optimize_route_module.notifier, "notify", _fake_notify)

    result, attempts_used = optimize_route_module._notify_with_retry(
        phone="+14085550101",
        household_name="Household",
        eta_minutes=12,
        driver_name="Driver",
        attempts=2,
    )

    assert result["success"] is True
    assert result["mode"] == "demo"
    assert result["retry_attempt"] == 2
    assert attempts_used == 2


def test_notify_with_retry_omits_retry_attempt_on_first_try_success(monkeypatch):
    monkeypatch.setattr(
        optimize_route_module.notifier,
        "notify",
        lambda **kwargs: {"success": True, "mode": "live", "call_sid": "CA999"},
    )

    result, attempts_used = optimize_route_module._notify_with_retry(
        phone="+14085550101",
        household_name="Household",
        eta_minutes=12,
        driver_name="Driver",
        attempts=2,
    )

    assert result["success"] is True
    assert result["mode"] == "live"
    assert "retry_attempt" not in result
    assert attempts_used == 1


def test_notify_with_retry_final_failure_is_deterministic_and_contract_stable(monkeypatch):
    attempts = {"count": 0}

    def _always_fail(**kwargs):
        attempts["count"] += 1
        return {
            "success": False,
            "mode": "failed",
            "error": "timed out",
            "reason": "twilio_timeout",
        }

    monkeypatch.setattr(optimize_route_module.notifier, "notify", _always_fail)

    result, attempts_used = optimize_route_module._notify_with_retry(
        phone="+14085550101",
        household_name="Household",
        eta_minutes=8,
        driver_name="Driver",
        attempts=2,
    )

    assert attempts["count"] == 2
    assert attempts_used == 2
    assert result["success"] is False
    assert result["mode"] == "failed"
    assert result["reason"] == "twilio_timeout"
    assert "retry_attempt" not in result


def test_live_prediction_contract_shape_is_strict(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    started = service.start_session()

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
                                    "text": '{"materials":[{"type":"cardboard","lbs":1.8,"confidence":0.88,"raw_confidence":0.91,"provenance":"frame"}],"notes":"preview"}'
                                }
                            ]
                        }
                    }
                ]
            }

    monkeypatch.setattr(service, "_invoke_model", lambda **kwargs: _Resp())
    result = service.classify_frame(
        session_id=started["session_id"],
        frame_base64="aGVsbG8=",
        mime_type="image/jpeg",
    )

    required_top = {
        "success",
        "source",
        "session_id",
        "frame_seq",
        "materials",
        "total_lbs",
        "total_value",
        "notes",
        "stable",
        "latency_ms",
    }
    assert required_top.issubset(result.keys())
    assert result["success"] is True
    assert result["source"] in {"gemini_live", "gemini_live_demo"}
    assert isinstance(result["frame_seq"], int)
    assert isinstance(result["stable"], bool)
    assert isinstance(result["latency_ms"], int)
    assert isinstance(result["materials"], list)
    if result["materials"]:
        item = result["materials"][0]
        assert {"type", "label", "emoji", "lbs", "rate", "value", "confidence"}.issubset(item.keys())


def test_classify_contract_backward_compatible_shape():
    classifier = VisionClassifier()
    demo = classifier._demo_result()
    assert set(["success", "source", "materials", "total_value", "total_lbs", "notes"]).issubset(demo.keys())
    assert demo["source"] == "demo"
    assert isinstance(demo["materials"], list)


def test_pickup_receipt_and_org_dashboard_contract_shape():
    store.reset_demo()
    media_asset = store.create_media_asset(
        purpose="pickup_proof",
        file_name="proof.jpg",
        mime_type="image/jpeg",
        content_bytes=b"hello",
    )
    listing = store.all("available")[0]
    assert store.claim_listing(listing.id) == "claimed"
    job = store.create_pickup_job(
        listing_id=listing.id,
        driver_name="Contract Driver",
        eta_minutes=14,
        request_id="contract-receipt-1",
    )
    receipt = store.complete_pickup_job(
        job["pickup_job_id"],
        actual_materials=[Material(type="cardboard", lbs=9.5)],
        actual_total_lbs=9.5,
        contamination_flags=[],
        completion_media_id=media_asset["media_id"],
        completed_at="",
        driver_lat=37.35,
        driver_lng=-121.95,
    )

    required_receipt_keys = {
        "receipt_id",
        "pickup_job_id",
        "listing_id",
        "org_id",
        "driver_name",
        "household_name",
        "address",
        "lat",
        "lng",
        "capture_mode",
        "source_session_id",
        "completion_media_id",
        "estimated_materials",
        "actual_materials",
        "estimated_total_lbs",
        "actual_total_lbs",
        "estimated_confidence",
        "variance_lbs",
        "variance_pct",
        "contamination_flags",
        "created_at",
        "completed_at",
        "actual_total_value",
    }
    assert required_receipt_keys == set(receipt.keys())
    assert isinstance(receipt["estimated_materials"], list)
    assert isinstance(receipt["actual_materials"], list)
    assert _is_number(receipt["actual_total_lbs"])
    assert _is_number(receipt["actual_total_value"])
    enriched = media_service.enrich_receipt(receipt, store=store, request_root="http://localhost/")
    assert enriched["completion_media"]["media_id"] == media_asset["media_id"]
    assert enriched["completion_media"]["signed_url"].startswith("http://localhost/api/media/")

    dashboard = store.org_dashboard("org_santa_clara_demo", window="30d")
    assert dashboard["success"] is True
    assert {"org", "window", "summary", "hotspots", "latest_receipts", "all_receipts", "material_mix", "export_links"}.issubset(dashboard.keys())
    assert {"completed_pickups", "total_lbs_diverted", "total_value_paid", "contamination_rate"}.issubset(
        dashboard["summary"].keys()
    )
    assert isinstance(dashboard["all_receipts"], list)
    assert isinstance(dashboard["material_mix"], list)
