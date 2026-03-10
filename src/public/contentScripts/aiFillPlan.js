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
        if (!args?.apiKey) throw new Error('AI mapping requires Gemini API Key');
        // Use stub if gemini provider is not available in the global context
        const geminiProviderFactory = global.__exempliphaiProviders?.gemini || (() => ({ mapFieldsToFillPlan: async () => ({ actions: [] }) }));
        provider = geminiProviderFactory({ apiKey: args.apiKey, model: args.model, timeoutMs: args.timeoutMs, maxRetries: args.maxRetries });
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
    const validate = global.__exempliphaiFillPlan?.validate;
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

  /**
   * AI mapping entry point: map unresolved fields using Gemini.
   */
  global.generateTier1 = global.mapUnresolvedFieldsToFillPlan;

  // Assign constants
  global.AI_PROVIDER_INTERFACE_VERSION = '0.1';
  global.GEMINI_DEFAULT_MODEL = 'gemini-3-flash-preview';
  global.GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

})(globalThis);
