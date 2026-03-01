# RecycleRun Service Interface Contracts

Implementation-first service contracts used between backend and frontend.

## Scope And Source-Of-Truth Files

Backend producers/routes audited:

- `backend/services/vision.py`
- `backend/routes/classify.py`
- `backend/services/gemini_live.py`
- `backend/routes/live_vision.py`
- `backend/services/optimizer.py`
- `backend/routes/optimize.py`
- `backend/services/voice.py`
- `backend/models/material.py`
- `backend/models/route.py`

Frontend consumers audited:

- `frontend/src/services/api.js`
- `mobile/src/services/api.js`
- `mobile/src/screens/PostScreen.js`
- `frontend/src/hooks/useRoute.js`
- `frontend/src/components/household/PhotoUpload.jsx`
- `frontend/src/components/driver/RouteBanner.jsx`
- `frontend/src/components/shared/NotificationOverlay.jsx`

## Schema Conventions

- Required field: must be present in every payload instance for that schema.
- Optional field: omitted unless its production condition is met.
- Nullability policy: current backend omits optional fields; it does not emit `null` for these contracts.
- Type notation:
  - `boolean`: JSON boolean
  - `integer`: JSON whole number
  - `number`: JSON number (may serialize as integer or floating-point token)
  - `string`: JSON string
  - `array<T>`: JSON array of `T`
  - `object`: JSON object
- Error envelope source: `backend/utils/http.py#error`.

## Vision Classify Contract (`POST /api/classify`)

Producer path:

- `backend/routes/classify.py::classify`
- `backend/services/vision.py::VisionClassifier.classify`

### Success Response (`HTTP 200`)

Top-level object fields:

| Field | Type | Required | Constraints | Produced by |
|---|---|---|---|---|
| `success` | boolean | Yes | Always `true` on success path | `VisionClassifier._parse`, `VisionClassifier._demo_result` |
| `source` | string | Yes | Enum: `amd` \| `claude` \| `demo` | `VisionClassifier.classify` |
| `materials` | array<object> | Yes | Item schema below | `VisionClassifier._parse`, `_demo_result` |
| `total_value` | number | Yes | Sum of `materials[*].value`, rounded to 2 decimals | `VisionClassifier._parse`, `_demo_result` |
| `total_lbs` | number | Yes | Sum of `materials[*].lbs`, rounded to 1 decimal | `VisionClassifier._parse`, `_demo_result` |
| `notes` | string | Yes | Defaults to empty string when absent | `VisionClassifier._parse`, `_demo_result` |

`materials[]` item fields:

| Field | Type | Required | Constraints | Produced by |
|---|---|---|---|---|
| `type` | string | Yes | Must be in `MATERIAL_RATES` keys | `Material.to_dict` via `_parse` / static demo object |
| `label` | string | Yes | Human label from `MATERIAL_RATES` | `Material.to_dict` / static demo object |
| `emoji` | string | Yes | Emoji from `MATERIAL_RATES` (or explicit demo value) | `Material.to_dict` / static demo object |
| `lbs` | number | Yes | Rounded to 1 decimal in parse path | `_parse` (`Material`) / static demo object |
| `rate` | number | Yes | Material payout rate | `Material.to_dict` / static demo object |
| `value` | number | Yes | Material estimated value | `Material.__post_init__` / static demo object |
| `confidence` | number | Yes | Parse default `0.8` if model omits it | `_parse` / static demo object |

JSON-schema-like snippet (success):

```json
{
  "type": "object",
  "required": ["success", "source", "materials", "total_value", "total_lbs", "notes"],
  "properties": {
    "success": { "const": true },
    "source": { "enum": ["amd", "claude", "demo"] },
    "materials": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "label", "emoji", "lbs", "rate", "value", "confidence"],
        "properties": {
          "type": { "type": "string" },
          "label": { "type": "string" },
          "emoji": { "type": "string" },
          "lbs": { "type": "number" },
          "rate": { "type": "number" },
          "value": { "type": "number" },
          "confidence": { "type": "number" }
        }
      }
    },
    "total_value": { "type": "number" },
    "total_lbs": { "type": "number" },
    "notes": { "type": "string" }
  }
}
```

### Error Envelope (`HTTP 422`, `HTTP 502`)

Error object fields:

| Field | Type | Required | Constraints | Produced by |
|---|---|---|---|---|
| `success` | boolean | Yes | Always `false` on route error path | `backend.utils.http.error` |
| `error` | string | Yes | `validation_error` \| `classifier_failed` | `routes/classify.py` |
| `message` | string | Yes | Human-readable route message | `routes/classify.py` |
| `errors` | array<object> | Optional | Present only for validation errors | `validate_classify_payload` |

`errors[]` item fields:

| Field | Type | Required | Constraints | Produced by |
|---|---|---|---|---|
| `field` | string | Yes | JSON field path | `validation.py` |
| `message` | string | Yes | Validation reason | `validation.py` |

JSON-schema-like snippet (error):

```json
{
  "type": "object",
  "required": ["success", "error", "message"],
  "properties": {
    "success": { "const": false },
    "error": { "enum": ["validation_error", "classifier_failed"] },
    "message": { "type": "string" },
    "errors": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["field", "message"],
        "properties": {
          "field": { "type": "string" },
          "message": { "type": "string" }
        }
      }
    }
  }
}
```

## Live Vision Session Contract (`/api/live-vision/*`)

Producer path:

- `backend/routes/live_vision.py`
- `backend/services/gemini_live.py`

### Endpoint: `POST /api/live-vision/session/start`

Request body:

- Optional object.
- Optional fields:
  - `model`: string
  - `force_demo`: boolean

Success response (`HTTP 201`):

| Field | Type | Required | Constraints |
|---|---|---|---|
| `success` | boolean | Yes | Always `true` |
| `session_id` | string | Yes | Server-generated opaque id |
| `model` | string | Yes | Effective Gemini model |
| `state` | string | Yes | `ready` |
| `source_mode` | string | Yes | `gemini_live` \| `gemini_live_demo` |
| `timeout_seconds` | number | Yes | `>= 1` |
| `session_ttl_seconds` | integer | Yes | `>= 30` |
| `reason` | string | Yes | `ready` \| `forced_demo_mode` \| `gemini_api_key_missing` |

### Endpoint: `POST /api/live-vision/session/<session_id>/frame`

Request body:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `frame_base64` | string | Yes | Valid base64, max bytes enforced by `GEMINI_LIVE_MAX_FRAME_BYTES` |
| `mime_type` | string | Optional | `image/jpeg` \| `image/png` (default `image/jpeg`) |
| `frame_seq` | integer | Optional | `>= 0` client sequence hint |

Success response (`HTTP 200`):

| Field | Type | Required | Constraints |
|---|---|---|---|
| `success` | boolean | Yes | Always `true` |
| `source` | string | Yes | `gemini_live` \| `gemini_live_demo` |
| `session_id` | string | Yes | Must match active session |
| `frame_seq` | integer | Yes | Monotonic per session |
| `materials` | array<object> | Yes | Material schema below |
| `total_lbs` | number | Yes | Rounded to 1 decimal |
| `total_value` | number | Yes | Rounded to 2 decimals |
| `notes` | string | Yes | Parse notes or fallback reason text |
| `stable` | boolean | Yes | Rolling prediction stability over recent frames |
| `latency_ms` | integer | Yes | End-to-end processing latency |

`materials[]` item fields:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `type` | string | Yes | Must be one of `MATERIAL_RATES` keys |
| `label` | string | Yes | Material label |
| `emoji` | string | Yes | Material emoji |
| `lbs` | number | Yes | Clamped by `GEMINI_LIVE_MIN_LBS`/`GEMINI_LIVE_MAX_LBS`, rounded to 1 decimal |
| `rate` | number | Yes | Material payout rate |
| `value` | number | Yes | `lbs * rate`, rounded to 2 decimals |
| `confidence` | number | Yes | Clamped to `[0,1]`, default `0.8` |
| `raw_confidence` | number | Optional | Present when upstream provides it |
| `provenance` | string | Optional | Present when upstream provides it |

JSON-schema-like snippet (frame success):

```json
{
  "type": "object",
  "required": [
    "success",
    "source",
    "session_id",
    "frame_seq",
    "materials",
    "total_lbs",
    "total_value",
    "notes",
    "stable",
    "latency_ms"
  ],
  "properties": {
    "success": { "const": true },
    "source": { "enum": ["gemini_live", "gemini_live_demo"] },
    "session_id": { "type": "string" },
    "frame_seq": { "type": "integer", "minimum": 1 },
    "materials": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "label", "emoji", "lbs", "rate", "value", "confidence"],
        "properties": {
          "type": { "type": "string" },
          "label": { "type": "string" },
          "emoji": { "type": "string" },
          "lbs": { "type": "number" },
          "rate": { "type": "number" },
          "value": { "type": "number" },
          "confidence": { "type": "number" },
          "raw_confidence": { "type": "number" },
          "provenance": { "type": "string" }
        }
      }
    },
    "total_lbs": { "type": "number" },
    "total_value": { "type": "number" },
    "notes": { "type": "string" },
    "stable": { "type": "boolean" },
    "latency_ms": { "type": "integer", "minimum": 0 }
  }
}
```

### Endpoint: `POST /api/live-vision/session/<session_id>/stop`

Success response (`HTTP 200`):

- `{ success:true, session_id:string, state:"closed", already_closed:boolean }`
- Idempotent: repeated stop calls remain `success:true` with `already_closed:true`.

### Endpoint: `GET /api/live-vision/session/<session_id>/health`

Success response (`HTTP 200`) includes:

- `success`, `session_id`, `state`, `model`, `source_mode`, `frame_seq`, `seconds_since_activity`, `session_age_seconds`, `session_ttl_seconds`.

### Error Envelope (all live endpoints)

Structured failure envelope is always:

- `success:false`
- `error` / `code`
- `message`
- optional `errors` + `details`

Common machine-readable `code` values:

- `validation_error`
- `live_session_not_found`
- `live_session_expired`
- `live_frame_rate_limited`
- `live_vision_start_failed`
- `live_vision_frame_failed`
- `live_vision_stop_failed`
- `live_vision_health_failed`

### Live Fallback Semantics

| Condition | Result |
|---|---|
| `GEMINI_API_KEY` missing OR `force_demo=true` at session start | Session starts in demo mode (`source_mode=gemini_live_demo`) |
| Upstream timeout / request error / non-200 / parse failure | `frame` returns success payload with `source=gemini_live_demo`, empty `materials`, deterministic fallback notes |
| Valid model output parse | `frame` returns `source=gemini_live` with normalized material rows |

## Optimize Route Summary Contract (`POST /api/optimize-route`)

Producer path:

- `backend/routes/optimize.py::optimize_route`
- `backend/services/optimizer.py::RouteOptimizer.optimize`
- `backend/services/optimizer.py::RouteOptimizer._build_summary`

Top-level route response shape:

- `stops`: `array<object>` (from `RouteStop.to_dict()`)
- `summary`: `object` (strict schema below)

### `summary` Object (Required Fields)

| Field | Type | Required | Constraints | Produced by |
|---|---|---|---|---|
| `total_stops` | integer | Yes | `>= 0` | `_build_summary` |
| `total_value` | number | Yes | Rounded to 2 decimals | `_build_summary` |
| `total_lbs` | number | Yes | Rounded to 1 decimal | `_build_summary` |
| `total_miles` | number | Yes | Rounded to 1 decimal | `_build_summary` |
| `truck_fill_pct` | number | Yes | Rounded to 1 decimal | `_build_summary` |
| `estimated_minutes` | integer | Yes | Rounded whole minutes | `_build_summary` |
| `lbs_per_hour` | number | Yes | Rounded to 1 decimal | `_build_summary` |
| `objective` | string | Yes | Normalized enum: `value` \| `lbs` | `optimize` + `_normalize_objective` |
| `solver` | string | Yes | Enum: `none` \| `ortools` \| `greedy` \| `greedy_fallback` | `optimize` |
| `solve_time_ms` | integer | Yes | `>= 0` | `optimize` |

JSON-schema-like snippet (`summary`):

```json
{
  "type": "object",
  "required": [
    "total_stops",
    "total_value",
    "total_lbs",
    "total_miles",
    "truck_fill_pct",
    "estimated_minutes",
    "lbs_per_hour",
    "objective",
    "solver",
    "solve_time_ms"
  ],
  "properties": {
    "total_stops": { "type": "integer", "minimum": 0 },
    "total_value": { "type": "number" },
    "total_lbs": { "type": "number" },
    "total_miles": { "type": "number" },
    "truck_fill_pct": { "type": "number" },
    "estimated_minutes": { "type": "integer", "minimum": 0 },
    "lbs_per_hour": { "type": "number" },
    "objective": { "enum": ["value", "lbs"] },
    "solver": { "enum": ["none", "ortools", "greedy", "greedy_fallback"] },
    "solve_time_ms": { "type": "integer", "minimum": 0 }
  }
}
```

## Voice Notify Result Contract

Producer path:

- `backend/services/voice.py::VoiceNotifier.notify`
- `backend/services/voice.py::VoiceNotifier._make_call`
- `backend/routes/optimize.py::_notify_with_retry` (augments success payloads with `retry_attempt` only on retry success)

### `VoiceNotifier.notify` Result Union

Base required fields for every notifier result:

- `success`: boolean
- `mode`: `live` | `demo` | `failed`

| Variant | Shape | Required fields | Production condition |
|---|---|---|---|
| Live call | `{success:true, mode:"live", call_sid:string}` | `success`, `mode`, `call_sid` | Twilio credentials present, demo mode not forced, call succeeds |
| Demo | `{success:true, mode:"demo", message:string, reason:string}` | `success`, `mode`, `message`, `reason` | Twilio not configured OR demo mode forced |
| Failed | `{success:false, mode:"failed", error:string, reason:string}` | `success`, `mode`, `error`, `reason` | Twilio configured and call attempt fails or times out; unexpected notifier exceptions are converted to failed |

Route-layer retry augmentation:

- `_notify_with_retry` attempts notification up to `attempts` times (current caller uses `attempts=2`).
- On success at attempt `> 1`, response is augmented with `retry_attempt: <integer>`.
- On first-attempt success, `retry_attempt` is omitted.
- If all attempts fail, last failure result is returned unchanged.

JSON-schema-like snippet (notify union + route augmentation):

```json
{
  "oneOf": [
    {
      "type": "object",
      "required": ["success", "mode", "call_sid"],
      "properties": {
        "success": { "const": true },
        "mode": { "const": "live" },
        "call_sid": { "type": "string" },
        "retry_attempt": { "type": "integer", "minimum": 2 }
      }
    },
    {
      "type": "object",
      "required": ["success", "mode", "message", "reason"],
      "properties": {
        "success": { "const": true },
        "mode": { "const": "demo" },
        "message": { "type": "string" },
        "reason": { "enum": ["twilio_not_configured", "forced_demo_mode"] },
        "retry_attempt": { "type": "integer", "minimum": 2 }
      }
    },
    {
      "type": "object",
      "required": ["success", "mode", "error", "reason"],
      "properties": {
        "success": { "const": false },
        "mode": { "const": "failed" },
        "error": { "type": "string" },
        "reason": { "enum": ["twilio_timeout", "twilio_exception", "notify_exception", "unknown_failure"] }
      }
    }
  ]
}
```

### `/api/accept-route` Notification Entry Contract (Current)

Producer path:

- `backend/routes/optimize.py::accept_route`

Top-level accept-route response includes:

- `success`, `request_id`, `driver_name`, `requested_stops`, `claimed_count`, `skipped_count`, `notifications_sent`, `notifications`

`notifications[]` entry fields:

| Field | Type | Required | Constraints | Production condition |
|---|---|---|---|---|
| `listing_id` | string | Yes | Non-empty listing identifier | Always |
| `notification` | object | Yes | Union below | Always |
| `household` | string | Optional | Household display name | Present when a listing record exists (`claimed`, `already_claimed`, `already_completed`) |
| `phone` | string | Optional | Household phone number | Present when a listing record exists (`claimed`, `already_claimed`, `already_completed`) |

`notification` union includes:

- Notify result union above (`live` / `demo` / `failed`)
- Skip variant: `{success:false, mode:"skipped", reason:"duplicate_stop"|"not_found"|"already_claimed"|"already_completed"}`

Important current behavior:

- `eta_minutes` is not included in each `notifications[]` entry.

JSON-schema-like snippet (`notifications[]` entry, current):

```json
{
  "type": "object",
  "required": ["listing_id", "notification"],
  "properties": {
    "listing_id": { "type": "string" },
    "household": { "type": "string" },
    "phone": { "type": "string" },
    "notification": {
      "oneOf": [
        { "type": "object", "required": ["success", "mode", "call_sid"], "properties": { "success": { "const": true }, "mode": { "const": "live" }, "call_sid": { "type": "string" }, "retry_attempt": { "type": "integer", "minimum": 2 } } },
        { "type": "object", "required": ["success", "mode", "message", "reason"], "properties": { "success": { "const": true }, "mode": { "const": "demo" }, "message": { "type": "string" }, "reason": { "enum": ["twilio_not_configured", "forced_demo_mode"] }, "retry_attempt": { "type": "integer", "minimum": 2 } } },
        { "type": "object", "required": ["success", "mode", "error", "reason"], "properties": { "success": { "const": false }, "mode": { "const": "failed" }, "error": { "type": "string" }, "reason": { "enum": ["twilio_timeout", "twilio_exception", "notify_exception", "unknown_failure"] } } },
        { "type": "object", "required": ["success", "mode", "reason"], "properties": { "success": { "const": false }, "mode": { "const": "skipped" }, "reason": { "enum": ["duplicate_stop", "not_found", "already_claimed", "already_completed"] } } }
      ]
    }
  }
}
```

## Fallback Semantics And State Tables

### Vision Source Fallback Semantics

| Step | Condition | Action | Output source |
|---|---|---|---|
| 1 | `AMD_API_KEY` exists and AMD parse succeeds | Return parsed AMD result | `amd` |
| 2 | Step 1 fails AND `ENABLE_CLAUDE_FALLBACK` is truthy (`1/true/yes`) AND Claude path succeeds (`ANTHROPIC_API_KEY` + parse success) | Return parsed Claude result | `claude` |
| 3 | Any prior step unavailable/failed | Return static demo payload | `demo` |

Route-level error semantics for `/api/classify`:

- Validation failure: `HTTP 422` error envelope (`validation_error`)
- Classifier failure with falsy result: `HTTP 502` error envelope (`classifier_failed`)

### Notifier Mode Semantics And Retry

| Layer | Condition | Result mode | Shape |
|---|---|---|---|
| `VoiceNotifier.notify` | `VOICE_FORCE_DEMO` truthy (`1/true/yes/on`) | `demo` | `{success:true, mode:"demo", message:string, reason:"forced_demo_mode"}` |
| `VoiceNotifier._make_call` | Missing one or more of `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | `demo` | `{success:true, mode:"demo", message:string, reason:"twilio_not_configured"}` |
| `VoiceNotifier._make_call` | Twilio call succeeds | `live` | `{success:true, mode:"live", call_sid:string}` |
| `VoiceNotifier._make_call` | Twilio call fails with timeout | `failed` | `{success:false, mode:"failed", error:string, reason:"twilio_timeout"}` |
| `VoiceNotifier._make_call` | Twilio call fails without timeout | `failed` | `{success:false, mode:"failed", error:string, reason:"twilio_exception"}` |
| `VoiceNotifier.notify` | Unexpected internal notifier exception | `failed` | `{success:false, mode:"failed", error:string, reason:"notify_exception"}` |
| `routes/optimize._notify_with_retry` | Success on retry attempt > 1 | same mode as success result | Adds `retry_attempt` |

Timeout/error semantics:

- `VOICE_NOTIFY_TIMEOUT_SECONDS` controls Twilio HTTP timeout; default `20.0` seconds.
- Invalid timeout config falls back to default and logs `reason:"invalid_timeout_config"`.
- Notifier logs are structured with `event`, `mode`, `reason`, `service/source`, `timeout_seconds`, redacted phone, and `exception_type` on failures.
- Raw full phone number is not logged.

## Frontend Consumer Mapping

| Frontend file | Endpoint/data source | Fields read |
|---|---|---|
| `frontend/src/components/household/PhotoUpload.jsx` | `api.classifyImage` (`/api/classify`) | `source`, `materials[].{emoji,label,type,lbs,confidence,value}`, `total_value`, `total_lbs` |
| `mobile/src/screens/PostScreen.js` | `api.startLiveVisionSession`, `api.sendLiveVisionFrame`, `api.stopLiveVisionSession` | `session_id`, `source_mode`, `source`, `materials[].{type,lbs}`, `notes` |
| `frontend/src/components/driver/RouteBanner.jsx` | `useRoute().route.summary` (`/api/optimize-route`) | `total_stops`, `total_miles`, `estimated_minutes`, `total_lbs`, `lbs_per_hour`, `total_value`, `objective` |
| `frontend/src/components/shared/NotificationOverlay.jsx` | `useRoute().notifications` (`/api/accept-route` response or local fallback) | `household`, `eta_minutes`, `notification.mode` |
| `frontend/src/hooks/useRoute.js` | `api.optimizeRoute`, `api.acceptRoute` | checks `data?.stops`, stores `data?.notifications`, local fallback injects `eta_minutes` |
| `frontend/src/services/api.js` | API transport | no shape validation; returns raw JSON body |

## Delta Register (Current vs Frontend-Safe Target)

| ID | Priority | Delta | Evidence |
|---|---|---|---|
| D-001 | P0 | `/api/accept-route` `notifications[]` entries omit `eta_minutes`, but `NotificationOverlay` renders `n.eta_minutes`. UI displays `undefined` ETA for backend responses. | `backend/routes/optimize.py::accept_route`, `frontend/src/components/shared/NotificationOverlay.jsx` |
| D-002 | P1 | `/api/accept-route` notification entries are heterogeneous for `household`/`phone`. `duplicate_stop` and `not_found` skips omit both fields; claimed/already-claimed/completed include them. | `backend/routes/optimize.py::accept_route` |
| D-003 | P1 | **Schema delta in PH4-SOHAM-01**: `mode:"demo"` is now standardized to always include `message` + `reason`; `mode:"failed"` now includes required `reason`. Migration: typed clients can remove old demo-no-message branch and must accept `reason` on failed/demo. | `backend/services/voice.py::notify`, `backend/services/voice.py::_make_call` |
| D-004 | P2 | `/api/optimize-route` success payload does not include `success:true`, while many other routes use explicit success/error envelopes. | `backend/routes/optimize.py::optimize_route`, `backend/utils/http.py` |
| D-005 | P2 | Several summary fields are documented as numeric values but may serialize as integer tokens in zero-value cases (Python `round(sum(...), n)` behavior). | `backend/services/optimizer.py::_build_summary` |
| D-006 | P1 | New live fallback source `gemini_live_demo` intentionally returns empty `materials` to avoid unsafe autofill when upstream parsing/network fails. Mobile UI must permit manual entry and lock semantics in this mode. | `backend/services/gemini_live.py::classify_frame`, `mobile/src/screens/PostScreen.js` |

## Follow-Up Fixes

- `[P0]` Add `eta_minutes` to each `notifications[]` entry in `/api/accept-route` using stop ETA already present in input payload.
- `[P1]` Normalize `notifications[]` entry envelope so `household` and `phone` are always present (or formally nullable) across all skip/success reasons.
- `[P2]` Decide whether `/api/optimize-route` should adopt the shared `{success:true,...}` envelope for consistency.
- `[P2]` Coerce summary numeric outputs to explicit float serialization where required by strict contract tooling.
- `[P1]` Add optional confidence smoothing/temporal aggregation for `gemini_live` before exposing auto-fill to production traffic.
