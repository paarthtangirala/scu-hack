import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDriverMapModel,
  buildListingMarkers,
  buildRoutePolyline,
  buildRouteStopMarkers,
  focusForStopIndex,
  resolveOptimizedRoute,
} from './mapPipeline';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    optimizeRoute: vi.fn(),
  },
}));

const SAMPLE_LISTINGS = [
  {
    id: 'h1',
    status: 'AVAILABLE',
    listing_kind: 'household',
    household_name: 'Home One',
    address: '1 A St',
    lat: 37.3541,
    lng: -121.9552,
    total_lbs: 12,
    total_value: 4.5,
  },
  {
    id: 'b1',
    status: 'available',
    listing_kind: 'business',
    household_name: 'Biz One',
    address: '2 B St',
    lat: 37.3591,
    lng: -121.9492,
    total_lbs: 220,
    total_value: 20.5,
  },
];

const SAMPLE_STOPS = [
  { listing_id: 's1', lat: 37.351, lng: -121.951, listing_kind: 'household', address: 'A' },
  { listing_id: 's2', lat: 37.352, lng: -121.952, listing_kind: 'business', address: 'B' },
  { listing_id: 's3', lat: 37.353, lng: -121.953, listing_kind: 'household', address: 'C' },
];

describe('map pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marker rendering: all listings produce markers with correct kind-specific icon type', () => {
    const markers = buildListingMarkers(SAMPLE_LISTINGS);
    expect(markers).toHaveLength(2);
    expect(markers[0].iconType).toBe('household');
    expect(markers[1].iconType).toBe('business');
  });

  it('status filtering is case-insensitive for available listings', () => {
    const markers = buildListingMarkers([
      ...SAMPLE_LISTINGS,
      {
        id: 'c1',
        status: 'Claimed',
        listing_kind: 'household',
        household_name: 'Claimed One',
        address: '3 C St',
        lat: 37.36,
        lng: -121.95,
      },
    ]);

    expect(markers.map((marker) => marker.id)).toEqual(['h1', 'b1']);
  });

  it('route polyline: ordered stop coordinates produce correct sequence', () => {
    const polyline = buildRoutePolyline(SAMPLE_STOPS);
    expect(polyline).toEqual([
      { lat: 37.351, lng: -121.951 },
      { lat: 37.352, lng: -121.952 },
      { lat: 37.353, lng: -121.953 },
    ]);
  });

  it('stop sync: selecting stop card index N focuses map on stop N coordinates', () => {
    const focused = focusForStopIndex(SAMPLE_STOPS, 1);
    expect(focused.selectedStopIndex).toBe(1);
    expect(focused.center).toEqual({ lat: 37.352, lng: -121.952 });
  });

  it('fallback: map renders correctly when route comes from client-side optimizer', async () => {
    api.optimizeRoute.mockResolvedValue({ ok: false, error: 'network', status: 0 });

    const { route, source } = await resolveOptimizedRoute({
      lat: 37.3541,
      lng: -121.9552,
      maxMinutes: 120,
      truckCapacity: 1000,
      objective: 'lbs',
      listings: SAMPLE_LISTINGS,
      fallbackListings: [],
    });
    const model = buildDriverMapModel({
      listings: SAMPLE_LISTINGS,
      route,
      selectedStopIndex: 0,
    });

    expect(source).toBe('fallback');
    expect(Array.isArray(route?.stops)).toBe(true);
    expect(Array.isArray(model.stopMarkers)).toBe(true);
    expect(Array.isArray(model.polyline)).toBe(true);
  });

  it('backend empty route falls back to client optimizer when listings are available', async () => {
    api.optimizeRoute.mockResolvedValue({
      ok: true,
      data: {
        stops: [],
        summary: {
          total_stops: 0,
          total_value: 0,
          total_lbs: 0,
          total_miles: 0,
          estimated_minutes: 0,
          lbs_per_hour: 0,
          objective: 'lbs',
        },
      },
    });

    const { route, source } = await resolveOptimizedRoute({
      lat: 37.3541,
      lng: -121.9552,
      maxMinutes: 120,
      truckCapacity: 1000,
      objective: 'lbs',
      listings: SAMPLE_LISTINGS,
      fallbackListings: [],
    });

    expect(source).toBe('fallback');
    expect(Array.isArray(route?.stops)).toBe(true);
    expect(route.stops.length).toBeGreaterThan(0);
  });

  it('no desync: list order and map marker order always match same index', () => {
    const stopMarkers = buildRouteStopMarkers(SAMPLE_STOPS);
    expect(stopMarkers).toHaveLength(SAMPLE_STOPS.length);
    stopMarkers.forEach((marker, index) => {
      expect(marker.orderNumber).toBe(index + 1);
      expect(marker.id).toBe(SAMPLE_STOPS[index].listing_id);
    });
  });

  it('edge case: empty stops array produces no markers and no polyline without crashing', () => {
    expect(() => buildRouteStopMarkers([])).not.toThrow();
    expect(() => buildRoutePolyline([])).not.toThrow();
    const model = buildDriverMapModel({
      listings: SAMPLE_LISTINGS,
      route: { stops: [] },
      selectedStopIndex: 0,
    });
    expect(model.stopMarkers).toEqual([]);
    expect(model.polyline).toEqual([]);
    expect(model.selectedStopIndex).toBeNull();
  });
});
