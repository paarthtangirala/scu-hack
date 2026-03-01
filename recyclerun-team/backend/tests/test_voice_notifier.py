"""Voice notifier contract and fallback semantics tests (offline, deterministic)."""
from __future__ import annotations

import logging
import sys
import types

from backend.services.voice import VoiceNotifier


class _FakeCall:
    def __init__(self, sid: str):
        self.sid = sid


def _install_fake_twilio(monkeypatch, *, create_impl, timeout_capture: dict | None = None):
    class _FakeCalls:
        @staticmethod
        def create(**kwargs):
            return create_impl(**kwargs)

    class _FakeHttpClient:
        def __init__(self, timeout=None, **kwargs):
            self.timeout = timeout

    class _FakeClient:
        def __init__(self, sid, token, http_client=None):
            if timeout_capture is not None:
                timeout_capture["timeout"] = getattr(http_client, "timeout", None)
            self.calls = _FakeCalls()

    fake_twilio = types.ModuleType("twilio")
    fake_twilio_rest = types.ModuleType("twilio.rest")
    fake_twilio_http = types.ModuleType("twilio.http")
    fake_twilio_http_client = types.ModuleType("twilio.http.http_client")

    fake_twilio_rest.Client = _FakeClient
    fake_twilio_http_client.TwilioHttpClient = _FakeHttpClient
    fake_twilio_http.http_client = fake_twilio_http_client
    fake_twilio.rest = fake_twilio_rest
    fake_twilio.http = fake_twilio_http

    monkeypatch.setitem(sys.modules, "twilio", fake_twilio)
    monkeypatch.setitem(sys.modules, "twilio.rest", fake_twilio_rest)
    monkeypatch.setitem(sys.modules, "twilio.http", fake_twilio_http)
    monkeypatch.setitem(sys.modules, "twilio.http.http_client", fake_twilio_http_client)


def test_live_success_returns_required_schema(monkeypatch):
    notifier = VoiceNotifier()
    timeout_capture = {}
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+14085550000")
    monkeypatch.delenv("VOICE_FORCE_DEMO", raising=False)

    _install_fake_twilio(
        monkeypatch,
        create_impl=lambda **kwargs: _FakeCall("CA_live_123"),
        timeout_capture=timeout_capture,
    )

    result = notifier.notify("+14085550101", "Household", 9, "Driver")

    assert result == {"success": True, "mode": "live", "call_sid": "CA_live_123"}
    assert isinstance(timeout_capture["timeout"], float)


def test_missing_twilio_env_returns_demo_schema_with_reason(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TWILIO_PHONE_NUMBER", raising=False)
    monkeypatch.delenv("VOICE_FORCE_DEMO", raising=False)

    result = notifier.notify("+14085550101", "Household", 11, "Driver")

    assert result["success"] is True
    assert result["mode"] == "demo"
    assert result["reason"] == "twilio_not_configured"
    assert isinstance(result["message"], str)
    assert len(result["message"]) > 0


def test_missing_twilio_config_demo_reason_is_deterministic(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("TWILIO_PHONE_NUMBER", raising=False)
    monkeypatch.delenv("VOICE_FORCE_DEMO", raising=False)

    first = notifier.notify("+14085550101", "Household", 11, "Driver")
    second = notifier.notify("+14085550101", "Household", 11, "Driver")

    assert first["mode"] == second["mode"] == "demo"
    assert first["reason"] == second["reason"] == "twilio_not_configured"
    assert first["message"] == second["message"]


def test_forced_demo_mode_reason_is_deterministic(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+14085550000")
    monkeypatch.setenv("VOICE_FORCE_DEMO", "1")

    first = notifier.notify("+14085550101", "Household", 9, "Driver")
    second = notifier.notify("+14085550101", "Household", 9, "Driver")

    assert first["success"] is True
    assert second["success"] is True
    assert first["mode"] == second["mode"] == "demo"
    assert first["reason"] == second["reason"] == "forced_demo_mode"
    assert first["message"] == second["message"]


def test_twilio_exception_returns_failed_schema_with_reason_and_error(monkeypatch):
    notifier = VoiceNotifier()
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+14085550000")

    _install_fake_twilio(monkeypatch, create_impl=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("twilio failed")))

    result = notifier.notify("+14085550101", "Household", 13, "Driver")

    assert result["success"] is False
    assert result["mode"] == "failed"
    assert result["reason"] == "twilio_exception"
    assert "twilio failed" in result["error"]


def test_timeout_path_returns_failed_schema_with_timeout_reason(monkeypatch, caplog):
    notifier = VoiceNotifier()
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "sid")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+14085550000")
    monkeypatch.setenv("VOICE_NOTIFY_TIMEOUT_SECONDS", "7")

    _install_fake_twilio(monkeypatch, create_impl=lambda **kwargs: (_ for _ in ()).throw(TimeoutError("operation timed out")))

    with caplog.at_level(logging.ERROR):
        result = notifier.notify("+14085550101", "Household", 15, "Driver")

    assert result["success"] is False
    assert result["mode"] == "failed"
    assert result["reason"] == "twilio_timeout"
    assert "timed out" in result["error"].lower()
    assert "voice_notify_failed" in caplog.text
    assert "exception_type" in caplog.text
    assert "timeout_seconds" in caplog.text
    assert "+14085550101" not in caplog.text
    assert "***0101" in caplog.text


def test_notify_never_raises_uncaught_when_provider_throws(monkeypatch):
    notifier = VoiceNotifier()

    def _boom(*args, **kwargs):
        raise RuntimeError("unexpected provider crash")

    monkeypatch.setattr(VoiceNotifier, "_make_call", _boom)

    result = notifier.notify("+14085550101", "Household", 17, "Driver")

    assert result["success"] is False
    assert result["mode"] == "failed"
    assert result["reason"] == "notify_exception"
    assert "unexpected provider crash" in result["error"]


def test_no_dead_generated_audio_path_invocation():
    assert not hasattr(VoiceNotifier, "_generate_audio")
