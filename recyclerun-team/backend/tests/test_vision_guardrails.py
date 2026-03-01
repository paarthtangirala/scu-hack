"""
Vision guardrail tests for AMD parsing reliability and telemetry.
"""
from __future__ import annotations

import requests

from backend.services.vision import VisionClassifier


def _has_reason(caplog, reason: str) -> bool:
    return any(getattr(r, "reason", None) == reason for r in caplog.records)


def test_parse_accepts_plain_json_object():
    classifier = VisionClassifier()
    content = '{"materials":[{"type":"cardboard","lbs":10.02,"confidence":0.93}],"notes":"sorted pile"}'
    result = classifier._parse(content, source="amd")

    assert result is not None
    assert result["success"] is True
    assert result["source"] == "amd"
    assert isinstance(result["materials"], list) and len(result["materials"]) == 1
    material = result["materials"][0]
    assert set(["type", "label", "emoji", "lbs", "rate", "value", "confidence"]).issubset(material.keys())
    assert result["total_value"] >= 0
    assert result["total_lbs"] > 0


def test_parse_extracts_json_from_prefixed_or_suffixed_text():
    classifier = VisionClassifier()
    content = (
        "Here is result:\n"
        '{"materials":[{"type":"cardboard","lbs":2.4}],"notes":"garage stack"}\n'
        "Thanks"
    )
    result = classifier._parse(content, source="amd")

    assert result is not None
    assert result["source"] == "amd"
    assert result["notes"] == "garage stack"
    assert len(result["materials"]) == 1


def test_parse_extracts_json_from_fenced_block():
    classifier = VisionClassifier()
    content = (
        "analysis follows\n"
        "```json\n"
        '{"materials":[{"type":"aluminum_cans","lbs":3.0}],"notes":"bin A"}\n'
        "```\n"
        "end"
    )
    result = classifier._parse(content, source="amd")

    assert result is not None
    assert result["source"] == "amd"
    assert result["notes"] == "bin A"
    assert result["materials"][0]["type"] == "aluminum_cans"


def test_parse_handles_malformed_json_without_exception(caplog):
    classifier = VisionClassifier()
    caplog.set_level("WARNING", logger="backend.services.vision")
    content = 'prefix {"materials":[} suffix'

    result = classifier._parse(content, source="amd")

    assert result is None
    assert _has_reason(caplog, "json_decode_error")


def test_parse_drops_unknown_materials_and_preserves_notes():
    classifier = VisionClassifier()
    content = (
        '{"materials":['
        '{"type":"mystery_plastic","lbs":5},'
        '{"type":"cardboard","lbs":7.2}'
        '],"notes":"left side only"}'
    )
    result = classifier._parse(content, source="amd")

    assert result is not None
    assert result["notes"] == "left side only"
    assert len(result["materials"]) == 1
    assert result["materials"][0]["type"] == "cardboard"


def test_parse_clamps_lbs_low_and_high_using_env_bounds(monkeypatch):
    classifier = VisionClassifier()
    monkeypatch.setenv("VISION_MIN_LBS", "0.4")
    monkeypatch.setenv("VISION_MAX_LBS", "10.2")
    content = (
        '{"materials":['
        '{"type":"cardboard","lbs":0.01},'
        '{"type":"aluminum_cans","lbs":999.99}'
        '],"notes":"clamp test"}'
    )
    result = classifier._parse(content, source="amd")

    assert result is not None
    assert [m["lbs"] for m in result["materials"]] == [0.4, 10.2]
    assert result["total_lbs"] == 10.6


def test_parse_skips_non_numeric_lbs_entries(caplog):
    classifier = VisionClassifier()
    caplog.set_level("WARNING", logger="backend.services.vision")
    content = (
        '{"materials":['
        '{"type":"cardboard","lbs":"many"},'
        '{"type":"aluminum_cans","lbs":3.3}'
        '],"notes":"mixed quality"}'
    )
    result = classifier._parse(content, source="amd")

    assert result is not None
    assert len(result["materials"]) == 1
    assert result["materials"][0]["type"] == "aluminum_cans"
    assert _has_reason(caplog, "invalid_lbs_type")


def test_parse_returns_none_when_all_items_invalid_after_filtering(caplog):
    classifier = VisionClassifier()
    caplog.set_level("WARNING", logger="backend.services.vision")
    content = (
        '{"materials":['
        '{"type":"unknown_type","lbs":5},'
        '{"type":"cardboard","lbs":"bad"}'
        '],"notes":"invalid payload"}'
    )
    result = classifier._parse(content, source="amd")

    assert result is None
    assert _has_reason(caplog, "no_valid_materials")


def test_try_amd_timeout_logs_structured_timeout_and_returns_none(monkeypatch, caplog):
    classifier = VisionClassifier()
    monkeypatch.setenv("AMD_API_KEY", "test-key")
    caplog.set_level("WARNING", logger="backend.services.vision")

    def _raise_timeout(*args, **kwargs):
        raise requests.Timeout("timed out")

    monkeypatch.setattr(requests, "post", _raise_timeout)
    result = classifier._try_amd("fake_b64")

    assert result is None
    timeout_logs = [
        r for r in caplog.records
        if getattr(r, "source", None) == "amd"
        and getattr(r, "reason", None) == "request_timeout"
    ]
    assert timeout_logs
    assert all(getattr(r, "timeout", None) is True for r in timeout_logs)


def test_try_amd_non_200_logs_structured_failure(monkeypatch, caplog):
    classifier = VisionClassifier()
    monkeypatch.setenv("AMD_API_KEY", "test-key")
    caplog.set_level("WARNING", logger="backend.services.vision")

    class _Resp:
        status_code = 503

    monkeypatch.setattr(requests, "post", lambda *args, **kwargs: _Resp())
    result = classifier._try_amd("fake_b64")

    assert result is None
    non_200_logs = [
        r for r in caplog.records
        if getattr(r, "source", None) == "amd"
        and getattr(r, "reason", None) == "non_200_response"
    ]
    assert non_200_logs
    assert all(getattr(r, "http_status", None) == 503 for r in non_200_logs)


def test_classify_never_raises_uncaught_and_falls_back_to_demo_on_internal_error(monkeypatch):
    classifier = VisionClassifier()

    def _explode(*args, **kwargs):
        raise RuntimeError("forced internal failure")

    monkeypatch.setattr(VisionClassifier, "_try_amd", _explode)
    result = classifier.classify("fake_b64")

    assert result["success"] is True
    assert result["source"] == "demo"
    assert isinstance(result["materials"], list)


def test_classify_fallback_chain_amd_invalid_to_demo(monkeypatch):
    classifier = VisionClassifier()
    monkeypatch.delenv("ENABLE_CLAUDE_FALLBACK", raising=False)
    monkeypatch.setattr(VisionClassifier, "_try_amd", lambda self, b64: self._parse("not json", source="amd"))
    monkeypatch.setattr(VisionClassifier, "_try_claude", lambda self, b64: {"success": True, "source": "claude"})

    result = classifier.classify("fake_b64")

    assert result["success"] is True
    assert result["source"] == "demo"
