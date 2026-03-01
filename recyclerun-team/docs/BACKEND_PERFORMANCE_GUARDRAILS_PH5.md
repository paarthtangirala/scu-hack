# Backend Performance Guardrails (PH5-SOHAM-01)

## Scope

Issue: `PH5-SOHAM-01: Backend Performance Profiling + Failure Guardrails`.

Commit baseline for this report: `1c5ab2b535bb3ead98e46d914644645fa437e7ba`.

Date/time (UTC) profiling snapshot: `2026-03-01T08:33:42.900542+00:00`.

## Methodology

### Profiling target

- Endpoint profiled: `POST /api/optimize-route`
- Includes route validation + optimizer execution + JSON serialization.
- Transport used: Flask test client (no network dependency).

### Tooling

- Script: `backend/tools/profile_optimize_route.py`
- Timing clock: `time.perf_counter_ns()`
- Metrics reported per scenario:
  - `sample_count`
  - `mean_ms`
  - `p50_ms`
  - `p95_ms`
  - `p99_ms`
  - `max_ms`
  - `stddev_ms`

### Determinism controls

- Fixed RNG seed (`--seed 20260301`).
- Warmup iterations before measured runs.
- Stress datasets generated deterministically by cloning seeded listings with deterministic jitter.
- Forced fallback mode controlled by `OPTIMIZER_FORCE_FALLBACK=1` within harness.

### Scenario matrix

- Dataset sizes:
  - baseline seeded (`x1`)
  - stress `x5`
  - stress `x10`
- Objectives: `value`, `lbs`
- Solver modes:
  - `normal` (OR-Tools when available)
  - `forced_fallback` (greedy path)

## Commands Run

```bash
# profiling
python backend/tools/profile_optimize_route.py \
  --runs 8 \
  --warmup 2 \
  --seed 20260301 \
  --json-out docs/ph5_optimize_profile.json

# validation gates
pytest -q backend/tests/test_optimizer.py
pytest -q backend/tests/test_voice_notifier.py
pytest -q backend/tests/test_service_response_contracts.py
pytest -q backend/tests/test_api_contracts.py
pytest -q backend/tests
```

## p95 Results

Environment note: OR-Tools was available; normal mode observed solver `ortools` in all normal scenarios.

| Scenario | Dataset size | Objective | Solver mode | Observed solver | p95 (ms) |
|---|---:|---|---|---|---:|
| `m1_value_normal` | 20 | value | normal | ortools | 2003.377 |
| `m1_lbs_normal` | 20 | lbs | normal | ortools | 2005.212 |
| `m5_value_normal` | 100 | value | normal | ortools | 2024.294 |
| `m5_lbs_normal` | 100 | lbs | normal | ortools | 2011.505 |
| `m10_value_normal` | 200 | value | normal | ortools | 2038.854 |
| `m10_lbs_normal` | 200 | lbs | normal | ortools | 2033.232 |
| `m1_value_forced_fallback` | 20 | value | forced_fallback | greedy_fallback | 0.585 |
| `m1_lbs_forced_fallback` | 20 | lbs | forced_fallback | greedy_fallback | 0.337 |
| `m5_value_forced_fallback` | 100 | value | forced_fallback | greedy_fallback | 3.452 |
| `m5_lbs_forced_fallback` | 100 | lbs | forced_fallback | greedy_fallback | 1.212 |
| `m10_value_forced_fallback` | 200 | value | forced_fallback | greedy_fallback | 6.634 |
| `m10_lbs_forced_fallback` | 200 | lbs | forced_fallback | greedy_fallback | 1.336 |

Raw machine-readable output is stored at:

- `docs/ph5_optimize_profile.json`

## Guardrails Added

### Malformed input guardrails

- Added explicit malformed payload tests for:
  - non-object `/api/optimize-route` bodies
  - malformed optimize types/ranges
  - malformed `/api/accept-route` stops payloads
  - known malformed payload matrix (assert no `500`)
- Added route-level defensive exception handling in:
  - `backend/routes/optimize.py::optimize_route`
  - `backend/routes/optimize.py::accept_route`
  - `backend/routes/classify.py::classify`
- Internal failures now return structured JSON envelopes via `backend/utils/http.py#error`.

### Structured failure envelope guarantees

Failure responses for these guarded paths now remain JSON with:

- `success: false`
- `error` (legacy key)
- `code` (machine-readable)
- `message`
- `errors`/`details` when applicable

No HTML/plaintext leakage for known malformed payload test matrix.

## Deterministic Fallback Guarantees

### Solver fallback

- OR-Tools exception path now emits structured fallback telemetry (`event=optimizer_fallback`, `reason=ortools_exception`, `exception_type`).
- Forced fallback mode is supported via `OPTIMIZER_FORCE_FALLBACK` and via `optimize(..., force_fallback=True)`.
- Greedy fallback tie-breakers were made explicit and stable to ensure deterministic ordering on equal scores:
  - lower travel time
  - lower distance
  - lexical `listing_id`

### Notifier fallback

- Existing deterministic notifier reason semantics preserved and test-proven:
  - missing Twilio config -> `demo` + `reason=twilio_not_configured`
  - forced demo -> `demo` + `reason=forced_demo_mode`
  - timeout -> `failed` + `reason=twilio_timeout`
- `_notify_with_retry` deterministic contract maintained:
  - adds `retry_attempt` only on retry success
  - omitted on first-attempt success and final failure

## Limitations / Follow-up

1. OR-Tools normal-mode p95 is constrained by configured OR-Tools local-search time budget (`LNS_TIME_SEC=2`), so p95 tracks around ~2s by design in larger scenarios.
2. This profiling is single-process local test-client profiling; production p95 should be measured with deployment telemetry under realistic concurrent load.
3. API contracts remain backward-compatible on success payloads; new guarded error codes (`optimizer_failed`, `accept_route_failed`) should be documented in any external API SDK typing if strict enums are used.
