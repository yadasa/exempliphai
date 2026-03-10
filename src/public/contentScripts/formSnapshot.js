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
  const MAX_QUESTION_CHARS = 320;

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
   * findControlElements(root)
   *
   * Returns an array of candidate form controls (Elements) in DOM order.
   */
  function findControlElements(root = document) {
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

  function _controlKindForElement(el) {
    try {
      if (!el) return 'unknown';

      const tag = (el.tagName || '').toLowerCase();
      const role = String((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();

      const ce = el.getAttribute && el.getAttribute('contenteditable');
      if ((ce != null && ce !== 'false') || el.isContentEditable) return 'contenteditable';

      if (role === 'combobox') return 'combobox';
      if (role === 'textbox') return 'textarea';

      if (tag === 'select') return 'select';
      if (tag === 'textarea') return 'textarea';

      if (tag === 'input') {
        const type = String((el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase();
        if (type === 'file') return 'file';
        if (type === 'date') return 'date';
        if (type === 'time') return 'time';
        if (type === 'datetime-local') return 'datetime-local';
        return 'input';
      }
    } catch (_) {}
    return 'unknown';
  }

  function _sectionToJson(sectionCtx) {
    try {
      if (!sectionCtx) return { legend: '', headings: [] };
      const legend = sectionCtx.legend || '';
      const headings = Array.isArray(sectionCtx.headings) ? sectionCtx.headings : [];
      return { legend, headings };
    } catch (_) {}
    return { legend: '', headings: [] };
  }

  function _controlMeta(el) {
    try {
      const tag = (el.tagName || '').toLowerCase();
      const type = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
      const role = String((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
      return {
        tag,
        type,
        role,
        id: (el.getAttribute && el.getAttribute('id')) || '',
        name: (el.getAttribute && el.getAttribute('name')) || '',
        autocomplete: (el.getAttribute && el.getAttribute('autocomplete')) || '',
        required: !!(el.required || (el.getAttribute && el.getAttribute('aria-required') === 'true')),
      };
    } catch (_) {}
    return { tag: '', type: '', role: '', id: '', name: '', autocomplete: '', required: false };
  }

  function buildQuestionField({ kind, label, options }) {
    try {
      const base = clampText(label || '', MAX_QUESTION_CHARS);
      if (!base) return '';

      // For selects / comboboxes, append static options to make the question more explicit.
      if (kind === 'select' || kind === 'combobox') {
        const opts = Array.isArray(options) ? options : [];
        const seen = new Set();
        const labels = [];

        for (const o of opts) {
          try {
            const l = normalizeText((o && (o.label != null ? o.label : o.value)) || '');
            const v = normalizeText((o && o.value) || '');
            if (!l && !v) continue;

            // Skip placeholder-y options like "Select..." when value is empty.
            const lLower = l.toLowerCase();
            if (!v && (lLower === 'select...' || lLower === 'select…' || lLower.startsWith('select '))) {
              continue;
            }

            const key = (l || v).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            labels.push(l || v);
          } catch (_) {}
        }

        if (labels.length) {
          const joined = labels.slice(0, 12).join(' | ');
          const more = labels.length > 12 ? '…' : '';
          return clampText(base + ' Options: ' + joined + more, MAX_QUESTION_CHARS);
        }
      }

      return base;
    } catch (_) {}
    return clampText(label || '', MAX_QUESTION_CHARS);
  }


  /**
   * findControls(root)
   *
   * Returns an array of JSON-serializable control descriptors.
   * Intended for console logging / AI prompt preparation.
   */
  function findControls(root = document) {
    const scope = root && root.querySelectorAll ? root : document;

    const els = findControlElements(scope);
    const out = [];

    const seenGroups = new Set();

    for (const el of els) {
      try {
        const tag = (el.tagName || '').toLowerCase();
        const type = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();

        // Group radios/checkboxes by name (or id fallback) so options appear once.
        if (tag === 'input' && (type === 'radio' || type === 'checkbox')) {
          const name = (el.getAttribute && el.getAttribute('name')) || '';
          const id = (el.getAttribute && el.getAttribute('id')) || '';
          const key = type + ':' + (name || id || stableFingerprint(el, { root: scope }));
          if (seenGroups.has(key)) continue;
          seenGroups.add(key);

          let group = [el];
          try {
            if (name) {
              const q = 'input[type="' + type + '"][name="' + safeCssEscape(name) + '"]';
              group = Array.from(scope.querySelectorAll(q));
              group = group.filter((g) => {
                try {
                  if (!isControlElement(g)) return false;
                  if (g.disabled) return false;
                  if (isAriaDisabled(g)) return false;
                  if (isProbablyHidden(g)) return false;
                  return true;
                } catch (_) {
                  return false;
                }
              });
              if (!group.length) group = [el];
            }
          } catch (_) {}

          const kind = type === 'radio' ? 'radio-group' : 'checkbox-group';

          // Best-effort group label: prefer fieldset legend / aria-labelledby on a parent role=group/radiogroup.
          let label = '';
          try {
            const fieldset = el.closest && el.closest('fieldset');
            const legend = fieldset && fieldset.querySelector ? fieldset.querySelector('legend') : null;
            const legendText = legend ? clampText(textFromElement(legend), MAX_LABEL_CHARS) : '';
            if (legendText) label = legendText;
          } catch (_) {}
          if (!label) {
            try {
              const groupEl = el.closest && el.closest('[role="radiogroup"],[role="group"]');
              const lb = groupEl && groupEl.getAttribute ? groupEl.getAttribute('aria-labelledby') : '';
              if (lb) {
                const doc = el.ownerDocument || document;
                const parts = String(lb)
                  .split(/\s+/)
                  .map((id2) => {
                    try {
                      const n = doc.getElementById(id2);
                      return (n && n.textContent) ? n.textContent.trim() : '';
                    } catch (_) {
                      return '';
                    }
                  })
                  .filter(Boolean);
                const t = clampText(parts.join(' '), MAX_LABEL_CHARS);
                if (t) label = t;
              }
            } catch (_) {}
          }
          if (!label) {
            // Fall back to whatever we can infer from the first element.
            label = computeBestLabel(el) || '';
          }

          const section = _sectionToJson(extractSectionContext(el));

          const options = group.map((g) => {
            const v = String(g.value || '');
            const optLabel = computeBestLabel(g) || normalizeText(v);
            return {
              label: optLabel,
              value: v,
              checked: !!g.checked,
              disabled: !!g.disabled,
            };
          });

          const meta = _controlMeta(el);
          const question = buildQuestionField({ kind, label, options });

          out.push({
            kind,
            label,
            question,
            section,
            options,
            control: meta,
            fingerprint: stableFingerprint(el, { root: scope }),
          });
          continue;
        }

        const kind = _controlKindForElement(el);
        const label = computeBestLabel(el) || '';
        const section = _sectionToJson(extractSectionContext(el));

        // Options for selects, datalists, and ARIA listbox patterns.
        const opts = extractOptions(el) || [];
        let options = Array.isArray(opts)
          ? opts
              .map((o) => ({
                label: (o && o.label != null) ? String(o.label).trim() : '',
                value: (o && o.value != null) ? String(o.value) : '',
              }))
              .filter((o) => o.label || o.value)
          : [];

        // React-Select and similar widgets only render options when opened.
        // Best-effort: open → read listbox options → close, without changing the field value.
        let dynamicOptions = false;
        if (kind === 'combobox' && (!options || !options.length)) {
          try {
            const dyn = extractComboboxOptionsDynamic(el, { root: scope });
            if (dyn && Array.isArray(dyn.options) && dyn.options.length) {
              options = dyn.options;
            }
            if (dyn && dyn.dynamicOptions) dynamicOptions = true;
          } catch (_) {}
        }

        const meta = _controlMeta(el);
        const question = buildQuestionField({ kind, label, options });

        out.push({
          kind,
          label,
          question,
          section,
          options,
          ...(dynamicOptions ? { dynamicOptions: true } : {}),
          control: meta,
          fingerprint: stableFingerprint(el, { root: scope }),
        });
      } catch (_) {}
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


  function looksLikeAuxiliaryText(el, text = null) {
    try {
      const meta = [
        (el.getAttribute && el.getAttribute('class')) || '',
        (el.getAttribute && el.getAttribute('data-testid')) || '',
        (el.getAttribute && el.getAttribute('data-qa')) || '',
        el.id || ''
      ].join(' ').toLowerCase();

      if (/(visually-hidden|sr-only)/.test(meta)) return true;
      if (/(help|hint|error|tooltip|description|desc)/.test(meta)) return true;

      const t = (text != null ? String(text) : normalizeText(el.textContent || '')).toLowerCase();
      if (!t) return false;
      if (t === 'select all that apply' || t.startsWith('select all that apply')) return true;
      if (t.startsWith('optional')) return true;
      if (t.startsWith('please select')) return true;
    } catch (_) {}
    return false;
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
    if (looksLikeAuxiliaryText(el, t)) return false;

    // Avoid very generic boilerplate
    if (t == '*' || t == ':' || t == '—') return false;
    return true;
  }

  function looksQuestionLikeText(t) {
    try {
      if (!t) return false;
      const s = normalizeText(t);
      if (!s) return false;
      if (s.length > 50) return true;
      if (/[?]$/.test(s)) return true;
      if (/[\*✱]$/.test(s)) return true;
    } catch (_) {}
    return false;
  }

  function bestQuestionTextFromContainer(container) {
    if (!container || container.nodeType !== 1) return '';

    // Prefer commonly used "question text" wrappers first.
    const selectors = [
      '.question-text',
      '.questionText',
      '.application-label .text',
      '.application-label',
      '.question .text',
      '.question',
      '.field-label',
      '.fieldLabel'
    ];

    for (const sel of selectors) {
      try {
        const nodes = [];
        if (container.matches && container.matches(sel)) nodes.push(container);
        if (container.querySelectorAll) nodes.push(...Array.from(container.querySelectorAll(sel)));

        for (const n of nodes) {
          if (!isLabelLikeElement(n)) continue;
          const txt = clampText(textFromElement(n), MAX_LABEL_CHARS);
          if (txt && looksQuestionLikeText(txt)) return txt;
        }
      } catch (_) {}
    }

    // Generic fallback inside the container: any label-like element that looks like a question.
    try {
      const candidates = [];
      if (isLabelLikeElement(container)) candidates.push(container);
      if (container.querySelectorAll) {
        candidates.push(...Array.from(container.querySelectorAll('label,span,div,p,strong,b,dt')).filter(isLabelLikeElement));
      }
      for (const n of candidates) {
        const txt = clampText(textFromElement(n), MAX_LABEL_CHARS);
        if (txt && looksQuestionLikeText(txt)) return txt;
      }
    } catch (_) {}

    return '';
  }

  function labelFromPrecedingQuestionText(el) {
    try {
      let cur = el;
      for (let depth = 0; depth < 4 && cur; depth++) {
        const parent = cur.parentElement;
        if (!parent) break;

        let sib = cur.previousElementSibling;
        let hops = 0;
        while (sib && hops < 10) {
          const q = bestQuestionTextFromContainer(sib);
          if (q) return q;
          sib = sib.previousElementSibling;
          hops++;
        }

        cur = parent;
      }
    } catch (_) {}

    return '';
  }

  function labelFromNearbyShortText(el) {
    try {
      let cur = el;
      for (let depth = 0; depth < 4 && cur; depth++) {
        const parent = cur.parentElement;
        if (!parent) break;

        let sib = cur.previousElementSibling;
        let hops = 0;
        while (sib && hops < 8) {
          // Check sibling itself first
          if (isLabelLikeElement(sib)) {
            const t = clampText(textFromElement(sib), MAX_LABEL_CHARS);
            if (t && t.length <= 50) return t;
          }

          // Then scan the sibling's subtree for nearby label-like elements
          try {
            const candidates = Array.from(sib.querySelectorAll('label,span,div,p,strong,b,dt'))
              .filter(isLabelLikeElement);

            for (const c of candidates) {
              const t = clampText(textFromElement(c), MAX_LABEL_CHARS);
              if (t && t.length <= 50) return t;
            }
          } catch (_) {}

          sib = sib.previousElementSibling;
          hops++;
        }

        cur = parent;
      }
    } catch (_) {}

    return '';
  }

  function labelFromPlaceholderTitle(el) {
    try {
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

    // 5) preceding sibling question text (.question-text / application label wrappers)
    const a5 = labelFromPrecedingQuestionText(el);
    if (a5) return a5;

    // 6) nearby short preceding text (p/span/div <50 chars)
    const a6 = labelFromNearbyShortText(el);
    if (a6) return a6;

    // 7) Placeholder/title fallbacks
    const a7 = labelFromPlaceholderTitle(el);
    if (a7) return a7;

    // 8) fieldset legend (section-level fallback)
    const a8 = labelFromFieldsetLegend(el);
    if (a8) return a8;

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

  // ─────────────────────────────────────────────────────────────────────────────
  // Dynamic combobox options (React-Select style)
  //
  // Many combobox widgets only render their listbox/options into the DOM after
  // being opened. For snapshotting, we do a best-effort non-destructive open →
  // read → close. If we detect the combobox opened (aria-expanded=true) we set
  // `dynamicOptions: true` on the JSON descriptor.
  //
  // NOTE: findControls is synchronous (used by other modules). This helper
  // relies on frameworks rendering options synchronously during the dispatched
  // event handlers. When widgets render asynchronously, this may still miss.
  // ─────────────────────────────────────────────────────────────────────────────

  function _viewForEl(el) {
    try {
      return (el && el.ownerDocument && el.ownerDocument.defaultView) || global;
    } catch (_) {
      return global;
    }
  }

  function _patchEventProps(ev, init) {
    try {
      if (!ev || !init) return ev;
      for (const k of Object.keys(init)) {
        try {
          // Some DOM impls have read-only props; fall back to defineProperty.
          ev[k] = init[k];
        } catch (_) {
          try {
            Object.defineProperty(ev, k, { value: init[k], configurable: true });
          } catch (_) {}
        }
      }
    } catch (_) {}
    return ev;
  }

  function _makeGenericEvent(el, type, init) {
    try {
      const view = _viewForEl(el);
      const EC = view && view.Event;
      if (typeof EC !== 'function') return null;
      const ev = new EC(type, { bubbles: true, cancelable: true });
      return _patchEventProps(ev, init);
    } catch (_) {
      return null;
    }
  }

  function _makeKeyEvent(el, type, init) {
    try {
      const view = _viewForEl(el);
      const KE = view && view.KeyboardEvent;
      if (typeof KE === 'function') {
        return new KE(type, { bubbles: true, cancelable: true, ...init });
      }
    } catch (_) {}
    return _makeGenericEvent(el, type, init);
  }

  function _dispatchKey(el, type, init) {
    try {
      if (!el || typeof el.dispatchEvent !== 'function') return false;
      const ev = _makeKeyEvent(el, type, init);
      if (!ev) return false;
      el.dispatchEvent(ev);
      return true;
    } catch (_) {
      return false;
    }
  }

  function _makeMouseEvent(el, type, init) {
    try {
      const view = _viewForEl(el);
      const ME = view && view.MouseEvent;
      if (typeof ME === 'function') {
        return new ME(type, { bubbles: true, cancelable: true, ...init });
      }
    } catch (_) {}
    return _makeGenericEvent(el, type, init);
  }

  function _dispatchMouse(el, type, init) {
    try {
      if (!el || typeof el.dispatchEvent !== 'function') return false;
      const ev = _makeMouseEvent(el, type, init);
      if (!ev) return false;
      el.dispatchEvent(ev);
      return true;
    } catch (_) {
      return false;
    }
  }

  function _focusNoScroll(el) {
    try {
      if (!el || typeof el.focus !== 'function') return false;
      try {
        el.focus({ preventScroll: true });
      } catch (_) {
        el.focus();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function _getComboboxInput(el) {
    try {
      if (!el || el.nodeType !== 1) return null;
      const tag = (el.tagName || '').toLowerCase();
      const role = String((el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return el;
      if (role === 'combobox' && typeof el.focus === 'function') return el;
      if (el.querySelector) {
        return (
          el.querySelector('input[role="combobox"]') ||
          el.querySelector('input.select__input') ||
          el.querySelector('input[type="text"],input')
        );
      }
    } catch (_) {}
    return null;
  }

  function _findListboxForCombobox(input) {
    try {
      const doc = (input && input.ownerDocument) || document;

      // 1) aria-controls / aria-owns if present
      try {
        const listId = input.getAttribute && (input.getAttribute('aria-controls') || input.getAttribute('aria-owns'));
        if (listId) {
          const n = getById(doc, listId);
          if (n) return n;
        }
      } catch (_) {}

      // 2) React-Select conventional ids: react-select-${input.id}-listbox
      const inputId = (input.getAttribute && input.getAttribute('id')) || input.id || '';
      if (inputId) {
        try {
          const exact = getById(doc, `react-select-${inputId}-listbox`);
          if (exact) return exact;
        } catch (_) {}
      }

      // 3) Search within local container first
      try {
        const container = input.closest && input.closest('.select-shell,.select__container,.select,.Select');
        if (container && container.querySelector) {
          const local = container.querySelector('[role="listbox"],.select__menu-list,.select__menu');
          if (local) return local;
        }
      } catch (_) {}

      // 4) Global fallback: pick the best visible listbox candidate
      const candidates = Array.from(doc.querySelectorAll('[role="listbox"],.select__menu-list[aria-expanded="true"],.select__menu-list'));
      if (!candidates.length) return null;

      // Prefer ones whose id includes the input id (helps avoid unrelated listboxes)
      if (inputId) {
        const byId = candidates.find((c) => {
          try {
            const id = (c.getAttribute && c.getAttribute('id')) || c.id || '';
            return id && id.includes(inputId);
          } catch (_) {
            return false;
          }
        });
        if (byId) return byId;
      }

      // Otherwise, just pick the first non-hidden candidate
      const firstVisible = candidates.find((c) => !isProbablyHidden(c));
      return firstVisible || candidates[0] || null;
    } catch (_) {
      return null;
    }
  }

  function _extractOptionsFromListbox(listbox) {
    try {
      if (!listbox || listbox.nodeType !== 1) return [];

      const nodes = [];
      try {
        if (listbox.querySelectorAll) {
          nodes.push(...Array.from(listbox.querySelectorAll('[role="option"],.select__option')));
        }
      } catch (_) {}

      // Some listbox containers are themselves option-like; include them just in case.
      try {
        const role = (listbox.getAttribute && listbox.getAttribute('role')) || '';
        if (role === 'option') nodes.unshift(listbox);
      } catch (_) {}

      const out = [];
      const seen = new Set();
      for (const n of nodes) {
        try {
          const label = normalizeText(n.textContent || '');
          if (!label) continue;
          const value = String(
            (n.getAttribute && (n.getAttribute('data-value') || n.getAttribute('value'))) ||
              n.value ||
              ''
          );
          const v = value || label;
          const key = (label + '|' + v).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ label, value: v });
        } catch (_) {}
      }

      return out;
    } catch (_) {
      return [];
    }
  }

  function extractComboboxOptionsDynamic(el, { root = null } = {}) {
    const input = _getComboboxInput(el);
    if (!input) return { options: [], dynamicOptions: false };

    // Backup current value and selection.
    let oldValue = '';
    let oldStart = null;
    let oldEnd = null;
    try {
      oldValue = String(input.value || '');
      oldStart = (typeof input.selectionStart === 'number') ? input.selectionStart : null;
      oldEnd = (typeof input.selectionEnd === 'number') ? input.selectionEnd : null;
    } catch (_) {}

    let opened = false;

    try {
      _focusNoScroll(input);

      // Try a few common open gestures.
      _dispatchKey(input, 'keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
      _dispatchKey(input, 'keyup', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });

      _dispatchKey(input, 'keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true });
      _dispatchKey(input, 'keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true });

      // Mouse fallback: click the nearest toggle button (React-Select "Toggle flyout").
      try {
        const shell = input.closest && input.closest('.select-shell,.select__control,.select__container,.select');
        const toggle = shell && shell.querySelector
          ? shell.querySelector('button[aria-label*="Toggle"],button[aria-label*="toggle"],.select__indicator')
          : null;
        if (toggle) {
          _dispatchMouse(toggle, 'mousedown', {});
          _dispatchMouse(toggle, 'mouseup', {});
          _dispatchMouse(toggle, 'click', {});
        }
      } catch (_) {}

      try {
        opened = (input.getAttribute && input.getAttribute('aria-expanded') === 'true') || false;
      } catch (_) {}

      // Read listbox/options if present.
      const listbox = _findListboxForCombobox(input);
      const options = listbox ? _extractOptionsFromListbox(listbox) : [];

      // Close (best effort) and restore.
      _dispatchKey(input, 'keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
      _dispatchKey(input, 'keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });

      // Attempt to restore aria-expanded
      try {
        if (opened) input.setAttribute('aria-expanded', 'false');
      } catch (_) {}

      // Restore value and selection.
      try {
        if (String(input.value || '') !== oldValue) input.value = oldValue;
        if (oldStart != null && oldEnd != null && typeof input.setSelectionRange === 'function') {
          input.setSelectionRange(oldStart, oldEnd);
        }
      } catch (_) {}

      return { options, dynamicOptions: opened || (listbox && options.length > 0) };
    } catch (_) {
      // Close + restore in case of error.
      try {
        _dispatchKey(input, 'keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
        _dispatchKey(input, 'keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
      } catch (_) {}
      try {
        input.value = oldValue;
        if (oldStart != null && oldEnd != null && typeof input.setSelectionRange === 'function') {
          input.setSelectionRange(oldStart, oldEnd);
        }
      } catch (_) {}
      return { options: [], dynamicOptions: false };
    }
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
      const controls = findControlElements(root);
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
    findControlElements,
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
