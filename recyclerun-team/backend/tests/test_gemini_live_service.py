"""
Unit tests for Gemini live vision service session lifecycle and parsing guardrails.
"""
from __future__ import annotations

import requests

from backend.services.gemini_live import GeminiLiveError, GeminiLiveService
from backend.services.validation import validate_live_frame_payload


class _Resp:
    def __init__(self, status_code: int, payload: dict, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


def _frame_payload(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def test_start_session_success_with_api_key(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    result = service.start_session()

    assert result["success"] is True
    assert result["state"] == "ready"
    assert result["source_mode"] == "gemini_live"
    assert isinstance(result["session_id"], str) and result["session_id"]


def test_missing_api_key_starts_demo_mode_with_explicit_reason(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = service.start_session()

    assert result["success"] is True
    assert result["source_mode"] == "gemini_live_demo"
    assert result["reason"] == "gemini_api_key_missing"


def test_invalid_frame_payload_validation_rejects_non_object():
    payload, errors = validate_live_frame_payload([], max_bytes=1000, allowed_mime_types=["image/jpeg"])

    assert payload is None
    assert errors[0]["field"] == "body"


def test_timeout_propagates_to_demo_fallback(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    started = service.start_session()

    def _raise_timeout(**kwargs):
        raise requests.Timeout("timed out")

    monkeypatch.setattr(service, "_invoke_model", _raise_timeout)

    result = service.classify_frame(
        session_id=started["session_id"],
        frame_base64="aGVsbG8=",
        mime_type="image/jpeg",
    )

    assert result["success"] is True
    assert result["source"] == "gemini_live_demo"
    assert "upstream_timeout" in result["notes"]


def test_timeout_emits_structured_log_fields(monkeypatch, caplog):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    started = service.start_session()

    def _raise_timeout(**kwargs):
        raise requests.Timeout("timed out")

    monkeypatch.setattr(service, "_invoke_model", _raise_timeout)
    caplog.set_level("WARNING", logger="backend.services.gemini_live")

    service.classify_frame(
        session_id=started["session_id"],
        frame_base64="aGVsbG8=",
        mime_type="image/jpeg",
    )

    records = [
        r
        for r in caplog.records
        if getattr(r, "event", "") == "live_vision_frame_failed" and getattr(r, "reason", "") == "request_timeout"
    ]
    assert records
    assert all(getattr(r, "session_id", "") == started["session_id"] for r in records)
    assert all(getattr(r, "timeout", None) is True for r in records)


def test_malformed_model_output_falls_back_without_exception(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    started = service.start_session()
    monkeypatch.setattr(service, "_invoke_model", lambda **kwargs: _Resp(200, _frame_payload("not-json")))

    result = service.classify_frame(
        session_id=started["session_id"],
        frame_base64="aGVsbG8=",
        mime_type="image/jpeg",
    )

    assert result["success"] is True
    assert result["source"] == "gemini_live_demo"
    assert result["materials"] == []


def test_parse_drops_unknown_materials_and_preserves_notes():
    service = GeminiLiveService()
    parsed = service._parse_prediction(
        '{"materials":[{"type":"unknown","lbs":5},{"type":"cardboard","lbs":4.2}],"notes":"garage pile"}'
    )

    assert parsed is not None
    assert parsed["notes"] == "garage pile"
    assert len(parsed["materials"]) == 1
    assert parsed["materials"][0]["type"] == "cardboard"


def test_parse_clamps_lbs_with_env_bounds(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_LIVE_MIN_LBS", "0.4")
    monkeypatch.setenv("GEMINI_LIVE_MAX_LBS", "10.0")
    parsed = service._parse_prediction(
        '{"materials":[{"type":"cardboard","lbs":0.01},{"type":"aluminum_cans","lbs":999.9}],"notes":"x"}'
    )

    assert parsed is not None
    assert [m["lbs"] for m in parsed["materials"]] == [0.4, 10.0]
    assert parsed["total_lbs"] == 10.4


def test_session_stop_is_idempotent(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    started = service.start_session()
    first = service.stop_session(started["session_id"])
    second = service.stop_session(started["session_id"])

    assert first["success"] is True
    assert first["already_closed"] is False
    assert second["success"] is True
    assert second["already_closed"] is True


def test_frame_rate_throttle_raises_structured_service_error(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_LIVE_MIN_FRAME_INTERVAL_MS", "60000")
    started = service.start_session()
    monkeypatch.setattr(
        service,
        "_invoke_model",
        lambda **kwargs: _Resp(
            200,
            _frame_payload('{"materials":[{"type":"cardboard","lbs":1.2}],"notes":"ok"}'),
        ),
    )

    service.classify_frame(
        session_id=started["session_id"],
        frame_base64="aGVsbG8=",
        mime_type="image/jpeg",
    )
    try:
        service.classify_frame(
            session_id=started["session_id"],
            frame_base64="aGVsbG8=",
            mime_type="image/jpeg",
        )
        assert False, "Expected live_frame_rate_limited error"
    except GeminiLiveError as exc:
        assert exc.code == "live_frame_rate_limited"
        assert exc.status == 429


def test_parse_normalizes_material_aliases():
    service = GeminiLiveService()
    parsed = service._parse_prediction(
        '{"materials":[{"type":"aluminum cans","lbs":2.0},{"type":"glass bottle","lbs":1.2}],"notes":"desk items"}'
    )

    assert parsed is not None
    assert [m["type"] for m in parsed["materials"]] == ["aluminum_cans", "glass_bottles"]
    assert parsed["notes"] == "desk items"


def test_parse_accepts_recyclable_materials_key_and_weight_alias():
    service = GeminiLiveService()
    parsed = service._parse_prediction(
        '{"recyclable_materials":[{"material":"cardboard","weight_lbs":3.4,"score":0.7}],"summary":"box pile"}'
    )

    assert parsed is not None
    assert len(parsed["materials"]) == 1
    assert parsed["materials"][0]["type"] == "cardboard"
    assert parsed["materials"][0]["lbs"] == 3.4
    assert parsed["materials"][0]["confidence"] == 0.7
    assert parsed["notes"] == "box pile"


def test_parse_allows_empty_materials_list_without_forcing_demo_fallback():
    service = GeminiLiveService()
    parsed = service._parse_prediction('{"materials":[],"notes":"no recyclables visible"}')

    assert parsed is not None
    assert parsed["materials"] == []
    assert parsed["total_lbs"] == 0
    assert parsed["total_value"] == 0
    assert parsed["notes"] == "no recyclables visible"


def test_parse_accepts_nested_material_container_and_estimated_weight_string():
    service = GeminiLiveService()
    parsed = service._parse_prediction(
        '{"result":{"analysis":{"detections":[{"name":"aluminum can","estimated_weight_lbs":"0.8 lbs"}]}},"summary":"single can"}'
    )

    assert parsed is not None
    assert len(parsed["materials"]) == 1
    assert parsed["materials"][0]["type"] == "aluminum_cans"
    assert parsed["materials"][0]["lbs"] == 0.8


def test_parse_accepts_top_level_array_materials():
    service = GeminiLiveService()
    parsed = service._parse_prediction('[{"material_type":"cardboard","pounds":"1.9"}]')

    assert parsed is not None
    assert len(parsed["materials"]) == 1
    assert parsed["materials"][0]["type"] == "cardboard"
    assert parsed["materials"][0]["lbs"] == 1.9


def test_non_200_response_log_includes_upstream_error_snippet(monkeypatch, caplog):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    started = service.start_session()
    monkeypatch.setattr(
        service,
        "_invoke_model",
        lambda **kwargs: _Resp(400, {"error": "bad request"}, text="invalid argument: inline_data is not supported"),
    )
    caplog.set_level("WARNING", logger="backend.services.gemini_live")

    result = service.classify_frame(
        session_id=started["session_id"],
        frame_base64="aGVsbG8=",
        mime_type="image/jpeg",
    )

    assert result["source"] == "gemini_live_demo"
    records = [
        r
        for r in caplog.records
        if getattr(r, "event", "") == "live_vision_frame_failed" and getattr(r, "reason", "") == "non_200_response"
    ]
    assert records
    assert "inline_data" in getattr(records[-1], "upstream_error", "")


def test_invoke_model_uses_inline_data_contract(monkeypatch):
    service = GeminiLiveService()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    captured = {}

    def _fake_post(url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return _Resp(200, _frame_payload('{"materials":[{"type":"cardboard","lbs":1.0}],"notes":"ok"}'))

    monkeypatch.setattr("backend.services.gemini_live.requests.post", _fake_post)

    response = service._invoke_model(
        model="gemini-2.5-flash",
        frame_base64="abc123",
        mime_type="image/jpeg",
        timeout_seconds=12,
    )

    assert response.status_code == 200
    parts = captured["json"]["contents"][0]["parts"]
    assert parts[1]["inlineData"]["mimeType"] == "image/jpeg"
    assert parts[1]["inlineData"]["data"] == "abc123"
    assert "inline_data" not in parts[1]
