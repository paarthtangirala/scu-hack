#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_ENV_FILE="${ROOT_DIR}/mobile/.env"
BACKEND_PORT="${BACKEND_PORT:-5050}"
FORCE_LAN_PROFILE="${FORCE_LAN_PROFILE:-0}"
LAN_IP_OVERRIDE="${LAN_IP_OVERRIDE:-}"

is_private_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^10\. ]] || [[ "$ip" =~ ^192\.168\. ]] || [[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]
}

if [[ -f "${MOBILE_ENV_FILE}" ]] && [[ "${FORCE_LAN_PROFILE}" != "1" ]]; then
  EXISTING_API_BASE_URL="$(
    grep -E '^EXPO_PUBLIC_API_BASE_URL[[:space:]]*=' "${MOBILE_ENV_FILE}" \
      | tail -n1 \
      | cut -d'=' -f2- \
      | tr -d '[:space:]' \
      || true
  )"
  if [[ "${EXISTING_API_BASE_URL}" =~ ^https:// ]]; then
    echo "Detected hosted API profile (${EXISTING_API_BASE_URL}). Skipping LAN override."
    echo "Set FORCE_LAN_PROFILE=1 to force LAN profile rewrite."
    exit 0
  fi
  if grep -qE '^EXPO_PUBLIC_AUTO_LAN[[:space:]]*=[[:space:]]*0[[:space:]]*$' "${MOBILE_ENV_FILE}"; then
    echo "Detected production mobile profile (EXPO_PUBLIC_AUTO_LAN=0). Skipping LAN override."
    echo "Set FORCE_LAN_PROFILE=1 to force LAN profile rewrite."
    exit 0
  fi
fi

detect_lan_ip() {
  local ip=""
  local candidates=()

  if [[ -n "${LAN_IP_OVERRIDE}" ]]; then
    echo "${LAN_IP_OVERRIDE}"
    return
  fi

  if command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
    [[ -n "${ip}" ]] && candidates+=("${ip}")
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
    [[ -n "${ip}" ]] && candidates+=("${ip}")
    ip="$(ipconfig getifaddr en2 2>/dev/null || true)"
    [[ -n "${ip}" ]] && candidates+=("${ip}")
  fi

  if [[ ${#candidates[@]} -eq 0 ]] && command -v ifconfig >/dev/null 2>&1; then
    while IFS= read -r addr; do
      [[ -n "${addr}" ]] && candidates+=("${addr}")
    done < <(ifconfig | awk '/inet /{print $2}' | grep -vE '^127\.' || true)
  fi

  if [[ ${#candidates[@]} -eq 0 ]] && command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
    [[ -n "${ip}" ]] && candidates+=("${ip}")
  fi

  if [[ ${#candidates[@]} -eq 0 ]] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    [[ -n "${ip}" ]] && candidates+=("${ip}")
  fi

  for candidate in "${candidates[@]}"; do
    if [[ "${candidate}" =~ ^192\.168\. ]] || [[ "${candidate}" =~ ^10\. ]]; then
      echo "${candidate}"
      return
    fi
  done
  for candidate in "${candidates[@]}"; do
    if is_private_ipv4 "${candidate}"; then
      echo "${candidate}"
      return
    fi
  done
  echo "${candidates[0]:-}"
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

echo "Wrote ${MOBILE_ENV_FILE}"
echo "API base set to: ${API_BASE_URL}"

if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
  echo "Local backend health check passed on 127.0.0.1:${BACKEND_PORT}"
else
  echo "Warning: backend is not reachable on 127.0.0.1:${BACKEND_PORT}/api/health" >&2
  echo "Start backend first before opening Expo Go." >&2
fi

LIVE_PROBE_RESPONSE="$(curl -sS -m 8 -w '\nHTTP_STATUS:%{http_code}\n' "http://127.0.0.1:${BACKEND_PORT}/api/live-vision/session/probe/health" || true)"
LIVE_PROBE_STATUS="$(printf "%s" "${LIVE_PROBE_RESPONSE}" | awk -F: '/HTTP_STATUS/{print $2}' | tail -n1 | tr -d '[:space:]')"
LIVE_PROBE_BODY="$(printf "%s" "${LIVE_PROBE_RESPONSE}" | sed '/HTTP_STATUS:/d')"
if [[ "${LIVE_PROBE_STATUS}" == "404" ]] && printf "%s" "${LIVE_PROBE_BODY}" | grep -q '"code":"live_session_not_found"'; then
  echo "Live vision route check passed on local backend."
else
  echo "Warning: live vision route probe did not return expected contract on local backend." >&2
  echo "Expected /api/live-vision/session/<id>/health to return code=live_session_not_found." >&2
  echo "Current status=${LIVE_PROBE_STATUS:-unknown}. Backend may be running an older build without live preview routes." >&2
fi

if curl -fsS "http://${LAN_IP}:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
  echo "LAN backend health check passed on ${LAN_IP}:${BACKEND_PORT}"
else
  echo "Warning: backend did not respond on ${LAN_IP}:${BACKEND_PORT} from this host." >&2
fi

if [[ "${LAN_IP}" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]; then
  cat <<WARN >&2
Note: detected LAN IP is ${LAN_IP} (172.16/12 range).
If your phone cannot reach this IP (health timeouts in Expo Go), your Wi-Fi may block client-to-client traffic.
Fallback options:
  1) Run Expo in LAN mode: ./scripts/mobile/start-expo-lan.sh
  2) Point mobile to hosted backend: ./scripts/mobile/use-prod-api.sh https://<your-render-domain>/api
  3) Override LAN IP manually: LAN_IP_OVERRIDE=192.168.x.x ./scripts/mobile/use-lan-api.sh
WARN
fi
