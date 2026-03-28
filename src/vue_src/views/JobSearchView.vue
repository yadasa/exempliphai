<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { filterDirectApplicationLinks, isDirectApplicationUrl } from '@/utils/jobLinks.js';

type JobLink = { label?: string; url: string };

type JobRec = {
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  why_match?: string;
  links?: JobLink[];
};

type JobSearchResponse = {
  version?: string;
  generated_at?: string;
  recommendations: JobRec[];
};

const desiredLocation = ref('');
const loading = ref(false);
const errorMsg = ref('');
const recs = ref<JobRec[]>([]);

const appliedKeys = ref<Set<string>>(new Set());

const hasRecs = computed(() => Array.isArray(recs.value) && recs.value.length > 0);

function extractFirstJsonObject(text: string): string | null {
  const s = String(text || '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

function buildJobRecsSystemPrompt(): string {
  return `You are a job recommendation engine.
Return ONLY valid JSON.
Do not include any prose outside JSON.`;
}

function buildJobRecsUserPrompt({
  profile = {},
  resumeDetails = {},
  desiredLocation = '',
  countMin = 10,
  countMax = 15,
}: {
  profile?: any;
  resumeDetails?: any;
  desiredLocation?: string;
  countMin?: number;
  countMax?: number;
} = {}): string {
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

async function geminiGenerateJson({ apiKey, promptText }: { apiKey: string; promptText: string }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.error) {
    const msg = (json as any)?.error?.message || `Gemini HTTP ${res.status}`;
    throw new Error(msg);
  }

  const text = (json as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini response missing text');

  const jsonText = extractFirstJsonObject(text) || text;
  return JSON.parse(jsonText);
}

function canonUrlKey(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const base = `${u.origin}${u.pathname}`;
    return base.replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

function openUrl(url: string) {
  const u = String(url || '').trim();
  if (!u) return;
  chrome.tabs.create({ url: u });
}

function isRecApplied(rec: JobRec): boolean {
  const links = Array.isArray(rec?.links) ? rec.links : [];
  return links.some((l) => {
    const k = canonUrlKey(String((l as any)?.url || ''));
    return k && appliedKeys.value.has(k);
  });
}

async function markApplied(rec: JobRec) {
  const links = Array.isArray(rec?.links) ? rec.links : [];
  const first = links.find((l) => l && typeof (l as any)?.url === 'string' && isDirectApplicationUrl((l as any).url));
  if (!first?.url) throw new Error('No direct application link for this recommendation.');

  const item = {
    company: String(rec.company || '').trim() || 'Unknown',
    role: String(rec.title || '').trim() || 'Unknown',
    url: String(first.url).trim(),
    date: new Date().toISOString(),
  };

  const cur = await new Promise<any>((resolve) => chrome.storage.local.get(['AppliedJobs'], (r) => resolve(r || {})));
  const arr = Array.isArray(cur.AppliedJobs) ? cur.AppliedJobs : [];
  const next = [item, ...arr].filter((j, idx, self) => idx === self.findIndex((x: any) => String(x?.url || '') === item.url));
  await new Promise((resolve) => chrome.storage.local.set({ AppliedJobs: next }, () => resolve(true)));

  appliedKeys.value.add(canonUrlKey(item.url));
}

function openTailorApply(rec: JobRec) {
  const first = (Array.isArray(rec?.links) ? rec.links : []).find((l) =>
    l && typeof (l as any)?.url === 'string' && isDirectApplicationUrl((l as any).url)
  );
  if (first?.url) {
    openUrl(first.url);
    return;
  }

  // No fallbacks to Google/search engines — direct links only.
  alert('No direct application link is available for this recommendation.');
}

async function generateRecommendations() {
  errorMsg.value = '';
  recs.value = [];
  loading.value = true;

  try {
    const apiKey = await new Promise<string>((resolve) => {
      chrome.storage.sync.get(['API Key'], (res) => resolve(String((res as any)?.['API Key'] || '')));
    });

    if (!apiKey) throw new Error('Missing Gemini API key. Add it in Settings.');

    const resumeDetails = await new Promise<any>((resolve) => {
      chrome.storage.local.get(['Resume_details'], (res) => resolve((res as any)?.Resume_details || {}));
    });

    const profile = await new Promise<any>((resolve) => {
      chrome.storage.sync.get(null, (res) => resolve(res || {}));
    });

    const promptText = `${buildJobRecsSystemPrompt()}\n\n---\n\n${buildJobRecsUserPrompt({
      profile,
      resumeDetails,
      desiredLocation: desiredLocation.value,
    })}`;

    const out = (await geminiGenerateJson({ apiKey, promptText })) as JobSearchResponse;
    const list = Array.isArray(out?.recommendations) ? out.recommendations : [];
    recs.value = list
      .filter((r) => r && typeof r.title === 'string' && r.title.trim())
      .slice(0, 15)
      .map((r) => ({
        title: String(r.title).trim(),
        company: r.company ? String(r.company).trim() : '',
        location: r.location ? String(r.location).trim() : '',
        salary: r.salary ? String(r.salary).trim() : '',
        why_match: r.why_match ? String(r.why_match).trim() : '',
        links: filterDirectApplicationLinks((r as any).links).slice(0, 4),
      }));

    chrome.storage.local.set(
      {
        jobSearchLast: {
          version: String((out as any)?.version || '0.1'),
          generated_at: String((out as any)?.generated_at || new Date().toISOString()),
          desiredLocation: String(desiredLocation.value || ''),
          recommendations: recs.value,
        },
      },
      () => {}
    );

    // Best-effort: count AI usage in cloud stats.
    try {
      chrome.runtime.sendMessage({
        action: 'FIREBASE_INCREMENT_STATS',
        customAnswersGenerated: 1,
        setLastCustomAnswer: true,
        source: 'job_search',
      });
    } catch (_) {}
  } catch (e: any) {
    errorMsg.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

// Load cached recs quickly on view init
onMounted(() => {
  try {
    chrome.storage.local.get(['jobSearchLast'], (res) => {
      const last = (res as any)?.jobSearchLast || {};
      const prev = last?.recommendations;
      const prevLoc = last?.desiredLocation;
      if (!desiredLocation.value && typeof prevLoc === 'string') desiredLocation.value = prevLoc;
      if (Array.isArray(prev) && prev.length) recs.value = prev;
    });
  } catch (_) {}

  try {
    chrome.storage.local.get(['AppliedJobs'], (res) => {
      const jobs = Array.isArray((res as any)?.AppliedJobs) ? (res as any).AppliedJobs : [];
      const next = new Set<string>();
      for (const j of jobs) {
        const u = canonUrlKey(String((j as any)?.url || ''));
        if (u) next.add(u);
      }
      appliedKeys.value = next;
    });
  } catch (_) {}

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes?.AppliedJobs) return;
      const jobs = Array.isArray(changes.AppliedJobs.newValue) ? changes.AppliedJobs.newValue : [];
      const next = new Set<string>();
      for (const j of jobs) {
        const u = canonUrlKey(String((j as any)?.url || ''));
        if (u) next.add(u);
      }
      appliedKeys.value = next;
    });
  } catch (_) {}
});
</script>

<template>
  <div>
    <h2 class="subheading">Job Search</h2>

    <div class="action-card" style="margin-bottom: 0.9rem;">
      <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.35;">
        Generate 10–15 job recommendations based on your saved resume details.
      </p>

      <div style="display:flex; gap:0.5rem; align-items:center;">
        <input
          v-model="desiredLocation"
          type="text"
          placeholder="Desired location (optional)"
          style="flex:1; padding: 10px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);"
        />
        <button
          class="action-btn export-btn"
          @click="generateRecommendations"
          :disabled="loading"
          style="white-space:nowrap;"
        >
          {{ loading ? 'Generating…' : 'Generate' }}
        </button>
      </div>

      <p v-if="errorMsg" style="margin: 0.6rem 0 0; color: #ef4444; font-size: 0.9rem;">
        {{ errorMsg }}
      </p>
    </div>

    <div v-if="!hasRecs && !loading" style="color: var(--text-secondary); font-size: 0.9rem;">
      No recommendations yet.
    </div>

    <div v-if="hasRecs" class="data-actions">
      <div v-for="(rec, idx) in recs" :key="idx" class="action-card">
        <h3 style="margin-bottom: 0.25rem;">{{ rec.title }}</h3>
        <p style="margin: 0.1rem 0; color: var(--text-secondary);">
          <span v-if="rec.company"><b>{{ rec.company }}</b></span>
          <span v-if="rec.location"> · {{ rec.location }}</span>
          <span v-if="rec.salary"> · {{ rec.salary }}</span>
        </p>
        <p v-if="rec.why_match" style="margin: 0.5rem 0 0; font-size: 0.9rem; line-height: 1.35;">
          {{ rec.why_match }}
        </p>

        <div style="display:flex; gap:0.5rem; margin-top: 0.75rem; align-items:center; flex-wrap: wrap;">
          <span
            v-if="isRecApplied(rec)"
            style="font-size: 0.75rem; font-weight: 900; padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(34,197,94,0.55); color: rgba(34,197,94,0.95);"
          >
            Applied
          </span>

          <button
            class="action-btn"
            style="background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; flex:1; min-width: 140px;"
            @click="openTailorApply(rec)"
            :disabled="!(rec.links && rec.links.length)"
            :title="(rec.links && rec.links.length) ? 'Open the direct application link' : 'No direct application link available'"
          >
            {{ (rec.links && rec.links.length) ? 'Open Apply Link' : 'No Apply Link' }}
          </button>

          <button
            class="action-btn"
            style="background: linear-gradient(135deg, #22c55e, #16a34a); color: white; flex:1; min-width: 140px;"
            @click="markApplied(rec)"
            :disabled="isRecApplied(rec) || !(rec.links && rec.links.length)"
            :title="isRecApplied(rec) ? 'Already marked applied' : 'Add to Applied Jobs'"
          >
            {{ isRecApplied(rec) ? 'Applied' : 'Mark Applied' }}
          </button>
        </div>

        <div v-if="rec.links && rec.links.length" style="margin-top: 0.75rem;">
          <div v-for="(l, li) in rec.links" :key="li" style="font-size: 0.85rem; margin-top: 0.2rem;">
            <a :href="l.url" target="_blank" style="color: var(--accent-color); text-decoration: none;">{{ l.label || l.url }}</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
