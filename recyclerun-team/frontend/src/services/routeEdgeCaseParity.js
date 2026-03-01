/**
 * Phase-3 routing edge-case QA helpers.
 * Owner: Sara
 *
 * Purpose:
 * - Build reproducible scenario inputs for optimizer QA.
 * - Validate route-shape stability (no crash/blank-state contracts).
 * - Compare backend optimize-route output with frontend fallback optimizer.
 */
import { haversine, optimizeRoute } from "../utils/optimizer.js";

export const EDGE_CASE_SCENARIOS = Object.freeze([
  {
    id: "empty_listings",
    label: "Empty Listings",
    maxMinutes: 120,
    truckCapacityLbs: 1000,
    objective: "value",
    description: "No available listings should produce an empty route and valid summary.",
  },
  {
    id: "zero_capacity",
    label: "Zero Capacity",
    maxMinutes: 120,
    truckCapacityLbs: 0,
    objective: "value",
    description: "Truck capacity 0 must not crash and should produce no selected stops.",
  },
  {
    id: "short_time_window",
    label: "Short Time Window",
    maxMinutes: 5,
    truckCapacityLbs: 1000,
    objective: "value",
    description: "Very short drive window should still return a stable route payload.",
  },
  {
    id: "business_heavy_only",
    label: "Business Heavy Only",
    maxMinutes: 180,
    truckCapacityLbs: 2000,
    objective: "lbs",
    description: "Only business listings available; objective favors fast truck fill.",
  },
  {
    id: "long_distance_sparse",
    label: "Long Distance Sparse",
    maxMinutes: 240,
    truckCapacityLbs: 1000,
    objective: "value",
    description: "Keep only farthest few listings from driver anchor.",
  },
]);

export const PARITY_THRESHOLDS = Object.freeze({
  stopCountAbs: 2,
  totalLbsPct: 35,
  totalValuePct: 45,
  totalMilesPct: 45,
  estMinutesPct: 40,
});

const SCENARIO_BY_ID = Object.freeze(
  EDGE_CASE_SCENARIOS.reduce((acc, scenario) => {
    acc[scenario.id] = scenario;
    return acc;
  }, {}),
);

function cloneListings(listings = []) {
  return listings.map((listing) => ({
    ...listing,
    materials: Array.isArray(listing?.materials)
      ? listing.materials.map((m) => ({ ...m }))
      : [],
  }));
}

function toAvailableListings(listings = []) {
  return cloneListings(listings).filter((listing) => listing?.status === "available");
}

function scenarioForId(scenarioId) {
  return SCENARIO_BY_ID[scenarioId] || SCENARIO_BY_ID.zero_capacity;
}

export function buildScenarioInput({
  scenarioId,
  listings,
  driverLat = 37.3541,
  driverLng = -121.9552,
}) {
  const scenario = scenarioForId(scenarioId);
  const available = toAvailableListings(listings);
  let selected = available;

  if (scenario.id === "empty_listings") {
    selected = [];
  } else if (scenario.id === "business_heavy_only") {
    selected = available.filter((listing) => listing?.listing_kind === "business");
  } else if (scenario.id === "long_distance_sparse") {
    selected = [...available]
      .sort(
        (a, b) =>
          haversine(driverLat, driverLng, b.lat, b.lng) -
          haversine(driverLat, driverLng, a.lat, a.lng),
      )
      .slice(0, Math.min(4, available.length));
  }

  return {
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    description: scenario.description,
    driverLat,
    driverLng,
    listings: selected,
    maxMinutes: scenario.maxMinutes,
    truckCapacityLbs: scenario.truckCapacityLbs,
    objective: scenario.objective,
  };
}

export function runFallbackScenario(input) {
  return optimizeRoute({
    driverLat: input.driverLat,
    driverLng: input.driverLng,
    listings: input.listings,
    maxMinutes: input.maxMinutes,
    truckCapacityLbs: input.truckCapacityLbs,
    objective: input.objective,
  });
}

export function validateRouteStability(route) {
  const issues = [];
  if (!route || typeof route !== "object") {
    issues.push("route_not_object");
  }
  if (!Array.isArray(route?.stops)) {
    issues.push("stops_not_array");
  }
  if (!route?.summary || typeof route.summary !== "object") {
    issues.push("summary_not_object");
  }
  if (Array.isArray(route?.stops) && route?.summary) {
    if (route.summary.total_stops !== route.stops.length) {
      issues.push("summary_total_stops_mismatch");
    }
    const etas = route.stops.map((stop) => Number(stop?.eta_minutes || 0));
    const monotonic = etas.every((eta, idx) => idx === 0 || eta >= etas[idx - 1]);
    if (!monotonic) {
      issues.push("eta_not_monotonic");
    }
  }
  return { ok: issues.length === 0, issues };
}

function pctDelta(backendValue, fallbackValue) {
  const b = Number(backendValue || 0);
  const f = Number(fallbackValue || 0);
  if (b === 0 && f === 0) return 0;
  return Math.abs(b - f) / Math.max(Math.abs(b), 1e-6) * 100;
}

export function computeParityDelta(backendRoute, fallbackRoute) {
  const backendSummary = backendRoute?.summary || {};
  const fallbackSummary = fallbackRoute?.summary || {};
  return {
    stopCountAbs: Math.abs(
      Number(backendSummary.total_stops || 0) - Number(fallbackSummary.total_stops || 0),
    ),
    totalLbsPct: pctDelta(backendSummary.total_lbs, fallbackSummary.total_lbs),
    totalValuePct: pctDelta(backendSummary.total_value, fallbackSummary.total_value),
    totalMilesPct: pctDelta(backendSummary.total_miles, fallbackSummary.total_miles),
    estMinutesPct: pctDelta(backendSummary.estimated_minutes, fallbackSummary.estimated_minutes),
  };
}

export function evaluateParity({
  backendRoute,
  fallbackRoute,
  thresholds = PARITY_THRESHOLDS,
}) {
  const delta = computeParityDelta(backendRoute, fallbackRoute);
  const violations = [];
  if (delta.stopCountAbs > thresholds.stopCountAbs) violations.push("stopCountAbs");
  if (delta.totalLbsPct > thresholds.totalLbsPct) violations.push("totalLbsPct");
  if (delta.totalValuePct > thresholds.totalValuePct) violations.push("totalValuePct");
  if (delta.totalMilesPct > thresholds.totalMilesPct) violations.push("totalMilesPct");
  if (delta.estMinutesPct > thresholds.estMinutesPct) violations.push("estMinutesPct");
  return {
    delta,
    thresholds,
    withinThresholds: violations.length === 0,
    violations,
  };
}

async function requestJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, init);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

async function resetDemo(fetchImpl, baseUrl) {
  return requestJson(fetchImpl, `${baseUrl}/listings/reset-demo`, { method: "POST" });
}

async function getAvailableListings(fetchImpl, baseUrl) {
  const result = await requestJson(fetchImpl, `${baseUrl}/listings?status=available`);
  return Array.isArray(result?.data?.listings) ? result.data.listings : [];
}

async function completeListings(fetchImpl, baseUrl, listingIds = []) {
  for (const listingId of listingIds) {
    await requestJson(fetchImpl, `${baseUrl}/listings/${listingId}/complete`, { method: "POST" });
  }
}

/**
 * Live QA runner against backend API (for manual Sara QA sessions).
 * Returns matrix rows with backend/fallback parity decisions.
 */
export async function runRouteEdgeCaseMatrix({
  baseUrl = "http://localhost:5000/api",
  fetchImpl = fetch,
  driverLat = 37.3541,
  driverLng = -121.9552,
}) {
  const rows = [];
  for (const scenario of EDGE_CASE_SCENARIOS) {
    const reset = await resetDemo(fetchImpl, baseUrl);
    if (!reset.ok) {
      rows.push({
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        backendOk: false,
        reason: "reset_demo_failed",
      });
      continue;
    }

    const baseline = await getAvailableListings(fetchImpl, baseUrl);
    const input = buildScenarioInput({
      scenarioId: scenario.id,
      listings: baseline,
      driverLat,
      driverLng,
    });

    const keepIds = new Set(input.listings.map((listing) => listing.id));
    const toComplete = baseline
      .filter((listing) => !keepIds.has(listing.id))
      .map((listing) => listing.id);
    await completeListings(fetchImpl, baseUrl, toComplete);

    const scenarioListings = await getAvailableListings(fetchImpl, baseUrl);

    const backendOptimize = await requestJson(fetchImpl, `${baseUrl}/optimize-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: driverLat,
        lng: driverLng,
        max_minutes: input.maxMinutes,
        truck_capacity_lbs: input.truckCapacityLbs,
        objective: input.objective,
      }),
    });

    const fallbackRoute = runFallbackScenario({
      ...input,
      listings: scenarioListings,
    });

    const backendRoute = backendOptimize.ok ? backendOptimize.data : null;
    const backendStable = validateRouteStability(
      backendRoute || { stops: [], summary: { total_stops: 0 } },
    );
    const fallbackStable = validateRouteStability(fallbackRoute);
    const parity = backendRoute
      ? evaluateParity({ backendRoute, fallbackRoute })
      : {
          delta: null,
          thresholds: PARITY_THRESHOLDS,
          withinThresholds: false,
          violations: ["backend_optimize_failed"],
        };

    rows.push({
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      availableCount: scenarioListings.length,
      backendOk: backendOptimize.ok,
      backendStatus: backendOptimize.status,
      backendStable: backendStable.ok,
      fallbackStable: fallbackStable.ok,
      parityWithinThresholds: parity.withinThresholds,
      parityViolations: parity.violations,
      parityDelta: parity.delta,
    });
  }
  return rows;
}
