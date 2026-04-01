/**
 * Build the prompt for resume tailoring.
 * Keep this as JS (not TS) so node:test can import it directly.
 */

function clipText(s, maxChars) {
  const t = String(s || '');
  if (!maxChars || t.length <= maxChars) return t;
  return t.slice(0, maxChars);
}

function clipJobDescriptionSmart(jdRaw, maxChars) {
  const jd = String(jdRaw || '').trim();
  if (!jd) return '';
  if (!maxChars || jd.length <= maxChars) return jd;

  // Try to keep the most useful sections first (responsibilities/requirements/nice-to-haves).
  const patterns = [
    /(responsibilit(?:y|ies)|what you\s*will\s*do|the\s*role)/i,
    /(requirements|qualifications|what\s*you\s*bring|you\s*have)/i,
    /(nice\s*to\s*haves?|preferred|bonus|plus)/i,
  ];

  const lower = jd.toLowerCase();
  const picks = [];

  for (const re of patterns) {
    const m = lower.match(re);
    if (!m || m.index == null) continue;
    const start = Math.max(0, m.index - 150);
    const end = Math.min(jd.length, start + Math.floor(maxChars / 2));
    picks.push(jd.slice(start, end));
  }

  const combined = picks.filter(Boolean).join('\n\n---\n\n');
  if (combined && combined.length >= Math.floor(maxChars * 0.5)) {
    return combined.slice(0, maxChars);
  }

  // Fallback: head clip.
  return jd.slice(0, maxChars);
}

export function buildTailorKeywordsPrompt({
  jobTitle = '',
  company = '',
  pageUrl = '',
  jobDescription = '',
  jobDescriptionCharCount,
} = {}) {
  const jt = String(jobTitle || '').trim();
  const co = String(company || '').trim();
  const url = String(pageUrl || '').trim();
  const jd = clipJobDescriptionSmart(String(jobDescription || '').trim(), 12000);
  const jdLen = Number.isFinite(Number(jobDescriptionCharCount))
    ? Number(jobDescriptionCharCount)
    : String(jobDescription || '').trim().length;

  return `You extract job keywords for resume tailoring.

Return ONLY valid JSON with this exact structure (no extra keys):
{
  "version": "0.1",
  "job_title": "",
  "company": "",
  "job_keywords": [""],
  "must_haves": [""],
  "nice_to_haves": [""],
  "warnings": [""]
}

Rules:
- Use ONLY the job description text; do not invent requirements.
- Keep keywords concrete: tools, languages, domains, seniority signals.
- 8–18 job_keywords max.
- must_haves: 5–12 items.
- nice_to_haves: 0–8 items.

Source of truth:
- Job title: ${jt || '(unknown)'}
- Company: ${co || '(unknown)'}
- Page URL: ${url || '(unknown)'}
- Job description chars detected: ${jdLen}

Job description:
${jd || '(not found)'}
`;
}

/**
 * @param {{jobTitle?:string, company?:string, pageUrl?:string, jobDescription?:string}} args
 */
export function buildTailorResumePrompt({
  jobTitle = '',
  company = '',
  pageUrl = '',
  jobDescription = '',
  jobDescriptionCharCount,
  keywords,
  changeBudget,
} = {}) {
  const jt = String(jobTitle || '').trim();
  const co = String(company || '').trim();
  const url = String(pageUrl || '').trim();
  const jd = clipJobDescriptionSmart(String(jobDescription || '').trim(), 12000);
  const jdLen = Number.isFinite(Number(jobDescriptionCharCount))
    ? Number(jobDescriptionCharCount)
    : String(jobDescription || '').trim().length;

  const kb = keywords && typeof keywords === 'object' ? keywords : null;
  const budget = changeBudget && typeof changeBudget === 'object' ? changeBudget : {};
  const maxTotal = Number.isFinite(Number(budget.max_total_bullet_edits)) ? Number(budget.max_total_bullet_edits) : 20;
  const maxPerRole = Number.isFinite(Number(budget.max_edits_per_role)) ? Number(budget.max_edits_per_role) : 3;

  return `You are an expert resume writer and editor.

You will receive:
- A candidate's resume as an attached PDF (this is the ONLY authoritative source of facts)
- Job context (title/company/page URL)
- A job description extracted from the active tab (may be partial)
- (Optional) extracted job keywords

Task:
Surgically tailor the resume to the job description.

Hard rules:
- Preserve the candidate's original facts. Do NOT invent employers, degrees, certifications, dates, metrics, or technologies.
- You MAY rewrite bullets to sound much more tailored to the role (stronger verbs, clearer scope, role-relevant framing) as long as every claim remains defensible from the resume.
- You MAY make small job-title alignment edits (e.g. "Software Engineer" → "Backend Software Engineer") ONLY when clearly supported by the bullets/skills already present in the resume.
  - Do NOT inflate seniority (e.g. Engineer→Senior/Lead/Manager) unless the resume already supports it.
  - Do NOT change employer/company names or dates.
- Do NOT change contact info or section headings.
- Only adjust: Summary + Skills + up to ${maxPerRole} bullet points per role (max ${maxTotal} bullet edits total).
- Align keywords/tooling ONLY if they already exist somewhere in the resume.
- If the JD requires something not found in the resume, do NOT claim it; instead add a warning.

Output:
Return ONLY valid JSON with this exact structure (no extra keys):
{
  "version": "0.3",
  "job_title": "",
  "company": "",
  "tailored_resume_text": "",
  "changes": [
    {"section":"","type":"","before":"","after":""}
  ],
  "title_changes": [
    {"before":"","after":"","evidence":""}
  ],
  "warnings": [""]
}

Notes:
- If you do not change any job titles, return an empty title_changes array.
- evidence should quote the resume text that supports the alignment.

Formatting constraints for tailored_resume_text:
- Plain text, ATS-friendly (single column; no tables; no markdown)
- Use "- " hyphen bullets ONLY (convert any other bullet symbols)
- No weird unicode separators; ASCII punctuation preferred
- 1 page maximum
- HARD LIMIT: <= 600 words (target 400–600 words)
- Use clear section headings and concise bullet points
- Prefer strong action verbs; remove filler and redundant lines

Source of truth:
- Job title: ${jt || '(unknown)'}
- Company: ${co || '(unknown)'}
- Page URL: ${url || '(unknown)'}
- Job description chars detected: ${jdLen}

Job keywords (if provided):
${kb ? JSON.stringify(kb, null, 2) : '(none)'}

Job description:
${jd || '(not found)'}
`;
}
