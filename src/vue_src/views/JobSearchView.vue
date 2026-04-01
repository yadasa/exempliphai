<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PlusOnlyBadge from '@/components/PlusOnlyBadge.vue';
import { filterDirectApplicationLinks, isDirectApplicationUrl } from '@/utils/jobLinks.js';
import { pullProfileFromCloudNow } from '@/sw/firebaseSync';

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

type JobSearchLast = {
  version?: string;
  generated_at?: string;
  desiredLocation?: string;
  recommendations?: JobRec[];
  searchPage?: number;
  postedWithin?: 'any' | '7d' | '3d' | '1d';
  searchOptions?: any;
  serp?: any;
};

type JobSearchState = {
  desiredLocationDraft?: string;
  scrollTop?: number;
};

const JOB_SEARCH_LAST_KEY = 'jobSearchLast';
const JOB_SEARCH_STATE_KEY = 'jobSearchState';

const desiredLocation = ref('');
const postedWithin = ref<'any' | '7d' | '3d' | '1d'>('any');
const loading = ref(false);
const errorMsg = ref('');
const recs = ref<JobRec[]>([]);

// Pagination for SerpAPI Google Jobs (start offset)
const searchPage = ref(0);

const appliedKeys = ref<Set<string>>(new Set());

const hasRecs = computed(() => Array.isArray(recs.value) && recs.value.length > 0);

function storageGetLocal<T = any>(keys: string[]): Promise<T> {
  return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve((r || {}) as T)));
}

function storageSetLocal(obj: any): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
}

function storageRemoveLocal(keys: string[]): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.remove(keys, () => resolve()));
}

function extractFirstJsonObject(text: string): string | null {
  const s = String(text || '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

function buildJobRecsSystemPrompt(): string {
  return `You are a job recommendation engine.\nReturn ONLY valid JSON.\nDo not include any prose outside JSON.`;
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
  return `Create ${countMin}-${countMax} job recommendations for this candidate.\n\nReturn ONLY valid JSON with this exact structure:\n{\n  \"version\": \"0.1\",\n  \"generated_at\": \"${new Date().toISOString()}\",\n  \"recommendations\": [\n    {\n      \"title\": \"\",\n      \"company\": \"\",\n      \"location\": \"\",\n      \"salary\": \"\",\n      \"why_match\": \"\",\n      \"links\": [{\"label\": \"\", \"url\": \"https://...\"}]\n    }\n  ]\n}\n\nRules:\n- Include 10-15 recommendations; mostly strong matches plus a few stretch upgrades.\n- Keep why_match 1-2 sentences.\n- If you don't know salary, return an empty string.\n- Links MUST be actual job posting/apply URLs (no search pages).\n  - Prefer: LinkedIn job posting URLs (https://www.linkedin.com/jobs/view/...), or company ATS postings (Greenhouse/Lever/Workday/Ashby/SmartRecruiters/Workable/iCIMS), or a company careers/job posting page.\n  - NOT allowed: Google/Bing/DuckDuckGo search URLs.\n- Provide 1–3 links per recommendation whenever possible.\n  - If you cannot find a perfect direct apply link, include the company careers page as a fallback (still not a search engine).\n\nDesired location: ${desiredLocation || '(none)'}\n\nProfile:\n${JSON.stringify(profile || {}, null, 2)}\n\nResume details:\n${JSON.stringify(resumeDetails || {}, null, 2)}\n`;
}

async function aiProxyGenerateJson({ promptText }: { promptText: string }) {
  const input = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 1.0,
      responseMimeType: 'application/json',
    },
  };

  const resp = await new Promise<any>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'AI_PROXY',
        aiAction: 'jobRecs',
        model: 'gemini-3-pro-preview',
        input,
      },
      (r) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(String(err.message || err)));
        resolve(r);
      }
    );
  });

  if (!resp || resp.ok === false) {
    const msg = String(resp?.error || 'AI proxy failed');
    // Surface low balance nicely
    if (msg === 'low_balance' || msg === 'insufficient_balance') {
      throw new Error(`Insufficient ExempliPhai token balance. Please top up to continue.`);
    }
    throw new Error(msg);
  }

  const text = resp?.result?.text;
  if (!text) throw new Error('AI proxy response missing text');

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

  const cur = await storageGetLocal<any>(['AppliedJobs']);
  const arr = Array.isArray(cur.AppliedJobs) ? cur.AppliedJobs : [];
  const next = [item, ...arr].filter((j, idx, self) => idx === self.findIndex((x: any) => String(x?.url || '') === item.url));
  await storageSetLocal({ AppliedJobs: next });

  appliedKeys.value.add(canonUrlKey(item.url));
}

function openTailorApply(rec: JobRec) {
  const first = (Array.isArray(rec?.links) ? rec.links : []).find(
    (l) => l && typeof (l as any)?.url === 'string' && isDirectApplicationUrl((l as any).url)
  );
  if (first?.url) {
    openUrl(first.url);
    return;
  }

  // No fallbacks to Google/search engines — direct links only.
  alert('No direct application link is available for this recommendation.');
}

function toPlainRecs(list: JobRec[]): JobRec[] {
  return (Array.isArray(list) ? list : []).slice(0, 15).map((r) => ({
    title: String((r as any)?.title || '').trim(),
    company: String((r as any)?.company || '').trim(),
    location: String((r as any)?.location || '').trim(),
    salary: String((r as any)?.salary || '').trim(),
    why_match: String((r as any)?.why_match || '').trim(),
    links: (Array.isArray((r as any)?.links) ? (r as any).links : []).map((l: any) => ({
      label: String(l?.label || '').trim(),
      url: String(l?.url || '').trim(),
    })),
  }));
}

let persistTimer: number | null = null;
function getScrollContainer(): HTMLElement | null {
  return (document.querySelector('.content-area') as HTMLElement | null) || (document.scrollingElement as any) || null;
}

async function persistStateNow() {
  try {
    const el = getScrollContainer();
    const scrollTop = el ? el.scrollTop : 0;
    const st: JobSearchState = {
      desiredLocationDraft: String(desiredLocation.value || ''),
      scrollTop: Number.isFinite(scrollTop) ? scrollTop : 0,
    };
    await storageSetLocal({ [JOB_SEARCH_STATE_KEY]: st });
  } catch (_) {}
}

function schedulePersistState() {
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistStateNow().catch(() => {});
  }, 250);
}

function resetJobSearch() {
  errorMsg.value = '';
  loading.value = false;
  desiredLocation.value = '';
  recs.value = [];

  storageRemoveLocal([JOB_SEARCH_LAST_KEY, JOB_SEARCH_STATE_KEY]).catch(() => {});

  // Also reset scroll position.
  try {
    const el = getScrollContainer();
    if (el) el.scrollTop = 0;
  } catch (_) {}
}

function recKey(r: any): string {
  const t = String(r?.title || '').trim().toLowerCase();
  const c = String(r?.company || '').trim().toLowerCase();
  const u = String(r?.links?.[0]?.url || '').trim().toLowerCase();
  return [t, c, u].filter(Boolean).join('||');
}

function mergeRecs(...lists: any[][]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const r of list || []) {
      const k = recKey(r) || JSON.stringify([r?.title, r?.company, r?.location]);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }

  return out;
}

function removeRecAt(index: number) {
  const arr = Array.isArray(recs.value) ? [...recs.value] : [];
  if (index < 0 || index >= arr.length) return;
  arr.splice(index, 1);
  recs.value = arr;
  schedulePersistState();
}

async function generateRecommendations() {
  errorMsg.value = '';
  loading.value = true;

  try {
    // SerpAPI (Google Jobs) proxy: no client-side API key.

    const resumeDetails = await new Promise<any>((resolve) => {
      chrome.storage.local.get(['Resume_details'], (res) => resolve((res as any)?.Resume_details || {}));
    });

    const profile = await new Promise<any>((resolve) => {
      chrome.storage.sync.get(null, (res) => resolve(res || {}));
    });

    const pick = (...vals: any[]) => vals.map((v) => String(v || '').trim()).find((v) => v) || '';

    const q = pick(
      profile?.desiredJobTitle,
      profile?.jobTitle,
      profile?.Title,
      resumeDetails?.targetRole,
      resumeDetails?.headline,
      resumeDetails?.summary,
      'software engineer',
    );

    const payload = {
      q,
      location: String(desiredLocation.value || '').trim(),
      limit: 20,
      start: searchPage.value * 10,
      no_cache: true,
      lrad: postedWithin.value === 'any' ? 0 : postedWithin.value === '7d' ? 7 : postedWithin.value === '3d' ? 3 : 1,
    };

    const proxyResp = await new Promise<any>((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'SEARCH_PROXY',
          searchAction: 'jobs',
          payload,
        },
        (r) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(String(err.message || err)));
          resolve(r);
        },
      );
    });

    if (!proxyResp || proxyResp.ok === false) {
      const msg = String(proxyResp?.error || 'Search proxy failed');
      if (msg === 'low_balance' || msg === 'insufficient_balance') {
        throw new Error('Insufficient ExempliPhai token balance. Please top up to continue.');
      }
      throw new Error(msg);
    }

    const results = Array.isArray(proxyResp?.results) ? proxyResp.results : [];
    // Advance page so subsequent searches pull a different page of results.
    searchPage.value = searchPage.value + 1;

    const cleaned = toPlainRecs(
      results
        .filter((r: any) => r && String(r.title || '').trim())
        .slice(0, 20)
        .map((r: any) => {
          const apply = Array.isArray(r.apply_options) ? r.apply_options : [];
          const links = apply
            .map((a: any) => ({ label: String(a?.title || '').trim() || 'Apply', url: String(a?.link || '').trim() }))
            .filter((l: any) => l.url);

          // Keep direct-ish links only; if Serp returns a redirector, this may be empty.
          const directLinks = filterDirectApplicationLinks(links).slice(0, 4);

          return {
            title: String(r.title || '').trim(),
            company: String(r.company || '').trim(),
            location: String(r.location || '').trim(),
            salary: '',
            why_match: String(r.description || '').trim().slice(0, 240),
            links: directLinks,
          };
        }),
    );

    // New results should appear at the top.
    recs.value = mergeRecs(cleaned, recs.value);

    await storageSetLocal({
      [JOB_SEARCH_LAST_KEY]: {
        version: 'serpapi_google_jobs_v0.2',
        generated_at: new Date().toISOString(),
        desiredLocation: String(desiredLocation.value || ''),
        // IMPORTANT: Vue makes arrays/objects reactive proxies; convert to plain objects for storage + Firestore.
        recommendations: toPlainRecs(recs.value),
        searchPage: searchPage.value,
        postedWithin: postedWithin.value,
        searchOptions: {
          q,
          location: String(desiredLocation.value || '').trim(),
          postedWithin: postedWithin.value,
        },
        serp: {
          provider: proxyResp?.provider || null,
          query: proxyResp?.query || payload,
          results: results,
        },
      } satisfies JobSearchLast,
    });

    schedulePersistState();
  } catch (e: any) {
    errorMsg.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

function applyAppliedJobsToSet(jobs: any[]) {
  const next = new Set<string>();
  for (const j of jobs || []) {
    const u = canonUrlKey(String((j as any)?.url || ''));
    if (u) next.add(u);
  }
  appliedKeys.value = next;
}

function applyJobSearchLast(last: any) {
  const prev = last?.recommendations;
  const prevLoc = last?.desiredLocation;
  const prevPage = last?.searchPage;
  const prevPosted = last?.postedWithin;

  if (!desiredLocation.value && typeof prevLoc === 'string') desiredLocation.value = prevLoc;
  if (Number.isFinite(prevPage)) searchPage.value = Number(prevPage || 0);
  if (prevPosted && typeof prevPosted === 'string') postedWithin.value = prevPosted as any;
  if (Array.isArray(prev) && prev.length) recs.value = toPlainRecs(prev);
}

function onStorageChanged(changes: any, areaName: string) {
  if (areaName !== 'local') return;

  if (changes?.AppliedJobs) {
    const jobs = Array.isArray(changes.AppliedJobs.newValue) ? changes.AppliedJobs.newValue : [];
    applyAppliedJobsToSet(jobs);
    return;
  }

  if (changes?.[JOB_SEARCH_LAST_KEY]) {
    try {
      const next = changes?.[JOB_SEARCH_LAST_KEY]?.newValue;
      if (next && typeof next === 'object' && !loading.value) {
        // If a cloud pull updates jobSearchLast while this tab is open, adopt it.
        applyJobSearchLast(next);
      }
    } catch (_) {}
  }
}

// Load cached recs quickly on view init + restore scroll/location draft.
onMounted(() => {
  (async () => {
    try {
      const res = await storageGetLocal<any>([JOB_SEARCH_LAST_KEY, JOB_SEARCH_STATE_KEY, 'AppliedJobs']);

      const last: JobSearchLast | null = res?.[JOB_SEARCH_LAST_KEY] || null;
      const st: JobSearchState | null = res?.[JOB_SEARCH_STATE_KEY] || null;

      if (!desiredLocation.value && typeof st?.desiredLocationDraft === 'string') desiredLocation.value = st.desiredLocationDraft;
      if (last && typeof last === 'object') applyJobSearchLast(last);

      const jobs = Array.isArray(res?.AppliedJobs) ? res.AppliedJobs : [];
      applyAppliedJobsToSet(jobs);

      await nextTick();

      // Restore scroll.
      try {
        const el = getScrollContainer();
        if (el && st && Number.isFinite(st.scrollTop)) {
          requestAnimationFrame(() => {
            try {
              el.scrollTop = Number(st.scrollTop || 0);
            } catch (_) {}
          });
        }

        if (el) {
          el.addEventListener('scroll', schedulePersistState, { passive: true } as any);
        }
      } catch (_) {}

      try {
        chrome.storage.onChanged.addListener(onStorageChanged);
      } catch (_) {}

      // If cloud sync is enabled, pull in the newest snapshot (including the last job search).
      pullProfileFromCloudNow('lite').catch(() => {});
    } catch (_) {}
  })().catch(() => {});
});

onBeforeUnmount(() => {
  try {
    const el = getScrollContainer();
    if (el) el.removeEventListener('scroll', schedulePersistState as any);
  } catch (_) {}

  try {
    chrome.storage.onChanged.removeListener(onStorageChanged);
  } catch (_) {}

  persistStateNow().catch(() => {});
});

watch(
  () => desiredLocation.value,
  () => {
    schedulePersistState();
  }
);
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:flex-start; gap:0.6rem;">
      <h2 class="subheading" style="margin: 0;">Job Search</h2>
      <PlusOnlyBadge />
    </div>

    <div class="action-card" style="margin-bottom: 0.9rem;">
      <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.35;">
        Generate 10–15 job recommendations based on your saved resume details.
      </p>

      <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap: wrap;">
        <input
          v-model="desiredLocation"
          type="text"
          placeholder="Desired location (optional)"
          style="flex:1; min-width: 220px; padding: 10px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);"
        />

        <select
          v-model="postedWithin"
          style="padding: 10px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);"
          :disabled="loading"
          title="Filter by recency"
        >
          <option value="any">Any time</option>
          <option value="7d">Last 7 days</option>
          <option value="3d">Last 3 days</option>
          <option value="1d">Last 24 hours</option>
        </select>

        <button
          class="action-btn"
          @click="resetJobSearch"
          :disabled="loading"
          style="white-space:nowrap; width:auto; background: var(--card-bg); color: var(--text-primary); border: 1px solid var(--card-border); padding: 0.7rem 0.9rem;"
          :title="'Clear cached recommendations + view state'"
        >
          Reset
        </button>

        <button
          class="action-btn export-btn"
          @click="generateRecommendations"
          :disabled="loading"
          style="white-space:nowrap; width: 100%; flex: 1 1 100%;"
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
      <div v-for="(rec, idx) in recs" :key="idx" class="action-card" style="position: relative;">
        <button
          class="action-btn"
          @click="removeRecAt(idx)"
          title="Remove"
          style="position:absolute; top: 10px; right: 10px; width: 28px; height: 28px; min-width: 28px; padding: 0; border-radius: 999px; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: var(--text-secondary);"
        >
          ×
        </button>
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
            style="background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; flex:1; min-width: 140px; width:auto;"
            @click="openTailorApply(rec)"
            :disabled="!(rec.links && rec.links.length)"
            :title="(rec.links && rec.links.length) ? 'Open the direct application link' : 'No direct application link available'"
          >
            {{ (rec.links && rec.links.length) ? 'Open Apply Link' : 'No Apply Link' }}
          </button>

          <button
            class="action-btn"
            style="background: linear-gradient(135deg, #22c55e, #16a34a); color: white; flex:1; min-width: 140px; width:auto;"
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
