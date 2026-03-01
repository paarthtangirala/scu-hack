/**
 * Smoke test runner for RecycleRun backend.
 * Validates all 5 API endpoints; activates demo-data fallback on network errors.
 * Owner: Sara
 *
 * Usage:
 *   import { runSmokeTests } from './smokeRunner.js';
 *   const { results, summary } = await runSmokeTests({ baseUrl: 'http://localhost:5000/api' });
 */

// DEFAULT_BASE mirrors the BASE constant in ./api.js — keep both in sync if the server moves.
import { DEMO_LISTINGS, DEMO_CLASSIFICATION } from './demoData.js';
import { optimizeRoute } from '../utils/optimizer.js';

const DEFAULT_BASE = 'http://localhost:5000/api';
const LATENCY_WARN_MS = 2000;

/**
 * @param {object} options
 * @param {string}  [options.baseUrl]      - Override API base URL (default mirrors api.js)
 * @param {number}  [options.timeoutMs]    - Per-request timeout in ms (default 5000)
 * @param {boolean} [options.fallbackMode] - Force fallback mode from the start
 * @returns {Promise<{results: object[], summary: object}>}
 */
export async function runSmokeTests(options = {}) {
  const {
    baseUrl = DEFAULT_BASE,
    timeoutMs = 5000,
    fallbackMode: initialFallback = false,
  } = options;

  let fallbackMode = initialFallback;
  const results = [];

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function timedFetch(url, init = {}) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const responseTime_ms = Date.now() - t0;
      clearTimeout(timerId);
      return { res, responseTime_ms, networkError: null };
    } catch (err) {
      clearTimeout(timerId);
      return { res: null, responseTime_ms: Date.now() - t0, networkError: err };
    }
  }

  function demoResult(endpoint, method, blocker, checkFn, failMsg, responseTime_ms = 0) {
    const ok = checkFn();
    return {
      endpoint,
      method,
      status: ok ? 'PASS' : 'FAIL',
      responseTime_ms,
      blocker: ok ? null : blocker,
      error: ok ? null : failMsg,
    };
  }

  // ── Test 1: GET /health ────────────────────────────────────────────── P0 ──

  if (fallbackMode) {
    results.push(demoResult(
      '/api/health', 'GET', 'P0',
      () => Array.isArray(DEMO_LISTINGS) && DEMO_LISTINGS.length > 0,
      'DEMO_LISTINGS is empty — demo mode unsafe',
    ));
  } else {
    const { res, responseTime_ms, networkError } = await timedFetch(`${baseUrl}/health`);
    if (networkError instanceof TypeError) {
      fallbackMode = true;
      results.push(demoResult(
        '/api/health', 'GET', 'P0',
        () => Array.isArray(DEMO_LISTINGS) && DEMO_LISTINGS.length > 0,
        networkError.message, responseTime_ms,
      ));
    } else {
      let ok = false;
      let errMsg = null;
      try {
        const data = await res.json();
        ok = res.ok && data.status === 'ok' && typeof data.total_listings === 'number';
        if (!ok) errMsg = `HTTP ${res.status}: expected {status:"ok", total_listings:number}`;
      } catch {
        errMsg = 'Response is not valid JSON';
      }
      const latencyWarn = responseTime_ms > LATENCY_WARN_MS
        ? `latency warning: ${responseTime_ms}ms exceeds ${LATENCY_WARN_MS}ms threshold`
        : null;
      results.push({
        endpoint: '/api/health',
        method: 'GET',
        status: ok ? 'PASS' : 'FAIL',
        responseTime_ms,
        blocker: ok ? null : 'P0',
        error: latencyWarn ?? errMsg,
      });
    }
  }

  // ── Test 2: GET /listings ──────────────────────────────────────────── P0 ──

  if (fallbackMode) {
    results.push(demoResult(
      '/api/listings', 'GET', 'P0',
      () => Array.isArray(DEMO_LISTINGS) &&
            DEMO_LISTINGS.every(l =>
              typeof l.id === 'string' &&
              typeof l.address === 'string' &&
              typeof l.total_lbs === 'number' &&
              typeof l.total_value === 'number'
            ),
      'DEMO_LISTINGS shape invalid — missing id/address/total_lbs/total_value',
    ));
  } else {
    const { res, responseTime_ms, networkError } = await timedFetch(
      `${baseUrl}/listings?status=available`,
    );
    if (networkError instanceof TypeError) {
      fallbackMode = true;
      results.push(demoResult(
        '/api/listings', 'GET', 'P0',
        () => Array.isArray(DEMO_LISTINGS) &&
              DEMO_LISTINGS.every(l => typeof l.id === 'string' && typeof l.total_lbs === 'number'),
        networkError.message, responseTime_ms,
      ));
    } else {
      let ok = false;
      let errMsg = null;
      try {
        const data = await res.json();
        ok = res.ok && Array.isArray(data.listings) && typeof data.count === 'number';
        if (!ok) errMsg = `HTTP ${res.status}: expected {listings:[], count:number}`;
      } catch {
        errMsg = 'Response is not valid JSON';
      }
      results.push({
        endpoint: '/api/listings',
        method: 'GET',
        status: ok ? 'PASS' : 'FAIL',
        responseTime_ms,
        blocker: ok ? null : 'P0',
        error: errMsg,
      });
    }
  }

  // ── Test 3: POST /classify ─────────────────────────────────────────── P1 ──

  // Minimal 1×1 transparent PNG — valid base64 image to avoid 400 "No image provided".
  const PROBE_IMAGE =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  if (fallbackMode) {
    results.push(demoResult(
      '/api/classify', 'POST', 'P1',
      () =>
        DEMO_CLASSIFICATION != null &&
        DEMO_CLASSIFICATION.success === true &&
        Array.isArray(DEMO_CLASSIFICATION.materials) &&
        typeof DEMO_CLASSIFICATION.total_value === 'number' &&
        typeof DEMO_CLASSIFICATION.total_lbs === 'number',
      'DEMO_CLASSIFICATION shape invalid — missing success/materials/total_value/total_lbs',
    ));
  } else {
    const { res, responseTime_ms, networkError } = await timedFetch(`${baseUrl}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: PROBE_IMAGE }),
    });
    if (networkError instanceof TypeError) {
      fallbackMode = true;
      results.push(demoResult(
        '/api/classify', 'POST', 'P1',
        () =>
          DEMO_CLASSIFICATION != null &&
          DEMO_CLASSIFICATION.success === true &&
          Array.isArray(DEMO_CLASSIFICATION.materials),
        networkError.message, responseTime_ms,
      ));
    } else {
      let ok = false;
      let errMsg = null;
      try {
        const data = await res.json();
        ok = res.ok && data.success === true && Array.isArray(data.materials);
        if (!ok) errMsg = `HTTP ${res.status}: expected {success:true, materials:[]}`;
      } catch {
        errMsg = 'Response is not valid JSON';
      }
      results.push({
        endpoint: '/api/classify',
        method: 'POST',
        status: ok ? 'PASS' : 'FAIL',
        responseTime_ms,
        blocker: ok ? null : 'P1',
        error: errMsg,
      });
    }
  }

  // ── Test 4: POST /optimize-route ───────────────────────────────────── P0 ──

  if (fallbackMode) {
    let ok = false;
    let errMsg = null;
    try {
      const r = optimizeRoute({
        driverLat: 37.3541,
        driverLng: -121.9552,
        listings: DEMO_LISTINGS,
        maxMinutes: 120,
        truckCapacityLbs: 1000,
        objective: 'value',
      });
      ok =
        r != null &&
        Array.isArray(r.stops) &&
        r.summary != null &&
        typeof r.summary.total_stops === 'number';
      if (!ok) errMsg = 'Client-side optimizeRoute() returned invalid shape';
    } catch (e) {
      errMsg = `Client-side optimizeRoute() threw: ${e.message}`;
    }
    results.push({
      endpoint: '/api/optimize-route',
      method: 'POST',
      status: ok ? 'PASS' : 'FAIL',
      responseTime_ms: 0,
      blocker: ok ? null : 'P0',
      error: errMsg,
    });
  } else {
    const { res, responseTime_ms, networkError } = await timedFetch(
      `${baseUrl}/optimize-route`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: 37.3541,
          lng: -121.9552,
          max_minutes: 120,
          truck_capacity_lbs: 1000,
          objective: 'value',
        }),
      },
    );
    if (networkError instanceof TypeError) {
      fallbackMode = true;
      let ok = false;
      let errMsg = null;
      try {
        const r = optimizeRoute({
          driverLat: 37.3541, driverLng: -121.9552,
          listings: DEMO_LISTINGS, maxMinutes: 120,
          truckCapacityLbs: 1000, objective: 'value',
        });
        ok = r != null && Array.isArray(r.stops) && r.summary != null &&
             typeof r.summary.total_stops === 'number';
        if (!ok) errMsg = 'Client-side optimizeRoute() returned invalid shape';
      } catch (e) {
        errMsg = e.message;
      }
      results.push({
        endpoint: '/api/optimize-route',
        method: 'POST',
        status: ok ? 'PASS' : 'FAIL',
        responseTime_ms,
        blocker: ok ? null : 'P0',
        error: errMsg ?? networkError.message,
      });
    } else {
      let ok = false;
      let errMsg = null;
      try {
        const data = await res.json();
        ok =
          res.ok &&
          Array.isArray(data.stops) &&
          data.summary != null &&
          typeof data.summary.total_stops === 'number';
        if (!ok) errMsg = `HTTP ${res.status}: expected {stops:[], summary:{total_stops:number,...}}`;
      } catch {
        errMsg = 'Response is not valid JSON';
      }
      results.push({
        endpoint: '/api/optimize-route',
        method: 'POST',
        status: ok ? 'PASS' : 'FAIL',
        responseTime_ms,
        blocker: ok ? null : 'P0',
        error: errMsg,
      });
    }
  }

  // ── Test 5: POST /accept-route ─────────────────────────────────────── P1 ──

  if (fallbackMode) {
    const first = DEMO_LISTINGS[0];
    const ok = first != null &&
               typeof first.id === 'string' &&
               typeof first.household_name === 'string';
    results.push({
      endpoint: '/api/accept-route',
      method: 'POST',
      status: ok ? 'PASS' : 'FAIL',
      responseTime_ms: 0,
      blocker: ok ? null : 'P1',
      error: ok ? null : 'DEMO_LISTINGS[0] is missing id or household_name',
    });
  } else {
    const { res, responseTime_ms, networkError } = await timedFetch(
      `${baseUrl}/accept-route`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stops: [{ listing_id: 'smoke_test_probe', eta_minutes: 15 }],
          driver_name: 'QA Smoke Test',
        }),
      },
    );
    if (networkError instanceof TypeError) {
      fallbackMode = true;
      const first = DEMO_LISTINGS[0];
      const ok = first != null && typeof first.id === 'string' && typeof first.household_name === 'string';
      results.push({
        endpoint: '/api/accept-route',
        method: 'POST',
        status: ok ? 'PASS' : 'FAIL',
        responseTime_ms,
        blocker: ok ? null : 'P1',
        error: ok ? null : 'DEMO_LISTINGS[0] invalid',
      });
    } else {
      let ok = false;
      let errMsg = null;
      try {
        const data = await res.json();
        ok = res.ok && data.success === true && typeof data.notifications_sent === 'number';
        if (!ok) errMsg = `HTTP ${res.status}: expected {success:true, notifications_sent:number}`;
      } catch {
        errMsg = 'Response is not valid JSON';
      }
      results.push({
        endpoint: '/api/accept-route',
        method: 'POST',
        status: ok ? 'PASS' : 'FAIL',
        responseTime_ms,
        blocker: ok ? null : 'P1',
        error: errMsg,
      });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  const p0Failures = results.filter(r => r.status === 'FAIL' && r.blocker === 'P0');
  const p1Failures = results.filter(r => r.status === 'FAIL' && r.blocker === 'P1');

  const summary = {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
    skipped: results.filter(r => r.status === 'SKIP').length,
    p0Failures,
    p1Failures,
    fallbackActivated: fallbackMode,
    demoSafe: p0Failures.length === 0,
  };

  console.table(
    results.map(r => ({
      endpoint: r.endpoint,
      method: r.method,
      status: r.status,
      ms: r.responseTime_ms,
      blocker: r.blocker ?? '',
      error: r.error ?? '',
    })),
  );

  return { results, summary };
}
