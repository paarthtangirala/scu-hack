from backend.services.geocoding import AddressGeocoder


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def test_google_geocoding_success(monkeypatch):
    geocoder = AddressGeocoder()
    monkeypatch.setattr(geocoder, "_google_api_key", lambda: "google-key")

    def _fake_get(url, params=None, timeout=None, headers=None):
        assert "googleapis.com" in url
        return _Response(
            {
                "status": "OK",
                "results": [
                    {
                        "formatted_address": "1260 Campbell Ave, San Jose, CA 95008, USA",
                        "geometry": {"location": {"lat": 37.2874, "lng": -121.9547}},
                    }
                ],
            }
        )

    monkeypatch.setattr("backend.services.geocoding.requests.get", _fake_get)
    result = geocoder.geocode("1260 Campbell Ave, San Jose, CA 95008")
    assert result["success"] is True
    assert result["provider"] == "google"
    assert abs(result["lat"] - 37.2874) < 1e-6
    assert abs(result["lng"] - (-121.9547)) < 1e-6


def test_google_failure_uses_nominatim_fallback(monkeypatch):
    geocoder = AddressGeocoder()
    monkeypatch.setattr(geocoder, "_google_api_key", lambda: "")

    def _fake_get(url, params=None, timeout=None, headers=None):
        assert "nominatim.openstreetmap.org" in url
        return _Response(
            [
                {
                    "lat": "37.3352",
                    "lon": "-121.8811",
                    "display_name": "San Jose, CA",
                }
            ]
        )

    monkeypatch.setattr("backend.services.geocoding.requests.get", _fake_get)
    result = geocoder.geocode("San Jose, CA")
    assert result["success"] is True
    assert result["provider"] == "nominatim"


def test_geocoding_failure_returns_error(monkeypatch):
    geocoder = AddressGeocoder()
    monkeypatch.setattr(geocoder, "_google_api_key", lambda: "")

    def _fake_get(url, params=None, timeout=None, headers=None):
        return _Response([])

    monkeypatch.setattr("backend.services.geocoding.requests.get", _fake_get)
    result = geocoder.geocode("DefinitelyUnknownAddress")
    assert result["success"] is False
    assert isinstance(result.get("error"), str)
