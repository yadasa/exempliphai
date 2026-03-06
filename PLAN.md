# PLAN.md — CL4.6 Autofill Gap Analysis & Remediation Plan

**Date:** 2026-03-06  
**Scope:** `autofill.js`, `utils.js` (fields), `workday.js` — Fix missed fields on generic/custom ATS sites  
**Reported misses:** Veteran Status, "Are you legally authorized to work in US for [Company]?", sponsorship/visa, "What is your location?" dropdowns  

---

## 1. Root Cause Analysis

### 1.1 `inputQuery()` — Label Resolution Gaps

**Current behavior** (autofill.js L172-210): Only checks element *attributes* (`id`, `name`, `placeholder`, `aria-label`, `aria-labelledby`, `data-qa`, `data-automation-id`, `autocomplete`, `value`). Never resolves the **associated `<label>` text** or **visible question text** above/near the field.

**Critical gap:** On generic ATS sites (Greenhouse custom questions, Quantum Metric via Lever/Greenhouse, BambooHR, Ashby, etc.), the field's `id` is often a UUID like `question_12345678` and the human-readable question is in a `<label for="question_12345678">` or a sibling `<span>`. The current `inputQuery` will **never match** these because:

1. **`aria-labelledby` is read as a raw attribute** — it contains *ID references*, not text. The code does `normalizeText(node.getAttribute("aria-labelledby"))` which normalizes the ID string, not the label text it points to.
2. **No `<label for="...">` lookup** — The visible question "Are you legally authorized to work in the US for Quantum Metric?" lives in a `<label>` that's never consulted during matching.
3. **No parent/sibling text crawl** — Common pattern: `<div class="field"><label>Question text</label><select id="uuid">...</select></div>`. The select's attributes contain nothing useful.

**Impact:** This is the **#1 reason** autofill misses on generic sites. The fields exist, the data is stored, but `inputQuery` can't find the elements.

### 1.2 `fields.generic` — Missing Question Variants

**Current keys** for work auth questions:
- `"authorized"` → "Legally Authorized to Work"  
- `"sponsorship"` → "Requires Sponsorship"

**What real sites ask (verbatim):**
- "Are you legally authorized to work in the United States for Quantum Metric?"
- "Are you legally authorized to work in the US?"
- "Will you now or in the future require visa sponsorship?"
- "Do you require visa sponsorship to work in the United States?"
- "Will you now, or in the future, require sponsorship for employment visa status?"
- "What is your current work authorization status?"

The word `"authorized"` does appear in some of these, but after normalization the `inputQuery` attribute check won't find it because **these questions are in `<label>` text, not in element attributes** (see 1.1).

**Missing generic keys entirely:**
- `"veteran"` — Generic has NO veteran-related key. Greenhouse has `veteran_status` but generic doesn't.
- `"visa"` — No visa-related key
- `"work authorization"` — Missing compound phrase
- `"location"` as a broad matcher (only `"city"` exists, but Greenhouse custom questions often say "What is your location?" or "Location (City, State)")
- `"hispanic"` / `"latino"` — Missing from generic
- `"disability"` — Missing from generic
- `"state"` / `"region"` — Missing from generic
- `"ethnicity"` — Missing from generic

### 1.3 `processFields()` — Dropdown/Radio Handling Edge Cases

**Current approach:**
- Native `<select>`: handled by `setBestSelectOption()` (score-based matching, threshold 60) ✓
- Native `<input type="radio">`: handled by `clickBestRadioInGroup()` (threshold 40) ✓
- Custom dropdowns: Only handles `.select__control--outside-label` pattern (Greenhouse's React Select) ✗

**Missing:**
1. **React `onChange` synthetic events** — `setNativeValue()` dispatches native `change`/`input` events but React 16+ uses synthetic events from a delegated listener. The `_valueTracker` hack is present but references undefined `previousValue` (bug at utils.js L~270: `tracker.setValue(previousValue)` — `previousValue` is never declared).
2. **Custom `<div role="listbox">` dropdowns** — Ashby, BambooHR, and many custom ATS use ARIA listbox patterns, not native `<select>`.
3. **`<textarea>` fields** — `inputQuery` only searches `input, select` — misses `<textarea>` entirely for long-form answers.
4. **Iframes** — Content scripts run in `ISOLATED` world. Cross-origin iframes (e.g., Greenhouse embedded in company site) can't be reached. Same-origin iframes need explicit `document.querySelector('iframe')?.contentDocument` traversal. Currently not handled.

### 1.4 Site Detection

**Current `awaitForm()` logic:** Iterates `fields` keys checking `window.location.hostname.includes(jobForm)`. This works for `greenhouse`, `lever`, `workday`, etc.

**Gap:** There's no `quantummetric` key and no need for one — Quantum Metric likely uses Greenhouse or Lever (embedded or linked). The `generic` fallback should handle it, but since `generic` falls through only when no specific match is found, and the manifest already matches `https://*.com/*`, the real issue is that `generic` fields + `inputQuery` aren't powerful enough.

---

## 2. Remediation Plan — Specific Code Changes

### 2.1 PRIORITY 1: `inputQuery()` — Add Label Text Resolution

**File:** `autofill.js`  
**Function:** `inputQuery(jobParam, form)`

Add Pass 1.5 between existing Pass 1 (attribute match) and Pass 2 (select option match): **resolve associated label/question text**.

```javascript
// === PROPOSED DIFF: autofill.js inputQuery() ===

// After existing Pass 1 (attribute match), before Pass 2:

// Pass 1.5: match on associated <label> text, aria-labelledby resolved text,
// and closest visible text (parent traversal).
function getLabelText(node) {
  const texts = [];

  // 1. <label for="id">
  const id = node.id;
  if (id) {
    const lbl = node.ownerDocument.querySelector(
      `label[for="${CSS?.escape ? CSS.escape(id) : id}"]`
    );
    if (lbl) texts.push(lbl.textContent);
  }

  // 2. Wrapping <label>
  const parentLabel = node.closest?.("label");
  if (parentLabel) texts.push(parentLabel.textContent);

  // 3. aria-labelledby → resolve ID refs to text
  const labelledBy = node.getAttribute?.("aria-labelledby");
  if (labelledBy) {
    const doc = node.ownerDocument || document;
    const refTexts = labelledBy
      .split(/\s+/)
      .map((refId) => doc.getElementById(refId)?.textContent || "")
      .filter(Boolean);
    if (refTexts.length) texts.push(refTexts.join(" "));
  }

  // 4. Closest container text (fieldset legend, .field wrapper, etc.)
  //    Walk up max 3 levels looking for short-ish text.
  let parent = node.parentElement;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    if (parent.tagName === "FORM") break;
    // Check <legend> inside <fieldset>
    if (parent.tagName === "FIELDSET") {
      const legend = parent.querySelector("legend");
      if (legend) texts.push(legend.textContent);
    }
    // Check direct text of parent (but not too long, to avoid matching entire form)
    const directText = parent.textContent || "";
    if (directText.length > 3 && directText.length < 300) {
      texts.push(directText);
      break; // Stop at first reasonable container
    }
  }

  return texts;
}

// In inputQuery, after Pass 1 returns null:
if (!el) {
  el = nodes.find((node) => {
    const labelTexts = getLabelText(node);
    return labelTexts.some((txt) => {
      const norm = normalizeText(txt);
      if (!norm) return false;
      // Check if the normalized label contains our search param
      if (norm.includes(normalizedParam)) {
        // Same "address" vs "email address" guard
        if (normalizedParam === "address" && norm.includes("email")) return false;
        return true;
      }
      return false;
    });
  });
}
```

**Also add `textarea` to the query selector:**
```javascript
// CHANGE:
const nodes = Array.from(form.querySelectorAll("input, select"));
// TO:
const nodes = Array.from(form.querySelectorAll("input, select, textarea"));
```

### 2.2 PRIORITY 2: `fields.generic` — Add Missing Keys

**File:** `utils.js`, `fields.generic` object

```javascript
// === PROPOSED ADDITIONS to fields.generic ===

// --- Work Authorization (expanded variants) ---
"legally authorized": "Legally Authorized to Work",
"work authorization": "Legally Authorized to Work",
"authorized to work": "Legally Authorized to Work",
"legal right to work": "Legally Authorized to Work",
"eligible to work": "Legally Authorized to Work",
"right to work": "Legally Authorized to Work",

// --- Visa / Sponsorship (expanded variants) ---
"visa sponsorship": "Requires Sponsorship",
"require sponsorship": "Requires Sponsorship",
"require visa": "Requires Sponsorship",
"immigration sponsorship": "Requires Sponsorship",
"work visa": "Requires Sponsorship",
"employment visa": "Requires Sponsorship",
"future sponsorship": "Requires Sponsorship",

// --- Veteran Status (MISSING from generic entirely) ---
"veteran": "Veteran Status",
"veteran status": "Veteran Status",
"protected veteran": "Veteran Status",
"military": "Veteran Status",
"military service": "Veteran Status",
"armed forces": "Veteran Status",

// --- Disability (MISSING from generic entirely) ---
"disability": "Disability Status",
"disability status": "Disability Status",
"disabled": "Disability Status",

// --- Race/Ethnicity (MISSING from generic) ---
"race": "Race",
"ethnicity": "Race",
"ethnic": "Race",
"hispanic": "Hispanic/Latino",
"latino": "Hispanic/Latino",
"latina": "Hispanic/Latino",

// --- Gender (MISSING from generic) ---
"gender": "Gender",
"sex": "Gender",

// --- Location (expanded — the "What is your location?" issue) ---
"location": "Location (City)",
"your location": "Location (City)",
"current location": "Location (City)",
"where are you located": "Location (City)",
"city state": "Location (City)",
"state": "Location (State/Region)",
"region": "Location (State/Region)",
"province": "Location (State/Region)",
```

**Note on key ordering:** Some of these are substrings of each other (e.g., `"veteran"` vs `"veteran status"`). The `inputQuery` finds the *first* matching node, and `processFields` iterates the entire fieldMap, so order doesn't affect correctness — each key independently tries to find and fill a field. But longer/more-specific keys should come first to avoid `"state"` matching a "Veteran Status" label before `"veteran status"` gets a chance. We should **reorder** generic keys so more-specific keys appear before shorter ones.

### 2.3 PRIORITY 3: Fix `setNativeValue()` Bug — Undefined `previousValue`

**File:** `utils.js`, `setNativeValue()` function

```javascript
// BUG: Line ~270 in setNativeValue:
const tracker = el._valueTracker;
if (tracker) {
  tracker.setValue(previousValue);  // ← previousValue is NEVER DECLARED
}

// FIX:
const tracker = el._valueTracker;
if (tracker) {
  tracker.setValue(el.value);  // Save current value as "previous" so React detects the change
}
```

This is why React-based ATS forms sometimes don't register the fill — React's `_valueTracker` compares old vs new value, but since `previousValue` is undefined, it throws silently and React never sees the change.

### 2.4 PRIORITY 4: Add `inputQuery` Pass 3 — Fuzzy Label Matching

For long-form questions like "Are you legally authorized to work in the United States for Quantum Metric?", exact substring matching on `"authorized"` works — but we should add **token-overlap scoring** as a final fallback using the existing `matchScore()` function.

```javascript
// === PROPOSED: Pass 3 in inputQuery — scored label matching ===

// Pass 3: fuzzy match on label text using matchScore()
if (!el) {
  let bestMatch = { el: null, score: 0 };
  for (const node of nodes) {
    const labelTexts = getLabelText(node);
    for (const txt of labelTexts) {
      const score = matchScore(normalizedParam, txt);
      if (score > bestMatch.score) {
        bestMatch = { el: node, score };
      }
    }
  }
  // Only accept fuzzy matches above a reasonable threshold
  if (bestMatch.score >= 50) {
    el = bestMatch.el;
  }
}
```

### 2.5 PRIORITY 5: Custom Dropdown Handling (ARIA Listbox Pattern)

**File:** `autofill.js`, `processFields()`

After the native `<select>` and radio handlers, add support for ARIA listbox patterns:

```javascript
// === PROPOSED: After radio handling in processFields ===

// Custom ARIA dropdown: <div role="listbox"> or <div role="combobox">
// Common in Ashby, BambooHR, custom React forms
if (!inputElement.type || inputElement.getAttribute?.("role") === "combobox") {
  // Try clicking to open, then matching options
  const listboxId = inputElement.getAttribute?.("aria-owns") ||
                    inputElement.getAttribute?.("aria-controls");
  if (listboxId) {
    inputElement.click();
    await sleep(delays.short);
    const listbox = document.getElementById(listboxId);
    if (listbox) {
      const options = Array.from(listbox.querySelectorAll('[role="option"]'));
      let bestOpt = { el: null, score: 0 };
      for (const opt of options) {
        const score = matchScore(fillValue, opt.textContent);
        if (score > bestOpt.score) bestOpt = { el: opt, score };
      }
      if (bestOpt.el && bestOpt.score >= 50) {
        bestOpt.el.click();
        await sleep(delays.short);
        continue;
      }
    }
  }
}
```

### 2.6 PRIORITY 6: Extend `inputQuery` to Search Textareas

Already covered in 2.1 (change `"input, select"` → `"input, select, textarea"`), but also need to handle textarea in `processFields`:

```javascript
// In processFields, after setNativeValue(inputElement, fillValue):
// Textareas don't need select/radio/dropdown handling, so skip those blocks.
if (inputElement instanceof HTMLTextAreaElement) {
  // Already filled by setNativeValue, just dispatch events
  dispatchInputAndChange(inputElement);
  continue;
}
```

### 2.7 PRIORITY 7: React Synthetic Event Compatibility

**File:** `utils.js`, `setNativeValue()`

Improve React compatibility by using the native setter directly:

```javascript
// === PROPOSED: Enhanced setNativeValue for React ===
function setNativeValue(el, value) {
  if (el.type === "checkbox" || el.type === "radio") {
    // ... existing checkbox/radio logic (unchanged) ...
  } else if (el instanceof HTMLSelectElement) {
    // ... existing select logic (unchanged) ...
  } else {
    // Use Object.getOwnPropertyDescriptor to bypass React's synthetic value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    const setter = el instanceof HTMLTextAreaElement
      ? nativeTextareaValueSetter
      : nativeInputValueSetter;

    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
  }

  // Fix: save current value before setting new one
  const tracker = el._valueTracker;
  if (tracker) {
    tracker.setValue('');  // Force React to see a "change"
  }

  el.setAttribute("value", value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
```

---

## 3. Site-Specific: Quantum Metric

**Analysis:** Quantum Metric's careers page at `quantummetric.com/careers` links to job postings. Based on common patterns for companies of this size, they likely use **Greenhouse** (`boards.greenhouse.io` or embedded) or **Lever** (`jobs.lever.co`).

**If Greenhouse embedded:** The `https://*.com/*` manifest match already covers `quantummetric.com`. If the application form is in an iframe from `boards.greenhouse.io`, the content script runs in the iframe independently (matching `https://boards.greenhouse.io/*`). The `greenhouse` field config handles standard fields, but **custom questions** (work auth, veteran, etc.) are custom Greenhouse fields with UUID-based IDs — which is exactly the gap described in 1.1.

**If Quantum Metric uses their own ATS / custom form:** The generic fallback kicks in. With the fixes in 2.1-2.4, it should handle the reported field types.

**Recommendation:** No `quantummetric`-specific field block needed. The generic improvements cover this. If later we find a unique ATS pattern, we can add:

```javascript
// Only if needed later:
quantummetric: {
  // Custom overrides here
},
```

---

## 4. Additional Edge Cases Identified During Audit

### 4.1 `processFields` Bug: Incorrect `if` Condition

```javascript
// BUG (autofill.js, processFields):
if (param === "Gender" || "Location (City)") useLongDelay = true;
// This ALWAYS evaluates to true because "Location (City)" is truthy.

// FIX:
if (param === "Gender" || param === "Location (City)") useLongDelay = true;
```

### 4.2 Duplicate Keys in `fields.generic`

```javascript
// utils.js — these are duplicated (second overwrites first):
"linkedin": "LinkedIn",  // line ~1
"linkedin": "LinkedIn",  // line ~2 (duplicate)
"github": "Github",      // same
"start date": "Date Available",  // overwrites earlier "start date": "Start Date Month"
"cover letter": "Resume",        // overwrites earlier "cover letter": null
```

Fix: Remove duplicates. For `"start date"`, keep `"Start Date Month"` and use `"availability"` / `"date available"` for the other.

### 4.3 Shadow DOM

**Status:** Not currently handled. Shadow DOM roots (e.g., Ashby's web components) are invisible to `querySelectorAll`. However, adding shadow DOM traversal is complex and low priority — most ATS platforms don't use shadow DOM for form inputs.

**Future enhancement (not in this sprint):**
```javascript
function deepQueryAll(root, selector) {
  const results = [...root.querySelectorAll(selector)];
  const shadows = root.querySelectorAll('*');
  for (const el of shadows) {
    if (el.shadowRoot) {
      results.push(...deepQueryAll(el.shadowRoot, selector));
    }
  }
  return results;
}
```

### 4.4 Same-Origin Iframe Traversal

**Low priority.** Most ATS embeds (Greenhouse, Lever) load the form as a separate navigation, not an iframe. When they do use iframes, it's typically cross-origin, which content scripts handle independently via manifest matches.

---

## 5. Implementation Order & File Map

| Priority | File | Function/Section | Change | Effort |
|----------|------|-------------------|--------|--------|
| **P1** | `autofill.js` | `inputQuery()` | Add `getLabelText()` + Pass 1.5 label resolution | Medium |
| **P1** | `autofill.js` | `inputQuery()` | Change selector to include `textarea` | Trivial |
| **P2** | `utils.js` | `fields.generic` | Add ~30 new key→value mappings | Small |
| **P2** | `utils.js` | `fields.generic` | Remove duplicates, reorder specific-first | Small |
| **P3** | `utils.js` | `setNativeValue()` | Fix `previousValue` bug → use `el.value` or `''` | Trivial |
| **P3** | `utils.js` | `setNativeValue()` | Use native prototype setter for React compat | Small |
| **P4** | `autofill.js` | `inputQuery()` | Add Pass 3 fuzzy label matching | Small |
| **P5** | `autofill.js` | `processFields()` | ARIA listbox/combobox dropdown support | Medium |
| **P5** | `autofill.js` | `processFields()` | Textarea early-continue path | Trivial |
| **P6** | `autofill.js` | `processFields()` | Fix `param === "Gender" \|\| "Location"` bug | Trivial |

---

## 6. Testing Checklist

After implementation, verify on:

- [ ] **Greenhouse** (standard fields + custom questions with UUID IDs)
- [ ] **Greenhouse** custom questions: "Are you legally authorized...", veteran status dropdown
- [ ] **Lever** application form
- [ ] **Generic site** with `<label for="...">` pattern
- [ ] **Workday** (should be unaffected — separate code path)
- [ ] **React-based form** — verify `_valueTracker` fix works
- [ ] **Native `<select>` dropdown** with work auth Yes/No
- [ ] **Radio button group** for veteran status
- [ ] **Location dropdown** matching "What is your location?"
- [ ] **Long-form textarea** (cover letter, additional info)

---

## 7. Summary

The **root cause** of autofill misses is primarily `inputQuery()` not looking at `<label>` text or resolving `aria-labelledby` references. Secondary causes are missing field keys in `fields.generic` and a real bug in `setNativeValue` (`previousValue` undefined). The proposed changes are surgical — no architectural rewrites — and should resolve the reported Quantum Metric issues plus similar gaps across all generic ATS sites.

**Status:** PLAN-READY for CL5.2 execution.
