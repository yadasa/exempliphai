# PLAN.md — CL5.4 Greenhouse Static Fixture Reliability + Module/Test Harness

**Date:** 2026-03-06  
**Primary target:** Greenhouse (starting with `examples/greenhouse/goguardian.html`)  
**Scope (code):** `src/public/contentScripts/autofill.js`, `src/public/contentScripts/utils.js`, `src/public/manifest.json`  
**Scope (verification):** add/upgrade a reproducible static harness for Greenhouse fixtures (Playwright or a module-capable HTML harness).

---

## 0) What we observed (static test + real-world symptoms)

**Fixture:** `examples/greenhouse/goguardian.html` (GoGuardian on Greenhouse)

Reported/static symptoms:
- **EEO fields** (Gender / Hispanic/Latino / Veteran / Disability) are generally fillable.
- **Basics missed:** First Name / Last Name / Email (and sometimes the **“Autofill Now”** button is missing).
- **Script execution quirk:** expected `console.log(...)` output is absent in the static test context.

Additional (from fixture comment history):
- Resume incorrectly uploaded to **Cover Letter** when a cover letter uploader exists.
- On some Greenhouse pages, autofill appears to run only after user interaction.

---

## 1) Diagnosis (most likely root causes)

### 1.1 Bootstrap is tied too tightly to `window.load`
Current behavior relies on initialization inside a `window.addEventListener('load', ...)` handler.

That is brittle in two important scenarios:
1) **Static harnesses** that inject/evaluate scripts *after* the page is already loaded → the `load` handler never fires → no logs, no button, no autofill.
2) **Fast cached navigations / BFCache / SPA-style transitions** where our content script executes after `load` (or the page uses `pageshow`) → same outcome.

This directly explains “console logs absent” and “Autofill Now button missing” when the page is already in a loaded state.

### 1.2 Greenhouse “basics” can be missing due to data/format variance
Even if `inputQuery()` can find the elements (`#first_name`, `#last_name`, `#email`), we still skip fill when storage is missing:
- Users often store **Full Name** but not **First Name** / **Last Name** separately.
- Some profiles store **Email Address** instead of **Email**.

Because `processFields()` does `fillValue = res[param]; if (!fillValue) continue;`, *format variance becomes a hard skip*.

### 1.3 Greenhouse React-Select comboboxes often lack `aria-controls`
Greenhouse uses react-select style combobox inputs (`role="combobox"`) where:
- options/listbox are created dynamically
- the input may not expose `aria-controls`/`aria-owns` (but does expose `aria-describedby` like `react-select-<id>-placeholder ...`)

If we only set the input’s text value without selecting an option, we can:
- fail to actually select
- accidentally “type” into unrelated custom questions when matching is weak

### 1.4 Form detection and platform detection should not depend solely on hostname
Static fixtures load as `file:///...` (hostname empty), and many real pages embed ATS flows in iframes or alternate hostnames.

We need **DOM-marker-based detection** (Greenhouse-specific selectors) in addition to hostname matching.

---

## 2) CL5.4 Goals

1) **Bootstrap always runs** (static harness, cached loads, BFCache): button + observers + autofill.
2) **Greenhouse basics fill reliably** even when storage only contains “Full Name” (derive first/last) or alternate key names.
3) **React-select dropdowns select actual options** (not just set input value).
4) **Autofill Now button appears on Greenhouse job pages** even before the application form is visible.
5) **Static verification harness** can reproduce results deterministically and capture console output.

---

## 3) Proposed CL5.4 Changes (Implementation Plan)

### PRIORITY A — Fix initialization so it runs in all contexts

**Change:** Replace “load-only” bootstrap with an idempotent `bootSmartApply()` that runs:
- immediately if `document.readyState !== 'loading'`
- otherwise on `DOMContentLoaded`
- additionally on `pageshow` (BFCache restore)

**Requirements:**
- guard against double-init
- ensure `injectAutofillNowButton()` and `awaitForm()` are started from this bootstrap

**Acceptance:**
- In a harness that injects scripts after load, logs appear and the button is injected.

---

### PRIORITY B — Broader form selectors + DOM-based platform detection

**Change:** Expand “application root” selectors to match Greenhouse reliably:
- `#application-form`, `#application_form`, `.application--form`, `form.application--form`, `form[data-discover="true"]`
- container hints: `.application--container`, `.application--questions`, `.eeoc__container`

**Change:** Add DOM-marker-based platform detection:
- `isGreenhouseDom()` true if we see `form.application--form` OR `#application-form` OR `.eeoc__container`
- then treat platform key as `greenhouse` even if hostname does not include “greenhouse” (static fixture + embeds)

**Acceptance:**
- `examples/greenhouse/goguardian.html` loaded as `file://` is still recognized as Greenhouse.

---

### PRIORITY C — Input matching (inputQuery) beef-up for Greenhouse basics

**Change:** Make `inputQuery()` smarter and safer:

1) **Prefer visible, enabled, meaningful inputs**
   - skip `[type=hidden]`, `tabindex="-1"` + `aria-hidden="true"`, disabled inputs
   - this avoids matching react-select internal “requiredInput” nodes

2) **Special-case standard autocompletes** (Greenhouse uses these on basics)
   - if searching first name → match `autocomplete="given-name"`
   - last name → `autocomplete="family-name"`
   - email → `autocomplete="email"`
   - phone → `type="tel"` or `autocomplete` containing `tel`

3) **Greenhouse-specific attribute cues**
   - recognize Greenhouse’s id patterns: `first_name`, `last_name`, `email`, `phone`, `question_####` (use label text heavily)

4) **Tighten label-text fallback**
   - only use “container text” if it’s short and looks like a single prompt
   - avoid using huge `parent.textContent` blobs that include multiple questions

**Acceptance:**
- On GoGuardian fixture, `inputQuery('first_name')`, `inputQuery('last_name')`, `inputQuery('email')` each resolves to the correct input.

---

### PRIORITY D — Data normalization to handle format variances (Full Name → First/Last, Email Address → Email)

**Change:** After reading storage, normalize into a working copy `res2`:
- If `First Name` or `Last Name` missing but `Full Name` exists → split full name:
  - simple rule: first token → first name, last token → last name
  - keep middle tokens ignored or set to Middle Name when present
- If `Email` missing and `Email Address` exists → copy
- (Optional) same for phone: `Phone` ← `Phone Number`

**Acceptance:**
- With storage containing only Full Name + Email Address, Greenhouse basics still fill.

---

### PRIORITY E — React-select option selection (Greenhouse + custom questions)

**Change:** Add a Greenhouse/react-select selection path for comboboxes:
- Detect react-select by `role="combobox"` AND `aria-describedby` containing `react-select-*-placeholder`
- Derive listbox id as:
  - `react-select-<input.id>-listbox` OR
  - parse the `react-select-...-placeholder` token and replace `-placeholder` → `-listbox`
- Click to open, wait briefly, then:
  - collect `[role="option"]` under the listbox
  - choose best option by `matchScore()` across expanded candidates
  - click the best option

**Safety:**
- If no listbox/options appear or best score is weak, **do not** force text into the combobox.

**Acceptance:**
- EEO dropdowns select real options (not just set input value).
- Custom questions like “authorized to work” / “sponsorship” select Yes/No correctly when present.

---

### PRIORITY F — “Autofill Now” button: always-on for known ATS + pre-form pages

**Change:** Ensure the button appears when ANY of these signals exist:
- hostname matches a known ATS domain (greenhouse/lever/workday/etc.) OR
- DOM contains strong ATS markers OR
- page contains an `Apply` button consistent with Greenhouse job pages

**Behavior:**
- button injection should not be gated behind `load` only (see Priority A)
- clicking the button uses `force: true` and may scroll (optional) only on user action

**Acceptance:**
- Button appears on Greenhouse job pages even if the application form loads after clicking “Apply”.

---

### PRIORITY G — Timing: multi-pass autofill for async field creation

**Change:** When a form is detected, schedule a small number of passes:
- pass 1: immediate
- pass 2: +300ms
- pass 3: +1200ms

Each pass:
- fills only fields still empty (unless `force`)
- re-attempts react-select selection

**Acceptance:**
- Fields that appear late (after JS renders) still fill without requiring user interaction.

---

### PRIORITY H — Static evaluation harness (fix “console logs absent” & make failures reproducible)

**Goal:** A deterministic way to run the module content scripts against fixtures.

**Option 1 (recommended): Playwright route-fulfill**
- Create a small harness script that:
  - opens `https://job-boards.greenhouse.io/goguardian/jobs/4624419006`
  - fulfills the response with the local `examples/greenhouse/goguardian.html`
  - injects the built content script modules (or loads an HTML harness that imports them)
  - stubs `chrome.storage.sync.get` / `chrome.storage.local.get` with deterministic fixture data
  - captures console logs and asserts expected fields filled

**Option 2: Module HTML harness**
- A `_verify/greenhouse_harness.html` that uses `<script type="module">` to import and run boot logic.

**Acceptance:**
- Harness prints SmartApply logs.
- Harness can assert that First/Last/Email are filled and that EEO selects resolve.

---

## 4) Specific fixes to include while touching Greenhouse

1) **Stop uploading Resume into Cover Letter**
   - In `fields.greenhouse`, set `cover_letter` / `cover letter` mapping to `null` (or introduce a dedicated “Cover Letter” storage key later).

2) **Do not override user edits during auto/mutation runs**
   - mark “touched” fields on `input/change` events
   - only override touched fields on explicit manual button (`force: true`)

---

## 5) Acceptance Checklist (CL5.4)

### Greenhouse (GoGuardian fixture)
- [ ] SmartApply logs appear even when scripts load after page load.
- [ ] “🚀 AUTOFILL NOW” button appears.
- [ ] First Name / Last Name / Email fill.
- [ ] EEO selects choose real options.
- [ ] Custom questions do not get polluted by unrelated values.
- [ ] Resume is NOT uploaded to Cover Letter.

### Regression / Safety
- [ ] No infinite reruns (throttle + fingerprint).
- [ ] Auto runs do not fight the user (touched-field protection).

---

## 6) Deliverables

- Updated CL5.4 plan (this file).
- Follow-up CL5.4 implementation should include:
  - bootstrap refactor (Priority A)
  - Greenhouse DOM/platform detection + react-select option selection (Priorities B/E)
  - data normalization (Priority D)
  - verification harness (Priority H)
