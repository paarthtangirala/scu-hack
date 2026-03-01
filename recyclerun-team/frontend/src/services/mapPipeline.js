/**
 * Driver map pipeline helpers.
 * Keeps marker/route/sync behavior deterministic across backend and fallback routes.
 */
import { api } from './api';
import { optimizeRoute } from '../utils/optimizer';

export const DEFAULT_DRIVER_CENTER = { lat: 37.3541, lng: -121.9552 };

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function normalizeKind(kind) {
  return kind === 'business' ? 'business' : 'household';
}

function normalizeStop(stop, index) {
  const lat = toNumber(stop?.lat);
  const lng = toNumber(stop?.lng);
  if (!isValidCoord(lat, lng)) return null;
  const id = String(stop?.listing_id || stop?.id || `stop-${index}`);
  const listing_kind = normalizeKind(stop?.listing_kind);
  return {
    id,
    lat,
    lng,
    index,
    orderNumber: index + 1,
    listing_kind,
    iconType: listing_kind === 'business' ? 'route-business' : 'route-household',
    address: stop?.address || '',
    household_name: stop?.household_name || '',
  };
}

export function buildListingMarkers(listings = []) {
  return (Array.isArray(listings) ? listings : [])
    .filter((listing) => (listing?.status || 'available') === 'available')
    .map((listing, index) => {
      const lat = toNumber(listing?.lat);
      const lng = toNumber(listing?.lng);
      if (!isValidCoord(lat, lng)) return null;
      const listing_kind = normalizeKind(listing?.listing_kind);
      const id = String(listing?.id || `listing-${index}`);
      return {
        id,
        lat,
        lng,
        index,
        listing_kind,
        iconType: listing_kind === 'business' ? 'business' : 'household',
        label: listing?.household_name || 'Listing',
        address: listing?.address || '',
      };
    })
    .filter(Boolean);
}

export function buildRoutePolyline(stops = []) {
  return (Array.isArray(stops) ? stops : [])
    .map((stop) => {
      const lat = toNumber(stop?.lat);
      const lng = toNumber(stop?.lng);
      return isValidCoord(lat, lng) ? { lat, lng } : null;
    })
    .filter(Boolean);
}

export function buildRouteStopMarkers(stops = [], selectedStopIndex = null) {
  return (Array.isArray(stops) ? stops : [])
    .map((stop, index) => normalizeStop(stop, index))
    .filter(Boolean)
    .map((stop) => ({ ...stop, isSelected: selectedStopIndex === stop.index }));
}

export function focusForStopIndex(stops = [], index, fallbackCenter = DEFAULT_DRIVER_CENTER) {
  const normalizedStops = buildRouteStopMarkers(stops);
  if (!Number.isInteger(index) || index < 0 || index >= normalizedStops.length) {
    return { center: fallbackCenter, selectedStopIndex: null };
  }
  const stop = normalizedStops[index];
  return {
    center: { lat: stop.lat, lng: stop.lng },
    selectedStopIndex: index,
  };
}

export function buildDriverMapModel({
  listings = [],
  route = null,
  selectedStopIndex = null,
  fallbackCenter = DEFAULT_DRIVER_CENTER,
} = {}) {
  const routeStops = Array.isArray(route?.stops) ? route.stops : [];
  const listingMarkers = buildListingMarkers(listings);
  const stopMarkers = buildRouteStopMarkers(routeStops, selectedStopIndex);
  const polyline = buildRoutePolyline(routeStops);
  const focus = focusForStopIndex(routeStops, selectedStopIndex, fallbackCenter);
  const orderedStopIds = stopMarkers.map((m) => m.id);

  return {
    listingMarkers,
    stopMarkers,
    polyline,
    center: focus.center,
    selectedStopIndex: focus.selectedStopIndex,
    orderedStopIds,
  };
}

export async function resolveOptimizedRoute({
  lat,
  lng,
  maxMinutes,
  truckCapacity,
  objective,
  listings = [],
  fallbackListings = [],
}) {
  const response = await api.optimizeRoute({ lat, lng, maxMinutes, truckCapacity, objective });
  if (response?.ok && Array.isArray(response?.data?.stops)) {
    return { route: response.data, source: 'backend' };
  }

  const fallbackPool = Array.isArray(listings) && listings.length ? listings : fallbackListings;
  const route = optimizeRoute({
    driverLat: lat,
    driverLng: lng,
    listings: fallbackPool,
    maxMinutes,
    truckCapacityLbs: truckCapacity,
    objective,
  });
  return { route, source: 'fallback' };
}

