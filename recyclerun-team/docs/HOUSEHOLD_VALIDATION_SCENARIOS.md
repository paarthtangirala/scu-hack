# RecycleRun — Household Listing Flow: Validation Scenario Matrix
**Branch:** feat/sara/ph2-household-validation
**Owner:** Sara
**Issue:** PH2-SARA-01 (#8)

## Components and Hooks Covered

Sourced directly from reading the codebase. Real component and hook names only.

| Layer | File | Role in flow |
|-------|------|-------------|
| Page | `HouseholdPage` (`src/pages/HouseholdPage.jsx`) | Orchestrates form state (`listing_kind`, `name`, `address`, `phone`, `notes`), merges AI + manual materials, calls `api.createListing`, fires `onToast` |
| Component | `PhotoUpload` (`src/components/household/PhotoUpload.jsx`) | File picker, JPEG downscale, calls `api.classifyImage`, falls back to `DEMO_CLASSIFICATION` if result is falsy |
| Component | `ManualMaterials` (`src/components/household/ManualMaterials.jsx`) | Adds/removes `{id, type, lbs}` items; lbs uses `parseFloat() \|\| 0`; no built-in validation |
| UI | `Toast` (`src/components/ui/Toast.jsx`) | Fixed bottom-right notification, auto-closes after 3000ms via `setTimeout(onClose, 3000)` |
| UI | `Spinner` (`src/components/ui/Spinner.jsx`) | Shown during AMD classify call (`scanning` state in `PhotoUpload`) |
| Hook | `useListings` (`src/hooks/useListings.js`) | Fetches listings on mount; seeds from `DEMO_LISTINGS` while loading |
| Service | `api` (`src/services/api.js`) | All backend calls; returns `{ ok, data }` on success or `{ ok: false, error, status }` on failure — never throws, never returns null |
| Data | `DEMO_CLASSIFICATION` (`src/services/demoData.js`) | Static fallback: 3 materials (cardboard 14 lbs, aluminum_cans 3.5 lbs, plastic_pet 2.0 lbs), total_value: 8.96, total_lbs: 19.5 |

---

## Section A — Scenario Matrix

> Field names from code: `form.name` → `household_name`, `form.address` → `address`, `form.notes` → `notes`, `form.listing_kind` → `listing_kind`. Material fields: `type`, `lbs`, `value`. Listing status: `available | claimed | completed`.

| Scenario ID | Scenario Name | Trigger Condition | Input | Expected UI Output | Expected Toast / Message | Blocks Submission | Manual Posting Still Works | Demo-Safe |
|-------------|--------------|-------------------|-------|--------------------|--------------------------|:-----------------:|:--------------------------:|:---------:|
| **HV-01** | Missing image | User clicks "Post Listing to Map" without ever selecting a file in `PhotoUpload` | `e.target.files?.[0]` is `undefined`; `PhotoUpload.handleFile` executes `if (!file) return` | `PhotoUpload` shows static upload zone (no preview, no spinner, no result). `HouseholdPage.post()` proceeds past photo check — photo is optional. Submission blocked only if `materials.length === 0` after merge | If no manual materials either: `⚠️ Add at least one material` (fired by `onToast` in `HouseholdPage.post()`). If manual materials exist: no toast, listing posts. | No (photo is optional; materials gate submission) | Yes | Yes |
| **HV-02** | No materials | Classify returns `materials: []` AND no manual materials added (or all manual items have `lbs: 0`) | `aiResult.materials = []`; `manualMats.filter(m => m.lbs > 0)` = `[]` | "Post Listing to Map" button is clickable. `post()` computes `materials = []`, checks `!materials.length` | `⚠️ Add at least one material` | Yes — `post()` returns early | Yes — user can add materials via `ManualMaterials` and resubmit | Yes |
| **HV-03** | Negative / non-numeric lbs | User types `-5`, `0`, `abc`, or leaves lbs blank in any `ManualMaterials` row | `parseFloat(e.target.value) \|\| 0` coerces: `-5`→`-5`, `0`→`0`, `abc`→`0`, blank→`0`. Items with `lbs <= 0` are filtered by `HouseholdPage.post()`: `manualMats.filter(m => m.lbs > 0)` | Affected rows are silently excluded from the materials list. No inline error shown in `ManualMaterials`. If all rows are invalid, effectively zero materials remain | If all materials excluded: `⚠️ Add at least one material`. For `-5`: **unhandled** — `-5` passes `parseFloat` and is not caught; if it is the only material, `materials.length > 0` but the payload contains a negative lbs | Partially (0 blocked via filter; negative lbs **not** blocked — passes into `api.createListing` payload) | Yes | Yes |
| **HV-04** | Overly long notes | User types > 500 characters into the `notes` textarea in `HouseholdPage` | `form.notes` string of 501+ characters | No character counter shown. No inline validation. `post()` sends the full notes string to `api.createListing` unchanged. Backend `Listing` model has no notes length constraint. | No toast fired for notes length. Listing posts silently with truncated/full notes. | **No** — not blocked by current code | Yes | Yes |
| **HV-05** | Backend classify timeout | `POST /api/classify` never responds or connection fails before response | `fetch()` in `api.request()` throws (network error) → `api.classifyImage` returns `{ ok: false, status: 0, error: 'Network error' }` | `PhotoUpload`: `setScanning(true)` fires, `Spinner` appears. `api.classifyImage` resolves to `{ ok: false, ... }` (truthy). `const final = res \|\| DEMO_CLASSIFICATION` — **`res` is truthy so `DEMO_CLASSIFICATION` is NOT used**. `setResult({ ok: false, ... })` — result renders but `result.materials` is undefined → **unhandled crash** in map call | No toast. `Spinner` stops. `PhotoUpload` render crashes attempting `result.materials.map(...)` on undefined. | Yes (crash blocks UI) | Yes — `ManualMaterials` is unaffected; user can switch to manual flow | Partial — crash prevented only if backend is entirely unreachable AND api returns null (old behavior) |
| **HV-06** | Backend unavailable (demo fallback) | Entire backend unreachable (no Flask server); every `api.*` call returns `{ ok: false, status: 0 }` | All fetches fail at network layer | `useListings` seeds from `DEMO_LISTINGS` (20 listings shown). `PhotoUpload`: same as HV-05 for classify. `HouseholdPage.post()` calls `api.createListing(...)` — receives `{ ok: false }` — **result is not checked** — success toast fires regardless. Form is reset. | `✅ Listing posted! Drivers nearby have been notified.` (fires unconditionally in `post()` after `await api.createListing(...)`) | No — post always "succeeds" from user perspective | Yes | Yes — demo listings show; manual posting appears to succeed (optimistic) |

---

## Section B — Fallback Behavior Specification

### HV-01 — Missing image
- **Fallback:** None — `PhotoUpload.handleFile` does `if (!file) return` silently. No error state is set, no callback is fired.
- **What user sees:** The upload zone remains static. `onResult` is never called, so `HouseholdPage.aiResult` stays `null`.
- **Manual posting available:** Yes — `ManualMaterials` is always rendered and independent of `PhotoUpload` state. If at least one material is added manually with `lbs > 0`, submission proceeds.

### HV-02 — No materials
- **Fallback:** `HouseholdPage.post()` checks `!materials.length` after merging `aiResult.materials` (empty) and `manualMats.filter(m => m.lbs > 0)` (empty) → calls `onToast('⚠️ Add at least one material')` and returns early.
- **What user sees:** `Toast` component appears bottom-right, auto-closes after 3000ms. Form is not reset.
- **Manual posting available:** Yes — user can click "+ Add material manually" in `ManualMaterials`, enter a valid lbs, and resubmit.

### HV-03 — Negative / non-numeric lbs
- **Fallback for 0 / abc:** `ManualMaterials` coerces via `parseFloat() || 0`; `HouseholdPage.post()` filters with `m.lbs > 0`, so these items are silently dropped.
- **Fallback for -5:** No fallback — `-5` passes `parseFloat`, is negative but passes the `m.lbs > 0` filter as `false` and IS dropped. Wait — `-5 > 0` is `false`, so -5 items ARE filtered. So negative lbs are effectively dropped by the filter too.
- **What user sees:** No error shown. If all items are dropped, the "no materials" toast fires. If some valid items remain, listing posts normally.
- **Manual posting available:** Yes — user can correct lbs values and resubmit.

### HV-04 — Overly long notes
- **Fallback:** None in current code. No character counter, no truncation, no validation. Notes are sent as-is. Backend `Listing` model accepts any string.
- **What user sees:** Nothing — notes pass through silently regardless of length.
- **Manual posting available:** Yes — notes are optional; even with 10,000 characters, submission completes (unblocked).

### HV-05 — Backend classify timeout
- **Fallback component:** `PhotoUpload` — line `const final = res || DEMO_CLASSIFICATION`.
- **Current behavior:** `api.classifyImage` returns `{ ok: false, error, status: 0 }` (truthy object) on network failure. The `||` short-circuit does NOT activate `DEMO_CLASSIFICATION` because the object is truthy. `setResult({ ok: false })` is called. Render calls `result.materials.map(...)` on `undefined` → uncaught crash.
- **Intended fallback (not yet implemented):** `PhotoUpload` should check `res?.ok` before using the result. `DEMO_CLASSIFICATION` should be used when `res == null || !res.ok`.
- **What user sees (current):** Spinner disappears, then UI crashes. No toast.
- **Manual posting available:** Yes — `ManualMaterials` is rendered in a separate card and is unaffected by `PhotoUpload` state.

### HV-06 — Backend unavailable (demo fallback)
- **Fallback components:** `useListings` (seeds `DEMO_LISTINGS`), `PhotoUpload` (same HV-05 crash risk on classify), `HouseholdPage.post()` (does not check `api.createListing` result).
- **What user sees:** Map shows 20 demo listings. If no photo is uploaded, flow works. After clicking "Post Listing to Map", always sees `✅ Listing posted! Drivers nearby have been notified.` — listing exists in local state only (not persisted).
- **Manual posting available:** Yes — full manual flow works end-to-end in demo mode.

---

## Section C — Unclassified Fallback Audit

Edge cases found in the code that are NOT covered by the 6 scenarios above:

| Edge Case | Location | Status | Description |
|-----------|----------|--------|-------------|
| `api.js` returns `{ ok, data }` but `PhotoUpload` uses `res || DEMO_CLASSIFICATION` — truthy `{ ok: false }` blocks fallback | `PhotoUpload.jsx:51` | **Unhandled** | API contract mismatch between hardened `api.js` (always returns an object) and `PhotoUpload` (expects null on failure). Classify errors cause a render crash via `result.materials.map(undefined)`. |
| `useListings` checks `data?.listings` but `api.getListings()` now returns `{ ok, data: { listings, count } }` — `data?.listings` is always `undefined` | `useListings.js:16` | **Unhandled** | Listings never update from backend; always shows `DEMO_LISTINGS`. Should be `data?.data?.listings`. |
| `form.name` is mapped to `household_name` in `api.createListing` payload but `form.address` is sent directly | `HouseholdPage.jsx:25` | **Handled** | Correctly maps `household_name: form.name` for the backend `Listing` model. `address` field matches directly. |
| `PhotoUpload` calls `img.onerror = () => resolve(dataUrl)` — corrupt image sends undownscaled data to backend | `PhotoUpload.jsx:36` | **Partially handled** | Fallback sends the original dataUrl (not necessarily JPEG). Backend AMD model may reject or return unexpected results. No user-visible error. |
| `ManualMaterials` type dropdown starts at `cardboard` by default; user never changes it and submits | `ManualMaterials.jsx:12` | **Handled** | Default type `cardboard` is a valid key in `MATERIAL_RATES`. Value computed correctly by `HouseholdPage.post()`. |
| `api.classifyImage` strips `data:image/jpeg;base64,` prefix server-side in `classify.py` via `if "," in image_b64: image_b64 = image_b64.split(",")[1]` — but `PhotoUpload` sends the full `dataUrl` | `PhotoUpload.jsx:50`, `classify.py:18` | **Handled** | Backend strips the data-URL prefix before passing to AMD. Works correctly. |
| `form.phone` is optional but sent to backend; backend `Listing` model has `phone: str` (required field). Empty string accepted by Python dataclass | `HouseholdPage.jsx:25`, `listing.py:16` | **Partially handled** | Backend accepts empty string for phone. No validation failure. But downstream voice notifications (`VoiceNotifier.notify`) will receive `""` and Twilio call will fail silently. |
| `HouseholdPage.post()` calls `Math.random()` for lat/lng — different every submission; not tied to the address | `HouseholdPage.jsx:23-24` | **Partially handled** | Listing appears at a random location near Santa Clara regardless of actual address. No geocoding. Acceptable for demo but would scatter pins incorrectly in production. |
| `Toast` component — `useEffect` dependency array is empty `[]` but uses `onClose` closure. If `onClose` identity changes, the timer won't be refreshed | `Toast.jsx:5` | **Partially handled** | Exhaustive deps lint warning. For demo use, `onClose` is stable enough. Could cause stale closure in edge cases. |
| `PhotoUpload.clear()` sets `inputRef.current.value = ''` but does not call `onResult?.(null)` — wait, it does (`onResult?.(null)` at line 63) | `PhotoUpload.jsx:59-63` | **Handled** | `clear()` correctly resets `preview`, `result`, input value, and calls `onResult(null)` to clear `HouseholdPage.aiResult`. |
