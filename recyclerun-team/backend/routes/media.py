"""
Media upload and signed retrieval endpoints.
"""
from __future__ import annotations

from flask import Blueprint, Response, jsonify, request

from backend.services.media import media_service
from backend.services.store import store
from backend.services.validation import validate_media_upload_payload
from backend.utils.http import error


media_bp = Blueprint("media", __name__, url_prefix="/api/media")


@media_bp.post("/upload")
def upload_media():
    payload, errors = validate_media_upload_payload(request.get_json(silent=True))
    if errors:
        return error(code="validation_error", message="Invalid media upload payload", status=400, errors=errors)

    asset = store.create_media_asset(
        purpose=payload["purpose"],
        file_name=payload["file_name"],
        mime_type=payload["mime_type"],
        content_bytes=payload["content_bytes"],
    )
    return jsonify(
        {
            "success": True,
            "media_asset": media_service.asset_payload(asset, request_root=request.url_root),
        }
    ), 201


@media_bp.get("/<media_id>/content")
def get_media_content(media_id: str):
    expires_raw = request.args.get("expires", "").strip()
    signature = request.args.get("signature", "").strip()
    try:
        expires_at = int(expires_raw)
    except (TypeError, ValueError):
        return error(
            code="validation_error",
            message="Invalid media signature params",
            status=400,
            errors=[{"field": "expires", "message": "expires must be an integer unix timestamp"}],
        )

    if not media_service.verify(media_id, expires_at=expires_at, signature=signature):
        return error(
            code="forbidden",
            message="Media signature is invalid or expired",
            status=403,
            errors=[{"field": "signature", "message": "Signed media URL is invalid or expired"}],
        )

    asset = store.get_media_asset(media_id, include_bytes=True)
    if asset is None:
        return error(
            code="not_found",
            message="Media asset not found",
            status=404,
            errors=[{"field": "media_id", "message": "No media asset exists for this id"}],
        )

    headers = {
        "Content-Disposition": f'inline; filename="{asset["file_name"]}"',
        "Cache-Control": "private, max-age=60",
    }
    return Response(asset["content_bytes"], mimetype=asset["mime_type"], headers=headers)
