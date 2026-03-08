"""
Unit tests for direct-live token provisioning and persistence.
"""
from __future__ import annotations

import pytest

from backend.services.live_control import LiveControlError, LiveTokenService
from backend.services.store import store


class _Resp:
    def __init__(self, status_code: int, payload: dict, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


def test_live_token_service_provisions_token_and_tracks_session(monkeypatch):
    store.reset_demo()
    service = LiveTokenService(store=store)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    monkeypatch.setattr(
        "backend.services.live_control.requests.post",
        lambda *args, **kwargs: _Resp(
            200,
            {
                "name": "ephemeral-token-123",
                "expireTime": "2026-03-08T21:00:00Z",
                "newSessionExpireTime": "2026-03-08T20:31:00Z",
            },
        ),
    )

    result = service.provision(
        model="gemini-2.5-flash-native-audio-preview-12-2025",
        profile_id="profile_123",
        platform="ios",
        device_tier="mid",
        network_type="wifi",
    )

    assert result["success"] is True
    assert result["provider"] == "gemini_live"
    assert result["token"] == "ephemeral-token-123"
    assert result["ws_endpoint"].startswith("wss://")
    assert result["telemetry_session_id"].startswith("lvs_")
    assert result["setup"]["model"] == "models/gemini-2.5-flash-native-audio-preview-12-2025"
    assert result["transport_version"] == "native_candidate_stream_v1"
    assert result["supports_session_resumption"] is True
    assert isinstance(result["candidate_video_policy"], dict)
    assert result["fallback_order"][0] == "direct_native_live"
    session = store.get_live_vision_session(result["telemetry_session_id"])
    assert session is not None
    assert session["profile_id"] == "profile_123"
    assert session["transport"] == "direct_websocket"
    assert session["platform"] == "ios"
    assert session["device_tier"] == "mid"


def test_live_token_service_missing_api_key_raises_structured_error(monkeypatch):
    service = LiveTokenService(store=store)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(LiveControlError) as exc:
        service.provision()

    assert exc.value.code == "live_token_unavailable"
    assert exc.value.status == 503


def test_live_token_service_non_200_response_raises_structured_error(monkeypatch):
    service = LiveTokenService(store=store)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(
        "backend.services.live_control.requests.post",
        lambda *args, **kwargs: _Resp(400, {}, text="bad auth token request"),
    )

    with pytest.raises(LiveControlError) as exc:
        service.provision()

    assert exc.value.code == "live_token_request_failed"
    assert exc.value.status == 502


def test_live_token_service_uses_top_level_auth_token_fields(monkeypatch):
    service = LiveTokenService(store=store)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    observed = {}

    def _post(url, json=None, timeout=None):
        observed["url"] = url
        observed["json"] = json
        observed["timeout"] = timeout
        return _Resp(200, {"name": "auth_tokens/test-token"})

    monkeypatch.setattr("backend.services.live_control.requests.post", _post)

    result = service.provision()

    assert result["token"] == "auth_tokens/test-token"
    assert observed["url"].startswith("https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=")
    assert observed["json"]["uses"] == 1
    assert "expireTime" in observed["json"]
    assert "newSessionExpireTime" in observed["json"]
    assert "authToken" not in observed["json"]
