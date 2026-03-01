import { API_BASE_URL } from "../config";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data?.message || "Request failed",
        data,
      };
    }

    return { ok: true, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.message || "Network error",
      data: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  health: () => request("/health"),
  getImpact: () => request("/impact"),
  getMaterials: () => request("/materials"),
  getListings: (status = "available") =>
    request(`/listings?status=${encodeURIComponent(status)}`),
  createListing: (payload) =>
    request("/listings", { method: "POST", body: JSON.stringify(payload) }),
  resetDemo: () => request("/listings/reset-demo", { method: "POST" }),
  completeListing: (listingId) =>
    request(`/listings/${listingId}/complete`, { method: "POST" }),
  classifyImage: (base64Image) =>
    request("/classify", {
      method: "POST",
      body: JSON.stringify({ image_base64: base64Image }),
    }),
  optimizeRoute: ({ lat, lng, maxMinutes, truckCapacity, objective }) =>
    request("/optimize-route", {
      method: "POST",
      body: JSON.stringify({
        lat,
        lng,
        max_minutes: maxMinutes,
        truck_capacity_lbs: truckCapacity,
        objective,
      }),
    }),
  acceptRoute: ({ stops, driverName, requestId }) =>
    request("/accept-route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
      },
      body: JSON.stringify({
        request_id: requestId,
        driver_name: driverName,
        stops,
      }),
    }),
};
