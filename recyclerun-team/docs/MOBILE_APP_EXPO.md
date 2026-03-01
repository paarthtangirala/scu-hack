# RecycleRun Mobile (Expo Go)

This project now includes a native mobile client in `mobile/` built with Expo.

## Prerequisites

- Node.js 20+
- Expo Go app on iOS/Android device
- Python backend running on your laptop

## 1) Start Backend

```bash
cd recyclerun-team
pip install -r backend/requirements.txt
python -m flask --app backend.app:create_app run --host 0.0.0.0 --port 5050
```

Backend runs on `http://localhost:5050`.

## 2) Configure Mobile API URL

```bash
cd recyclerun-team
./scripts/mobile/use-lan-api.sh
```

This auto-detects your laptop LAN IP and writes `mobile/.env` with:

- `EXPO_PUBLIC_API_BASE_URL=http://<YOUR_LAN_IP>:5050/api`
- `EXPO_PUBLIC_AUTO_LAN=1` (default): if Expo Go bundle host is a LAN IP and `.env` is stale (`loca.lt`/localhost), app auto-corrects API base at runtime.
- preserves `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` if it already exists.
- `EXPO_PUBLIC_LIVE_PREVIEW_FRAME_INTERVAL_MS=1000` (default): camera frame cadence for live preview.

## 3) Start Expo

```bash
cd recyclerun-team/mobile
npm install
npm start
```

Scan the QR code from Expo CLI with Expo Go.
`npm start` now uses Expo tunnel for bundle delivery (more robust on restrictive Wi-Fi), while API still uses LAN (`<YOUR_LAN_IP>:5050`) from `mobile/.env`.

## 4) One-Command Mobile Setup (Recommended)

```bash
cd recyclerun-team
./scripts/mobile/start-expo-lan.sh
```

This:
1. Detects LAN IP.
2. Writes `mobile/.env`.
3. Starts Expo in LAN mode with cache clear.

## 5) Production API Profile (Permanent)

If local network routing is unreliable, switch mobile to a stable hosted API:

```bash
cd recyclerun-team
./scripts/mobile/use-prod-api.sh https://<your-hosted-api-domain>/api
cd mobile
npm start
```

### Optional: enable in-app Google route rendering

Add this to `mobile/.env`:

```bash
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<your-google-maps-key>
```

Required Google services for this key:

- Maps SDK for iOS / Android (for map tiles in app)
- Directions API (for optimized route polyline)

## iOS Note (Expo Go)

On iOS, Expo Go renders the map using Apple basemap by default.

- You can still use Google Directions API for route polyline/geometry.
- If you need Google basemap on iOS, create an EAS iOS development build and configure `ios.config.googleMapsApiKey` in Expo app config.

## 6) Smoke Checklist (2 min)

1. Open **Home** tab:
   - API status shows `ok`.
2. Open **Post** tab:
   - Create a household listing with manual materials.
3. Open **Driver** tab:
   - Build route.
   - Verify **Route Map (Google Maps)** renders polyline + stop markers.
   - Accept route.
   - Mark one stop completed.
4. Open **Impact** tab:
   - Completed pickup count increments.
5. Open **Rates** tab:
   - Material rates list loads.

## 7) Live AI Preview Setup

1. Add backend Gemini env values in project root `.env`:
   - `GEMINI_API_KEY`
   - `GEMINI_LIVE_MODEL`
   - `GEMINI_LIVE_TIMEOUT_SECONDS`
   - `GEMINI_LIVE_SESSION_TTL_SECONDS`
   - `GEMINI_LIVE_MAX_FRAME_BYTES`
   - `GEMINI_LIVE_MIN_FRAME_INTERVAL_MS`
   - `GEMINI_LIVE_MIN_LBS`
   - `GEMINI_LIVE_MAX_LBS`
2. Install mobile dependency once:

```bash
cd recyclerun-team/mobile
npm install
```

3. In **Post** tab:
   - switch from **Photo Upload** to **Live AI Preview**
   - grant camera permission
   - start live preview
4. Manual edits/add/remove lock that material type from AI overwrite.
5. Use **Reset AI Suggestions** to clear locks and accept fresh AI autofill.

## 8) Common Fixes

- Route map shows straight lines instead of Google route:
  - Set `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in `mobile/.env`.
  - Enable **Directions API** for that key in Google Cloud.
  - Restrict key for mobile app usage only (iOS bundle / Android app).
- Route map says Google Directions unavailable:
  - Confirm key is valid and billing is enabled in Google Cloud.
  - Confirm route has <= 23 stops (driver screen truncates map fetch beyond this).

- `Network request failed` in app:
  - Verify phone and laptop are on same Wi-Fi.
  - Re-run `./scripts/mobile/use-lan-api.sh` after Wi-Fi changes.
  - Verify `.env` uses LAN IP, not `localhost`.
  - Verify backend is running and reachable from phone browser.
- `HTTP 503 Tunnel Unavailable`:
  - You are still pointing to `*.loca.lt`.
  - Switch to LAN mode (`npm run start:lan`) and regenerate `mobile/.env` via `./scripts/mobile/use-lan-api.sh`.
- Expo Go stuck at `Opening project...`:
  - This usually means Expo LAN bundle transport is blocked on your network.
  - Use `npm start` (`--tunnel`) for bundle transport.
  - On iOS, ensure Expo Go has Local Network permission and disable VPN/private relay during local debugging.
- Camera preview permission denied:
  - Open iOS/Android settings for Expo Go and enable Camera access.
  - Reopen Post tab and retry **Enable Camera**.
- Live preview shows demo mode:
  - Backend is running without valid `GEMINI_API_KEY` or upstream parse failed.
  - Manual material entry still works and should be used as fallback.
- Backend on macOS blocked:
  - Allow Python incoming connections in macOS firewall prompt.
- Stale demo data:
  - Use **Driver -> Reset Demo** button.
