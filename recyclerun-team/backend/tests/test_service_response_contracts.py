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
    monkeypatch.setattr(VoiceNotifier, "_generate_audio", lambda self, text: b"audio")
    monkeypatch.setattr(
        VoiceNotifier,
        "_make_call",
        lambda self, phone, message, audio: {"success": True, "mode": "live", "call_sid": "CA123"},
    )

    result = notifier.notify("+14085550101", "Household", 20, "Driver")
    assert result == {"success": True, "mode": "live", "call_sid": "CA123"}


def test_voice_notify_demo_variant_with_message(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.setattr(VoiceNotifier, "_generate_audio", lambda self, text: None)

    result = notifier.notify("+14085550101", "Household", 20, "Driver")
    assert result["success"] is True
    assert result["mode"] == "demo"
    assert isinstance(result["message"], str)
    assert len(result["message"]) > 0


def test_voice_make_call_demo_variant_without_message_when_twilio_env_missing(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TWILIO_PHONE_NUMBER", raising=False)

    result = notifier._make_call("+14085550101", "message", b"audio")
    assert result == {"success": True, "mode": "demo"}


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
        def __init__(self, sid, token):
            self.calls = _FakeCalls()

    fake_twilio = types.ModuleType("twilio")
    fake_twilio_rest = types.ModuleType("twilio.rest")
    fake_twilio_rest.Client = _FakeClient
    fake_twilio.rest = fake_twilio_rest

    monkeypatch.setitem(sys.modules, "twilio", fake_twilio)
    monkeypatch.setitem(sys.modules, "twilio.rest", fake_twilio_rest)

    result = notifier._make_call("+14085550101", "message", b"audio")
    assert result["success"] is False
    assert result["mode"] == "failed"
    assert isinstance(result["error"], str)
    assert "simulated twilio failure" in result["error"]


def test_notify_with_retry_adds_retry_attempt_only_on_retry_success(monkeypatch):
    results = [
        {"success": False, "mode": "failed", "error": "first failure"},
        {"success": True, "mode": "demo", "message": "second attempt success"},
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
