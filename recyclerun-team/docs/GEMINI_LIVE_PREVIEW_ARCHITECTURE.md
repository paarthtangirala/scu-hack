# Gemini Live Preview Architecture

## Scope

This document describes the current live preview implementation on branch `codex/native-compile-check`.
It reflects the current code in:

- [mobile/src/components/live/LiveScanPanel.js](../mobile/src/components/live/LiveScanPanel.js)
- [mobile/src/hooks/useLiveVisionController.js](../mobile/src/hooks/useLiveVisionController.js)
- [mobile/src/services/liveVisionTransport.js](../mobile/src/services/liveVisionTransport.js)
- [backend/routes/live_vision.py](../backend/routes/live_vision.py)
- [backend/services/live_control.py](../backend/services/live_control.py)

## Architecture Summary

The production-shaped path is no longer the original server-polled `CameraView -> /frame` loop.
The current implementation is a hybrid architecture:

1. Mobile development build uses native-capable camera plumbing and a local live vision pipeline.
2. Backend mints a constrained Gemini Live auth token through `POST /api/live-vision/token`.
3. Mobile opens the direct Gemini Live WebSocket using the returned token and server-provided setup payload.
4. Mobile records telemetry through `POST /api/live-vision/telemetry/batch`.
5. Mobile finalizes analytics with `POST /api/live-vision/session/end`.
6. Legacy `session/start`, `session/<id>/frame`, `session/<id>/stop`, and `session/<id>/health` remain available as fallback/demo transport.

## Current Mobile Data Flow

```text
PostScreen
  -> LiveScanPanel
     -> LiveCameraSurface.native (VisionCamera path)
     -> useLiveVisionController
        -> liveVisionNativePipeline.native
           -> local tracking / candidate generation
        -> mobile/src/services/api.js -> POST /api/live-vision/token
           -> LiveTokenService -> Google auth token endpoint
        -> liveVisionTransport
           -> direct Gemini Live WebSocket
        -> liveVisionTelemetry
           -> POST /api/live-vision/telemetry/batch
        -> confirmed suggestion rows
           -> listing payload with capture_mode=live_ai,
              source_session_id,
              estimated_materials,
              estimated_total_lbs,
              estimated_confidence
```

## Backend Token Provisioning Contract

### Public route

- `POST /api/live-vision/token`

Request payload fields currently accepted:

- `model?: string`
- `force_legacy?: boolean`
- `profile_id?: string`
- `device_label?: string`
- `app_version?: string`
- `platform?: string`
- `device_tier?: string`
- `network_type?: string`

Primary success response fields:

- `success: true`
- `provider: "gemini_live"`
- `token: string`
- `token_expires_at: string`
- `new_session_expires_at: string`
- `ws_endpoint: string`
- `model: string`
- `response_modality: "TEXT"`
- `media_resolution: "low"`
- `session_policy: object`
- `transport_version: "native_candidate_stream_v1"`
- `supports_session_resumption: true`
- `candidate_video_policy: object`
- `fallback_order: ["direct_native_live", "tracking_only", "legacy_http_poll", "manual_entry"]`
- `telemetry_session_id: string`
- `source_session_id: string`
- `legacy_fallback_available: true`
- `setup: object`
- `frame_turn_prompt: string`

### Upstream Google token call

The current upstream endpoint is:

- `POST https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=<GEMINI_API_KEY>`

Important implementation detail:

The endpoint currently expects the `AuthToken` fields at the top level of the JSON body, not wrapped in `authToken` or `config`.

Current working request body:

```json
{
  "uses": 1,
  "expireTime": "2026-03-08T22:52:35.504224Z",
  "newSessionExpireTime": "2026-03-08T22:23:35.504530Z"
}
```

Current observed response shape:

```json
{
  "name": "auth_tokens/<opaque-token-id>"
}
```

Because the upstream response currently returns only `name`, `LiveTokenService` preserves the locally computed expiry timestamps and exposes them as:

- `token_expires_at`
- `new_session_expires_at`

This is intentional and should not be “simplified” away unless Google starts returning those fields again.

## Session Setup Payload

`LiveSessionPolicyService.session_setup()` currently returns:

- `model`
- `generationConfig.temperature`
- `generationConfig.maxOutputTokens`
- `generationConfig.responseModalities=["TEXT"]`
- `systemInstruction`
- `sessionResumption`

This payload is returned to the mobile client and used for the direct Gemini Live connection.

## Fallback Ladder

The intended fallback order is:

1. `direct_native_live`
2. `tracking_only`
3. `legacy_http_poll`
4. `manual_entry`

Legacy force mode uses:

- `provider: "legacy_http_poll"`
- `direct_available: false`
- `supports_session_resumption: false`
- `fallback_order: ["legacy_http_poll", "manual_entry"]`

## Telemetry and Persistence

Backend persistence currently records:

- live vision session identity
- provider and transport
- model
- token expiry metadata
- device metadata
- event batches
- session completion counts and fallback mode

Relevant server endpoints:

- `POST /api/live-vision/telemetry/batch`
- `POST /api/live-vision/session/end`

Telemetry batch fields currently include:

- `telemetry_session_id`
- `events[]`
- `summary`

Each event may include:

- `event_id`
- `event_type`
- `ts_ms`
- `latency_ms`
- `candidate_id`
- `track_id`
- `reason`
- `details`
- `platform`
- `device_tier`
- `network_type`
- `device_model`
- `os_version`
- `transport_mode`
- `preview_fps_p50`
- `preview_fps_p95`
- `detector_ms_p50`
- `detector_ms_p95`
- `stable_candidate_ms_p50`
- `stable_candidate_ms_p95`
- `gemini_rtt_ms_p50`
- `gemini_rtt_ms_p95`
- `resume_count`
- `fallback_reason`

## Native Runtime Requirements

The current live preview path requires a development build for actual native validation.

Required toolchain state:

- full Xcode installed and selected for `expo run:ios`
- Android SDK, platform-tools, NDK, and CMake installed for `expo run:android`
- `react-native-worklets`
- `react-native-worklets-core`
- `react-native-vision-camera`
- Expo SDK-compatible `expo-dev-client`

Relevant config files:

- [mobile/package.json](../mobile/package.json)
- [mobile/app.json](../mobile/app.json)
- [mobile/babel.config.js](../mobile/babel.config.js)

## Known Current Gaps

These are still open after the token-route fix:

1. Physical iOS validation is blocked until full Xcode is installed on the machine running `expo run:ios`.
2. Physical Android runtime validation still requires a booted emulator or attached device even though the SDK/toolchain is now configured.
3. The direct Gemini Live token route now works, but session resumption and direct transport reliability still need physical-device validation.
4. The local native live pipeline boundary exists, but the true end-to-end smoothness claims still need device matrix benchmarking.
