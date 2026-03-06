# PLAN.md — CL5.2 Autofill Reliability + Manual Trigger (Greenhouse-first)

**Date:** 2026-03-06  
**Scope:** `src/public/contentScripts/autofill.js`, `src/public/contentScripts/utils.js`, `src/public/manifest.json`  
**Primary goal:** Make autofill *actually run* (especially Greenhouse) + provide a manual “Autofill Now” trigger for multi-step/gated flows.

---

## 0) CL4.6 Status (already landed in 5c3d0d7)

The CL4.6 plan items (label resolution, generic keys for auth/sponsorship/veteran/location, React/native setter, textarea support, ARIA combobox→listbox handling, fuzzy match, `param === "Gender" || param === "Location (City)"` fix, dedupe of generic keys) are already implemented in the current codebase.

CL5.2 should **not re-test** those in isolation; instead focus on the remaining “no autofill at all / stuck early” reliability failures.

---

## 1) Current Failures → Likely Root Causes

### 1.1 “NO autofill at all” on Greenhouse (GoGuardian / PlanetScale / Axon / Xapo)

**Primary causes** (often more than one applies):

1) **Autofill start condition is too fragile**: only starting on DOM mutations misses pages where the application form is already present when the observer attaches.

2) **Embedded ATS in iframes**: many companies embed Greenhouse/Lever application forms inside a cross-origin iframe. Without content scripts running in iframes, the top-frame script cannot access the form.

3) **Wrong form chosen / disconnect too early**: on some pages `document.querySelector('form')` can match a non-application form (newsletter/search), causing autofill to “run” against the wrong container and appear to do nothing.

### 1.2 Quantum Metric (Greenhouse/Lever-like)

Reported:
- “Are you legally authorized…” got **No**.
- “Will you now/future require sponsorship…” not filled.
- “What is your location?” not filled despite having “United States of America” stored.

Most likely:
- **Custom questions** on Greenhouse/Lever are not always covered by the site-specific field map alone. Even with good label matching, if we only run the Greenhouse map, we can miss question variants that only exist in `fields.generic`.
- “Location” questions vary: sometimes they mean **country** (dropdown), sometimes **city**. When storage only has country-like values (“United States of America”), city-only targeting can fail.

### 1.3 Vesta — Veteran status dropdown not selected

Most likely:
- Dropdown is either a custom combobox/listbox that needs option clicking (not just setting input value), **or** the stored value is a near-synonym (“Decline”, “Prefer not to say”, “I don’t wish to answer”) and requires better option scoring / synonym mapping.

### 1.4 Egnyte — stuck on language dropdown, never reaches fields

Most likely:
- The page is **gated/multi-step**: selecting language reveals the application form later.
- If autofill only runs once and disconnects, it can run before the real fields exist.

---

## 2) CL5.2 Changes (Implementation Plan)

### PRIORITY 1 — Reliable Start: run immediately + keep watching

**Goal:** Ensure autofill runs on server-rendered forms (no mutations) and reruns after multi-step UI reveals fields.

**Approach:**
- Attempt an **immediate** autofill run once on load.
- Keep a MutationObserver running with debounce and a throttle/lock to avoid repeated heavy runs.
- Only do this on ATS-like pages (because the manifest is intentionally broad).

**Acceptance tests:**
- Greenhouse application page that renders synchronously should autofill without needing any DOM mutation.
- After selecting “Language”, the newly-revealed fields should autofill within ~1–2 seconds (or user can click the manual button).

### PRIORITY 2 — Manual override: fixed “🚀 AUTOFILL NOW” button

**Goal:** Users can trigger autofill exactly when the page is ready.

**Requirements:**
- Fixed top-right button.
- Only inject on ATS-like pages (host matches known ATS OR page contains strong job-app signals).
- On click: find the “current” form (activeElement.form) or best match and call `autofill()`.

**Acceptance tests:**
- On multi-step flows, user completes gating step → clicks button → fields fill.

### PRIORITY 3 — Greenhouse custom questions: always run a generic “extras” pass

**Goal:** Don’t miss custom questions that don’t map cleanly to platform IDs.

**Approach:**
- After processing a site-specific map (greenhouse/lever/etc.), run `fields.generic` again as an **extras pass**, excluding Resume upload.
- This picks up common question wording (auth/sponsorship/veteran/location) even when the platform-specific keys don’t match.

**Acceptance tests:**
- On Greenhouse, both “authorized to work” and “sponsorship” custom questions fill when present.
- “What is your location?” custom question fills when it is a city-like or country-like dropdown.

### PRIORITY 4 — Embedded ATS forms: content scripts in iframes

**Goal:** If the application form lives in an iframe, the script should run inside that iframe.

**Approach:**
- Set `content_scripts[].all_frames = true`.

**Acceptance tests:**
- On a company careers page embedding `boards.greenhouse.io` / `jobs.lever.co` in an iframe, autofill runs inside the iframe.

### PRIORITY 5 — Veteran dropdown robustness

**Goal:** Improve “Veteran Status” selection success.

**Approach options (pick 1–2, minimal risk):**
- Add small synonym normalization for stored values (e.g., “Decline” → “Prefer not to say”).
- If dropdown is a combobox/listbox, always click the best-matching `[role=option]` rather than only setting input value.
- Consider lowering select-option thresholds only for EEO fields (veteran/disability/race/gender).

**Acceptance tests:**
- Vesta veteran dropdown selects the correct value.

---

## 3) Testing Checklist (CL5.2)

### Greenhouse
- [ ] Direct Greenhouse apply page (`boards.greenhouse.io/...`) fills immediately (no waiting for mutation).
- [ ] Greenhouse embedded apply form in a cross-origin iframe fills (requires `all_frames`).
- [ ] Custom questions: authorized-to-work, sponsorship, veteran status, location.

### Lever
- [ ] Direct Lever apply page fills.
- [ ] Lever embedded form (iframe) fills.

### Multi-step / gated flow
- [ ] Egnyte-like “choose language first” flow: after selecting language, either auto-rerun fills, or manual “🚀 AUTOFILL NOW” fills.

### Dropdowns
- [ ] Native `<select>` picks best option.
- [ ] ARIA combobox/listbox picks best option by clicking.
- [ ] Veteran status dropdown chooses correct option.

### Safety / regression
- [ ] Button only appears on ATS-like pages (not on arbitrary `.com` pages).
- [ ] Autofill does not spam-run (throttled; no infinite loops).

---

## 4) Deliverables

- `autofill.js`: reliable start logic + manual button + generic extras pass.
- `manifest.json`: `all_frames: true`.
- Optional follow-up (if needed after test): veteran synonym mapping + stricter dropdown selection paths.
