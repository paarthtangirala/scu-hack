# Live Vision Device Validation

## Goal
- Validate the native `VisionCamera + ML Kit + Gemini Live` path on physical iOS and Android dev builds.
- Confirm that fallback modes remain structured when direct live transport or native tracking degrades.

## Required devices
- 1 recent iPhone running a development build
- 1 mid-tier Android phone running a development build
- 1 lower-tier Android phone if available

## Build and run
- `cd mobile`
- `npm install`
- `npx expo-doctor`
- `npm run prebuild`
- `npm run ios:dev-client`
- `npm run android:dev-client`
- `npm run start:dev-client`

## Prerequisites
- `GEMINI_API_KEY` must be present in repo-root `.env` for direct token provisioning.
- Mobile LAN profile should point at the local backend:
  - `FORCE_LAN_PROFILE=1 ./scripts/mobile/use-lan-api.sh`
- iOS requires full Xcode selected via:
  - `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
- Android requires:
  - `JAVA_HOME` on JDK 17
  - `ANDROID_HOME` / `ANDROID_SDK_ROOT`
  - `adb` available on `PATH`
  - emulator booted or USB-debug device attached

## Backend smoke checks before device runs
- `curl -s http://127.0.0.1:5050/api/health`
- `curl -s -X POST http://127.0.0.1:5050/api/live-vision/token -H 'Content-Type: application/json' -d '{"platform":"android","device_tier":"mid","network_type":"wifi"}'`

Expected:
- `/api/health` returns `status: ok`
- `/api/live-vision/token` returns HTTP `201`
- response includes:
  - `provider: "gemini_live"`
  - `token` beginning with `auth_tokens/`
  - `transport_version: "native_candidate_stream_v1"`
  - `supports_session_resumption: true`

## Test matrix
- Cold start -> grant camera permission -> open `Post Listing` -> `Open Live Scanner`
- Start live scan and confirm:
  - socket opens
  - setup completes
  - overlay boxes appear
  - stable candidate review sheet opens
- Repeat for:
  - single large object
  - two-object scene
  - cluttered mixed-material scene
  - reflective object
  - low-light scene
  - object entering/exiting frame quickly
  - background/foreground mid-session
  - network interruption and reconnect
  - forced legacy fallback
  - manual entry after live stop

## Pass criteria
- Preview remains visually smooth while scan is active
- Stable candidate appears without freezing preview
- `Add`, `Edit`, and `Skip` all suppress the current track and advance correctly
- No duplicate candidate spam for the same stable object
- Reconnect or fallback leaves the session usable
- No uncaught exception reaches the UI

## Metrics to record
- Device model
- OS version
- Network type
- `preview_fps_p50`
- `preview_fps_p95`
- `detector_ms_p50`
- `detector_ms_p95`
- `stable_candidate_ms_p50`
- `stable_candidate_ms_p95`
- `gemini_rtt_ms_p50`
- `gemini_rtt_ms_p95`
- resume count
- fallback reason

## Expected fallback order
- `direct_native_live`
- `tracking_only`
- `legacy_http_poll`
- `manual_entry`
