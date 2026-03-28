<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { filterDirectApplicationLinks, isDirectApplicationUrl } from '@/utils/jobLinks.js';

type JobLink = { label?: string; url: string };

type ValidatedCandidate = {
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  directUrl: string;
  directUrlLabel?: string;
  sourceSystem?: string;
  confidenceScore?: number;
};

type JobRec = {
  // Display fields
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  why_match?: string;

  // Canonical link fields
  directUrl: string;
  directUrlLabel?: string;
  links?: JobLink[];

  // Persistence helpers
  dedupeKey?: string;
  resultId?: string;
  runId?: string;
};

type JobSearchResponse = {
  version?: string;
  generated_at?: string;
  recommendations: Array<{
    title: string;
    company?: string;
    location?: string;
    salary?: string;
    why_match?: string;
    links?: JobLink[];
  }>;
};

const desiredLocation = ref('');
const validatedCandidatesText = ref('');
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

function canonUrlKey(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const base = `${u.origin}${u.pathname}`;
    return base.replace(/\/+$/g, '');
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
  const k = canonUrlKey(rec.directUrl);
  return !!(k && appliedKeys.value.has(k));
}

function buildGeminiRankingPrompt({
  profile,
  resumeDetails,
  desiredLocation,
  candidates,
}: {
  profile: any;
  resumeDetails: any;
  desiredLocation: string;
  candidates: ValidatedCandidate[];
}): string {
  // NOTE: Gemini is ONLY used as a ranker/summarizer. It is forbidden from inventing URLs.
  return `Return ONLY valid JSON with this exact structure:
{
  "version": "0.2",
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

Hard rules:
- Use only jobs provided in VALIDATED_CANDIDATES.
- Do not invent or modify titles, companies, locations, or URLs.
- Do not output any URL that is not present verbatim in VALIDATED_CANDIDATES.
- Return fewer results if fewer candidates are strong.
- Keep why_match to 1-2 sentences.
- If salary is unknown, return an empty string.
- Exclude any candidate whose direct-link confidence is not high.

VALIDATED_CANDIDATES:
${JSON.stringify(candidates, null, 2)}

Desired location:
${desiredLocation || '(none)'}

Profile:
${JSON.stringify(profile || {}, null, 2)}

Resume details:
${JSON.stringify(resumeDetails || {}, null, 2)}
`;
}

async function geminiGenerateJson({ apiKey, promptText }: { apiKey: string; promptText: string }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`;

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

function parseValidatedCandidates(text: string): ValidatedCandidate[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Validated candidates must be a JSON array.');

  const out: ValidatedCandidate[] = [];
  for (const item of parsed) {
    const title = String(item?.title || '').trim();
    const company = String(item?.company || '').trim();
    const location = String(item?.location || '').trim();
    const salary = String(item?.salary || '').trim();
    const directUrl = String(item?.directUrl || item?.url || '').trim();

    if (!title || !directUrl) continue;
    if (!isDirectApplicationUrl(directUrl)) continue;

    out.push({
      title,
      company,
      location,
      salary,
      directUrl,
      directUrlLabel: item?.directUrlLabel ? String(item.directUrlLabel) : '',
      sourceSystem: item?.sourceSystem ? String(item.sourceSystem) : '',
      confidenceScore: Number.isFinite(item?.confidenceScore) ? Number(item.confidenceScore) : undefined,
    });
  }

  // De-dupe by directUrl + title + company
  const seen = new Set<string>();
  const deduped: ValidatedCandidate[] = [];
  for (const c of out) {
    const k = `${canonUrlKey(c.directUrl)}|${c.title.toLowerCase()}|${(c.company || '').toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(c);
  }

  return deduped;
}

async function markApplied(rec: JobRec) {
  const url = String(rec.directUrl || '').trim();
  if (!url) throw new Error('Missing directUrl.');
  if (!isDirectApplicationUrl(url)) throw new Error('No direct application link for this recommendation.');

  const item: any = {
    company: String(rec.company || '').trim() || 'Unknown',
    role: String(rec.title || '').trim() || 'Unknown',
    url,
    date: new Date().toISOString(),
  };

  // If we have IDs, carry them into AppliedJobs so the service worker can mark
  // the matching jobSearchResults doc as applied as well.
  if (rec.dedupeKey) item.dedupeKey = String(rec.dedupeKey);
  if (rec.resultId) item.resultId = String(rec.resultId);

  const cur = await new Promise<any>((resolve) => chrome.storage.local.get(['AppliedJobs'], (r) => resolve(r || {})));
  const arr = Array.isArray(cur.AppliedJobs) ? cur.AppliedJobs : [];
  const next = [item, ...arr].filter((j, idx, self) => idx === self.findIndex((x: any) => String(x?.url || '') === item.url));
  await new Promise((resolve) => chrome.storage.local.set({ AppliedJobs: next }, () => resolve(true)));

  appliedKeys.value.add(canonUrlKey(item.url));
}

function openTailorApply(rec: JobRec) {
  if (rec.directUrl && isDirectApplicationUrl(rec.directUrl)) {
    openUrl(rec.directUrl);
    return;
  }

  alert('No direct application link is available for this recommendation.');
}

async function rankValidatedCandidates() {
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

    const candidates = parseValidatedCandidates(validatedCandidatesText.value);
    if (!candidates.length) {
      throw new Error(
        'No validated candidates found. Paste a JSON array of validated job candidates with directUrl fields (direct posting/apply links).'
      );
    }

    // Keep the candidates around locally for reuse.
    chrome.storage.local.set({ jobSearchValidatedCandidatesText: String(validatedCandidatesText.value || '') }, () => {});

    const promptText = buildGeminiRankingPrompt({ profile, resumeDetails, desiredLocation: desiredLocation.value, candidates });

    const out = (await geminiGenerateJson({ apiKey, promptText })) as JobSearchResponse;

    const urlAllow = new Set<string>(candidates.map((c) => String(c.directUrl)));

    const list = Array.isArray(out?.recommendations) ? out.recommendations : [];
    const mapped: JobRec[] = [];

    for (const r of list) {
      const title = String((r as any)?.title || '').trim();
      if (!title) continue;

      const links = filterDirectApplicationLinks((r as any)?.links).slice(0, 4);
      const first = links[0];
      const url = String(first?.url || '').trim();
      if (!url) continue;

      // Hard post-model validator: URL must match verbatim one of the validated candidates.
      if (!urlAllow.has(url)) continue;

      const cand = candidates.find((c) => String(c.directUrl) === url) || null;

      mapped.push({
        title: title,
        company: String((r as any)?.company || cand?.company || '').trim(),
        location: String((r as any)?.location || cand?.location || '').trim(),
        salary: String((r as any)?.salary || cand?.salary || '').trim(),
        why_match: String((r as any)?.why_match || '').trim(),
        directUrl: url,
        directUrlLabel: String(first?.label || cand?.directUrlLabel || '').trim(),
        links: [{ label: String(first?.label || cand?.directUrlLabel || 'Apply'), url }],
      });

      if (mapped.length >= 15) break;
    }

    // "Up to 15" validated results; empty is acceptable.
    recs.value = mapped;

    chrome.storage.local.set(
      {
        jobSearchLast: {
          version: String((out as any)?.version || '0.2'),
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
        source: 'job_search_rank_only',
      });
    } catch (_) {}
  } catch (e: any) {
    errorMsg.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  // Restore candidates textarea
  try {
    chrome.storage.local.get(['jobSearchValidatedCandidatesText'], (res) => {
      const t = String((res as any)?.jobSearchValidatedCandidatesText || '');
      if (t && !validatedCandidatesText.value) validatedCandidatesText.value = t;
    });
  } catch (_) {}

  // Prefer active cached results (pulled from Firestore by the service worker),
  // otherwise fall back to last local run.
  try {
    chrome.storage.local.get(['jobSearchActive', 'jobSearchLast'], (res) => {
      const active = (res as any)?.jobSearchActive;
      if (active && Array.isArray(active?.recommendations) && active.recommendations.length) {
        recs.value = active.recommendations;
        if (!desiredLocation.value && typeof active?.desiredLocation === 'string') desiredLocation.value = active.desiredLocation;
        return;
      }

      const last = (res as any)?.jobSearchLast || {};
      const prev = last?.recommendations;
      const prevLoc = last?.desiredLocation;
      if (!desiredLocation.value && typeof prevLoc === 'string') desiredLocation.value = prevLoc;
      if (Array.isArray(prev) && prev.length) recs.value = prev;
    });
  } catch (_) {}

  // Applied keys local cache
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

  // Live updates
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes?.AppliedJobs) {
        const jobs = Array.isArray(changes.AppliedJobs.newValue) ? changes.AppliedJobs.newValue : [];
        const next = new Set<string>();
        for (const j of jobs) {
          const u = canonUrlKey(String((j as any)?.url || ''));
          if (u) next.add(u);
        }
        appliedKeys.value = next;
      }

      if (changes?.jobSearchActive) {
        const next = changes.jobSearchActive.newValue;
        if (next && Array.isArray(next?.recommendations)) {
          recs.value = next.recommendations;
          if (!desiredLocation.value && typeof next?.desiredLocation === 'string') desiredLocation.value = next.desiredLocation;
        }
      }
    });
  } catch (_) {}
});
</script>

<template>
  <div>
    <h2 class="subheading">Job Search</h2>

    <div class="action-card" style="margin-bottom: 0.9rem;">
      <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.35;">
        This page only ranks <b>pre-validated</b> job candidates. It never asks Gemini to invent job URLs.
        Paste a JSON array of validated candidates (each with a <code>directUrl</code>) and click Rank.
      </p>

      <div style="display:flex; gap:0.5rem; align-items:center; margin-bottom: 0.5rem;">
        <input
          v-model="desiredLocation"
          type="text"
          placeholder="Desired location (optional)"
          style="flex:1; padding: 10px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);"
        />
        <button class="action-btn export-btn" @click="rankValidatedCandidates" :disabled="loading" style="white-space:nowrap;">
          {{ loading ? 'Ranking…' : 'Rank' }}
        </button>
      </div>

      <textarea
        v-model="validatedCandidatesText"
        placeholder='Paste VALIDATED_CANDIDATES JSON array here (must include directUrl).'
        style="width:100%; min-height: 130px; padding: 10px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px;"
      />

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
            :disabled="!rec.directUrl"
            :title="rec.directUrl ? 'Open the direct application link' : 'No direct application link available'"
          >
            {{ rec.directUrl ? 'Open Apply Link' : 'No Apply Link' }}
          </button>

          <button
            class="action-btn"
            style="background: linear-gradient(135deg, #22c55e, #16a34a); color: white; flex:1; min-width: 140px;"
            @click="markApplied(rec)"
            :disabled="isRecApplied(rec) || !rec.directUrl"
            :title="isRecApplied(rec) ? 'Already marked applied' : 'Add to Applied Jobs'"
          >
            {{ isRecApplied(rec) ? 'Applied' : 'Mark Applied' }}
          </button>
        </div>

        <div v-if="rec.directUrl" style="margin-top: 0.75rem;">
          <div style="font-size: 0.85rem; margin-top: 0.2rem;">
            <a :href="rec.directUrl" target="_blank" style="color: var(--accent-color); text-decoration: none;">{{ rec.directUrlLabel || rec.directUrl }}</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
