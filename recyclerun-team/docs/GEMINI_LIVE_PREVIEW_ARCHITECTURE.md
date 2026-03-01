# Gemini Live Preview Architecture

## Scope

This document describes the live camera preview classification flow added for `PH5-SOHAM` on branch `codex/soham-gemini-live-preview-vision`.

## Data Flow

```text
Mobile PostScreen (CameraView)
  -> POST /api/live-vision/session/start
     -> GeminiLiveService creates in-memory session
  -> POST /api/live-vision/session/<id>/frame (cadenced)
     -> request guards (base64, mime, byte size)
     -> session guards (TTL, throttle, state)
     -> Gemini upstream request (server-side GEMINI_API_KEY)
     -> parse + normalize materials
     -> response: gemini_live or gemini_live_demo
  -> POST /api/live-vision/session/<id>/stop
     -> idempotent session close
```

## Session Lifecycle

Session states:

- `starting`: internal creation phase.
- `ready`: session accepts frame requests.
- `closing`: stop in progress.
- `closed`: session stopped/expired.
- `failed`: reserved for future explicit fatal session errors.

Session object fields:

- `session_id`
- `created_at`
- `last_activity_at`
- `model`
- `state`
- `rolling_prediction_cache`
- `timeout_seconds`
- `frame_seq`
- `source_mode` (`live` or `demo`)

TTL cleanup policy:

- Service prunes sessions after `GEMINI_LIVE_SESSION_TTL_SECONDS` inactivity/age threshold.

## Frame Cadence And Throttling

- Mobile frame loop runs at `EXPO_PUBLIC_LIVE_PREVIEW_FRAME_INTERVAL_MS` (default `1000` ms).
- Backend enforces per-session minimum interval via `GEMINI_LIVE_MIN_FRAME_INTERVAL_MS`.
- Fast submissions return structured `live_frame_rate_limited` errors (HTTP 429).
- Max accepted frame bytes is enforced via `GEMINI_LIVE_MAX_FRAME_BYTES`.
- Accepted MIME types: `image/jpeg`, `image/png`.

## Manual Override Precedence

Manual edits always win over AI suggestions:

1. User manual add/edit/remove marks that material `type` as locked.
2. Incoming AI suggestions for locked types are dropped.
3. Submit payload excludes AI rows for locked types.
4. User can explicitly reset locks using “Reset AI Suggestions”.

This prevents AI from re-overwriting manually corrected rows.

## Failure Modes And Recovery

### Structured HTTP failures

All live endpoint failures use `backend/utils/http.py#error` envelope:

- `success:false`
- `error` + `code`
- `message`
- `errors/details` when applicable

### Fallback success mode

For upstream timeout/request/parse failures:

- `/frame` still returns `success:true`
- `source:"gemini_live_demo"`
- empty `materials`
- deterministic fallback `notes`

This keeps UI responsive while allowing manual materials entry.

### No-key behavior

When `GEMINI_API_KEY` is not configured:

- session start succeeds in demo mode (`source_mode=gemini_live_demo`)
- frame responses remain deterministic demo fallback payloads.

## Logging And Telemetry

Structured logs include:

- `event`
- `service` (`gemini_live`)
- `session_id`
- `stage` (`start`, `frame`, `parse`, `stop`)
- `latency_ms`
- `timeout`
- `reason`
- `model`
- `state`

No raw image/base64 frame data is logged.
