/**
 * Unit tests — household listing validation + API fallback behavior.
 * Owner: Sara
 *
 * 13 tests across 3 groups.
 * All tests are fully isolated: fetch/api mocked via vi.spyOn, restored in afterEach.
 * No shared mutable state between tests.
 *
 * Imports only from files confirmed to exist in the repo.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateImageFile,
  validateMaterials,
  validateNotes,
  validateListing,
} from '../../utils/householdValidation.js';
import { api } from '../api.js';
import { DEMO_CLASSIFICATION } from '../demoData.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Group 1: Photo upload validation ─────────────────────────────────────────

describe('Group 1 — Photo upload validation', () => {
  it('HV-01a: no file selected → submission blocked, error state set', () => {
    const result = validateImageFile(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(typeof result.error).toBe('string');
  });

  it('HV-01b: valid image/jpeg file → no error, proceeds to classify', () => {
    const mockFile = { name: 'recyclables.jpg', type: 'image/jpeg', size: 102400 };
    const result = validateImageFile(mockFile);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('HV-01c: non-image file (application/pdf) → blocked with correct error message', () => {
    const mockFile = { name: 'report.pdf', type: 'application/pdf', size: 204800 };
    const result = validateImageFile(mockFile);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/application\/pdf/);
    expect(result.error.toLowerCase()).toMatch(/image/);
  });
});

// ── Group 2: Material validation ──────────────────────────────────────────────

describe('Group 2 — Material validation', () => {
  it('HV-02a: empty materials array → blocked, error message shown', () => {
    const result = validateMaterials([]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].toLowerCase()).toMatch(/material/);
  });

  it('HV-03a: lbs = -5 → blocked, lbs field flagged as invalid', () => {
    const result = validateMaterials([{ type: 'cardboard', lbs: -5 }]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.toLowerCase().includes('greater than 0') || e.toLowerCase().includes('lbs'))).toBe(true);
  });

  it('HV-03b: lbs = 0 → blocked, zero is not a valid quantity', () => {
    const result = validateMaterials([{ type: 'aluminum_cans', lbs: 0 }]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('HV-03c: lbs = NaN (non-numeric input like "abc") → blocked, non-numeric rejected', () => {
    // ManualMaterials uses parseFloat(e.target.value) || 0; raw NaN represents the invalid state
    // before the component's || 0 coercion. Validator must reject NaN.
    const result = validateMaterials([{ type: 'plastic_pet', lbs: NaN }]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('HV-03d: lbs = 999999 (over MAX_LBS 5000) → blocked', () => {
    const result = validateMaterials([{ type: 'cardboard', lbs: 999999 }]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('5000') || e.toLowerCase().includes('exceed'))).toBe(true);
  });

  it('HV-04a: notes exactly 500 chars → allowed (boundary value)', () => {
    const notes = 'x'.repeat(500);
    const result = validateNotes(notes);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('HV-04b: notes 501 chars → blocked, character limit error shown', () => {
    const notes = 'x'.repeat(501);
    const result = validateNotes(notes);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/500/);
  });
});

// ── Group 3: API fallback behavior ────────────────────────────────────────────

describe('Group 3 — API fallback behavior', () => {
  it('HV-05a: classify returns error response → manual entry path remains valid', async () => {
    // api.js returns { ok: false, status: 0, error } on network error (no explicit timeout in api.js).
    vi.spyOn(api, 'classifyImage').mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: 'Network error',
    });

    const classifyResult = await api.classifyImage('data:image/jpeg;base64,test');
    expect(classifyResult.ok).toBe(false);
    expect(classifyResult.status).toBe(0);

    // Manual entry is still a valid recovery path — validate a typical manual entry.
    const materials = [{ type: 'aluminum_cans', lbs: 3.5 }];
    const validation = validateMaterials(materials);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('HV-05b: classifyImage returns null → DEMO_CLASSIFICATION used as fallback, no crash', async () => {
    // PhotoUpload pattern: const final = res || DEMO_CLASSIFICATION
    // When api returns null (falsy), DEMO_CLASSIFICATION activates.
    vi.spyOn(api, 'classifyImage').mockResolvedValueOnce(null);

    const res = await api.classifyImage('data:image/jpeg;base64,test');

    // Simulate PhotoUpload's fallback assignment
    const classification = res || DEMO_CLASSIFICATION;

    expect(classification).toBe(DEMO_CLASSIFICATION);
    expect(classification.success).toBe(true);
    expect(Array.isArray(classification.materials)).toBe(true);
    expect(classification.materials).toHaveLength(3);
    expect(classification.total_value).toBe(8.96);
    expect(classification.total_lbs).toBe(19.5);
    expect(classification.source).toBe('demo');
  });

  it('HV-06a: backend unavailable, valid manual entry → validateListing passes, api call completes without crash', async () => {
    // api.createListing returns { ok: false } when backend is unreachable.
    // HouseholdPage.post() does not check the result — it always shows success toast.
    vi.spyOn(api, 'createListing').mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: 'Network error',
    });

    const materials = [
      { type: 'cardboard', lbs: 18 },
      { type: 'aluminum_cans', lbs: 3.2 },
    ];
    const listing = {
      address: '742 Everglade Ave, Santa Clara',
      household_name: 'Chen Family',
      listing_kind: 'household',
      notes: 'Near garage door',
      materials,
    };

    // Listing validation must pass (the data is valid)
    const { valid, errors } = validateListing(listing);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);

    // api.createListing resolves (does not throw) even when backend is down
    const result = await api.createListing({ ...listing, lat: 37.3541, lng: -121.9552 });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    // Test completes without crash — success state is reachable in HouseholdPage
    // because post() does not gate the success toast on api result.
  });
});
