import { api } from './api';

export function getStopKey(stop) {
  const key = stop?.listing_id ?? stop?.id;
  return typeof key === 'string' || typeof key === 'number' ? String(key) : '';
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function shouldSkipStopCompletion({ stop, completedIds = new Set(), inFlightIds = new Set() }) {
  const key = getStopKey(stop);
  if (!key) return { skip: true, reason: 'missing_stop_key', key: '' };
  if (completedIds.has(key)) return { skip: true, reason: 'already_completed', key };
  if (inFlightIds.has(key)) return { skip: true, reason: 'in_flight', key };
  return { skip: false, reason: null, key };
}

export function applyCompletionSuccess({ completedIds = new Set(), collectedLbs = 0, earnedDollars = 0 }, stop) {
  const key = getStopKey(stop);
  if (!key || completedIds.has(key)) {
    return { completedIds, collectedLbs, earnedDollars, key, changed: false };
  }

  const nextCompleted = new Set(completedIds);
  nextCompleted.add(key);
  return {
    completedIds: nextCompleted,
    collectedLbs: collectedLbs + toSafeNumber(stop?.total_lbs),
    earnedDollars: earnedDollars + toSafeNumber(stop?.total_value),
    key,
    changed: true,
  };
}

export function summarizeRouteCompletion({ routeStops = [], completedIds = new Set() }) {
  const totalStops = Array.isArray(routeStops) ? routeStops.length : 0;
  let completedStops = 0;
  (routeStops || []).forEach((stop) => {
    if (completedIds.has(getStopKey(stop))) completedStops += 1;
  });
  return {
    totalStops,
    completedStops,
    allCompleted: totalStops > 0 && completedStops === totalStops,
  };
}

export function summarizeAcceptFailures(acceptData = {}, routeStops = []) {
  const notifications = Array.isArray(acceptData?.notifications) ? acceptData.notifications : [];
  const totalStopsRequested = Number.isFinite(Number(acceptData?.requested_stops))
    ? Number(acceptData.requested_stops)
    : (Array.isArray(routeStops) ? routeStops.length : notifications.length);
  const notificationsSent = Number.isFinite(Number(acceptData?.notifications_sent))
    ? Number(acceptData.notifications_sent)
    : notifications.filter((n) => n?.notification?.success === true).length;

  const failedStops = notifications
    .filter((n) => n?.notification?.success !== true)
    .map((n) => {
      const key = String(n?.listing_id || '');
      const matchedStop = (routeStops || []).find((stop) => getStopKey(stop) === key);
      return {
        listing_id: key,
        household: n?.household || matchedStop?.household_name || 'Unknown stop',
        phone: n?.phone || matchedStop?.phone || '',
        status_code: n?.status_code || 'notification_failed',
        reason: n?.notification?.reason || n?.notification?.error || 'notification_failed',
        retryable: Boolean(n?.retryable),
        attempts: Number.isFinite(Number(n?.attempts)) ? Number(n.attempts) : 0,
      };
    });

  return {
    totalStopsRequested,
    notificationsSent,
    failedNotificationsCount: failedStops.length,
    failedStops,
  };
}

export async function completeStopPersisted({ stop, completedIds = new Set(), inFlightIds = new Set() }) {
  const guard = shouldSkipStopCompletion({ stop, completedIds, inFlightIds });
  if (guard.skip) {
    return { ok: true, skipped: true, reason: guard.reason, listingId: guard.key };
  }

  const response = await api.completeListing(guard.key);
  if (!response?.ok) {
    return {
      ok: false,
      skipped: false,
      reason: 'api_error',
      listingId: guard.key,
      error: response?.error || 'Failed to complete stop',
      status: response?.status ?? 0,
    };
  }

  return {
    ok: true,
    skipped: false,
    reason: null,
    listingId: guard.key,
    listing: response?.data?.listing || null,
  };
}

