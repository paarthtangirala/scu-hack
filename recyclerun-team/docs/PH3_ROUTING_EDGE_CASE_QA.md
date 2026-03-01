# PH3 Routing Edge-Case QA + Backend/Fallback Parity
Owner: Sara  
Issue: `#13` (PH3-SARA-01)

## Goal
Validate driver routing reliability across edge cases and compare backend optimizer output with frontend fallback (`frontend/src/utils/optimizer.js`) under reproducible inputs.

## Reproducible Scenario Matrix

| Scenario ID | Case | Input Strategy | Route Params |
|---|---|---|---|
| `empty_listings` | Empty listings | Keep 0 available listings after reset | `max_minutes=120`, `capacity=1000`, `objective=value` |
| `zero_capacity` | Zero truck capacity | Keep all listings | `max_minutes=120`, `capacity=0`, `objective=value` |
| `short_time_window` | Short time window | Keep all listings | `max_minutes=5`, `capacity=1000`, `objective=value` |
| `business_heavy_only` | Only business-heavy listings | Keep only `listing_kind=business` | `max_minutes=180`, `capacity=2000`, `objective=lbs` |
| `long_distance_sparse` | Long-distance sparse listings | Keep farthest 4 listings from driver anchor | `max_minutes=240`, `capacity=1000`, `objective=value` |

Implementation is codified in:
- `frontend/src/services/routeEdgeCaseParity.js`
  - `buildScenarioInput(...)`
  - `runFallbackScenario(...)`
  - `runRouteEdgeCaseMatrix(...)`

## Parity Thresholds (Acceptable Delta)

Defined in `PARITY_THRESHOLDS`:
- `stopCountAbs <= 2`
- `totalLbsPct <= 35%`
- `totalValuePct <= 45%`
- `totalMilesPct <= 45%`
- `estMinutesPct <= 40%`

## Known Parity Gaps (Expected)

1. Backend uses OR-Tools global search; fallback uses greedy score-per-minute heuristic.  
Result: stop ordering and selected subset can diverge under tight constraints.

2. Backend and fallback apply different distance rounding precision.  
Result: `total_miles` can differ even when stop set is similar.

3. Fallback has no `solver`/`solve_time_ms` semantics; backend does.  
Result: comparison must focus on route outcome metrics, not solver internals.

## Stability Contract

No crash/blank-state condition is satisfied when all are true:
- Route payload has `stops[]` and `summary{}`.
- `summary.total_stops === stops.length`.
- `eta_minutes` is monotonic across stops.

Contract validator:
- `validateRouteStability(...)` in `routeEdgeCaseParity.js`

## How To Run

### 1) Unit-level matrix + parity helper validation
```bash
cd frontend
npm test -- routeEdgeCaseParity.test.js
```

### 2) Live backend matrix execution (manual QA session)
Use `runRouteEdgeCaseMatrix(...)` from `frontend/src/services/routeEdgeCaseParity.js` against your API base (local or tunnel) and store output rows in QA notes.

Suggested base URL:
- local: `http://localhost:5000/api`
- tunnel: `https://<your-subdomain>.loca.lt/api`
