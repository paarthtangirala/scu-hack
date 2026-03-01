import { API_BASE_URL } from "../config";

const REQUEST_TIMEOUT_MS = 30000;
const MAX_DEBUG_SNIPPET = 180;

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

function hintForServerStatus(status) {
  if (status === 400 || status === 422) {
    return "Request validation failed. Review required fields and value formats.";
  }
  if (status === 401 || status === 403) {
    return "Request not authorized. Verify API credentials or access policy.";
  }
  if (status === 404) {
    return "Endpoint not found. Verify backend route and API base URL.";
  }
  if (status === 409) {
    return "Data conflict detected. Refresh and retry with the latest listing state.";
  }
  if (status === 429) {
    return "Rate limit reached. Wait briefly, then retry.";
  }
  if (status >= 500) {
    return "Backend/tunnel unavailable. Check server health and retry.";
  }
  return "Request failed. Verify payload and backend logs, then retry.";
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

function compactSnippet(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > MAX_DEBUG_SNIPPET ? `${text.slice(0, MAX_DEBUG_SNIPPET)}...` : text;
}

function isHealthPayloadValid(data) {
  return (
    data != null &&
    typeof data === "object" &&
    typeof data.status === "string" &&
    typeof data.seeded_listings === "number" &&
    typeof data.total_listings === "number"
  );
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
    let parsed = true;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        parsed = false;
        data = { raw: compactSnippet(text) };
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: "server_error",
        hint: hintForServerStatus(response.status),
        error: formatServerError(response.status, data),
        data,
      };
    }

    if (text && !parsed) {
      return {
        ok: false,
        status: response.status,
        code: "invalid_json",
        hint: "API returned non-JSON content. Verify API base points to the Bin2Bucks backend.",
        error: `Invalid JSON response for ${path}`,
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
  health: async () => {
    const response = await request("/health");
    if (!response.ok) return response;
    if (isHealthPayloadValid(response.data)) return response;
    return {
      ok: false,
      status: response.status,
      code: "invalid_health_payload",
      hint: "Unexpected /health payload. Confirm API base points to the Bin2Bucks backend.",
      error: "Health endpoint returned unexpected JSON shape.",
      data: response.data,
    };
  },
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
  startLiveVisionSession: (payload = {}) =>
    request("/live-vision/session/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendLiveVisionFrame: (sessionId, payload) =>
    request(`/live-vision/session/${sessionId}/frame`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  stopLiveVisionSession: (sessionId) =>
    request(`/live-vision/session/${sessionId}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getLiveVisionSessionHealth: (sessionId) =>
    request(`/live-vision/session/${sessionId}/health`),
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
