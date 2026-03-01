# Production Deployment (Permanent Mobile API)

This app should not rely on LAN/tunnels for production demos.

## Why Not DDNS + Port Forwarding

DDNS + router port forwarding is not a good default for this project:

1. Exposes your laptop/dev machine directly to the internet.
2. Depends on router admin access (often unavailable on campus/event Wi-Fi).
3. Creates security and reliability risk during demos.

Use a managed cloud host with HTTPS and health checks.

## Recommended Topology

1. Deploy Flask API to managed host (Render shown below).
2. Use stable HTTPS domain:
   - temporary: `https://recyclerun-api.onrender.com/api`
   - preferred: custom domain like `https://api.recyclerun.app/api`
3. Point Expo app to that domain.

## Render Deploy (included config)

Repo includes [`render.yaml`](/Users/paarthtangirala/Documents/Documents-MacBookAir/GitHub/SCU%20hack/recyclerun-team/render.yaml).

### Steps

1. Push `pre-master` to GitHub.
2. In Render, create new Blueprint deploy from repo root.
3. Confirm service `recyclerun-api` is detected.
4. Set secret env vars in Render dashboard:
   - `AMD_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER`
   - `STORE_DB_PATH=/tmp/recyclerun_store.sqlite3` (shared SQLite state for multi-worker consistency)
   - `WEB_CONCURRENCY=1` (stability-first default; increase only after load-testing)
5. Deploy and verify:
   - `GET https://<render-domain>/api/health` returns `status: ok`.

## Mobile: switch to production API (one command)

```bash
cd recyclerun-team
./scripts/mobile/use-prod-api.sh https://<render-domain>/api
cd mobile
npm start
```

This writes `mobile/.env` with:

- `EXPO_PUBLIC_API_BASE_URL=https://<render-domain>/api`
- `EXPO_PUBLIC_AUTO_LAN=0`

## Rollback to local LAN profile

```bash
cd recyclerun-team
./scripts/mobile/use-lan-api.sh
cd mobile
npm start
```

## Production Readiness Checklist

1. `/api/health` external check passing.
2. `POST /api/optimize-route` p95 latency < 3s.
3. `POST /api/accept-route` idempotency checks passing.
4. `accept-route` replay returns `idempotent_replay=true` with same request id.
5. Multi-request consistency validated under current `WEB_CONCURRENCY`.
6. AMD key configured (or demo fallback explicitly accepted).
7. Twilio creds configured or notifier fallback behavior verified.
8. Mobile `API source: env` and production HTTPS URL shown.
