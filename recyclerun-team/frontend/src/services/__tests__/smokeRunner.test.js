/**
 * Unit tests for smokeRunner.js — 7 required scenarios.
 * Owner: Sara
 *
 * Each test is fully isolated: fetch is spied on via vi.spyOn,
 * restored in afterEach. No shared mutable state between tests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSmokeTests } from '../smokeRunner.js';

// ── Helper: build a minimal Response-like object ───────────────────────────
function makeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// ── Shared valid responses for each endpoint ───────────────────────────────
const VALID_HEALTH    = { status: 'ok', total_listings: 20 };
const VALID_LISTINGS  = { listings: [{ id: 'l1', address: '1 Main', total_lbs: 5, total_value: 2 }], count: 1 };
const VALID_CLASSIFY  = { success: true, materials: [{ type: 'cardboard', lbs: 10 }], total_value: 0.40, total_lbs: 10, notes: '', source: 'demo' };
const VALID_OPTIMIZE  = { stops: [], summary: { total_stops: 0, total_value: 0, total_lbs: 0, total_miles: 0, truck_fill_pct: 0, estimated_minutes: 0, lbs_per_hour: 0, objective: 'value', solver: 'greedy', solve_time_ms: 1 } };
const VALID_ACCEPT    = { success: true, notifications_sent: 0, notifications: [] };

function mockAllValid() {
  vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (url.includes('/health'))         return makeResponse(200, VALID_HEALTH);
    if (url.includes('/listings'))       return makeResponse(200, VALID_LISTINGS);
    if (url.includes('/classify'))       return makeResponse(200, VALID_CLASSIFY);
    if (url.includes('/optimize-route')) return makeResponse(200, VALID_OPTIMIZE);
    if (url.includes('/accept-route'))   return makeResponse(200, VALID_ACCEPT);
    return makeResponse(404, { error: 'not found' });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Test 1 ─────────────────────────────────────────────────────────────────
describe('runSmokeTests', () => {
  it('all 5 endpoints return valid responses → all PASS, demoSafe: true', async () => {
    mockAllValid();

    const { results, summary } = await runSmokeTests({ baseUrl: 'http://localhost:5000/api' });

    expect(results).toHaveLength(5);
    expect(results.every(r => r.status === 'PASS')).toBe(true);
    expect(summary.passed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(summary.p0Failures).toHaveLength(0);
    expect(summary.p1Failures).toHaveLength(0);
    expect(summary.demoSafe).toBe(true);
    expect(summary.fallbackActivated).toBe(false);
  });

  // ── Test 2 ───────────────────────────────────────────────────────────────
  it('health returns HTTP 500 → FAIL, blocker P0, demoSafe: false', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/health'))         return makeResponse(500, { error: 'internal server error' });
      if (url.includes('/listings'))       return makeResponse(200, VALID_LISTINGS);
      if (url.includes('/classify'))       return makeResponse(200, VALID_CLASSIFY);
      if (url.includes('/optimize-route')) return makeResponse(200, VALID_OPTIMIZE);
      if (url.includes('/accept-route'))   return makeResponse(200, VALID_ACCEPT);
      return makeResponse(404, {});
    });

    const { results, summary } = await runSmokeTests({ baseUrl: 'http://localhost:5000/api' });

    const health = results.find(r => r.endpoint === '/api/health');
    expect(health).toBeDefined();
    expect(health.status).toBe('FAIL');
    expect(health.blocker).toBe('P0');
    expect(summary.demoSafe).toBe(false);
    expect(summary.p0Failures).toHaveLength(1);
    expect(summary.p0Failures[0].endpoint).toBe('/api/health');
  });

  // ── Test 3 ───────────────────────────────────────────────────────────────
  it('listings returns empty array → PASS (empty is valid)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/health'))         return makeResponse(200, VALID_HEALTH);
      if (url.includes('/listings'))       return makeResponse(200, { listings: [], count: 0 });
      if (url.includes('/classify'))       return makeResponse(200, VALID_CLASSIFY);
      if (url.includes('/optimize-route')) return makeResponse(200, VALID_OPTIMIZE);
      if (url.includes('/accept-route'))   return makeResponse(200, VALID_ACCEPT);
      return makeResponse(404, {});
    });

    const { results } = await runSmokeTests({ baseUrl: 'http://localhost:5000/api' });

    const listings = results.find(r => r.endpoint === '/api/listings');
    expect(listings).toBeDefined();
    expect(listings.status).toBe('PASS');
    expect(listings.blocker).toBeNull();
  });

  // ── Test 4 ───────────────────────────────────────────────────────────────
  it('classify returns malformed response (missing required fields) → FAIL, blocker P1', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/health'))         return makeResponse(200, VALID_HEALTH);
      if (url.includes('/listings'))       return makeResponse(200, VALID_LISTINGS);
      // Missing both `success` and `materials` fields
      if (url.includes('/classify'))       return makeResponse(200, { error: 'model unavailable' });
      if (url.includes('/optimize-route')) return makeResponse(200, VALID_OPTIMIZE);
      if (url.includes('/accept-route'))   return makeResponse(200, VALID_ACCEPT);
      return makeResponse(404, {});
    });

    const { results } = await runSmokeTests({ baseUrl: 'http://localhost:5000/api' });

    const classify = results.find(r => r.endpoint === '/api/classify');
    expect(classify).toBeDefined();
    expect(classify.status).toBe('FAIL');
    expect(classify.blocker).toBe('P1');
  });

  // ── Test 5 ───────────────────────────────────────────────────────────────
  it('all fetches throw TypeError network error → fallbackActivated: true, all results PASS or SKIP', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const { results, summary } = await runSmokeTests({ baseUrl: 'http://localhost:5000/api' });

    expect(summary.fallbackActivated).toBe(true);
    expect(results).toHaveLength(5);
    expect(results.every(r => r.status === 'PASS' || r.status === 'SKIP')).toBe(true);
  });

  // ── Test 6 ───────────────────────────────────────────────────────────────
  it('health response takes 3500ms → status PASS but error field contains latency warning', async () => {
    // Mock Date.now: first call = t0 (0), second call = t_end (3500ms later).
    // All subsequent calls return 3500 so other endpoints show 0ms response time.
    const timestamps = [0, 3500];
    let tsIdx = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      const val = tsIdx < timestamps.length ? timestamps[tsIdx] : 3500;
      tsIdx++;
      return val;
    });

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/health'))         return makeResponse(200, VALID_HEALTH);
      if (url.includes('/listings'))       return makeResponse(200, VALID_LISTINGS);
      if (url.includes('/classify'))       return makeResponse(200, VALID_CLASSIFY);
      if (url.includes('/optimize-route')) return makeResponse(200, VALID_OPTIMIZE);
      if (url.includes('/accept-route'))   return makeResponse(200, VALID_ACCEPT);
      return makeResponse(404, {});
    });

    const { results } = await runSmokeTests({
      baseUrl: 'http://localhost:5000/api',
      timeoutMs: 10000,
    });

    const health = results.find(r => r.endpoint === '/api/health');
    expect(health).toBeDefined();
    expect(health.status).toBe('PASS');
    expect(health.error).toBeTruthy();
    expect(health.error).toMatch(/latency warning/i);
    expect(health.responseTime_ms).toBe(3500);
  });

  // ── Test 7 ───────────────────────────────────────────────────────────────
  it('mix of 3 PASS + 1 P0 FAIL + 1 P1 FAIL → correct summary counts, demoSafe: false', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      // PASS: health
      if (url.includes('/health'))         return makeResponse(200, VALID_HEALTH);
      // FAIL P0: listings returns 500
      if (url.includes('/listings'))       return makeResponse(500, { error: 'db error' });
      // FAIL P1: classify missing success + materials
      if (url.includes('/classify'))       return makeResponse(200, { malformed: true });
      // PASS: optimize-route
      if (url.includes('/optimize-route')) return makeResponse(200, VALID_OPTIMIZE);
      // PASS: accept-route
      if (url.includes('/accept-route'))   return makeResponse(200, VALID_ACCEPT);
      return makeResponse(404, {});
    });

    const { results, summary } = await runSmokeTests({ baseUrl: 'http://localhost:5000/api' });

    expect(summary.passed).toBe(3);
    expect(summary.failed).toBe(2);
    expect(summary.p0Failures).toHaveLength(1);
    expect(summary.p0Failures[0].endpoint).toBe('/api/listings');
    expect(summary.p1Failures).toHaveLength(1);
    expect(summary.p1Failures[0].endpoint).toBe('/api/classify');
    expect(summary.demoSafe).toBe(false);
  });
});
