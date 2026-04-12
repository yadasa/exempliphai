# Obsidian Notes (Exempliphai) — 2026-04-12

This note captures the changes made today to the **Exempliphai** repo, focusing on **Pure AI mode** behavior (proxy-based) and the **website download gating**.

## 1) Pure AI mode: why it never activated

### Symptom
- User had **Pure AI mode enabled** in Settings.
- Autofill logs showed normal deterministic filling (resume upload, skips, selects), but **no**:
  - `exempliphai: Pure AI mapping batch …`
  - `exempliphai: Hybrid mapping candidates …`

### Root cause
In `src/public/contentScripts/autofill.js`, Phase 2 (Hybrid AI / Pure AI) was gated correctly by:
- `smartApplyLastRunForced` (only run on forced user-triggered runs)
- `res.pureAiModeEnabled === true` (pure vs hybrid selection)
- `res.aiMappingEnabled` (AI mapping feature toggle)

But **both** `tryHybridAiMapping` and `tryPureAiMapping` incorrectly required:
- `const apiKey = res['API Key']; if (!apiKey) return;`

This was wrong because the Gemini provider is **proxy-only**.

### Proof (code)
`src/public/contentScripts/providers/gemini.js` routes AI calls through:
- `chrome.runtime.sendMessage({ action: 'AI_PROXY', ... })`

and documents `apiKey` as:
- `// unused (proxy-only)`

So requiring a user-provided API key in the content script prevented Phase 2 from ever running.

## 2) Fix: remove API-key gates, use proxy consistently

### Changes
**Commit:** `d9b2ec3` — `fix: Pure AI + AI fallbacks use proxy (no API key gate)`

Edits in `src/public/contentScripts/autofill.js`:
- Removed the early return that required `res['API Key']` in:
  - `tryHybridAiMapping(form, res)`
  - `tryPureAiMapping(form, res)`
- Updated Tier1 generation calls to no longer pass `apiKey` in options.
- Updated AI dropdown-option fallback logic to no longer require / pass `apiKey`:
  - native `<select>` fallback (`setBestSelectOption` → `_saAiPickBestDropdownOptionText`)
  - react-select fallback (`fillReactSelectKeyboard` → `_saAiPickBestDropdownOptionText`)
  - tracked input select fallback

Result: if `aiMappingEnabled` is true, AI features can run using the proxy without any user API key.

### Optional compatibility patch (not required after d9b2ec3)
**Commit:** `4e3410e` — `fix: allow Pure AI mode to read API Key from local storage`

This merged `chrome.storage.local['API Key']` into the profile object. Kept for backward-compatibility, but Pure AI no longer depends on it.

## 3) When Phase 2 runs (Pure AI vs Hybrid AI)

Phase 2 is intentionally gated to reduce repeated network calls from MutationObserver-driven re-runs.

**Location:** `src/public/contentScripts/autofill.js` inside `autofill(form)`

Conditions:
- Runs only if `smartApplyLastRunForced === true`.
- Chooses:
  - Pure AI if `res.pureAiModeEnabled === true`
  - else Hybrid AI

Notes:
- Workday uses a separate path and returns early in some flows; verify Phase 2 is reachable for the specific ATS branch.
- Pure AI batching:
  - up to 4 batches
  - up to 14 unresolved fields per batch
  - only fills empty, visible, enabled, non-sensitive controls

## 4) Website changes: CTA + /download requires auth

**Commit:** `0dbb77f` — `feat: rename CTA to Get Started and require auth for /download`

### CTA rename
File: `website/LandingPage/exempliphai/src/components/site-header.tsx`
- Renamed header CTA text:
  - From: "Add to Chrome"
  - To: "Get Started"

Link target already points to `/download` via:
- `website/LandingPage/exempliphai/src/config/site-config.ts` → `waitlistUrl: "/download"`

### /download auth guard
File: `website/LandingPage/exempliphai/src/app/download/page.tsx`
- Wrapped the page content with `RequireAuth`.
- Added `"use client"` to allow the client-side auth redirect.

Behavior:
- Visiting `/download` while logged out redirects to `/login`.

## 5) Quick verification checklist

### Pure AI mode
1. Reload extension.
2. On Lever/Greenhouse, use **Autofill Now** (forced run) or the equivalent forced trigger.
3. Confirm console contains one of:
   - `exempliphai: Pure AI mapping batch` (pure)
   - `exempliphai: Hybrid mapping candidates` (hybrid)

If neither appears:
- Confirm `smartApplyLastRunForced` is being set to true in the click path.
- Confirm `res.aiMappingEnabled` and `res.pureAiModeEnabled` are true in `chrome.storage.sync`.

### Website
1. Header button text shows **Get Started**.
2. `/download` redirects to `/login` when logged out.
