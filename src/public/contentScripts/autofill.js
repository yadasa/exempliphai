/* globals keyDownEvent, keyUpEvent, mouseUpEvent, changeEvent, inputEvent,
          createShiftEnterKeyDown, createShiftEnterKeyUp,
          createArrowRightKeyDown, createArrowRightKeyUp,
          createArrowDownKeyDown, createArrowUpKeyDown,
          createEnterKeyDown, createEnterKeyUp,
          createEscapeKeyDown,
          createTabKeyDown, createTabKeyUp,
          sleep, curDateStr, base64ToArrayBuffer, getTimeElapsed, delays,
          getStorageDataLocal, getStorageDataSync, setNativeValue, fields,
          workDayAutofill */

let initTime;

// In some DOM test environments (e.g., linkedom), document.activeElement is not updated by .focus().
// Install a best-effort polyfill without impacting real browsers.
let _smartApplyLastFocusedEl = null;
try {
  const doc = globalThis.document;
  const needsPolyfill = doc && !('activeElement' in doc);
  if (needsPolyfill) {
    const view = (doc && doc.defaultView) || globalThis;
    const proto = view.HTMLElement && view.HTMLElement.prototype;
    if (proto && !proto.__smartApplyFocusPatched) {
      const origFocus = proto.focus;
      proto.focus = function (...args) {
        try {
          _smartApplyLastFocusedEl = this;
        } catch (_) {}
        try {
          if (this && this.ownerDocument) this.ownerDocument.activeElement = this;
        } catch (_) {}
        try {
          return origFocus ? origFocus.apply(this, args) : undefined;
        } catch (_) {
          return undefined;
        }
      };
      proto.__smartApplyFocusPatched = true;
    }
  }
} catch (_) {}

window.addEventListener("load", async (_) => {
  console.log("SmartApply: found job page.");

  // Detect ATS using Simplify-derived URL patterns (best-effort)
  try {
    const det = globalThis.__SmartApply?.atsConfig?.detectATSKeyForUrl;
    if (typeof det === 'function') {
      const atsKey = await det(window.location.href);
      if (atsKey) console.log('SmartApply: detected ATS', atsKey);
    }
  } catch (e) {
    console.warn('SmartApply: ATS detection failed', e);
  }

  // Console-friendly, AI-prompt-ready form snapshot
  try {
    const form = findBestForm();
    const fs = globalThis.__SmartApply?.formSnapshot;
    if (form && fs?.findControls) {
      const snapshot = fs.findControls(form);
      console.log('SmartApply: Form Snapshot JSON:', JSON.stringify(snapshot, null, 2));
    }
  } catch (e) {
    console.warn('SmartApply: Form snapshot failed', e);
  }

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

function isGreenhouse(hostname = null) {
  try {
    const host = (hostname ?? window.location.hostname ?? "").toLowerCase();
    return host.includes('greenhouse.io');
  } catch (_) {}
  return false;
}

function _isUsableFormControl(el) {
  try {
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false;

    const type = String(el.getAttribute?.('type') || '').toLowerCase();
    if (type === 'hidden') return false;

    if (el.disabled) return false;
    const tabIndexAttr = el.getAttribute?.('tabindex');
    if (tabIndexAttr === '-1') return false;

    const ariaHidden = String(el.getAttribute?.('aria-hidden') || '').toLowerCase();
    if (ariaHidden === 'true') return false;

    return true;
  } catch (_) {}
  return false;
}

function _findFirstInputLike(root, doc) {
  try {
    const scope = root && root.querySelectorAll ? root : doc;
    const nodes = Array.from(scope.querySelectorAll('input, select, textarea'));
    for (const el of nodes) {
      if (_isUsableFormControl(el)) return el;
    }
  } catch (_) {}
  return null;
}

async function tabToFirstInput(opts = {}) {
  const doc = opts.document || document;
  const root = opts.root || doc;
  const delayMs = Number.isFinite(opts.delayMs) ? opts.delayMs : 100;
  const tabCount = Number.isFinite(opts.tabCount)
    ? opts.tabCount
    : (6 + Math.floor(Math.random() * 2)); // 6–7
  const quiet = opts.quiet === true;

  const _sleep =
    opts.sleep ||
    (typeof sleep === 'function'
      ? sleep
      : (ms) => new Promise((r) => setTimeout(r, ms)));

  const first = _findFirstInputLike(root, doc);
  if (!first) return null;

  if (!quiet) console.log(`SmartApply: Tabbing to first field (Tab x${tabCount})`);

  // Prefer the utils.js factories when present, else create a best-effort event
  // using the element's realm.
  const makeTabKey = (type) => {
    try {
      const view = first?.ownerDocument?.defaultView || doc?.defaultView || globalThis;
      const K = view?.KeyboardEvent || KeyboardEvent;
      return new K(type, {
        bubbles: true,
        cancelable: true,
        key: 'Tab',
        code: 'Tab',
        keyCode: 9,
        which: 9,
      });
    } catch (_) {
      return null;
    }
  };

  const tabDown = typeof createTabKeyDown === 'function'
    ? createTabKeyDown
    : () => makeTabKey('keydown');
  const tabUp = typeof createTabKeyUp === 'function'
    ? createTabKeyUp
    : () => makeTabKey('keyup');

  // Ensure a predictable target for key events.
  try {
    (doc.body || doc.documentElement || first).focus?.();
  } catch (_) {}

  for (let i = 0; i < tabCount; i++) {
    const target = doc.activeElement || doc.body || first;

    try {
      const ev = tabDown();
      if (ev) target.dispatchEvent(ev);
    } catch (_) {}

    try {
      const ev = tabUp();
      if (ev) target.dispatchEvent(ev);
    } catch (_) {}

    // Also dispatch on the document in case the page listens globally.
    try {
      const ev = tabDown();
      if (ev && doc.dispatchEvent) doc.dispatchEvent(ev);
    } catch (_) {}

    try {
      const ev = tabUp();
      if (ev && doc.dispatchEvent) doc.dispatchEvent(ev);
    } catch (_) {}

    await _sleep(delayMs);
  }

  try {
    first.focus?.();
  } catch (_) {}

  return first;
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

// ─────────────────────────────────────────────────────────────────────────────
// ATS selector-driven autofill (Simplify-style config)
//
// Uses config/simplify_ats.json loaded by contentScripts/atsConfig.js.
// Executes sequential actions using containerPath + inputSelectors.
// Values come from LOCAL_PROFILE (chrome.storage.local), local-only.
// ─────────────────────────────────────────────────────────────────────────────

const _SA_XLATE_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const _SA_XLATE_LOWER = 'abcdefghijklmnopqrstuvwxyz';

function _saIsProbablyXPath(sel) {
  const s = String(sel || '').trim();
  return s.startsWith('/') || s.startsWith('.//') || s.startsWith('..//') || s.startsWith('//');
}

function _saEvalXPathAll(xpath, root = document) {
  try {
    const doc = root?.ownerDocument || document;
    const res = doc.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const out = [];
    for (let i = 0; i < res.snapshotLength; i++) out.push(res.snapshotItem(i));
    return out;
  } catch (_) {
    return [];
  }
}

function _saEvalXPathOne(xpath, root = document) {
  const all = _saEvalXPathAll(xpath, root);
  return all && all.length ? all[0] : null;
}

function _saQueryAll(css, root = document) {
  try {
    const scope = root && root.querySelectorAll ? root : document;
    return Array.from(scope.querySelectorAll(css));
  } catch (_) {
    return [];
  }
}

function _saWithValue(sel, value) {
  if (sel == null) return sel;
  if (Array.isArray(sel)) return sel.map((s) => _saWithValue(s, value));
  if (typeof sel !== 'string') return sel;
  return _saSubstitutePlaceholders(sel, { value });
}

function _saFindAll(sel, root = document) {
  if (!sel) return [];
  if (Array.isArray(sel)) {
    const out = [];
    for (const s of sel) out.push(..._saFindAll(s, root));
    return out;
  }
  return _saIsProbablyXPath(sel) ? _saEvalXPathAll(String(sel), root) : _saQueryAll(String(sel), root);
}

function _saFindOne(sel, root = document) {
  const all = _saFindAll(sel, root);
  return all && all.length ? all[0] : null;
}

async function _saSleep(ms) {
  try {
    if (typeof sleep === 'function') return await sleep(ms);
  } catch (_) {}
  return await new Promise((r) => setTimeout(r, ms));
}

async function _saWaitFor({
  sel,
  root = document,
  present = true,
  timeoutMs = 4000,
  pollMs = 100,
} = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = _saFindOne(sel, root);
    if (present && el) return el;
    if (!present && !el) return true;
    await _saSleep(pollMs);
  }
  return present ? null : false;
}

async function _saLoadLocalProfile() {
  try {
    const got = await chrome.storage.local.get(['LOCAL_PROFILE', 'EXEMPLIPHAI_LOCAL_PROFILE']);
    return got.LOCAL_PROFILE || got.EXEMPLIPHAI_LOCAL_PROFILE || null;
  } catch (_) {
    return null;
  }
}

function _saNormalize(v) {
  return (v ?? '')
    .toString()
    .trim();
}

function _saDigitsOnly(v) {
  const s = _saNormalize(v);
  const d = s.replace(/\D+/g, '');
  return d;
}

function _saResolveProfileValue(profile, key) {
  if (!profile || !key) return undefined;
  if (key in profile) return profile[key];

  // Nested LOCAL_PROFILE shapes (older builds)
  // - basics.firstName / basics.lastName / basics.email / basics.phone
  // - links.linkedin / links.github / links.portfolio
  try {
    if (profile.basics && typeof profile.basics === 'object') {
      const b = profile.basics;
      if (key === 'first_name' && b.firstName) return b.firstName;
      if (key === 'last_name' && b.lastName) return b.lastName;
      if (key === 'email' && b.email) return b.email;
      if (key === 'phone' && b.phone) return b.phone;
      if (key === 'location' && b.location) return b.location;
      if (key === 'city' && b.city) return b.city;
      if (key === 'state' && (b.state || b.region)) return b.state || b.region;
      if (key === 'country' && b.country) return b.country;
      if (key === 'postal_code' && (b.postalCode || b.zip)) return b.postalCode || b.zip;
    }
    if (profile.links && typeof profile.links === 'object') {
      const l = profile.links;
      if (key === 'linkedin' && l.linkedin) return l.linkedin;
      if (key === 'github' && l.github) return l.github;
      if (key === 'portfolio' && l.portfolio) return l.portfolio;
      if (key === 'additional_url' && (l.website || l.url)) return l.website || l.url;
    }
  } catch (_) {}

  // Best-effort common aliases
  const aliases = {
    first_name: ['First Name', 'firstName', 'first_name'],
    last_name: ['Last Name', 'lastName', 'last_name'],
    email: ['Email', 'email'],
    phone: ['Phone', 'phone', 'phone_number'],
    phone_stripped: ['phone_stripped', 'phoneStripped'],
    city: ['city', 'Location (City)'],
    state: ['state', 'Location (State/Region)'],
    country: ['country', 'Location (Country)'],
    postal_code: ['postal_code', 'zip', 'Zip', 'Postal Code'],
    linkedin: ['LinkedIn', 'linkedin', 'linkedIn'],
    github: ['GitHub', 'github'],
    portfolio: ['Portfolio', 'portfolio', 'website'],
  };
  const list = aliases[key];
  if (Array.isArray(list)) {
    for (const k of list) if (k in profile) return profile[k];
  }

  return undefined;
}

function _saCoerceValueForKey(key, raw) {
  if (raw == null) return raw;
  if (key === 'phone_stripped') return _saDigitsOnly(raw);
  return raw;
}

function _saPickCanonicalKeyFromValuesMap(valuesMap, fillValue) {
  // valuesMap: { canonicalKey: string|[string]|... }
  const valNorm = normalizeText(fillValue);
  if (!valNorm) return null;

  for (const [canonical, candidates] of Object.entries(valuesMap || {})) {
    if (Array.isArray(candidates)) {
      for (const c of candidates) {
        if (normalizeText(c) === valNorm) return canonical;
      }
    } else {
      if (normalizeText(candidates) === valNorm) return canonical;
    }

    // also accept canonical itself
    if (normalizeText(canonical) === valNorm) return canonical;
  }

  // fallback: if valuesMap has keys 'true'/'false'/'' and fillValue looks boolean
  const booly = ['yes', 'true', '1'];
  const falsy = ['no', 'false', '0'];
  if (Object.prototype.hasOwnProperty.call(valuesMap || {}, 'true') && booly.some(b => valNorm === b)) return 'true';
  if (Object.prototype.hasOwnProperty.call(valuesMap || {}, '') && falsy.some(f => valNorm === f)) return '';

  return null;
}

function _saSubstitutePlaceholders(str, { value } = {}) {
  const s = String(str || '');
  const v = _saNormalize(value);
  // NOTE: Simplify-style XPaths often use translate(., "%UPPERVALUE%", "%LOWERVALUE%")
  // where %UPPERVALUE%/%LOWERVALUE% are alphabet maps, not the user's value.
  return s
    .replaceAll('%VALUE%', v)
    .replaceAll('%UPPERVALUE%', _SA_XLATE_UPPER)
    .replaceAll('%LOWERVALUE%', _SA_XLATE_LOWER);
}

function _saSetInputValue(el, value) {
  try {
    setNativeValue(el, value);
  } catch (_) {
    try { el.value = value; } catch (_) {}
  }
  dispatchInputAndChange(el);
}

async function _saDijitSelect(el, fillValue) {
  if (!el) return false;
  try { el.scrollIntoView?.({ block: 'center' }); } catch (_) {}
  try { el.click?.(); } catch (_) {}
  await _saSleep(150);

  // Dijit menus are usually rendered in a popup div with visible style.
  const opts = _saFindAll(
    "//div[contains(@class, 'dijitPopup') and contains(@class, 'dijitMenuPopup')][contains(@style, 'visibility') and contains(@style, 'visible')]//td[contains(@class, 'dijitMenuItemLabel')]",
    document
  );

  if (!opts.length) return false;

  let best = { el: null, score: 0 };
  for (const o of opts) {
    const t = (o.textContent || '').trim();
    const s = matchScore(fillValue, t);
    if (s > best.score) best = { el: o, score: s };
  }

  if (!best.el || best.score < 40) return false;

  try { best.el.click?.(); } catch (_) {}
  await _saSleep(120);
  return true;
}

async function _saUploadFromLocalBase64(fileInputEl, base64, filename, mimeType) {
  if (!fileInputEl || !base64) return false;
  try {
    const dt = new DataTransfer();
    const arrBfr = base64ToArrayBuffer(base64);
    dt.items.add(new File([arrBfr], filename || 'document.pdf', { type: mimeType || 'application/pdf' }));
    fileInputEl.files = dt.files;
    try { fileInputEl.dispatchEvent(changeEvent); } catch (_) { dispatchInputAndChange(fileInputEl); }
    return true;
  } catch (e) {
    console.warn('SmartApply: file upload failed', e);
    return false;
  }
}

async function _saExecuteActions(actions = [], ctx = {}) {
  const root = ctx.root || document;
  const value = ctx.value;
  for (const action of actions || []) {
    if (!action || typeof action !== 'object') continue;

    if (Number.isFinite(action.time)) {
      await _saSleep(action.time);
      continue;
    }

    // Wait until a path is removed
    if (action.path && action.removed) {
      const sel = _saWithValue(action.path, value);
      const ok = await _saWaitFor({ sel, root, present: false, timeoutMs: action.time || 4000 });
      if (!ok) console.log('SmartApply: wait-for-removed timed out', action.path);
      continue;
    }

    const method = String(action.method || '').toLowerCase();
    if (method === 'click') {
      const sel = _saWithValue(action.path, value);
      const target = _saFindOne(sel, root);
      try { target?.click?.(); } catch (_) {}
      await _saSleep(100);
      continue;
    }

    // Unhandled action method — keep going.
  }
}

async function _saApplySelectorEntry(entry, { root, key, fillValue, profile } = {}) {
  // entry: string XPath/CSS OR object {path, method, actions, values, valuePathMap, value}
  if (!entry) return false;

  if (typeof entry === 'string' || Array.isArray(entry)) {
    const el = _saFindOne(entry, root);
    if (!el) return false;

    // Default: fill into controls, click for buttons.
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      _saSetInputValue(el, String(fillValue ?? ''));
      return true;
    }
    try { el.click?.(); } catch (_) {}
    return true;
  }

  if (typeof entry !== 'object') return false;

  // Pick the first matching element from path list.
  let effectiveValue = fillValue;
  if (entry.value != null) effectiveValue = entry.value;

  const path = _saWithValue(entry.path, effectiveValue);
  const el = _saFindOne(path, root);
  if (!el) return false;

  // Pre-actions (wait/click sequences)
  if (Array.isArray(entry.actions) && entry.actions.length) {
    await _saExecuteActions(entry.actions, { root, value: effectiveValue });
  }

  const method = String(entry.method || '').toLowerCase();

  // Resolve value mapping

  // value map: translate fillValue into canonical keys for valuePathMap / template substitutions
  let canonicalKey = null;
  if (entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values)) {
    canonicalKey = _saPickCanonicalKeyFromValuesMap(entry.values, fillValue);
    if (canonicalKey != null) {
      // If valuesMap maps canonical->value strings (e.g. ids), treat canonicalKey as the intended value
      // OR if it maps canonical->synonyms, use canonicalKey in valuePathMap.
      const mapped = entry.values[canonicalKey];
      if (typeof mapped === 'string' && mapped && !Array.isArray(mapped)) {
        // Often dijit expects internal codes; use mapped string as effectiveValue
        effectiveValue = mapped;
      } else {
        effectiveValue = canonicalKey;
      }
    }
  }

  // valuePathMap: click a specific element path based on canonical/effective value
  if (entry.valuePathMap && typeof entry.valuePathMap === 'object') {
    const mapKey = canonicalKey != null ? canonicalKey : String(effectiveValue ?? '');
    const mappedPath = entry.valuePathMap[mapKey];
    if (mappedPath) {
      const sel = _saWithValue(mappedPath, effectiveValue);
      const target = _saFindOne(sel, root);
      if (target) {
        try { target.click?.(); } catch (_) {}
        await _saSleep(100);
        return true;
      }
    }
  }

  if (method === 'click') {
    try { el.click?.(); } catch (_) {}
    await _saSleep(100);
    return true;
  }

  if (method === 'dijit') {
    const ok = await _saDijitSelect(el, String(effectiveValue ?? ''));
    if (ok) return true;
    // fallthrough to default fill/click
  }

  if (method === 'uploadresume' || method === 'uploadcoverletter') {
    const localData = await getStorageDataLocal();
    if (method === 'uploadresume') {
      return await _saUploadFromLocalBase64(el, localData.Resume, localData.Resume_name || 'resume.pdf', 'application/pdf');
    }
    if (method === 'uploadcoverletter') {
      return await _saUploadFromLocalBase64(el, localData['Cover Letter'], localData['Cover Letter_name'] || 'coverletter.pdf', 'application/pdf');
    }
  }

  // Default fill if it's an input-like element
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    _saSetInputValue(el, String(effectiveValue ?? ''));
    return true;
  }

  // As a last resort, attempt click.
  try { el.click?.(); } catch (_) {}
  return true;
}

function _saLooksEmpty(el) {
  try {
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (type === 'checkbox' || type === 'radio' || type === 'file') return false;
      return String(el.value || '').trim() === '';
    }
    if (tag === 'select') {
      const v = String(el.value || '').trim();
      return v === '' || v === '0';
    }
  } catch (_) {}
  return false;
}

function _saTextFromFirstPath(paths, root) {
  try {
    const list = Array.isArray(paths) ? paths : (paths ? [paths] : []);
    for (const p of list) {
      const n = _saFindOne(p, root);
      const t = (n?.textContent || n?.nodeValue || '').toString().trim();
      if (t) return t;
    }
  } catch (_) {}
  return '';
}

function _saBuildProfileKeyCandidates(profile) {
  const keys = Object.keys(profile || {}).filter(Boolean);

  // Common synonyms (minimal + local-only) — keeps fuzzy mapping stable.
  const synonyms = {
    first_name: ['first name', 'given name'],
    last_name: ['last name', 'surname', 'family name'],
    email: ['email', 'e-mail'],
    phone: ['phone', 'phone number', 'mobile'],
    location: ['location', 'current location'],
    address: ['address', 'street address'],
    city: ['city', 'town'],
    state: ['state', 'province', 'region'],
    country: ['country', 'country / region'],
    postal_code: ['zip', 'zipcode', 'postal code'],
    linkedin: ['linkedin', 'linked in'],
    github: ['github'],
    portfolio: ['portfolio', 'personal website'],
    additional_url: ['website', 'url', 'personal site'],
    work_auth_us: ['work authorization (us)', 'authorized to work in the united states'],
    sponsorship: ['sponsorship', 'visa sponsorship', 'require sponsorship'],
  };

  const out = [];
  for (const k of keys) {
    const variants = new Set();
    variants.add(k);
    variants.add(k.replace(/_/g, ' '));
    variants.add(k.replace(/_/g, ''));
    const s = synonyms[k];
    if (Array.isArray(s)) for (const v of s) variants.add(v);
    out.push({ key: k, variants: Array.from(variants) });
  }
  return out;
}

function _saPickBestProfileKey(label, candidates) {
  try {
    const labelNorm = normalizeText(label);
    if (!labelNorm) return { key: null, score: 0 };

    let best = { key: null, score: 0 };
    for (const c of candidates) {
      for (const v of c.variants) {
        const sc = matchScore(normalizeText(v), labelNorm);
        if (sc > best.score) best = { key: c.key, score: sc };
      }
    }

    return best;
  } catch (_) {
    return { key: null, score: 0 };
  }
}

function _saOptionText(optEl, optTextPaths) {
  try {
    const fromPath = _saTextFromFirstPath(optTextPaths, optEl);
    if (fromPath) return fromPath;
    const t = (optEl?.textContent || '').toString().trim();
    return t;
  } catch (_) {}
  return '';
}

function _saCoerceToYesNo(v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  const t = normalizeText(v);
  if (t === 'true' || t === '1' || t === 'y' || t === 'yes') return 'yes';
  if (t === 'false' || t === '0' || t === 'n' || t === 'no') return 'no';
  return null;
}

async function _saAutofillTrackedInputs({ ats, root, profile, force = false } = {}) {
  if (!ats || !root || !profile) return { ok: false, reason: 'missing' };
  const selectors = Array.isArray(ats.trackedInputSelectors) ? ats.trackedInputSelectors : [];
  if (!selectors.length) return { ok: false, reason: 'no_tracked_selectors' };

  // Conservative default: only run on explicit user action OR when user opts-in.
  const optedIn = profile.trackedInputsFuzzy === true || profile.tracked_inputs_fuzzy === true;
  if (!force && !optedIn) return { ok: false, reason: 'not_forced' };

  const candidates = _saBuildProfileKeyCandidates(profile);
  if (!candidates.length) return { ok: false, reason: 'no_profile_keys' };

  let filled = 0;
  let considered = 0;

  for (const sel of selectors) {
    const fieldPaths = Array.isArray(sel.fieldPath) ? sel.fieldPath : [];
    if (!fieldPaths.length) continue;

    const fieldNodes = _saFindAll(fieldPaths, root);
    for (const fieldNode of fieldNodes) {
      try {
        const label = _saTextFromFirstPath(sel.labelPath, fieldNode);
        const labelNorm = normalizeText(label);
        if (!labelNorm || labelNorm.length < 4) continue;
        if (labelNorm.includes('password')) continue;

        // Input-like
        const inputEl = sel.inputPath ? _saFindOne(sel.inputPath, fieldNode) : null;
        const optionEls = sel.optionsPath ? _saFindAll(sel.optionsPath, fieldNode) : [];

        if (!inputEl && !optionEls.length) continue;

        // Skip already filled unless forced
        if (!force && inputEl && !_saLooksEmpty(inputEl)) continue;

        const best = _saPickBestProfileKey(label, candidates);
        considered++;

        // Tight threshold; avoids filling the wrong custom question.
        if (!best.key || best.score < 72) continue;

        let value = _saResolveProfileValue(profile, best.key);
        value = _saCoerceValueForKey(best.key, value);
        if (value == null || String(value).trim() === '') continue;

        // Radio/checkbox style
        if (!inputEl && optionEls.length) {
          const yesNo = _saCoerceToYesNo(value);
          const want = yesNo || String(value);

          let bestOpt = { el: null, score: 0, txt: '' };
          for (const optEl of optionEls) {
            const txt = _saOptionText(optEl, sel.optionsTextPath);
            const sc = matchScore(normalizeText(want), txt);
            if (sc > bestOpt.score) bestOpt = { el: optEl, score: sc, txt };
          }

          if (bestOpt.el && bestOpt.score >= 55) {
            // Click the actual input if possible
            try {
              bestOpt.el.click?.();
            } catch (_) {
              try { bestOpt.el.dispatchEvent?.(new Event('click', { bubbles: true })); } catch (_) {}
            }
            filled++;
            await _saSleep(80);
            continue;
          }

          continue;
        }

        // Standard inputs/selects/buttons
        if (inputEl) {
          const tag = (inputEl.tagName || '').toLowerCase();

          if (tag === 'select') {
            // Try exact-ish option match
            const opts = Array.from(inputEl.options || []);
            let bestOpt = { v: null, score: 0 };
            for (const o of opts) {
              const txt = (o.textContent || o.value || '').toString();
              const sc = matchScore(normalizeText(value), txt);
              if (sc > bestOpt.score) bestOpt = { v: o.value, score: sc };
            }
            if (bestOpt.v != null && bestOpt.score >= 55) {
              inputEl.value = bestOpt.v;
              try { inputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
              try { inputEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
              filled++;
              await _saSleep(80);
            }
            continue;
          }

          // Combobox-like button: use the ATS-provided fillActions if present.
          const role = (inputEl.getAttribute?.('role') || '').toLowerCase();
          const isComboBtn = tag === 'button' || role === 'combobox';
          if (isComboBtn && Array.isArray(sel.fillActions) && sel.fillActions.length) {
            await _saExecuteActions(sel.fillActions, { root: fieldNode, value: String(value) });
            filled++;
            await _saSleep(80);
            continue;
          }

          // Default input fill
          _saSetInputValue(inputEl, String(value));
          filled++;
          await _saSleep(60);
        }
      } catch (_) {}

      // Minimize risk and runtime.
      if (filled >= 8) break;
    }
    if (filled >= 8) break;
  }

  if (filled) {
    console.log('SmartApply: tracked inputs fuzzy-fill', { filled, considered });
  }

  return { ok: true, filled, considered };
}

async function tryAutofillUsingAtsConfig({ url, force = false } = {}) {
  try {
    const det = globalThis.__SmartApply?.atsConfig?.detectATSKeyForUrl;
    const getCfg = globalThis.__SmartApply?.atsConfig?.getATSConfig;
    if (typeof det !== 'function' || typeof getCfg !== 'function') return { ok: false, reason: 'no_ats_config' };

    const atsKey = await det(url || window.location.href);
    if (!atsKey) return { ok: false, reason: 'no_match' };

    const fullCfg = await getCfg();
    const ats = fullCfg?.ATS?.[atsKey] || null;
    if (!ats || !Array.isArray(ats.inputSelectors)) return { ok: false, reason: 'missing_selectors', atsKey };

    const profile = await _saLoadLocalProfile();
    if (!profile) return { ok: false, reason: 'no_local_profile', atsKey };

    // Find container root
    let root = document;
    if (Array.isArray(ats.containerPath) && ats.containerPath.length) {
      for (const p of ats.containerPath) {
        const found = _saFindOne(p, document);
        if (found) { root = found; break; }
      }
    }

    console.log('SmartApply: ATS config match', atsKey, 'root=', root === document ? 'document' : root);

    // Apply selectors sequentially
    for (const row of ats.inputSelectors) {
      try {
        if (!Array.isArray(row) || row.length < 2) continue;
        const key = row[0];
        const selectorEntries = row[1];

        let fillValue = _saResolveProfileValue(profile, key);
        fillValue = _saCoerceValueForKey(key, fillValue);

        // Skip when no value, except for upload methods where resume exists.
        if (fillValue == null || String(fillValue).trim() === '') {
          // allow resume/cover letter uploads to proceed even without profile value
          const isUploadField = String(key).toLowerCase().includes('resume') || String(key).toLowerCase().includes('cover');
          if (!isUploadField) continue;
        }

        let applied = false;
        const candidates = Array.isArray(selectorEntries) ? selectorEntries : [selectorEntries];
        for (const entry of candidates) {
          applied = await _saApplySelectorEntry(entry, { root, key, fillValue, profile });
          if (applied) break;
        }

        if (applied) {
          await _saSleep(120);
        }
      } catch (e) {
        console.warn('SmartApply: ATS selector row failed', row?.[0], e);
      }
    }

    // Pass 2: tracked inputs (custom questions)
    // Many ATS configs include trackedInputSelectors which describe how to discover
    // arbitrary form fields and their labels. We use this to fill "custom" questions
    // via fuzzy label→profile-key matching (local-only) and, optionally, AI.
    try {
      await _saAutofillTrackedInputs({ ats, root, profile, force });
    } catch (e) {
      console.warn('SmartApply: tracked inputs autofill failed', e);
    }

    // Optional AI mapping for remaining custom questions (explicit user-triggered runs only).
    if (force) {
      try {
        const res = await getStorageDataSync();
        await tryHybridAiMapping(root, res);
      } catch (e) {
        console.warn('SmartApply: ATS-mode AI mapping skipped/failed', e);
      }
    }

    // Optional: click submit/next buttons only when user explicitly opts in.
    // We do NOT auto-submit by default.
    if (profile && (profile.autoSubmit === true || profile.auto_submit === true)) {
      const paths = Array.isArray(ats.submitButtonPaths) ? ats.submitButtonPaths : [];
      for (const p of paths) {
        const btn = _saFindOne(p, document);
        if (btn) {
          console.log('SmartApply: autoSubmit enabled — clicking submit/next button');
          try { btn.click?.(); } catch (_) {}
          await _saSleep(200);
          break;
        }
      }
    }

    return { ok: true, atsKey };
  } catch (e) {
    console.warn('SmartApply: ATS config autofill failed', e);
    return { ok: false, reason: 'exception', error: String(e) };
  }
}

async function tryAutofillNow({ force = false, reason = "auto" } = {}) {
  if (smartApplyAutofillLock) return false;

  // Greenhouse pages are keyboard/focus sensitive and often require focus to be
  // inside the form. We allow auto-runs, but may send a few *optional* Tabs to
  // establish focus before filling.

  const now = Date.now();
  if (!force && now - smartApplyLastAutofillAt < 1500) return false;

  // Prefer Simplify-style ATS selector config when available.
  // This supports many ATS domains beyond our legacy hostname heuristics.
  try {
    const atsAttempt = await tryAutofillUsingAtsConfig({ url: window.location.href, force });
    if (atsAttempt?.ok) {
      console.log('SmartApply: ATS-config autofill complete', atsAttempt.atsKey);
      return true;
    }
  } catch (_) {}

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

    // Greenhouse: if focus isn't inside a usable control yet, sending a few
    // Tabs helps React-Select and other controls reliably accept input.
    if (isGreenhouse()) {
      try {
        const root = form || document;
        const active = document.activeElement;

        // In some DOM test environments, document.activeElement is not updated by .focus().
        const focusEl = _isUsableFormControl(active)
          ? active
          : (_isUsableFormControl(_smartApplyLastFocusedEl) ? _smartApplyLastFocusedEl : active);

        const activeOk = _isUsableFormControl(focusEl) && (!root?.contains || root.contains(focusEl));
        if (!activeOk) {
          const tabCount = 6 + Math.floor(Math.random() * 2); // 6–7
          console.log(`SmartApply: Optional tabs (x${tabCount}) → Starting autofill`);
          await tabToFirstInput({
            root,
            document,
            tabCount,
            delayMs: 100,
            sleep: typeof sleep === 'function' ? sleep : undefined,
            quiet: true,
          });
        }
      } catch (_) {}
    }

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
      const scopeRoot = root && root.querySelectorAll ? root : document;
      const textareas = Array.from(scopeRoot.querySelectorAll('textarea'));
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

// ─────────────────────────────────────────────────────────────────────────────
// Greenhouse React-Select: keyboard-first fill helper
//
// Some Greenhouse/Remix builds do not reliably open react-select menus via
// .click() on the indicator/control.  Keyboard triggers (ArrowRight or
// Shift+Enter) are more consistent on these pages.
//
// Returns true when a visible single-value selection is present.
// ─────────────────────────────────────────────────────────────────────────────

async function fillReactSelectKeyboard(inputElement, fillValue, jobParam, ctx = {}) {
  const TAG = ctx.tag || `SmartApply: React-Select "${jobParam}"`;
  const timeoutMs = ctx.timeoutMs ?? 3000;
  const minScore = ctx.minScore ?? 40;
  const settleMs = ctx.settleMs ?? 500;

  const makeKey = (type, init) => {
    try {
      return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    } catch (_) {
      return null;
    }
  };

  const k = {
    shiftEnterDown: typeof createShiftEnterKeyDown === 'function'
      ? createShiftEnterKeyDown
      : () => makeKey('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true }),
    shiftEnterUp: typeof createShiftEnterKeyUp === 'function'
      ? createShiftEnterKeyUp
      : () => makeKey('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true }),
    arrowRightDown: typeof createArrowRightKeyDown === 'function'
      ? createArrowRightKeyDown
      : () => makeKey('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 }),
    arrowRightUp: typeof createArrowRightKeyUp === 'function'
      ? createArrowRightKeyUp
      : () => makeKey('keyup', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 }),
    arrowDown: typeof createArrowDownKeyDown === 'function'
      ? createArrowDownKeyDown
      : () => makeKey('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 }),
    arrowUp: typeof createArrowUpKeyDown === 'function'
      ? createArrowUpKeyDown
      : () => makeKey('keydown', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38 }),
    enterDown: typeof createEnterKeyDown === 'function'
      ? createEnterKeyDown
      : () => makeKey('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }),
    enterUp: typeof createEnterKeyUp === 'function'
      ? createEnterKeyUp
      : () => makeKey('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }),
    escapeDown: typeof createEscapeKeyDown === 'function'
      ? createEscapeKeyDown
      : () => makeKey('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 }),
  };

  const selectShell = ctx.selectShell ||
    inputElement.closest?.('.select-shell, .select__container, [class*="select__"], [class*="css"]') ||
    inputElement.parentElement?.parentElement;

  const verifyShell = () => inputElement.closest?.('.select-shell, .select__container') || selectShell;

  const getVisibleSelectionText = () => {
    const shell = verifyShell();
    const singleValue = shell?.querySelector?.('[class*="singleValue"], [class*="single-value"], .select__single-value');
    const t = (singleValue?.textContent || '').trim();
    return t || '';
  };

  const clearTypedText = async () => {
    try {
      setNativeValue(inputElement, '');
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {}
    await sleep(50);
  };

  // Step 0: focus + clear
  inputElement.focus();
  await sleep(50);
  await clearTypedText();

  // Step 1: OPEN (keyboard-first)
  // Focus → ArrowRight → Shift+Enter, with a small settle time.
  try {
    const ev1 = k.arrowRightDown();
    const ev2 = k.arrowRightUp();
    if (ev1) inputElement.dispatchEvent(ev1);
    if (ev2) inputElement.dispatchEvent(ev2);
  } catch (_) {}

  await sleep(80);

  try {
    const ev1 = k.shiftEnterDown();
    const ev2 = k.shiftEnterUp();
    if (ev1) inputElement.dispatchEvent(ev1);
    if (ev2) inputElement.dispatchEvent(ev2);
  } catch (_) {}

  // Fallback: click/mousedown indicator/control
  try {
    const indicator = selectShell?.querySelector?.(
      '.select__indicators button, [class*="indicatorContainer"], [class*="IndicatorsContainer"] button, .select__dropdown-indicator'
    );
    const control = selectShell?.querySelector?.('.select__control, [class*="control"]');
    if (indicator) {
      try {
        indicator.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      } catch (_) {
        try { indicator.click?.(); } catch (_) {}
      }
    } else if (control) {
      try {
        control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      } catch (_) {
        try { control.click?.(); } catch (_) {}
      }
    }
  } catch (_) {}

  await sleep(settleMs);

  // Step 2: TYPE/FILTER
  try {
    setNativeValue(inputElement, String(fillValue ?? ''));
  } catch (_) {
    try { inputElement.value = String(fillValue ?? ''); } catch (_) {}
  }
  dispatchInputAndChange(inputElement);

  // Step 3: Robust poll (up to 3s) for listbox/menu + options
  const start = Date.now();
  let menu = null;
  let options = [];

  const findMenu = () => {
    const controlsId = inputElement.getAttribute?.('aria-controls') || inputElement.getAttribute?.('aria-owns');
    if (controlsId) {
      const byId = document.getElementById(controlsId);
      if (byId) return byId;
    }

    const near = selectShell?.querySelector?.('[role="listbox"], .select__menu-list, [class*="menu-list"], [class*="MenuList"]');
    if (near) return near;

    // Portals: search globally, prefer one that matches the input id
    const listboxes = Array.from(document.querySelectorAll('[role="listbox"], .select__menu-list, [class*="menu-list"], [class*="MenuList"]'));
    if (listboxes.length === 1) return listboxes[0];

    const idHint = String(inputElement.id || '');
    if (idHint) {
      const best = listboxes.find(lb => String(lb.id || '').includes(idHint));
      if (best) return best;
    }

    // If aria-expanded is true but we still can't find a good match, just pick the first visible listbox.
    const expanded = String(inputElement.getAttribute?.('aria-expanded') || '') === 'true';
    if (expanded) {
      for (const lb of listboxes) {
        const h = lb.getBoundingClientRect?.().height || lb.offsetHeight || 0;
        if (h > 0) return lb;
      }
    }

    return null;
  };

  while (Date.now() - start < timeoutMs) {
    menu = findMenu();
    if (menu) {
      options = Array.from(menu.querySelectorAll('[role="option"], .select__option, [class*="option"]'))
        .filter(o => (o.textContent || '').trim().length > 0);
      if (options.length) break;
    }
    await sleep(100);
  }

  if (!menu) {
    console.log(`${TAG} — dropdown menu not found after ${timeoutMs}ms for "${fillValue}"`);
    try {
      const ev = k.escapeDown();
      if (ev) inputElement.dispatchEvent(ev);
    } catch (_) {}
    await clearTypedText();
    return false;
  }

  if (!options.length) {
    console.log(`${TAG} — dropdown appeared but has 0 options for "${fillValue}"`);
    try {
      const ev = k.escapeDown();
      if (ev) inputElement.dispatchEvent(ev);
    } catch (_) {}
    await clearTypedText();
    return false;
  }

  // Step 4: Find best match
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < options.length; i++) {
    const t = options[i].textContent || '';
    const s = matchScore(fillValue, t);
    if (s > bestScore) {
      bestScore = s;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < minScore) {
    const bestText = bestIndex >= 0 ? (options[bestIndex].textContent || '').trim() : '';
    console.log(`${TAG} — no good option match for "${fillValue}" (best score: ${bestScore}${bestText ? `, "${bestText}"` : ''}, ${options.length} options)`);
    try {
      const ev = k.escapeDown();
      if (ev) inputElement.dispatchEvent(ev);
    } catch (_) {}
    await clearTypedText();
    return false;
  }

  const bestText = (options[bestIndex].textContent || '').trim();

  // Step 5: Select (keyboard ArrowDown/Up → Enter)
  const actId = String(inputElement.getAttribute?.('aria-activedescendant') || '');
  let focusedIndex = -1;
  if (actId) focusedIndex = options.findIndex(o => String(o.id || '') === actId);
  if (focusedIndex < 0) {
    focusedIndex = options.findIndex(o => String(o.getAttribute?.('aria-selected') || '') === 'true');
  }
  if (focusedIndex < 0) {
    focusedIndex = options.findIndex(o => String(o.className || '').includes('is-focused') || String(o.className || '').includes('isFocused'));
  }

  const press = async (evFactory, n) => {
    for (let i = 0; i < n; i++) {
      try {
        const ev = evFactory();
        if (ev) inputElement.dispatchEvent(ev);
      } catch (_) {}
      await sleep(30);
    }
  };

  if (focusedIndex < 0) {
    // No focused option yet: first ArrowDown moves to index 0.
    await press(k.arrowDown, bestIndex + 1);
  } else if (bestIndex > focusedIndex) {
    await press(k.arrowDown, bestIndex - focusedIndex);
  } else if (bestIndex < focusedIndex) {
    await press(k.arrowUp, focusedIndex - bestIndex);
  }

  try {
    const ev1 = k.enterDown();
    const ev2 = k.enterUp();
    if (ev1) inputElement.dispatchEvent(ev1);
    if (ev2) inputElement.dispatchEvent(ev2);
  } catch (_) {}

  await sleep(200);

  // Fallback: click the best option if keyboard didn't stick
  if (!getVisibleSelectionText()) {
    try { options[bestIndex].click?.(); } catch (_) {}
    await sleep(200);
  }

  const selected = getVisibleSelectionText();
  if (selected) {
    console.log(`${TAG} → Selected "${selected || bestText}" (score ${bestScore})`);
    return true;
  }

  console.log(`${TAG} — post-fill verify failed, no visible selection`);
  try {
    const ev = k.escapeDown();
    if (ev) inputElement.dispatchEvent(ev);
  } catch (_) {}
  await clearTypedText();
  return false;
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
  for (const radio of radios) {
    const labelText = getRadioLabelText(radio);
    const score = Math.max(matchScore(effectiveFillValue, radio.value), matchScore(effectiveFillValue, labelText));
    if (score > best.score) best = { el: radio, score };
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

  // Greenhouse: allow auto-trigger (tryAutofillNow handles optional focus tabs).

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
  const controls = typeof fs.findControlElements === 'function'
    ? fs.findControlElements(form)
    : fs.findControls(form);

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

          // PRIVACY: do NOT send full sync storage to the model.
          // Build a minimal, relevant subset for common application questions.
          const pick = (obj, keys) => {
            try {
              for (const k of keys) {
                if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && String(obj[k]).trim() !== '') {
                  return obj[k];
                }
              }
            } catch (_) {}
            return undefined;
          };

          const profileSubset = {
            first_name: pick(fullSync, ['first_name', 'First Name', 'firstName']),
            last_name: pick(fullSync, ['last_name', 'Last Name', 'lastName']),
            email: pick(fullSync, ['email', 'Email']),
            phone: pick(fullSync, ['phone', 'Phone', 'phone_number', 'Phone Number']),
            city: pick(fullSync, ['city', 'Location (City)']),
            state: pick(fullSync, ['state', 'Location (State/Region)']),
            country: pick(fullSync, ['country', 'Location (Country)']),
            postal_code: pick(fullSync, ['postal_code', 'Zip', 'zip', 'Postal Code']),
            linkedin: pick(fullSync, ['linkedin', 'LinkedIn']),
            github: pick(fullSync, ['github', 'GitHub']),
            portfolio: pick(fullSync, ['portfolio', 'Portfolio', 'website', 'Website']),
            work_auth_us: pick(fullSync, ['work_auth_us', 'Work Authorization', 'work_authorization_us']),
            sponsorship: pick(fullSync, ['sponsorship', 'Sponsorship', 'requires_sponsorship']),
          };

          // Remove empty keys
          for (const k of Object.keys(profileSubset)) {
            if (profileSubset[k] == null || String(profileSubset[k]).trim() === '') delete profileSubset[k];
          }

          // Tight summary of resume details (structured extraction only)
          const resumeDetailsMin = (() => {
            try {
              const d = resumeDetails && typeof resumeDetails === 'object' ? resumeDetails : {};
              const out = {};

              if (Array.isArray(d.experiences) && d.experiences.length) {
                out.experiences = d.experiences.slice(0, 6).map((x) => {
                  const e = x && typeof x === 'object' ? x : {};
                  return {
                    title: e.title || e.role || e.position || undefined,
                    company: e.company || e.employer || undefined,
                    start: e.start || e.start_date || e.startDate || undefined,
                    end: e.end || e.end_date || e.endDate || undefined,
                    highlights: Array.isArray(e.highlights) ? e.highlights.slice(0, 3) : undefined,
                  };
                });
              }

              if (Array.isArray(d.skills) && d.skills.length) out.skills = d.skills.slice(0, 50);
              if (Array.isArray(d.certifications) && d.certifications.length) out.certifications = d.certifications.slice(0, 12);

              return JSON.stringify(out, null, 2);
            } catch (_) {
              return '';
            }
          })();

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

          // Optional: attach PDFs only if they look valid; otherwise skip.
          // This prevents Gemini errors like "The document has no pages" when stored data is empty/invalid.
          const sanitizePdfBase64 = (b64) => {
            try {
              const s = String(b64 || '').trim();
              if (!s) return null;
              const stripped = s.startsWith('data:') ? s.slice(s.indexOf('base64,') + 7) : s;
              if (!stripped || stripped.length < 64) return null;

              // Quick header check: decoded bytes should start with %PDF
              const head = atob(stripped.slice(0, 64));
              if (!head || !head.startsWith('%PDF')) return null;
              return stripped;
            } catch (_) {
              return null;
            }
          };

          const resumePdf = sanitizePdfBase64(resumeBase64);
          const linkedinPdf = sanitizePdfBase64(linkedinBase64);

          const buildTextPart = () => ({
            text: `You write concise, professional job-application answers in first person.
Return ONLY the answer text.
Do not include placeholders like [Company] or [Your Name].

${sitePrompt ? `Site guidance: ${sitePrompt}\n\n` : ''}${synonymHint ? `Synonym hint: ${synonymHint}\n\n` : ''}Profile facts (minimal):
${Object.keys(profileSubset).length ? JSON.stringify(profileSubset, null, 2) : '(none)'}

Resume details (structured):
${resumeDetailsMin || '(none)'}

Question:
${question}`
          });

          const callGemini = async (parts) => {
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts }],
                  generationConfig: { temperature: 0.2 },
                }),
              }
            );

            const json = await response.json();
            if (json?.error) {
              throw new Error(json.error.message || 'Unknown API Error');
            }

            const candidate = json?.candidates?.[0];
            const answerText = candidate?.content?.parts?.[0]?.text;
            if (!answerText) throw new Error('AI response missing text');
            return String(answerText).trim();
          };

          // Default: text-only (most reliable). Attach PDFs only when valid.
          const parts = [buildTextPart()];
          const hadPdf = !!(resumePdf || linkedinPdf);
          if (resumePdf) parts.push({ inline_data: { data: resumePdf, mime_type: 'application/pdf' } });
          if (linkedinPdf) parts.push({ inline_data: { data: linkedinPdf, mime_type: 'application/pdf' } });

          let answer = '';
          try {
            answer = await callGemini(parts);
          } catch (e) {
            const msg = String(e?.message || e || '').toLowerCase();
            // Graceful fallback: retry without PDFs when Gemini cannot parse the document.
            if (hadPdf && (msg.includes('no pages') || msg.includes('document has no pages'))) {
              console.warn('SmartApply: Gemini PDF parse failed; retrying text-only');
              answer = await callGemini([buildTextPart()]);
            } else {
              throw e;
            }
          }

          // Insert Answer
          if (answer) setNativeValue(element, answer);

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
        const selectShell = inputElement.closest('.select-shell, .select__container, [class*="select__"], [class*="css"]')
          || inputElement.parentElement?.parentElement;

        const ok = await fillReactSelectKeyboard(inputElement, fillValue, jobParam, {
          selectShell,
          timeoutMs: 3000,
          minScore: 40,
          tag: `SmartApply: React-Select "${jobParam}"`,
        });

        if (ok) {
          _filledElements.add(inputElement);
        } else {
          // fillReactSelectKeyboard already cleared/escaped; we add the canonical
          // skip log + recently-skipped marker to prevent retry loops.
          console.log(`SmartApply: React-Select "${jobParam}" — no option match, skipped (cleared input)`);
          markRecentlySkipped(inputElement);
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

