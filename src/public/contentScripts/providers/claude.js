/**
 * Claude provider for exempliphai (MV3 extension).
 *
 * Uses OpenRouter API to access Claude models for resume tailoring.
 * Follows the same provider pattern as gemini.js.
 */

export const CLAUDE_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/chat/completions';

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

/**
 * Build the resume tailoring system prompt.
 */
export function buildTailorSystemPrompt() {
  return `You are an expert resume writer and career coach.

Your task: surgically revise a resume to align it with a specific job posting.

Rules:
- Make targeted, surgical changes only. Do NOT fabricate experiences or skills.
- Enhance bullet points with keywords from the job description where truthful.
- Quantify achievements where possible (metrics, percentages, dollar amounts).
- Prioritize experience and skills sections; trim low-relevance content.
- Target output: 400-600 words (fits on 1 page).
- Preserve all factual information — dates, company names, titles must remain accurate.
- Return ONLY valid JSON matching the output schema. No prose outside JSON.
- Focus the "summary" or "objective" on the target role if present.
- Reorder bullet points to lead with the most relevant ones.`;
}

/**
 * Build the resume tailoring user prompt.
 */
export function buildTailorUserPrompt({ resumeData, jobTitle, jobDescription }) {
  const resume = typeof resumeData === 'string' ? resumeData : JSON.stringify(resumeData, null, 2);
  const jd = String(jobDescription || '').trim().slice(0, 4000);
  const title = String(jobTitle || '').trim();

  return `Revise this resume to align with the target job posting. Surgical changes only: enhance bullets with JD keywords/metrics, shorten to fit 1 page (400-600 words), preserve all facts.

## Target Job
Title: ${title || '(unknown)'}

Job Description:
${jd || '(none provided)'}

## Current Resume Data
${resume}

## Output Format
Return ONLY a JSON object with this structure:
{
  "skills": ["skill1", "skill2", ...],
  "experiences": [
    {
      "jobTitle": "...",
      "jobEmployer": "...",
      "jobDuration": "...",
      "isCurrentEmployer": boolean,
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
  ],
  "tailorSummary": "Brief 2-3 sentence professional summary tailored to this role",
  "keywordsAdded": ["keyword1", "keyword2"],
  "changesDescription": "Brief description of what was changed and why"
}

Keep all existing experiences but enhance their descriptions. Reorder skills to put the most relevant first.`;
}

/**
 * Call OpenRouter API (Claude via OpenRouter).
 */
async function openRouterChatCompletion({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs,
  temperature = 0.3,
}) {
  const { controller, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(OPENROUTER_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://exempliphai.app',
        'X-Title': 'Exempliphai Resume Tailor',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: 4096,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      const msg = json?.error?.message || `OpenRouter HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.details = json;
      throw err;
    }

    const text = json?.choices?.[0]?.message?.content;
    if (!text) {
      const err = new Error('OpenRouter response missing message content');
      err.details = json;
      throw err;
    }

    // Extract usage for logging
    const usage = json?.usage || {};
    return {
      raw: json,
      text,
      tokensIn: usage.prompt_tokens || 0,
      tokensOut: usage.completion_tokens || 0,
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
      const status = e?.status;
      const transient = status >= 500 || status === 429 || status === 408;
      if (attempt >= maxRetries || !transient) throw e;
      await sleep(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 300));
    }
  }
  throw lastErr;
}

/**
 * Create a Claude provider instance (via OpenRouter).
 */
export function createClaudeProvider(cfg) {
  const apiKey = cfg?.apiKey;
  if (!apiKey) throw new Error('Claude provider requires OpenRouter API key');

  const model = cfg?.model || CLAUDE_DEFAULT_MODEL;
  const timeoutMs = Number.isFinite(cfg?.timeoutMs) ? cfg.timeoutMs : 60000;
  const maxRetries = Number.isFinite(cfg?.maxRetries) ? cfg.maxRetries : 2;

  return {
    /**
     * Tailor a resume for a specific job.
     *
     * @param {{ resumeData: object|string, jobTitle: string, jobDescription: string }} args
     * @returns {Promise<{ tailored: object, tokensIn: number, tokensOut: number, changesDescription: string }>}
     */
    async tailorResume(args) {
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
            temperature: 0.3,
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
          changesDescription: parsed.changesDescription || 'Resume tailored successfully.',
        };
      } catch (e) {
        const err = new Error('Failed to parse tailored resume JSON from Claude');
        err.cause = e;
        err.rawText = result.text;
        throw err;
      }
    },
  };
}

/**
 * Convenience: stateless tailorResume function.
 */
export async function tailorResume(args) {
  const p = createClaudeProvider({
    apiKey: args?.apiKey,
    model: args?.model,
    timeoutMs: args?.timeoutMs,
    maxRetries: args?.maxRetries,
  });
  return p.tailorResume(args);
}

// Expose for classic-script usage
try {
  globalThis.__exempliphaiProviders = globalThis.__exempliphaiProviders || {};
  globalThis.__exempliphaiProviders.claude = {
    createClaudeProvider,
    tailorResume,
    buildTailorSystemPrompt,
    buildTailorUserPrompt,
    CLAUDE_DEFAULT_MODEL,
    OPENROUTER_API_BASE,
  };
} catch (_) {}
