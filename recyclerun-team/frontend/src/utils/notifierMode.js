/**
 * Pure utility — determines the notifier mode from an /api/accept-route response.
 * No React, no side effects, no imports.
 * Owner: Sara
 *
 * Mode values mirror voice.py:
 *   'live'   — ElevenLabs TTS + Twilio call succeeded for at least one stop, no failures.
 *   'demo'   — All notifications ran in demo path (no credentials, or graceful ElevenLabs fallback).
 *   'failed' — At least one Twilio call threw an exception (success: false, mode: "failed").
 *
 * Input shape (raw backend data from /api/accept-route, i.e. response.data in api.js terms):
 *   {
 *     success: boolean,
 *     notifications_sent: number,
 *     notifications: Array<{
 *       listing_id: string,
 *       household: string,
 *       notification: { success: boolean, mode: 'live'|'demo'|'failed', ... }
 *     }>
 *   }
 */

/**
 * Determine overall notifier mode from an accept-route response.
 * Reads notification.mode on each stop and returns the aggregate mode:
 *   - Any stop with mode 'failed' → 'failed'  (Twilio exception; needs attention)
 *   - Any stop with mode 'live'   → 'live'    (at least one real call succeeded)
 *   - Otherwise                   → 'demo'    (all demo-path; safe default)
 *
 * Never throws. Returns 'demo' for null, undefined, or malformed input.
 *
 * @param {object|null|undefined} acceptRouteResponse
 * @returns {'live'|'demo'|'failed'}
 */
export function getNotifierMode(acceptRouteResponse) {
  if (!acceptRouteResponse || typeof acceptRouteResponse !== 'object') {
    return 'demo';
  }

  const notifications = acceptRouteResponse.notifications;
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return 'demo';
  }

  const modes = notifications
    .map((n) => n?.notification?.mode)
    .filter((m) => typeof m === 'string' && m.length > 0);

  if (modes.length === 0) {
    return 'demo';
  }

  if (modes.some((m) => m === 'failed')) return 'failed';
  if (modes.some((m) => m === 'live')) return 'live';
  return 'demo';
}

/**
 * Returns true if the demo can proceed safely in this mode.
 * 'live' and 'demo' are both safe for presentation.
 * 'failed' means at least one Twilio call threw — present with recovery language.
 *
 * @param {string} mode
 * @returns {boolean}
 */
export function isFallbackSafe(mode) {
  return mode === 'live' || mode === 'demo';
}

/**
 * Returns the exact one-sentence verbal cue the presenter should say for this mode.
 *
 * @param {'live'|'demo'|'failed'|string} mode
 * @returns {string}
 */
export function getPresenterCue(mode) {
  if (mode === 'live') {
    return 'Your phone is ringing now — that is a live ElevenLabs AI call going to the household.';
  }
  if (mode === 'demo') {
    return 'Notifications are queued for all households on the route — the demo run is underway.';
  }
  if (mode === 'failed') {
    return 'Our system will retry the calls automatically — the pickup route is already locked in.';
  }
  return 'Notifications are queued for all households on the route — the demo run is underway.';
}

/**
 * Returns true when the NotificationOverlay should be rendered.
 * True for all known modes (overlay always shows after accept-route).
 * False only on a hard crash (mode is not a known string).
 *
 * @param {string} mode
 * @returns {boolean}
 */
export function shouldShowOverlay(mode) {
  return mode === 'live' || mode === 'demo' || mode === 'failed';
}
