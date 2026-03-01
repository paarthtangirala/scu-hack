#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
MOBILE_DIR="$ROOT_DIR/mobile"

PORT="${CHECK_PORT:-5051}"
HOSTED_API_BASE="${HOSTED_API_BASE:-}"
MOBILE_EXPORT_DIR="${MOBILE_EXPORT_DIR:-dist-smoke-e2e}"

BACKEND_PID=""

log() {
  printf '[full-check] %s\n' "$1"
}

cleanup() {
  if [[ -n "${BACKEND_PID}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

start_backend() {
  log "Starting backend on 127.0.0.1:${PORT}"
  (
    cd "$ROOT_DIR"
    if [[ -f ".venv/bin/activate" ]]; then
      # shellcheck disable=SC1091
      source ".venv/bin/activate"
    fi
    python -m flask --app backend.app:create_app run --host 127.0.0.1 --port "${PORT}" >/tmp/bin2bucks_backend_check.log 2>&1
  ) &
  BACKEND_PID="$!"

  for _ in {1..60}; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/api/health" || true)"
    if [[ "${code}" == "200" ]]; then
      log "Backend is healthy"
      return 0
    fi
    sleep 0.5
  done

  log "Backend failed to become healthy. See /tmp/bin2bucks_backend_check.log"
  exit 1
}

run_backend_tests() {
  log "Running backend tests"
  (
    cd "$BACKEND_DIR"
    pytest tests -q
  )
}

run_frontend_tests() {
  log "Running frontend tests"
  (
    cd "$FRONTEND_DIR"
    npm test
  )
}

run_frontend_build() {
  log "Running frontend production build"
  (
    cd "$FRONTEND_DIR"
    npm run build
  )
}

run_mobile_export() {
  log "Running mobile web export smoke build"
  (
    cd "$MOBILE_DIR"
    npx expo export --platform web --output-dir "${MOBILE_EXPORT_DIR}"
    if [[ -d "${MOBILE_EXPORT_DIR}" ]]; then
      find "${MOBILE_EXPORT_DIR}" -type f -delete
      find "${MOBILE_EXPORT_DIR}" -type d -empty -delete
    fi
  )
}

run_local_api_flow_checks() {
  local base="http://127.0.0.1:${PORT}/api"
  log "Running local API flow checks against ${base}"

  for ep in health materials listings impact; do
    code="$(curl -sS -o "/tmp/bin2_${ep}.json" -w '%{http_code}' --max-time 5 "${base}/${ep}")"
    [[ "${code}" == "200" ]] || {
      log "Endpoint ${ep} failed with HTTP ${code}"
      exit 1
    }
  done

  create_code="$(curl -sS -o /tmp/bin2_create.json -w '%{http_code}' --max-time 5 \
    -H 'Content-Type: application/json' \
    -d '{"household_name":"E2E QA","address":"900 QA Ave, Santa Clara","phone":"+14085550101","materials":[{"type":"cardboard","lbs":9.5}],"notes":"qa flow"}' \
    "${base}/listings")"
  [[ "${create_code}" == "201" ]] || {
    log "Create listing failed with HTTP ${create_code}"
    exit 1
  }

  optimize_code="$(curl -sS -o /tmp/bin2_opt.json -w '%{http_code}' --max-time 15 \
    -H 'Content-Type: application/json' \
    -d '{"driver_name":"QA Driver","objective":"value","max_minutes":120,"truck_capacity_lbs":1000}' \
    "${base}/optimize-route")"
  [[ "${optimize_code}" == "200" ]] || {
    log "Optimize route failed with HTTP ${optimize_code}"
    exit 1
  }

  python - <<'PY'
import json, sys

opt = json.load(open('/tmp/bin2_opt.json'))
stops = opt.get('stops', [])
if not stops:
    print('optimize returned 0 stops')
    sys.exit(1)

payload = {
    "driver_name": "QA Driver",
    "stops": [{"listing_id": s["listing_id"], "eta_minutes": s.get("eta_minutes", 0)} for s in stops],
}
json.dump(payload, open('/tmp/bin2_accept_payload.json', 'w'))
print(f'optimize: stops={len(stops)} solver={opt.get("summary", {}).get("solver")}')
PY

  accept_code="$(curl -sS -o /tmp/bin2_accept.json -w '%{http_code}' --max-time 30 \
    -H 'Content-Type: application/json' \
    --data-binary @/tmp/bin2_accept_payload.json \
    "${base}/accept-route")"
  [[ "${accept_code}" == "200" ]] || {
    log "Accept route failed with HTTP ${accept_code}"
    exit 1
  }

  python - <<'PY'
import json, sys
resp = json.load(open('/tmp/bin2_accept.json'))
if not resp.get('success'):
    print('accept-route success=false')
    sys.exit(1)
notes = resp.get('notifications') or []
if not notes:
    print('accept-route returned no notifications')
    sys.exit(1)
lid = notes[0].get('listing_id')
if not lid:
    print('notification missing listing_id')
    sys.exit(1)
open('/tmp/bin2_complete_listing_id.txt', 'w').write(lid)
print(f"accept-route: claimed={resp.get('claimed_count', 0)} sent={resp.get('notifications_sent', 0)} failed={resp.get('notifications_failed', 0)}")
PY

  listing_id="$(cat /tmp/bin2_complete_listing_id.txt)"
  complete_code="$(curl -sS -o /tmp/bin2_complete.json -w '%{http_code}' --max-time 10 -X POST "${base}/listings/${listing_id}/complete")"
  [[ "${complete_code}" == "200" ]] || {
    log "Complete listing failed with HTTP ${complete_code}"
    exit 1
  }
}

run_local_health_soak() {
  local base="http://127.0.0.1:${PORT}/api/health"
  local fail=0
  local burst_fail

  log "Running sequential health soak (300 requests)"
  for _ in {1..300}; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "${base}" || true)"
    [[ "${code}" == "200" ]] || fail=$((fail + 1))
  done
  [[ "${fail}" -eq 0 ]] || {
    log "Sequential health failures=${fail}/300"
    exit 1
  }
  log "Sequential health failures=0/300"

  log "Running burst health soak (300 requests, 30-way parallel)"
  burst_fail="$(
    seq 1 300 | xargs -I{} -P30 sh -c "c=\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 '${base}' || true); [ \"\$c\" = '200' ] || echo fail" | wc -l | tr -d ' '
  )"
  [[ "${burst_fail}" -eq 0 ]] || {
    log "Burst health failures=${burst_fail}/300"
    exit 1
  }
  log "Burst health failures=0/300"
}

run_hosted_health_soak_if_configured() {
  if [[ -z "${HOSTED_API_BASE}" ]]; then
    log "Skipping hosted API checks (HOSTED_API_BASE not set)"
    return 0
  fi

  local health_url="${HOSTED_API_BASE%/}/health"
  local fail=0

  log "Running hosted health checks against ${health_url}"
  for _ in {1..100}; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${health_url}" || true)"
    [[ "${code}" == "200" ]] || fail=$((fail + 1))
  done
  [[ "${fail}" -eq 0 ]] || {
    log "Hosted health failures=${fail}/100"
    exit 1
  }
  log "Hosted health failures=0/100"
}

main() {
  log "Root: ${ROOT_DIR}"
  run_backend_tests
  run_frontend_tests
  run_frontend_build
  run_mobile_export
  start_backend
  run_local_api_flow_checks
  run_local_health_soak
  run_hosted_health_soak_if_configured
  log "PASS: full system reliability check completed"
}

main "$@"
