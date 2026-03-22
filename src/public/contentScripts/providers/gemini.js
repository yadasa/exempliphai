/**
 * Gemini provider for exempliphai (MV3 extension).
 *
 * Tier 1: map unresolved form fields -> FillPlan JSON
 * Tier 2: generate narrative answer text for long-form questions
 * Tier 3: resume tailoring + job search recommendations (JSON)
 */

/**
 * @typedef {Object} AiProvider
 * @property {(taskType: 'quick' | 'deep') => string} getModelForTask
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
 * @property {'quick'|'deep'} [taskType]
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
 * @property {'quick'|'deep'} [taskType]
 * @property {number} [timeoutMs]
 * @property {number} [maxRetries]
 */

export const AI_PROVIDER_INTERFACE_VERSION = '0.1';

// NOTE: v1beta model names are strict. These two are broadly available/stable.
export const GEMINI_DEFAULT_MODEL = 'gemini-1.5-flash-latest';
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Task-based model routing (no user-configurable dropdown).
 *
 * v1beta supported/stable targets:
 * - quick → gemini-1.5-flash-latest
 * - deep  → gemini-pro
 *
 * @param {'quick'|'deep'} taskType
 */
export function getModelForTask(taskType) {
  return taskType === 'deep' ? 'gemini-pro' : 'gemini-1.5-flash-latest';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  return { controller, cancel: () => clearTimeout(id) };
}

function extractFirstJsonValue(text) {
  const s = (text ?? '').toString();

  // Find first JSON container (object or array), whichever occurs first.
  const iObj = s.indexOf('{');
  const iArr = s.indexOf('[');

  let open = '{';
  let close = '}';
  let first = iObj;

  if (iObj === -1 && iArr === -1) return null;
  if (iObj === -1 || (iArr !== -1 && iArr < iObj)) {
    open = '[';
    close = ']';
    first = iArr;
  }

  const last = s.lastIndexOf(close);
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

function extractFirstJsonObject(text) {
  const v = extractFirstJsonValue(text);
  if (!v) return null;
  return v.trim().startsWith('{') ? v : null;
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

function safeString(x, max = 12000) {
  const s = String(x ?? '').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

// ─────────────────────────────────────────────────────────────────────
// Resume tailoring (JSON)
// ─────────────────────────────────────────────────────────────────────

export function buildTailorSystemPrompt() {
  return `You are an expert resume writer.\n\nTask: surgically revise a resume to align with a specific job posting.\n\nHard rules:\n- Do NOT fabricate employers, titles, dates, degrees, certifications, skills, or metrics.\n- Preserve all factual info exactly (job titles, employers, durations). You may re-order and rephrase bullets.\n- Incorporate job-description keywords ONLY when truthful for the candidate.\n- Quantify achievements ONLY if existing resume data implies a metric; otherwise use qualitative impact language.\n- Trim to 1-page density: aim for 400–600 words.\n- Return ONLY valid JSON matching the schema in the user message. No markdown, no commentary.`;
}

export function buildTailorUserPrompt({ resumeData, jobTitle, jobDescription, pageUrl } = {}) {
  const resume = typeof resumeData === 'string' ? resumeData : JSON.stringify(resumeData ?? {}, null, 2);
  const title = safeString(jobTitle, 200);
  const jd = safeString(jobDescription, 12000);
  const url = safeString(pageUrl, 800);

  return `Revise the candidate resume data to better match the target role.\n\nTarget job title: ${title || '(unknown)'}\nJob page URL: ${url || '(unknown)'}\n\nJob description (may be partial):\n${jd || '(none provided)'}\n\nCandidate resume data (source of truth):\n${resume}\n\nReturn ONLY a JSON object with this exact structure:\n{\n  \"tailored_resume_text\": \"...\", // plain text resume, 400–600 words, professional, 1 page\n  \"tailored_resume_details\": {\n    \"skills\": [\"...\"],\n    \"experiences\": [\n      {\n        \"jobTitle\": \"...\",\n        \"jobEmployer\": \"...\",\n        \"jobDuration\": \"...\",\n        \"isCurrentEmployer\": true,\n        \"roleBulletsString\": \"• bullet1\\n• bullet2\\n...\"\n      }\n    ],\n    \"certifications\": [\n      {\n        \"name\": \"...\",\n        \"issuer\": \"...\",\n        \"issueDate\": \"...\",\n        \"expirationDate\": \"...\",\n        \"credentialId\": \"...\",\n        \"url\": \"...\"\n      }\n    ]\n  },\n  \"keywordsAdded\": [\"...\"],\n  \"changesDescription\": \"...\"\n}\n\nImportant:\n- Keep every experience entry. Do not delete roles.\n- Do not change jobTitle/jobEmployer/jobDuration/isCurrentEmployer values.\n- You MAY edit roleBulletsString to be more relevant, concise, and impact-focused.\n- Skills: reorder + adjust wording (no inventions).`;
}

// ─────────────────────────────────────────────────────────────────────
// Job search recommendations (JSON array)
// ─────────────────────────────────────────────────────────────────────

export function buildJobSearchSystemPrompt() {
  return `You are an expert career coach and recruiter.\n\nTask: analyze an anonymized resume and recommend 10–15 target jobs.\n\nGuidelines:\n- Recommend a mix of “at-par” roles and slightly aspirational roles (a reasonable career upgrade).\n- Prefer roles the candidate can plausibly land in the next 3–12 months.\n\nPrivacy rules (critical):\n- Do NOT include any personal identifying info (name, email, phone, address, personal links).\n- Assume you only have anonymized resume content.\n\nOutput rules (critical):\n- Return ONLY valid JSON. No markdown, no commentary.\n- Output MUST be a JSON array of 10–15 objects.\n- Each object MUST match this schema exactly:\n  {\n    \"title\": string,\n    \"company_types\": string[] | string,\n    \"salary_range\": string,\n    \"locations\": string[] | string,\n    \"why_match\": string,\n    \"search_link\": string\n  }\n\nSearch link rules:\n- search_link MUST be a single https URL to a job search page on LinkedIn, Google, or Indeed.\n- Prefer LinkedIn (e.g., https://www.linkedin.com/jobs/search/?keywords=Senior%20Software%20Engineer%20React%20Remote).\n- The link should be immediately usable (URL-encoded keywords, include remote/hybrid when relevant).`;
}

export function buildJobSearchUserPrompt({ resumeData, resumeText, countMin = 10, countMax = 15 } = {}) {
  const nMin = Number.isFinite(countMin) ? countMin : 10;
  const nMax = Number.isFinite(countMax) ? countMax : 15;

  const structured = resumeData != null && resumeData !== '';
  const resume = structured
    ? (typeof resumeData === 'string' ? safeString(resumeData, 16000) : JSON.stringify(resumeData ?? {}, null, 2))
    : safeString(resumeText, 16000);

  return `Analyze the resume and recommend ${nMin}–${nMax} target jobs.\n\nResume (anonymized):\n${resume || '(none provided)'}\n\nReturn ONLY a JSON array with objects shaped exactly as:\n[{\"title\":\"\",\"company_types\":[],\"salary_range\":\"\",\"locations\":[],\"why_match\":\"\",\"search_link\":\"https://...\"}]\n\nConstraints:\n- No PII.\n- Keep why_match to 1–3 concise sentences.\n- Make search_link a smart query link (LinkedIn/Google/Indeed) tailored to the role + key skills + preferred location/remote.`;
}

function extractUsage(raw) {
  const md = raw?.usageMetadata || {};
  const tokensIn = Number(md.promptTokenCount || 0);
  const tokensOut = Number(md.candidatesTokenCount || 0);
  const tokensTotal = Number(md.totalTokenCount || tokensIn + tokensOut);
  return { tokensIn, tokensOut, tokensTotal };
}

async function geminiFetchJson({ url, method = 'POST', headers, body, timeoutMs = 20000 } = {}) {
  // Prefer background proxy when available to avoid page CSP/CORS restrictions.
  try {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      const resp = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { action: 'SMARTAPPLY_GEMINI_FETCH', url, method, headers, body, timeoutMs },
            (r) => resolve(r)
          );
        } catch (e) {
          resolve({ ok: false, error: String(e?.message || e) });
        }
      });

      const lastErr = chrome?.runtime?.lastError;
      if (lastErr) {
        return { ok: false, status: 0, json: null, error: lastErr.message || String(lastErr) };
      }

      if (resp?.ok) {
        return { ok: true, status: Number(resp.status || 200), json: resp.json };
      }

      return {
        ok: false,
        status: Number(resp?.status || 0),
        json: resp?.json || null,
        error: resp?.error || 'Gemini proxy failed',
      };
    }
  } catch (_) {}

  const { controller, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(String(url), {
      method,
      headers,
      signal: controller.signal,
      body,
    });

    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } finally {
    cancel();
  }
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

  const body = JSON.stringify({
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
  });

  const r = await geminiFetchJson({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeoutMs,
  });

  const json = r?.json || {};
  if (!r.ok || json?.error) {
    const msg = json?.error?.message || r?.error || `Gemini HTTP ${r?.status || 0}`;
    const err = new Error(msg);
    // @ts-ignore
    err.status = r?.status || 0;
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

  const usage = extractUsage(json);
  return { raw: json, text, ...usage };
}

async function geminiGenerateContentFromParts({
  apiKey,
  model,
  parts,
  timeoutMs,
  responseMimeType,
  temperature = 0.2,
}) {
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: Array.isArray(parts) ? parts : [{ text: String(parts || '') }],
      },
    ],
    generationConfig: {
      temperature,
      ...(responseMimeType ? { responseMimeType } : {}),
    },
  });

  const r = await geminiFetchJson({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeoutMs,
  });

  const json = r?.json || {};
  if (!r.ok || json?.error) {
    const msg = json?.error?.message || r?.error || `Gemini HTTP ${r?.status || 0}`;
    const err = new Error(msg);
    // @ts-ignore
    err.status = r?.status || 0;
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

  const usage = extractUsage(json);
  return { raw: json, text, ...usage };
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

  const timeoutMs = Number.isFinite(cfg?.timeoutMs) ? cfg.timeoutMs : 20000;
  const maxRetries = Number.isFinite(cfg?.maxRetries) ? cfg.maxRetries : 2;

  return {
    getModelForTask,

    async mapFieldsToFillPlan(args) {
      const systemPrompt = buildTier1MappingSystemPrompt();
      const userPrompt = buildTier1MappingUserPrompt(args);

      const modelUsed = getModelForTask(args?.taskType || 'quick');

      const { text } = await withRetry(
        () =>
          geminiGenerateContent({
            apiKey,
            model: modelUsed,
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

      const modelUsed = getModelForTask(args?.taskType || 'quick');

      const { text } = await withRetry(
        () =>
          geminiGenerateContent({
            apiKey,
            model: modelUsed,
            systemPrompt,
            userPrompt,
            timeoutMs: args?.timeoutMs ?? timeoutMs,
          }),
        { maxRetries: args?.maxRetries ?? maxRetries }
      );

      // Tier 2 is plain text; trim and return.
      return String(text).trim();
    },

    /**
     * Tailor a resume for a specific job.
     *
     * @param {{ resumeData: object|string, jobTitle?: string, jobDescription?: string, pageUrl?: string, model?: string, timeoutMs?: number, maxRetries?: number }} args
     * @returns {Promise<{ tailored: any, tokensIn: number, tokensOut: number, changesDescription: string }>}
     */
    async tailorResume(args = {}) {
      const systemPrompt = buildTailorSystemPrompt();
      const userPrompt = buildTailorUserPrompt(args);

      const modelUsed = getModelForTask(args?.taskType || 'deep');

      const result = await withRetry(
        () =>
          geminiGenerateContent({
            apiKey,
            model: modelUsed,
            systemPrompt,
            userPrompt,
            timeoutMs: args?.timeoutMs ?? Math.max(timeoutMs, 70000),
            responseMimeType: 'application/json',
            temperature: 0.2,
          }),
        { maxRetries: args?.maxRetries ?? maxRetries }
      );

      const jsonText = extractFirstJsonObject(result.text) ?? result.text;
      try {
        const parsed = JSON.parse(jsonText);
        return {
          tailored: parsed,
          modelUsed,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          changesDescription: parsed?.changesDescription || 'Resume tailored successfully.',
        };
      } catch (e) {
        const err = new Error('Failed to parse tailored resume JSON from Gemini');
        // @ts-ignore
        err.cause = e;
        // @ts-ignore
        err.rawText = result.text;
        throw err;
      }
    },

    /**
     * Recommend job targets based on an anonymized resume.
     *
     * @param {{ resumeData?: object|string, resumeText?: string, countMin?: number, countMax?: number, model?: string, timeoutMs?: number, maxRetries?: number }} args
     * @returns {Promise<{ jobs: any[], tokensIn: number, tokensOut: number }>}
     */
    async recommendJobs(args = {}) {
      const systemPrompt = buildJobSearchSystemPrompt();
      const userPrompt = buildJobSearchUserPrompt(args);

      const modelUsed = getModelForTask(args?.taskType || 'deep');

      const result = await withRetry(
        () =>
          geminiGenerateContent({
            apiKey,
            model: modelUsed,
            systemPrompt,
            userPrompt,
            timeoutMs: args?.timeoutMs ?? Math.max(timeoutMs, 45000),
            responseMimeType: 'application/json',
            temperature: 0.3,
          }),
        { maxRetries: args?.maxRetries ?? maxRetries }
      );

      const jsonText = extractFirstJsonValue(result.text) ?? result.text;
      try {
        const parsed = JSON.parse(jsonText);
        const jobs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : [];
        return { jobs, modelUsed, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
      } catch (e) {
        const err = new Error('Failed to parse job recommendations JSON from Gemini');
        // @ts-ignore
        err.cause = e;
        // @ts-ignore
        err.rawText = result.text;
        throw err;
      }
    },
  };
}

/**
 * Convenience functions (stateless).
 */
export async function mapFieldsToFillPlan(args) {
  const p = createGeminiProvider({
    apiKey: args?.apiKey,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.mapFieldsToFillPlan(args);
}

export async function generateNarrativeAnswer(args) {
  const p = createGeminiProvider({
    apiKey: args?.apiKey,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.generateNarrativeAnswer(args);
}

export async function tailorResume(args = {}) {
  const p = createGeminiProvider({
    apiKey: args?.apiKey,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.tailorResume(args);
}

export async function recommendJobs(args = {}) {
  const p = createGeminiProvider({
    apiKey: args?.apiKey,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.recommendJobs(args);
}

// Optional: expose for classic-script usage if needed.
try {
  globalThis.__exempliphaiProviders = globalThis.__exempliphaiProviders || {};
  globalThis.__exempliphaiProviders.gemini = {
    createGeminiProvider,
    getModelForTask,
    mapFieldsToFillPlan,
    generateNarrativeAnswer,
    tailorResume,
    recommendJobs,

    buildTier1MappingSystemPrompt,
    buildTier1MappingUserPrompt,
    buildTier2NarrativeSystemPrompt,
    buildTier2NarrativeUserPrompt,

    buildTailorSystemPrompt,
    buildTailorUserPrompt,
    buildJobSearchSystemPrompt,
    buildJobSearchUserPrompt,

    GEMINI_DEFAULT_MODEL,
    GEMINI_API_BASE,
  };
} catch (_) {}
