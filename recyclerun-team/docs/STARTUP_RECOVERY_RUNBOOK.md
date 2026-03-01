# Bin2Bucks Startup + Recovery Runbook

This runbook is the fastest way to get the demo stack healthy from zero and recover from common failures.

## 0) Preconditions

- Repo is up to date (`pre-master` for team integration).
- Python deps installed (`backend/requirements.txt`).
- Node deps installed in both `frontend/` and `mobile/`.
- Render env vars configured for production API:
  - `AMD_API_KEY`
  - `ELEVENLABS_API_KEY`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`
  - `STORE_DB_PATH=/tmp/bin2bucks_store.sqlite3`
  - `WEB_CONCURRENCY=1` (demo default)

## 1) Boot Order (Local)

From repo root:

```bash
# Terminal 1: backend
python -m flask --app backend.app:create_app run --host 0.0.0.0 --port 5050
```

```bash
# Terminal 2: frontend web
cd frontend
npm run dev
```

```bash
# Terminal 3: mobile
cd ../mobile
npm start
```

## 2) Health Verification (Manual)

### Local API

```bash
curl -s http://127.0.0.1:5050/api/health
curl -s http://127.0.0.1:5050/api/materials
curl -s http://127.0.0.1:5050/api/listings
curl -s http://127.0.0.1:5050/api/impact
```

Expected:
- HTTP `200` for all endpoints.
- `/api/health` returns `{"status":"ok",...}`.

### Hosted API (Render)

```bash
curl -s https://recyclerun-api.onrender.com/api/health
```

Expected:
- HTTP `200`
- `status: ok`

## 3) One-Command Full Reliability Check

From repo root:

```bash
bash scripts/qa/full-system-check.sh
```

Optional hosted soak in same run:

```bash
HOSTED_API_BASE=https://recyclerun-api.onrender.com/api bash scripts/qa/full-system-check.sh
```

What this verifies:
- Backend tests (`pytest`)
- Frontend tests (`vitest`)
- Frontend production build
- Mobile export build
- Local API lifecycle flow:
  - create listing
  - optimize route
  - accept route
  - complete listing
- Local health soak (sequential + concurrent)
- Optional hosted health soak

## 4) Fast Recovery Playbook (Under 5 Minutes)

### A) Backend crash / API unavailable

1. Restart backend process.
2. Run:

```bash
curl -s http://127.0.0.1:5050/api/health
```

3. If still failing, run:

```bash
bash scripts/qa/full-system-check.sh
```

### B) Stale route state or bad demo state

Reset demo inventory:

```bash
curl -X POST http://127.0.0.1:5050/api/listings/reset-demo
```

Rebuild route in app and continue.

### C) Mobile shows unknown API status

Regenerate API env and restart Expo:

```bash
./scripts/mobile/use-lan-api.sh
cd mobile
npm start
```

For production profile:

```bash
./scripts/mobile/use-prod-api.sh "https://recyclerun-api.onrender.com/api"
cd mobile
npm start
```

### D) Accept route notifications show failed

This does not break route claim/optimization. Common cause is Twilio trial restrictions (unverified numbers).

Action:
- Verify destination numbers in Twilio, or
- Set `VOICE_FORCE_DEMO=1` for demo-safe notifier behavior.

## 5) Final Merge Checklist (Pre-master -> Main)

1. `git pull origin pre-master`
2. Run:

```bash
bash scripts/qa/full-system-check.sh
```

3. Verify Render `/api/health` is `ok`.
4. Verify on mobile:
  - Post listing
  - Build route
  - Accept route
  - Complete stop
  - Impact updates
5. Merge to `main`.

## 6) Rollback Path

If regression appears after merge:

1. Identify last known-good commit on `main`.
2. Revert offending commit(s):

```bash
git revert <sha>
git push origin main
```

3. Re-run:

```bash
bash scripts/qa/full-system-check.sh
```

4. Confirm Render health and mobile smoke.

## 7) Reliability Limits (Important)

No system can guarantee "never offline." This runbook maximizes reliability with:
- test gates before deploy,
- explicit health checks,
- deterministic reset/recovery,
- local + hosted soak checks.

For production-grade high availability beyond hackathon scope, use:
- managed Postgres (instead of single-file SQLite),
- multi-instance backend with load balancer,
- uptime monitoring + alerting,
- auto rollback on failing health checks.
