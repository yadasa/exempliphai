"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import {
  canonUrlKey,
  createJobSearch,
  extensionStateDocRef,
  jobFieldsDocRef,
  markAppliedJob,
  normalizeExtensionStateToJobFields,
  type JobFieldsDoc,
} from "@/lib/exempliphai/firestore";
import {
  filterDirectApplicationLinks,
  isDirectApplicationUrl,
  type JobLink,
} from "@/lib/exempliphai/jobLinks";

type JobRec = {
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  why_match?: string;
  links?: JobLink[];
};

function extractFirstJsonObject(text: string): string | null {
  const s = String(text || "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
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
  desiredLocation = "",
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

Desired location: ${desiredLocation || "(none)"}

Profile:
${JSON.stringify(profile || {}, null, 2)}

Resume details:
${JSON.stringify(resumeDetails || {}, null, 2)}
`;
}

async function geminiGenerateJson({
  apiKey,
  promptText,
}: {
  apiKey: string;
  promptText: string;
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(
    apiKey,
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.error) {
    const msg = (json as any)?.error?.message || `Gemini HTTP ${res.status}`;
    throw new Error(msg);
  }

  const text = (json as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response missing text");

  const jsonText = extractFirstJsonObject(text) || text;
  return JSON.parse(jsonText);
}

export default function JobSearchPage() {
  return (
    <RequireAuth>
      <JobSearchInner />
    </RequireAuth>
  );
}

function JobSearchInner() {
  const { user } = useAuth();

  const [jobFields, setJobFields] = useState<JobFieldsDoc | null>(null);

  const [desiredLocation, setDesiredLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [searchDocs, setSearchDocs] = useState<Array<{ id: string; data: any }>>([]);
  const [activeId, setActiveId] = useState<string>("");

  const active = useMemo(() => {
    const found = searchDocs.find((d) => d.id === activeId);
    return found || searchDocs[0] || null;
  }, [searchDocs, activeId]);

  const recs: JobRec[] = useMemo(() => {
    const data = active?.data || {};
    const arr = Array.isArray(data.generatedJobs) ? data.generatedJobs : [];
    return arr
      .filter((r: any) => r && typeof r.title === "string" && r.title.trim())
      .slice(0, 15)
      .map((r: any) => ({
        title: String(r.title).trim(),
        company: r.company ? String(r.company).trim() : "",
        location: r.location ? String(r.location).trim() : "",
        salary: r.salary ? String(r.salary).trim() : "",
        why_match: r.why_match ? String(r.why_match).trim() : "",
        links: filterDirectApplicationLinks(r.links).slice(0, 4),
      }));
  }, [active]);

  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());

  const [apiKey, setApiKey] = useState<string>("");

  useEffect(() => {
    try {
      const v = localStorage.getItem("exempliphai_gemini_api_key") || "";
      setApiKey(v);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("exempliphai_gemini_api_key", apiKey || "");
    } catch {
      // ignore
    }
  }, [apiKey]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    let primaryExists = false;

    const unsubPrimary = onSnapshot(jobFieldsDocRef(db, user.uid), (snap) => {
      primaryExists = snap.exists();
      if (!snap.exists()) return;
      setJobFields(snap.data() as any);
    });

    const unsubExt = onSnapshot(extensionStateDocRef(db, user.uid), (snap) => {
      if (primaryExists) return;
      if (!snap.exists()) return;
      setJobFields(normalizeExtensionStateToJobFields(snap.data() as any));
    });

    return () => {
      unsubPrimary();
      unsubExt();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const q = query(
      collection(db, "users", user.uid, "jobSearches"),
      orderBy("timestamp", "desc"),
      limit(25),
    );

    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, data: d.data() as any }));
      setSearchDocs(next);
      if (!activeId && next[0]?.id) setActiveId(next[0].id);

      const loc = next[0]?.data?.searchOptions?.desiredLocation;
      if (!desiredLocation && typeof loc === "string") setDesiredLocation(loc);
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const q = query(
      collection(db, "users", user.uid, "appliedJobs"),
      orderBy("timestamp", "desc"),
      limit(500),
    );

    const unsub = onSnapshot(q, (snap) => {
      const next = new Set<string>();
      for (const d of snap.docs) {
        const data = d.data() as any;
        const url = String(data?.url || "");
        const k = canonUrlKey(url);
        if (k) next.add(k);
      }
      setAppliedKeys(next);
    });

    return () => unsub();
  }, [user?.uid]);

  function isRecApplied(rec: JobRec) {
    const links = Array.isArray(rec?.links) ? rec.links : [];
    return links.some((l) => {
      const k = canonUrlKey(String(l?.url || ""));
      return k && appliedKeys.has(k);
    });
  }

  async function markApplied(rec: JobRec) {
    if (!user) return;

    const links = Array.isArray(rec?.links) ? rec.links : [];
    const first = links.find((l) => l && typeof l.url === "string" && isDirectApplicationUrl(l.url));
    if (!first?.url) throw new Error("No direct application link for this recommendation.");

    const { db } = getFirebase();
    await markAppliedJob(db, user.uid, {
      url: first.url,
      company: rec.company || "Unknown",
      role: rec.title || "Unknown",
      title: rec.title || "",
    });
  }

  async function generateRecommendations() {
    setErrorMsg("");
    setLoading(true);

    try {
      if (!user) throw new Error("Not signed in");
      if (!apiKey.trim()) throw new Error("Missing Gemini API key (saved only in this browser). ");

      const profile = (jobFields?.sync || {}) as Record<string, any>;
      const resumeDetails = (jobFields?.resumeDetails || {}) as any;

      const promptText = `${buildJobRecsSystemPrompt()}\n\n---\n\n${buildJobRecsUserPrompt({
        profile,
        resumeDetails,
        desiredLocation,
      })}`;

      const out = (await geminiGenerateJson({ apiKey: apiKey.trim(), promptText })) as any;
      const list = Array.isArray(out?.recommendations) ? out.recommendations : [];

      const filtered: JobRec[] = list
        .filter((r: any) => r && typeof r.title === "string" && r.title.trim())
        .slice(0, 15)
        .map((r: any) => ({
          title: String(r.title).trim(),
          company: r.company ? String(r.company).trim() : "",
          location: r.location ? String(r.location).trim() : "",
          salary: r.salary ? String(r.salary).trim() : "",
          why_match: r.why_match ? String(r.why_match).trim() : "",
          links: filterDirectApplicationLinks(r.links).slice(0, 4),
        }));

      const { db } = getFirebase();
      await createJobSearch(db, user.uid, {
        searchOptions: { desiredLocation: String(desiredLocation || "") },
        generatedJobs: filtered as any,
        version: String(out?.version || "0.1"),
        generated_at: String(out?.generated_at || new Date().toISOString()),
      });
    } catch (e: any) {
      setErrorMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container py-14 md:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-70"
        style={{
          background:
            "radial-gradient(900px 520px at 20% 10%, color-mix(in oklab, var(--color-primary) 24%, transparent), transparent 62%), radial-gradient(900px 520px at 80% 15%, color-mix(in oklab, var(--brand-violet) 22%, transparent), transparent 58%)",
        }}
      />

      <div className="mx-auto max-w-5xl rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Job Search</h1>
          <div className="flex gap-3">
            <Link className="text-sm text-primary underline" href={"/profile" as any}>
              Profile
            </Link>
            <Link className="text-sm text-primary underline" href={"/dashboard" as any}>
              Dashboard
            </Link>
          </div>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Loads/saves from <span className="font-mono">users/{user?.uid}/jobSearches</span>.
        </p>

        <div className="mt-6 grid gap-4">
          <div className="rounded-xl border bg-card p-4">
            <p className="m-0 text-sm text-muted-foreground">
              Generate 10–15 job recommendations based on your saved resume details.
            </p>

            <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
              <input
                className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                value={desiredLocation}
                onChange={(e) => setDesiredLocation(e.target.value)}
                placeholder="Desired location (optional)"
              />
              <button
                type="button"
                className="bg-gradient-primary h-11 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                onClick={() => void generateRecommendations()}
                disabled={loading}
              >
                {loading ? "Generating…" : "Generate"}
              </button>
            </div>

            <div className="mt-3 grid gap-2">
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  Gemini API key (stored only in this browser)
                </span>
                <input
                  className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza…"
                />
              </label>

              {errorMsg ? (
                <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
                  {errorMsg}
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">History</div>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none"
                value={active?.id || ""}
                onChange={(e) => setActiveId(e.target.value)}
              >
                {searchDocs.length ? (
                  searchDocs.map((d) => {
                    const ts = (d.data as any)?.timestamp?.toDate?.()?.toISOString?.() || null;
                    const genAt = String((d.data as any)?.generated_at || "");
                    const label = ts
                      ? new Date(ts).toLocaleString()
                      : genAt
                        ? new Date(genAt).toLocaleString()
                        : d.id;
                    return (
                      <option key={d.id} value={d.id}>
                        {label}
                      </option>
                    );
                  })
                ) : (
                  <option value="">No searches yet</option>
                )}
              </select>
            </div>

            {recs.length === 0 ? (
              <div className="mt-3 text-sm text-muted-foreground">No recommendations yet.</div>
            ) : (
              <div className="mt-4 grid gap-3">
                {recs.map((rec, idx) => {
                  const applied = isRecApplied(rec);
                  const firstDirect = (rec.links || []).find((l) => isDirectApplicationUrl(l.url));

                  return (
                    <div key={idx} className="rounded-xl border bg-background/40 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold">{rec.title}</div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {rec.company ? <b>{rec.company}</b> : null}
                            {rec.location ? <span> · {rec.location}</span> : null}
                            {rec.salary ? <span> · {rec.salary}</span> : null}
                          </div>
                        </div>

                        {applied ? (
                          <span className="rounded-full border border-emerald-500/50 bg-emerald-500/5 px-3 py-1 text-xs font-semibold text-emerald-600">
                            Applied
                          </span>
                        ) : null}
                      </div>

                      {rec.why_match ? (
                        <div className="mt-3 text-sm">{rec.why_match}</div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <a
                          className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                          href={firstDirect?.url || ""}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!firstDirect?.url}
                          onClick={(e) => {
                            if (!firstDirect?.url) e.preventDefault();
                          }}
                        >
                          {firstDirect?.url ? "Open Apply Link" : "No Apply Link"}
                        </a>

                        <button
                          type="button"
                          className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                          onClick={() =>
                            void markApplied(rec).catch((e: any) =>
                              setErrorMsg(String(e?.message || e)),
                            )
                          }
                          disabled={applied || !firstDirect?.url}
                        >
                          {applied ? "Applied" : "Mark Applied"}
                        </button>
                      </div>

                      {rec.links?.length ? (
                        <div className="mt-4 grid gap-1">
                          {rec.links.map((l, li) => (
                            <a
                              key={li}
                              className="text-sm text-primary underline"
                              href={l.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {l.label || l.url}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
