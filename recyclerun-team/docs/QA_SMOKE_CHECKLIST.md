# RecycleRun — QA Smoke Checklist
**Branch:** feat/sara/ph1-qa-smoke-checklist
**Owner:** Sara
**Target run time:** < 10 minutes
**Backend base:** `http://localhost:5000/api`
**Frontend dev:** `http://localhost:5173`

---

## Section A — Backend API Smoke Tests

> Run these curl commands with the Flask server running (`python -m backend.app` from repo root).
> All field names are taken directly from the model `to_dict()` methods and route handlers.

---

### A1 — GET /api/health

**Priority:** P0 — blocks all other tests if failing

```bash
curl -s http://localhost:5000/api/health | python3 -m json.tool
```

**Expected response shape:**
```json
{
  "status": "ok",
  "total_listings": 20
}
```

| Check | PASS criteria | FAIL criteria |
|-------|--------------|---------------|
| HTTP status | `200` | Any non-200 |
| `status` field | `"ok"` | Absent or `!= "ok"` |
| `total_listings` | Integer ≥ 0 | Absent or non-integer |
| Response time | < 500ms | > 2000ms = latency warning |

**P0 blocker:** Yes — if this fails, the backend is down; switch to fallback demo mode.

---

### A2 — GET /api/listings

**Priority:** P0 — driver map and route optimizer both depend on this

```bash
curl -s "http://localhost:5000/api/listings?status=available" | python3 -m json.tool
```

**Expected response shape:**
```json
{
  "listings": [
    {
      "id": "listing_xxxxxxxx",
      "address": "742 Everglade Ave, Santa Clara",
      "lat": 37.3541,
      "lng": -121.9552,
      "household_name": "Chen Family",
      "phone": "+14085550101",
      "listing_kind": "household",
      "materials": [
        { "type": "cardboard", "label": "Cardboard (OCC)", "emoji": "📦",
          "lbs": 18.0, "rate": 0.04, "value": 0.72 }
      ],
      "notes": "Near garage door",
      "status": "available",
      "posted_at": "2026-02-28T00:00:00.000000",
      "photo_url": null,
      "total_value": 8.75,
      "total_lbs": 23.3
    }
  ],
  "count": 20
}
```

| Check | PASS criteria | FAIL criteria |
|-------|--------------|---------------|
| HTTP status | `200` | Any non-200 |
| `listings` field | Array (may be empty) | Absent or non-array |
| `count` field | Integer matching `listings.length` | Absent |
| Each listing | Has `id`, `address`, `lat`, `lng`, `total_lbs`, `total_value` | Any required field missing |
| Seed count | ≥ 15 listings on fresh start | < 1 listing |

**Valid `status` query values:** `available`, `claimed`, `completed`
**P0 blocker:** Yes — empty listings breaks route optimizer.

---

### A3 — POST /api/classify

**Priority:** P1 — demo degrades gracefully to demo mode if AMD_API_KEY absent

```bash
curl -s -X POST http://localhost:5000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "image_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  }' | python3 -m json.tool
```

**Expected response shape (live AMD or demo fallback):**
```json
{
  "success": true,
  "source": "demo",
  "materials": [
    {
      "type": "cardboard",
      "label": "Cardboard (OCC)",
      "emoji": "📦",
      "lbs": 14.0,
      "rate": 0.04,
      "value": 0.56,
      "confidence": 0.91
    }
  ],
  "total_value": 8.96,
  "total_lbs": 19.5,
  "notes": "Demo mode — add AMD_API_KEY for live detection"
}
```

**Error case (no image provided → HTTP 400):**
```json
{ "error": "No image provided" }
```

| Check | PASS criteria | FAIL criteria |
|-------|--------------|---------------|
| HTTP status | `200` | `400` (missing image), `500` |
| `success` field | `true` | `false` or absent |
| `materials` field | Array (may be empty) | Absent |
| `source` | `"amd"`, `"claude"`, or `"demo"` | Absent |
| `total_value` | Float ≥ 0 | Absent or negative |
| `total_lbs` | Float ≥ 0 | Absent or negative |

**P1 blocker:** Yes — classify failure degrades to demo mode, not a show-stopper.

---

### A4 — POST /api/optimize-route

**Priority:** P0 — core driver feature

```bash
curl -s -X POST http://localhost:5000/api/optimize-route \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 37.3541,
    "lng": -121.9552,
    "max_minutes": 120,
    "truck_capacity_lbs": 1000,
    "objective": "value"
  }' | python3 -m json.tool
```

**Expected response shape:**
```json
{
  "stops": [
    {
      "listing_id": "listing_xxxxxxxx",
      "address": "742 Everglade Ave, Santa Clara",
      "lat": 37.3541,
      "lng": -121.9552,
      "household_name": "Chen Family",
      "phone": "+14085550101",
      "total_value": 8.75,
      "total_lbs": 23.3,
      "distance_from_prev": 0.0,
      "travel_minutes": 0.0,
      "eta_minutes": 5,
      "listing_kind": "household",
      "materials": [],
      "notes": "Near garage door",
      "status": "pending"
    }
  ],
  "summary": {
    "total_stops": 8,
    "total_value": 132.50,
    "total_lbs": 210.3,
    "total_miles": 12.4,
    "truck_fill_pct": 21.0,
    "estimated_minutes": 114,
    "lbs_per_hour": 110.7,
    "objective": "value",
    "solver": "ortools",
    "solve_time_ms": 2150
  }
}
```

**Valid `objective` values:** `"value"` (maximize $), `"lbs"` (maximize weight/diversion)

| Check | PASS criteria | FAIL criteria |
|-------|--------------|---------------|
| HTTP status | `200` | Any non-200 |
| `stops` field | Array (may be empty if no listings fit) | Absent |
| `summary` field | Object present | Absent |
| `summary.total_stops` | Integer ≥ 0 | Absent |
| `summary.solver` | `"ortools"`, `"greedy"`, or `"greedy_fallback"` | Absent |
| `summary.truck_fill_pct` | 0–100 | > 100 (overloaded) |
| Each stop | Has `listing_id`, `eta_minutes`, `total_lbs`, `total_value` | Missing required field |

**P0 blocker:** Yes — if backend fails, JS client-side `optimizeRoute()` from `optimizer.js` activates automatically via `useRoute.js`.

---

### A5 — POST /api/accept-route

**Priority:** P1 — ElevenLabs/Twilio optional; demo mode prints to console

> First, get a real `listing_id` from A2, then substitute it below.

```bash
# Step 1: get a listing_id
LISTING_ID=$(curl -s "http://localhost:5000/api/listings?status=available" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['listings'][0]['id'])")

# Step 2: accept the route
curl -s -X POST http://localhost:5000/api/accept-route \
  -H "Content-Type: application/json" \
  -d "{
    \"stops\": [{\"listing_id\": \"$LISTING_ID\", \"eta_minutes\": 15}],
    \"driver_name\": \"QA Tester\"
  }" | python3 -m json.tool
```

**Expected response shape:**
```json
{
  "success": true,
  "notifications_sent": 1,
  "notifications": [
    {
      "listing_id": "listing_xxxxxxxx",
      "household": "Chen Family",
      "phone": "+14085550101",
      "notification": {
        "success": true,
        "mode": "demo",
        "message": "Hello! This is RecycleRun..."
      }
    }
  ]
}
```

**Notification `mode` values:** `"live"` (Twilio call placed), `"demo"` (console print, no keys), `"failed"` (Twilio error)

| Check | PASS criteria | FAIL criteria |
|-------|--------------|---------------|
| HTTP status | `200` | Any non-200 |
| `success` field | `true` | `false` or absent |
| `notifications_sent` | Integer ≥ 0 | Absent |
| `notifications` | Array, length = `notifications_sent` | Absent |
| Each `notification.mode` | `"live"` or `"demo"` | `"failed"` |

**P1 blocker:** Yes — voice calls degrade to demo mode; app keeps working.

---

## Section B — UI Smoke Tests

> Open browser DevTools Network tab before each test. Check console for errors.

### B1 — Household Photo Upload (Classify flow)

**ONLINE behavior:**
1. Navigate to the household submission page
2. Click camera/upload button → select a real photo of recyclables
3. **PASS:** Response shows identified materials with `type`, `lbs`, `value`, `confidence` fields and `source: "amd"` or `"claude"`
4. **PASS:** Total value and lbs displayed correctly
5. **PASS:** "Submit listing" button becomes active

**FALLBACK behavior** (AMD_API_KEY absent / network down):
- `source` field shows `"demo"`
- Three demo materials appear: cardboard 14 lbs, aluminum_cans 3.5 lbs, plastic_pet 2.0 lbs
- `total_value: 8.96`, `total_lbs: 19.5`
- **PASS:** UI shows demo results; household can still submit
- **DEMO-SAFE:** Yes

### B2 — Manual Material Entry

**ONLINE + FALLBACK (same behavior):**
1. On submission page, click "Add manually" / use material entry form
2. Select material type from dropdown (e.g., `aluminum_cans`)
3. Enter weight in lbs
4. **PASS:** Value auto-calculates (lbs × rate from `MATERIAL_RATES`)
5. **PASS:** Submit calls `POST /api/listings` with `{address, lat, lng, household_name, phone, listing_kind, notes, materials: [{type, lbs}]}`
6. **PASS:** Response contains `{success: true, listing: {id, ...}}`
7. **DEMO-SAFE:** Yes — uses static `DEMO_LISTINGS` if API null

### B3 — Driver Map Loads

**ONLINE behavior:**
1. Navigate to driver view
2. `useListings` hook calls `GET /api/listings?status=available`
3. **PASS:** Map renders with pins for all available listings
4. **PASS:** Each pin shows `address`, `household_name`, `total_value`, `total_lbs`
5. **PASS:** Business listings (listing_kind: "business") shown with distinct marker

**FALLBACK behavior** (API returns null):
- `useListings` falls back to `DEMO_LISTINGS` (20 listings, 15 household + 5 business)
- **PASS:** Map renders with 20 static pins
- **DEMO-SAFE:** Yes

### B4 — Build Optimized Route

**ONLINE behavior:**
1. On driver view, click "Build Route"
2. `useRoute.build()` calls `POST /api/optimize-route` with `{lat, lng, max_minutes, truck_capacity_lbs, objective}`
3. **PASS:** Route returned with `stops` array and `summary` object
4. **PASS:** `summary.total_stops`, `summary.total_value`, `summary.truck_fill_pct` displayed
5. **PASS:** Stops shown in order with `distance_from_prev`, `travel_minutes`, `eta_minutes`
6. **PASS:** `summary.solver` visible (ortools vs greedy)

**FALLBACK behavior** (API null → `data?.stops` is falsy):
- `useRoute.build()` calls client-side `optimizeRoute()` from `optimizer.js`
- Uses 25 mph + 5 min/stop greedy algorithm
- **PASS:** Route renders identically from JS fallback
- **DEMO-SAFE:** Yes

### B5 — Accept Route + Notification Overlay

**ONLINE behavior:**
1. With a route built, click "Accept Route" and enter driver name
2. `useRoute.accept()` calls `POST /api/accept-route` with `{stops, driver_name}`
3. **PASS:** Each stop in `notifications` array has `household`, `eta_minutes`, `notification.mode`
4. **PASS:** Notification overlay/modal appears showing each household contacted
5. **PASS:** Listings marked `"claimed"` in backend (verify via `GET /api/listings?status=claimed`)
6. **WOW moment:** If `ELEVENLABS_API_KEY` + `TWILIO_*` set → `notification.mode: "live"`, real phone rings

**FALLBACK behavior** (API null):
- `useRoute.accept()` uses `data?.notifications || route.stops.map(...)` fallback
- Each stop gets: `{household: s.household_name, eta_minutes: s.eta_minutes, notification: {mode: "demo", message: "<driver> arriving in <eta> min"}}`
- **PASS:** Overlay still appears with demo notifications
- **DEMO-SAFE:** Yes

### B6 — Stop-by-Stop Truck Fill Progression

**ONLINE + FALLBACK (same behavior — pure frontend):**
1. In the accepted route view, progress through each stop
2. **PASS:** Truck fill percentage increases after each stop: `running_lbs / truck_capacity_lbs * 100`
3. **PASS:** Running earnings accumulate using `total_value` from each RouteStop
4. **PASS:** ETA countdown shows `eta_minutes` from each stop
5. **PASS:** `truck_fill_pct` in `summary` matches final value
6. **DEMO-SAFE:** Yes — all data from local route state

### B7 — Impact Page

**ONLINE behavior:**
1. Navigate to Impact page
2. `api.getImpact()` calls `GET /api/impact`
3. **PASS:** Response shows `{completed_pickups, total_lbs_diverted, total_value_paid, co2_saved_lbs, co2_saved_tons}`
4. **PASS:** CO2 calculation visible: `total_lbs_diverted × 0.5 lbs CO2 / lb material`
5. **PASS:** SB 1383 connection shown (California organic waste law context)

**FALLBACK behavior** (API null):
- Impact shows zeros or cached demo values
- **DEMO-SAFE:** Partial — run `POST /api/listings/reset-demo` then complete 2–3 pickups first for live numbers

### B8 — Rates / Materials Page

**ONLINE behavior:**
1. Navigate to Rates page
2. `api.getMaterials()` calls `GET /api/materials`
3. **PASS:** All 12 material types displayed with `rate`, `label`, `emoji`, `source`
4. **PASS:** CalRecycle CRV rates correct (aluminum_cans: $1.65/lb, plastic_pet: $1.31/lb)

**FALLBACK behavior** (API null):
- `MATERIAL_RATES` from `demoData.js` used (same 12 types)
- **DEMO-SAFE:** Yes

---

## Section C — Fallback Mode Matrix

| Feature | Online Behavior | Fallback Behavior | Fallback Trigger | Demo-Safe? |
|---------|----------------|-------------------|-----------------|-----------|
| Listings map | `GET /api/listings` → real DB | `DEMO_LISTINGS` (20 static) | API returns null | ✅ Yes |
| Photo classify | AMD Llama Vision API → real materials | `DEMO_CLASSIFICATION` (3 materials, $8.96) | No `AMD_API_KEY` / API error | ✅ Yes |
| Route optimizer | `POST /api/optimize-route` → OR-Tools/greedy | `optimizeRoute()` JS greedy (25mph, 5min/stop) | `data?.stops` falsy | ✅ Yes |
| Accept route | `POST /api/accept-route` → Twilio call | Demo notification map on route.stops | API returns null | ✅ Yes |
| Voice call | ElevenLabs TTS + Twilio call to real phone | Console print `[DEMO CALL]` | No `ELEVENLABS_API_KEY` or `TWILIO_*` | ✅ Yes (silent) |
| Impact stats | `GET /api/impact` → live completed counts | Zeros or static fallback | API returns null | ⚠️ Partial |
| Material rates | `GET /api/materials` → `MATERIAL_RATES` dict | `MATERIAL_RATES` from demoData.js | API returns null | ✅ Yes |
| Backend solver | OR-Tools prize-collecting VRP | Python greedy heuristic | OR-Tools import fails | ✅ Yes |
| Create listing | `POST /api/listings` → persisted | Local state only | API returns null | ⚠️ Partial |

---

## Section D — P0 Blockers & P1 Warnings

### P0 Blockers — Must pass for any public demo

| # | Feature | Symptom | Fix |
|---|---------|---------|-----|
| P0-1 | Backend health (`GET /api/health`) | 500 / connection refused | Restart Flask: `python -m backend.app` |
| P0-2 | Listings API (`GET /api/listings`) | Empty or error | Check `ListingStore` init; run `POST /api/listings/reset-demo` |
| P0-3 | Route optimizer (`POST /api/optimize-route`) | No stops returned or 500 | Check OR-Tools install; greedy fallback should auto-activate |
| P0-4 | Driver map renders | Blank map, no pins | Check `useListings` + CORS headers; `DEMO_LISTINGS` fallback must kick in |
| P0-5 | Client-side `optimizeRoute()` | JS exception | Check `optimizer.js`; `DEMO_LISTINGS` must have `lat`, `lng`, `total_lbs`, `status` |

### P1 Warnings — Degrade gracefully; demo continues

| # | Feature | Symptom | Demo Behavior |
|---|---------|---------|--------------|
| P1-1 | AMD classify (`POST /api/classify`) | 400/500 / no AMD key | `_demo_result()` returns 3 demo materials with `source: "demo"` |
| P1-2 | ElevenLabs TTS | Audio generation fails | `_generate_audio()` returns None; voice service skips to console print |
| P1-3 | Twilio call | Call placement fails | `_make_call()` returns `{success: False, mode: "failed"}` |
| P1-4 | Accept route API | 500 or null | `useRoute.accept()` falls back to local notification mapping |
| P1-5 | OR-Tools solver | Import error or no solution found | `RouteOptimizer` catches exception, runs `_solve_greedy()` instead |
| P1-6 | Impact stats | All zeros | No completed listings yet; run demo pickups first |
| P1-7 | Backend latency > 2000ms | Slow optimize-route | `smokeRunner.js` logs latency warning in `error` field; app still works |
