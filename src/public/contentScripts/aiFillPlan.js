/**
 * aiFillPlan.js — orchestrate Tier-1 AI mapping (unresolved fields -> FillPlan)
 *
 * Design:
 * - This aims to be a classic IIFE that attaches to globalThis.__SmartApply.aiFillPlan.
 * - Data minimization: callers should provide allowed profile *keys* only; this
 *   module never requires profile values.
 */

(function initAiFillPlan(global) {
  'use strict';

  function randId(prefix = 'id') {
    return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }

  function ensureTopLevel(plan, { domain, pageUrl, providerName, model } = {}) {
    const nowIso = new Date().toISOString();
    const out = { ...plan };

    out.version = out.version || '0.1';
    out.plan_id = out.plan_id || randId('plan');
    out.created_at = out.created_at || nowIso;
    out.domain = out.domain || domain || '';
    out.page_url = out.page_url || pageUrl || '';

    if (!out.provider) {
      out.provider = { name: providerName || 'gemini', model: model || undefined };
    } else {
      out.provider = { ...out.provider };
      if (!out.provider.name) out.provider.name = providerName || 'gemini';
      if (!out.provider.model && model) out.provider.model = model;
    }

    if (!Array.isArray(out.actions)) out.actions = [];
    return out;
  }

  /**
   * Map unresolved fields to a FillPlan using an AI provider.
   *
   * @param {{
   *   provider?: any,
   *   providerName?: 'gemini',
   *   apiKey?: string,
   *   model?: string,
   *   domain: string,
   *   pageUrl: string,
   *   allowedProfileKeys: string[],
   *   unresolvedFields: any[],
   *   policy?: any,
   *   snapshotHash?: string,
   *   timeoutMs?: number,
   *   maxRetries?: number,
   * }} args
   */
  global.mapUnresolvedFieldsToFillPlan = async function mapUnresolvedFieldsToFillPlan(args) {
    const domain = args?.domain || '';
    const pageUrl = args?.pageUrl || '';
    const providerName = args?.providerName || 'gemini';

    const allowedProfileKeys = Array.isArray(args?.allowedProfileKeys) ? args.allowedProfileKeys : [];
    const unresolvedFields = Array.isArray(args?.unresolvedFields) ? args.unresolvedFields : [];

    if (!unresolvedFields.length) {
      return {
        version: '0.1',
        plan_id: randId('plan'),
        created_at: new Date().toISOString(),
        domain,
        page_url: pageUrl,
        provider: { name: providerName },
        actions: [],
      };
    }

    let provider = args?.provider;
    if (!provider) {
      if (providerName === 'gemini') {
        // Proxy-only: client Gemini API keys are no longer required.
        // Support either a provider factory or a provider object in the global context.
        const gemini = global.__SmartApplyProviders?.gemini;
        if (typeof gemini === 'function') {
          provider = gemini({ apiKey: args.apiKey, model: args.model, timeoutMs: args.timeoutMs, maxRetries: args.maxRetries });
        } else {
          provider = gemini || { mapFieldsToFillPlan: async () => ({ actions: [] }) };
        }
      } else {
        throw new Error(`Unknown provider: ${providerName}`);
      }
    }

    const planRaw = await provider.mapFieldsToFillPlan({
      apiKey: args?.apiKey,
      model: args?.model,
      domain,
      pageUrl,
      snapshotHash: args?.snapshotHash,
      allowedProfileKeys,
      unresolvedFields,
      policy: args?.policy,
      timeoutMs: args?.timeoutMs,
      maxRetries: args?.maxRetries,
    });

    const plan = ensureTopLevel(planRaw, { domain, pageUrl, providerName, model: args?.model });

    // Ensure actions are at least minimally shaped.
    plan.actions = (plan.actions || []).map((a) => ({
      action_id: a?.action_id || randId('a'),
      ...a,
    }));

    // get validateFillPlan from global context
    const validate = global.__SmartApplyFillPlan?.validate;
    const v = validate ? validate(plan) : { ok: false, errors: [{path: '', message: 'validateFillPlan not found in global context'}] };

    if (!v.ok) {
      const msg = v.errors.map((e) => `${e.path || '<root>'}: ${e.message}`).join('\n');
      const err = new Error(`AI FillPlan failed validation:\n${msg}`);
      err.validationErrors = v.errors;
      err.plan = plan;
      throw err;
    }

    return plan;
  }

  /**
   * Convenience: extract allowedProfileKeys from a sync storage object.
   * Never returns values; filters obvious non-profile keys.
   */
  global.allowedProfileKeysFromSyncObject = function allowedProfileKeysFromSyncObject(syncObj) {
    const obj = syncObj && typeof syncObj === 'object' ? syncObj : {};
    const keys = Object.keys(obj);

    const blocked = new Set(['API Key']);
    return keys
      .filter((k) => !blocked.has(k))
      .filter((k) => typeof k === 'string' && k.trim().length > 0)
      .filter((k) => !k.includes('@'))
      .filter((k) => !/\d{6,}/.test(k));
  }

  function _err(code, message, extra = {}) {
    return { code, message, ...extra };
  }

  function _isTransientProviderError(e) {
    try {
      const status = e && (e.status || e.statusCode);
      if ([408, 425, 429, 500, 502, 503, 504].includes(Number(status))) return true;
      const msg = String(e && e.message ? e.message : '').toLowerCase();
      if (msg.includes('timeout') || msg.includes('timed out')) return true;
      if (msg.includes('network') || msg.includes('temporarily')) return true;
    } catch (_) {}
    return false;
  }

  function _sanitizeValue(value, allowedProfileKeysSet) {
    try {
      const v = value && typeof value === 'object' ? { ...value } : {};
      const source = String(v.source || 'skip');

      if (source === 'skip') return { source: 'skip' };

      if (source === 'profile') {
        const k = v.source_key;
        if (!k || !allowedProfileKeysSet || !allowedProfileKeysSet.has(String(k))) return { source: 'skip' };
        return { source: 'profile', source_key: String(k) };
      }

      if (source === 'literal') {
        if (typeof v.literal !== 'string' || !v.literal.trim()) return { source: 'skip' };
        return { source: 'literal', literal: String(v.literal) };
      }

      if (source === 'derived') {
        if (typeof v.derived !== 'string' || !v.derived.trim()) return { source: 'skip' };
        return { source: 'derived', derived: String(v.derived) };
      }

      if (source === 'resume_details') {
        const k = v.resume_details_key;
        if (!k || typeof k !== 'string' || !k.trim()) return { source: 'skip' };
        return { source: 'resume_details', resume_details_key: k };
      }

      // Unknown / unsupported source
      return { source: 'skip' };
    } catch (_) {}
    return { source: 'skip' };
  }

  function _sanitizeActions(actions, { allowedFpsSet, allowedProfileKeysSet } = {}) {
    const out = [];
    const seen = new Set();

    for (const a of Array.isArray(actions) ? actions : []) {
      try {
        const fp = String(a && a.field_fingerprint ? a.field_fingerprint : '');
        if (!fp) continue;
        if (allowedFpsSet && !allowedFpsSet.has(fp)) continue; // drop hallucinations
        if (seen.has(fp)) continue; // de-dupe by fingerprint (first wins)
        seen.add(fp);

        const action = { ...a };
        action.action_id = action.action_id || randId('a');
        action.field_fingerprint = fp;
        action.value = _sanitizeValue(action.value, allowedProfileKeysSet);
        out.push(action);
      } catch (_) {}
    }

    return out;
  }

  /**
   * AI mapping entry point: Tier-1 orchestration.
   *
   * Signature expected by unit tests + autofill:
   *   generateTier1(snapshot, allowedProfileKeys, consents)
   */
  global.generateTier1 = async function generateTier1(snapshot, allowedProfileKeys, consents = {}) {
    const allowAiMapping = !!consents?.allowAiMapping;
    if (!allowAiMapping) {
      return { ok: false, actions: [], plan: null, error: _err('ai_mapping_disabled', 'AI mapping disabled') };
    }

    // Proxy-only: AI calls go through the authenticated AI_PROXY service worker route.
    // Client API keys are no longer required.
    const apiKey = consents?.apiKey; // kept for backwards compatibility (ignored by proxy provider)

    const domain = snapshot?.domain || global.location?.hostname || '';
    const pageUrl = snapshot?.page_url || global.location?.href || '';
    const snapshotHash = snapshot?.snapshot_hash || '';

    const policy = global.__SmartApply?.policy;
    const filteredSnapshot = policy?.filterSnapshot ? policy.filterSnapshot(snapshot) : (snapshot || {});

    const unresolvedFields = Array.isArray(filteredSnapshot?.unresolved_fields)
      ? filteredSnapshot.unresolved_fields
      : [];

    const allowedKeys = Array.isArray(allowedProfileKeys) ? allowedProfileKeys.filter(Boolean).map(String) : [];
    const allowedProfileKeysSet = new Set(allowedKeys);
    const allowedFpsSet = new Set(unresolvedFields.map((f) => String(f?.field_fingerprint || '')).filter(Boolean));

    // Resolve provider (supports either a factory or a provider object).
    let provider = consents?.provider;
    if (!provider) {
      const gemini = global.__SmartApplyProviders?.gemini;
      if (typeof gemini === 'function') {
        provider = gemini({ apiKey, model: consents?.model, timeoutMs: consents?.timeoutMs, maxRetries: consents?.maxRetries });
      } else {
        provider = gemini;
      }
    }

    if (!provider || typeof provider.mapFieldsToFillPlan !== 'function') {
      return { ok: false, actions: [], plan: null, error: _err('provider_missing', 'AI provider not available') };
    }

    // If nothing to map after filtering, return an empty-but-valid plan.
    if (!unresolvedFields.length) {
      const plan0 = ensureTopLevel({ actions: [] }, { domain, pageUrl, providerName: 'gemini', model: consents?.model });
      if (snapshotHash) plan0.snapshot_hash = snapshotHash;
      return { ok: true, actions: [], plan: plan0, error: null };
    }

    const outerRetries = Number.isFinite(consents?.outerRetries) ? Number(consents.outerRetries) : 0;

    try {
      let planRaw = null;
      let attempt = 0;
      // Retry loop for transient provider errors
      while (true) {
        try {
          planRaw = await provider.mapFieldsToFillPlan({
            apiKey,
            model: consents?.model,
            domain,
            pageUrl,
            snapshotHash,
            allowedProfileKeys: allowedKeys,
            unresolvedFields,
            policy,
            timeoutMs: consents?.timeoutMs,
            maxRetries: consents?.maxRetries,
          });
          break;
        } catch (e) {
          if (attempt < outerRetries && _isTransientProviderError(e)) {
            attempt++;
            continue;
          }
          throw e;
        }
      }

      const plan = ensureTopLevel(planRaw || {}, { domain, pageUrl, providerName: 'gemini', model: consents?.model });
      if (snapshotHash && !plan.snapshot_hash) plan.snapshot_hash = snapshotHash;

      plan.actions = _sanitizeActions(plan.actions || [], { allowedFpsSet, allowedProfileKeysSet });

      // Validate after sanitization
      const validate = global.__SmartApplyFillPlan?.validate;
      const v = validate ? validate(plan) : { ok: false, errors: [{ path: '', message: 'validateFillPlan not found in global context' }] };
      if (!v.ok) {
        const msg = (v.errors || []).map((e) => `${e.path || '<root>'}: ${e.message}`).join('\n');
        return { ok: false, actions: [], plan, error: _err('plan_invalid', msg, { errors: v.errors }) };
      }

      const actions = (plan.actions || []).filter((a) => a?.value?.source && a.value.source !== 'skip');
      return { ok: true, actions, plan, error: null };
    } catch (e) {
      return {
        ok: false,
        actions: [],
        plan: null,
        error: _err('ai_mapping_failed', String(e && e.message ? e.message : e || 'AI mapping failed')),
      };
    }
  };

  // Assign constants
  global.AI_PROVIDER_INTERFACE_VERSION = '0.1';
  global.GEMINI_DEFAULT_MODEL = 'gemini-3-flash-preview';
  global.GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  // Attach to SmartApply namespace (used by other content scripts + unit tests)
  global.__SmartApply = global.__SmartApply || {};
  global.__SmartApply.aiFillPlan = {
    mapUnresolvedFieldsToFillPlan: global.mapUnresolvedFieldsToFillPlan,
    allowedProfileKeysFromSyncObject: global.allowedProfileKeysFromSyncObject,
    generateTier1: global.generateTier1,
    AI_PROVIDER_INTERFACE_VERSION: global.AI_PROVIDER_INTERFACE_VERSION,
    GEMINI_DEFAULT_MODEL: global.GEMINI_DEFAULT_MODEL,
    GEMINI_API_BASE: global.GEMINI_API_BASE,
  };

})(globalThis);
