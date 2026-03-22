/**
 * GPT-5.2 provider for exempliphai (MV3 extension).
 *
 * Uses OpenRouter's OpenAI-compatible Chat Completions endpoint.
 *
 * Primary use: resume tailoring.
 *
 * NOTE: This file is consumed via dynamic import() from classic content scripts.
 * It attaches a minimal API to globalThis.__exempliphaiProviders.gpt52.
 */

export const GPT52_DEFAULT_MODEL = 'openai/gpt-5.2';
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/chat/completions';

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

// Back-compat (tailoring expects an object, but we now support arrays too).
function extractFirstJsonObject(text) {
  const v = extractFirstJsonValue(text);
  if (!v) return null;
  return v.trim().startsWith('{') ? v : null;
}

function safeString(x, max = 12000) {
  const s = String(x ?? '').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * System prompt for surgical resume tailoring.
 */
export function buildTailorSystemPrompt() {
  return `You are an expert resume writer.

Task: surgically revise a resume to align with a specific job posting.

Hard rules:
- Do NOT fabricate employers, titles, dates, degrees, certifications, skills, or metrics.
- Preserve all factual info exactly (job titles, employers, durations). You may re-order and rephrase bullets.
- Incorporate job-description keywords ONLY when truthful for the candidate.
- Quantify achievements ONLY if existing resume data implies a metric; otherwise use qualitative impact language.
- Trim to 1-page density: aim for 400–600 words.
- Return ONLY valid JSON matching the schema in the user message. No markdown, no commentary.`;
}

/**
 * User prompt for tailoring. Input can be structured JSON (preferred).
 */
export function buildTailorUserPrompt({ resumeData, jobTitle, jobDescription, pageUrl } = {}) {
  const resume = typeof resumeData === 'string' ? resumeData : JSON.stringify(resumeData ?? {}, null, 2);
  const title = safeString(jobTitle, 200);
  const jd = safeString(jobDescription, 12000);
  const url = safeString(pageUrl, 800);

  return `Revise the candidate resume data to better match the target role.

Target job title: ${title || '(unknown)'}
Job page URL: ${url || '(unknown)'}

Job description (may be partial):
${jd || '(none provided)'}

Candidate resume data (source of truth):
${resume}

Return ONLY a JSON object with this exact structure:
{
  "tailored_resume_text": "...", // plain text resume, 400–600 words, professional, 1 page
  "tailored_resume_details": {
    "skills": ["..."],
    "experiences": [
      {
        "jobTitle": "...",
        "jobEmployer": "...",
        "jobDuration": "...",
        "isCurrentEmployer": true,
        "roleBulletsString": "• bullet1\\n• bullet2\\n..."
      }
    ],
    "certifications": [
      {
        "name": "...",
        "issuer": "...",
        "issueDate": "...",
        "expirationDate": "...",
        "credentialId": "...",
        "url": "..."
      }
    ]
  },
  "keywordsAdded": ["..."],
  "changesDescription": "..."
}

Important:
- Keep every experience entry. Do not delete roles.
- Do not change jobTitle/jobEmployer/jobDuration/isCurrentEmployer values.
- You MAY edit roleBulletsString to be more relevant, concise, and impact-focused.
- Skills: reorder + adjust wording (no inventions).`;
}

/**
 * System prompt for job search recommendations.
 */
export function buildJobSearchSystemPrompt() {
  return `You are an expert career coach and recruiter.

Task: analyze an anonymized resume and recommend 10–15 target jobs.

Guidelines:
- Recommend a mix of “at-par” roles and slightly aspirational roles (a reasonable career upgrade).
- Prefer roles the candidate can plausibly land in the next 3–12 months.

Privacy rules (critical):
- Do NOT include any personal identifying info (name, email, phone, address, personal links).
- Assume you only have anonymized resume content.

Output rules (critical):
- Return ONLY valid JSON. No markdown, no commentary.
- Output MUST be a JSON array of 10–15 objects.
- Each object MUST match this schema exactly:
  {
    "title": string,
    "company_types": string[] | string,
    "salary_range": string,
    "locations": string[] | string,
    "why_match": string,
    "search_link": string
  }

Search link rules:
- search_link MUST be a single https URL to a job search page on LinkedIn, Google, or Indeed.
- Prefer LinkedIn (e.g., https://www.linkedin.com/jobs/search/?keywords=Senior%20Software%20Engineer%20React%20Remote).
- The link should be immediately usable (URL-encoded keywords, include remote/hybrid when relevant).`;
}

/**
 * User prompt for job search recommendations.
 * Input can be structured JSON (preferred) or plain text.
 */
export function buildJobSearchUserPrompt({ resumeData, resumeText, countMin = 10, countMax = 15 } = {}) {
  const nMin = Number.isFinite(countMin) ? countMin : 10;
  const nMax = Number.isFinite(countMax) ? countMax : 15;

  const structured = resumeData != null && resumeData !== '';
  const resume = structured
    ? (typeof resumeData === 'string' ? safeString(resumeData, 16000) : JSON.stringify(resumeData ?? {}, null, 2))
    : safeString(resumeText, 16000);

  return `Analyze the resume and recommend ${nMin}–${nMax} target jobs.

Resume (anonymized):
${resume || '(none provided)'}

Return ONLY a JSON array with objects shaped exactly as:
[{"title":"","company_types":[],"salary_range":"","locations":[],"why_match":"","search_link":"https://..."}]

Constraints:
- No PII.
- Keep why_match to 1–3 concise sentences.
- Make search_link a smart query link (LinkedIn/Google/Indeed) tailored to the role + key skills + preferred location/remote.`;
}

async function openRouterChatCompletion({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs,
  temperature = 0.2,
  maxTokens = 2400,
  extraHeaders,
} = {}) {
  const { controller, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(OPENROUTER_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter attribution headers (safe defaults)
        'HTTP-Referer': 'https://exempliphai.app',
        'X-Title': 'Exempliphai Resume Tailor',
        ...(extraHeaders || {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      const msg = json?.error?.message || `OpenRouter HTTP ${res.status}`;
      const err = new Error(msg);
      // @ts-ignore
      err.status = res.status;
      // @ts-ignore
      err.details = json;
      throw err;
    }

    const text = json?.choices?.[0]?.message?.content;
    if (!text) {
      const err = new Error('OpenRouter response missing message content');
      // @ts-ignore
      err.details = json;
      throw err;
    }

    const usage = json?.usage || {};
    return {
      raw: json,
      text,
      tokensIn: Number(usage.prompt_tokens || 0),
      tokensOut: Number(usage.completion_tokens || 0),
    };
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
      await sleep(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr;
}

/**
 * Create a GPT-5.2 provider instance (via OpenRouter).
 */
export function createGpt52Provider(cfg = {}) {
  const apiKey = cfg?.apiKey;
  if (!apiKey) throw new Error('GPT-5.2 provider requires OpenRouter API key');

  const model = cfg?.model || GPT52_DEFAULT_MODEL;
  const timeoutMs = Number.isFinite(cfg?.timeoutMs) ? cfg.timeoutMs : 70000;
  const maxRetries = Number.isFinite(cfg?.maxRetries) ? cfg.maxRetries : 2;

  return {
    /**
     * Tailor a resume for a specific job.
     *
     * @param {{ resumeData: object|string, jobTitle: string, jobDescription: string, pageUrl?: string, model?: string, timeoutMs?: number, maxRetries?: number }} args
     * @returns {Promise<{ tailored: any, tokensIn: number, tokensOut: number, changesDescription: string }>} 
     */
    async tailorResume(args = {}) {
      const systemPrompt = buildTailorSystemPrompt();
      const userPrompt = buildTailorUserPrompt(args);

      const result = await withRetry(
        () =>
          openRouterChatCompletion({
            apiKey,
            model: args?.model || model,
            systemPrompt,
            userPrompt,
            timeoutMs: args?.timeoutMs ?? timeoutMs,
            temperature: 0.2,
            maxTokens: 2400,
          }),
        { maxRetries: args?.maxRetries ?? maxRetries }
      );

      const jsonText = extractFirstJsonObject(result.text) ?? result.text;
      try {
        const parsed = JSON.parse(jsonText);
        return {
          tailored: parsed,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          changesDescription: parsed?.changesDescription || 'Resume tailored successfully.',
        };
      } catch (e) {
        const err = new Error('Failed to parse tailored resume JSON from GPT-5.2');
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

      const result = await withRetry(
        () =>
          openRouterChatCompletion({
            apiKey,
            model: args?.model || model,
            systemPrompt,
            userPrompt,
            timeoutMs: args?.timeoutMs ?? timeoutMs,
            temperature: 0.3,
            maxTokens: 1600,
            extraHeaders: {
              'X-Title': 'Exempliphai Job Search',
            },
          }),
        { maxRetries: args?.maxRetries ?? maxRetries }
      );

      const jsonText = extractFirstJsonValue(result.text) ?? result.text;

      try {
        const parsed = JSON.parse(jsonText);
        const jobs = Array.isArray(parsed)
          ? parsed
          : (Array.isArray(parsed?.jobs) ? parsed.jobs : []);

        return {
          jobs,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        };
      } catch (e) {
        const err = new Error('Failed to parse job recommendations JSON from GPT-5.2');
        // @ts-ignore
        err.cause = e;
        // @ts-ignore
        err.rawText = result.text;
        throw err;
      }
    },
  };
}

/** Stateless convenience */
export async function tailorResume(args = {}) {
  const p = createGpt52Provider({
    apiKey: args?.apiKey,
    model: args?.model,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.tailorResume(args);
}

/** Stateless convenience */
export async function recommendJobs(args = {}) {
  const p = createGpt52Provider({
    apiKey: args?.apiKey,
    model: args?.model,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.recommendJobs(args);
}

// Expose for classic-script usage
try {
  globalThis.__exempliphaiProviders = globalThis.__exempliphaiProviders || {};
  globalThis.__exempliphaiProviders.gpt52 = {
    createGpt52Provider,
    tailorResume,
    recommendJobs,
    buildTailorSystemPrompt,
    buildTailorUserPrompt,
    buildJobSearchSystemPrompt,
    buildJobSearchUserPrompt,
    GPT52_DEFAULT_MODEL,
    OPENROUTER_API_BASE,
  };
} catch (_) {}
