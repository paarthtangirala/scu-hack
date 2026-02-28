"""
HTTP response helpers for consistent API contracts.
"""
from __future__ import annotations

from typing import Any, Dict, List

from flask import jsonify


def success(payload: Dict[str, Any], status: int = 200):
    body = {"success": True}
    body.update(payload)
    return jsonify(body), status


def error(code: str, message: str, status: int, errors: List[Dict[str, str]] | None = None):
    body: Dict[str, Any] = {
        "success": False,
        "error": code,   # backward-compatible key used by existing clients/tests
        "code": code,    # machine-readable code (issue contract)
        "message": message,
    }
    if errors:
        body["errors"] = errors     # backward-compatible key
        body["details"] = errors    # issue contract key
    return jsonify(body), status
