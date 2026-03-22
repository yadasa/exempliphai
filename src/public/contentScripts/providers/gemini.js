/**
 * Gemini provider for exempliphai (MV3 extension).
 *
 * This module is intentionally provider-agnostic at the interface level so we can
 * add an OpenAI provider later with the same method signatures.
 *
 * Tier 1: map unresolved form fields -> FillPlan JSON
 * Tier 2: generate narrative answer text for long-form questions
 */

/**
 * @typedef {Object} AiProvider
 * @property {(args: MapFieldsArgs) => Promise<any>} mapFieldsToFillPlan
 * @property {(args: NarrativeArgs) => Promise<string>} generateNarrativeAnswer
 */

/**
 * @typedef {Object} MapFieldsArgs
 * @property {string} apiKey
 * @property {string} domain
 * @property {string[]} allowedProfileKeys
 * @property {Array<Object>} unresolvedFields
 * @property {Object} [policy]
 * @property {string} [pageUrl]
 * @property {string} [snapshotHash]
 * @property {string} [model]
 * @property {number} [timeoutMs]
 * @property {number} [maxRetries]
 */

/**
 * @typedef {Object} NarrativeArgs
 * @property {string} apiKey
 * @property {string} questionText
 * @property {number} [maxWords]
 * @property {string} [tone]
 * @property {string} [resumeDetailsMin]
 * @property {string} [profileSubset]
 * @property {string} [siteGuidance]
 * @property {string} [synonymHint]
 * @property {string} [model]
 * @property {number} [timeoutMs]
 * @property {number} [maxRetries]
 */

export const AI_PROVIDER_INTERFACE_VERSION = '0.1';

// NOTE: v1beta model names are strict. These two are broadly available/stable.
export const GEMINI_MODEL_QUICK = 'gemini-1.5-flash';
export const GEMINI_MODEL_DEEP = 'gemini-1.5-pro';

export const GEMINI_DEFAULT_MODEL = GEMINI_MODEL_QUICK;
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  return { controller, cancel: () => clearTimeout(id) };
}

function extractFirstJsonObject(text) {
  const s = (text ?? '').toString();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

function asCleanText(x) {
  if (x == null) return '';
  return String(x);
}

export function buildTier1MappingSystemPrompt() {
  return `You are a form-field mapping engine for a browser extension.

You will receive:
- a list of form fields extracted from the DOM (labels, roles, types, options)
- a list of allowed profile keys (strings) that exist in chrome.storage
- policy constraints (what not to fill)

Task:
Return ONLY valid JSON matching the FillPlan schema.

Required output shape (top-level):
{
  "version": "0.1",
  "plan_id": "...",
  "created_at": "...", // ISO datetime
  "domain": "...",
  "page_url": "...", // absolute URL
  "provider": { "name": "gemini", "model": "..." },
  "snapshot_hash": "...", // optional
  "actions": [
    {
      "action_id": "...",
      "field_fingerprint": "...",
      "value": { "source": "profile|resume_details|derived|literal|skip", "source_key"?: "...", "literal"?: any, "derived"?: {"kind":"...","args"?:{}} },
      "transform"?: [{"op":"trim|collapse_whitespace|ensure_https|full_name_part|normalize_phone|month_name_to_number|iso_date_to_control_format|city_state_country", ...}],
      "apply"?: { "mode": "set_value|select_best_option|click_best_label|upload_resume|upload_linkedin_pdf", "allow_overwrite"?: boolean },
      "confidence"?: number,
      "reason"?: string,
      "policy"?: { "sensitive_category"?: "eeo|health|biometric|none", "requires_review"?: boolean, "requires_explicit_consent"?: boolean }
    }
  ]
}

Rules:
- Do NOT invent new profile keys.
- Prefer mapping to an existing profile key. If none fits, set value.source="skip".
- Never propose checking consent/terms/acknowledgement checkboxes.
- If the field is sensitive (EEO/disability/veteran/visa), set policy.requires_review=true unless explicitly allowed.
- Do not include any prose outside JSON.`;
}

/**
 * Build the Tier-1 user payload (as an object).
 * This should not include user PII values — only allowed profile KEYS.
 */
export function buildTier1MappingUserPayload({
  domain,
  allowedProfileKeys,
  unresolvedFields,
  policy,
  pageUrl,
  snapshotHash,
  maxActions = 64,
} = {}) {
  return {
    task: 'map_unresolved_fields_to_profile_keys',
    domain: domain ?? '',
    page_url: pageUrl ?? undefined,
    snapshot_hash: snapshotHash ?? undefined,
    allowed_profile_keys: Array.isArray(allowedProfileKeys) ? allowedProfileKeys : [],
    policy: {
      never_autofill_consent_checkboxes: true,
      sensitive_requires_review: true,
      ...(policy || {}),
    },
    unresolved_fields: Array.isArray(unresolvedFields) ? unresolvedFields : [],
    response_requirements: {
      output: 'FillPlan',
      max_actions: maxActions,
    },
  };
}

export function buildTier1MappingUserPrompt(args) {
  const payload = buildTier1MappingUserPayload(args);
  return JSON.stringify(payload, null, 2);
}

export function buildTier2NarrativeSystemPrompt() {
  return `You write concise, professional job-application answers in first person.
Return only the answer text.
Do not include placeholders like [Company] or [Your Name].
If the prompt asks for sensitive personal information, keep it minimal and consistent with provided profile data.`;
}

export function buildTier2NarrativeUserPrompt({
  questionText,
  maxWords = 180,
  tone = 'professional, direct',
  resumeDetailsMin = '',
  profileSubset = '',
  siteGuidance = '',
  synonymHint = '',
} = {}) {
  const q = asCleanText(questionText).trim();
  const rd = asCleanText(resumeDetailsMin).trim();
  const ps = asCleanText(profileSubset).trim();
  const sg = asCleanText(siteGuidance).trim();
  const sh = asCleanText(synonymHint).trim();

  return `Question: ${q}

Constraints:
- Target length: ${Number.isFinite(maxWords) ? maxWords : 180} words
- Tone: ${tone}

${sg ? `Site guidance: ${sg}\n\n` : ''}${sh ? `Synonym hint: ${sh}\n\n` : ''}Resume details (structured):
${rd || '(none)'}

Optional profile facts:
${ps || '(none)'}`;
}

async function geminiGenerateContent({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs,
  responseMimeType,
  temperature = 0.2,
}) {
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Gemini REST (generativelanguage) supports a top-level systemInstruction in newer APIs,
  // but not consistently across models/versions. We embed system+user prompts into one message
  // to keep behavior predictable.
  const combined = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  const { controller, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: combined }],
          },
        ],
        generationConfig: {
          temperature,
          ...(responseMimeType ? { responseMimeType } : {}),
        },
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      const msg = json?.error?.message || `Gemini HTTP ${res.status}`;
      const err = new Error(msg);
      // @ts-ignore
      err.status = res.status;
      // @ts-ignore
      err.details = json;
      throw err;
    }

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const err = new Error('Gemini response missing candidate text');
      // @ts-ignore
      err.details = json;
      throw err;
    }
    return { raw: json, text };
  } finally {
    cancel();
  }
}

async function withRetry(fn, { maxRetries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const status = /** @type {any} */ (e)?.status;
      const transient = status >= 500 || status === 429 || status === 408;
      if (attempt >= maxRetries || !transient) throw e;
      await sleep(250 * Math.pow(2, attempt) + Math.floor(Math.random() * 200));
    }
  }
  throw lastErr;
}

/**
 * Create a Gemini provider instance.
 *
 * @param {{ apiKey: string, model?: string, timeoutMs?: number, maxRetries?: number }} cfg
 * @returns {AiProvider}
 */
export function createGeminiProvider(cfg) {
  const apiKey = cfg?.apiKey;
  if (!apiKey) throw new Error('Gemini provider requires apiKey');

  const model = cfg?.model || GEMINI_DEFAULT_MODEL;
  const timeoutMs = Number.isFinite(cfg?.timeoutMs) ? cfg.timeoutMs : 20000;
  const maxRetries = Number.isFinite(cfg?.maxRetries) ? cfg.maxRetries : 2;

  return {
    async mapFieldsToFillPlan(args) {
      const systemPrompt = buildTier1MappingSystemPrompt();
      const userPrompt = buildTier1MappingUserPrompt(args);

      const { text } = await withRetry(
        () =>
          geminiGenerateContent({
            apiKey,
            model: args?.model || model,
            systemPrompt,
            userPrompt,
            timeoutMs: args?.timeoutMs ?? timeoutMs,
            responseMimeType: 'application/json',
          }),
        { maxRetries: args?.maxRetries ?? maxRetries }
      );

      const jsonText = extractFirstJsonObject(text) ?? text;
      try {
        return JSON.parse(jsonText);
      } catch (e) {
        const err = new Error('Failed to parse FillPlan JSON from Gemini');
        // @ts-ignore
        err.cause = e;
        // @ts-ignore
        err.rawText = text;
        throw err;
      }
    },

    async generateNarrativeAnswer(args) {
      const systemPrompt = buildTier2NarrativeSystemPrompt();
      const userPrompt = buildTier2NarrativeUserPrompt(args);

      const { text } = await withRetry(
        () =>
          geminiGenerateContent({
            apiKey,
            model: args?.model || model,
            systemPrompt,
            userPrompt,
            timeoutMs: args?.timeoutMs ?? timeoutMs,
          }),
        { maxRetries: args?.maxRetries ?? maxRetries }
      );

      // Tier 2 is plain text; trim and return.
      return String(text).trim();
    },
  };
}

/**
 * Convenience functions (stateless) matching the provider interface.
 * These mirror the signatures we will use for an OpenAI provider later.
 */
export async function mapFieldsToFillPlan(args) {
  const p = createGeminiProvider({
    apiKey: args?.apiKey,
    model: args?.model,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.mapFieldsToFillPlan(args);
}

export async function generateNarrativeAnswer(args) {
  const p = createGeminiProvider({
    apiKey: args?.apiKey,
    model: args?.model,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.generateNarrativeAnswer(args);
}

// Optional: expose for classic-script usage if needed.
try {
  globalThis.__exempliphaiProviders = globalThis.__exempliphaiProviders || {};
  globalThis.__exempliphaiProviders.gemini = {
    createGeminiProvider,
    mapFieldsToFillPlan,
    generateNarrativeAnswer,
    buildTier1MappingSystemPrompt,
    buildTier1MappingUserPrompt,
    buildTier2NarrativeSystemPrompt,
    buildTier2NarrativeUserPrompt,
  };
} catch (_) {}
