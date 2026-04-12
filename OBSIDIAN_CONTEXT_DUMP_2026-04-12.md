# Context Dump — 2026-04-12

This is a high-signal snapshot of what was done today across active repos, plus the current state and next steps.

## 1) yadasa/church (The Garden single-site build)

### Goal
Ship a functioning, mobile-first, single-site giving/admin/kiosk platform on Firebase + Stripe, where you only need to add live secrets.

### What was implemented
- Monorepo scaffold + real code for:
  - Firebase Functions: Stripe PaymentIntent creation + webhook reconciliation
  - Firestore: rules + indexes
  - Web app: Stripe Elements giving flow
  - Admin ledger: role-gated read of donations
  - Kiosk mode: large UI giving flow
- Refactor to **single site**:
  - Removed separate `apps/admin` and `apps/kiosk` builds
  - Added routes inside `apps/web`:
    - `/` home
    - `/give` giving
    - `/profile` auth + role display
    - `/admin` admin ledger (requires role claim)
    - `/kiosk` kiosk giving
  - Firebase Hosting now serves `apps/web/dist` only.

### Current status
- Latest commit on GitHub: **0fc0a66** (church repo)
- Build + typecheck confirmed passing locally.

### Remaining setup (by you)
- Add Firebase project config values to `.env`.
- Add Stripe secrets to Functions runtime.
- Seed initial Firestore `funds` (there is seed JSON in the repo).
- Assign admin role claims in Firebase Auth for admin access.

## 2) yadasa/exempliphai (extension + proxy-based Pure AI mode + website gating)

### Pure AI mode fixes
User report: Pure AI toggled on, but no `exempliphai: Pure AI mapping batch` logs.

Findings:
- Provider is proxy-only (`chrome.runtime.sendMessage({ action: 'AI_PROXY', ... })`). API key is documented as unused.
- Content script incorrectly gated Pure/Hybrid AI behind `res['API Key']` which caused Phase 2 to silently never run.

Fixes shipped:
- **d9b2ec3**: remove API-key gates for Pure AI + Hybrid AI + AI dropdown-option fallbacks so they use the proxy as intended.
- **4e3410e** (compat): merge `API Key` from local storage for installs that had it there. No longer required post-d9b2ec3.

### Website changes
Request:
- Change header CTA from "Add To Chrome" → "Get Started"
- Require sign-in to access `/download`

Fix shipped:
- **0dbb77f**: CTA rename + wrap `/download` page in `RequireAuth` (redirects to `/login` when logged out).

### Notes added
- **9fa7bae**: added `OBSIDIAN_NOTES_2026-04-12_pure-ai-proxy-download-auth.md` (detailed writeup).

## 3) Next steps (recommended)

### Church
1. Add a small seed script/button (admin-only) to load `funds` from seed JSON in a safe, idempotent way.
2. Add a simple admin UI to manage funds (create/update/disable) so you aren’t dependent on console edits.
3. Add webhook replay/admin diagnostics page (list latest Stripe events, last error per donation).

### Exempliphai
1. After you pull + reload the extension, re-test Pure AI mode on Lever/Greenhouse and confirm `Pure AI mapping batch` logs appear.
2. If Phase 2 still doesn’t run, instrument the "forced" path (verify `smartApplyLastRunForced` toggles true on the UI trigger you’re using).

