# ExempliPhai Autofill — Full Analysis & Implementation Plan

**Date:** 2026-03-08
**Scope:** `src/public/contentScripts/autofill.js`, `src/public/contentScripts/utils.js`, `src/public/manifest.json`

---

## 1. PLAN.md Summary

The existing `PLAN.md` (CL5.4) correctly identifies:
- Bootstrap tied to `window.load` (never fires on late inject / cached loads)
- Greenhouse basics missed (First/Last/Email) when storage has "Full Name" not split
- React-select comboboxes not properly handled (text pasted, not option selected)
- DOM-based platform detection missing (only hostname matching)
- Multi-pass autofill needed for async-rendered fields
- Resume uploaded to cover letter field
- `scrollToTop()` called unconditionally after every autofill

**Status:** Plan written but NOT implemented yet. All priorities A–H remain open.

---

## 2. Error Catalog by Example File

### Greenhouse — GoGuardian (`examples/greenhouse/goguardian.html`)
| Error | Root Cause |
|---|---|
| Forms don't autofill until double-click on a field | Bootstrap only fires on `window.load`; on real GH pages, scripts may miss the event |
| Race ("Black or African American") pasted into custom question fields with fixed options (Are you a former educator? etc.) | `inputQuery` fuzzy-matches Race value to unrelated fields; no dropdown option validation |
| Resume uploaded to Cover Letter file input | `cover_letter`/`cover letter` mapped to `"Resume"` in greenhouse config |
| Autofill scrolls to top, prevents manual correction | `scrollToTop()` called after every autofill run including mutation-triggered re-runs |
| Autofill NOW button missing | Button only injected inside `window.load` handler |

### Greenhouse — Axon (`examples/greenhouse/axon.html`)
| Error | Root Cause |
|---|---|
| Same double-click / late-init issue | Same bootstrap bug |
| Resume → Cover Letter duplication | Same `cover_letter: "Resume"` mapping |
| Race in wrong fixed-option dropdowns (Are you a fugitive? etc.) | Same fuzzy matching leaks Race into unrelated questions |
| Veteran status pasted into unrelated Yes/No dropdowns (dishonorable discharge?) | Fuzzy match on "veteran" hits any question containing the word |
| "Job notice period" → "ACKNOWLEDGMENT" dropdown (only option: "acknowledge") | `notice` key fuzzy-matches "acknowledgment"; setBestSelectOption picks it since it's the only option |
| Checkbox "Federal Firearms Licensee" not ticked | No checkbox-specific fill logic for custom questions |
| Button missing | Same bootstrap bug |

### Greenhouse — Xapo (`examples/greenhouse/xapo.html`)
| Error | Root Cause |
|---|---|
| Same double-click / late-init issue | Bootstrap bug |
| Resume → Cover Letter duplication | Same mapping bug |
| Race in "business domains" and "country of residence" dropdowns | Fuzzy matching; Race value matches too broadly |
| Skills list dumped into "brief justification" textarea | `Skills` param maps to a textarea; the text match on "skills" hits this free-text question |
| Button missing | Bootstrap bug |

### Greenhouse — PlanetScale (`examples/greenhouse/planetscale.html`)
| Error | Root Cause |
|---|---|
| Same double-click / late-init issue | Bootstrap bug |
| Resume → Cover Letter duplication | Same mapping bug |
| Button missing | Bootstrap bug |
| (Cleanest GH example — fewer custom questions) | — |

### Lever — Vesta (`examples/lever/vesta.html`)
| Error | Root Cause |
|---|---|
| Veteran status not filled | `eeo[veteran]` key exists in lever config, but EEO `<select>` for veteran uses `name="eeo[veteran]"` with options like "I am a veteran" / "Decline to self-identify"; user's stored "I don't wish to answer" doesn't match any option above the 60-score threshold |
| Location autocomplete: pasting text instead of selecting from dropdown | Lever uses `location-input` with dynamic dropdown results; script just sets value, doesn't simulate typing + selecting from dropdown |

### Lever — QuantumMetric (`examples/lever/quamtummetric.html`)
| Error | Root Cause |
|---|---|
| "No" answered to "Are you legally authorized..." when answer should be "Yes" | The `authorized` key in the generic config maps to `"Legally Authorized to Work"`. User's stored answer for this is "Yes" but the field is a radio with `value="yes"`. However, the question asks "authorized to work for Quantum Metric" — the extension finds the radio group correctly but `inputQuery('authorized')` might first match the wrong field, or the stored value mapping is inverted |
| No answer to "require sponsorship" visa question | `sponsorship` maps to `"Requires Sponsorship"` which is stored as "No" (user doesn't need sponsorship), but the radio value is literally "no". The issue is `inputQuery` may not find this radio because the field name is a complex `cards[...][field1]` path |
| "What is your location?" → "Sao Tome and Principe" instead of "United States" | Location stored as "houston, tx" (city). The `<select>` contains country names. `setBestSelectOption` fuzzy-matches "houston tx" against all countries; "Sao Tome" scores higher than "United States" due to token overlap coincidence (the `ST` in Sao Tome's value matches) |
| Veteran status not filled | Same threshold issue as Vesta |

### Lever — Onit (`examples/lever/onit.html`)
| Error | Root Cause |
|---|---|
| Same "No" to authorized question | Same issue as QuantumMetric |
| Veteran status not filled | Same |
| "What are your base salary expectations?" not answered | `salary` key maps to `"Expected Salary"` — user may not have stored this field |
| Location → "Sao Tome and Principe" | Same location dropdown mismatch |

### Builtin — Rubrik (`examples/builtin/rubrik.html`)
| Error | Root Cause |
|---|---|
| Didn't answer job title, race, gender, authorized, current/past Rubrik employee, legal name | This is a Greenhouse-hosted page (`rubrik.com` → GH embed) but hostname is `rubrik.com`, not `greenhouse.io`. No platform detection by DOM markers, so GH-specific selectors aren't tried. Generic pass may not find these custom fields |
| Resume upload error | May be GH embedded iframe; cross-origin prevents file upload |

### General Errors (`examples/general errors.txt`)
| Error | Root Cause |
|---|---|
| Force scrolling to top prevents reviewing/submitting | `scrollToTop()` in processFields |
| Location autocomplete: pasting instead of selecting from dropdown | No autocomplete-aware fill logic |
| Extension forces text over dropdowns with fixed options | No pre-fill validation that the value exists as an option |
| Manual autofill button doesn't appear | Bootstrap tied to `window.load` |

---

## 3. Root Cause Patterns (Consolidated)

| # | Pattern | Affected | Impact |
|---|---|---|---|
| **P1** | `scrollToTop()` called unconditionally after autofill | ALL sites | User can't review, scroll, or click submit; prevents manual corrections |
| **P2** | `cover_letter` / `cover letter` mapped to `"Resume"` in greenhouse config | All Greenhouse | Resume uploaded twice (to resume AND cover letter inputs) |
| **P3** | Bootstrap only on `window.load` | ALL sites | Button never appears; autofill never runs on cached/late loads |
| **P4** | No dropdown option validation before fill | ALL sites | Extension forces text into dropdowns that only accept fixed options; race/veteran/notice data ends up in wrong fields |
| **P5** | `inputQuery` fuzzy matching too loose for custom questions | Greenhouse, Lever | Race/veteran/skills/notice values leak into unrelated Yes/No or fixed-option questions |
| **P6** | Location autocomplete not handled (paste vs select) | Lever (all) | Pasted city text rejected by form; prevents submission |
| **P7** | Lever EEO dropdown location uses country codes, but stored value is city name | Lever | "houston, tx" matched against country dropdown → picks wrong country |
| **P8** | "Legally Authorized" answer logic inverted/confused | Lever | `authorized` question semantics differ from stored answer semantics |
| **P9** | Veteran status matching below threshold | Lever | Stored "I don't wish to answer" doesn't fuzzy-match "Decline to self-identify" at ≥60 |
| **P10** | No DOM-based ATS detection | Rubrik, embeds | Sites embedding GH/Lever via custom domain aren't recognized |
| **P11** | No Full Name → First/Last splitting | Greenhouse | Basics missed when only Full Name stored |
| **P12** | React-select comboboxes not properly handled | Greenhouse | EEO selects get text pasted instead of option clicked |

---

## 4. Implementation Plan — Fix Table

| # | File | Error Pattern | Root Cause | Fix | Code Change |
|---|---|---|---|---|---|
| **F1** | `autofill.js` | P1: Force scroll to top | `scrollToTop()` called at end of `processFields()` | **Remove `scrollToTop()` call entirely** from `processFields()`. Only scroll if user clicks the manual button AND explicitly requests it. | Delete line `scrollToTop();` (line ~844) |
| **F2** | `utils.js` | P2: Resume → Cover Letter | `cover_letter: "Resume"` and `cover letter: "Resume"` in greenhouse config | **Set both to `null`** to skip cover letter upload, matching generic config | Change `"cover_letter": "Resume"` → `"cover_letter": null` and `"cover letter": "Resume"` → `"cover letter": null` |
| **F3** | `autofill.js` | P3: Bootstrap only on load | `window.addEventListener("load", ...)` | **Replace with idempotent boot**: run immediately if `readyState !== 'loading'`, else on `DOMContentLoaded`, plus `pageshow` for BFCache | Refactor the `window.addEventListener("load", ...)` block |
| **F4** | `autofill.js` | P4: No dropdown validation | `setNativeValue` and generic field fill don't check if value exists as option | **For `<select>` elements, use `setBestSelectOption()` exclusively** (already exists but not always used). **For radio groups, always use `clickBestRadioInGroup()`**. Add a guard: if `setBestSelectOption` returns false (score < 60), skip the field instead of forcing text. | Already partially done; ensure all select/radio paths go through validation |
| **F5** | `autofill.js` | P5: Fuzzy matching too loose | `inputQuery` Pass 1 matches on `node.value` (can match filled-in values); Pass 3 fuzzy at score ≥50 is too low for custom questions | **Remove `node.value` from Pass 1 attribute list** (values shouldn't be used for field identification). **Raise fuzzy threshold from 50 to 65**. **Add a "question text is a yes/no question" detector**: if the label text is a yes/no question, only fill if the stored value maps to yes/no. | Edit `inputQuery` to remove value-based matching; add question-type detection |
| **F6** | `autofill.js` | P5: Race/veteran leak into custom Qs | Generic pass runs after platform pass, re-matching fields | **Track which fields have been filled** (Set of elements). Skip already-filled elements in subsequent passes. | Add `filledElements` Set, check before filling |
| **F7** | `autofill.js` | P6: Location autocomplete | Lever/GH location inputs need type → wait → click suggestion | **For elements with class `location-input` or `data-qa="location-input"`: type the value character by character (or dispatch input events), wait 500ms for dropdown, then click first matching result**. If no dropdown appears, leave the typed value. | Add `handleLocationAutocomplete()` function |
| **F8** | `autofill.js` | P7: Country dropdown mismatch | `candidate-location` select has country codes; stored value is city | **For Lever `candidate-location` select elements**: use `Location (Country)` stored value (not city) for country dropdowns. Detect country dropdowns by checking if options are country names. | Add country-dropdown detection in `processFields` |
| **F9** | `autofill.js` + `utils.js` | P8: Auth answer inverted | The question "Are you legally authorized to work for X?" expects "yes" but `inputQuery('authorized')` may find wrong radio; also the stored value "Yes" for `Legally Authorized to Work` should map to "yes" radio | **Improve radio matching**: when question contains "authorized" AND stored value is "Yes", click "yes" radio. The existing `clickBestRadioInGroup` should handle this if it finds the right group. Root issue: `inputQuery` finds the field by `authorized` in label text → need to ensure it picks the FIRST matching radio group, not a random one. | Ensure `inputQuery` matches on label text of the radio's parent question, not just any attribute |
| **F10** | `utils.js` | P9: Veteran threshold | "I don't wish to answer" vs "Decline to self-identify" | **Add synonym mapping**: map common veteran/EEO stored values to their ATS equivalents before matching. Add: `"I don't wish to answer" → "Decline to self-identify"`, `"Prefer not to say" → "Decline to self-identify"`. Apply in `setBestSelectOption`. | Add synonym normalization in `setBestSelectOption` and `clickBestRadioInGroup` |
| **F11** | `autofill.js` | P10: No DOM detection | Only hostname matching | **Add `isGreenhouseDom()`**: check for `form.application--form`, `#application-form`, `.eeoc__container`. **Add `isLeverDom()`**: check for `form#application-form` with Lever-specific elements. Use in `detectJobFormKey()` as fallback. | Add DOM-marker functions, extend `detectJobFormKey()` |
| **F12** | `autofill.js` | P11: No name splitting | Full Name not split | **In `autofill()`, after loading storage**: if `First Name` missing but `Full Name` present, split on first/last space. Same for `Email` ← `Email Address`. | Add normalization block after `getStorageDataSync()` |
| **F13** | `autofill.js` | P12: React-select | Comboboxes get text, not option click | **Extend the existing combobox handler**: for `role="combobox"` with `aria-describedby` containing `react-select-*-placeholder`, derive listbox ID as `react-select-{input.id}-listbox`. Click to open, wait, find options, click best match. | Extend the existing combobox code block in `processFields` |
| **F14** | `utils.js` | P2 ext: recruitee cover_letter | `cover_letter: "Resume"` in recruitee config | Set to `null` | Same pattern as F2 |

---

## 5. Detailed Code Changes

### F1 — Remove scrollToTop()

In `autofill.js`, in `processFields()` near the end:
```diff
-  scrollToTop();
+  // Removed: scrollToTop() was preventing users from reviewing/correcting fields
```

### F2 — Fix cover letter mapping

In `utils.js`, greenhouse config:
```diff
-    "cover_letter": "Resume",
-    "cover letter": "Resume",
+    "cover_letter": null,
+    "cover letter": null,
```

Also in recruitee:
```diff
-    "candidate[cover_letter]": "Resume",
-    "cover_letter": "Resume",
+    "candidate[cover_letter]": null,
+    "cover_letter": null,
```

### F3 — Fix bootstrap

In `autofill.js`, replace the load handler:
```javascript
let _smartApplyBooted = false;
function bootSmartApply() {
  if (_smartApplyBooted) return;
  _smartApplyBooted = true;
  console.log("SmartApply: found job page.");
  initTime = new Date().getTime();
  setupLongTextareaHints();
  injectAutofillNowButton();
  awaitForm();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootSmartApply, { once: true });
} else {
  bootSmartApply();
}
window.addEventListener('pageshow', bootSmartApply);
```

### F5 — Fix inputQuery

Remove `node.value` from attribute list. Raise fuzzy threshold:
```diff
-      node.value,
+      // Removed: node.value — existing values shouldn't be used for field identification
```

```diff
-  if (bestMatch.el && bestMatch.score >= 50) return bestMatch.el;
+  if (bestMatch.el && bestMatch.score >= 65) return bestMatch.el;
```

### F6 — Track filled elements

In `processFields`, maintain a Set:
```javascript
// At module level
const _filledElements = new WeakSet();

// In processFields, before filling:
if (_filledElements.has(inputElement)) continue;
// After filling:
_filledElements.add(inputElement);
```

### F10 — Synonym mapping for EEO

Add to `utils.js` or `autofill.js`:
```javascript
const EEO_SYNONYMS = {
  "i don't wish to answer": "Decline to self-identify",
  "prefer not to say": "Decline to self-identify",
  "i do not wish to answer": "Decline to self-identify",
  "i wish not to answer": "Decline to self-identify",
  "not a veteran": "I am not a veteran",
  "not a protected veteran": "I am not a protected veteran",
};

function normalizeEeoValue(value) {
  const lower = (value || "").toLowerCase().trim();
  return EEO_SYNONYMS[lower] || value;
}
```

Apply in `setBestSelectOption` and `clickBestRadioInGroup` before scoring.

### F12 — Name splitting / email normalization

In `autofill()` after `let res = await getStorageDataSync();`:
```javascript
// Normalize: Full Name → First/Last if missing
if (!res["First Name"] && res["Full Name"]) {
  const parts = res["Full Name"].trim().split(/\s+/);
  res["First Name"] = parts[0] || "";
  res["Last Name"] = parts[parts.length - 1] || "";
  if (parts.length > 2) {
    res["Middle Name"] = parts.slice(1, -1).join(" ");
  }
}
// Normalize: Email Address → Email
if (!res["Email"] && res["Email Address"]) {
  res["Email"] = res["Email Address"];
}
// Normalize: Phone Number → Phone
if (!res["Phone"] && res["Phone Number"]) {
  res["Phone"] = res["Phone Number"];
}
```

---

## 6. Files NOT to modify (preserve)

- `workday.js` — Working correctly, no reported issues
- `manifest.json` — Match patterns are broad enough; no changes needed
- `_verify/` — Test harness files, keep as-is
- `dist/` — Will be rebuilt after src changes

---

## 7. Risk Assessment

| Change | Risk | Mitigation |
|---|---|---|
| Remove scrollToTop | Low — only removes annoying behavior | Users can still scroll manually |
| Fix cover letter mapping | Low — prevents unwanted upload | Cover letter left empty (user can upload manually) |
| Bootstrap refactor | Medium — changes init timing | Idempotent guard prevents double-init; tested in harness |
| Remove node.value from inputQuery | Medium — could miss some edge cases | Value-based matching was causing more harm than good; label/attribute matching is more reliable |
| Raise fuzzy threshold 50→65 | Medium — some marginal matches will be missed | Better to skip a field than fill it wrong; user can use manual button |
| Track filled elements | Low — strictly additive | Prevents double-filling, no downside |
| EEO synonyms | Low — only adds more match paths | Doesn't remove existing matching |
| Name splitting | Low — only fills gaps | Only triggers when First/Last is missing |
