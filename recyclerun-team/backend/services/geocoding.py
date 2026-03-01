"""
Address geocoding service.
Primary provider: Google Geocoding API.
Fallback provider: OpenStreetMap Nominatim.
"""
from __future__ import annotations

import os
from typing import Dict

import requests


GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
NOMINATIM_GEOCODE_URL = "https://nominatim.openstreetmap.org/search"


class AddressGeocoder:
    def __init__(self, timeout_seconds: float = 6.0):
        self._timeout_seconds = max(1.0, float(timeout_seconds))

    @staticmethod
    def _google_api_key() -> str:
        for name in ("GOOGLE_GEOCODING_API_KEY", "GOOGLE_MAPS_API_KEY", "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY", "VITE_GOOGLE_MAPS_KEY"):
            value = (os.getenv(name) or "").strip()
            if value:
                return value
        return ""

    def geocode(self, address: str) -> Dict[str, object]:
        normalized = str(address or "").strip()
        if not normalized:
            return {"success": False, "provider": "none", "error": "Address is required"}

        google_result = self._geocode_google(normalized)
        if google_result.get("success"):
            return google_result

        nominatim_result = self._geocode_nominatim(normalized)
        if nominatim_result.get("success"):
            return nominatim_result

        message = google_result.get("error") or nominatim_result.get("error") or "Geocoding failed"
        return {"success": False, "provider": "none", "error": str(message)}

    def _geocode_google(self, address: str) -> Dict[str, object]:
        api_key = self._google_api_key()
        if not api_key:
            return {"success": False, "provider": "google", "error": "Google geocoding key not configured"}

        try:
            response = requests.get(
                GOOGLE_GEOCODE_URL,
                params={"address": address, "key": api_key},
                timeout=self._timeout_seconds,
            )
            payload = response.json()
        except requests.Timeout:
            return {"success": False, "provider": "google", "error": "Google geocoding request timed out"}
        except requests.RequestException as exc:
            return {"success": False, "provider": "google", "error": f"Google geocoding request failed: {exc}"}
        except ValueError:
            return {"success": False, "provider": "google", "error": "Google geocoding returned invalid JSON"}

        status = str(payload.get("status") or "").upper()
        if status != "OK":
            message = str(payload.get("error_message") or status or "geocoding_failed")
            return {"success": False, "provider": "google", "error": f"Google geocoding status: {message}"}

        results = payload.get("results") or []
        if not isinstance(results, list) or not results:
            return {"success": False, "provider": "google", "error": "Google geocoding returned no results"}

        first = results[0]
        location = (first.get("geometry") or {}).get("location") or {}
        lat = location.get("lat")
        lng = location.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            return {"success": False, "provider": "google", "error": "Google geocoding response missing lat/lng"}

        return {
            "success": True,
            "provider": "google",
            "lat": float(lat),
            "lng": float(lng),
            "formatted_address": str(first.get("formatted_address") or address),
        }

    def _geocode_nominatim(self, address: str) -> Dict[str, object]:
        try:
            response = requests.get(
                NOMINATIM_GEOCODE_URL,
                params={"q": address, "format": "json", "limit": 1},
                headers={"User-Agent": "Bin2Bucks-Geocoder/1.0"},
                timeout=self._timeout_seconds,
            )
            payload = response.json()
        except requests.Timeout:
            return {"success": False, "provider": "nominatim", "error": "Nominatim geocoding request timed out"}
        except requests.RequestException as exc:
            return {"success": False, "provider": "nominatim", "error": f"Nominatim geocoding request failed: {exc}"}
        except ValueError:
            return {"success": False, "provider": "nominatim", "error": "Nominatim geocoding returned invalid JSON"}

        if not isinstance(payload, list) or not payload:
            return {"success": False, "provider": "nominatim", "error": "Nominatim geocoding returned no results"}

        first = payload[0] if isinstance(payload[0], dict) else {}
        lat_raw = first.get("lat")
        lng_raw = first.get("lon")
        try:
            lat = float(lat_raw)
            lng = float(lng_raw)
        except (TypeError, ValueError):
            return {"success": False, "provider": "nominatim", "error": "Nominatim response missing lat/lng"}

        return {
            "success": True,
            "provider": "nominatim",
            "lat": lat,
            "lng": lng,
            "formatted_address": str(first.get("display_name") or address),
        }
