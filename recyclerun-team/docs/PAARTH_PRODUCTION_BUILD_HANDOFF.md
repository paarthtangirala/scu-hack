# Paarth Production Build Handoff

## Audience

- Owner: `@paarthtangirala`
- Scope: complete the remaining work required to move the current live preview branch from repo-healthy to production-validated across backend, native mobile, and operational readiness.

## Current branch state

Active branch used during validation:

- `codex/native-compile-check`

This branch contains:

1. direct Gemini Live token provisioning route and persistence
2. mobile native live preview scaffolding
3. local Expo module for native live vision pipeline
4. telemetry/session finalization endpoints
5. receipt/dashboard/demo work already layered into the same branch

## What has already been done

### Backend

- Added direct token provisioning service in [backend/services/live_control.py](../backend/services/live_control.py)
- Added route surface in [backend/routes/live_vision.py](../backend/routes/live_vision.py)
- Added validation for token, telemetry, and session end in [backend/services/validation.py](../backend/services/validation.py)
- Added unit and contract coverage in:
  - [backend/tests/test_live_control_service.py](../backend/tests/test_live_control_service.py)
  - [backend/tests/test_api_contracts.py](../backend/tests/test_api_contracts.py)

### Critical fix completed

The direct token endpoint was failing against Google because the auth token request body was serialized incorrectly.

Previous broken behavior:

- backend posted a wrapped payload:
  - `{"authToken": {...}}`
- Google returned `400 INVALID_ARGUMENT`
- route returned `502 live_token_request_failed`

Current fixed behavior:

- backend posts top-level token fields:

```json
{
  "uses": 1,
  "expireTime": "<iso8601>",
  "newSessionExpireTime": "<iso8601>"
}
```

- endpoint:
  - `POST https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=<GEMINI_API_KEY>`
- observed successful response:

```json
{
  "name": "auth_tokens/<opaque-id>"
}
```

- local route now returns `201` and a usable direct live token

### Mobile

- Added native/dev-build plumbing in:
  - [mobile/package.json](../mobile/package.json)
  - [mobile/babel.config.js](../mobile/babel.config.js)
  - [mobile/app.json](../mobile/app.json)
- Added live scanner/controller split:
  - [mobile/src/components/live/LiveScanPanel.js](../mobile/src/components/live/LiveScanPanel.js)
  - [mobile/src/components/live/LiveCameraSurface.native.js](../mobile/src/components/live/LiveCameraSurface.native.js)
  - [mobile/src/hooks/useLiveVisionController.js](../mobile/src/hooks/useLiveVisionController.js)
  - [mobile/src/services/liveVisionTransport.js](../mobile/src/services/liveVisionTransport.js)
  - [mobile/src/services/liveVisionTelemetry.js](../mobile/src/services/liveVisionTelemetry.js)
  - [mobile/src/services/liveVisionTrackManager.js](../mobile/src/services/liveVisionTrackManager.js)
- Added local Expo module:
  - [mobile/modules/live-vision-pipeline](../mobile/modules/live-vision-pipeline)

### Environment/toolchain setup already validated

- `expo-doctor` passes
- mobile live-vision unit tests pass
- backend live-control and contract tests pass
- `expo prebuild --clean` passes
- CocoaPods install passes after disk recovery
- Android SDK/JDK/NDK/CMake environment was installed and Gradle progressed into real native compilation

## What is still blocked

### 1. iOS runtime validation

Hard blocker:

- full Xcode is not installed/selected on the validation machine

Observed failure:

- `expo run:ios` exits because `xcodebuild` is unavailable under full Xcode developer path

Required action:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Then rerun:

```bash
cd mobile
npm run ios:dev-client
npm run start:dev-client
```

### 2. Android runtime launch validation

Environment is now largely healthy, but physical/emulator execution still needs completion.

Remaining requirement:

- boot an emulator or attach a USB-debug Android device

Then rerun:

```bash
cd mobile
npm run android:dev-client
npm run start:dev-client
```

### 3. Direct Live physical-device validation

The backend token route is fixed, but true production confidence still requires device-matrix validation of:

- WebSocket open
- setup complete
- candidate pipeline latency
- reconnect/session resumption
- fallback ladder correctness
- no-preview-freeze behavior

Validation checklist:

- [docs/LIVE_VISION_DEVICE_VALIDATION.md](LIVE_VISION_DEVICE_VALIDATION.md)

## Required next steps for production build

### A. Mobile runtime validation

1. iPhone dev build:
   - install/launch app
   - open `Post Listing`
   - open `LiveScanPanel`
   - confirm camera permission
   - confirm direct token call succeeds
   - confirm direct WebSocket path opens
   - confirm stable candidate review sheet works
2. Android dev build:
   - same test matrix
3. Capture metrics:
   - `preview_fps_p50`
   - `preview_fps_p95`
   - `detector_ms_p50`
   - `detector_ms_p95`
   - `stable_candidate_ms_p50`
   - `stable_candidate_ms_p95`
   - `gemini_rtt_ms_p50`
   - `gemini_rtt_ms_p95`

### B. Backend hardening

1. Validate token refresh and resumption behavior against longer sessions.
2. Add an explicit integration test that mocks the exact working upstream token shape:
   - request body must be top-level `uses`, `expireTime`, `newSessionExpireTime`
   - response may contain only `name`
3. Add defensive logging fields around token provisioning:
   - upstream status code
   - endpoint path
   - timeout
   - truncated response body
4. Add one smoke test path that exercises:
   - `/api/live-vision/token`
   - `/api/live-vision/telemetry/batch`
   - `/api/live-vision/session/end`

### C. Mobile fallback validation

Validate all fallback transitions:

1. `direct_native_live -> tracking_only`
2. `tracking_only -> legacy_http_poll`
3. `legacy_http_poll -> manual_entry`

Required checks:

- no unhandled redboxes
- no duplicate candidate spam
- no preview freeze when review sheet is visible
- no stale response overwrites after `Skip`

### D. Production readiness gaps beyond native compile

These are not toolchain issues. They are actual productization items:

1. object/media upload storage should move from SQLite demo storage to cloud object storage
2. real auth / org tenancy still needs production implementation
3. live-session telemetry should feed dashboard/ops views
4. device-tier-specific fallback thresholds still need tuning
5. CI does not yet run physical native validation

## Exact commands to use

### Backend

```bash
cd /Users/sohambhowmick/Projects/scu-hack/recyclerun-team
source .venv/bin/activate
python -m flask --app backend.app:create_app run --host 0.0.0.0 --port 5050
```

Smoke checks:

```bash
curl -s http://127.0.0.1:5050/api/health
curl -s -X POST http://127.0.0.1:5050/api/live-vision/token \
  -H 'Content-Type: application/json' \
  -d '{"platform":"ios","device_tier":"mid","network_type":"wifi"}'
```

### Mobile

```bash
cd /Users/sohambhowmick/Projects/scu-hack/recyclerun-team
FORCE_LAN_PROFILE=1 ./scripts/mobile/use-lan-api.sh
cd mobile
npx expo-doctor
npm run prebuild
npm run start:dev-client
```

Then on each platform:

```bash
cd /Users/sohambhowmick/Projects/scu-hack/recyclerun-team/mobile
npm run ios:dev-client
npm run android:dev-client
```

## Acceptance gates before merge toward integration

1. `/api/live-vision/token` returns `201` locally and against the intended hosted environment.
2. iOS dev build installs and opens scanner successfully.
3. Android dev build installs and opens scanner successfully.
4. Direct live preview works on at least:
   - one recent iPhone
   - one mid-tier Android
5. Fallback ladder is validated manually and telemetry captured.
6. No uncaught exception reaches the UI during live scan.

## Recommended GitHub work breakdown for Paarth

1. `Native validation`
   - finish iOS and Android physical validation matrix
2. `Backend contract hardening`
   - add smoke/integration coverage around token + telemetry + session end
3. `Production checklist closure`
   - confirm toolchain/runbook accuracy
   - record acceptance evidence in docs
