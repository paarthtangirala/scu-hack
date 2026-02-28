/**
 * API service layer — all backend calls in one place.
 * Owner: Sara
 * No other file should call fetch() directly.
 */
const BASE = 'http://localhost:5000/api';

async function request(path, options = {}) {
  try {
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return await res.json();
  } catch {
    return null; // caller handles null = offline/demo mode
  }
}

export const api = {
  // Listings
  getListings: (status = 'available') =>
    request(`/listings?status=${status}`),

  createListing: (data) =>
    request('/listings', { method: 'POST', body: JSON.stringify(data) }),

  completeListing: (id) =>
    request(`/listings/${id}/complete`, { method: 'POST' }),

  resetDemo: () =>
    request('/listings/reset-demo', { method: 'POST' }),

  // Classification
  classifyImage: (base64) =>
    request('/classify', { method: 'POST', body: JSON.stringify({ image_base64: base64 }) }),

  // Route
  optimizeRoute: ({ lat, lng, maxMinutes, truckCapacity }) =>
    request('/optimize-route', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, max_minutes: maxMinutes, truck_capacity_lbs: truckCapacity }),
    }),

  acceptRoute: ({ stops, driverName }) =>
    request('/accept-route', {
      method: 'POST',
      body: JSON.stringify({ stops, driver_name: driverName }),
    }),

  // Stats
  getImpact: () => request('/impact'),
  getMaterials: () => request('/materials'),
  health: () => request('/health'),
};
