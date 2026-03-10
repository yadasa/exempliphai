/*
  fillExecutor.js (Phase 2)

  Classic-script executor for FillPlan actions.

  Exposes: window.__SmartApply.fillExecutor
    - execute(planOrBundle, {root, profile?, force?, confidenceThreshold?, preferMerge?})
    - undoAll()

  Requirements from tests:
    - set_value for inputs + contenteditable
    - select_best_option for <select>
    - confidence threshold skipping
    - merging deterministic + AI plans (dedupe fingerprints)
    - audit hashes + undo stack
*/

(function initFillExecutor(global) {
  'use strict';

  // Simple 32-bit FNV-1a hash -> base36
  function hashStringFNV1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return (h >>> 0).toString(36);
  }

  function hashValue(v) {
    const t = typeof v;
    if (v == null) return `h:${t}:null`;
    if (t === 'string') return `h:s:${hashStringFNV1a(v)}`;
    if (t === 'number' || t === 'boolean') return `h:${t[0]}:${hashStringFNV1a(String(v))}`;
    // Best effort
    try {
      return `h:o:${hashStringFNV1a(JSON.stringify(v))}`;
    } catch (_) {
      return `h:o:${hashStringFNV1a(String(v))}`;
    }
  }

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
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return String(el.value ?? '');
      const ce = el.getAttribute?.('contenteditable');
      if ((ce && ce !== 'false') || el.isContentEditable) return String(el.textContent ?? '');
    } catch (_) {}
    return '';
  }

  function setElementValue(el, value) {
    // utils.js attaches these to the page realm when present.
    const setNativeValueFn = global?.setNativeValue;
    const setContentEditableValueFn = global?.setContentEditableValue;

    const tag = (el.tagName || '').toLowerCase();
    const ce = el.getAttribute?.('contenteditable');

    if ((ce && ce !== 'false') || el.isContentEditable || tag === 'div') {
      if (typeof setContentEditableValueFn === 'function') return !!setContentEditableValueFn(el, value);
      try {
        el.textContent = String(value ?? '');
        return true;
      } catch (_) {
        return false;
      }
    }

    // Linkedom's <select>.value is getter-only; set option.selected instead.
    if (tag === 'select') {
      try {
        const valStr = String(value ?? '');
        const opts = Array.from(el?.querySelectorAll ? el.querySelectorAll('option') : (el.options || []));

        for (const opt of opts) {
          // @ts-ignore
          opt.selected = false;
        }

        const matchOpt = opts.find((o) => String(o?.value ?? '') === valStr);
        if (matchOpt) {
          // @ts-ignore
          matchOpt.selected = true;
          return true;
        }
      } catch (_) {}
    }

    if (typeof setNativeValueFn === 'function') {
      try {
        setNativeValueFn(el, value);
        return true;
      } catch (_) {}
    }

    try {
      // @ts-ignore
      el.value = String(value ?? '');
      try {
        el.setAttribute('value', String(value ?? ''));
      } catch (_) {}
      return true;
    } catch (_) {
      return false;
    }
  }

  function setBestSelectOption(selectEl, fillValue) {
    try {
      if (!selectEl || (selectEl.tagName || '').toLowerCase() !== 'select') return false;
      const options = Array.from(
        selectEl?.querySelectorAll ? selectEl.querySelectorAll('option') : (selectEl.options || [])
      );
      if (!options.length) return false;

      const yesSyn = ['yes', 'true', '1'];
      const noSyn = ['no', 'false', '0', 'decline', 'prefer not'];
      const fillNorm = normalizeText(fillValue);
      const isYes = yesSyn.some((s) => fillNorm.includes(s));
      const isNo = noSyn.some((s) => fillNorm.includes(s));

      let best = { opt: null, score: 0 };
      for (const opt of options) {
        if (opt.disabled) continue;
        const label = opt.label || opt.textContent || '';
        const val = opt.value != null ? String(opt.value) : '';
        let score = Math.max(matchScore(fillValue, label), matchScore(fillValue, val));

        const optNorm = normalizeText(label || val);
        if (isYes && yesSyn.some((s) => optNorm.includes(s))) score = Math.max(score, 90);
        if (isNo && noSyn.some((s) => optNorm.includes(s))) score = Math.max(score, 90);

        if (score > best.score) best = { opt, score };
      }

      if (!best.opt || best.score < 50) return false;

      // Linkedom: setting selected=false on a later option can clear the whole
      // selection. Clear first, then set the winner last.
      for (const opt of options) {
        // @ts-ignore
        opt.selected = false;
      }
      // @ts-ignore
      best.opt.selected = true;

      try {
        const view = selectEl?.ownerDocument?.defaultView || global;
        const EventCtor = view?.Event || Event;
        selectEl.dispatchEvent(new EventCtor('input', { bubbles: true }));
        selectEl.dispatchEvent(new EventCtor('change', { bubbles: true }));
      } catch (_) {}

      return true;
    } catch (_) {
      return false;
    }
  }

  function resolveValue(valueSpec, { profile } = {}) {
    const v = valueSpec && typeof valueSpec === 'object' ? valueSpec : null;
    if (!v) return { ok: false, value: null, reason: 'missing_value' };

    if (v.source === 'skip') return { ok: false, value: null, reason: 'source_skip' };

    if (v.source === 'literal') {
      return { ok: true, value: v.literal, reason: 'literal' };
    }

    if (v.source === 'profile') {
      const key = v.source_key;
      if (!key) return { ok: false, value: null, reason: 'missing_source_key' };
      const val = profile ? profile[key] : undefined;
      if (val == null || val === '') return { ok: false, value: null, reason: 'missing_profile_value' };
      return { ok: true, value: val, reason: 'profile' };
    }

    // Other sources not needed for v0 tests.
    return { ok: false, value: null, reason: 'unsupported_source' };
  }

  function buildFingerprintIndex(root) {
    const fs = global.__SmartApply?.formSnapshot;
    if (!fs?.findControls || !fs?.stableFingerprint) return new Map();
    const scope = root || global.document;
    const controls = typeof fs.findControlElements === 'function'
      ? fs.findControlElements(scope)
      : fs.findControls(scope);
    const m = new Map();
    for (const el of controls) {
      try {
        const fp = fs.stableFingerprint(el, { root: scope });
        if (fp) m.set(fp, el);
      } catch (_) {}
    }
    return m;
  }

  function mergePlans(deterministicPlan, aiPlan, preferMerge = 'deterministic') {
    const det = deterministicPlan && Array.isArray(deterministicPlan.actions) ? deterministicPlan.actions : [];
    const ai = aiPlan && Array.isArray(aiPlan.actions) ? aiPlan.actions : [];

    const first = preferMerge === 'ai' ? ai : det;
    const second = preferMerge === 'ai' ? det : ai;

    const out = [];
    const seen = new Set();

    for (const a of first) {
      const fp = a?.field_fingerprint;
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      out.push(a);
    }
    for (const a of second) {
      const fp = a?.field_fingerprint;
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      out.push(a);
    }

    return out;
  }

  const undoStack = [];

  function pushUndo(el, oldValue) {
    undoStack.push({ el, oldValue });
  }

  function undoAll() {
    try {
      for (let i = undoStack.length - 1; i >= 0; i--) {
        const u = undoStack[i];
        if (!u?.el) continue;
        setElementValue(u.el, u.oldValue);
      }
      undoStack.length = 0;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: { message: e?.message || String(e) } };
    }
  }

  /**
   * Execute a FillPlan.
   *
   * @param {any} planOrBundle
   * @param {{root?: Element, profile?: any, force?: boolean, confidenceThreshold?: number, preferMerge?: 'deterministic'|'ai'}} opts
   */
  async function execute(planOrBundle, opts = {}) {
    const root = opts.root || global.document;
    const profile = opts.profile || null;
    const force = !!opts.force;
    const confidenceThreshold = Number.isFinite(opts.confidenceThreshold) ? opts.confidenceThreshold : 0.7;

    let plan = planOrBundle;
    let actions = [];

    if (planOrBundle && typeof planOrBundle === 'object' && (planOrBundle.deterministicPlan || planOrBundle.aiPlan)) {
      actions = mergePlans(planOrBundle.deterministicPlan, planOrBundle.aiPlan, opts.preferMerge || 'deterministic');
      plan = {
        version: '0.1',
        plan_id: 'merged',
        created_at: new Date().toISOString(),
        domain: (global.location && global.location.hostname) || 'unknown',
        page_url: (global.location && global.location.href) || 'about:blank',
        actions,
      };
    } else {
      actions = Array.isArray(plan?.actions) ? plan.actions : [];
    }

    const index = buildFingerprintIndex(root);

    const results = [];
    let applied = 0;

    for (const action of actions) {
      const action_id = action?.action_id || 'unknown';
      const fp = action?.field_fingerprint;
      const conf = action?.confidence;

      if (!force && Number.isFinite(conf) && conf < confidenceThreshold) {
        results.push({ action_id, field_fingerprint: fp, status: 'skipped_confidence' });
        continue;
      }

      const el = fp ? index.get(fp) : null;
      if (!el) {
        results.push({ action_id, field_fingerprint: fp, status: 'missing_element' });
        continue;
      }

      const allowOverwrite = action?.apply?.allow_overwrite === true;
      const cur = getElementValue(el);
      if (!allowOverwrite && cur && cur.trim().length > 0) {
        results.push({ action_id, field_fingerprint: fp, status: 'skipped_overwrite', old_hash: hashValue(cur), new_hash: hashValue(cur) });
        continue;
      }

      const rv = resolveValue(action?.value, { profile });
      if (!rv.ok) {
        results.push({ action_id, field_fingerprint: fp, status: 'skipped_no_value', reason: rv.reason, old_hash: hashValue(cur), new_hash: hashValue(cur) });
        continue;
      }

      const oldHash = hashValue(cur);

      let ok = false;
      const mode = action?.apply?.mode || 'set_value';
      if (mode === 'set_value') {
        ok = setElementValue(el, rv.value);
      } else if (mode === 'select_best_option') {
        ok = setBestSelectOption(el, String(rv.value));
      } else {
        ok = false;
      }

      const next = getElementValue(el);
      const newHash = hashValue(next);

      if (ok) {
        applied++;
        pushUndo(el, cur);
        results.push({ action_id, field_fingerprint: fp, status: 'applied', old_hash: oldHash, new_hash: newHash });
      } else {
        results.push({ action_id, field_fingerprint: fp, status: 'failed_apply', old_hash: oldHash, new_hash: newHash });
      }
    }

    return { applied, attempted: actions.length, results, plan };
  }

  global.__SmartApply = global.__SmartApply || {};
  global.__SmartApply.fillExecutor = {
    execute,
    undoAll,
    mergePlans,

    _util: { hashValue, hashStringFNV1a },
  };
})(globalThis);
