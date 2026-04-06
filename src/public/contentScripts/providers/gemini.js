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
 * @property {string} [apiKey] // unused (proxy-only)
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
 * @property {string} [apiKey] // unused (proxy-only)
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

export const GEMINI_DEFAULT_MODEL = 'gemini-3-flash-preview';

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

function proxyGenerateContent({ aiAction, model, input, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      chrome.runtime.sendMessage(
        {
          action: 'AI_PROXY',
          aiAction,
          model,
          input,
        },
        (resp) => {
          clearTimeout(t);
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(String(err.message || err)));
          if (!resp || resp.ok === false) return reject(new Error(String(resp?.error || 'ai_proxy_failed')));
          resolve(resp);
        }
      );
    } catch (e) {
      reject(e);
    }
  });
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

export function buildJobRecsSystemPrompt() {
  return `You are a job recommendation engine.
Return ONLY valid JSON.
Do not include any prose outside JSON.`;
}

export function buildJobRecsUserPrompt({
  profile = {},
  resumeDetails = {},
  desiredLocation = '',
  countMin = 10,
  countMax = 15,
} = {}) {
  return `Create ${countMin}-${countMax} job recommendations for this candidate.

Return ONLY valid JSON with this exact structure:
{
  "version": "0.1",
  "generated_at": "${new Date().toISOString()}",
  "recommendations": [
    {
      "title": "",
      "company": "",
      "location": "",
      "salary": "",
      "why_match": "",
      "links": [{"label": "", "url": "https://..."}]
    }
  ]
}

Rules:
- Include 10-15 recommendations; mostly strong matches plus a few stretch upgrades.
- Keep why_match 1-2 sentences.
- If you don't know salary, return an empty string.
- Links MUST be direct job posting or application URLs (no search pages).
  - Allowed: LinkedIn job posting URLs (e.g. https://www.linkedin.com/jobs/view/...), or company ATS postings (Greenhouse/Lever/Workday/Ashby/SmartRecruiters/Workable/iCIMS), or a company careers posting page.
  - NOT allowed: Google/Bing/DuckDuckGo search URLs.
- If you cannot provide a real direct application URL with high confidence, set "links" to an empty array (do NOT guess).

Desired location: ${desiredLocation || '(none)'}

Profile:
${JSON.stringify(profile || {}, null, 2)}

Resume details:
${JSON.stringify(resumeDetails || {}, null, 2)}
`;
}

async function geminiGenerateContent({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs,
  responseMimeType,
  temperature = 0.2,
  aiAction = 'generateNarrativeAnswer',
  useProxy = true,
  args,
}) {
  // Gemini REST (generativelanguage) supports a top-level systemInstruction in newer APIs,
  // but not consistently across models/versions. We embed system+user prompts into one message
  // to keep behavior predictable.
  const combined = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  const input = args
    ? {
        // Server will build the full prompt from structured args.
        args,
        generationConfig: {
          temperature,
          ...(responseMimeType ? { responseMimeType } : {}),
        },
      }
    : {
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
      };
  {
    const resp = /** @type {any} */ (await proxyGenerateContent({ aiAction, model, input, timeoutMs }));
    const text = resp?.result?.text;
    if (!text) {
      const err = new Error('AI proxy response missing text');
      // @ts-ignore
      err.details = resp;
      throw err;
    }
    return { raw: resp, text };
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
  // apiKey is ignored in proxy-only mode
  const apiKey = cfg?.apiKey

  // Proxy-only: never call Gemini directly from the extension.
  const useProxy = true;

  const model = cfg?.model || GEMINI_DEFAULT_MODEL;
  const timeoutMs = Number.isFinite(cfg?.timeoutMs) ? cfg.timeoutMs : 20000;
  const maxRetries = Number.isFinite(cfg?.maxRetries) ? cfg.maxRetries : 2;

  return {
    async mapFieldsToFillPlan(args) {
      // IMPORTANT: keep Tier-1 prompt templates off-device when proxying.
      // Send only the structured payload; the server constructs the full prompt.
      const payload = buildTier1MappingUserPayload(args);

      const { text } = await withRetry(
        () =>
          geminiGenerateContent({
            apiKey,
            model: args?.model || model,
            systemPrompt: '',
            userPrompt: '',
            timeoutMs: args?.timeoutMs ?? timeoutMs,
            responseMimeType: 'application/json',
            aiAction: 'mapFieldsToFillPlan',
            useProxy,
            // Pass structured args to the server; it will build the prompt.
            args: payload,
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
      // IMPORTANT: keep Tier-2 prompt templates off-device when proxying.
      // Send only the structured args; the server constructs the full prompt.
      const minimal = {
        questionText: args?.questionText,
        maxWords: args?.maxWords,
        tone: args?.tone,
        resumeDetailsMin: args?.resumeDetailsMin,
        profileSubset: args?.profileSubset,
        siteGuidance: args?.siteGuidance,
        synonymHint: args?.synonymHint,
      };

      const { text } = await withRetry(
        () =>
          geminiGenerateContent({
            apiKey,
            model: args?.model || model,
            systemPrompt: '',
            userPrompt: '',
            timeoutMs: args?.timeoutMs ?? timeoutMs,
            aiAction: 'generateNarrativeAnswer',
            useProxy,
            args: minimal,
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
