/**
 * Build the prompt for resume tailoring.
 * Keep this as JS (not TS) so node:test can import it directly.
 */

function clipText(s, maxChars) {
  const t = String(s || '');
  if (!maxChars || t.length <= maxChars) return t;
  return t.slice(0, maxChars);
}

/**
 * @param {{jobTitle?:string, company?:string, pageUrl?:string, jobDescription?:string}} args
 */
export function buildTailorResumePrompt({
  jobTitle = '',
  company = '',
  pageUrl = '',
  jobDescription = '',
} = {}) {
  const jt = String(jobTitle || '').trim();
  const co = String(company || '').trim();
  const url = String(pageUrl || '').trim();
  const jd = clipText(String(jobDescription || '').trim(), 12000);

  return `You are an expert resume writer and editor.

You will receive:
- A candidate's resume as an attached PDF (this is the ONLY authoritative source of facts)
- Job context (title/company/page URL)
- A job description extracted from the active tab (may be partial)

Task:
Surgically tailor the resume to the job description.
- Make minimal, high-impact edits; preserve the candidate's original facts.
- Reorder, tighten, and rephrase bullets to better match the JD.
- Align keywords and tooling ONLY if they are already present in the resume.
- Do NOT invent employers, degrees, certifications, job titles, dates, metrics, or technologies.
- If the JD requires something not found in the resume, do NOT claim it.

Output:
Return ONLY valid JSON with this exact structure (no extra keys):
{
  "version": "0.1",
  "job_title": "",
  "company": "",
  "tailored_resume_text": ""
}

Formatting constraints for tailored_resume_text:
- Plain text, ATS-friendly (no tables, no markdown)
- 1 page maximum
- HARD LIMIT: <= 600 words (target 400–600 words)
- Use clear section headings and concise bullet points
- Prefer strong action verbs; remove filler and redundant lines

Job title: ${jt || '(unknown)'}
Company: ${co || '(unknown)'}
Page URL: ${url || '(unknown)'}

Job description:
${jd || '(not found)'}
`;
}
