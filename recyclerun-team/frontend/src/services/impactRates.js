import { api } from './api';
import { DEMO_LISTINGS, MATERIAL_RATES } from './demoData';

export const IMPACT_CACHE_KEY = 'impact_cache_v1';
export const MATERIALS_CACHE_KEY = 'materials_cache_v1';
export const DEFAULT_DASHBOARD_ORG_ID = 'org_santa_clara_demo';

function toFiniteNumber(value, defaultValue = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readCache(storage, key) {
  if (!storage || typeof storage.getItem !== 'function') {
    return null;
  }
  try {
    return safeParseJson(storage.getItem(key));
  } catch {
    return null;
  }
}

function writeCache(storage, key, value) {
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/storage errors; fallback behavior still works.
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function deriveImpactFromListings(listings = []) {
  let completedPickups = 0;
  let totalLbs = 0;
  let totalValue = 0;

  for (const listing of listings) {
    completedPickups += 1;
    totalLbs += toFiniteNumber(listing?.total_lbs, 0);
    totalValue += toFiniteNumber(listing?.total_value, 0);
  }

  return {
    completed_pickups: completedPickups,
    total_lbs_diverted: Number(totalLbs.toFixed(1)),
    total_value_paid: Number(totalValue.toFixed(2)),
    co2_saved_tons: Number((totalLbs * 0.0007).toFixed(2)),
  };
}

export function normalizeImpactPayload(payload) {
  if (!isPlainObject(payload)) {
    return null;
  }

  return {
    completed_pickups: toFiniteNumber(payload.completed_pickups, 0),
    total_lbs_diverted: Number(toFiniteNumber(payload.total_lbs_diverted, 0).toFixed(1)),
    total_value_paid: Number(toFiniteNumber(payload.total_value_paid, 0).toFixed(2)),
    co2_saved_tons: Number(toFiniteNumber(payload.co2_saved_tons, 0).toFixed(2)),
  };
}

export function normalizeOrgDashboardPayload(payload) {
  if (!isPlainObject(payload) || !isPlainObject(payload.summary)) {
    return null;
  }

  const summary = {
    completed_pickups: toFiniteNumber(payload.summary.completed_pickups, 0),
    total_lbs_diverted: Number(toFiniteNumber(payload.summary.total_lbs_diverted, 0).toFixed(1)),
    total_value_paid: Number(toFiniteNumber(payload.summary.total_value_paid, 0).toFixed(2)),
    contamination_rate: Number(toFiniteNumber(payload.summary.contamination_rate, 0).toFixed(2)),
    mean_pickup_time_minutes: Number(toFiniteNumber(payload.summary.mean_pickup_time_minutes, 0).toFixed(1)),
    mean_estimated_confidence: Number(toFiniteNumber(payload.summary.mean_estimated_confidence, 0).toFixed(2)),
    mean_variance_lbs: Number(toFiniteNumber(payload.summary.mean_variance_lbs, 0).toFixed(1)),
    co2_saved_tons: Number((toFiniteNumber(payload.summary.total_lbs_diverted, 0) * 0.00025).toFixed(2)),
  };

  return {
    org: isPlainObject(payload.org) ? payload.org : null,
    window: typeof payload.window === 'string' ? payload.window : '30d',
    receipt_count: toFiniteNumber(payload.receipt_count, 0),
    summary,
    latest_receipts: Array.isArray(payload.latest_receipts) ? payload.latest_receipts : [],
    all_receipts: Array.isArray(payload.all_receipts) ? payload.all_receipts : [],
    material_mix: Array.isArray(payload.material_mix) ? payload.material_mix : [],
    hotspots: Array.isArray(payload.hotspots) ? payload.hotspots : [],
    export_links: isPlainObject(payload.export_links) ? payload.export_links : {},
  };
}

export function isImpactEmpty(stats) {
  if (!stats) {
    return true;
  }

  return (
    toFiniteNumber(stats.completed_pickups, 0) <= 0 &&
    toFiniteNumber(stats.total_lbs_diverted, 0) <= 0 &&
    toFiniteNumber(stats.total_value_paid, 0) <= 0 &&
    toFiniteNumber(stats.co2_saved_tons, 0) <= 0
  );
}

export function buildImpactCards(stats) {
  if (!stats) {
    return [];
  }

  return [
    { icon: '🔁', num: stats.completed_pickups, label: 'Completed pickups' },
    { icon: '⚖️', num: `${stats.total_lbs_diverted} lbs`, label: 'Lbs diverted from landfill' },
    { icon: '💰', num: `$${stats.total_value_paid}`, label: 'Paid to drivers' },
    { icon: '🌱', num: `${stats.co2_saved_tons} tons`, label: 'CO₂ saved vs. landfill' },
  ];
}

function toMaterialRows(materialsPayload) {
  if (Array.isArray(materialsPayload)) {
    return materialsPayload
      .map((row) => {
        if (!row || typeof row !== 'object') {
          return null;
        }
        const type = String(row.type ?? '').trim();
        if (!type) {
          return null;
        }
        return {
          type,
          label: row.label ?? MATERIAL_RATES[type]?.label ?? type,
          emoji: row.emoji ?? MATERIAL_RATES[type]?.emoji ?? '♻️',
          rate: toFiniteNumber(row.rate, 0),
          source: row.source ?? 'api',
        };
      })
      .filter(Boolean);
  }

  if (!isPlainObject(materialsPayload)) {
    return [];
  }

  return Object.entries(materialsPayload).map(([type, value]) => {
    if (isPlainObject(value)) {
      return {
        type,
        label: value.label ?? MATERIAL_RATES[type]?.label ?? type,
        emoji: value.emoji ?? MATERIAL_RATES[type]?.emoji ?? '♻️',
        rate: toFiniteNumber(value.rate, 0),
        source: value.source ?? 'api',
      };
    }

    return {
      type,
      label: MATERIAL_RATES[type]?.label ?? type,
      emoji: MATERIAL_RATES[type]?.emoji ?? '♻️',
      rate: toFiniteNumber(value, 0),
      source: 'api',
    };
  });
}

export function normalizeMaterialsPayload(payload) {
  if (payload == null) {
    return [];
  }
  return toMaterialRows(payload).sort((a, b) => a.label.localeCompare(b.label));
}

export function sourceLabel(source) {
  if (source === 'live') {
    return 'Live backend';
  }
  if (source === 'cache') {
    return 'Offline cache';
  }
  if (source === 'demo') {
    return 'Demo fallback';
  }
  return 'Unknown source';
}

export async function loadImpactData({
  apiClient = api,
  storage = globalThis?.localStorage,
  demoListings = DEMO_LISTINGS,
  orgId = DEFAULT_DASHBOARD_ORG_ID,
  window = '30d',
} = {}) {
  if (typeof apiClient.getOrgDashboard === 'function') {
    const dashboardRes = await apiClient.getOrgDashboard(orgId, { window });

    if (dashboardRes?.ok) {
      const dashboard = normalizeOrgDashboardPayload(dashboardRes.data);
      const stats = normalizeImpactPayload(dashboard?.summary);
      if (!dashboard || !stats || isImpactEmpty(stats)) {
        return { state: 'empty', source: 'live', stats: null, dashboard: null, error: null };
      }
      writeCache(storage, IMPACT_CACHE_KEY, stats);
      return { state: 'live', source: 'live', stats, dashboard, error: null };
    }

    if (dashboardRes?.status === 0) {
      const cachedStats = normalizeImpactPayload(readCache(storage, IMPACT_CACHE_KEY));
      if (cachedStats && !isImpactEmpty(cachedStats)) {
        return { state: 'offline', source: 'cache', stats: cachedStats, dashboard: null, error: null };
      }

      const demoStats = deriveImpactFromListings(demoListings);
      return { state: 'offline', source: 'demo', stats: demoStats, dashboard: null, error: null };
    }
  }

  const res = await apiClient.getImpact();

  if (res?.ok) {
    const stats = normalizeImpactPayload(res.data);
    if (!stats || isImpactEmpty(stats)) {
      return { state: 'empty', source: 'live', stats: null, dashboard: null, error: null };
    }
    writeCache(storage, IMPACT_CACHE_KEY, stats);
    return { state: 'live', source: 'live', stats, dashboard: null, error: null };
  }

  if (res?.status === 0) {
    const cachedStats = normalizeImpactPayload(readCache(storage, IMPACT_CACHE_KEY));
    if (cachedStats && !isImpactEmpty(cachedStats)) {
      return { state: 'offline', source: 'cache', stats: cachedStats, dashboard: null, error: null };
    }

    const demoStats = deriveImpactFromListings(demoListings);
    return { state: 'offline', source: 'demo', stats: demoStats, dashboard: null, error: null };
  }

  return {
    state: 'error',
    source: null,
    stats: null,
    dashboard: null,
    error: res?.error ?? 'Failed to load impact data',
    status: res?.status,
  };
}

export async function loadMaterialsData({
  apiClient = api,
  storage = globalThis?.localStorage,
  demoRates = MATERIAL_RATES,
} = {}) {
  const res = await apiClient.getMaterials();

  if (res?.ok) {
    const rows = normalizeMaterialsPayload(res.data);
    if (rows.length === 0) {
      return { state: 'empty', source: 'live', materials: [], error: null };
    }
    writeCache(storage, MATERIALS_CACHE_KEY, rows);
    return { state: 'live', source: 'live', materials: rows, error: null };
  }

  if (res?.status === 0) {
    const cachedRows = normalizeMaterialsPayload(readCache(storage, MATERIALS_CACHE_KEY));
    if (cachedRows.length > 0) {
      return { state: 'offline', source: 'cache', materials: cachedRows, error: null };
    }

    const demoRows = normalizeMaterialsPayload(demoRates);
    return { state: 'offline', source: 'demo', materials: demoRows, error: null };
  }

  return {
    state: 'error',
    source: null,
    materials: [],
    error: res?.error ?? 'Failed to load material rates',
    status: res?.status,
  };
}
