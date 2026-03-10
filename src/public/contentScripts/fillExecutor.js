/**
 * fillExecutor.js — apply FillPlan actions to the DOM (Phase 2)
 *
 * This file is ESM so it can be tested in Node and loaded via dynamic import
 * from classic content scripts.
 */

import { policyDecision } from './policy.js';

function normalizeText(str) {
  return (str ?? '')
    .toString()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchScore(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 90;

  const aTokens = new Set(na.split(' '));
  const bTokens = new Set(nb.split(' '));
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  const union = aTokens.size + bTokens.size - inter;
  const jaccard = union ? inter / union : 0;
  let score = Math.round(60 * jaccard);
  if (inter >= 2) score += 10;
  return score;
}

function getElementValue(el) {
  try {
    if (!el) return '';
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return String(el.value || '');
    const ce = el.getAttribute?.('contenteditable');
    if (ce && ce !== 'false') return String(el.textContent || '');
  } catch (_) {}
  return '';
}

function setBestSelectOption(selectEl, fillValue) {
  try {
    if (!selectEl || (selectEl.tagName || '').toLowerCase() !== 'select') return false;
    const options = Array.from(selectEl.options || []);
    if (!options.length) return false;

    let best = { opt: null, score: 0 };
    for (const opt of options) {
      if (opt.disabled) continue;
      const label = opt.label || opt.textContent || '';
      const v = opt.value != null ? String(opt.value) : '';
      const score = Math.max(matchScore(fillValue, label), matchScore(fillValue, v));
      if (score > best.score) best = { opt, score };
    }

    if (!best.opt || best.score < 50) return false;

    selectEl.value = best.opt.value;
    best.opt.selected = true;
    try {
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}

    return true;
  } catch (_) {
    return false;
  }
}

function applyStringTransforms(value, steps = []) {
  let v = value;
  if (v == null) return v;

  for (const step of Array.isArray(steps) ? steps : []) {
    const op = step?.op;
    if (typeof op !== 'string') continue;
    if (op === 'trim') {
      v = String(v).trim();
    } else if (op === 'collapse_whitespace') {
      v = String(v)
        .replace(/\s+/g, ' ')
        .trim();
    } else if (op === 'ensure_https') {
      const s = String(v).trim();
      if (s && !/^https?:\/\//i.test(s)) v = 'https://' + s;
      else v = s;
    }
  }
  return v;
}

/**
 * Build a mapping of field_fingerprint -> element.
 *
 * @param {{root: Element|Document, findControls: Function, stableFingerprint: Function}} args
 */
export function buildFingerprintIndex({ root, findControls, stableFingerprint }) {
  const scope = root || document;
  const controls = findControls ? findControls(scope) : Array.from(scope.querySelectorAll('input,textarea,select,[contenteditable], [role="textbox"], [role="combobox"]'));
  const index = new Map();
  for (const el of controls) {
    try {
      const fp = stableFingerprint(el, { root: scope });
      if (fp) index.set(fp, el);
    } catch (_) {}
  }
  return index;
}

function inferSectionFromContext(sectionCtx) {
  if (!sectionCtx) return '';
  const parts = [];
  if (sectionCtx.legend) parts.push(sectionCtx.legend);
  if (Array.isArray(sectionCtx.headings) && sectionCtx.headings.length) parts.push(sectionCtx.headings.join(' > '));
  return parts.filter(Boolean).join(' | ');
}

/**
 * Apply a FillPlan against the current DOM.
 *
 * @param {{
 *   plan: any,
 *   root: Element|Document,
 *   profile: Record<string, any>,
 *   index: Map<string, Element>,
 *   formSnapshot: { computeBestLabel: Function, extractSectionContext: Function },
 *   allowSensitive?: boolean,
 *   defaultAllowOverwrite?: boolean,
 *   setNativeValue?: Function,
 *   setContentEditableValue?: Function,
 * }} args
 */
export async function applyFillPlan(args) {
  const plan = args?.plan;
  const profile = args?.profile || {};
  const index = args?.index;
  const fs = args?.formSnapshot;

  const setNativeValue = args?.setNativeValue || globalThis.setNativeValue;
  const setContentEditableValue = args?.setContentEditableValue || globalThis.setContentEditableValue;

  const report = {
    attempted: 0,
    applied: 0,
    skipped: 0,
    details: [],
  };

  if (!plan || !Array.isArray(plan.actions) || !index) return report;

  for (const action of plan.actions) {
    report.attempted++;

    const fp = action?.field_fingerprint;
    const el = fp ? index.get(fp) : null;
    if (!el) {
      report.skipped++;
      report.details.push({ fp, status: 'skip', reason: 'element_not_found' });
      continue;
    }

    const label = fs?.computeBestLabel ? fs.computeBestLabel(el) : '';
    const sectionCtx = fs?.extractSectionContext ? fs.extractSectionContext(el) : null;
    const section = inferSectionFromContext(sectionCtx);

    const dec = policyDecision({ label, section }, { allowSensitive: !!args?.allowSensitive });
    if (!dec.allow) {
      report.skipped++;
      report.details.push({ fp, status: 'skip', reason: dec.reason });
      continue;
    }

    const allowOverwrite =
      (action?.apply && typeof action.apply.allow_overwrite === 'boolean'
        ? action.apply.allow_overwrite
        : !!args?.defaultAllowOverwrite);

    const cur = getElementValue(el);
    if (!allowOverwrite && cur && cur.trim().length > 0) {
      report.skipped++;
      report.details.push({ fp, status: 'skip', reason: 'already_has_value' });
      continue;
    }

    // Resolve value
    const val = action?.value;
    if (!val || typeof val !== 'object') {
      report.skipped++;
      report.details.push({ fp, status: 'skip', reason: 'missing_value' });
      continue;
    }

    let fillValue = null;
    if (val.source === 'skip') {
      report.skipped++;
      report.details.push({ fp, status: 'skip', reason: 'source_skip' });
      continue;
    }
    if (val.source === 'profile') {
      fillValue = profile[val.source_key];
    } else if (val.source === 'literal') {
      fillValue = val.literal;
    } else {
      // Phase 2 executor focuses on profile/literal; other sources can be added later.
      fillValue = null;
    }

    if (fillValue == null || fillValue === '') {
      report.skipped++;
      report.details.push({ fp, status: 'skip', reason: 'no_fill_value' });
      continue;
    }

    fillValue = applyStringTransforms(fillValue, action?.transform);

    // Apply
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    let ok = false;

    try {
      if (tag === 'select') {
        ok = setBestSelectOption(el, String(fillValue));
      } else if (type === 'checkbox' || type === 'radio') {
        // Conservative: do not click boolean controls via AI mapping in v0.
        ok = false;
      } else {
        // contenteditable
        const ce = el.getAttribute?.('contenteditable');
        if ((ce && ce !== 'false') || el.isContentEditable) {
          ok = !!setContentEditableValue && setContentEditableValue(el, String(fillValue));
        } else {
          ok = !!setNativeValue && setNativeValue(el, String(fillValue));
          if (!ok) {
            // fallback for non-standard elements
            try {
              // @ts-ignore
              el.value = String(fillValue);
              ok = true;
            } catch (_) {}
          }
        }

        try {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) {}
      }
    } catch (_) {
      ok = false;
    }

    if (ok) {
      report.applied++;
      report.details.push({ fp, status: 'applied', label });
    } else {
      report.skipped++;
      report.details.push({ fp, status: 'skip', reason: 'apply_failed', label });
    }
  }

  return report;
}
