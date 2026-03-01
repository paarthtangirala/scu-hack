# RecycleRun Mobile (Expo Go)

This project now includes a native mobile client in `mobile/` built with Expo.

## Prerequisites

- Node.js 20+
- Expo Go app on iOS/Android device
- Python backend running on your laptop

## 1) Start Backend

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Backend runs on `http://localhost:5000`.

## 2) Configure Mobile API URL

```bash
cd mobile
cp .env.example .env
```

Update `EXPO_PUBLIC_API_BASE_URL` in `.env`:

- iOS simulator / Android emulator on same machine:
  - `http://127.0.0.1:5000/api`
- Physical device (Expo Go):
  - `http://<YOUR_LAPTOP_LAN_IP>:5000/api`

Example:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.42:5000/api
```

## 3) Start Expo

```bash
cd mobile
npm install
npm start
```

Scan the QR code from Expo CLI with Expo Go.

## 4) Smoke Checklist (2 min)

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

## 5) Common Fixes

- `Network request failed` in app:
  - Verify phone and laptop are on same Wi-Fi.
  - Verify `.env` uses LAN IP, not `localhost`.
  - Verify backend is running and reachable from phone browser.
- Backend on macOS blocked:
  - Allow Python incoming connections in macOS firewall prompt.
- Stale demo data:
  - Use **Driver -> Reset Demo** button.
