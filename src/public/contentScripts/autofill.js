/* globals keyDownEvent, keyUpEvent, mouseUpEvent, changeEvent, inputEvent,
          sleep, curDateStr, base64ToArrayBuffer, getTimeElapsed, delays,
          getStorageDataLocal, getStorageDataSync, setNativeValue, fields,
          workDayAutofill */

let initTime;
window.addEventListener("load", (_) => {
  console.log("SmartApply: found job page.");
  initTime = new Date().getTime();
  setupLongTextareaHints();
  injectAutofillNowButton();
  awaitForm();
});
const applicationFormQuery = "#application-form, #application_form, #applicationform";


const AUTOFILL_NOW_BUTTON_ID = "smartapply-autofill-now";
let smartApplyAutofillLock = false;
let smartApplyLastAutofillAt = 0;
let smartApplyMutationDebounce = null;
let smartApplyLastRunForced = false;

let _filledElements = new WeakSet();

// Track elements that were recently attempted but had no matching option (e.g.,
// React-Select with no dropdown or no good match).  Maps Element → timestamp.
// Entries expire after 5 seconds so the same field isn't retried in a tight loop
// by multiple fuzzy-matching param names (e.g. "experience years" / "total experience").
let _recentlySkipped = new Map();

function isRecentlySkipped(el) {
  if (!_recentlySkipped.has(el)) return false;
  const ts = _recentlySkipped.get(el);
  if (Date.now() - ts > 5000) {
    _recentlySkipped.delete(el);
    return false;
  }
  return true;
}

function markRecentlySkipped(el) {
  _recentlySkipped.set(el, Date.now());
}

function detectJobFormKey() {
  try {
    const host = (window.location.hostname || "").toLowerCase();
    for (const k of Object.keys(fields || {})) {
      if (k === "generic") continue;
      if (host.includes(k)) return k;
    }
  } catch (_) {}
  return null;
}

function isLikelyApplicationPage() {
  try {
    if (document.querySelector(applicationFormQuery)) return true;
    // Resume uploaders are a strong signal.
    if (document.querySelector('input[type="file"]')) return true;
    // Common ATS markers
    if (document.querySelector('[id*="application" i], [class*="application" i]')) return true;
    if (document.querySelector('[name*="resume" i], [id*="resume" i], [name*="cover" i], [id*="cover" i]')) return true;
  } catch (_) {}
  return false;
}

function findBestForm() {
  try {
    // 1) Explicit application selectors
    const direct = document.querySelector(applicationFormQuery);
    if (direct) return direct;

    // 2) Prefer the active element's form (multi-step pages / language pickers)
    const active = document.activeElement;
    if (active && active.form) return active.form;

    // 3) Score all forms and pick the densest
    const forms = Array.from(document.querySelectorAll('form'));
    if (forms.length) {
      let best = { el: null, score: 0 };
      for (const f of forms) {
        const fieldsCount = f.querySelectorAll('input, select, textarea').length;
        const fileCount = f.querySelectorAll('input[type="file"]').length;
        const score = fieldsCount + fileCount * 5;
        if (score > best.score) best = { el: f, score };
      }
      if (best.el && best.score > 0) return best.el;
    }

    // 4) Some apps don't wrap content in a <form>
    const main = document.querySelector('#mainContent');
    if (main) return main;
  } catch (_) {}
  return null;
}

async function tryAutofillNow({ force = false, reason = "auto" } = {}) {
  if (smartApplyAutofillLock) return false;

  const now = Date.now();
  if (!force && now - smartApplyLastAutofillAt < 1500) return false;

  const detected = detectJobFormKey();
  if (!detected && !force && !isLikelyApplicationPage()) return false;

  const isWorkday = (window.location.hostname || "").includes('workday');
  let form = null;
  if (!isWorkday) {
    form = findBestForm();
    if (!form) return false;
  }

  smartApplyAutofillLock = true;
  smartApplyLastAutofillAt = now;

  try {
    smartApplyLastRunForced = !!force;
    await autofill(form);
    return true;
  } catch (e) {
    console.error('SmartApply: Autofill failed', { reason, e });
    return false;
  } finally {
    smartApplyAutofillLock = false;
  }
}

function injectAutofillNowButton() {
  try {
    if (document.getElementById(AUTOFILL_NOW_BUTTON_ID)) return;

    // Keep the button scoped to ATS-like pages only (manifest matches are broad).
    // But also retry — on Greenhouse React pages the form may not be in the DOM yet.
    const detected = detectJobFormKey();
    if (!detected && !isLikelyApplicationPage()) {
      // Retry after a delay — Greenhouse forms render asynchronously
      setTimeout(() => injectAutofillNowButton(), 2000);
      return;
    }

    const btn = document.createElement('button');
    btn.id = AUTOFILL_NOW_BUTTON_ID;
    btn.type = 'button';
    btn.textContent = '🚀 AUTOFILL NOW';

    btn.style.position = 'fixed';
    btn.style.top = '12px';
    btn.style.right = '12px';
    btn.style.zIndex = '2147483647';
    btn.style.background = '#4f46e5';
    btn.style.color = '#ffffff';
    btn.style.border = '0';
    btn.style.borderRadius = '999px';
    btn.style.padding = '10px 12px';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '700';
    btn.style.letterSpacing = '0.4px';
    btn.style.boxShadow = '0 10px 25px rgba(0,0,0,0.18)';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', async () => {
      const prev = btn.textContent;
      btn.textContent = 'FILLING...';
      btn.disabled = true;
      btn.style.opacity = '0.85';
      try {
        // Reset filled elements and skip cooldowns so button always forces a full re-fill
        _filledElements = new WeakSet();
        _recentlySkipped = new Map();
        await tryAutofillNow({ force: true, reason: 'button' });
      } finally {
        btn.textContent = prev;
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    });

    (document.body || document.documentElement).appendChild(btn);
  } catch (_) {}
}

function setupLongTextareaHints() {
  try {
    const applyHint = (el) => {
      if (!(el instanceof HTMLTextAreaElement)) return;
      if (el.dataset?.aiHintApplied === '1') return;
      const h = el.getBoundingClientRect?.().height || 0;
      if (h <= 100) return;

      el.dataset.aiHintApplied = '1';
      el.style.outline = '2px solid rgba(99, 102, 241, 0.45)';
      el.style.outlineOffset = '2px';
      el.setAttribute('title', 'Right-click for AI?');
    };

    const scan = (root) => {
      const r = root && root.querySelectorAll ? root : document;
      const textareas = Array.from(r.querySelectorAll('textarea'));
      for (const ta of textareas) applyHint(ta);
    };

    scan(document);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes || []) {
          if (!(node instanceof Element)) continue;
          if (node.tagName === 'TEXTAREA') applyHint(node);
          scan(node);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  } catch (_) {}
}

function normalizeText(str) {
  return (str ?? "")
    .toString()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchScore(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 90;

  const aTokens = new Set(na.split(" "));
  const bTokens = new Set(nb.split(" "));
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  const union = aTokens.size + bTokens.size - inter;
  const jaccard = union ? inter / union : 0;
  // Base score from token overlap, with a small bump for multiple shared tokens.
  let score = Math.round(60 * jaccard);
  if (inter >= 2) score += 10;
  return score;
}

function dispatchInputAndChange(el) {
  try {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch (_) {}
  try {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (_) {}
}

function setBestSelectOption(selectEl, fillValue) {
  if (!(selectEl instanceof HTMLSelectElement)) return false;
  const options = Array.from(selectEl.options || []);
  if (!options.length) return false;

  const fillNorm = normalizeText(fillValue);

  // --- Country dropdown detection & mapping ---
  // If this is a country <select> (class="candidate-location" or many options with 2-letter codes),
  // map location strings like "United States of America", "houston, tx", "US" → country code.
  const isCountrySelect = selectEl.classList.contains('candidate-location') ||
    (options.length > 100 && options.filter(o => /^[A-Z]{2}$/.test(o.value)).length > 50);

  if (isCountrySelect) {
    const countryCode = resolveCountryCode(fillValue);
    if (countryCode) {
      const match = options.find(o => o.value === countryCode);
      if (match) {
        console.log(`SmartApply: Country select "${fillValue}" → "${match.textContent.trim()}" (code ${countryCode})`);
        selectEl.value = match.value;
        match.selected = true;
        dispatchInputAndChange(selectEl);
        return true;
      }
    }
  }

  const yesSynonyms = ['yes', 'true', '1'];
  const noSynonyms = ['no', 'false', '0', 'decline', 'prefer not', 'not', 'none'];
  const isYes = yesSynonyms.some(s => fillNorm.includes(s));
  const isNo = noSynonyms.some(s => fillNorm.includes(s));

  let best = { opt: null, score: 0 };
  for (const opt of options) {
    if (opt.disabled) continue;
    let score = Math.max(
      matchScore(fillValue, opt.textContent),
      matchScore(fillValue, opt.value)
    );

    // Boolean synonym boosts (fixes "No" → "I am not a veteran"/"Decline")
    const optNorm = normalizeText(opt.textContent || opt.value);
    if (isNo && noSynonyms.some(s => optNorm.includes(s))) {
      score = Math.max(score, 90);
    } else if (isYes && yesSynonyms.some(s => optNorm.includes(s))) {
      score = Math.max(score, 90);
    }

    // Legacy veteran boost (if fillValue mentions 'veteran')
    if (fillNorm.includes('veteran') && noSynonyms.some(s => optNorm.includes(s))) {
      score = Math.max(score, 85);
    }

    if (score > best.score) best = { opt, score };
  }

  if (!best.opt) return false;
  if (best.score < 50) {
    console.log(`SmartApply: SKIP select option — best score ${best.score} < 50 for "${fillValue}" (best option: "${best.opt?.textContent?.trim()}")`);
    return false;
  }

  console.log(`SmartApply: Select "${fillValue}" → "${best.opt.textContent.trim() || best.opt.value}" (score ${best.score})`);

  selectEl.value = best.opt.value;
  best.opt.selected = true;
  dispatchInputAndChange(selectEl);
  return true;
}

/**
 * Resolve a location string or country name to an ISO 3166-1 alpha-2 code.
 * Handles: "United States of America", "United States", "US", "houston, tx", etc.
 */
function resolveCountryCode(locationStr) {
  if (!locationStr) return null;
  const norm = normalizeText(locationStr);

  // Direct 2-letter code
  if (/^[a-z]{2}$/.test(norm)) return norm.toUpperCase();

  // Common country name → code mappings (extend as needed)
  const countryMap = {
    'united states of america': 'US', 'united states': 'US', 'usa': 'US', 'u s a': 'US', 'america': 'US',
    'united kingdom': 'GB', 'great britain': 'GB', 'england': 'GB', 'uk': 'GB',
    'canada': 'CA', 'australia': 'AU', 'germany': 'DE', 'france': 'FR',
    'india': 'IN', 'china': 'CN', 'japan': 'JP', 'brazil': 'BR',
    'mexico': 'MX', 'spain': 'ES', 'italy': 'IT', 'netherlands': 'NL',
    'south korea': 'KR', 'singapore': 'SG', 'ireland': 'IE', 'israel': 'IL',
    'sweden': 'SE', 'switzerland': 'CH', 'new zealand': 'NZ', 'poland': 'PL',
    'portugal': 'PT', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI',
    'austria': 'AT', 'belgium': 'BE', 'czech republic': 'CZ', 'romania': 'RO',
    'philippines': 'PH', 'pakistan': 'PK', 'nigeria': 'NG', 'colombia': 'CO',
    'argentina': 'AR', 'chile': 'CL', 'peru': 'PE', 'south africa': 'ZA',
    'egypt': 'EG', 'turkey': 'TR', 'indonesia': 'ID', 'malaysia': 'MY',
    'thailand': 'TH', 'vietnam': 'VN', 'taiwan': 'TW', 'hong kong': 'HK',
    'united arab emirates': 'AE', 'uae': 'AE', 'saudi arabia': 'SA',
    'russia': 'RU', 'ukraine': 'UA',
  };

  // Exact country name match
  for (const [name, code] of Object.entries(countryMap)) {
    if (norm === name || norm.includes(name)) return code;
  }

  // US state abbreviations / city patterns → US
  const usStateAbbrs = ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia',
    'ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd',
    'oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc','pr'];
  // Pattern: "city, ST" where ST is a US state abbreviation
  const cityStateMatch = norm.match(/,\s*([a-z]{2})\s*$/);
  if (cityStateMatch && usStateAbbrs.includes(cityStateMatch[1])) return 'US';

  return null;
}

function getRadioLabelText(radio) {
  if (!radio) return "";
  const aria = radio.getAttribute?.("aria-label");
  if (aria) return aria;
  const id = radio.id;
  if (id) {
    const lbl = document.querySelector(`label[for="${CSS?.escape ? CSS.escape(id) : id}"]`);
    if (lbl) return lbl.textContent || "";
  }
  // Common patterns: wrapped in <label>...</label>
  const parentLabel = radio.closest?.("label");
  if (parentLabel) return parentLabel.textContent || "";
  return "";
}

function clickBestRadioInGroup(radioEl, fillValue, root) {
  if (!radioEl || radioEl.type !== "radio") return false;
  const name = radioEl.name;
  if (!name) return false;

  const esc = (val) =>
    CSS?.escape ? CSS.escape(val) : val.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
  const scope = root || radioEl.form || document;
  const radios = Array.from(scope.querySelectorAll(`input[type="radio"][name="${esc(name)}"]`));
  if (!radios.length) return false;

  // --- Smart override for work authorization & sponsorship questions ---
  // Look at the question text surrounding this radio group to detect specific patterns.
  const overrideValue = getWorkAuthOverride(radioEl, fillValue);
  const effectiveFillValue = overrideValue !== null ? overrideValue : fillValue;

  let best = { el: null, score: 0 };
  for (const r of radios) {
    const labelText = getRadioLabelText(r);
    const score = Math.max(matchScore(effectiveFillValue, r.value), matchScore(effectiveFillValue, labelText));
    if (score > best.score) best = { el: r, score };
  }

  if (!best.el) return false;
  if (best.score < 40) return false;

  if (!best.el.checked) {
    best.el.click();
    dispatchInputAndChange(best.el);
  }
  return true;
}

/**
 * Handle checkbox groups (e.g., Lever's multi-select "Yes"/"No" checkboxes for sponsorship).
 * Finds the best-matching checkbox in the same name group and clicks it.
 */
function clickBestCheckboxInGroup(checkboxEl, fillValue, root) {
  if (!checkboxEl || checkboxEl.type !== "checkbox") return false;
  const name = checkboxEl.name;
  if (!name) return false;

  const esc = (val) =>
    CSS?.escape ? CSS.escape(val) : val.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
  const scope = root || checkboxEl.form || document;
  const checkboxes = Array.from(scope.querySelectorAll(`input[type="checkbox"][name="${esc(name)}"]`));
  if (!checkboxes.length) return false;

  // Smart override for sponsorship/authorization checkbox questions
  const overrideValue = getWorkAuthOverride(checkboxEl, fillValue);
  const effectiveFillValue = overrideValue !== null ? overrideValue : fillValue;

  let best = { el: null, score: 0 };
  for (const cb of checkboxes) {
    const labelText = getRadioLabelText(cb); // Reuse — works for checkboxes too
    const score = Math.max(matchScore(effectiveFillValue, cb.value), matchScore(effectiveFillValue, labelText));
    if (score > best.score) best = { el: cb, score };
  }

  if (!best.el) return false;
  if (best.score < 40) return false;

  if (!best.el.checked) {
    best.el.click();
    dispatchInputAndChange(best.el);
  }
  return true;
}

/**
 * Detect if a radio group question is about US work authorization or sponsorship,
 * and return the correct override value based on the actual question text.
 *
 * Problem: User stores "Legally Authorized to Work" = "no" (generic answer to a
 * different field like "Legally Authorized to Work (generic)"), but a Lever form
 * asks "Are you legally authorized to work in the United States for [Company]?"
 * which is a US-specific question — the answer should typically be "yes".
 *
 * Similarly, "Will you now or in the future require sponsorship..." should be "no".
 */
function getWorkAuthOverride(radioEl, currentFillValue) {
  try {
    // Get the question text from surrounding labels/containers
    const questionContainer = radioEl.closest('.application-question, .custom-question, li');
    if (!questionContainer) return null;
    const questionText = normalizeText(questionContainer.textContent);

    // Pattern 1: "are you legally authorized to work in the united states" → "yes"
    if (questionText.includes('authorized to work') && questionText.includes('united states')) {
      console.log(`SmartApply: Work auth override — question asks about US authorization → "yes"`);
      return 'yes';
    }

    // Pattern 2: "will you now or in the future require sponsorship" → "no"
    if ((questionText.includes('require sponsorship') || questionText.includes('require visa') ||
         questionText.includes('need sponsorship') || questionText.includes('employment visa')) &&
        (questionText.includes('will you') || questionText.includes('do you'))) {
      console.log(`SmartApply: Sponsorship override — question asks about future sponsorship → "no"`);
      return 'no';
    }
  } catch (_) {}
  return null;
}

function getLabelText(node) {
  const texts = [];
  if (!node) return texts;

  const doc = node.ownerDocument || document;

  // 1. <label for="id">
  const id = node.id;
  if (id) {
    const escId = CSS?.escape ? CSS.escape(id) : id;
    const lbl = doc.querySelector(`label[for="${escId}"]`);
    if (lbl) texts.push(lbl.textContent);
  }

  // 2. Wrapping <label>
  const parentLabel = node.closest?.("label");
  if (parentLabel) texts.push(parentLabel.textContent);

  // 3. aria-labelledby → resolve ID refs to text
  const labelledBy = node.getAttribute?.("aria-labelledby");
  if (labelledBy) {
    const refTexts = labelledBy
      .split(/\s+/)
      .map((refId) => doc.getElementById(refId)?.textContent || "")
      .filter(Boolean);
    if (refTexts.length) texts.push(refTexts.join(" "));
  }

  // 4. Closest container text (fieldset legend, .field wrapper, etc.)
  // Walk up max 3 levels looking for short-ish text.
  let parent = node.parentElement;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    if (parent.tagName === "FORM") break;

    if (parent.tagName === "FIELDSET") {
      const legend = parent.querySelector("legend");
      if (legend) texts.push(legend.textContent);
    }

    const directText = parent.textContent || "";
    if (directText.length > 3 && directText.length < 300) {
      texts.push(directText);
      break;
    }
  }

  return texts.filter(Boolean);
}

function inputQuery(jobParam, form) {
  const normalizedParam = normalizeText(jobParam);
  const nodes = Array.from(form.querySelectorAll("input, select, textarea"));

  // Pass 0: Exact ID match (highest priority — Greenhouse uses stable IDs like "first_name", "gender", "veteran_status")
  let el = nodes.find((node) => {
    const id = normalizeText(node.id);
    return id && id === normalizedParam;
  });
  if (el) return el;

  // Pass 1: match on element attributes.
  el = nodes.find((node) => {
    const attributes = [
      node.id,
      node.name,
      node.placeholder,
      node.getAttribute?.("aria-label"),
      node.getAttribute?.("aria-labelledby"),
      node.getAttribute?.("aria-describedby"),
      node.getAttribute?.("data-qa"),
      node.getAttribute?.("data-automation-id"),
      node.getAttribute?.("data-automation-label"),
      node.getAttribute?.("autocomplete"),
    ];

    for (const rawAttr of attributes) {
      const attr = normalizeText(rawAttr);
      if (!attr) continue;
      if (attr.includes(normalizedParam)) {
        // Optimization: If searching for "address", ignore if it also contains "email"
        // to avoid false positive with "Email Address".
        if (normalizedParam === "address" && attr.includes("email")) continue;
        return true;
      }
    }
    return false;
  });
  if (el) return el;

  // Pass 1.5: match on associated label/question text.
  el = nodes.find((node) => {
    const labelTexts = getLabelText(node);
    return labelTexts.some((txt) => {
      const norm = normalizeText(txt);
      if (!norm) return false;
      if (norm.includes(normalizedParam)) {
        if (normalizedParam === "address" && norm.includes("email")) return false;
        return true;
      }
      return false;
    });
  });
  if (el) return el;

  // Pass 2: for <select>, match on option text/value.
  el = nodes.find((node) => {
    if (!(node instanceof HTMLSelectElement)) return false;
    const options = Array.from(node.options || []);
    return options.some((opt) => {
      const t = normalizeText(opt.textContent);
      const v = normalizeText(opt.value);
      return (t && t.includes(normalizedParam)) || (v && v.includes(normalizedParam));
    });
  });
  if (el) return el;

  // Pass 3: fuzzy match on label text using matchScore().
  let bestMatch = { el: null, score: 0 };
  for (const node of nodes) {
    const labelTexts = getLabelText(node);
    for (const txt of labelTexts) {
      const score = matchScore(normalizedParam, txt);
      if (score > bestMatch.score) bestMatch = { el: node, score };
    }
  }

  if (bestMatch.el && bestMatch.score >= 50) {
    console.log(`SmartApply: Fuzzy match "${jobParam}" → "${bestMatch.el.id || bestMatch.el.name || bestMatch.el.type}" (score ${bestMatch.score})`);
    return bestMatch.el;
  }
  if (bestMatch.el && bestMatch.score > 0) {
    console.log(`SmartApply: SKIP fuzzy match "${jobParam}" — best score ${bestMatch.score} < 50 (element: ${bestMatch.el.id || bestMatch.el.name || '?'})`);
  }
  return null;
}

function formatCityStateCountry(data, param) {
  let formattedStr = `${data[param] != undefined ? `${data[param]},` : ""} ${data["Location (State/Region)"] != undefined
    ? `${data["Location (State/Region)"]},`
    : ""
    }`;
  if (formattedStr[formattedStr.length - 1] == ",")
    formattedStr = formattedStr.slice(0, formattedStr.length - 1);
  return formattedStr;
}

async function awaitForm() {
  // Avoid doing work on non-ATS pages (manifest matches are intentionally broad).
  const detected = detectJobFormKey();
  if (!detected && !isLikelyApplicationPage()) return;

  // Try once immediately (some pages render the form before our MutationObserver sees any changes).
  await tryAutofillNow({ force: false, reason: 'initial' });

  // Keep watching for multi-step flows (e.g., language pickers) that reveal the form later.
  // Use a longer debounce to prevent aggressive re-fills that override manual edits.
  let mutationRunCount = 0;
  const MAX_MUTATION_RUNS = 3; // Only auto-fill a few times via mutation, then stop

  const observer = new MutationObserver(() => {
    if (mutationRunCount >= MAX_MUTATION_RUNS) return; // Stop re-running after initial fills
    if (smartApplyMutationDebounce) clearTimeout(smartApplyMutationDebounce);
    smartApplyMutationDebounce = setTimeout(() => {
      mutationRunCount++;
      tryAutofillNow({ force: false, reason: 'mutation' });
    }, 400); // Balanced: 400ms debounce (was 800ms — too slow for multi-step forms)
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

async function autofill(form) {
  console.log("SmartApply: Starting autofill.");
  let res = await getStorageDataSync();
  res["Current Date"] = curDateStr();
  await sleep(delays.initial);

  const genericExtras = fields?.generic
    ? Object.fromEntries(
        Object.entries(fields.generic).filter(([_, p]) => p && p !== "Resume")
      )
    : null;

  let matchFound = false;
  for (let jobForm in fields) {
    if (window.location.hostname.includes(jobForm) && jobForm !== 'generic') {
      matchFound = true;
      if (jobForm == "workday") {
        workDayAutofill(res);
        return;
      }

      await processFields(jobForm, fields[jobForm], form, res);

      // Important: Greenhouse/Lever/etc. often include *custom questions* whose labels do not
      // match the platform's standard IDs. A second "generic" pass catches these safely.
      if (genericExtras) {
        await processFields('generic', genericExtras, form, res);
      }

      break;
    }
  }

  if (!matchFound && fields.generic) {
    console.log("SmartApply: No specific config found, using generic.");
    await processFields('generic', fields.generic, form, res);
  }

  // Phase 2 (opt-in): run AI mapping for unresolved custom fields.
  // To avoid repeated network calls from MutationObserver re-runs, only do this
  // on explicit user-triggered runs (the 🚀 button / force=true).
  if (smartApplyLastRunForced) {
    try {
      await tryHybridAiMapping(form, res);
    } catch (e) {
      console.warn('SmartApply: Hybrid AI mapping skipped/failed', e);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Hybrid AI mapping (opt-in)
//
// This is additive. Deterministic autofill stays as-is.
// The AI mapping layer only runs on explicit user-triggered runs and only sends
// minimal field descriptors + allowed profile KEY NAMES (never values).
// ─────────────────────────────────────────────────────────────────────────────

let _smartApplyHybridLastRunAt = 0;
let _smartApplyAiDepsLoaded = false;

async function ensureAiDepsLoaded() {
  if (_smartApplyAiDepsLoaded) return true;
  if (!chrome?.runtime?.getURL) return false;

  // Load the ESM validator + provider so they attach to globals:
  // - __exempliphaiFillPlan
  // - __exempliphaiProviders.gemini
  try {
    await import(chrome.runtime.getURL('contentScripts/fillPlanValidator.js'));
  } catch (e) {
    console.warn('SmartApply: Failed to load fillPlanValidator', e);
    return false;
  }

  try {
    await import(chrome.runtime.getURL('contentScripts/providers/gemini.js'));
  } catch (e) {
    console.warn('SmartApply: Failed to load gemini provider', e);
    return false;
  }

  _smartApplyAiDepsLoaded = true;
  return true;
}

function inferSectionFromSnapshotCtx(sectionCtx) {
  try {
    if (!sectionCtx) return '';
    const parts = [];
    if (sectionCtx.legend) parts.push(sectionCtx.legend);
    if (Array.isArray(sectionCtx.headings) && sectionCtx.headings.length) parts.push(sectionCtx.headings.join(' > '));
    return parts.filter(Boolean).join(' | ');
  } catch (_) {}
  return '';
}

function isEmptyForAi(el) {
  try {
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase();

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const v = String(el.value || '').trim();
      if (type === 'checkbox' || type === 'radio') return false;
      return v.length === 0;
    }

    const ce = el.getAttribute?.('contenteditable');
    if ((ce && ce !== 'false') || el.isContentEditable) {
      const t = String(el.textContent || '').trim();
      return t.length === 0;
    }
  } catch (_) {}
  return false;
}

function shouldConsiderLabelForAi(label) {
  const t = normalizeText(label);
  if (!t) return false;
  if (t.length < 6) return false;
  if (t.length > 220) return false;

  // Minimize requests: only send labels that look like mapping candidates.
  const hints = [
    'authorized',
    'authorization',
    'sponsorship',
    'visa',
    'work in the united states',
    'salary',
    'compensation',
    'notice period',
    'available',
    'start date',
    'relocate',
    'linkedin',
    'github',
    'website',
    'portfolio',
    'location',
    'city',
    'state',
    'country',
    'zip',
    'postal',
    'phone',
    'email',
  ];

  return hints.some((h) => t.includes(h));
}

function controlKindForElement(el) {
  try {
    const tag = (el.tagName || '').toLowerCase();
    const role = (el.getAttribute?.('role') || '').toLowerCase();
    if (role === 'combobox') return 'combobox';

    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';

    if (tag === 'input') {
      const type = (el.getAttribute?.('type') || 'text').toLowerCase();
      if (type === 'file') return 'file';
      if (type === 'date') return 'date';
      if (type === 'time') return 'time';
      if (type === 'datetime-local') return 'datetime-local';
      return 'input';
    }

    const ce = el.getAttribute?.('contenteditable');
    if ((ce && ce !== 'false') || el.isContentEditable) return 'contenteditable';
  } catch (_) {}
  return 'unknown';
}

async function tryHybridAiMapping(form, res) {
  if (!form) return;

  // Cooldown: avoid re-calling AI rapidly on multi-step pages.
  const now = Date.now();
  if (now - _smartApplyHybridLastRunAt < 15000) return;

  if (!res?.aiMappingEnabled) return;

  const apiKey = res?.['API Key'];
  if (!apiKey) return;

  const fs = globalThis.__SmartApply?.formSnapshot;
  const policy = globalThis.__SmartApply?.policy;
  const aiFillPlan = globalThis.__SmartApply?.aiFillPlan;
  const fillExecutor = globalThis.__SmartApply?.fillExecutor;

  if (!fs?.findControls || !fs?.stableFingerprint || !fs?.computeBestLabel) {
    console.warn('SmartApply: formSnapshot not loaded; cannot run hybrid mapping');
    return;
  }
  if (!policy || !aiFillPlan || !fillExecutor) {
    console.warn('SmartApply: Phase-2 modules missing (policy/aiFillPlan/fillExecutor)');
    return;
  }

  const depsOk = await ensureAiDepsLoaded();
  if (!depsOk) return;

  const domain = window.location.hostname || '';
  const pageUrl = window.location.href || '';

  // Allowed profile KEYS only (never values)
  const blockedKeys = new Set(['API Key', 'aiMappingEnabled', 'cloudSyncEnabled']);
  const allowedProfileKeys = Object.keys(res || {}).filter((k) => k && !blockedKeys.has(k));

  // Collect unresolved candidates.
  const unresolved_fields = [];
  const controls = fs.findControls(form);

  for (const el of controls) {
    try {
      const type = (el.getAttribute?.('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') continue;
      if (type === 'file') continue;

      if (_filledElements.has(el)) continue;
      if (!isEmptyForAi(el)) continue;

      const label = fs.computeBestLabel(el) || '';
      const sectionCtx = fs.extractSectionContext ? fs.extractSectionContext(el) : null;
      const section = inferSectionFromSnapshotCtx(sectionCtx);

      // Policy gate BEFORE we send anything to AI.
      if (policy.isConsentCheckbox?.({ label })) continue;
      if (policy.isSensitiveField?.({ label, section })) continue;

      if (!shouldConsiderLabelForAi(label)) continue;

      const fp = fs.stableFingerprint(el, { root: form });
      if (!fp) continue;

      const options = fs.extractOptions ? fs.extractOptions(el) : [];
      const optStrings = Array.isArray(options)
        ? Array.from(
            new Set(
              options
                .map((o) => (o?.label || o?.value || '').toString().trim())
                .filter(Boolean)
            )
          ).slice(0, 32)
        : [];

      unresolved_fields.push({
        field_fingerprint: fp,
        control: {
          kind: controlKindForElement(el),
          tag: (el.tagName || '').toLowerCase(),
          type: type,
          role: (el.getAttribute?.('role') || '').toLowerCase(),
          name: el.getAttribute?.('name') || '',
          id: el.getAttribute?.('id') || '',
          autocomplete: el.getAttribute?.('autocomplete') || '',
        },
        descriptor: {
          label,
          section,
          required: el.required || el.getAttribute?.('aria-required') === 'true',
          visible: true,
          options: optStrings,
        },
      });

      if (unresolved_fields.length >= 10) break; // minimize
    } catch (_) {}
  }

  if (!unresolved_fields.length) return;

  _smartApplyHybridLastRunAt = now;

  console.log('SmartApply: Hybrid mapping candidates', unresolved_fields.length);

  const tier1 = await aiFillPlan.generateTier1(
    {
      domain,
      page_url: pageUrl,
      snapshot_hash: `sha256:${now.toString(36)}`,
      unresolved_fields,
    },
    allowedProfileKeys,
    { apiKey, allowAiMapping: true, timeoutMs: 20000, outerRetries: 1 }
  );

  if (!tier1?.ok) {
    console.warn('SmartApply: AI mapping failed', tier1?.error);
    return;
  }

  const execRes = await fillExecutor.execute(tier1.plan, {
    root: form,
    profile: res,
    force: false,
    confidenceThreshold: 0.75,
  });

  console.log('SmartApply: Hybrid AI mapping executor result', execRes);
}

async function processFields(jobForm, fieldMap, form, res) {
  // Track which DOM elements have already been attempted in THIS call to prevent
  // multiple param keys (e.g. "experience years", "total experience", "relevant experience")
  // from retrying the same combobox within one processFields pass.
  const _attemptedThisPass = new WeakSet();

  for (let jobParam in fieldMap) {
    const param = fieldMap[jobParam];
    if (param === "Resume") {
      // Basic Context Menu Logic
      let lastClickedElement = null;

      const getQuestionFromElement = (element) => {
        if (!element) return "";

        let question = element.getAttribute?.("aria-label") || element.getAttribute?.("placeholder") || "";
        if (!question) {
          const id = element.id;
          if (id) {
            const label = document.querySelector(`label[for="${id}"]`);
            if (label) question = label.innerText;
          }
        }
        if (!question) {
          // Try to find closest text
          let parent = element.parentElement;
          while (parent && !question && parent.tagName !== 'FORM') {
            if (parent.innerText.length > 5 && parent.innerText.length < 200) {
              question = parent.innerText;
            }
            parent = parent.parentElement;
          }
        }

        return question;
      };

      document.addEventListener("contextmenu", (event) => {
        lastClickedElement = event.target;
        try {
          const question = getQuestionFromElement(lastClickedElement);
          if (question) {
            chrome.runtime.sendMessage({ action: 'STORE_LAST_QUESTION', question });
          }
        } catch (_) {}
      }, true);

      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "TRIGGER_AI_REPLY") {
          if (lastClickedElement) {
            generateAIAnswer(lastClickedElement);
          }
        }
      });

      async function generateAIAnswer(element) {
        // Show loading state (simple cursor)
        const originalCursor = element.style.cursor;
        element.style.cursor = "wait";

        try {
          // 1. Get Context (Label/Question)
          let question = getQuestionFromElement(element);

          // 2. Get User Data
          const fullSync = await getStorageDataSync();
          const apiKey = fullSync["API Key"];

          if (!apiKey) {
            alert("Please set your Gemini API Key in the Autofill Jobs extension settings.");
            element.style.cursor = originalCursor;
            return;
          }

          const localData = await getStorageDataLocal(["Resume", "LinkedIn PDF", "Resume_details"]);
          const resumeDetails = localData.Resume_details || {};
          const resumeBase64 = localData.Resume;
          const linkedinBase64 = localData["LinkedIn PDF"];

          // Format Text Context
          let context = "User Profile Context:\n";
          if (resumeDetails.experiences) {
            context += "Experience:\n" + JSON.stringify(resumeDetails.experiences) + "\n";
          }
          if (resumeDetails.skills) {
            context += "Skills: " + (Array.isArray(resumeDetails.skills) ? resumeDetails.skills.join(", ") : resumeDetails.skills) + "\n";
          }
          if (resumeDetails.certifications) {
            context += "Certifications:\n" + JSON.stringify(resumeDetails.certifications) + "\n";
          }

          context += `Full Sync Storage:\n${JSON.stringify(fullSync, null, 2)}\n`;

          let sitePrompt = '';
          const host = window.location.hostname.toLowerCase();
          if (host.includes('lever') || host.includes('greenhouse')) sitePrompt = 'Keep under 200 words.';

          const synonyms = {
            'Veteran Status:Decline': 'Prefer not to say',
          };
          const normalizedSynonyms = Object.fromEntries(
            Object.entries(synonyms).map(([k, v]) => [normalizeText(k), v])
          );
          const synonymHint = normalizedSynonyms[normalizeText(question)] || '';

          // Construct Parts for Gemini
          const parts = [
            {
              text: `You are a helpful assistant applying for a job.
              ${context}

              ${sitePrompt ? `Site guidance: ${sitePrompt}` : ''}
              ${synonymHint ? `Synonym hint: ${synonymHint}` : ''}
              
              Task: Write a professional, concise answer to the following job application question. Use the first person. Do not include placeholders like [Your Name]. Just the answer.
              
              Question: ${question}`
            }
          ];

          if (resumeBase64) {
            parts.push({
              inline_data: {
                data: resumeBase64,
                mime_type: "application/pdf"
              }
            });
          }

          if (linkedinBase64) {
            parts.push({
              inline_data: {
                data: linkedinBase64,
                mime_type: "application/pdf"
              }
            });
          }

          // 3. Call Gemini
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts }]
              })
            }
          );

          const json = await response.json();
          if (json.error) {
            throw new Error(json.error.message || "Unknown API Error");
          }

          const candidate = json.candidates && json.candidates[0];
          if (candidate) {
            let answer = candidate.content.parts[0].text;
            // Insert Answer
            setNativeValue(element, answer);
          }

        } catch (error) {
          console.error("AI Generation Error", error);
          alert(`Failed to generate answer: ${error.message}`);
        } finally {
          element.style.cursor = originalCursor;
        }
      }
      let localData = await getStorageDataLocal();
      if (!localData.Resume) continue;

      let el = inputQuery(jobParam, form);

      // Fallback for strict Resume field if generic inputQuery fails, 
      // primarily for main resume uploaders with specific IDs
      if (!el && jobParam.toLowerCase().includes("resume")) {
        let resumeDiv = {
          greenhouse: 'input[id="resume"]',
          lever: 'input[id="resume-upload-input"]',
          dover: 'input[type="file"][accept=".pdf"], input[type="file"][accept="application/pdf"]',
          oracle: 'input[type="file"]',
          generic: 'input[type="file"]'
        };
        let selector = resumeDiv[jobForm] || 'input[type="file"]';
        el = document.querySelector(selector);
      }

      if (!el) continue;

      // GUARD: Do NOT upload resume to cover letter file inputs
      const elId = (el.id || '').toLowerCase();
      const elName = (el.name || '').toLowerCase();
      const elLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const parentGroupLabel = el.closest('[aria-labelledby]')?.getAttribute('aria-labelledby') || '';
      const parentGroupText = parentGroupLabel ? (document.getElementById(parentGroupLabel)?.textContent || '').toLowerCase() : '';
      
      if (elId.includes('cover') || elName.includes('cover') || elLabel.includes('cover') || parentGroupText.includes('cover')) {
        console.log(`SmartApply: SKIP resume upload to cover letter input: ${elId || elName}`);
        _filledElements.add(el);
        continue;
      }

      el.addEventListener("submit", function (event) {
        event.preventDefault();
      });

      const dt = new DataTransfer();
      let arrBfr = base64ToArrayBuffer(localData.Resume);

      dt.items.add(
        new File([arrBfr], `${localData["Resume_name"]}`, {
          type: "application/pdf",
        })
      );
      el.files = dt.files;
      el.dispatchEvent(changeEvent);
      await sleep(delays.short);
      console.log(`SmartApply: Uploaded resume to ${elId || elName || 'file input'}`);

      _filledElements.add(el);
      continue;
    }

    if (param === "Skills") {
      let localData = await getStorageDataLocal("Resume_details");
      if (localData && localData.Resume_details) {
        try {
          let details = localData.Resume_details;
          if (typeof details === 'string') {
            details = JSON.parse(details);
          }
          if (details.skills && Array.isArray(details.skills)) {
            let fillValue = details.skills.join(", ");
            let inputElement = inputQuery(jobParam, form);
            if (inputElement) {
              setNativeValue(inputElement, fillValue);
            }
          }
        } catch (e) {
          console.error("Error parsing skills from resume details:", e);
        }
      }
      continue;
    }

    if (["Certification Name", "Issuing Organization", "Credential ID", "Credential URL", "Issue Date Month", "Expiration Date Month"].includes(param)) {
      let localData = await getStorageDataLocal("Resume_details");
      let certs = [];
      if (localData && localData.Resume_details && localData.Resume_details.certifications) {
        certs = localData.Resume_details.certifications;
      }

      if (certs.length > 0) {
        let cert = certs[0]; // Accessing the first certification
        let val = "";
        if (param === "Certification Name") val = cert.name;
        if (param === "Issuing Organization") val = cert.issuer;
        if (param === "Credential ID") val = cert.credentialId;
        if (param === "Credential URL") val = cert.url;
        if (param === "Issue Date Month") {
          // Heuristic: if input is month select, use month. if generic input, use full date space separated
          // But existing utils expect month. let's just assume month for now or full string
          // Actually, autofill logic later assumes monthToNumber if simple date month field? No, it uses setNativeValue.
          // Let's pass the full string or part.
          // Let's assume month name is stored.
          val = cert.issueDate ? cert.issueDate.split(' ')[0] : "";
        }
        if (param === "Expiration Date Month") {
          val = cert.expirationDate ? cert.expirationDate.split(' ')[0] : "";
        }

        if (val) {
          let inputElement = inputQuery(jobParam, form);
          if (inputElement) {
            setNativeValue(inputElement, val);
            // Also handle dropdowns if needed
            let btn = inputElement.closest(".select__control--outside-label");
            if (btn) {
              btn.dispatchEvent(mouseUpEvent);
              await sleep(delays.short);
              btn.dispatchEvent(keyDownEvent);
              await sleep(delays.short);
            }
          }
        }
      }
      continue;
    }

    let useLongDelay = false;
    // param already defined at top of loop

    let fillValue = res[param];
    if (!fillValue) {
      console.log(`SmartApply: SKIP "${jobParam}" (param="${param}") — no stored value`);
      continue;
    }
    let inputElement = inputQuery(jobParam, form);
    if (!inputElement) {
      console.log(`SmartApply: SKIP "${jobParam}" (param="${param}") — no matching element found in form`);
      continue;
    }

    // Skip already-filled (permanent phone overwrite fix across passes)
    if (_filledElements.has(inputElement)) {
      console.log(`SmartApply: Skip filled ${jobParam} (${inputElement.name || inputElement.id || inputElement.type}): already has "${inputElement.value}"`);
      continue;
    }

    // Skip elements that were recently attempted but had no matching option
    // (prevents "experience years"/"total experience"/"relevant experience" looping)
    if (isRecentlySkipped(inputElement)) {
      console.log(`SmartApply: Skip recently-skipped ${jobParam} (${inputElement.name || inputElement.id || inputElement.type})`);
      continue;
    }

    // Skip elements already attempted in this processFields pass (dedup across
    // different param names that fuzzy-match to the same DOM element)
    if (_attemptedThisPass.has(inputElement)) {
      console.log(`SmartApply: Skip already-attempted-this-pass ${jobParam} (${inputElement.name || inputElement.id || inputElement.type})`);
      continue;
    }
    _attemptedThisPass.add(inputElement);

    // ── GREENHOUSE REACT-SELECT GUARD ──
    // Greenhouse custom questions use React-Select comboboxes (role="combobox" with
    // aria-labelledby pointing to a <label>). Before filling, verify the question label
    // actually matches what we're trying to fill. This prevents data pollution where
    // e.g. "Race" value gets stuffed into "Are you a former educator?" dropdown.
    if (inputElement.getAttribute?.("role") === "combobox") {
      const labelledById = inputElement.getAttribute("aria-labelledby");
      if (labelledById) {
        const labelEl = document.getElementById(labelledById);
        const labelText = normalizeText(labelEl?.textContent || "");
        const paramNorm = normalizeText(jobParam);
        const score = matchScore(paramNorm, labelText);
        
        // Permissive: pass if score ≥ 45 or label contains param text.
        // Only hard-skip if score < 30 (clearly unrelated).
        const isRelevant = score >= 45 || labelText.includes(paramNorm);
        
        if (!isRelevant && score < 30) {
          console.log(`SmartApply: SKIP combobox "${labelText}" — doesn't match param "${jobParam}" (score ${score} < 30)`);
          continue;
        }
        if (!isRelevant) {
          console.log(`SmartApply: WARN combobox "${labelText}" — weak match for param "${jobParam}" (score ${score}), proceeding anyway`);
        }
      }
    }

    // Scroll smoothly to current field for sequential editing
    inputElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);  // User-requested: 200ms delay

    if (param === "Gender" || param === "Location (City)") useLongDelay = true;
    if (param === "Location (City)") fillValue = formatCityStateCountry(res, param);

    // Textareas: fill directly, no dropdown handling needed.
    if (inputElement instanceof HTMLTextAreaElement) {
      setNativeValue(inputElement, fillValue);
      _filledElements.add(inputElement);
      dispatchInputAndChange(inputElement);
      continue;
    }

    // Native <select> and radio groups need special handling:
    if (inputElement instanceof HTMLSelectElement) {
      if (setBestSelectOption(inputElement, fillValue)) _filledElements.add(inputElement);
      continue;
    }

    if (inputElement.type === "radio") {
      if (clickBestRadioInGroup(inputElement, fillValue, form)) _filledElements.add(inputElement);
      continue;
    }

    if (inputElement.type === "checkbox") {
      if (clickBestCheckboxInGroup(inputElement, fillValue, form)) _filledElements.add(inputElement);
      continue;
    }

    // ── GREENHOUSE REACT-SELECT COMBOBOX HANDLING ──
    // Greenhouse uses react-select for dropdowns. These are <input role="combobox">
    // inside .select__control containers. The key challenge: React-Select ignores
    // programmatic value changes — we must simulate real user interaction:
    // 1. Click the control/indicator to open the dropdown
    // 2. Type into the input to trigger React-Select's internal filtering
    // 3. Wait for [role=listbox] to appear (up to 2s)
    // 4. Extract options → best match → click
    // 5. On failure: clear, mark _recentlySkipped to prevent retry loops
    const isReactSelectCombobox = inputElement.getAttribute?.("role") === "combobox" &&
      inputElement.closest?.(".select-shell, .select__container, [class*=\"select__\"]");

    if (isReactSelectCombobox) {
      try {
        const selectShell = inputElement.closest(".select-shell, .select__container, [class*=\"css\"]")
          || inputElement.parentElement?.parentElement;

        // Step 1: Click the dropdown indicator/control to open the menu.
        // React-Select only opens when the control area or arrow is clicked.
        const indicator = selectShell?.querySelector(
          '.select__indicators button, [class*="indicatorContainer"], [class*="IndicatorsContainer"] button, .select__dropdown-indicator, svg'
        );
        const control = selectShell?.querySelector('.select__control, [class*="control"]');

        if (indicator) {
          try { indicator.click(); } catch (_) {}
        } else if (control) {
          try { control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); } catch (_) {}
        }
        await sleep(200);

        // Step 2: Focus the input and type the fill value using keyboard events.
        // React-Select only responds to actual keyboard input, not programmatic value sets.
        inputElement.focus();
        await sleep(100);

        // Clear any existing text first
        setNativeValue(inputElement, '');
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(50);

        // Type the fill value — dispatch both the native value change AND keydown events
        // so React-Select's internal onChange fires.
        setNativeValue(inputElement, fillValue);
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        inputElement.dispatchEvent(new Event("change", { bubbles: true }));
        // Also send a keyDown for the last character (triggers React-Select's onInputChange)
        if (fillValue.length > 0) {
          const lastChar = fillValue[fillValue.length - 1];
          inputElement.dispatchEvent(new KeyboardEvent("keydown", {
            key: lastChar, code: `Key${lastChar.toUpperCase()}`,
            keyCode: lastChar.charCodeAt(0), which: lastChar.charCodeAt(0),
            bubbles: true,
          }));
        }

        // Step 3: Wait for the dropdown/listbox to appear (up to 2s with polling).
        // React-Select renders [role=listbox] inside a portal or sibling div.
        let menu = null;
        const menuIdAttr = inputElement.getAttribute("aria-controls") ||
                           inputElement.getAttribute("aria-owns");

        const pollStart = Date.now();
        while (Date.now() - pollStart < 2000) {
          // Check by ID first (React-Select sets aria-controls dynamically)
          const curMenuId = inputElement.getAttribute("aria-controls") ||
                            inputElement.getAttribute("aria-owns") ||
                            menuIdAttr;
          if (curMenuId) {
            menu = document.getElementById(curMenuId);
          }
          // Fallback: find listbox near the combobox or in document
          if (!menu) {
            menu = selectShell?.querySelector('[role="listbox"], [class*="menu-list"], [class*="MenuList"]');
          }
          if (!menu) {
            // React-Select sometimes renders the menu as a portal outside the container
            const allListboxes = document.querySelectorAll('[role="listbox"]');
            for (const lb of allListboxes) {
              // Match by aria ID pattern (react-select-<inputId>-listbox)
              if (lb.id && lb.id.includes(inputElement.id)) { menu = lb; break; }
            }
          }
          if (menu) break;
          await sleep(200);
        }

        let reactSelectFilled = false;
        if (menu) {
          const options = Array.from(menu.querySelectorAll('[role="option"], [class*="option"]'));
          if (options.length > 0) {
            let bestOpt = { el: null, score: 0 };
            for (const opt of options) {
              const optText = opt.textContent || '';
              const score = matchScore(fillValue, optText);
              if (score > bestOpt.score) bestOpt = { el: opt, score };
            }
            if (bestOpt.el && bestOpt.score >= 50) {
              console.log(`SmartApply: React-Select "${jobParam}" → "${bestOpt.el.textContent.trim()}" (score ${bestOpt.score})`);
              bestOpt.el.click();
              reactSelectFilled = true;
              await sleep(delays.short);
            } else {
              // Try pressing Enter on the first option if it's the only one and reasonably close
              if (options.length === 1 && bestOpt.score >= 35) {
                console.log(`SmartApply: React-Select "${jobParam}" → only option "${bestOpt.el.textContent.trim()}" (score ${bestOpt.score}), selecting`);
                bestOpt.el.click();
                reactSelectFilled = true;
                await sleep(delays.short);
              } else {
                console.log(`SmartApply: React-Select "${jobParam}" — no good option match for "${fillValue}" (best score: ${bestOpt.score}, ${options.length} options)`);
              }
            }
          } else {
            console.log(`SmartApply: React-Select "${jobParam}" — dropdown appeared but has 0 options for "${fillValue}"`);
          }
        } else {
          console.log(`SmartApply: React-Select "${jobParam}" — dropdown menu not found after 2s for "${fillValue}"`);
        }

        // Post-fill verify: check if an actual selection is visible in the value container.
        // React-Select renders a .select__single-value element when an option is selected.
        if (reactSelectFilled) {
          const verifyShell = inputElement.closest(".select-shell, .select__container") || selectShell;
          const singleValue = verifyShell?.querySelector('[class*="singleValue"], [class*="single-value"], .select__single-value');
          if (singleValue && singleValue.textContent.trim()) {
            _filledElements.add(inputElement);
          } else {
            // Selection click didn't stick — treat as unfilled
            console.log(`SmartApply: React-Select "${jobParam}" — post-fill verify failed, no visible selection`);
            reactSelectFilled = false;
          }
        }

        if (!reactSelectFilled) {
          // No good match or selection didn't stick — clear the typed text
          // so the combobox returns to its placeholder "Select..." state.
          try {
            setNativeValue(inputElement, '');
            inputElement.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(100);
            // Dispatch Escape to close any lingering dropdown
            inputElement.dispatchEvent(new KeyboardEvent("keydown", {
              key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true,
            }));
          } catch (_) {}
          console.log(`SmartApply: React-Select "${jobParam}" — no option match, skipped (cleared input)`);
          // Mark as recently skipped to prevent other param names from retrying
          markRecentlySkipped(inputElement);
          // Do NOT add to _filledElements — leave for manual fill or AI pass
        }
      } catch (e) {
        console.error(`SmartApply: Error handling React-Select for "${jobParam}"`, e);
        markRecentlySkipped(inputElement);
      }
      continue;
    }

    // Custom ARIA dropdowns: role="combobox" controlling a role="listbox" (Ashby/BambooHR/etc.)
    const listboxId =
      inputElement.getAttribute?.("aria-owns") ||
      inputElement.getAttribute?.("aria-controls");
    if (listboxId && inputElement.getAttribute?.("role") === "combobox") {
      try {
        inputElement.click();
      } catch (_) {}
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
          _filledElements.add(inputElement);
          await sleep(delays.short);
          continue;
        }
      }
    }

    // Plain text inputs
    setNativeValue(inputElement, fillValue);
    _filledElements.add(inputElement);

    //for the dropdown elements (legacy Greenhouse v1 style)
    let btn = inputElement.closest(".select__control--outside-label");
    if (!btn) continue;

    btn.dispatchEvent(mouseUpEvent);
    await sleep(useLongDelay ? delays.long : delays.short);
    btn.dispatchEvent(keyDownEvent);
    await sleep(delays.short);
  }
  // Removed global scrollToTop(); per-field scrolling now handles it
  console.log(`SmartApply: Complete in ${getTimeElapsed(initTime)}s.`);

  // Track Applied Job
  try {
    let company = window.location.hostname.replace('www.', '').split('.')[0];
    company = company.charAt(0).toUpperCase() + company.slice(1);

    const jobEntry = {
      company: company,
      role: document.title.split('-')[0].trim() || "Unknown Role", // Simple heuristic
      date: new Date().toISOString(),
      url: window.location.href
    };

    chrome.storage.sync.get(['cloudSyncEnabled', 'AppliedJobsSync'], (resSync) => {
      const syncEnabled = !!resSync.cloudSyncEnabled;

      chrome.storage.local.get(['AppliedJobs'], (result) => {
        let jobs = result.AppliedJobs || [];
        // Avoid duplicate entries for the same URL on the same day
        const today = new Date().toDateString();
        const alreadyTracked = jobs.some(j => j.url === jobEntry.url && new Date(j.date).toDateString() === today);

        if (!alreadyTracked) {
          jobs.unshift(jobEntry); // Add to top

          chrome.storage.local.set({ AppliedJobs: jobs }, () => {
            console.log("SmartApply: Job tracked in local history.");
          });

          if (syncEnabled) {
            let syncJobs = resSync.AppliedJobsSync || [];
            syncJobs.unshift(jobEntry);
            // Limit to 100 for sync storage constraints
            syncJobs = syncJobs.slice(0, 100);
            chrome.storage.sync.set({ AppliedJobsSync: syncJobs }, () => {
              console.log("SmartApply: Job tracked in cloud history.");
            });
          }
        }
      });
    });
  } catch (e) {
    console.error("SmartApply: Error tracking job", e);
  }

}

