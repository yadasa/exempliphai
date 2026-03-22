<template>
  <div class="jobSearch">
    <div class="action-card">
      <h2 class="subheading">Job Search</h2>
      <p class="helper">
        Generate 10–15 job ideas that match your resume (including a few slightly aspirational roles).
        Recommendations are created locally in this extension and sent to the model without personal contact info.
      </p>

      <button
        class="action-btn primary"
        @click="searchJobs"
        :disabled="loading"
      >
        {{ loading ? 'Searching…' : 'Search Jobs Matching My Resume' }}
      </button>

      <div v-if="status" class="status">{{ status }}</div>
      <div v-if="error" class="error">{{ error }}</div>

      <div v-if="meta" class="meta">
        <div><b>Model:</b> {{ meta.model }}</div>
        <div><b>Generated:</b> {{ meta.generatedAt }}</div>
        <div v-if="meta.tokensIn || meta.tokensOut"><b>Tokens:</b> {{ meta.tokensIn }} in / {{ meta.tokensOut }} out</div>
      </div>
    </div>

    <div v-if="jobs.length" class="grid">
      <div class="job-card" v-for="(j, idx) in jobs" :key="idx">
        <div class="job-title">{{ j.title || 'Untitled role' }}</div>

        <div class="row" v-if="j.company_types">
          <div class="label">Company types</div>
          <div class="value">{{ asList(j.company_types) }}</div>
        </div>

        <div class="row" v-if="j.salary_range">
          <div class="label">Salary</div>
          <div class="value">{{ j.salary_range }}</div>
        </div>

        <div class="row" v-if="j.locations">
          <div class="label">Locations</div>
          <div class="value">{{ asList(j.locations) }}</div>
        </div>

        <div class="row" v-if="j.why_match">
          <div class="label">Why it fits</div>
          <div class="value why">{{ j.why_match }}</div>
        </div>

        <div class="actions">
          <button class="action-btn secondary" @click="openSearch(j)" :disabled="!j.search_link">
            Open Search
          </button>
          <button class="action-btn primary" @click="openTailorApply(j)" :disabled="tailorLoading">
            Tailor &amp; Apply
          </button>
        </div>
      </div>
    </div>

    <!-- Tailor & Apply modal -->
    <div v-if="showTailorModal" class="modal-backdrop" @click.self="closeTailorModal">
      <div class="modal">
        <div class="modal-header">
          <h3 style="margin:0;">Tailor &amp; Apply</h3>
          <button class="x" @click="closeTailorModal">✕</button>
        </div>

        <p class="helper" style="margin-top: 0;">
          This will tailor your saved resume details to the <b>current page's</b> job description (when available), save it,
          then trigger autofill on the current tab.
        </p>

        <div class="row" style="margin-top: 0.5rem;">
          <div class="label">Job title</div>
          <input class="text" v-model="tailorJobTitle" placeholder="e.g. Senior Software Engineer" />
        </div>

        <div class="row" style="margin-top: 0.5rem;">
          <div class="label">Job description</div>
          <textarea class="textarea" v-model="tailorJobDescription" placeholder="Paste the job description (or click Extract)…"></textarea>
        </div>

        <div class="actions" style="margin-top: 0.75rem;">
          <button class="action-btn secondary" @click="extractFromCurrentPage" :disabled="tailorLoading">
            Extract from Current Page
          </button>
          <button class="action-btn primary" @click="runTailorAndAutofill" :disabled="tailorLoading">
            {{ tailorLoading ? 'Working…' : 'Tailor + Autofill Now' }}
          </button>
        </div>

        <div v-if="tailorStatus" class="status">{{ tailorStatus }}</div>
        <div v-if="tailorError" class="error">{{ tailorError }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

// Import shared provider implementation.
// NOTE: This is also used by content scripts via dynamic import().
import { createGeminiProvider } from '../../public/contentScripts/providers/gemini.js';

type JobRec = {
  title?: string;
  company_types?: string[] | string;
  salary_range?: string;
  locations?: string[] | string;
  why_match?: string;
  search_link?: string;
};

type JobSearchMeta = {
  model: string;
  generatedAt: string;
  tokensIn: number;
  tokensOut: number;
};

const jobs = ref<JobRec[]>([]);
const meta = ref<JobSearchMeta | null>(null);
const loading = ref(false);
const status = ref('');
const error = ref('');

const showTailorModal = ref(false);
const tailorLoading = ref(false);
const tailorStatus = ref('');
const tailorError = ref('');
const tailorJobTitle = ref('');
const tailorJobDescription = ref('');

const storageSyncGet = (keys: any) =>
  new Promise<any>((resolve) => {
    try {
      chrome.storage.sync.get(keys, (res) => resolve(res || {}));
    } catch (_) {
      resolve({});
    }
  });

const storageLocalGet = (keys: any) =>
  new Promise<any>((resolve) => {
    try {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    } catch (_) {
      resolve({});
    }
  });

const storageLocalSet = (obj: any) =>
  new Promise<boolean>((resolve) => {
    try {
      chrome.storage.local.set(obj, () => resolve(true));
    } catch (_) {
      resolve(false);
    }
  });

const estimateCostUsd = (tokensIn: number, tokensOut: number) => {
  const inTok = Number.isFinite(tokensIn) && tokensIn > 0 ? tokensIn : 0;
  const outTok = Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0;
  // Best-effort estimate (USD per 1M tokens)
  const USD_PER_1M_IN = 5.0;
  const USD_PER_1M_OUT = 15.0;
  const usd = (inTok * USD_PER_1M_IN + outTok * USD_PER_1M_OUT) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
};

const appendAuditLog = async (entry: any) => {
  try {
    const got = await storageLocalGet(['audit_log']);
    const cur = Array.isArray(got.audit_log) ? got.audit_log : [];
    const next = cur.concat([entry]).slice(-1000);
    await storageLocalSet({ audit_log: next });
  } catch (e) {
    console.warn('Failed to append audit_log', e);
  }
};

function asList(v: any): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return String(v || '').trim();
}

function looksLikeUrl(u: any): boolean {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s);
}

function scrubResumeText(raw: string): string {
  let s = String(raw || '');

  // Emails
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  // Phone numbers (best-effort)
  s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, '[REDACTED_PHONE]');
  // URLs
  s = s.replace(/https?:\/\/\S+/gi, '[REDACTED_URL]');

  // Trim very long resumes
  if (s.length > 16000) s = s.slice(0, 16000);
  return s;
}

function redactObjectDeep(input: any): any {
  try {
    if (input == null) return input;
    if (Array.isArray(input)) return input.map(redactObjectDeep);
    if (typeof input !== 'object') return input;

    const out: any = {};
    for (const [k, v] of Object.entries(input)) {
      const key = String(k || '').toLowerCase();
      const isPiiKey =
        key.includes('email') ||
        key.includes('phone') ||
        key.includes('address') ||
        key.includes('street') ||
        key.includes('postal') ||
        key.includes('zip') ||
        key.includes('linkedin') ||
        key.includes('github') ||
        key.includes('website') ||
        key.includes('url') ||
        key.includes('name');

      if (isPiiKey) continue;
      out[k] = redactObjectDeep(v);
    }
    return out;
  } catch (_) {
    return input;
  }
}

async function getResumeForJobSearch(): Promise<{ kind: 'details' | 'text'; payload: any } | null> {
  const local = await storageLocalGet([
    'tailored_resume_details',
    'tailored_resume_text',
    'Resume_details',
    'Resume_text',
  ]);

  // Prefer structured tailored details (best for privacy).
  const tailoredDetails = local?.tailored_resume_details;
  const baseDetails = local?.Resume_details;

  if (tailoredDetails) {
    return { kind: 'details', payload: redactObjectDeep(tailoredDetails) };
  }
  if (baseDetails) {
    return { kind: 'details', payload: redactObjectDeep(baseDetails) };
  }

  const tailoredText = String(local?.tailored_resume_text || '').trim();
  if (tailoredText) return { kind: 'text', payload: scrubResumeText(tailoredText) };

  const baseText = String(local?.Resume_text || '').trim();
  if (baseText) return { kind: 'text', payload: scrubResumeText(baseText) };

  return null;
}

async function searchJobs() {
  if (loading.value) return;

  error.value = '';
  status.value = '';
  loading.value = true;

  try {
    const sync = await storageSyncGet(['API Key', 'AI Model', 'consents']);
    const apiKey = String(sync?.consents?.geminiApiKey || sync?.['API Key'] || '').trim();
    const model = String(sync?.['AI Model'] || 'gemini-1.5-flash').trim();

    if (!apiKey) throw new Error('Missing Gemini API Key (Settings → General).');

    const resume = await getResumeForJobSearch();
    if (!resume) {
      throw new Error('No resume found. Go to the Experience tab and upload your Resume so Exempliphai can parse it.');
    }

    status.value = 'Calling model…';

    const provider = createGeminiProvider({ apiKey, model });
    const resp = await provider.recommendJobs({
      model,
      resumeData: resume.kind === 'details' ? resume.payload : undefined,
      resumeText: resume.kind === 'text' ? resume.payload : undefined,
      countMin: 10,
      countMax: 15,
    });

    const recs = Array.isArray(resp?.jobs) ? resp.jobs : [];
    jobs.value = recs.slice(0, 20);

    const tokensIn = Number(resp?.tokensIn || 0);
    const tokensOut = Number(resp?.tokensOut || 0);

    meta.value = {
      model,
      generatedAt: new Date().toISOString(),
      tokensIn,
      tokensOut,
    };

    await storageLocalSet({
      job_search_last_results: jobs.value,
      job_search_last_meta: meta.value,
    });

    // Audit log
    try {
      const cost = estimateCostUsd(tokensIn, tokensOut);
      await appendAuditLog({
        ts: new Date().toISOString(),
        event: 'job_search_recs',
        model,
        input_tokens: tokensIn,
        output_tokens: tokensOut,
        cost_estimate: cost,
      });
      status.value = `Generated ${jobs.value.length} recommendations. Tokens: ${tokensIn} in / ${tokensOut} out. Est. cost: $${cost.toFixed(4)}.`;
    } catch (_) {
      status.value = `Generated ${jobs.value.length} recommendations.`;
    }
  } catch (e: any) {
    error.value = String(e?.message || e);
    status.value = '';
  } finally {
    loading.value = false;
  }
}

function openSearch(j: JobRec) {
  try {
    const url = String(j?.search_link || '').trim();
    if (!looksLikeUrl(url)) {
      alert('Missing/invalid search link.');
      return;
    }
    chrome.tabs.create({ url });
  } catch (e: any) {
    alert(String(e?.message || e));
  }
}

function closeTailorModal() {
  showTailorModal.value = false;
  tailorError.value = '';
  tailorStatus.value = '';
}

function openTailorApply(j: JobRec) {
  tailorError.value = '';
  tailorStatus.value = '';
  tailorJobTitle.value = String(j?.title || '').trim();
  tailorJobDescription.value = '';
  showTailorModal.value = true;

  // Best-effort: try extraction immediately.
  extractFromCurrentPage();
}

async function extractFromCurrentPage() {
  tailorError.value = '';
  try {
    const resp: any = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'EXTRACT_JOB_CONTEXT' }, (r) => resolve(r));
      } catch (e) {
        resolve({ ok: false, error: String((e as any)?.message || e) });
      }
    });

    if (resp?.ok !== true) {
      tailorStatus.value = '';
      tailorError.value = resp?.error || resp?.reason || 'Failed to extract job context.';
      return;
    }

    const jt = String(resp?.jobTitle || '').trim();
    const jd = String(resp?.jobDescription || '').trim();

    if (jt && !tailorJobTitle.value.trim()) tailorJobTitle.value = jt;
    if (jd && !tailorJobDescription.value.trim()) tailorJobDescription.value = jd;

    tailorStatus.value = jt || jd ? 'Extracted job context from page.' : 'Could not detect job description; paste it manually.';
  } catch (e: any) {
    tailorError.value = String(e?.message || e);
  }
}

async function runTailorAndAutofill() {
  if (tailorLoading.value) return;
  tailorError.value = '';
  tailorStatus.value = '';
  tailorLoading.value = true;

  try {
    const jobTitle = String(tailorJobTitle.value || '').trim();
    const jobDescription = String(tailorJobDescription.value || '').trim();

    if (!jobDescription || jobDescription.length < 120) {
      const ok = confirm('Job description is missing/short. Tailor anyway (generic)?');
      if (!ok) return;
    }

    const sync = await storageSyncGet(['API Key', 'AI Model', 'autoTailorResumes', 'consents']);
    const apiKey = String(sync?.consents?.geminiApiKey || sync?.['API Key'] || '').trim();
    const model = String(sync?.['AI Model'] || 'gemini-1.5-flash').trim();
    const autoTailorEnabled = sync?.autoTailorResumes === true;

    // If Auto-Tailor is enabled, let the content script tailor during autofill.
    // This keeps behavior consistent with the existing auto-tailor cache/guardrails.
    if (autoTailorEnabled) {
      tailorStatus.value = 'Auto-Tailor is enabled. Triggering autofill (tailoring will run automatically on supported pages)…';

      const autoResp: any = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'SMARTAPPLY_AUTOFILL_NOW' }, (r) => resolve(r));
        } catch (e) {
          resolve({ ok: false, error: String((e as any)?.message || e) });
        }
      });

      if (autoResp?.ok !== true) {
        throw new Error(autoResp?.error || autoResp?.reason || 'Failed to trigger autofill. Open a supported application page and try again.');
      }

      tailorStatus.value = 'Autofill triggered on current tab (auto-tailor will run if job description is detected).';
      return;
    }

    if (!apiKey) throw new Error('Missing Gemini API Key (Settings → General).');

    const local = await storageLocalGet(['Resume_details']);
    let resumeDetails: any = local?.Resume_details;
    if (!resumeDetails) throw new Error('Missing Resume_details. Upload your resume first so Exempliphai can parse it.');
    if (typeof resumeDetails === 'string') {
      try {
        resumeDetails = JSON.parse(resumeDetails);
      } catch (_) {
        // keep as string
      }
    }

    tailorStatus.value = 'Tailoring resume…';

    const provider = createGeminiProvider({ apiKey, model });
    const r: any = await provider.tailorResume({
      apiKey,
      model,
      resumeData: resumeDetails,
      jobTitle,
      jobDescription,
      timeoutMs: 70000,
      maxRetries: 1,
    });

    const tailoredRoot = r?.tailored || {};
    const details = tailoredRoot?.tailored_resume_details && typeof tailoredRoot.tailored_resume_details === 'object'
      ? tailoredRoot.tailored_resume_details
      : (tailoredRoot?.skills ? tailoredRoot : null);

    if (!details) throw new Error('Tailored output missing tailored_resume_details.');

    await storageLocalSet({
      tailored_resume_details: details,
      tailored_resume_text: String(tailoredRoot?.tailored_resume_text || '').slice(0, 20000),
      tailored_resume_meta: {
        jobTitle,
        model,
        generatedAt: new Date().toISOString(),
        tokensIn: Number(r?.tokensIn || 0),
        tokensOut: Number(r?.tokensOut || 0),
      },
      tailored_resume_changes: String(r?.changesDescription || tailoredRoot?.changesDescription || '').slice(0, 2000),
      tailored_resume_keywordsAdded: Array.isArray(tailoredRoot?.keywordsAdded) ? tailoredRoot.keywordsAdded.slice(0, 80) : [],
    });

    // Audit log
    try {
      const tokensIn = Number(r?.tokensIn || 0);
      const tokensOut = Number(r?.tokensOut || 0);
      await appendAuditLog({
        ts: new Date().toISOString(),
        event: 'tailor_resume_from_job_search',
        model,
        input_tokens: tokensIn,
        output_tokens: tokensOut,
        cost_estimate: estimateCostUsd(tokensIn, tokensOut),
      });
    } catch (_) {}

    tailorStatus.value = 'Saved tailored resume. Triggering autofill…';

    const autoResp: any = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'SMARTAPPLY_AUTOFILL_NOW' }, (r) => resolve(r));
      } catch (e) {
        resolve({ ok: false, error: String((e as any)?.message || e) });
      }
    });

    if (autoResp?.ok !== true) {
      throw new Error(autoResp?.error || autoResp?.reason || 'Failed to trigger autofill. Open a supported application page and try again.');
    }

    tailorStatus.value = 'Autofill triggered on current tab.';
  } catch (e: any) {
    tailorError.value = String(e?.message || e);
    tailorStatus.value = '';
  } finally {
    tailorLoading.value = false;
  }
}

onMounted(async () => {
  try {
    const local = await storageLocalGet(['job_search_last_results', 'job_search_last_meta']);
    const prev = Array.isArray(local?.job_search_last_results) ? local.job_search_last_results : [];
    if (prev.length) jobs.value = prev;
    if (local?.job_search_last_meta) meta.value = local.job_search_last_meta;
  } catch (_) {}
});
</script>

<style scoped>
.jobSearch {
  padding: 0.25rem 0;
}

.action-card {
  background: var(--card-bg);
  padding: 1rem;
  border-radius: 14px;
  border: 1px solid var(--card-border);
  box-shadow: var(--shadow-1);
  margin-bottom: 1rem;
}

.helper {
  font-size: 0.92rem;
  color: var(--text-secondary);
  line-height: 1.45;
  margin-top: 0.35rem;
  margin-bottom: 0.75rem;
}

.action-btn {
  padding: 0.7rem 1rem;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 800;
  width: 100%;
  transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
}

.action-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.action-btn.primary {
  background: var(--gradient-primary);
  color: white;
  box-shadow: 0 18px 35px rgba(102, 126, 234, 0.25);
}

.action-btn.secondary {
  background: rgba(15, 23, 42, 0.08);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  box-shadow: var(--shadow-1);
}

.action-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.02);
}

.status {
  margin-top: 0.6rem;
  font-size: 0.88rem;
  color: var(--text-secondary);
}

.error {
  margin-top: 0.6rem;
  font-size: 0.9rem;
  color: #ef4444;
  font-weight: 700;
}

.meta {
  margin-top: 0.65rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.35;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem;
}

.job-card {
  background: var(--card-bg);
  padding: 0.95rem;
  border-radius: 14px;
  border: 1px solid var(--card-border);
  box-shadow: var(--shadow-1);
}

.job-title {
  font-weight: 900;
  color: var(--text-primary);
  margin-bottom: 0.55rem;
  letter-spacing: -0.01em;
}

.row {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.4rem;
}

.label {
  min-width: 104px;
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 800;
}

.value {
  color: var(--text-primary);
  font-size: 0.9rem;
  line-height: 1.35;
}

.value.why {
  white-space: pre-wrap;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  margin-top: 0.8rem;
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem;
}

.modal {
  width: 100%;
  max-width: 420px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 1rem;
  box-shadow: 0 30px 80px rgba(0,0,0,0.25);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.modal-header .x {
  border: none;
  background: rgba(15, 23, 42, 0.08);
  border: 1px solid var(--border-color);
  width: 34px;
  height: 34px;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 900;
}

.text {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 0.6rem 0.7rem;
  font-weight: 650;
}

.textarea {
  width: 100%;
  min-height: 120px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 0.6rem 0.7rem;
  font-weight: 650;
  resize: vertical;
}
</style>
