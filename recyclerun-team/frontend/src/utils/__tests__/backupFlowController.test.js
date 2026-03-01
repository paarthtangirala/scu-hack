/**
 * Unit tests — backupFlowController utility functions.
 * Owner: Sara
 *
 * 19 tests across 5 groups.
 * All functions are pure — no mocking needed, no shared state.
 * Field names mirror voice.py modes (live/demo/failed) and real response shapes.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  assessSystemState,
  getBackupBranch,
  isFullFallbackRequired,
  getDemoScript,
  getOutageSummary,
} from '../backupFlowController.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// Fixtures — real response shapes from the codebase

const HEALTHY_HEALTH = { status: 'ok', total_listings: 20 };

const HEALTHY_OPTIMIZE = {
  route: [
    { listing_id: 'listing_001', household_name: 'Chen Family', total_value: 8.75, total_lbs: 23.3, eta_minutes: 8 },
  ],
  summary: { total_stops: 1, total_value: 8.75, total_lbs: 23.3, solver: 'ortools' },
};

const LIVE_ACCEPT = {
  success: true,
  notifications_sent: 1,
  notifications: [
    {
      listing_id: 'listing_001',
      household: 'Chen Family',
      notification: { success: true, mode: 'live', call_sid: 'CA111abc' },
    },
  ],
};

const DEMO_ACCEPT = {
  success: true,
  notifications_sent: 1,
  notifications: [
    {
      listing_id: 'listing_001',
      household: 'Chen Family',
      notification: { success: true, mode: 'demo', reason: 'twilio_not_configured' },
    },
  ],
};

const FAILED_ACCEPT = {
  success: true,
  notifications_sent: 0,
  notifications: [
    {
      listing_id: 'listing_001',
      household: 'Chen Family',
      notification: { success: false, mode: 'failed', error: 'TwilioRestException', reason: 'twilio_exception' },
    },
  ],
};

// ── Group 1: assessSystemState() ─────────────────────────────────────────────

describe('Group 1 — assessSystemState()', () => {
  it('1. all valid inputs → backendUp:true, optimizerWorking:true, notifierMode:"live", recommendedScript:"primary", outages:[]', () => {
    const result = assessSystemState(HEALTHY_HEALTH, HEALTHY_OPTIMIZE, LIVE_ACCEPT);
    expect(result.backendUp).toBe(true);
    expect(result.optimizerWorking).toBe(true);
    expect(result.notifierMode).toBe('live');
    expect(result.recommendedScript).toBe('primary');
    expect(result.outages).toEqual([]);
  });

  it('2. null health response → backendUp:false, recommendedScript:"backup", outages non-empty', () => {
    const result = assessSystemState(null, HEALTHY_OPTIMIZE, LIVE_ACCEPT);
    expect(result.backendUp).toBe(false);
    expect(result.recommendedScript).toBe('backup');
    expect(Array.isArray(result.outages)).toBe(true);
    expect(result.outages.length).toBeGreaterThan(0);
  });

  it('3. optimize response has empty route array → optimizerWorking:false, recommendedScript:"backup"', () => {
    const emptyOptimize = { route: [], summary: { total_stops: 0 } };
    const result = assessSystemState(HEALTHY_HEALTH, emptyOptimize, LIVE_ACCEPT);
    expect(result.optimizerWorking).toBe(false);
    expect(result.recommendedScript).toBe('backup');
  });

  it('4. accept response signals "failed" notifier mode → notifierMode:"failed", recommendedScript:"backup"', () => {
    const result = assessSystemState(HEALTHY_HEALTH, HEALTHY_OPTIMIZE, FAILED_ACCEPT);
    expect(result.notifierMode).toBe('failed');
    expect(result.recommendedScript).toBe('backup');
  });

  it('5. all three inputs null → returns valid object with degraded values, does not throw', () => {
    let result;
    expect(() => { result = assessSystemState(null, null, null); }).not.toThrow();
    expect(typeof result).toBe('object');
    expect(result.backendUp).toBe(false);
    expect(result.optimizerWorking).toBe(false);
    expect(result.notifierMode).toBe('demo');
    expect(result.recommendedScript).toBe('backup');
    expect(Array.isArray(result.outages)).toBe(true);
  });
});

// ── Group 2: getBackupBranch() ────────────────────────────────────────────────

describe('Group 2 — getBackupBranch()', () => {
  it('6. "BO-01" → steps.length >= 3, wowMomentPreserved:false', () => {
    const branch = getBackupBranch('BO-01');
    expect(branch.outageCode).toBe('BO-01');
    expect(Array.isArray(branch.steps)).toBe(true);
    expect(branch.steps.length).toBeGreaterThanOrEqual(3);
    expect(branch.wowMomentPreserved).toBe(false);
    expect(typeof branch.timeCostSeconds).toBe('number');
  });

  it('7. "BO-03" (ElevenLabs/Twilio missing) → wowMomentPreserved:false', () => {
    const branch = getBackupBranch('BO-03');
    expect(branch.outageCode).toBe('BO-03');
    expect(branch.wowMomentPreserved).toBe(false);
    expect(Array.isArray(branch.steps)).toBe(true);
    expect(branch.steps.length).toBeGreaterThan(0);
  });

  it('8. "BO-07" (AMD classify error) → wowMomentPreserved:true (auto-fallback, demo continues)', () => {
    const branch = getBackupBranch('BO-07');
    expect(branch.outageCode).toBe('BO-07');
    expect(branch.wowMomentPreserved).toBe(true);
    expect(branch.timeCostSeconds).toBe(0);
  });

  it('9. unknown code "BO-99" → returns safe default object, does not throw', () => {
    let branch;
    expect(() => { branch = getBackupBranch('BO-99'); }).not.toThrow();
    expect(typeof branch).toBe('object');
    expect(Array.isArray(branch.steps)).toBe(true);
    expect(branch.steps.length).toBeGreaterThan(0);
    expect(typeof branch.wowMomentPreserved).toBe('boolean');
    expect(typeof branch.timeCostSeconds).toBe('number');
  });
});

// ── Group 3: isFullFallbackRequired() ────────────────────────────────────────

describe('Group 3 — isFullFallbackRequired()', () => {
  it('10. { backendUp: false } → true', () => {
    expect(isFullFallbackRequired({ backendUp: false, optimizerWorking: true })).toBe(true);
  });

  it('11. { backendUp: true, optimizerWorking: false } → true', () => {
    expect(isFullFallbackRequired({ backendUp: true, optimizerWorking: false })).toBe(true);
  });

  it('12. { backendUp: true, optimizerWorking: true, notifierMode: "live" } → false', () => {
    expect(isFullFallbackRequired({ backendUp: true, optimizerWorking: true, notifierMode: 'live' })).toBe(false);
  });

  it('13. null input → true (fail-safe)', () => {
    expect(isFullFallbackRequired(null)).toBe(true);
  });
});

// ── Group 4: getDemoScript() ──────────────────────────────────────────────────

describe('Group 4 — getDemoScript()', () => {
  it('14. fully healthy state → "primary"', () => {
    const state = { backendUp: true, optimizerWorking: true, notifierMode: 'live', recommendedScript: 'primary', outages: [] };
    expect(getDemoScript(state)).toBe('primary');
  });

  it('15. backendUp:false → "backup"', () => {
    const state = { backendUp: false, optimizerWorking: true, notifierMode: 'live', recommendedScript: 'backup', outages: [] };
    expect(getDemoScript(state)).toBe('backup');
  });

  it('16. null input → "backup" (fail-safe)', () => {
    expect(getDemoScript(null)).toBe('backup');
  });
});

// ── Group 5: getOutageSummary() ───────────────────────────────────────────────

describe('Group 5 — getOutageSummary()', () => {
  it('17. outages:[] → returns []', () => {
    const state = { outages: [] };
    const result = getOutageSummary(state);
    expect(result).toEqual([]);
  });

  it('18. outages with two entries → returns array of length 2', () => {
    const state = { outages: ['Backend down', 'Twilio missing'] };
    const result = getOutageSummary(state);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Backend down');
    expect(result[1]).toBe('Twilio missing');
  });

  it('19. null input → returns [], does not throw', () => {
    let result;
    expect(() => { result = getOutageSummary(null); }).not.toThrow();
    expect(result).toEqual([]);
  });
});
