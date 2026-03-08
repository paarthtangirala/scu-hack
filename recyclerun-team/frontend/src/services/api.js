/**
 * API service layer — all backend calls in one place.
 * Owner: Sara
 * No other file should call fetch() directly.
 *
 * Every call returns { ok: true, data } on success
 * or { ok: false, error, status } on failure — never throws, never returns null.
 * status: 0 means network/parse error (no HTTP response received).
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api';

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    return { ok: false, error: err.message ?? 'Network error', status: 0 };
  }

  if (!res.ok) {
    let error = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      error = body.error ?? body.message ?? error;
    } catch {}
    return { ok: false, error, status: res.status };
  }

  try {
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: 'Invalid JSON in response', status: res.status };
  }
}

async function requestText(path, options = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    return { ok: false, error: err.message ?? 'Network error', status: 0 };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: text || `HTTP ${res.status}`, status: res.status };
  }
  return { ok: true, data: text };
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

  completePickupJob: (pickupId, payload) =>
    request(`/pickups/${encodeURIComponent(pickupId)}/complete`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getReceipt: (receiptId) =>
    request(`/receipts/${encodeURIComponent(receiptId)}`),

  getOrgDashboard: (orgId, { window = '30d', format = 'json' } = {}) =>
    request(
      `/orgs/${encodeURIComponent(orgId)}/dashboard?window=${encodeURIComponent(window)}&format=${encodeURIComponent(format)}`
    ),

  downloadOrgDashboardCsv: (orgId, { window = '30d' } = {}) =>
    requestText(
      `/orgs/${encodeURIComponent(orgId)}/dashboard?window=${encodeURIComponent(window)}&format=csv`
    ),

  // Classification
  classifyImage: (base64) =>
    request('/classify', { method: 'POST', body: JSON.stringify({ image_base64: base64 }) }),

  startLiveVisionSession: (payload = {}) =>
    request('/live-vision/session/start', { method: 'POST', body: JSON.stringify(payload) }),

  sendLiveVisionFrame: (sessionId, payload) =>
    request(`/live-vision/session/${sessionId}/frame`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  stopLiveVisionSession: (sessionId) =>
    request(`/live-vision/session/${sessionId}/stop`, { method: 'POST', body: JSON.stringify({}) }),

  getLiveVisionSessionHealth: (sessionId) =>
    request(`/live-vision/session/${sessionId}/health`),

  // Route
  optimizeRoute: ({ lat, lng, maxMinutes, truckCapacity, objective }) =>
    request('/optimize-route', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, max_minutes: maxMinutes, truck_capacity_lbs: truckCapacity, objective }),
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
