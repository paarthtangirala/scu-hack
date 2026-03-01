/**
 * Pure backup flow controller — assesses system state and returns recovery steps.
 * No React, no side effects, no API calls.
 * Owner: Sara
 *
 * Field names mirror the actual response shapes from the codebase:
 *   healthResponse    — raw data from GET /api/health: { status: 'ok', total_listings: number }
 *   optimizeResponse  — caller-mapped shape: { route: RouteStop[], summary: {} }
 *                       (backend returns { stops, summary }; caller maps stops → route)
 *   acceptResponse    — raw data from POST /api/accept-route:
 *                       { success, notifications_sent, notifications: [{ notification: { mode } }] }
 *
 * Notifier mode logic mirrors notifierMode.js (getNotifierMode):
 *   any notification.mode 'failed' → 'failed'
 *   any notification.mode 'live'   → 'live'
 *   otherwise                      → 'demo'
 */

import { getNotifierMode } from './notifierMode.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

function _deriveNotifierMode(acceptResponse) {
  if (!acceptResponse || typeof acceptResponse !== 'object') return 'demo';
  return getNotifierMode(acceptResponse);
}

function _deriveOutages(backendUp, optimizerWorking, notifierMode) {
  const outages = [];
  if (!backendUp) {
    outages.push('Backend unreachable — Flask server not responding (check port 5050, restart with python -m backend.app)');
  }
  if (!optimizerWorking) {
    outages.push('Route optimizer returned no stops — check listings are seeded and constraints allow at least one stop');
  }
  if (notifierMode === 'demo') {
    outages.push('Voice notifier in demo mode — Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER)');
  }
  if (notifierMode === 'failed') {
    outages.push('Voice notifier failed — Twilio call threw an exception; check credentials validity and account balance');
  }
  return outages;
}

// ── Outage playbook ───────────────────────────────────────────────────────────

const BACKUP_BRANCHES = {
  'BO-01': {
    outageCode: 'BO-01',
    title: 'Backend down — Flask server not responding',
    steps: [
      'Check that Flask is running: `python -m backend.app` from repo root (default port 5050).',
      'Verify port: app.py defaults to PORT=5050; update curl/smoke commands if using 5000.',
      'If Flask fails to start, check .env for missing AMD_API_KEY or malformed vars.',
      'DEMO_LISTINGS fallback activates automatically in useListings on mount — driver map still shows 20 pins.',
      'Client-side optimizeRoute() in optimizer.js activates via mapPipeline — route still builds.',
      'Accept-route falls back to local stop map in useRoute.accept() — overlay still shows household ETAs.',
      'Say: "Our offline mode uses the same 20 real household profiles — the routing and notification flow is identical."',
    ],
    timeCostSeconds: 60,
    wowMomentPreserved: false,
  },
  'BO-02': {
    outageCode: 'BO-02',
    title: 'Optimizer returned empty route — no stops fit constraints',
    steps: [
      'Run `GET /api/listings?status=available` — verify at least 15 listings are seeded.',
      'If listings are all claimed/completed, run `POST /api/listings/reset-demo` to restore seed data.',
      'Retry Build Route with looser constraints: increase max_minutes to 180, truck_capacity_lbs to 2000.',
      'If backend optimizer fails, client-side optimizer.js runs automatically via mapPipeline — same greedy algorithm.',
      'Say: "Our system self-heals to a local greedy solver — the route still appears."',
    ],
    timeCostSeconds: 30,
    wowMomentPreserved: false,
  },
  'BO-03': {
    outageCode: 'BO-03',
    title: 'ElevenLabs missing — voice.py now uses Twilio Polly directly',
    steps: [
      'Note: current voice.py does not use ElevenLabs — it calls Twilio with <Say voice="Polly.Joanna">.',
      'If this outage fires, verify TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER are set in .env.',
      'If Twilio creds missing, voice returns mode "demo" — no call fires; overlay shows amber labels.',
      'Use Script 2 from TWILIO_ELEVENLABS_REHEARSAL_MATRIX.md (demo-only rehearsal script).',
      'Say: "Households receive a voice notification the moment the driver accepts — here is the exact message that goes out."',
    ],
    timeCostSeconds: 30,
    wowMomentPreserved: false,
  },
  'BO-04': {
    outageCode: 'BO-04',
    title: 'Twilio credentials missing — voice notifier falls back to demo mode',
    steps: [
      'Check .env for TWILIO_ACCOUNT_SID (starts with "AC"), TWILIO_AUTH_TOKEN (32 chars), TWILIO_PHONE_NUMBER (+1XXXXXXXXXX).',
      'voice.py _make_call() returns { success: true, mode: "demo", reason: "twilio_not_configured" } when any cred is missing.',
      'Overlay shows amber "📞 Demo call" labels — no crash, demo-safe.',
      'Switch to Script 2 from rehearsal matrix; do not mention "demo mode" explicitly.',
      'Say: "Notifications queued for all households — in production each one gets a direct voice call."',
    ],
    timeCostSeconds: 30,
    wowMomentPreserved: false,
  },
  'BO-05': {
    outageCode: 'BO-05',
    title: 'Twilio dial fails — exception during call placement',
    steps: [
      'voice.py returns { success: false, mode: "failed", reason: "twilio_exception"|"twilio_timeout" }.',
      '_notify_with_retry retries up to 2 attempts before marking failed — check if retry succeeded.',
      'Verify TWILIO_ACCOUNT_SID/AUTH_TOKEN are valid (not expired), account has call credits.',
      'Check TWILIO_PHONE_NUMBER format: must be E.164 (+1XXXXXXXXXX), must be a Twilio-owned number.',
      'If all retries fail, overlay still renders (amber labels); route is still claimed and locked.',
      'Use recovery language: "Our system will retry the calls automatically — the pickup route is already locked in."',
      'Run POST /api/listings/reset-demo and re-demo the accept step if time allows.',
    ],
    timeCostSeconds: 45,
    wowMomentPreserved: false,
  },
  'BO-06': {
    outageCode: 'BO-06',
    title: 'NotificationOverlay broken — render crash after accept-route',
    steps: [
      'Hard-reload the driver page (Cmd+Shift+R) — clears component state.',
      'Check browser DevTools console for the specific JS error and line number.',
      'useRoute.accept() generates fallback notifications from route.stops if backend fails — overlay data is available.',
      'If overlay still crashes, describe it verbally: read household names and ETAs from the route card.',
      'Say: "Each household on the route receives a notification like this — [read one ETA aloud]."',
      'Skip overlay beat entirely if needed; jump to stop progression narration.',
    ],
    timeCostSeconds: 15,
    wowMomentPreserved: false,
  },
  'BO-07': {
    outageCode: 'BO-07',
    title: 'AMD classify error — vision API unavailable or key missing',
    steps: [
      'vision.py _demo_result() activates automatically — returns 3 demo materials (cardboard/aluminum/PET), source: "demo".',
      'PhotoUpload renders demo classification result — household flow continues normally.',
      'Say: "The AMD Llama Vision model identifies materials in production — here is the exact output format it returns."',
      'Manual entry via ManualMaterials is always available as a parallel path.',
      'Route building, accept-route, and voice notifications are entirely unaffected.',
    ],
    timeCostSeconds: 0,
    wowMomentPreserved: true,
  },
  'BO-08': {
    outageCode: 'BO-08',
    title: 'Google Maps fails — map tiles or API key error',
    steps: [
      'Check VITE_GOOGLE_MAPS_KEY is set in frontend .env and not expired.',
      'Hard-reload; map initializes on mount — a single reload often resolves tile load failures.',
      'DEMO_LISTINGS are still available in-memory; route building and accept-route are unaffected.',
      'Narrate the map verbally: "20 pickups pinned across Santa Clara — copper wire, e-waste, cardboard."',
      'Route card (RouteBanner) shows stops in order — present that instead of the map view.',
      'Say: "The routing engine has already clustered the highest-value stops — here is the optimized sequence."',
    ],
    timeCostSeconds: 30,
    wowMomentPreserved: true,
  },
};

const DEFAULT_BACKUP_BRANCH = {
  outageCode: 'UNKNOWN',
  title: 'Unknown outage code',
  steps: [
    'Outage code not recognized. Reference TWILIO_ELEVENLABS_REHEARSAL_MATRIX.md Section D for the fallback drill.',
    'If backend is down, DEMO_LISTINGS + client-side optimizer cover all demo beats.',
    'If voice calls fail, use Script 2 from the rehearsal matrix.',
  ],
  timeCostSeconds: 30,
  wowMomentPreserved: false,
};

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Assess the current system state from three probe responses.
 * All inputs may be null/undefined — never throws.
 *
 * @param {object|null} healthResponse   Raw data from GET /api/health: { status, total_listings }
 * @param {object|null} optimizeResponse Caller-mapped shape: { route: RouteStop[] } (backend field: stops)
 * @param {object|null} acceptResponse   Raw data from POST /api/accept-route: { notifications: [...] }
 * @returns {{ backendUp: boolean, optimizerWorking: boolean, notifierMode: 'live'|'demo'|'failed', recommendedScript: 'primary'|'backup', outages: string[] }}
 */
export function assessSystemState(healthResponse, optimizeResponse, acceptResponse) {
  try {
    const backendUp = !!(healthResponse && healthResponse.status === 'ok');

    const route = optimizeResponse?.route;
    const optimizerWorking = Array.isArray(route) && route.length >= 1;

    const notifierMode = _deriveNotifierMode(acceptResponse);

    const outages = _deriveOutages(backendUp, optimizerWorking, notifierMode);

    const recommendedScript =
      backendUp && optimizerWorking && notifierMode === 'live' ? 'primary' : 'backup';

    return { backendUp, optimizerWorking, notifierMode, recommendedScript, outages };
  } catch {
    return {
      backendUp: false,
      optimizerWorking: false,
      notifierMode: 'demo',
      recommendedScript: 'backup',
      outages: ['assessSystemState: unexpected error evaluating system state'],
    };
  }
}

/**
 * Return the backup branch playbook for a given outage code.
 * Never throws — returns a safe default for unknown codes.
 *
 * @param {'BO-01'|'BO-02'|'BO-03'|'BO-04'|'BO-05'|'BO-06'|'BO-07'|'BO-08'|string} outageCode
 * @returns {{ outageCode: string, title: string, steps: string[], timeCostSeconds: number, wowMomentPreserved: boolean }}
 */
export function getBackupBranch(outageCode) {
  try {
    return BACKUP_BRANCHES[outageCode] ?? { ...DEFAULT_BACKUP_BRANCH, outageCode: outageCode ?? 'UNKNOWN' };
  } catch {
    return { ...DEFAULT_BACKUP_BRANCH };
  }
}

/**
 * Returns true if the full fallback (DEMO_LISTINGS + client-side optimizer) is required.
 * True when backend is down OR optimizer produced no route.
 * Null input returns true (fail-safe).
 *
 * @param {object|null} systemState
 * @returns {boolean}
 */
export function isFullFallbackRequired(systemState) {
  if (!systemState || typeof systemState !== 'object') return true;
  return !systemState.backendUp || !systemState.optimizerWorking;
}

/**
 * Returns the demo script to use based on system state.
 * 'primary' only when backend is up, optimizer has stops, AND at least one live call succeeded.
 * Everything else returns 'backup'. Null input returns 'backup' (fail-safe).
 *
 * @param {object|null} systemState
 * @returns {'primary'|'backup'}
 */
export function getDemoScript(systemState) {
  if (!systemState || typeof systemState !== 'object') return 'backup';
  const { backendUp, optimizerWorking, notifierMode } = systemState;
  if (backendUp === true && optimizerWorking === true && notifierMode === 'live') return 'primary';
  return 'backup';
}

/**
 * Returns a human-readable list of outage descriptions from system state.
 * Empty array if no outages or null input — never throws.
 *
 * @param {object|null} systemState
 * @returns {string[]}
 */
export function getOutageSummary(systemState) {
  try {
    if (!systemState || !Array.isArray(systemState.outages)) return [];
    return systemState.outages;
  } catch {
    return [];
  }
}
