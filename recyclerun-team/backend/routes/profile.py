"""
Role-based profile + session endpoints for mobile personalization.
"""
from __future__ import annotations

from typing import Dict

from flask import Blueprint, request

from backend.services.store import store
from backend.services.validation import (
    validate_profile_role,
    validate_profile_session_payload,
    validate_profile_update_payload,
)
from backend.utils.http import error, success

profile_bp = Blueprint("profile", __name__, url_prefix="/api/profile")

INSTRUCTION_PACKAGES: Dict[str, Dict] = {
    "giver": {
        "role": "giver",
        "title": "Giver Quick Start",
        "subtitle": "Post clean recyclables and get faster pickups.",
        "steps": [
            {
                "title": "Step 1 - Add your listing",
                "body": "Go to GIVE, add address, photo/manual materials, and submit.",
            },
            {
                "title": "Step 2 - Keep materials ready",
                "body": "Sort by material and keep bags/boxes accessible for pickup.",
            },
            {
                "title": "Step 3 - Track your impact",
                "body": "Use IMPACT and RATES to see diverted lbs and payout value.",
            },
        ],
        "safety_notes": [
            "No hazardous waste pickups.",
            "Only opt-in listings are processed.",
            "Keep pickup notes clear for drivers.",
        ],
    },
    "driver": {
        "role": "driver",
        "title": "Driver Quick Start",
        "subtitle": "Build route, accept stops, and complete pickups efficiently.",
        "steps": [
            {
                "title": "Step 1 - Build optimized route",
                "body": "Go to DRIVE and choose objective, time window, and truck capacity.",
            },
            {
                "title": "Step 2 - Accept route and notify stops",
                "body": "Accept route to claim stops and trigger household notifications.",
            },
            {
                "title": "Step 3 - Complete stops and review totals",
                "body": "Mark completed stops to update collected lbs, value, and impact stats.",
            },
        ],
        "safety_notes": [
            "Only collect approved recyclable materials.",
            "Follow partner pickup instructions in notes.",
            "Use route + ETA to avoid time-window misses.",
        ],
    },
}


def _instructions_for_role(role: str) -> Dict:
    return INSTRUCTION_PACKAGES.get(role, INSTRUCTION_PACKAGES["giver"])


def _session_payload(bundle: Dict) -> Dict:
    profile = bundle["profile"]
    return {
        "profile": profile,
        "session": bundle["session"],
        "onboarding_required": not bool(profile.get("onboarding_completed")),
        "instruction_package": _instructions_for_role(profile.get("role", "giver")),
    }


@profile_bp.get("/instructions")
def get_instruction_package():
    role, errors = validate_profile_role(request.args.get("role", "giver"))
    if errors:
        return error(code="validation_error", message="Invalid role query", status=400, errors=errors)
    return success({"instruction_package": _instructions_for_role(role)})


@profile_bp.post("/session")
def start_session():
    payload, errors = validate_profile_session_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid profile session payload", status=400, errors=errors)

    try:
        profile = store.create_or_update_profile(
            role=payload["role"],
            display_name=payload["display_name"],
            email=payload["email"],
            phone=payload["phone"],
        )
        bundle = store.create_session(
            profile_id=profile["id"],
            role=profile["role"],
            device_label=payload["device_label"],
            session_id=payload["session_id"] or None,
        )
    except ValueError as exc:
        return error(
            code="profile_conflict",
            message="Could not start profile session",
            status=409,
            errors=[{"field": "profile", "message": str(exc)}],
        )

    return success(_session_payload(bundle))


@profile_bp.get("/session/<session_id>")
def get_session(session_id: str):
    if not store.touch_session(session_id):
        return error(
            code="session_not_found",
            message="Session not found",
            status=404,
            errors=[{"field": "session_id", "message": "No active session for this id"}],
        )

    bundle = store.get_session(session_id)
    if bundle is None:
        return error(
            code="session_not_found",
            message="Session not found",
            status=404,
            errors=[{"field": "session_id", "message": "No active session for this id"}],
        )

    return success(_session_payload(bundle))


@profile_bp.delete("/session/<session_id>")
def end_session(session_id: str):
    if not store.end_session(session_id):
        return error(
            code="session_not_found",
            message="Session not found",
            status=404,
            errors=[{"field": "session_id", "message": "No active session for this id"}],
        )
    return success({"message": "Session ended"})


@profile_bp.get("/<profile_id>")
def get_profile(profile_id: str):
    profile = store.get_profile(profile_id)
    if profile is None:
        return error(
            code="not_found",
            message="Profile not found",
            status=404,
            errors=[{"field": "profile_id", "message": "No profile exists for this id"}],
        )
    return success(
        {
            "profile": profile,
            "instruction_package": _instructions_for_role(profile.get("role", "giver")),
        }
    )


@profile_bp.patch("/<profile_id>")
def patch_profile(profile_id: str):
    payload, errors = validate_profile_update_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid profile update payload", status=400, errors=errors)

    try:
        updated = store.update_profile(
            profile_id,
            display_name=payload.get("display_name"),
            email=payload.get("email"),
            phone=payload.get("phone"),
        )
    except ValueError as exc:
        return error(
            code="profile_conflict",
            message="Could not update profile",
            status=409,
            errors=[{"field": "profile", "message": str(exc)}],
        )

    if updated is None:
        return error(
            code="not_found",
            message="Profile not found",
            status=404,
            errors=[{"field": "profile_id", "message": "No profile exists for this id"}],
        )

    return success(
        {
            "profile": updated,
            "instruction_package": _instructions_for_role(updated.get("role", "giver")),
        }
    )


@profile_bp.post("/<profile_id>/onboarding-complete")
def complete_onboarding(profile_id: str):
    profile = store.mark_onboarding_complete(profile_id)
    if profile is None:
        return error(
            code="not_found",
            message="Profile not found",
            status=404,
            errors=[{"field": "profile_id", "message": "No profile exists for this id"}],
        )
    return success(
        {
            "profile": profile,
            "instruction_package": _instructions_for_role(profile.get("role", "giver")),
            "onboarding_required": False,
        }
    )
