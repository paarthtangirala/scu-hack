# RecycleRun Service Interface Contracts

Implementation-first service contracts used between backend and frontend.

## Scope And Source-Of-Truth Files

Backend producers/routes audited:

- `backend/services/vision.py`
- `backend/routes/classify.py`
- `backend/services/optimizer.py`
- `backend/routes/optimize.py`
- `backend/services/voice.py`
- `backend/models/material.py`
- `backend/models/route.py`

Frontend consumers audited:

- `frontend/src/services/api.js`
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

| Variant | Shape | Required fields | Production condition |
|---|---|---|---|
| Live call | `{success:true, mode:"live", call_sid:string}` | `success`, `mode`, `call_sid` | Audio generated and Twilio call succeeds |
| Demo A | `{success:true, mode:"demo", message:string}` | `success`, `mode`, `message` | Audio unavailable/fails before call attempt |
| Demo B | `{success:true, mode:"demo"}` | `success`, `mode` | Audio exists but Twilio credentials missing in `_make_call` |
| Failed | `{success:false, mode:"failed", error:string}` | `success`, `mode`, `error` | Twilio call path raises exception |

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
      "required": ["success", "mode", "message"],
      "properties": {
        "success": { "const": true },
        "mode": { "const": "demo" },
        "message": { "type": "string" },
        "retry_attempt": { "type": "integer", "minimum": 2 }
      }
    },
    {
      "type": "object",
      "required": ["success", "mode"],
      "properties": {
        "success": { "const": true },
        "mode": { "const": "demo" },
        "retry_attempt": { "type": "integer", "minimum": 2 }
      }
    },
    {
      "type": "object",
      "required": ["success", "mode", "error"],
      "properties": {
        "success": { "const": false },
        "mode": { "const": "failed" },
        "error": { "type": "string" }
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
        { "type": "object", "required": ["success", "mode", "message"], "properties": { "success": { "const": true }, "mode": { "const": "demo" }, "message": { "type": "string" }, "retry_attempt": { "type": "integer", "minimum": 2 } } },
        { "type": "object", "required": ["success", "mode"], "properties": { "success": { "const": true }, "mode": { "const": "demo" }, "retry_attempt": { "type": "integer", "minimum": 2 } } },
        { "type": "object", "required": ["success", "mode", "error"], "properties": { "success": { "const": false }, "mode": { "const": "failed" }, "error": { "type": "string" } } },
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
| `VoiceNotifier.notify` | Audio generation unavailable/fails | `demo` | `{success:true, mode:"demo", message:string}` |
| `VoiceNotifier._make_call` | Twilio credentials missing | `demo` | `{success:true, mode:"demo"}` |
| `VoiceNotifier._make_call` | Twilio call succeeds | `live` | `{success:true, mode:"live", call_sid:string}` |
| `VoiceNotifier._make_call` | Twilio call raises exception | `failed` | `{success:false, mode:"failed", error:string}` |
| `routes/optimize._notify_with_retry` | Success on retry attempt > 1 | same mode as success result | Adds `retry_attempt` |

## Frontend Consumer Mapping

| Frontend file | Endpoint/data source | Fields read |
|---|---|---|
| `frontend/src/components/household/PhotoUpload.jsx` | `api.classifyImage` (`/api/classify`) | `source`, `materials[].{emoji,label,type,lbs,confidence,value}`, `total_value`, `total_lbs` |
| `frontend/src/components/driver/RouteBanner.jsx` | `useRoute().route.summary` (`/api/optimize-route`) | `total_stops`, `total_miles`, `estimated_minutes`, `total_lbs`, `lbs_per_hour`, `total_value`, `objective` |
| `frontend/src/components/shared/NotificationOverlay.jsx` | `useRoute().notifications` (`/api/accept-route` response or local fallback) | `household`, `eta_minutes`, `notification.mode` |
| `frontend/src/hooks/useRoute.js` | `api.optimizeRoute`, `api.acceptRoute` | checks `data?.stops`, stores `data?.notifications`, local fallback injects `eta_minutes` |
| `frontend/src/services/api.js` | API transport | no shape validation; returns raw JSON body |

## Delta Register (Current vs Frontend-Safe Target)

| ID | Priority | Delta | Evidence |
|---|---|---|---|
| D-001 | P0 | `/api/accept-route` `notifications[]` entries omit `eta_minutes`, but `NotificationOverlay` renders `n.eta_minutes`. UI displays `undefined` ETA for backend responses. | `backend/routes/optimize.py::accept_route`, `frontend/src/components/shared/NotificationOverlay.jsx` |
| D-002 | P1 | `/api/accept-route` notification entries are heterogeneous for `household`/`phone`. `duplicate_stop` and `not_found` skips omit both fields; claimed/already-claimed/completed include them. | `backend/routes/optimize.py::accept_route` |
| D-003 | P1 | `mode:"demo"` has two valid payload variants (with and without `message`). Frontend and typed clients must treat this as a union, not a single object shape. | `backend/services/voice.py::notify`, `backend/services/voice.py::_make_call` |
| D-004 | P2 | `/api/optimize-route` success payload does not include `success:true`, while many other routes use explicit success/error envelopes. | `backend/routes/optimize.py::optimize_route`, `backend/utils/http.py` |
| D-005 | P2 | Several summary fields are documented as numeric values but may serialize as integer tokens in zero-value cases (Python `round(sum(...), n)` behavior). | `backend/services/optimizer.py::_build_summary` |

## Follow-Up Fixes

- `[P0]` Add `eta_minutes` to each `notifications[]` entry in `/api/accept-route` using stop ETA already present in input payload.
- `[P1]` Normalize `notifications[]` entry envelope so `household` and `phone` are always present (or formally nullable) across all skip/success reasons.
- `[P1]` Normalize `mode:"demo"` response shape by always including `message` (empty or synthetic) so clients do not branch on field existence.
- `[P2]` Decide whether `/api/optimize-route` should adopt the shared `{success:true,...}` envelope for consistency.
- `[P2]` Coerce summary numeric outputs to explicit float serialization where required by strict contract tooling.
