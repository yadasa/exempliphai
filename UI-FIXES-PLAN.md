# UI Fixes Plan (Web + Extension)

> Scope: **ExempliphAI Next.js landing app** (`website/LandingPage/exempliphai`) + **Vue extension app** (`src/vue_src`).
>
> Goals (from request):
> 1) **/login post-validation redirect**: route users to **/account** or open **profile onboarding modal** when profile is incomplete.
> 2) **Referrals reliability**: add CORS to `getOrCreateReferralCode`, fix referrals tab blank state w/ loading + error handling.
> 3) **New user multi-step modal** (agency.ai look: blur + gradients + progress bar): steps = personal, email/location, resume upload; ensure it **exactly matches the extension LocalProfileEditor schema (fields + labels + options)** and **syncs to Firestore**.
> 4) **/account + /profile UI polish** (match extension blue/purple theme): modern cards/tabs; **do not remove any profile fields**; fix Veteran/Disability/LGBT to proper dropdowns; “Auto-submit” toggle becomes safer; unify landing + extension styling language.
>
> This document is **plan-only**. Implementation should wait for explicit approval.

---

## 0) Inventory & Key Files

### Next.js web app
- Login: `website/LandingPage/exempliphai/src/app/login/page.tsx`
- Account: `website/LandingPage/exempliphai/src/app/account/page.tsx`
- Profile: `website/LandingPage/exempliphai/src/app/profile/page.tsx`
- Auth guard: `website/LandingPage/exempliphai/src/lib/auth/require-auth.tsx`
- Referrals client: `website/LandingPage/exempliphai/src/lib/referrals/client.ts`
- Profile schema import: `website/LandingPage/exempliphai/src/config/local_profile_schema.json`

### Firebase Functions
- Functions entry: `exempliphai/functions/index.js`
  - callable: `exports.getOrCreateReferralCode`
  - callable: `exports.listMyReferrals`

### Extension (Vue)
- Local profile editor: `exempliphai/src/vue_src/components/LocalProfileEditor.vue`
- Schema source (extension build/public): `exempliphai/src/public/config/local_profile_schema.json`
- Legacy popup field reference (labels/options used by autofill mapping): `exempliphai/DATA_FIELDS.md`

### Canonical schema rule (must mirror extension)
The web onboarding modal **and** `/account/profile` UI must mirror the extension LocalProfileEditor **exactly**:
- same categories
- same field keys
- same field labels
- same input types
- for fields that are effectively enums (notably EEO), provide **the same dropdown options** on web as in extension popup semantics.

Source of truth priority:
1) `src/vue_src/components/LocalProfileEditor.vue` rendering behavior (boolean tri-state select, date placeholder rules, etc.)
2) `src/public/config/local_profile_schema.json` (keys/labels/types/required/format)
3) `DATA_FIELDS.md` (exact human-facing options for dropdown-like concepts, and wording expected by autofill matchers)

---

## 1) /login Post-validation Redirect (Account vs Onboarding Modal)

### Current behavior
- `src/app/login/page.tsx`:
  - If already authenticated: `router.replace('/account')`
  - After OTP verify: `router.replace('/account')`

### Desired behavior
- After phone auth succeeds, route users to the right “next step”:
  - **If profile is sufficiently complete**: go to `/account` (or optionally `/profile` depending on UX preference)
  - **If new/incomplete**: go to `/account` and immediately open the **onboarding modal** (multi-step)

### Proposed decision rule (minimal + schema-aligned)
We already have a schema-driven profile (`local_profile_schema.json`) and the web `/profile` page validates required fields.

Define a lightweight “completion check” used by login/account:
- Required keys (from schema):
  - `first_name`, `last_name`, `email`
- Plus **displayName** requirement for referrals + UX identity:
  - `account.displayName` (stored in Firestore under `account`)

Implementation note (plan-level):
- Avoid full validation at login time; do a small Firestore read after sign-in:
  - `users/{uid}`
  - Check `account.displayName`, `first_name`, `last_name`, `email`

### UX routing flow
1. OTP verify success
2. Redirect to `/account?onboarding=1` (or `/account#onboarding`)
3. `/account` loads and decides:
   - If incomplete → open modal automatically
   - If complete → do nothing

### Acceptance criteria
- Fresh user (no `users/{uid}` doc) lands on `/account` and sees onboarding modal immediately.
- Returning user with completed minimal fields does **not** see modal.
- Refreshing `/account` doesn’t re-open modal once user completes onboarding (store completion marker).

### Data marker
Add a Firestore flag to avoid repeated prompts:
- `users/{uid}.onboarding.completedAt` timestamp
- optionally `users/{uid}.onboarding.version` so we can re-run if schema changes.

---

## 2) Referrals: CORS + “Blank Tab” Fix (Loading / Error / Resilience)

### Symptoms & likely root causes
- "Referrals" tab sometimes appears blank.
- Most common causes in this setup:
  1) Callable function blocked due to **CORS / origin mismatch** in some deployments.
  2) Unhandled promise rejection / runtime error causes React subtree not to render.
  3) A single shared `err` state (used by both Account + Referrals) makes it easy to end up in confusing UI states.

### 2.1 Functions: add explicit CORS for `getOrCreateReferralCode`

#### Current
`exports.getOrCreateReferralCode = onCall({ region: REGION }, ...)`

#### Plan
Add CORS configuration consistent with Firebase Functions v2 callable capabilities.

**Option A (preferred if supported in runtime):**
- Use callable CORS option:
  - `onCall({ region: REGION, cors: true }, ...)`

**Option B (most explicit, matches request wording):**
- Convert `getOrCreateReferralCode` to `onRequest` and wrap with `cors({ origin: true })`.
  - Keep auth via `Authorization: Bearer` Firebase ID token (verify with Admin SDK)
  - This is a larger change because the web client currently uses `httpsCallable`.

**Recommendation:** start with Option A (smallest change). If the platform still blocks, move to Option B.

#### Acceptance criteria
- `getOrCreateReferralCode()` succeeds from:
  - local dev origin
  - production web origin
  - preview/deploy origins (if any)

### 2.2 Web UI: robust loading + error handling for referrals tab

#### Current UI logic (Account page)
- On `tab === 'referrals'`, do:
  - `Promise.all([getOrCreateReferralCode(), listMyReferrals()])`
  - set `refBusy`, `refCode`, `refStats`
  - on error: `setErr(...)`

#### Plan improvements
1. **Split state**:
   - `accountErr` vs `refErr`
   - `accountMsg` vs `refMsg`
2. **Render-safe defaults**:
   - show skeleton cards and disabled copy button while loading
3. **Retry affordance**:
   - if referral calls fail, show inline error + “Retry” button
4. **Partial success behavior**:
   - if code loads but stats fail (or vice versa), render what we have

#### Acceptance criteria
- Referrals tab always renders a frame (never blank):
  - loading state
  - success state
  - error state with retry

---

## 3) New User Multi-step Onboarding Modal (agency.ai styling)

### Where it should live
- Trigger from `/account` on first sign-in (or when required profile fields missing).
- Modal component lives in web app:
  - `website/LandingPage/exempliphai/src/components/onboarding/OnboardingModal.tsx`
  - imported + controlled by `src/app/account/page.tsx`

### Visual style direction (agency.ai inspired)
- Backdrop:
  - `backdrop-blur` + subtle noise/gradient
- Modal surface:
  - rounded-2xl/3xl, translucent `bg-card/70`, border with `border-white/10`
  - blue/purple radial highlights consistent with login page background
- Progress bar:
  - thin gradient bar (primary → violet)
  - step dots + labels
- Motion:
  - simple fade/scale (CSS only), no heavy deps

### Steps & validation

#### Step 1 — Personal (schema-exact)
Fields (must match `local_profile_schema.json` `personal` category):
- `first_name` (required) — label: **First Name**
- `last_name` (required) — label: **Last Name**
- `email` (required) — label: **Email** (email format validation)
- `phone` (optional) — label: **Phone**
- `preferred_name` (optional) — label: **Preferred Name**
- `birthday` (optional) — label: **Birthday (YYYY-MM-DD)** (date format validation)

Validation:
- Follow schema `required` + `format` rules exactly (email + YYYY-MM-DD).
- Do **not** introduce additional character restrictions that the extension editor does not enforce.

Note:
- If we still want a web-only handle/display name for referrals UX, keep it **separate** from the LocalProfile schema (e.g., `users/{uid}.account.displayName`) and do not gate onboarding completion on it unless the extension is updated to include it too.

#### Step 2 — Location + Work Authorization + Links (schema-exact)
Fields (must match `local_profile_schema.json` categories `location`, `work_auth`, `social`):
- **Location**
  - `location` — **Location (freeform)**
  - `address` — **Address**
  - `city` — **City**
  - `state` — **State / Province**
  - `country` — **Country / Region**
  - `postal_code` — **Postal Code**
- **Work Authorization** (render booleans as tri-state select like the extension: `— / true / false`)
  - `work_auth` — **Work Authorization (generic)**
  - `work_auth_us` — **Work Authorization (US)**
  - `work_auth_uk` — **Work Authorization (UK)**
  - `work_auth_ca` — **Work Authorization (Canada)**
  - `sponsorship` — **Need Sponsorship**
- **Social & Links**
  - `linkedin` — **LinkedIn**
  - `github` — **GitHub**
  - `portfolio` — **Portfolio**
  - `additional_url` — **Website**

#### Step 3 — EEO + Skills + Settings (schema-exact)
Fields (must match `local_profile_schema.json` categories `eeo`, `skills`, `settings`):
- **EEO (optional)**
  - `gender` — **Gender (1/2/3/4 depending on ATS)** (string)
  - `ethnicity` — **Ethnicity (string or array in some ATS)** (string)
  - `hispanic` — **Hispanic (true/false)** (boolean tri-state select)
  - `veteran_v2` — **Veteran Status (1/2/3)** (string dropdown)
  - `disability_v2` — **Disability Status (1/2/3)** (string dropdown)
  - `lgbt_v2` — **LGBT (1/2/3)** (string dropdown)

EEO dropdown options (fix required):
- Today these fields are `string` in the schema; the web UI must not render them as freeform text.
- Render as explicit **3-option dropdowns** (plus blank `—`):
  - **Yes** / **No** / **Prefer not to say**
- Additionally, keep compatibility with extension/autofill wording:
  - accept/save any existing stored string values (do not delete/overwrite unexpectedly)
  - map legacy verbose values (see `DATA_FIELDS.md` for Veteran/Disability wording) to the closest of the 3 options for display, but preserve the original on save unless the user changes it.

- **Skills**
  - `skill` — **Skills (comma separated)** (string)

- **Settings**
  - `autoSubmit` — **Auto-submit (dangerous)** (boolean) — must use the safe enable flow described in §4.3.

#### Step 4 — Resume Upload (web-only)
Goals:
- Let user upload a resume (PDF/DOCX) and store it reliably.
- Update Firestore with:
  - `resume`: { `url`, `path`, `contentType`, `size`, `uploadedAt` }

Storage plan:
- Firebase Storage path: `users/{uid}/resume/{timestamp}-{filename}`
- Firestore: write metadata under `users/{uid}.resume`

Schema alignment note:
- The LocalProfile schema is ATS-field-based; it doesn’t include resume by default.
- We can store resume metadata in Firestore without impacting the schema-driven form.

### Firestore write strategy (safe merge)
- Use `setDoc(..., { merge: true })`
- Write keys consistent with `/profile` editor (schema-exact):
  - top-level fields like `first_name`, `last_name`, `email`, `phone`, `preferred_name`, `birthday`, `location`, `address`, `city`, `state`, `country`, `postal_code`, work auth booleans, social links, EEO fields, `skill`
  - `updatedAt: serverTimestamp()`
- Add onboarding marker:
  - `onboarding.completedAt` + `onboarding.version`

### Sync expectations (web ↔ extension)
- Web `/profile` already reads/writes Firestore `users/{uid}`.
- Extension uses `chrome.storage.local` for autofill; it does not automatically sync.

Plan for “sync”:
- Define a **single canonical profile shape** in Firestore: same keys as schema.
- Future (optional): add an extension button “Import from Firestore” to pull those keys into `LOCAL_PROFILE`.
  - Not required to satisfy onboarding modal, but recommended for full ecosystem coherence.

### Acceptance criteria
- On fresh user:
  - onboarding modal appears
  - cannot proceed without passing step validation
  - final step uploads resume (or allows skip, depending on product decision)
  - completing modal writes Firestore doc + completion marker
- After completion:
  - modal does not re-open
  - `/profile` shows the values entered

---

## 4) /account + /profile UI Polish + Schema Parity + Safer Auto-submit

### 4.1 Unify style language (web + extension)

#### Web (Next.js) approach
- Introduce a shared “panel” and “tab” style pattern:
  - gradient top border or glow
  - consistent padding + rounded corners
  - consistent active tab gradient

Where:
- `/account` and `/profile` wrap their content in the same card shell
- reuse the radial background used on `/login`

#### Extension (Vue) approach
- Update CSS variables to match blue/purple palette:
  - `--gradient-primary` should mirror web’s `bg-gradient-primary`
  - ensure focus rings match

### 4.2 Veteran/Disability/LGBT: keep fields, fix to proper dropdowns (no removals)

#### Current
Schema includes EEO fields:
- `veteran_v2`, `disability_v2`, `lgbt_v2` (currently typed as `string`)

The extension LocalProfileEditor currently renders `string` fields as freeform text inputs.

#### Plan
- **Do not remove** `veteran_v2`, `disability_v2`, or `lgbt_v2` from either schema.
- Update both web and extension UIs so these three fields render as **explicit dropdowns** with:
  - blank option: `—`
  - `Yes`
  - `No`
  - `Prefer not to say`

Compatibility requirement (important):
- Many existing users may have verbose values stored (see `DATA_FIELDS.md` examples for Veteran/Disability).
- UI must be able to **display** those existing values safely:
  - if stored value is not one of the 3 canonical options, show a non-destructive “(existing value)” state and/or map it to closest canonical choice for display.
  - do **not** delete or overwrite stored values unless the user explicitly changes the dropdown.

Implementation approach (plan-level):
- Add `enum`/`options` support to the schema (recommended), e.g.
  - `{"key":"veteran_v2", "type":"string", "options":["Yes","No","Prefer not to say"]}`
- Update `LocalProfileEditor.vue` renderer to use `<select>` when `field.options` exists.
- Update web `/profile` renderer to do the same so both UIs are schema-driven and stay in sync.

Acceptance criteria:
- These fields appear in both web + extension.
- They are dropdowns with `Yes/No/Prefer not to say` (+ blank).
- Existing non-canonical strings remain intact until user changes them.

### 4.3 “Auto-submit” safe toggle

#### Current
- Schema includes `settings.autoSubmit` (boolean) as “dangerous”.

#### Plan (safety UX)
- Keep field, but add **two-step enable** in both web + extension:
  1) Toggle on → show confirmation dialog explaining risk
  2) Require explicit confirmation (checkbox + confirm button)
- Add “hold-to-enable” or “type ENABLE” confirmation (optional)
- Default remains off.

Implementation sketch (plan-level):
- Web: in `/profile`, detect field `autoSubmit` and render custom component instead of generic boolean select.
- Extension: in `LocalProfileEditor.vue`, special-case key `autoSubmit`.

Acceptance criteria:
- Users cannot accidentally enable auto-submit with one click.

---

## 5) Implementation Order (to minimize risk)

1. **Referrals reliability**
   - Add callable CORS option
   - Fix referrals tab states + retry
2. **Schema mirroring + options parity**
   - Ensure web schema copy exactly matches extension schema (keys/labels/types)
   - Add schema support for dropdown options/enums where needed (EEO v2 + any other extension popup dropdowns we want to preserve)
   - Update both renderers (web + extension) to respect `options` and render `<select>`
   - Verify save/load does not destroy existing values
3. **Onboarding modal**
   - Build component + validation
   - Firestore writes + completion marker
   - Hook into `/account`
4. **Login redirect improvements**
   - Route to `/account?onboarding=1`
   - Ensure modal opens appropriately
5. **UI polish / theming unification**
   - Apply consistent gradients, panels, tabs
   - Confirm responsive + accessible

---

## 6) Testing Checklist

### Web
- Login flow:
  - invalid phone formats handled
  - OTP verify success
  - redirect correctness
- Onboarding modal:
  - validation edge cases
  - cancel behavior
  - completion marker prevents re-open
- Account:
  - referrals tab loads with loading skeleton
  - error state displays
  - retry works
- Profile:
  - schema fields render
  - removed fields absent
  - save/load works

### Functions
- Callable functions work from web origin
- No CORS errors in browser console
- `getOrCreateReferralCode` idempotent

### Extension
- LocalProfileEditor loads schema
- EEO fields removed
- Auto-submit confirmation required

---

## 7) Risks / Notes

- **Callable CORS** behavior differs by Firebase Functions version/runtime. If `cors: true` doesn’t solve it, we’ll move `getOrCreateReferralCode` to `onRequest + cors({origin:true})` and adjust the client away from `httpsCallable`.
- **Name validation strictness** (“no spaces/special”) may be too strict for real names. This plan follows the request; we can loosen later.
- **Resume upload** adds Storage dependencies and security rules work; ensure Storage rules are locked to authenticated user path.

---

## 8) Definition of Done

- `/login` routes into `/account` and opens onboarding only when needed.
- Referrals tab never blank; has loading, error, retry.
- `getOrCreateReferralCode` works across origins (CORS resolved).
- Onboarding modal collects required data, uploads resume, syncs to Firestore, and sets completion marker.
- `/account` + `/profile` are visually consistent with extension theme.
- Veteran/Disability/LGBT kept in schema and UIs, rendered as `Yes/No/Prefer not to say` dropdowns (+ blank), without destroying existing saved values.
- Auto-submit requires explicit confirmation (safer toggle).
