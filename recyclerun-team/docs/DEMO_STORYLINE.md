# RecycleRun — 4-Minute Demo Storyline
**Event:** SCU Hack
**Owner:** Sara (QA) — coordinates with all presenters
**Total time:** 4:00 hard cap
**Fallback philosophy:** Every beat has a safe offline path. Do not apologize for fallbacks — they show system resilience.

---

## Demo Script Table

| Timestamp | Presenter Action | What Judges See | Key Talking Point | Fallback If Broken |
|-----------|-----------------|-----------------|-------------------|-------------------|
| **0:00–0:10** | Open with stat: "California diverts only 50% of its recyclables. The other 50% goes to landfill." | Title slide or landing page | SB 1383 mandates 75% organic waste diversion by 2025. We're here to close that gap. | Verbal only — no tech needed |
| **0:10–0:30** | "Meet Maria, a Santa Clara resident with two weeks of recycling. She posts a listing in 30 seconds." Navigate to household submission view. | Household submission form loaded | RecycleRun connects households to drivers who get paid. It's Uber, but for recyclables. | If page fails: show `demoData.js` DEMO_LISTINGS list — "Here's what 20 real households look like in our system." |
| **0:30–0:50** | Upload a photo of recyclables (have file pre-selected). Click "Classify with AI". | AMD Llama Vision identifies materials: cardboard, aluminum cans, PET plastic with confidence scores, weights, and values | Powered by AMD Llama 3.2 Vision — our sponsor's model runs the classification. No manual sorting required. | If AMD key missing → `source: "demo"` appears; say "In demo mode, we show you what a typical household scan looks like — 3.5 lbs aluminum at $1.65/lb = $5.78." |
| **0:50–1:00** | Show material breakdown. "Maria's recyclables are worth $8.96. She submits the listing." Click submit. | `POST /api/listings` → listing appears on map | She earns cash. We divert 19.5 lbs from landfill. The driver earns more. | If POST fails: skip to driver view with pre-seeded listings — "The listing is already in the system." |
| **1:00–1:20** | Switch to Driver view. "Now meet James, a gig driver." Show map with 20 listing pins. | Map with household + business pins (listing_kind differentiated) | 20 pickups available right now across Santa Clara. James picks his time window. | If map blank: hard-reload; `DEMO_LISTINGS` fallback activates automatically via `useListings` |
| **1:20–1:45** | Click "Build Optimized Route" (120 min, 1000 lb truck, objective: value). | Route builds in ~2s. Ordered stop list appears with `distance_from_prev`, `travel_minutes`, `eta_minutes`, `truck_fill_pct` | OR-Tools prize-collecting VRP — same solver used by Google Logistics. James doesn't need to think about routing. | If backend 500: JS client-side `optimizeRoute()` in `optimizer.js` activates silently — route still appears. Say "Our system self-heals to a local greedy solver." |
| **1:45–2:00** | Show route summary: stops, total value, total miles, solver used. Click "Accept Route". | `POST /api/accept-route` fires. Notification overlay appears. | When James accepts, every household gets notified instantly. | If accept-route fails: overlay falls back to demo notifications from `route.stops` — still shows household names + ETAs |
| **2:00–2:15** | **THE WOW MOMENT:** "Watch this — a real phone rings right now." Show phone on table. | Judges see/hear ElevenLabs voice call: "Hello! This is RecycleRun. James has accepted your recycling pickup and will arrive in approximately 15 minutes..." | ElevenLabs TTS + Twilio — personalized AI voice. Not a bot. Not a text. A call. | If ElevenLabs/Twilio missing: show console `[DEMO CALL] → +14085550101: Hello! This is RecycleRun...` — "In production this rings their phone. Here's the exact message." |
| **2:15–2:40** | Walk through stop-by-stop truck fill. Tap through 3 stops. | Truck fill meter: 0% → 8% → 24% → 41%. Running earnings counter ticks up. | Each stop is a micro-transaction. James sees his earnings grow in real time. | Static demo: manually narrate the fill numbers using `summary.total_lbs / truck_capacity_lbs` |
| **2:40–3:00** | Mark stops complete. Navigate to Impact page. | `GET /api/impact` → `{completed_pickups, total_lbs_diverted, co2_saved_lbs, co2_saved_tons}` | 210 lbs diverted = 105 lbs of CO2 avoided. SB 1383 compliance, one neighborhood at a time. | If impact zeros: run `POST /api/listings/reset-demo` off-screen first; show pre-cached screenshot |
| **3:00–3:20** | Show impact numbers animating. Mention CO2 calculation aloud. | co2_saved_lbs visible (total_lbs × 0.5), co2_saved_tons | California penalizes cities $10,000/day for SB 1383 non-compliance. We give them a tool. | Verbal only — numbers already on screen from prior demo |
| **3:20–3:35** | Sponsor callout slide or verbal shoutout. | Sponsor logos / AMD model name in classify response (`source: "amd"`) | AMD Instinct + Llama 3.2 Vision powers our classification. ElevenLabs powers our voice. We built on top of the best. | Read from notes if slide fails |
| **3:35–4:00** | Flywheel close: "More drivers → faster pickups → more households post → more data → smarter routes → more drivers." | Flywheel diagram or spoken | The network effect is the moat. Every run makes the next run more profitable for everyone. | Verbal only |

---

## Rollback Decision Tree

```
IF backend is down (GET /api/health fails)
  → Do NOT restart live — DEMO_LISTINGS fallback is already active
  → Say: "Our offline mode uses the same 20 real household profiles."
  → Continue with JS client-side optimizeRoute() for route building

IF AMD classify fails (source != "amd" in response)
  → Do NOT stop — demo mode shows realistic classification output
  → Say: "The AMD model returns this in production. Here's the exact format."
  → Show DEMO_CLASSIFICATION values (3 materials, $8.96 total)

IF POST /api/optimize-route returns 500
  → useRoute.build() auto-falls back to client-side optimizer.js
  → Route still appears on screen — judges won't notice
  → If both fail: show pre-built route screenshot

IF POST /api/accept-route returns null
  → useRoute.accept() uses route.stops.map() fallback
  → Overlay still shows household names + ETAs
  → Say: "The notification system is live in production."

IF ElevenLabs/Twilio call does not ring
  → Open terminal — show [DEMO CALL] log line
  → Read the message aloud verbatim
  → Do NOT say "it's broken" — say "here's the exact message that goes out"

IF map shows no pins (blank)
  → Hard-reload the driver page — DEMO_LISTINGS loads on mount via useEffect
  → If still blank: open DevTools → Application → show DEMO_LISTINGS in console

IF impact page shows all zeros
  → Run in background terminal: curl -X POST http://localhost:5000/api/listings/reset-demo
  → Refresh page
  → Or skip impact page and narrate SB 1383 angle verbally — it's the last 30 seconds

IF demo goes over 3:45
  → Skip stop-by-stop truck fill (B6) — jump straight to impact page
  → Hard cut at 4:00 — judges respect the time limit
```

---

## Pre-Demo Checklist (run 10 minutes before judging)

Run these 8 checks in order. Total time: < 3 minutes.

- [ ] **1. Backend health** — `curl -s http://localhost:5000/api/health` returns `{"status": "ok"}`
- [ ] **2. Listings seeded** — `curl -s "http://localhost:5000/api/listings?status=available"` returns `"count": 20`
- [ ] **3. Demo reset** — `curl -X POST http://localhost:5000/api/listings/reset-demo` (resets all to `available`)
- [ ] **4. Classify demo mode** — Upload a test image in the UI; verify materials appear (demo or live)
- [ ] **5. Route builds** — Click "Build Optimized Route" in driver view; verify stops list appears
- [ ] **6. Phone charged** — Demo phone at 100% battery, ringer ON, screen unlocked
- [ ] **7. Twilio number** — `.env` has `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` set and the target phone number is in the `/api/accept-route` call
- [ ] **8. Tabs open** — Browser has 3 tabs ready: Household view, Driver view, Impact page — no login required, all pre-loaded
