import { describe, expect, it } from "vitest";

import { DEMO_LISTINGS } from "../demoData.js";
import {
  EDGE_CASE_SCENARIOS,
  buildScenarioInput,
  runFallbackScenario,
  validateRouteStability,
  evaluateParity,
  PARITY_THRESHOLDS,
} from "../routeEdgeCaseParity.js";

describe("route edge-case parity helpers", () => {
  it("exposes all required phase-3 scenarios", () => {
    const ids = EDGE_CASE_SCENARIOS.map((scenario) => scenario.id);
    expect(ids).toEqual([
      "empty_listings",
      "zero_capacity",
      "short_time_window",
      "business_heavy_only",
      "long_distance_sparse",
    ]);
  });

  it.each(EDGE_CASE_SCENARIOS.map((scenario) => scenario.id))(
    "fallback optimizer is stable for scenario %s",
    (scenarioId) => {
      const input = buildScenarioInput({
        scenarioId,
        listings: DEMO_LISTINGS,
        driverLat: 37.3541,
        driverLng: -121.9552,
      });
      const route = runFallbackScenario(input);
      const stability = validateRouteStability(route);
      expect(stability.ok).toBe(true);
      expect(Array.isArray(route.stops)).toBe(true);
      expect(route.summary.total_stops).toBe(route.stops.length);
    },
  );

  it("empty-listings scenario produces empty route safely", () => {
    const input = buildScenarioInput({
      scenarioId: "empty_listings",
      listings: DEMO_LISTINGS,
    });
    const route = runFallbackScenario(input);
    expect(route.stops).toHaveLength(0);
    expect(route.summary.total_stops).toBe(0);
  });

  it("zero-capacity scenario does not crash and reports zero fill", () => {
    const input = buildScenarioInput({
      scenarioId: "zero_capacity",
      listings: DEMO_LISTINGS,
    });
    const route = runFallbackScenario(input);
    expect(route.summary.truck_fill_pct).toBe(0);
  });

  it("business-heavy scenario keeps only business listings in candidate set", () => {
    const input = buildScenarioInput({
      scenarioId: "business_heavy_only",
      listings: DEMO_LISTINGS,
    });
    expect(input.listings.length).toBeGreaterThan(0);
    expect(input.listings.every((listing) => listing.listing_kind === "business")).toBe(true);
  });

  it("parity evaluator passes identical backend/fallback summaries", () => {
    const sample = {
      stops: [{ listing_id: "l1", eta_minutes: 10 }],
      summary: {
        total_stops: 1,
        total_lbs: 100,
        total_value: 12.5,
        total_miles: 4,
        estimated_minutes: 25,
      },
    };
    const result = evaluateParity({ backendRoute: sample, fallbackRoute: sample });
    expect(result.withinThresholds).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.delta.stopCountAbs).toBe(0);
  });

  it("parity evaluator flags large divergence over thresholds", () => {
    const backend = {
      stops: [{ listing_id: "l1", eta_minutes: 10 }],
      summary: {
        total_stops: 1,
        total_lbs: 100,
        total_value: 10,
        total_miles: 5,
        estimated_minutes: 30,
      },
    };
    const fallback = {
      stops: [{ listing_id: "l1", eta_minutes: 10 }, { listing_id: "l2", eta_minutes: 20 }],
      summary: {
        total_stops: 2,
        total_lbs: 10,
        total_value: 100,
        total_miles: 20,
        estimated_minutes: 120,
      },
    };
    const result = evaluateParity({
      backendRoute: backend,
      fallbackRoute: fallback,
      thresholds: PARITY_THRESHOLDS,
    });
    expect(result.withinThresholds).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
