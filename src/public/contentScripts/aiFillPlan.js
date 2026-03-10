/*
  aiFillPlan.js

  Tier 1 AI mapping orchestrator (unresolved fields -> FillPlan actions).

  - Attaches to: globalThis.__SmartApply.aiFillPlan
  - Uses: globalThis.__exempliphaiProviders.gemini
          globalThis.__exempliphaiFillPlan (validator)

  Data minimization (PLAN_v2 §4.1):
  - We only send allowed profile KEYS (not values)
  - We only send unresolved field descriptors (label/role/type/options)

  Primary entrypoint:
    generateTier1(unresolvedSnapshot, profileKeys, consents)
*/

(function initAiFillPlan(global) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 20000;
  const DEFAULT_OUTER_RETRIES = 1; // additional attempts when provider throws or plan fails validation
  const MAX_ACTIONS = 64;
  const MAX_LABEL_CHARS = 180;
  const MAX_SECTION_CHARS = 120;
  const MAX_OPTION_CHARS = 120;
  const MAX_OPTIONS = 64;
  const MAX_PROFILE_KEYS = 256;
  const MAX_FIELDS = 96;

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (_) {
      return String(Date.now());
    }
  }

  function randomId(prefix) {
    const r = Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now().toString(36)}_${r}`;
  }

  function isPlainObject(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  function asNonEmptyString(x) {
    if (x == null) return '';
    const s = String(x).trim();
    return s.length ? s : '';
  }

  function normalizeText(s) {
    return asNonEmptyString(s).replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
  }

  function clampText(s, maxLen) {
    const t = normalizeText(s);
    if (!t) return '';
    if (t.length <= maxLen) return t;
    return t.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
  }

  function uniqStrings(xs) {
    const out = [];
    const seen = new Set();
    for (const x of xs || []) {
      const s = asNonEmptyString(x);
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function normalizeProfileKeys(profileKeys) {
    if (Array.isArray(profileKeys)) return uniqStrings(profileKeys).slice(0, MAX_PROFILE_KEYS);
    if (isPlainObject(profileKeys)) return uniqStrings(Object.keys(profileKeys)).slice(0, MAX_PROFILE_KEYS);
    return [];
  }

  function getDomainFromSnapshotOrLocation(unresolvedSnapshot) {
    return (
      asNonEmptyString(unresolvedSnapshot?.domain) ||
      asNonEmptyString(unresolvedSnapshot?.hostname) ||
      asNonEmptyString(global?.location?.hostname) ||
      ''
    ).toLowerCase();
  }

  function getPageUrlFromSnapshotOrLocation(unresolvedSnapshot) {
    return (
      asNonEmptyString(unresolvedSnapshot?.page_url) ||
      asNonEmptyString(unresolvedSnapshot?.pageUrl) ||
      asNonEmptyString(global?.location?.href) ||
      ''
    );
  }

  function getSnapshotHash(unresolvedSnapshot) {
    return asNonEmptyString(unresolvedSnapshot?.snapshot_hash) || asNonEmptyString(unresolvedSnapshot?.snapshotHash);
  }

  function extractUnresolvedFields(unresolvedSnapshot) {
    if (Array.isArray(unresolvedSnapshot)) return unresolvedSnapshot;
    if (!unresolvedSnapshot) return [];

    // Prefer PLAN_v2 names, but accept older variants.
    const candidates =
      unresolvedSnapshot.unresolved_fields ||
      unresolvedSnapshot.unresolvedFields ||
      unresolvedSnapshot.unresolved ||
      unresolvedSnapshot.fields ||
      unresolvedSnapshot.controls;

    return Array.isArray(candidates) ? candidates : [];
  }

  function normalizeControl(control) {
    if (!isPlainObject(control)) return undefined;
    const out = {};

    const keys = ['kind', 'tag', 'type', 'role', 'name', 'id', 'autocomplete'];
    for (const k of keys) {
      const v = asNonEmptyString(control[k]);
      if (v) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }

  function normalizeDescriptor(descriptor) {
    if (!isPlainObject(descriptor)) return undefined;

    const out = {};
    if ('label' in descriptor) {
      const l = clampText(descriptor.label, MAX_LABEL_CHARS);
      if (l) out.label = l;
    }
    if ('description' in descriptor) {
      const d = clampText(descriptor.description, MAX_LABEL_CHARS);
      if (d) out.description = d;
    }
    if ('section' in descriptor) {
      const sec = clampText(descriptor.section, MAX_SECTION_CHARS);
      if (sec) out.section = sec;
    }

    if (typeof descriptor.required === 'boolean') out.required = descriptor.required;
    if (typeof descriptor.visible === 'boolean') out.visible = descriptor.visible;

    if (Array.isArray(descriptor.options)) {
      const opts = uniqStrings(descriptor.options.map((o) => clampText(o, MAX_OPTION_CHARS))).slice(0, MAX_OPTIONS);
      if (opts.length) out.options = opts;
    }

    return Object.keys(out).length ? out : undefined;
  }

  function normalizeField(field) {
    if (!isPlainObject(field)) return null;

    const fp = asNonEmptyString(field.field_fingerprint) || asNonEmptyString(field.fieldFingerprint);
    if (!fp) return null;

    const out = { field_fingerprint: fp };

    const control = normalizeControl(field.control);
    if (control) out.control = control;

    const descriptor = normalizeDescriptor(field.descriptor);
    if (descriptor) out.descriptor = descriptor;

    return out;
  }

  const CONSENT_WORD_RE = /(agree|consent|authorize|acknowledge|terms|privacy|gdpr|ccpa)/i;

  function isLikelyConsentField(field) {
    try {
      const label = field?.descriptor?.label || '';
      const sec = field?.descriptor?.section || '';
      const name = field?.control?.name || '';
      const id = field?.control?.id || '';

      if (CONSENT_WORD_RE.test(label) || CONSENT_WORD_RE.test(sec) || CONSENT_WORD_RE.test(name) || CONSENT_WORD_RE.test(id)) {
        return true;
      }

      // Strong hint: checkbox-ish
      const kind = (field?.control?.kind || '').toLowerCase();
      const tag = (field?.control?.tag || '').toLowerCase();
      const type = (field?.control?.type || '').toLowerCase();
      if (kind.includes('checkbox') || (tag === 'input' && type === 'checkbox')) return true;

      return false;
    } catch (_) {
      return false;
    }
  }

  function buildTier1UserPayload({ domain, allowedProfileKeys, unresolvedFields, policy, pageUrl, snapshotHash }) {
    // Matches PLAN_v2 §6.2
    return {
      task: 'map_unresolved_fields_to_profile_keys',
      domain: domain || '',
      allowed_profile_keys: Array.isArray(allowedProfileKeys) ? allowedProfileKeys : [],
      policy: {
        never_autofill_consent_checkboxes: true,
        sensitive_requires_review: true,
        ...(policy || {}),
      },
      unresolved_fields: Array.isArray(unresolvedFields) ? unresolvedFields : [],
      response_requirements: {
        output: 'FillPlan',
        max_actions: MAX_ACTIONS,
      },
      // Optional extras supported by our provider prompt builder (safe metadata)
      page_url: pageUrl || undefined,
      snapshot_hash: snapshotHash || undefined,
    };
  }

  function getGeminiProvider() {
    const g = global?.__exempliphaiProviders?.gemini;
    if (g && typeof g.mapFieldsToFillPlan === 'function') return g;
    return null;
  }

  function getFillPlanValidateFn() {
    const fp = global?.__exempliphaiFillPlan;
    if (!fp) return null;
    if (typeof fp.validate === 'function') return fp.validate;
    if (typeof fp.validateFillPlan === 'function') return fp.validateFillPlan;
    return null;
  }

  function sanitizeActionValue(value, allowedProfileKeysSet) {
    // Returns a normalized value object that passes fillPlanValidator.
    if (!isPlainObject(value)) return { source: 'skip' };

    const src = asNonEmptyString(value.source);

    if (src === 'profile') {
      const k = asNonEmptyString(value.source_key);
      if (!k || !allowedProfileKeysSet.has(k)) return { source: 'skip' };
      return { source: 'profile', source_key: k };
    }

    if (src === 'resume_details') {
      // Tier1 should rarely use this; allow but keep minimal.
      return { source: 'resume_details' };
    }

    if (src === 'literal') {
      // Keep literal even if null; validator requires presence of "literal" key.
      if (!('literal' in value)) return { source: 'skip' };
      return { source: 'literal', literal: value.literal };
    }

    if (src === 'derived') {
      if (!isPlainObject(value.derived) || !asNonEmptyString(value.derived.kind)) return { source: 'skip' };
      const out = { source: 'derived', derived: { kind: asNonEmptyString(value.derived.kind) } };
      if ('args' in value.derived && isPlainObject(value.derived.args)) {
        // args may contain literals but should not contain profile values; we trust caller/provider here.
        out.derived.args = value.derived.args;
      }
      return out;
    }

    // skip or anything else
    return { source: 'skip' };
  }

  function normalizeFillPlan(rawPlan, { domain, pageUrl, snapshotHash, providerName, model, unresolvedFingerprints, allowedProfileKeysSet }) {
    if (!isPlainObject(rawPlan)) return null;

    const plan = rawPlan; // safe to mutate; this is ephemeral

    plan.version = plan.version === '0.1' ? '0.1' : '0.1';
    plan.plan_id = asNonEmptyString(plan.plan_id) || randomId('plan');
    plan.created_at = asNonEmptyString(plan.created_at) || nowIso();
    plan.domain = asNonEmptyString(plan.domain) || domain;
    plan.page_url = asNonEmptyString(plan.page_url) || pageUrl;

    if (!isPlainObject(plan.provider)) {
      plan.provider = { name: providerName || 'gemini' };
      if (model) plan.provider.model = model;
    } else {
      plan.provider.name = asNonEmptyString(plan.provider.name) || providerName || 'gemini';
      if (model && !asNonEmptyString(plan.provider.model)) plan.provider.model = model;
    }

    if (!asNonEmptyString(plan.snapshot_hash) && snapshotHash) plan.snapshot_hash = snapshotHash;

    const actionsIn = Array.isArray(plan.actions) ? plan.actions : [];
    const actionsOut = [];

    for (const a of actionsIn) {
      if (!isPlainObject(a)) continue;

      const fp = asNonEmptyString(a.field_fingerprint) || asNonEmptyString(a.fieldFingerprint);
      if (!fp) continue;
      if (unresolvedFingerprints && unresolvedFingerprints.size && !unresolvedFingerprints.has(fp)) {
        // Drop hallucinated actions.
        continue;
      }

      const action = a;
      action.action_id = asNonEmptyString(action.action_id) || randomId('a');
      action.field_fingerprint = fp;

      action.value = sanitizeActionValue(action.value, allowedProfileKeysSet || new Set());

      // If action is a "skip" after sanitization, keep it (valid plan), but callers may filter.
      actionsOut.push(action);
    }

    plan.actions = actionsOut;
    return plan;
  }

  function withTimeout(promise, timeoutMs) {
    const t = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    if (!t || t <= 0) return promise;

    let id;
    const timeoutPromise = new Promise((_, reject) => {
      id = setTimeout(() => reject(new Error('timeout')), t);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      try {
        clearTimeout(id);
      } catch (_) {}
    });
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isTransientError(e) {
    const status = e && typeof e === 'object' ? e.status : undefined;
    if (typeof status === 'number') return status === 408 || status === 429 || status >= 500;
    const msg = (e && e.message) ? String(e.message) : String(e || '');
    return /timeout|temporar|rate|429|5\d\d/i.test(msg);
  }

  function pickApiKey(consents) {
    if (!consents) return '';
    return (
      asNonEmptyString(consents.apiKey) ||
      asNonEmptyString(consents.geminiApiKey) ||
      asNonEmptyString(consents.providerApiKey) ||
      ''
    );
  }

  /**
   * generateTier1(unresolvedSnapshot, profileKeys, consents)
   *
   * @param {any} unresolvedSnapshot - Minimal unresolved snapshot (no PII values).
   * @param {string[]|Object} profileKeys - Allowed profile keys list (or key->value map; keys will be used).
   * @param {Object} consents - Provider config/consents (apiKey, per-domain allow, policy flags).
   * @returns {Promise<{ok:true, actions:any[], plan:any, prompt:any} | {ok:false, error:any, prompt:any}>}
   */
  async function generateTier1(unresolvedSnapshot, profileKeys, consents) {
    // Consent gate (soft): if explicitly disabled, do not call AI.
    if (consents && consents.allowAiMapping === false) {
      return {
        ok: false,
        error: { code: 'ai_mapping_disabled', message: 'AI mapping is disabled by user consent.' },
        prompt: null,
      };
    }

    const gemini = getGeminiProvider();
    if (!gemini) {
      return {
        ok: false,
        error: { code: 'provider_missing', message: 'Gemini provider not available on __exempliphaiProviders.gemini' },
        prompt: null,
      };
    }

    const validateFn = getFillPlanValidateFn();
    if (!validateFn) {
      return {
        ok: false,
        error: { code: 'validator_missing', message: 'FillPlan validator not available on __exempliphaiFillPlan' },
        prompt: null,
      };
    }

    const apiKey = pickApiKey(consents);
    if (!apiKey) {
      return {
        ok: false,
        error: { code: 'api_key_missing', message: 'Missing provider API key for Tier 1 mapping.' },
        prompt: null,
      };
    }

    const domain = getDomainFromSnapshotOrLocation(unresolvedSnapshot);
    const pageUrl = getPageUrlFromSnapshotOrLocation(unresolvedSnapshot);
    const snapshotHash = getSnapshotHash(unresolvedSnapshot);

    const allowedProfileKeys = normalizeProfileKeys(profileKeys);
    const allowedSet = new Set(allowedProfileKeys);

    const rawFields = extractUnresolvedFields(unresolvedSnapshot);
    const normalizedFields = [];
    const unresolvedFingerprints = new Set();

    for (const f of rawFields.slice(0, MAX_FIELDS)) {
      const nf = normalizeField(f);
      if (!nf) continue;
      // Do not send likely consent/terms checkboxes to the model.
      if (isLikelyConsentField(nf)) continue;
      normalizedFields.push(nf);
      unresolvedFingerprints.add(nf.field_fingerprint);
    }

    const policy = {
      never_autofill_consent_checkboxes: true,
      // If user explicitly allows sensitive autofill, we can relax review requirement.
      // Default is strict (review required).
      sensitive_requires_review: consents?.allowSensitiveAutofill === true ? false : true,
    };

    const promptObj = buildTier1UserPayload({
      domain,
      allowedProfileKeys,
      unresolvedFields: normalizedFields,
      policy,
      pageUrl,
      snapshotHash,
    });

    // Provider args (Gemini provider will build its own system+user prompts).
    const providerArgs = {
      apiKey,
      domain,
      allowedProfileKeys,
      unresolvedFields: normalizedFields,
      policy,
      pageUrl,
      snapshotHash,
      timeoutMs: Number.isFinite(consents?.timeoutMs) ? consents.timeoutMs : DEFAULT_TIMEOUT_MS,
      maxRetries: Number.isFinite(consents?.maxRetries) ? consents.maxRetries : 2,
      model: asNonEmptyString(consents?.model) || undefined,
    };

    const outerRetries = Number.isFinite(consents?.outerRetries) ? consents.outerRetries : DEFAULT_OUTER_RETRIES;

    let lastErr = null;
    for (let attempt = 0; attempt <= outerRetries; attempt++) {
      try {
        const rawPlan = await withTimeout(
          gemini.mapFieldsToFillPlan(providerArgs),
          providerArgs.timeoutMs
        );

        const plan = normalizeFillPlan(rawPlan, {
          domain,
          pageUrl,
          snapshotHash,
          providerName: 'gemini',
          model: providerArgs.model,
          unresolvedFingerprints,
          allowedProfileKeysSet: allowedSet,
        });

        if (!plan) throw new Error('provider_returned_non_object_plan');

        const res = validateFn(plan);
        if (!res || res.ok !== true) {
          const err = new Error('invalid_fill_plan');
          // @ts-ignore
          err.validation = res;
          throw err;
        }

        const actions = Array.isArray(plan.actions) ? plan.actions : [];
        // Return only actionable actions (skip actions represent explicit rejects).
        const actionable = actions.filter((a) => a && a.value && a.value.source !== 'skip');

        return { ok: true, actions: actionable, plan, prompt: promptObj };
      } catch (e) {
        lastErr = e;

        const canRetry = attempt < outerRetries && isTransientError(e);
        if (!canRetry) {
          const validation = e && typeof e === 'object' ? e.validation : null;
          return {
            ok: false,
            error: {
              code: 'tier1_failed',
              message: (e && e.message) ? String(e.message) : 'Tier 1 mapping failed',
              transient: isTransientError(e),
              ...(validation ? { validation } : {}),
            },
            prompt: promptObj,
          };
        }

        await sleep(250 * Math.pow(2, attempt));
      }
    }

    return {
      ok: false,
      error: { code: 'tier1_failed', message: (lastErr && lastErr.message) ? String(lastErr.message) : 'Tier 1 mapping failed' },
      prompt: promptObj,
    };
  }

  global.__SmartApply = global.__SmartApply || {};
  global.__SmartApply.aiFillPlan = {
    generateTier1,

    // exposed for tests / debugging
    _buildTier1UserPayload: buildTier1UserPayload,
    _normalizeFillPlan: normalizeFillPlan,
  };
})(globalThis);
