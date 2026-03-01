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

## 6) Smoke Checklist (2 min)

1. Open **Home** tab:
   - API status shows `ok`.
2. Open **Post** tab:
   - Create a household listing with manual materials.
3. Open **Driver** tab:
   - Build route.
   - Accept route.
   - Mark one stop completed.
4. Open **Impact** tab:
   - Completed pickup count increments.
5. Open **Rates** tab:
   - Material rates list loads.

## 7) Common Fixes

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
- Backend on macOS blocked:
  - Allow Python incoming connections in macOS firewall prompt.
- Stale demo data:
  - Use **Driver -> Reset Demo** button.
