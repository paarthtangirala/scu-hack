#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

"${ROOT_DIR}/scripts/mobile/use-lan-api.sh"

cd "${ROOT_DIR}/mobile"
exec npx expo start --lan -c

