/**
 * policy.js — autofill safety / privacy gates (Phase 2)
 *
 * Goals:
 * - Never auto-fill consent/terms/acknowledgement checkboxes
 * - Treat EEO-style fields as sensitive (default: do not fill via AI mapping)
 * - Keep logic lightweight + deterministic
 */

function normalizeText(str) {
  return (str ?? '')
    .toString()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const CONSENT_TOKENS = [
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

const SENSITIVE_EEO_TOKENS = [
  'equal employment',
  'eeo',
  'race',
  'ethnicity',
  'hispanic',
  'latino',
  'gender',
  'sexual orientation',
  'disability',
  'veteran',
  'protected veteran',
  'pronouns',
  'self identify',
  'self-identify',
  'voluntary disclosures',
  'voluntary self identification',
  'voluntary self-identification',
];

/**
 * @param {string} label
 * @param {string} [section]
 */
export function isConsentLikeField(label, section = '') {
  const t = normalizeText(label);
  const s = normalizeText(section);
  if (!t && !s) return false;

  // Consent tends to be explicit; require a strong keyword.
  const hay = `${t} ${s}`.trim();
  return CONSENT_TOKENS.some((tok) => hay.includes(tok));
}

/**
 * @param {string} label
 * @param {string} [section]
 * @returns {'eeo'|'health'|'biometric'|'none'}
 */
export function classifySensitiveCategory(label, section = '') {
  const hay = `${normalizeText(label)} ${normalizeText(section)}`.trim();
  if (!hay) return 'none';

  if (SENSITIVE_EEO_TOKENS.some((tok) => hay.includes(normalizeText(tok)))) return 'eeo';

  // Placeholder for future expansion:
  // health / biometric signals (kept conservative for v0)
  return 'none';
}

/**
 * Policy decision helper.
 *
 * @param {{label: string, section?: string, controlKind?: string, inputType?: string}} args
 * @param {{allowSensitive?: boolean}} [opts]
 */
export function policyDecision(args, opts = {}) {
  const label = args?.label ?? '';
  const section = args?.section ?? '';

  if (isConsentLikeField(label, section)) {
    return { allow: false, reason: 'consent_like' };
  }

  const cat = classifySensitiveCategory(label, section);
  if (cat !== 'none' && !opts.allowSensitive) {
    return { allow: false, reason: `sensitive:${cat}`, sensitive_category: cat };
  }

  return { allow: true, reason: 'ok', sensitive_category: cat };
}

/**
 * Filter a FillPlan's actions through policy.
 *
 * @param {any} plan
 * @param {(action: any) => {label?: string, section?: string}} getContext
 * @param {{allowSensitive?: boolean}} [opts]
 */
export function filterFillPlanActionsByPolicy(plan, getContext, opts = {}) {
  if (!plan || !Array.isArray(plan.actions)) return plan;

  const kept = [];
  for (const action of plan.actions) {
    const ctx = (typeof getContext === 'function' ? getContext(action) : null) || {};
    const dec = policyDecision({ label: ctx.label || '', section: ctx.section || '' }, opts);
    if (!dec.allow) continue;
    kept.push(action);
  }

  return { ...plan, actions: kept };
}

export const _policyUtil = { normalizeText };
