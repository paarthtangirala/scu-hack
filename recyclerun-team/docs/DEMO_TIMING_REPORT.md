# Bin2Bucks — 4-Minute Demo Timing Report
**Date:** 2026-02-28
**Branch:** feat/sara/ph5-regression-timing-report
**Owner:** Sara
**Source:** Derived from `docs/DEMO_STORYLINE.md` timestamps + codebase latency analysis

---

## Section A — Primary Path Timing Table

> **Primary path:** Flask backend running, AMD_API_KEY set, Twilio/ElevenLabs credentials set (Script 1 / live mode).
> Median observed = best-case with real credentials on local network. Worst case = slow AMD API or ElevenLabs TTS.

| Beat ID | Action | Start | End | Budget (s) | Median (s) | Worst Case (s) | Buffer (s) | Risk |
|---------|--------|-------|-----|-----------|-----------|----------------|-----------|------|
| B-01 | Verbal open — SB 1383 stat, Bin2Bucks pitch | 0:00 | 0:10 | 10 | 10 | 12 | -2 | Low — verbal only, no tech |
| B-02 | Navigate to Household page; frame Maria's scenario | 0:10 | 0:30 | 20 | 8 | 12 | +8 | Low — page is pre-loaded |
| B-03 | Select photo, click "Classify with AI" → AMD → result renders | 0:30 | 0:50 | 20 | 4 | 12 | +8 | **Medium** — AMD API 2–10s; see W-03 |
| B-04 | Show material breakdown ($8.96, 19.5 lbs); click Submit → `POST /api/listings` | 0:50 | 1:00 | 10 | 3 | 6 | +4 | Low — POST is fast, response not checked |
| B-05 | Switch to Driver view; show map with 20 pins | 1:00 | 1:20 | 20 | 5 | 10 | +10 | Low — tab pre-loaded; DEMO_LISTINGS renders on mount |
| B-06 | Click "Build Optimized Route" (120 min, 1000 lb, value) → stops + summary appear | 1:20 | 1:45 | 25 | 3 | 8 | +17 | Low — OR-Tools ≤2s; greedy fallback <1s |
| B-07 | Show route summary (stops, value, miles, solver); click "Accept Route" | 1:45 | 2:00 | 15 | 5 | 8 | +7 | Low — click interaction only |
| B-08 | **WOW:** NotificationOverlay appears; ElevenLabs call rings in room | 2:00 | 2:15 | 15 | 8 | 25 | -10 | **High** — ElevenLabs TTS 2–5s + Twilio dial 3–8s; see W-04 |
| B-09 | Walk stop-by-stop truck fill: 0% → 8% → 24% → 41%; earnings tick up | 2:15 | 2:40 | 25 | 20 | 30 | -5 | **Medium** — 3 taps + narration; can skip 1 stop if behind |
| B-10 | Mark stops complete; navigate to Impact page | 2:40 | 3:00 | 20 | 8 | 12 | +8 | Low — `GET /api/impact` <500ms |
| B-11 | Show impact numbers; CO2 calculation aloud | 3:00 | 3:20 | 20 | 15 | 20 | 0 | Low — verbal + static numbers |
| B-12 | Sponsor callout (AMD Instinct, ElevenLabs) | 3:20 | 3:35 | 15 | 12 | 15 | 0 | Low — slide or verbal |
| B-13 | Flywheel close: network effects | 3:35 | 4:00 | 25 | 22 | 25 | 0 | Low — verbal |
| **TOTAL** | | **0:00** | **4:00** | **240s** | **123s** | **185s** | **+55s net** | |

> **Net buffer (primary path):** ~55s of accumulated positive buffer offset the worst-case overruns at B-08 and B-09. The demo fits in 4:00 if B-08 ElevenLabs call is pre-tested.

---

## Section B — Backup Path Timing Table

> **Backup path:** Backend down or credentials missing. `DEMO_LISTINGS` + client-side `optimizer.js` + `mode: "demo"` notifications. All latency from network removed.

| Beat ID | Action | Start | End | Budget (s) | Backup Median (s) | Backup Worst (s) | Buffer (s) | Why Faster |
|---------|--------|-------|-----|-----------|-----------------|-----------------|-----------|------------|
| B-01 | Verbal open | 0:00 | 0:10 | 10 | 10 | 12 | -2 | Same (verbal) |
| B-02 | Navigate to Household page | 0:10 | 0:30 | 20 | 8 | 10 | +10 | Same |
| B-03 | Photo select → DEMO_CLASSIFICATION renders instantly | 0:30 | 0:50 | 20 | 2 | 3 | +17 | No AMD network call; `res \|\| DEMO_CLASSIFICATION` activates immediately |
| B-04 | Show $8.96; click Submit (optimistic toast fires) | 0:50 | 1:00 | 10 | 2 | 4 | +6 | `post()` doesn't await API result; toast fires immediately |
| B-05 | Switch to Driver view; DEMO_LISTINGS renders on mount | 1:00 | 1:20 | 20 | 2 | 4 | +16 | `useListings` seeds from DEMO_LISTINGS synchronously before fetch |
| B-06 | "Build Route" → client-side `optimizeRoute()` → result instant | 1:20 | 1:45 | 25 | 1 | 2 | +23 | Pure JS greedy, no network call, <50ms |
| B-07 | Show summary; click "Accept Route" | 1:45 | 2:00 | 15 | 5 | 8 | +7 | Same |
| B-08 | **WOW (demo):** NotificationOverlay with amber 📞 Demo call labels | 2:00 | 2:15 | 15 | 3 | 5 | +10 | No ElevenLabs/Twilio; overlay renders immediately from local stop map |
| B-09 | Stop progression — same pure-frontend flow | 2:15 | 2:40 | 25 | 20 | 28 | -3 | Same; can skip 1 stop if behind |
| B-10 | Impact page → zeros or pre-reset data | 2:40 | 3:00 | 20 | 5 | 8 | +12 | GET /api/impact is fast or zeros if backend down; skip to verbal if needed |
| B-11 | CO2 aloud | 3:00 | 3:20 | 20 | 15 | 20 | 0 | Same |
| B-12 | Sponsor callout | 3:20 | 3:35 | 15 | 12 | 15 | 0 | Same |
| B-13 | Flywheel close | 3:35 | 4:00 | 25 | 22 | 25 | 0 | Same |
| **TOTAL** | | **0:00** | **4:00** | **240s** | **107s** | **144s** | **+96s net** | |

> **Backup path is faster by ~41s** (median) due to elimination of all network latency at B-03, B-04, B-05, B-06, and B-08. Backup path comfortably fits within 4:00 even at worst case.

---

## Section C — Timing Risk Analysis

### Risk 1 — ElevenLabs TTS generation is slow (Beat B-08)

| Field | Detail |
|-------|--------|
| **Beat** | B-08 — WOW moment (ElevenLabs call rings) |
| **Worst-case impact** | +10s over budget (25s observed vs 15s budget) |
| **Probability** | **High** — ElevenLabs free/starter tier throttles TTS to 3–8s; paid tier ~2s |
| **Root cause** | `voice.py:_generate_audio()` uses `timeout=20`. TTS request + Twilio `client.calls.create()` are sequential, not parallel. 3-stop route = 3× TTS + 3× Twilio dial before response returns. |
| **Mitigation** | (1) Reduce demo route to 1–2 stops for the accept-route demo; (2) Pre-test the call at venue 30 minutes before judging; (3) If call takes >10s after overlay appears, narrate: "The AI voice is being generated right now — it's personalized for this household." |

### Risk 2 — AMD Vision classify is slow or returns error (Beat B-03)

| Field | Detail |
|-------|--------|
| **Beat** | B-03 — Photo classify |
| **Worst-case impact** | +8s over median (12s AMD slow vs 4s median) |
| **Probability** | **Medium** — AMD hosted API is generally <5s; hackathon venue WiFi may add 3–5s |
| **Root cause** | `vision.py:_try_amd()` uses `timeout=30`. Network round-trip + model inference on AMD Instinct. |
| **Mitigation** | (1) Upload photo before tapping "Classify" to reduce perceived wait; (2) If classify takes >8s, narrate: "The AMD Llama Vision model is analyzing the image — it identifies 12 material types."; (3) `DEMO_CLASSIFICATION` fallback activates silently if key missing — demo still works. |

### Risk 3 — Stop progression runs long (Beat B-09)

| Field | Detail |
|-------|--------|
| **Beat** | B-09 — 3-stop truck fill walkthrough |
| **Worst-case impact** | +5s over budget (30s vs 25s) |
| **Probability** | **Medium** — Narrating 3 stops while tapping takes ~8–10s per stop |
| **Root cause** | Presenter needs to tap, narrate lbs change, narrate earnings change, and advance — three separate talking points per stop |
| **Mitigation** | (1) Rehearse to 2 stops instead of 3 if running behind at 2:15; (2) Skip narration on stop 2, only narrate on stop 1 and stop 3 (enter/exit effect); (3) If behind schedule at 2:40, skip directly to Impact page. |

### Risk 4 — Impact page shows zeros (Beat B-10)

| Field | Detail |
|-------|--------|
| **Beat** | B-10 — Impact stats |
| **Worst-case impact** | Demo moment falls flat; CO2 number is 0 |
| **Probability** | **High** — Seed data has `status: "available"` listings; `impact_stats()` only counts `status == "completed"` |
| **Root cause** | `ListingStore.impact_stats()` filters on `l.status == "completed"`. New demo session has 0 completed pickups. |
| **Mitigation** | (1) Before judging: accept a route with 2–3 stops, then `POST /api/listings/{id}/complete` each one via DevTools or terminal; (2) Run `POST /api/listings/reset-demo` if any stops were accidentally claimed; (3) If impact still zero, narrate: "After one full run, the system shows 210 lbs diverted — that's 105 lbs of CO2 avoided." Use pre-rehearsed numbers. |

---

## Section D — Rehearsal Recommendations

### Beats requiring most rehearsal

1. **B-08 (ElevenLabs call)** — Rehearse this beat live with Twilio at least 3 times before judging. Time the gap between tapping "Accept Route" and hearing the phone ring. Know your exact words if the gap is >10s.

2. **B-09 (Stop progression)** — Rehearse tapping 3 stops while narrating without losing track of the numbers. Have the values memorized: stop 1 fills 8%, earnings add $8.75; stop 2 fills 24%, earnings add $48.61; stop 3 fills 41%, earnings add $13.42.

3. **B-06 (Build route)** — Rehearse transitioning from the map view to the route card. Know what "solver: ortools" means to say: "Same solver Google Logistics uses." Practice once with backend down to feel the greedy fallback path — it's seamless.

### Sponsor integrations to pre-test day-of

| Integration | Pre-test action | When |
|-------------|----------------|------|
| AMD Vision | Upload test image; verify `source: "amd"` in response | 1 hour before judging |
| ElevenLabs + Twilio | Run accept-route with 1 real stop; verify phone rings within 12s | 30 minutes before judging |
| Backend health | `curl http://localhost:5050/api/health` (note: port 5050 default in app.py) | 10 minutes before judging |
| Impact page numbers | Complete 2–3 pickups; verify non-zero CO2 on impact page | 10 minutes before judging |

### If running over time mid-demo

| Situation | Action |
|-----------|--------|
| Behind by 15s at B-08 (2:15) | Skip narration during B-09 stop 2; tap quickly and only speak at stop 3 |
| Behind by 30s at B-09 (2:40) | Skip B-09 entirely; jump straight to Impact page and narrate numbers verbally |
| Behind by 45s+ at any point | Jump to B-13 (flywheel close) immediately; judges value clarity over completeness |
| AMD classify takes >12s | Say "the model is processing" and advance to B-04 manually; demo mode already shows correct output |
| ElevenLabs call not ringing after overlay | Open terminal; show `[DEMO CALL]` log line; read the message aloud at normal speaking pace |
