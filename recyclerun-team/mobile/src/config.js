import { NativeModules } from "react-native";

const DEFAULT_API_PORT = "5050";
const ENV_API_BASE_URL = String(process.env.EXPO_PUBLIC_API_BASE_URL || "").trim();
const ENV_GOOGLE_MAPS_API_KEY = String(
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_KEY || "",
).trim();
const AUTO_LAN_ENABLED = String(process.env.EXPO_PUBLIC_AUTO_LAN || "1") !== "0";
const API_PORT = String(process.env.EXPO_PUBLIC_API_PORT || DEFAULT_API_PORT).trim() || DEFAULT_API_PORT;

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function isIpv4(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isPrivateIpv4(host) {
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  );
}

function hostFromScriptURL(scriptURL) {
  if (!scriptURL) return "";
  try {
    return new URL(scriptURL).hostname || "";
  } catch {
    const match = String(scriptURL).match(/^[a-z]+:\/\/([^/:?#]+)(?::\d+)?/i);
    return match?.[1] || "";
  }
}

function deriveLanApiBaseUrl() {
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  const host = hostFromScriptURL(scriptURL);
  if (!host || !isIpv4(host)) return "";
  if (host === "127.0.0.1" || host === "0.0.0.0") return "";
  return `http://${host}:${API_PORT}/api`;
}

function shouldPreferAutoLan(envApiBaseUrl) {
  if (!envApiBaseUrl) return true;
  const lower = envApiBaseUrl.toLowerCase();
  return (
    lower.includes("loca.lt") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1")
  );
}

function shouldUseDerivedHost(envApiBaseUrl, derivedHost) {
  if (!derivedHost || !isIpv4(derivedHost)) return false;
  if (shouldPreferAutoLan(envApiBaseUrl)) return true;
  try {
    const envHost = new URL(envApiBaseUrl).hostname;
    if (!isIpv4(envHost)) return false;
    return envHost !== derivedHost && isPrivateIpv4(envHost);
  } catch {
    return false;
  }
}

const derivedLanApiBaseUrl = deriveLanApiBaseUrl();
const derivedLanHost = hostFromScriptURL(NativeModules?.SourceCode?.scriptURL);
const autoLanApiBaseUrl =
  AUTO_LAN_ENABLED && shouldUseDerivedHost(ENV_API_BASE_URL, derivedLanHost)
    ? derivedLanApiBaseUrl
    : "";

export const API_BASE_URL = stripTrailingSlash(
  autoLanApiBaseUrl || ENV_API_BASE_URL || `http://127.0.0.1:${DEFAULT_API_PORT}/api`,
);
export const API_BASE_SOURCE = autoLanApiBaseUrl ? "auto-lan" : ENV_API_BASE_URL ? "env" : "default";
export const GOOGLE_MAPS_API_KEY = ENV_GOOGLE_MAPS_API_KEY;
export const LIVE_PREVIEW_FRAME_INTERVAL_MS = Math.max(
  500,
  Number(process.env.EXPO_PUBLIC_LIVE_PREVIEW_FRAME_INTERVAL_MS || "1000"),
);

export const APP_NAME = "Bin2Bucks";
