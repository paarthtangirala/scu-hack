/**
 * Automated regression gate suite — phase gate deliverable verification.
 * Owner: Sara
 *
 * 18 tests across 4 groups.
 * Tests verify that phase gate files exist, have the correct exports,
 * and behave correctly for their documented contracts.
 *
 * All tests are fully isolated and pure (no shared state, no mocks needed).
 * If a prior-phase file is missing, tests skip gracefully rather than crashing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Group 1: PH1 Gate Tests ───────────────────────────────────────────────────
// Verifies: smokeRunner.js exports, signature, return shape.
// Deliverable: frontend/src/services/smokeRunner.js

describe('Group 1 — PH1: smokeRunner.js gate tests', () => {
  it('GATE-PH1-03a: smokeRunner.js exists and exports runSmokeTests as a function', async () => {
    let mod;
    try {
      mod = await import('../../services/smokeRunner.js');
    } catch (e) {
      throw new Error(`GATE FAILURE: smokeRunner.js could not be imported: ${e.message}`);
    }
    expect(typeof mod.runSmokeTests).toBe('function');
  });

  it('GATE-PH1-03b: runSmokeTests accepts an options object without throwing', async () => {
    const { runSmokeTests } = await import('../../services/smokeRunner.js');
    // fallbackMode: true avoids any fetch() call — runs entirely on demoData validation
    await expect(runSmokeTests({ fallbackMode: true, logTable: false })).resolves.toBeDefined();
  });

  it('GATE-PH1-03c: runSmokeTests returns a Promise (is async)', async () => {
    const { runSmokeTests } = await import('../../services/smokeRunner.js');
    const result = runSmokeTests({ fallbackMode: true, logTable: false });
    expect(result).toBeInstanceOf(Promise);
    await result; // ensure it resolves cleanly
  });

  it('GATE-PH1-04: summary has required fields: total, passed, failed, demoSafe, fallbackActivated', async () => {
    const { runSmokeTests } = await import('../../services/smokeRunner.js');
    const { summary } = await runSmokeTests({ fallbackMode: true, logTable: false });
    expect(typeof summary.total).toBe('number');
    expect(typeof summary.passed).toBe('number');
    expect(typeof summary.failed).toBe('number');
    expect(typeof summary.demoSafe).toBe('boolean');
    expect(typeof summary.fallbackActivated).toBe('boolean');
  });
});

// ── Group 2: PH2 Gate Tests ───────────────────────────────────────────────────
// Verifies: householdValidation.js exports and return shapes.
// Deliverable: frontend/src/utils/householdValidation.js

describe('Group 2 — PH2: householdValidation.js gate tests', () => {
  it('GATE-PH2-02a: householdValidation.js exists and exports validateImageFile', async () => {
    let mod;
    try {
      mod = await import('../householdValidation.js');
    } catch (e) {
      throw new Error(`GATE FAILURE: householdValidation.js could not be imported: ${e.message}`);
    }
    expect(typeof mod.validateImageFile).toBe('function');
  });

  it('GATE-PH2-02b: validateImageFile(null) returns { valid: false, error: string }', async () => {
    const { validateImageFile } = await import('../householdValidation.js');
    const result = validateImageFile(null);
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('GATE-PH2-02c: householdValidation.js exports validateMaterials', async () => {
    const mod = await import('../householdValidation.js');
    expect(typeof mod.validateMaterials).toBe('function');
  });

  it('GATE-PH2-02d: validateMaterials([]) returns { valid: false, errors: array }', async () => {
    const { validateMaterials } = await import('../householdValidation.js');
    const result = validateMaterials([]);
    expect(result.valid).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('GATE-PH2-02e: householdValidation.js exports validateNotes', async () => {
    const mod = await import('../householdValidation.js');
    expect(typeof mod.validateNotes).toBe('function');
  });

  it('GATE-PH2-02f: validateNotes(501-char string) returns { valid: false, error: string }', async () => {
    const { validateNotes } = await import('../householdValidation.js');
    const result = validateNotes('x'.repeat(501));
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/500/);
  });

  it('GATE-PH2-02g: householdValidation.js exports validateListing', async () => {
    const mod = await import('../householdValidation.js');
    expect(typeof mod.validateListing).toBe('function');
  });
});

// ── Group 3: PH4 Gate Tests ───────────────────────────────────────────────────
// Verifies: notifierMode.js exports and return contracts.
// Deliverable: frontend/src/utils/notifierMode.js

describe('Group 3 — PH4: notifierMode.js gate tests', () => {
  it('GATE-PH4-02a: notifierMode.js exists and exports getNotifierMode', async () => {
    let mod;
    try {
      mod = await import('../notifierMode.js');
    } catch (e) {
      throw new Error(`GATE FAILURE: notifierMode.js could not be imported: ${e.message}`);
    }
    expect(typeof mod.getNotifierMode).toBe('function');
  });

  it('GATE-PH4-02b: getNotifierMode(null) returns "demo" without throwing', async () => {
    const { getNotifierMode } = await import('../notifierMode.js');
    let result;
    expect(() => { result = getNotifierMode(null); }).not.toThrow();
    expect(result).toBe('demo');
  });

  it('GATE-PH4-02c: notifierMode.js exports isFallbackSafe', async () => {
    const mod = await import('../notifierMode.js');
    expect(typeof mod.isFallbackSafe).toBe('function');
  });

  it('GATE-PH4-02d: isFallbackSafe("demo") returns true', async () => {
    const { isFallbackSafe } = await import('../notifierMode.js');
    expect(isFallbackSafe('demo')).toBe(true);
  });

  it('GATE-PH4-02e: notifierMode.js exports getPresenterCue', async () => {
    const mod = await import('../notifierMode.js');
    expect(typeof mod.getPresenterCue).toBe('function');
  });

  it('GATE-PH4-02f: getPresenterCue("live") returns a non-empty string', async () => {
    const { getPresenterCue } = await import('../notifierMode.js');
    const cue = getPresenterCue('live');
    expect(typeof cue).toBe('string');
    expect(cue.length).toBeGreaterThan(0);
  });
});

// ── Group 4: Integration smoke test ──────────────────────────────────────────
// Verifies full fallback-mode run of runSmokeTests is demo-safe.
// fallbackMode: true skips all fetch() calls — runs entirely on demoData validation.
// This test confirms demoData shape is valid and the demo is safe to run offline.

describe('Group 4 — Integration: fallback smoke run', () => {
  it('GATE-PH1-INT: runSmokeTests({ fallbackMode: true }) completes without throwing and returns demoSafe: true', async () => {
    const { runSmokeTests } = await import('../../services/smokeRunner.js');

    let result;
    await expect(async () => {
      result = await runSmokeTests({ fallbackMode: true, logTable: false });
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.summary.demoSafe).toBe(true);
    expect(result.summary.fallbackActivated).toBe(true);
    // All 5 tests run in fallback mode; P0 failures would make demoSafe false
    expect(result.summary.p0Failures).toHaveLength(0);
  });
});
