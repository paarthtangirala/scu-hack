#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <https://your-api-domain/api>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_ENV_FILE="${ROOT_DIR}/mobile/.env"
API_BASE_URL="${1%/}"
EXISTING_GOOGLE_MAPS_KEY=""

if [[ -f "${MOBILE_ENV_FILE}" ]]; then
  EXISTING_GOOGLE_MAPS_KEY="$(grep -E '^EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=' "${MOBILE_ENV_FILE}" | head -n 1 | cut -d '=' -f 2- || true)"
fi

if [[ ! "${API_BASE_URL}" =~ ^https:// ]]; then
  echo "Production API URL must be HTTPS. Received: ${API_BASE_URL}" >&2
  exit 1
fi

# Normalize to expected backend prefix so mobile routes resolve correctly.
if [[ "${API_BASE_URL}" != */api ]]; then
  API_BASE_URL="${API_BASE_URL}/api"
fi

cat > "${MOBILE_ENV_FILE}" <<EOF
EXPO_PUBLIC_API_BASE_URL=${API_BASE_URL}
EXPO_PUBLIC_API_PORT=5050
EXPO_PUBLIC_AUTO_LAN=0
EOF

if [[ -n "${EXISTING_GOOGLE_MAPS_KEY}" ]]; then
  echo "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=${EXISTING_GOOGLE_MAPS_KEY}" >> "${MOBILE_ENV_FILE}"
fi

echo "Wrote ${MOBILE_ENV_FILE}"
echo "API base set to production URL: ${API_BASE_URL}"
echo "AUTO_LAN disabled for production profile."
