/*
  formSnapshot.js
  
  Lightweight DOM extractor utilities for building a safe “form snapshot”:
  - findControls
  - computeBestLabel
  - extractSectionContext
  - extractOptions
  - stableFingerprint

  NOTE: This file is written as a classic content-script (no ESM exports) to
  match the current repo’s contentScripts style.

  To run unit tests manually on any page:
    window.__SmartApply?.formSnapshot?.runUnitTests?.()
*/

(function initFormSnapshot(global) {
  'use strict';

  const MAX_LABEL_CHARS = 160;
  const MAX_NEARBY_CHARS = 160;

  function normalizeText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/\s+/g, ' ')
      .replace(/\u00a0/g, ' ')
      .trim();
  }

  function clampText(s, maxLen) {
    const t = normalizeText(s);
    if (!t) return '';
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen - 1).trimEnd() + '…';
  }

  function safeCssEscape(value) {
    try {
      if (global.CSS && typeof global.CSS.escape === 'function') return global.CSS.escape(value);
    } catch (_) {}
    // Minimal escape fallback (not fully spec-compliant but good enough for ids/names).
    return String(value).replace(/[^a-zA-Z0-9_\-]/g, (m) => `\\${m}`);
  }

  function isAriaDisabled(el) {
    try {
      return (el.getAttribute && el.getAttribute('aria-disabled') === 'true') || false;
    } catch (_) {
      return false;
    }
  }

  function isProbablyHidden(el) {
    try {
      if (!el || el.nodeType !== 1) return true;
      if (el.closest && el.closest('template,[hidden],[aria-hidden="true"]')) return true;
      if (el.tagName === 'INPUT') {
        const t = (el.getAttribute('type') || '').toLowerCase();
        if (t === 'hidden') return true;
      }
      const style = global.getComputedStyle ? global.getComputedStyle(el) : null;
      if (style) {
        if (style.display === 'none' || style.visibility === 'hidden') return true;
        if (parseFloat(style.opacity || '1') === 0) return true;
      }
      // getClientRects works well for visibility in many cases.
      if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) {
        // Exception: some elements are offscreen but still valid; treat as hidden-ish.
        return true;
      }
    } catch (_) {}
    return false;
  }

  function isControlElement(el) {
    if (!el || el.nodeType !== 1) return false;

    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'reset', 'button', 'image'].includes(type)) return false;
      return true;
    }
    if (tag === 'textarea' || tag === 'select') return true;

    // contenteditable
    const ce = el.getAttribute && el.getAttribute('contenteditable');
    if (ce != null && ce !== 'false') return true;

    const role = (el.getAttribute && el.getAttribute('role')) || '';
    if (role === 'textbox' || role === 'combobox') return true;

    return false;
  }

  /**
   * findControls(root)
   *
   * Returns an array of candidate controls in DOM order.
   */
  function findControls(root = document) {
    const scope = root && root.querySelectorAll ? root : document;

    const selector = [
      'input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="image"])',
      'textarea',
      'select',
      '[contenteditable]:not([contenteditable="false"])',
      '[role="textbox"]',
      '[role="combobox"]'
    ].join(',');

    const nodes = Array.from(scope.querySelectorAll(selector));
    const out = [];
    const seen = new Set();

    for (const el of nodes) {
      if (!isControlElement(el)) continue;
      if (el.disabled) continue;
      if (isAriaDisabled(el)) continue;
      if (isProbablyHidden(el)) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      out.push(el);
    }

    return out;
  }

  function getById(doc, id) {
    try {
      return doc.getElementById(id);
    } catch (_) {
      return null;
    }
  }

  function textFromElement(el) {
    if (!el) return '';
    // Ignore elements that are explicitly aria-hidden
    try {
      if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return '';
    } catch (_) {}
    return normalizeText(el.textContent || '');
  }

  function labelFromAriaLabel(el) {
    try {
      return clampText(el.getAttribute('aria-label'), MAX_LABEL_CHARS);
    } catch (_) {
      return '';
    }
  }

  function labelFromAriaLabelledby(el) {
    try {
      const doc = el.ownerDocument || document;
      const ids = normalizeText(el.getAttribute('aria-labelledby'))
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean);

      if (!ids.length) return '';

      const parts = [];
      for (const id of ids) {
        const ref = getById(doc, id);
        const t = textFromElement(ref);
        if (t) parts.push(t);
      }
      return clampText(parts.join(' '), MAX_LABEL_CHARS);
    } catch (_) {
      return '';
    }
  }

  function labelFromHtmlLabelFor(el) {
    try {
      const doc = el.ownerDocument || document;
      const id = el.getAttribute('id');
      if (!id) return '';
      const q = `label[for="${safeCssEscape(id)}"]`;
      const labelEl = doc.querySelector(q);
      return clampText(textFromElement(labelEl), MAX_LABEL_CHARS);
    } catch (_) {
      return '';
    }
  }

  function labelFromWrappingLabel(el) {
    try {
      const labelEl = el.closest && el.closest('label');
      if (!labelEl) return '';
      return clampText(textFromElement(labelEl), MAX_LABEL_CHARS);
    } catch (_) {
      return '';
    }
  }

  function labelFromFieldsetLegend(el) {
    try {
      const fieldset = el.closest && el.closest('fieldset');
      if (!fieldset) return '';
      const legend = fieldset.querySelector('legend');
      return clampText(textFromElement(legend), MAX_LABEL_CHARS);
    } catch (_) {
      return '';
    }
  }

  function isLabelLikeElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toLowerCase();
    // Common label wrappers
    const ok = new Set(['label', 'span', 'div', 'p', 'strong', 'b', 'dt', 'legend']);
    if (!ok.has(tag)) return false;
    try {
      if (el.querySelector && el.querySelector('input,textarea,select,[role="textbox"],[role="combobox"],[contenteditable]')) {
        return false;
      }
    } catch (_) {}

    const t = normalizeText(el.textContent || '');
    if (!t) return false;
    if (t.length > MAX_NEARBY_CHARS) return false;
    // Avoid very generic boilerplate
    if (t === '*' || t === ':' || t === '—') return false;
    return true;
  }

  function labelFromNearby(el) {
    try {
      // 1) Search for a preceding label-like element in the DOM neighborhood.
      let cur = el;
      for (let depth = 0; depth < 4 && cur; depth++) {
        const parent = cur.parentElement;
        if (!parent) break;

        // Walk siblings before `cur` from right-to-left.
        let sib = cur.previousElementSibling;
        let hops = 0;
        while (sib && hops < 6) {
          // Find the last label-like element in this sibling's subtree (or itself)
          if (isLabelLikeElement(sib)) {
            const t = clampText(textFromElement(sib), MAX_LABEL_CHARS);
            if (t) return t;
          }
          // Subtree search for label-like elements
          try {
            const candidates = Array.from(sib.querySelectorAll('label,span,div,p,strong,b,dt'))
              .filter(isLabelLikeElement);
            if (candidates.length) {
              const t = clampText(textFromElement(candidates[candidates.length - 1]), MAX_LABEL_CHARS);
              if (t) return t;
            }
          } catch (_) {}

          sib = sib.previousElementSibling;
          hops++;
        }

        cur = parent;
      }

      // 2) Placeholder/title are fallbacks (helpful on unlabeled inputs)
      const ph = clampText(el.getAttribute && el.getAttribute('placeholder'), MAX_LABEL_CHARS);
      if (ph) return ph;
      const title = clampText(el.getAttribute && el.getAttribute('title'), MAX_LABEL_CHARS);
      if (title) return title;
    } catch (_) {}

    return '';
  }

  /**
   * computeBestLabel(el)
   *
   * Attempts to infer the most human-meaningful label for a control.
   */
  function computeBestLabel(el) {
    if (!el) return '';

    // 1) aria-label
    const a1 = labelFromAriaLabel(el);
    if (a1) return a1;

    // 2) aria-labelledby
    const a2 = labelFromAriaLabelledby(el);
    if (a2) return a2;

    // 3) <label for="id">
    const a3 = labelFromHtmlLabelFor(el);
    if (a3) return a3;

    // 4) wrapping <label>
    const a4 = labelFromWrappingLabel(el);
    if (a4) return a4;

    // 5) nearby heuristics (field-specific label wrappers)
    const a5 = labelFromNearby(el);
    if (a5) return a5;

    // 6) fieldset legend (section-level fallback)
    const a6 = labelFromFieldsetLegend(el);
    if (a6) return a6;

    return '';
  }

  function findPreviousHeading(startEl, rootEl, maxLevel = 4) {
    const sel = Array.from({ length: maxLevel }, (_, i) => `h${i + 1}`).join(',');

    let cur = startEl;
    while (cur && cur !== rootEl) {
      let prev = cur.previousElementSibling;
      while (prev) {
        if (prev.matches && prev.matches(sel)) return prev;
        try {
          const found = prev.querySelectorAll ? prev.querySelectorAll(sel) : [];
          if (found && found.length) return found[found.length - 1];
        } catch (_) {}
        prev = prev.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * extractSectionContext(el)
   *
   * Returns section-level context hints (headings + legend).
   */
  function extractSectionContext(el, { maxHeadings = 3, headingLevelMax = 4 } = {}) {
    const root = (el && el.form) || (el && el.ownerDocument && el.ownerDocument.body) || document.body;

    const legend = labelFromFieldsetLegend(el) || '';

    const headings = [];
    let cursor = el;
    for (let i = 0; i < maxHeadings; i++) {
      const h = findPreviousHeading(cursor, root, headingLevelMax);
      if (!h) break;
      const txt = clampText(textFromElement(h), MAX_LABEL_CHARS);
      if (txt) headings.push(txt);
      cursor = h;
    }

    headings.reverse();

    return { legend, headings };
  }

  /**
   * extractOptions(el)
   *
   * Extract options for selects / datalists / common ARIA listbox patterns.
   */
  function extractOptions(el) {
    if (!el) return [];

    const tag = (el.tagName || '').toLowerCase();

    // <select>
    if (tag === 'select') {
      try {
        const out = [];
        for (const opt of Array.from(el.options || [])) {
          const label = normalizeText(opt.label || opt.textContent || '');
          const value = opt.value != null ? String(opt.value) : '';
          out.push({ value, label, selected: !!opt.selected, disabled: !!opt.disabled });
        }
        return out;
      } catch (_) {
        return [];
      }
    }

    // <input list="datalistId">
    if (tag === 'input') {
      try {
        const listId = el.getAttribute('list');
        if (listId) {
          const dl = (el.ownerDocument || document).getElementById(listId);
          if (dl) {
            const opts = Array.from(dl.querySelectorAll('option'));
            return opts.map((o) => ({
              value: String(o.getAttribute('value') || o.value || '').trim(),
              label: normalizeText(o.label || o.textContent || o.value || ''),
              selected: false,
              disabled: !!o.disabled
            })).filter((o) => o.value || o.label);
          }
        }
      } catch (_) {}

      // radio group options (useful even though not requested explicitly)
      try {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'radio' && el.name) {
          const scope = el.form || (el.ownerDocument || document);
          const radios = Array.from(scope.querySelectorAll(`input[type="radio"][name="${safeCssEscape(el.name)}"]`));
          return radios.map((r) => ({
            value: String(r.value || ''),
            label: computeBestLabel(r) || normalizeText(r.value || ''),
            selected: !!r.checked,
            disabled: !!r.disabled
          }));
        }
      } catch (_) {}

      return [];
    }

    // ARIA combobox/listbox (best-effort)
    try {
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      if (role === 'combobox' || role === 'textbox') {
        const doc = el.ownerDocument || document;
        const listId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        if (listId) {
          const list = getById(doc, listId);
          if (list) {
            const options = Array.from(list.querySelectorAll('[role="option"]'));
            if (options.length) {
              return options.map((o) => ({
                value: String(o.getAttribute('data-value') || o.getAttribute('value') || ''),
                label: normalizeText(o.textContent || ''),
                selected: o.getAttribute('aria-selected') === 'true',
                disabled: o.getAttribute('aria-disabled') === 'true'
              })).filter((o) => o.label);
            }
          }
        }
      }
    } catch (_) {}

    return [];
  }

  // 32-bit FNV-1a
  function hashStringFNV1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function baseKeyForFingerprint(el) {
    try {
      const id = el.getAttribute && el.getAttribute('id');
      if (id) return `id:${id}`;
      const name = el.getAttribute && el.getAttribute('name');
      if (name) return `name:${name}`;
      const ac = el.getAttribute && el.getAttribute('autocomplete');
      if (ac) return `ac:${ac}`;
      const role = el.getAttribute && el.getAttribute('role');
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        return `tag:input:type:${type}:role:${role || ''}`;
      }
      return `tag:${tag}:role:${role || ''}`;
    } catch (_) {
      return 'unknown';
    }
  }

  function indexWithinRoot(el, root, baseKey) {
    try {
      const controls = findControls(root);
      const same = controls.filter((c) => baseKeyForFingerprint(c) === baseKey);
      const idx = same.indexOf(el);
      if (idx >= 0) return idx;
      return controls.indexOf(el);
    } catch (_) {
      return 0;
    }
  }

  /**
   * stableFingerprint(el)
   *
   * Builds a stable-ish identifier using id/name/autocomplete + label hash + index.
   */
  function stableFingerprint(el, { root = null, version = 'v1' } = {}) {
    if (!el) return '';

    const doc = el.ownerDocument || document;
    const scope = root || el.form || doc;

    const baseKey = baseKeyForFingerprint(el);
    const label = computeBestLabel(el) || '';
    const labelHash = hashStringFNV1a(normalizeText(label).toLowerCase()).toString(36);

    let idx = 0;
    // If it has a concrete id, index is unnecessary.
    if (!/^id:/.test(baseKey)) {
      idx = Math.max(0, indexWithinRoot(el, scope, baseKey) || 0);
    }

    return `fp:${version}:${baseKey}:lh:${labelHash}:i:${idx}`;
  }

  function runUnitTests() {
    const host = document.createElement('div');
    host.id = '__formSnapshotTestRoot';
    host.style.cssText = 'position:fixed;left:-99999px;top:-99999px;';

    host.innerHTML = `
      <h1>Application</h1>
      <form>
        <h2>Personal Info</h2>

        <div>
          <input name="placeholder_only" placeholder="Example placeholder" />
        </div>

        <div>
          <label for="fn">First Name</label>
          <input id="fn" name="first_name" autocomplete="given-name" />
        </div>

        <div>
          <label>Last Name <input id="ln" name="last_name" /></label>
        </div>

        <div>
          <span id="emailLabel">Email Address</span>
          <input id="email" aria-labelledby="emailLabel" />
        </div>

        <fieldset>
          <legend>Voluntary Disclosures</legend>
          <div>
            <div>Race</div>
            <select id="race" name="race">
              <option value="">Select…</option>
              <option value="a">Option A</option>
            </select>
          </div>
        </fieldset>

        <div>
          <div class="question">Portfolio URL</div>
          <input name="portfolio" />
        </div>

        <div>
          <label for="state">State</label>
          <input id="state" list="states" />
          <datalist id="states">
            <option value="NY"></option>
            <option value="CA"></option>
          </datalist>
        </div>

        <div>
          <div role="textbox" contenteditable="true" aria-label="Cover Letter"></div>
        </div>
      </form>
    `;

    document.body.appendChild(host);

    try {
      const placeholderOnly = host.querySelector('input[name="placeholder_only"]');
      const fn = host.querySelector('#fn');
      const ln = host.querySelector('#ln');
      const email = host.querySelector('#email');
      const race = host.querySelector('#race');
      const portfolio = host.querySelector('input[name="portfolio"]');
      const state = host.querySelector('#state');
      const ce = host.querySelector('[role="textbox"]');

      console.assert(findControls(host).length >= 7, 'findControls should find standard controls');

      console.assert(computeBestLabel(placeholderOnly) === 'Example placeholder', 'placeholder fallback should work');
      console.assert(computeBestLabel(fn) === 'First Name', 'label[for] should be preferred');
      console.assert(computeBestLabel(ln).startsWith('Last Name'), 'wrapping label should work');
      console.assert(computeBestLabel(email) === 'Email Address', 'aria-labelledby should work');
      console.assert(computeBestLabel(race) === 'Race', 'nearby label should work (preceding text)');
      console.assert(computeBestLabel(portfolio) === 'Portfolio URL', 'nearby label should work (question div)');
      console.assert(computeBestLabel(ce) === 'Cover Letter', 'aria-label on role=textbox should work');

      const ctxRace = extractSectionContext(race);
      console.assert(ctxRace.legend === 'Voluntary Disclosures', 'fieldset legend should be section context');
      console.assert(Array.isArray(ctxRace.headings) && ctxRace.headings.includes('Personal Info'), 'heading context should include h2');

      const raceOpts = extractOptions(race);
      console.assert(raceOpts.length === 2, 'select options should be extracted');
      console.assert(raceOpts[1].label === 'Option A', 'select option labels should be extracted');

      const dlOpts = extractOptions(state);
      console.assert(dlOpts.some((o) => o.value === 'NY'), 'datalist options should be extracted');

      const fp1 = stableFingerprint(fn);
      const fp2 = stableFingerprint(fn);
      console.assert(fp1 === fp2, 'stableFingerprint should be deterministic');
      console.assert(fp1.includes('id:fn'), 'fingerprint should include id when present');

      const fpPortfolio1 = stableFingerprint(portfolio);
      const fpPortfolio2 = stableFingerprint(portfolio);
      console.assert(fpPortfolio1 === fpPortfolio2, 'fingerprint without id should still be deterministic');

      console.log('formSnapshot unit tests passed');
      return true;
    } finally {
      host.remove();
    }
  }

  global.__SmartApply = global.__SmartApply || {};
  global.__SmartApply.formSnapshot = {
    findControls,
    computeBestLabel,
    extractSectionContext,
    extractOptions,
    stableFingerprint,
    runUnitTests,

    // for debugging
    _util: {
      normalizeText,
      hashStringFNV1a
    }
  };
})(globalThis);
