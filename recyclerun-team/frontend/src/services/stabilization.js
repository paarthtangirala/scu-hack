import { api } from './api.js';
import { DEMO_LISTINGS } from './demoData';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function safeString(value, fallback = '') {
  if (value == null) {
    return fallback;
  }
  const str = String(value).trim();
  return str.length ? str : fallback;
}

export function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function safeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function safeCurrency(value, fallback = 0) {
  return Number(safeNumber(value, fallback).toFixed(2));
}

export function normalizeMaterialsForRender(materials) {
  return safeArray(materials)
    .map((material, index) => {
      const type = safeString(material?.type, 'unknown');
      return {
        id: safeString(material?.id, `${type}-${index}`),
        type,
        lbs: Number(safeNumber(material?.lbs ?? material?.weight_lbs, 0).toFixed(1)),
        value: safeCurrency(material?.value ?? material?.estimated_value, 0),
      };
    })
    .filter((material) => material.lbs >= 0);
}

export function normalizeRouteStopsForRender(stops) {
  return safeArray(stops).map((stop, index) => {
    const listingId = safeString(stop?.listing_id ?? stop?.id, `stop-${index}`);
    const listingKind = safeString(stop?.listing_kind, 'household').toLowerCase() === 'business'
      ? 'business'
      : 'household';
    return {
      id: listingId,
      listing_id: listingId,
      listing_kind: listingKind,
      household_name: safeString(stop?.household_name, 'Unknown stop'),
      address: safeString(stop?.address, 'Address unavailable'),
      notes: safeString(stop?.notes, ''),
      phone: safeString(stop?.phone, ''),
      lat: safeNumber(stop?.lat, 0),
      lng: safeNumber(stop?.lng, 0),
      total_lbs: Number(safeNumber(stop?.total_lbs, 0).toFixed(1)),
      total_value: safeCurrency(stop?.total_value, 0),
      distance_from_prev: Number(safeNumber(stop?.distance_from_prev, 0).toFixed(1)),
      travel_minutes: Number(safeNumber(stop?.travel_minutes, 0).toFixed(1)),
      eta_minutes: safeInteger(stop?.eta_minutes, 0),
      materials: normalizeMaterialsForRender(stop?.materials),
    };
  });
}

export function normalizeRouteSummary(summary) {
  if (!isPlainObject(summary)) {
    return {
      total_stops: 0,
      total_miles: 0,
      estimated_minutes: 0,
      total_lbs: 0,
      lbs_per_hour: 0,
      total_value: 0,
      objective: 'value',
    };
  }

  const objective = safeString(summary.objective, 'value').toLowerCase() === 'lbs' ? 'lbs' : 'value';
  return {
    total_stops: safeInteger(summary.total_stops, 0),
    total_miles: Number(safeNumber(summary.total_miles, 0).toFixed(1)),
    estimated_minutes: safeInteger(summary.estimated_minutes, 0),
    total_lbs: Number(safeNumber(summary.total_lbs, 0).toFixed(1)),
    lbs_per_hour: Number(safeNumber(summary.lbs_per_hour, 0).toFixed(1)),
    total_value: safeCurrency(summary.total_value, 0),
    objective,
  };
}

export function normalizeRouteForRender(route) {
  if (!isPlainObject(route)) {
    return null;
  }

  const stops = normalizeRouteStopsForRender(route.stops);
  return {
    ...route,
    stops,
    summary: normalizeRouteSummary(route.summary),
  };
}

export function normalizeListingsForRender(listings) {
  return safeArray(listings).map((listing, index) => {
    const listingId = safeString(listing?.id, `listing-${index}`);
    const listingKind = safeString(listing?.listing_kind, 'household').toLowerCase() === 'business'
      ? 'business'
      : 'household';
    return {
      id: listingId,
      listing_kind: listingKind,
      household_name: safeString(listing?.household_name, 'Unnamed listing'),
      address: safeString(listing?.address, 'Address unavailable'),
      status: safeString(listing?.status, 'available'),
      lat: safeNumber(listing?.lat, 0),
      lng: safeNumber(listing?.lng, 0),
      phone: safeString(listing?.phone, ''),
      total_lbs: Number(safeNumber(listing?.total_lbs, 0).toFixed(1)),
      total_value: safeCurrency(listing?.total_value, 0),
      materials: normalizeMaterialsForRender(listing?.materials),
    };
  });
}

export function normalizeNotificationsForRender(notifications) {
  return safeArray(notifications).map((notification, index) => {
    const mode = safeString(notification?.notification?.mode, 'demo');
    return {
      id: safeString(notification?.listing_id, `notification-${index}`),
      household: safeString(notification?.household, 'Unknown household'),
      eta_minutes: safeInteger(notification?.eta_minutes, 0),
      status_code: safeString(notification?.status_code, mode === 'live' ? 'claimed_notified' : 'demo_notified'),
      notification: {
        mode,
        success: Boolean(notification?.notification?.success),
        reason: safeString(notification?.notification?.reason ?? notification?.notification?.error, ''),
        message: safeString(notification?.notification?.message, ''),
      },
    };
  });
}

export function normalizeAcceptSummary(summary) {
  if (!isPlainObject(summary)) {
    return {
      totalStopsRequested: 0,
      notificationsSent: 0,
      failedNotificationsCount: 0,
      failedStops: [],
    };
  }

  return {
    totalStopsRequested: safeInteger(summary.totalStopsRequested, 0),
    notificationsSent: safeInteger(summary.notificationsSent, 0),
    failedNotificationsCount: safeInteger(summary.failedNotificationsCount, 0),
    failedStops: safeArray(summary.failedStops).map((item, index) => ({
      listing_id: safeString(item?.listing_id, `failed-${index}`),
      household: safeString(item?.household, 'Unknown stop'),
      phone: safeString(item?.phone, ''),
      status_code: safeString(item?.status_code, 'notification_failed'),
      reason: safeString(item?.reason, 'notification_failed'),
      retryable: Boolean(item?.retryable),
    })),
  };
}

export function normalizeImpactSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) {
    return null;
  }

  return {
    completed_pickups: safeInteger(snapshot.completed_pickups, 0),
    total_lbs_diverted: Number(safeNumber(snapshot.total_lbs_diverted, 0).toFixed(1)),
    total_value_paid: safeCurrency(snapshot.total_value_paid, 0),
    co2_saved_tons: Number(safeNumber(snapshot.co2_saved_tons, 0).toFixed(2)),
  };
}

export function getResponsiveLayout(viewportWidth = 1280) {
  const width = safeNumber(viewportWidth, 1280);
  const isPhone = width <= 480;
  const isTablet = width > 480 && width <= 900;
  const isCompactDesktop = width > 900 && width <= 1280;

  return {
    viewportWidth: width,
    isPhone,
    isTablet,
    isCompactDesktop,
    spacing: {
      cardPadding: isPhone ? '1rem' : '1.5rem',
      sectionGap: isPhone ? '0.5rem' : '0.75rem',
    },
    driver: {
      mapHeight: isPhone ? 260 : isTablet ? 320 : 380,
      controlColumns: isPhone ? '1fr' : isCompactDesktop ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))',
      listingCardMinWidth: isPhone ? 220 : 280,
      legendDirection: isPhone ? 'column' : 'row',
      failureRowFontSize: isPhone ? '0.72rem' : '0.75rem',
    },
    rates: {
      tableMinWidth: isPhone ? 640 : 760,
      sourceFontSize: isPhone ? '0.74rem' : '0.78rem',
    },
    impact: {
      sourceFontSize: isPhone ? '0.74rem' : '0.78rem',
    },
  };
}

export async function runSafeAsync(task, fallbackValue = null) {
  try {
    return await task();
  } catch (error) {
    if (typeof fallbackValue === 'function') {
      return fallbackValue(error);
    }
    return fallbackValue;
  }
}

export async function buildColdStartState({ apiClient = api } = {}) {
  const [listingsRes, impactRes, materialsRes] = await Promise.all([
    runSafeAsync(() => apiClient.getListings(), { ok: false, status: 0, error: 'listings_unavailable' }),
    runSafeAsync(() => apiClient.getImpact(), { ok: false, status: 0, error: 'impact_unavailable' }),
    runSafeAsync(() => apiClient.getMaterials(), { ok: false, status: 0, error: 'materials_unavailable' }),
  ]);

  const listings = listingsRes?.ok
    ? normalizeListingsForRender(listingsRes?.data?.listings)
    : normalizeListingsForRender(DEMO_LISTINGS);

  return {
    listings,
    impact: normalizeImpactSnapshot(impactRes?.data),
    materials: normalizeMaterialsForRender(materialsRes?.data),
    notifications: normalizeNotificationsForRender(null),
    errors: [listingsRes, impactRes, materialsRes]
      .filter((result) => !result?.ok)
      .map((result) => safeString(result?.error, 'unknown_error')),
  };
}
