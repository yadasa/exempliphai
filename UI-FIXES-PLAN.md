# UI Fixes Plan (Web + Extension)

> Scope: **ExempliphAI Next.js landing app** (`website/LandingPage/exempliphai`) + **Vue extension app** (`src/vue_src`).
>
> Goals (from request):
> 1) **/login post-validation redirect**: route users to **/account** or open **profile onboarding modal** when profile is incomplete.
> 2) **Referrals reliability**: add CORS to `getOrCreateReferralCode`, fix referrals tab blank state w/ loading + error handling.
> 3) **New user multi-step modal** (agency.ai look: blur + gradients + progress bar): steps = personal (first/last/displayName validation), email/location, resume upload; ensure it **matches LocalProfileEditor schema** and **syncs to Firestore**.
> 4) **/account + /profile UI polish** (match extension blue/purple theme): modern cards/tabs; remove Veteran/Disability/LGBT fields; “Auto-submit” toggle becomes safer; unify landing + extension styling language.
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

#### Step 1 — Personal
Fields:
- `first_name` (required)
- `last_name` (required)
- `account.displayName` (required)

Validation (per request):
- first/last/displayName: **no spaces** and **no special characters**
  - Recommend regex: `^[A-Za-z0-9_]+$`
  - If we want to allow hyphen in names: extend later; for now follow request strictly.

UX notes:
- Show examples and “why”:
  - displayName used for referral identity / handle

#### Step 2 — Email + Location
Fields (schema-aligned):
- `email` (required, validate format)
- `location` (optional, freeform)
- optionally: `city`, `state`, `country`, `postal_code` (optional, collapsible “advanced”)

#### Step 3 — Resume Upload
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
- Write keys consistent with `/profile` editor:
  - top-level fields like `first_name`, `last_name`, `email`, `location`, ...
  - nested `account.displayName`
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

## 4) /account + /profile UI Polish + Field Pruning + Safer Auto-submit

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

### 4.2 Remove Veteran/Disability/LGBT fields

#### Current
Schema includes EEO fields:
- `veteran_v2`, `disability_v2`, `lgbt_v2`

#### Plan
- Remove those fields from both schema copies:
  - `exempliphai/src/public/config/local_profile_schema.json`
  - `website/LandingPage/exempliphai/src/config/local_profile_schema.json`

Options for EEO category:
- Keep category but only:
  - `gender`, `ethnicity`, `hispanic`
- Or remove EEO category entirely (product choice).

Acceptance criteria:
- Web `/profile` no longer renders those inputs.
- Extension LocalProfileEditor no longer renders them.

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
2. **Schema pruning** (remove sensitive fields)
   - Update schema in both web + extension
   - Verify renders + saves
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
- Veteran/Disability/LGBT removed from schema and UIs.
- Auto-submit requires explicit confirmation (safer toggle).
