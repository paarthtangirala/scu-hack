# RecycleRun — Twilio + ElevenLabs Telephony: Rehearsal Matrix & Drill Guide
**Branch:** feat/sara/ph4-twilio-elevenlabs-rehearsal
**Owner:** Sara
**Covers:** `backend/services/voice.py`, `backend/routes/optimize.py`, `frontend/src/components/shared/NotificationOverlay.jsx`, `frontend/src/hooks/useRoute.js`

---

## Section A — Credential Combination Matrix

> **Env var names** from `.env.example`:
> - `ELEVENLABS_API_KEY`
> - `TWILIO_ACCOUNT_SID`
> - `TWILIO_AUTH_TOKEN`
> - `TWILIO_PHONE_NUMBER`
>
> **voice.py mode logic:**
> 1. `_generate_audio()` checks `ELEVENLABS_API_KEY`. If missing → returns `None` → demo path.  If key present but ElevenLabs returns non-200 or throws → returns `None` → demo path.
> 2. `notify()`: if `audio is None` → `print("[DEMO CALL]")` → returns `{"success": True, "mode": "demo", "message": "..."}` — never calls `_make_call()`.
> 3. `_make_call()`: checks all three Twilio vars. If any missing → returns `{"success": True, "mode": "demo"}`. If all present and call succeeds → `{"success": True, "mode": "live", "call_sid": "CA..."}`. If Twilio throws → `{"success": False, "mode": "failed", "error": "..."}`.
>
> **NotificationOverlay** (`NotificationOverlay.jsx:16-22`): reads `n.notification?.mode`. Renders green `✓ Called` if `mode === 'live'`, amber `📞 Demo call` for any other value.

| Matrix ID | `ELEVENLABS_API_KEY` | `TWILIO_ACCOUNT_SID` | `TWILIO_AUTH_TOKEN` | `TWILIO_PHONE_NUMBER` | Expected Notifier Mode | Expected `voice.py` Return | Expected UI in `NotificationOverlay` | Demo-Safe |
|-----------|----------------------|----------------------|---------------------|-----------------------|------------------------|----------------------------|-----------------------------------------|:---------:|
| **TC-01** | ✅ Present & valid | ✅ Present & valid | ✅ Present & valid | ✅ Present & valid | `live` | `{"success": True, "mode": "live", "call_sid": "CA..."}` | Green **✓ Called** per household. Calls ring in the room. | Yes |
| **TC-02** | ❌ Missing | ✅ Present & valid | ✅ Present & valid | ✅ Present & valid | `demo` | `_generate_audio()` returns `None`; `_make_call()` never called. `{"success": True, "mode": "demo", "message": "..."}` | Amber **📞 Demo call** per household. No real calls. | Yes |
| **TC-03** | ✅ Present & valid | ❌ Missing (any/all) | ❌ Missing (any/all) | ❌ Missing (any/all) | `demo` | `_generate_audio()` returns audio bytes; `_make_call()` detects missing Twilio creds → `{"success": True, "mode": "demo"}` | Amber **📞 Demo call** per household. No real calls. | Yes |
| **TC-04** | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing | `demo` | `_generate_audio()` → `None`; demo path. `{"success": True, "mode": "demo", "message": "..."}` | Amber **📞 Demo call** per household. Pure demo animation. | Yes |
| **TC-05** | ✅ Present, **invalid** (ElevenLabs returns HTTP 401) | ✅ Present | ✅ Present | ✅ Present | `demo` (graceful fallback) | `_generate_audio()` POSTs with key; ElevenLabs returns 401 → `status_code != 200` → no exception raised → returns `None`. Notify falls to demo path. `{"success": True, "mode": "demo", "message": "..."}` | Amber **📞 Demo call**. No crash. Demo-safe fallback. | Yes |
| **TC-06** | ✅ Present & valid | ✅ Present, **invalid** (Twilio returns 401 / raises `TwilioRestException`) | ✅ Present | ✅ Present | `failed` | `_generate_audio()` succeeds → audio bytes. `_make_call()` creds present → `client.calls.create()` raises `TwilioRestException` → caught → `{"success": False, "mode": "failed", "error": "..."}` | Amber **📞 Demo call** (overlay checks `mode === 'live'`). No crash. | Yes |
| **TC-07** | ✅ Present & valid, but **ElevenLabs network times out** (`requests.Timeout` after 20s) | ✅ Present | ✅ Present | ✅ Present | `demo` (graceful fallback) | `_generate_audio()` raises `requests.Timeout`; caught by `except Exception` → prints error → returns `None`. Demo path. `{"success": True, "mode": "demo", "message": "..."}` | Amber **📞 Demo call**. No crash. Timeout is silent. | Yes |
| **TC-08** | ✅ Present & valid | ✅ Present | ✅ Present | ✅ Present, but **Twilio network times out** | `failed` | `_generate_audio()` succeeds. `_make_call()`: Twilio `client.calls.create()` raises `socket.timeout` or `TwilioRestException` → caught → `{"success": False, "mode": "failed", "error": "..."}` | Amber **📞 Demo call**. `retryable: True` is set in stop result by `_notify_with_retry`. | Yes |
| **TC-09** | ✅ Present & valid | ✅ Present & valid | ✅ Present & valid | ✅ Present & valid, **Twilio fails for a subset of stops** | `failed` (partial) | Per-stop: successful stops → `{"success": True, "mode": "live", "call_sid": "..."}`. Failed stops → `{"success": False, "mode": "failed", "error": "..."}`. `notifications_sent < claimed_count`. `retryable: True` on failed stops. | Mixed: green **✓ Called** for live stops, amber **📞 Demo call** for failed stops. | Yes |

---

## Section B — Notifier Mode Specification

### Mode: `live`

| Dimension | Detail |
|-----------|--------|
| **Trigger** | `ELEVENLABS_API_KEY` set + ElevenLabs returns HTTP 200 + all three Twilio vars set + `client.calls.create()` succeeds without exception |
| **`voice.py` returns** | `{"success": True, "mode": "live", "call_sid": "CAxxxxxxxxxx"}` |
| **`api.js` receives** | `{ ok: true, data: { success: true, notifications_sent: N, notifications: [{..., notification: {success: true, mode: "live", call_sid: "..."}}] } }` |
| **`NotificationOverlay` renders** | Green `✓ Called` label per household (`mode === 'live'` → `var(--green)`). Title: "Route Accepted!". Sub: "ElevenLabs voice calls sent to all N households." |
| **Presenter says** | *"Watch — households are getting a live AI phone call right now. That's ElevenLabs voice, placed by Twilio, telling them their pickup is N minutes away."* |

### Mode: `demo`

| Dimension | Detail |
|-----------|--------|
| **Trigger** | Any of: (a) `ELEVENLABS_API_KEY` missing, (b) ElevenLabs returns non-200, (c) ElevenLabs throws, (d) any Twilio var missing. Voice.py prints `[DEMO CALL]` to console. |
| **`voice.py` returns** | `{"success": True, "mode": "demo", "message": "Hello! This is RecycleRun..."}` |
| **`api.js` receives** | `{ ok: true, data: { success: true, notifications_sent: N, notifications: [{..., notification: {success: true, mode: "demo", message: "..."}}] } }` |
| **`NotificationOverlay` renders** | Amber `📞 Demo call` label per household (any `mode !== 'live'`). Same overlay structure. No calls actually ring. |
| **Presenter says** | *"Notifications are queued for every household on this route. In a full deploy, each one gets a real voice call — for today's demo we're showing the notification flow end to end."* |

### Mode: `failed`

| Dimension | Detail |
|-----------|--------|
| **Trigger** | All Twilio vars present but `client.calls.create()` throws any exception (auth error, network timeout, invalid number, rate limit). `success: False` in the notify result. `_notify_with_retry` retries up to 2 attempts before marking failed. |
| **`voice.py` returns** | `{"success": False, "mode": "failed", "error": "TwilioRestException: ..."}` |
| **`api.js` receives** | `{ ok: true, data: { success: true, notifications_sent: M, notifications: [{..., retryable: true, notification: {success: false, mode: "failed", error: "..."}}] } }` |
| **`NotificationOverlay` renders** | Amber `📞 Demo call` label (overlay does not distinguish `failed` from `demo` — both render amber). Route is still claimed and locked in. |
| **Presenter says** | *"The route is locked in and households are notified through our system — we'll retry any calls that didn't connect automatically."* |

---

## Section C — Rehearsal Scripts

### Script 1 — Live Mode (all credentials working)

**Pre-condition:** `ELEVENLABS_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` all set in `recyclerun-team/.env`. Flask running. A real phone number is in at least one seed listing (or use a test number you own).

**Timing target:** 45 seconds from "tap Accept Route" to "call ends."

---

**[T+0s] — Presenter action:** Open the Driver page. Show the map with clustered household pins.

**Say:** *"Our AI has already built the optimal pickup route for today — highest-value recyclables, shortest drive time."*

**[T+5s] — Presenter action:** Tap **Accept Route**. Keep screen visible to judges.

**Say:** *"I'm accepting the route now — watch what happens."*

**[T+6s — T+10s] — Backend processing (silent, let it happen):**
- `/api/accept-route` POSTed.
- For each stop: `store.claim_listing()` → `_notify_with_retry()` → `_generate_audio()` (~2-4s ElevenLabs call) → `_make_call()` → Twilio `client.calls.create()`.
- Response arrives: `{ notifications_sent: N, notifications: [{mode: "live", call_sid: "CA..."}] }`

**[T+10s] — UI event:** `NotificationOverlay` appears. Each row shows **✓ Called** in green.

**Presenter action:** Point at the overlay.

**Say:** *"That's it — the system just called every household on the route. Real phone calls, right now."*

**[T+12s — T+25s] — WOW MOMENT:** The phone designated as the "Chen Family" pickup rings in the room.

**Presenter action:** Pick up the phone (or let it ring audibly). Put on speaker if possible.

**Say (before answering):** *"Hear that? That's ElevenLabs AI voice placed by Twilio — not pre-recorded, generated fresh with the driver's name and exact ETA."*

**[T+25s] — Call plays:** *"Hello! This is RecycleRun. [Driver Name] has accepted your recycling pickup and will arrive in approximately [N] minutes. Please have your recyclables ready at the curb. You're helping keep the Bay Area green — thank you!"*

**Say (after call):** *"One tap. Every household notified. Driver is already on their way."*

**[T+40s] — Presenter action:** Tap **Start Route →** in the overlay.

**Say:** *"The driver's navigation is live. Recyclables are being diverted from landfill right now."*

---

**Contingency if call takes > 15s:** ElevenLabs TTS can be slow. If the overlay appears with ✓ Called but the phone hasn't rung yet: *"The call is connecting — ElevenLabs is generating a personalized AI voice message for this household."* The call will ring within 20 seconds of the overlay appearing.

---

### Script 2 — Demo-Only Mode (no credentials / fallback)

**Pre-condition:** No telephony env vars set (or set to placeholder values). Flask running. Demo seed data loaded.

**Timing target:** 30 seconds from "tap Accept Route" to "Start Route."

---

**[T+0s] — Presenter action:** Open the Driver page. Show the route card with stops, lbs, and estimated value.

**Say:** *"Our routing engine has optimized for maximum recycling yield in minimum drive time — copper wire first, then CRT pickups, then cardboard."*

**[T+5s] — Presenter action:** Tap **Accept Route**.

**Say:** *"Accepting the route — the system locks in every stop and notifies all households simultaneously."*

**[T+6s — T+8s] — Backend processing:** `/api/accept-route` runs, voice.py prints `[DEMO CALL]` to console (not visible to judges), returns `mode: "demo"` per stop.

**[T+8s] — UI event:** `NotificationOverlay` appears. Each row shows **📞 Demo call** in amber.

**Presenter action:** Gesture at the overlay smoothly — keep energy up. Do NOT pause on the amber label.

**Say:** *"Every household on this route just received a notification — name of the driver, exact ETA, what to put at the curb. The AI voice call goes out the moment the driver accepts."*

**[T+12s] — Presenter action:** Scroll through the notification list slowly, pointing to each household name and ETA.

**Say:** *"Chen Family — 8 minutes. Rivera Household — 14 minutes. Park Residence — 21 minutes. All confirmed."*

**[T+20s] — Presenter action:** Tap **Start Route →**.

**Say:** *"Driver is navigating. Households are ready. Recyclables that would have gone to landfill are being diverted — right now."*

---

**Key rule for Script 2:** Never say "live call" or "phone ringing." Say "notification," "alert," or "voice message." The overlay animation is the visual wow — lean into it. Judges see real household names, real ETAs, real route data. The communication layer is complete.

---

## Section D — Fallback Drill (under 3 minutes)

Run this checklist immediately before judging. Takes ≤ 3 minutes.

### Step 1 — Check which env vars are set (30 seconds)

```bash
cd recyclerun-team
grep -E "ELEVENLABS_API_KEY|TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_PHONE_NUMBER" .env
```

Look at the values:
- If all four lines show real values (not `YOUR_...` placeholders) → **proceed to Step 2**
- If any line shows a placeholder or is missing → **jump to Decision Tree → Script 2**

### Step 2 — Trigger a test call to verify live mode (90 seconds)

```bash
# Flask must be running. Replace the phone number with one you own.
curl -s -X POST http://localhost:5000/api/accept-route \
  -H "Content-Type: application/json" \
  -d '{
    "stops": [{"listing_id": "listing_001", "eta_minutes": 10}],
    "driver_name": "Test Driver"
  }' | python3 -m json.tool
```

Inspect the response:
- Look at `notifications[0].notification.mode`
- `"mode": "live"` → your phone rings within 20 seconds → **Script 1**
- `"mode": "demo"` → no call, credentials not working → **Script 2**
- `"mode": "failed"` → Twilio creds set but call failed (wrong SID/token/number) → **Script 2** + fix creds if time allows

After this test call, run a demo reset so the stop isn't already claimed for the real demo:

```bash
curl -s -X POST http://localhost:5000/api/listings/reset-demo
```

### Step 3 — Decision Tree

```
All 4 env vars set with real values?
│
├─ NO  → Use SCRIPT 2 (demo-only)
│
└─ YES → Did the test call return mode "live" AND did the phone ring?
         │
         ├─ YES → Use SCRIPT 1 (live mode) ✓
         │
         └─ NO  → Use SCRIPT 2 (demo-only)
                  (If time allows: check TWILIO_PHONE_NUMBER format +1XXXXXXXXXX,
                   verify SID starts with "AC", token is 32 chars)
```

### Quick-reference: mode indicators at a glance

| You see in response | Notifier mode | Script to use |
|---------------------|---------------|---------------|
| `"mode": "live"` in notifications | live | Script 1 |
| `"mode": "demo"` in notifications | demo | Script 2 |
| `"mode": "failed"` in notifications | failed | Script 2 |
| `response.ok === false` (api.js) | backend down | Script 2 |
