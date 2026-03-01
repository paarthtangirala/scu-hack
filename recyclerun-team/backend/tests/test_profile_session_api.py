"""
API contract tests for profile/session personalization endpoints.
"""
from __future__ import annotations

import uuid

from flask import Flask

from backend.routes import profile_bp


def _client():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(profile_bp)
    return app.test_client()


def _unique_identity(prefix: str = "tester"):
    token = uuid.uuid4().hex[:8]
    digits = "".join(str((ord(ch) % 10)) for ch in token)[:7]
    return {
        "display_name": f"{prefix}-{token}",
        "email": f"{prefix}-{token}@example.com",
        "phone": f"+1408{digits}",
    }


def test_profile_session_start_and_fetch_round_trip():
    client = _client()
    identity = _unique_identity("giver")

    create = client.post(
        "/api/profile/session",
        json={
            "role": "giver",
            "display_name": identity["display_name"],
            "email": identity["email"],
            "phone": identity["phone"],
            "device_label": "ios-expo",
        },
    )
    assert create.status_code == 200
    body = create.get_json()
    assert body["success"] is True
    assert body["profile"]["role"] == "giver"
    assert body["profile"]["display_name"] == identity["display_name"]
    assert isinstance(body["profile"]["quick_actions"], list)
    assert body["onboarding_required"] is True
    assert body["instruction_package"]["role"] == "giver"
    session_id = body["session"]["session_id"]

    replay = client.get(f"/api/profile/session/{session_id}")
    assert replay.status_code == 200
    replay_body = replay.get_json()
    assert replay_body["profile"]["id"] == body["profile"]["id"]
    assert replay_body["session"]["session_id"] == session_id


def test_complete_onboarding_and_update_profile():
    client = _client()
    identity = _unique_identity("driver")
    updated_identity = _unique_identity("driver-updated")

    create = client.post(
        "/api/profile/session",
        json={
            "role": "driver",
            "display_name": identity["display_name"],
            "email": identity["email"],
            "phone": identity["phone"],
        },
    )
    body = create.get_json()
    profile_id = body["profile"]["id"]

    done = client.post(f"/api/profile/{profile_id}/onboarding-complete")
    assert done.status_code == 200
    done_body = done.get_json()
    assert done_body["onboarding_required"] is False
    assert done_body["profile"]["onboarding_completed"] is True

    patch = client.patch(
        f"/api/profile/{profile_id}",
        json={
            "display_name": "Driver One",
            "phone": updated_identity["phone"],
        },
    )
    assert patch.status_code == 200
    patch_body = patch.get_json()
    assert patch_body["profile"]["display_name"] == "Driver One"
    assert patch_body["profile"]["phone"] == updated_identity["phone"]


def test_end_session_removes_active_session():
    client = _client()
    identity = _unique_identity("session")

    create = client.post(
        "/api/profile/session",
        json={
            "role": "giver",
            "display_name": identity["display_name"],
            "email": identity["email"],
            "phone": identity["phone"],
        },
    )
    session_id = create.get_json()["session"]["session_id"]

    delete = client.delete(f"/api/profile/session/{session_id}")
    assert delete.status_code == 200

    missing = client.get(f"/api/profile/session/{session_id}")
    assert missing.status_code == 404
    body = missing.get_json()
    assert body["code"] == "session_not_found"


def test_instruction_endpoint_validates_role():
    client = _client()

    ok = client.get("/api/profile/instructions?role=driver")
    assert ok.status_code == 200
    assert ok.get_json()["instruction_package"]["role"] == "driver"

    bad = client.get("/api/profile/instructions?role=admin")
    assert bad.status_code == 400
    body = bad.get_json()
    assert body["code"] == "validation_error"
