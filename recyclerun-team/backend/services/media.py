"""
Signed media asset URL helpers.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Any, Dict
from urllib.parse import urlencode


class MediaService:
    DEFAULT_TTL_SECONDS = 3600
    SIGNING_SECRET_ENV = "MEDIA_SIGNING_SECRET"

    def _secret(self) -> str:
        return os.getenv(self.SIGNING_SECRET_ENV, "bin2bucks-dev-media-secret")

    def _signature(self, media_id: str, expires_at: int) -> str:
        payload = f"{media_id}:{int(expires_at)}".encode("utf-8")
        return hmac.new(self._secret().encode("utf-8"), payload, hashlib.sha256).hexdigest()

    def build_signed_path(self, media_id: str, *, ttl_seconds: int | None = None) -> Dict[str, Any]:
        ttl = int(ttl_seconds or self.DEFAULT_TTL_SECONDS)
        expires_at = int(time.time()) + max(ttl, 1)
        signature = self._signature(media_id, expires_at)
        query = urlencode({"expires": str(expires_at), "signature": signature})
        return {
            "media_id": media_id,
            "expires_at": expires_at,
            "signature": signature,
            "path": f"/api/media/{media_id}/content?{query}",
        }

    def verify(self, media_id: str, *, expires_at: int, signature: str) -> bool:
        if int(expires_at) < int(time.time()):
            return False
        expected = self._signature(media_id, expires_at)
        return hmac.compare_digest(expected, str(signature or ""))

    def asset_payload(self, asset: Dict[str, Any], *, request_root: str, ttl_seconds: int | None = None) -> Dict[str, Any]:
        signed = self.build_signed_path(asset["media_id"], ttl_seconds=ttl_seconds)
        root = str(request_root or "").rstrip("/")
        return {
            **asset,
            "signed_url": f"{root}{signed['path']}",
            "signed_path": signed["path"],
            "expires_at": signed["expires_at"],
        }

    def enrich_receipt(self, receipt: Dict[str, Any], *, store: Any, request_root: str, ttl_seconds: int | None = None) -> Dict[str, Any]:
        enriched = dict(receipt)
        media_id = str(receipt.get("completion_media_id") or "").strip()
        if not media_id:
            enriched["completion_media"] = None
            return enriched
        asset = store.get_media_asset(media_id)
        enriched["completion_media"] = self.asset_payload(asset, request_root=request_root, ttl_seconds=ttl_seconds) if asset else None
        return enriched


media_service = MediaService()
