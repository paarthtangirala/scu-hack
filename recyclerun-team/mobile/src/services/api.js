import { API_BASE_URL } from "../config";

const REQUEST_TIMEOUT_MS = 30000;

function firstBackendErrorMessage(data) {
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  if (!errors.length) return "";
  const message = errors[0]?.message;
  return typeof message === "string" ? message : "";
}

function formatServerError(status, data) {
  const base = data?.message || data?.error || `HTTP ${status}`;
  const detail = firstBackendErrorMessage(data);
  return detail ? `${base}: ${detail}` : base;
}

function formatNetworkError(path, error) {
  if (error?.name === "AbortError") {
    return {
      code: "timeout",
      hint: "Request timed out. Check backend/tunnel health and retry.",
      message: `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s for ${path}.`,
    };
  }

  const rawMessage = String(error?.message || "").toLowerCase();
  const unreachable =
    rawMessage.includes("network request failed") ||
    rawMessage.includes("failed to fetch") ||
    rawMessage.includes("load failed");
  if (unreachable) {
    return {
      code: "network_unreachable",
      hint: "Cannot reach API. Confirm backend is running and API URL/tunnel is valid.",
      message: `Cannot reach backend for ${path}.`,
    };
  }

  return {
    code: "network_error",
    hint: "Unexpected network error. Retry once, then verify API base URL and backend logs.",
    message: `Network error for ${path}: ${error?.message || "Unknown error"}`,
  };
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${API_BASE_URL}${path}`;

  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: "server_error",
        hint: "Server rejected the request. Review input fields and try again.",
        error: formatServerError(response.status, data),
        data,
      };
    }

    return { ok: true, status: response.status, data };
  } catch (error) {
    const network = formatNetworkError(path, error);
    return {
      ok: false,
      status: 0,
      code: network.code,
      hint: network.hint,
      error: network.message,
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
