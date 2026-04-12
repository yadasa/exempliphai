/*
  policy.js (Phase 2)

  Classic-script policy gates.

  Exposes: window.__SmartApply.policy
    - isConsentCheckbox({label})
    - isSensitiveField({label, section})
    - classifySensitiveCategory({label, section}) -> 'eeo' | 'none'
    - checkDomainConsent(domain, settings)
    - applyPolicy(action, {domainConsent}) -> sanitized action (non-mutating)
    - filterSnapshot(snapshot) -> snapshot with consent-like fields removed
*/

(function initPolicy(global) {
  'use strict';

  function normalizeText(str) {
    return (str ?? '')
      .toString()
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  const CONSENT_HINTS = [
    'agree',
    'consent',
    'acknowledg',
    'accept',
    'terms',
    'privacy',
    'gdpr',
    'ccpa',
    'waiver',
    'release',
    'attest',
    'certify',
    'signature',
    'sign',
  ];

  const EEO_HINTS = [
    'equal employment',
    'eeo',
    'race',
    'ethnicity',
    'hispanic',
    'latino',
    'gender',
    'pronoun',
    'veteran',
    'disability',
    'sexual orientation',
    'self identify',
    'self-identify',
    'voluntary disclosures',
    'voluntary self identification',
    'voluntary self-identification',
  ];

  const OTHER_SENSITIVE_HINTS = [
    // immigration / age-related
    'visa',
    'work authorization',
    'citizenship',
    'age',
    'date of birth',
    'dob',
  ];

  function isConsentCheckbox({ label = '' } = {}) {
    const t = normalizeText(label);
    if (!t) return false;
    return CONSENT_HINTS.some((h) => t.includes(h));
  }

  function classifySensitiveCategory({ label = '', section = '' } = {}) {
    const hay = `${normalizeText(label)} ${normalizeText(section)}`.trim();
    if (!hay) return 'none';
    if (EEO_HINTS.some((h) => hay.includes(normalizeText(h)))) return 'eeo';
    return 'none';
  }

  function isSensitiveField({ label = '', section = '' } = {}) {
    const hay = `${normalizeText(label)} ${normalizeText(section)}`.trim();
    if (!hay) return false;
    if (EEO_HINTS.some((h) => hay.includes(normalizeText(h)))) return true;
    if (OTHER_SENSITIVE_HINTS.some((h) => hay.includes(normalizeText(h)))) return true;
    return false;
  }

  function normalizeDomain(domain) {
    const d = (domain ?? '').toString().toLowerCase().trim();
    if (!d) return '';
    return d.startsWith('www.') ? d.slice(4) : d;
  }

  function checkDomainConsent(domain, settings = {}) {
    const d = normalizeDomain(domain);
    const enabled = !!settings.aiMappingEnabled;
    const allowMap = settings.allowAiMapping && typeof settings.allowAiMapping === 'object' ? settings.allowAiMapping : {};
    return enabled && !!allowMap[d];
  }

  function deepCloneJson(x) {
    try {
      return JSON.parse(JSON.stringify(x));
    } catch (_) {
      return x;
    }
  }

  function applyPolicy(action, { domainConsent = false } = {}) {
    const a = deepCloneJson(action || {});
    a.policy = a.policy && typeof a.policy === 'object' ? a.policy : {};

    const label = a?.descriptor?.label || '';
    const section = a?.descriptor?.section || '';

    // 1) Consent-like: force skip, regardless of mode.
    if (isConsentCheckbox({ label })) {
      a.value = { source: 'skip' };
      a.policy.blocked = true;
      a.policy.block_reason = 'consent_checkbox';
      a.policy.requires_explicit_consent = true;
      return a;
    }

    // 2) Sensitive fields: mark review unless explicit domain consent exists.
    if (isSensitiveField({ label, section })) {
      a.policy.sensitive_category = classifySensitiveCategory({ label, section });
      if (!domainConsent) {
        a.policy.requires_review = true;
      }
    }

    return a;
  }

  function filterSnapshot(snapshot) {
    const s = deepCloneJson(snapshot || {});
    const fields = Array.isArray(s.unresolved_fields) ? s.unresolved_fields : [];
    s.unresolved_fields = fields.filter((f) => !isConsentCheckbox({ label: f?.descriptor?.label || '' }));
    return s;
  }

  global.__SmartApply = global.__SmartApply || {};
  global.__SmartApply.policy = {
    isConsentCheckbox,
    isSensitiveField,
    classifySensitiveCategory,
    checkDomainConsent,
    applyPolicy,
    filterSnapshot,

    // debug
    _util: { normalizeText, normalizeDomain },
  };
})(globalThis);
