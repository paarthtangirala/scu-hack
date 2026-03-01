#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_ENV_FILE="${ROOT_DIR}/mobile/.env"
BACKEND_PORT="${BACKEND_PORT:-5050}"
FORCE_LAN_PROFILE="${FORCE_LAN_PROFILE:-0}"
EXISTING_GOOGLE_MAPS_KEY=""

if [[ -f "${MOBILE_ENV_FILE}" ]]; then
  EXISTING_GOOGLE_MAPS_KEY="$(grep -E '^EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=' "${MOBILE_ENV_FILE}" | head -n 1 | cut -d '=' -f 2- || true)"
fi

if [[ -f "${MOBILE_ENV_FILE}" ]] && [[ "${FORCE_LAN_PROFILE}" != "1" ]]; then
  if grep -qE '^EXPO_PUBLIC_AUTO_LAN=0$' "${MOBILE_ENV_FILE}"; then
    echo "Detected production mobile profile (EXPO_PUBLIC_AUTO_LAN=0). Skipping LAN override."
    echo "Set FORCE_LAN_PROFILE=1 to force LAN profile rewrite."
    exit 0
  fi
fi

detect_lan_ip() {
  local ip=""

  if command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
    if [[ -z "${ip}" ]]; then
      ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
    fi
  fi

  if [[ -z "${ip}" ]] && command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
  fi

  if [[ -z "${ip}" ]] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi

  echo "${ip}"
}

LAN_IP="$(detect_lan_ip)"
if [[ -z "${LAN_IP}" ]]; then
  echo "Unable to detect LAN IP. Set EXPO_PUBLIC_API_BASE_URL manually in mobile/.env." >&2
  exit 1
fi

API_BASE_URL="http://${LAN_IP}:${BACKEND_PORT}/api"
cat > "${MOBILE_ENV_FILE}" <<EOF
EXPO_PUBLIC_API_BASE_URL=${API_BASE_URL}
EXPO_PUBLIC_API_PORT=${BACKEND_PORT}
EXPO_PUBLIC_AUTO_LAN=1
EOF

if [[ -n "${EXISTING_GOOGLE_MAPS_KEY}" ]]; then
  echo "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=${EXISTING_GOOGLE_MAPS_KEY}" >> "${MOBILE_ENV_FILE}"
fi

echo "Wrote ${MOBILE_ENV_FILE}"
echo "API base set to: ${API_BASE_URL}"

if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
  echo "Local backend health check passed on 127.0.0.1:${BACKEND_PORT}"
else
  echo "Warning: backend is not reachable on 127.0.0.1:${BACKEND_PORT}/api/health" >&2
  echo "Start backend first before opening Expo Go." >&2
fi
