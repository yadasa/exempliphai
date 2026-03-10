/*
  policy.js

  Policy gating helpers for AI-assisted mapping/fill actions.

  Goals (PLAN_v2):
  - Never auto-check consent/terms/privacy checkboxes.
  - Mark sensitive fields (EEO/disability/veteran/visa/age, etc.) as requiring review
    unless the user has granted explicit per-domain consent for AI mapping.
  - Provide a pre-filter for form snapshots before sending to AI.

  This file is a classic content-script (no ESM exports). It attaches to:
    window.__SmartApply.policy
*/

(function initPolicy(global) {
  'use strict';

  function norm(s) {
    return (s ?? '')
      .toString()
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getDescriptorText(descriptor) {
    // Support either a descriptor object, or a field/action object with .descriptor.
    const d = descriptor && descriptor.descriptor ? descriptor.descriptor : descriptor;
    if (!d || typeof d !== 'object') return '';

    const parts = [];
    if (typeof d.label === 'string') parts.push(d.label);
    if (typeof d.section === 'string') parts.push(d.section);
    if (typeof d.description === 'string') parts.push(d.description);
    return norm(parts.filter(Boolean).join(' | '));
  }

  function isConsentCheckbox(descriptor) {
    const t = getDescriptorText(descriptor);
    if (!t) return false;

    // Intentional broad matching: better to over-block than auto-consent.
    const patterns = [
      /\bagree\b/, // "I agree"
      /\bconsent\b/, // "I consent"
      /\bterms\b/, // "terms", "terms of service"
      /\bprivacy\b/, // "privacy policy"
    ];

    return patterns.some((re) => re.test(t));
  }

  function isSensitiveField(descriptor) {
    const t = getDescriptorText(descriptor);
    if (!t) return false;

    // Sensitive buckets referenced by PLAN_v2 and DATA_FIELDS.md.
    // NOTE: This is a heuristic, not a legal classifier.
    const patterns = [
      /\beeo\b/, // "EEO", "EEO-1"
      /equal employment opportunity/, 
      /\bgender\b/,
      /\brace\b/,
      /\bethnicity\b/,
      /hispanic|latino/,
      /\bveteran\b/,
      /\bdisabilit(y|ies)\b/,
      /\bada\b/, // Americans with Disabilities Act
      /\bvisa\b/, // visa status
      /\bimmigration\b/,
      /\bage\b/,
      /date of birth|\bdob\b|birth\s*day|birthday/,
    ];

    return patterns.some((re) => re.test(t));
  }

  /**
   * Domain-level consent check for AI mapping.
   *
   * Per PLAN_v2, consent is granted only if:
   *   setting.aiMappingEnabled === true
   *   AND setting.allowAiMapping[domain] === true
   *
   * @param {string} domain
   * @param {any} setting - object read from storage
   */
  function checkDomainConsent(domain, setting) {
    const d = norm(domain).replace(/^www\./, '');
    if (!d) return false;

    const s = setting && typeof setting === 'object' ? setting : {};
    const aiMappingEnabled = s.aiMappingEnabled === true;

    let allow = s.allowAiMapping;
    if (typeof allow === 'string') {
      try {
        allow = JSON.parse(allow);
      } catch (_) {
        allow = null;
      }
    }
    if (!allow || typeof allow !== 'object') allow = {};

    const v = allow[d];
    return aiMappingEnabled && v === true;
  }

  /**
   * Apply policy to a single FillPlan action.
   *
   * - Consent/terms/privacy checkboxes: blocked (forced to skip)
   * - Sensitive fields: require review unless domainConsent=true
   *
   * @param {any} action
   * @param {object} [ctx]
   * @param {string} [ctx.domain]
   * @param {any} [ctx.setting]
   * @param {boolean} [ctx.domainConsent]
   * @returns {any} newAction (does not mutate the input)
   */
  function applyPolicy(action, ctx) {
    const a = action && typeof action === 'object' ? { ...action } : {};
    a.policy = { ...(a.policy || {}) };

    const domain = ctx && typeof ctx === 'object' ? (ctx.domain || a.domain) : a.domain;
    const setting = ctx && typeof ctx === 'object' ? (ctx.setting || ctx.settings) : undefined;

    let domainConsent = ctx && typeof ctx === 'object' ? ctx.domainConsent : undefined;
    if (domainConsent == null && domain && setting) {
      domainConsent = checkDomainConsent(domain, setting);
    }
    domainConsent = domainConsent === true;

    const desc = a.descriptor || a;

    // 1) Block consent checkboxes.
    if (isConsentCheckbox(desc)) {
      a.policy.blocked = true;
      a.policy.block_reason = 'consent_checkbox';
      a.policy.requires_explicit_consent = true;

      // Make it safe for the executor: force to skip.
      a.value = { source: 'skip' };
      return a;
    }

    // 2) Flag sensitive fields.
    const sensitive = isSensitiveField(desc);
    if (sensitive) {
      if (!a.policy.sensitive_category) a.policy.sensitive_category = 'eeo';
      if (!domainConsent) a.policy.requires_review = true;
    } else {
      if (!a.policy.sensitive_category) a.policy.sensitive_category = 'none';
    }

    return a;
  }

  /**
   * Pre-filter a snapshot before sending to AI.
   *
   * The codebase doesn't yet have a single canonical snapshot shape.
   * This function handles the likely shapes:
   *   - { fields: [...] }
   *   - { controls: [...] }
   *   - { unresolved_fields: [...] }
   *   - [...] (array)
   *
   * @param {any} snapshot
   * @param {any} consents - optional list/set of fingerprints to skip
   */
  function filterSnapshot(snapshot, consents) {
    const skip = new Set();

    // consents may be:
    //  - array of fingerprints
    //  - { skipFingerprints: [...] }
    //  - { blockedFingerprints: [...] }
    if (Array.isArray(consents)) {
      for (const x of consents) if (typeof x === 'string' && x) skip.add(x);
    } else if (consents && typeof consents === 'object') {
      const arr = consents.skipFingerprints || consents.blockedFingerprints;
      if (Array.isArray(arr)) {
        for (const x of arr) if (typeof x === 'string' && x) skip.add(x);
      }
    }

    function keepField(f) {
      if (!f || typeof f !== 'object') return false;

      const fp = f.field_fingerprint || f.fingerprint || f.id;
      if (typeof fp === 'string' && skip.has(fp)) return false;

      const desc = f.descriptor || f;
      if (isConsentCheckbox(desc)) return false;

      return true;
    }

    if (Array.isArray(snapshot)) {
      return snapshot.filter(keepField);
    }

    if (!snapshot || typeof snapshot !== 'object') return snapshot;

    const out = { ...snapshot };
    for (const key of ['fields', 'controls', 'unresolved_fields']) {
      if (Array.isArray(out[key])) out[key] = out[key].filter(keepField);
    }

    return out;
  }

  global.__SmartApply = global.__SmartApply || {};
  global.__SmartApply.policy = {
    isConsentCheckbox,
    isSensitiveField,
    applyPolicy,
    filterSnapshot,
    checkDomainConsent,

    // debugging
    _util: { norm, getDescriptorText },
  };
})(globalThis);
