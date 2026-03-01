/**
 * Unit tests — notifierMode utility functions.
 * Owner: Sara
 *
 * 17 tests across 4 groups.
 * All functions are pure — no mocking needed, no shared state.
 * Field names mirror voice.py: mode values 'live' | 'demo' | 'failed'.
 * Response shape mirrors /api/accept-route: { notifications: [{ notification: { mode } }] }
 */

import { describe, it, expect } from 'vitest';
import {
  getNotifierMode,
  isFallbackSafe,
  getPresenterCue,
  shouldShowOverlay,
} from '../notifierMode.js';

// ── Group 1: getNotifierMode() ────────────────────────────────────────────────

describe('Group 1 — getNotifierMode()', () => {
  it('TC-01: all live mode indicators → returns "live"', () => {
    const response = {
      success: true,
      notifications_sent: 2,
      notifications: [
        { listing_id: 'listing_001', household: 'Chen Family',
          notification: { success: true, mode: 'live', call_sid: 'CA111' } },
        { listing_id: 'listing_002', household: 'Rivera Household',
          notification: { success: true, mode: 'live', call_sid: 'CA222' } },
      ],
    };
    expect(getNotifierMode(response)).toBe('live');
  });

  it('TC-04: all notifications in demo path (no credentials used) → returns "demo"', () => {
    const response = {
      success: true,
      notifications_sent: 2,
      notifications: [
        { listing_id: 'listing_001', household: 'Chen Family',
          notification: { success: true, mode: 'demo', message: 'RecycleRun driver arriving in 8 min' } },
        { listing_id: 'listing_002', household: 'Rivera Household',
          notification: { success: true, mode: 'demo', message: 'RecycleRun driver arriving in 14 min' } },
      ],
    };
    expect(getNotifierMode(response)).toBe('demo');
  });

  it('TC-05: notification indicates ElevenLabs call failed → returns "failed"', () => {
    // ElevenLabs 401 in practice degrades to mode "demo" via voice.py's graceful fallback.
    // This test verifies the classifier correctly returns "failed" when a stop notification
    // explicitly carries mode "failed" (e.g., future explicit error propagation path).
    const response = {
      success: true,
      notifications_sent: 0,
      notifications: [
        { listing_id: 'listing_001', household: 'Chen Family',
          notification: { success: false, mode: 'failed', error: 'ElevenLabs 401 Unauthorized' } },
      ],
    };
    expect(getNotifierMode(response)).toBe('failed');
  });

  it('TC-06: notification indicates Twilio call failed → returns "failed"', () => {
    // Twilio throws TwilioRestException → voice.py returns { success: False, mode: "failed" }.
    const response = {
      success: true,
      notifications_sent: 0,
      notifications: [
        { listing_id: 'listing_003', household: 'Park Residence',
          notification: { success: false, mode: 'failed', error: 'TwilioRestException: 401 Unauthorized' } },
      ],
    };
    expect(getNotifierMode(response)).toBe('failed');
  });

  it('TC-09: partial failure — some stops live, some failed → returns "failed"', () => {
    // Twilio fails mid-route: first stop called successfully, second throws.
    // 'failed' takes priority over 'live' — partial failure requires operator attention.
    const response = {
      success: true,
      notifications_sent: 1,
      claimed_count: 2,
      notifications: [
        { listing_id: 'listing_001', household: 'Chen Family',
          notification: { success: true, mode: 'live', call_sid: 'CA999' } },
        { listing_id: 'listing_002', household: 'Rivera Household',
          notification: { success: false, mode: 'failed', error: 'Twilio timeout' } },
      ],
    };
    expect(getNotifierMode(response)).toBe('failed');
  });

  it('null response → returns "demo" (safe default, never throws)', () => {
    expect(getNotifierMode(null)).toBe('demo');
  });

  it('undefined response → returns "demo" (safe default, never throws)', () => {
    expect(getNotifierMode(undefined)).toBe('demo');
  });

  it('malformed response missing notifications field → returns "demo" (safe default)', () => {
    const response = { success: true, notifications_sent: 0 };
    expect(getNotifierMode(response)).toBe('demo');
  });

  it('notifications array is empty → returns "demo" (safe default)', () => {
    const response = { success: true, notifications: [] };
    expect(getNotifierMode(response)).toBe('demo');
  });

  it('notifications present but notification.mode field missing → returns "demo" (safe default)', () => {
    const response = {
      notifications: [
        { listing_id: 'listing_001', notification: { success: true } },
      ],
    };
    expect(getNotifierMode(response)).toBe('demo');
  });
});

// ── Group 2: isFallbackSafe() ─────────────────────────────────────────────────

describe('Group 2 — isFallbackSafe()', () => {
  it('"live" → returns true (real calls working, safe to present)', () => {
    expect(isFallbackSafe('live')).toBe(true);
  });

  it('"demo" → returns true (graceful fallback, safe to present)', () => {
    expect(isFallbackSafe('demo')).toBe(true);
  });

  it('"failed" → returns false (Twilio exception, use recovery language)', () => {
    expect(isFallbackSafe('failed')).toBe(false);
  });

  it('unknown string → returns false (safe default)', () => {
    expect(isFallbackSafe('unknown')).toBe(false);
  });
});

// ── Group 3: getPresenterCue() ────────────────────────────────────────────────

describe('Group 3 — getPresenterCue()', () => {
  it('"live" → non-empty string containing "call" or "calling"', () => {
    const cue = getPresenterCue('live');
    expect(typeof cue).toBe('string');
    expect(cue.length).toBeGreaterThan(0);
    expect(cue.toLowerCase()).toMatch(/call/);
  });

  it('"demo" → non-empty string, does not mention "live call"', () => {
    const cue = getPresenterCue('demo');
    expect(typeof cue).toBe('string');
    expect(cue.length).toBeGreaterThan(0);
    expect(cue.toLowerCase()).not.toMatch(/live call/);
  });

  it('"failed" → non-empty string with recovery language (retry/recover/locked)', () => {
    const cue = getPresenterCue('failed');
    expect(typeof cue).toBe('string');
    expect(cue.length).toBeGreaterThan(0);
    expect(cue.toLowerCase()).toMatch(/retry|recover|locked/);
  });
});

// ── Group 4: shouldShowOverlay() ──────────────────────────────────────────────

describe('Group 4 — shouldShowOverlay()', () => {
  it('"live" → returns true (overlay always shown)', () => {
    expect(shouldShowOverlay('live')).toBe(true);
  });

  it('"demo" → returns true (overlay always shown)', () => {
    expect(shouldShowOverlay('demo')).toBe(true);
  });

  it('"failed" → returns true (overlay always shown, use recovery language)', () => {
    expect(shouldShowOverlay('failed')).toBe(true);
  });
});
