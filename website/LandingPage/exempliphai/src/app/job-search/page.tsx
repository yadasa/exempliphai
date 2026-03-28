"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import {
  canonUrlKey,
  domainFromUrl,
  jobFieldsDocRef,
  markAppliedJob,
  markJobSearchResultApplied,
  upsertJobSearchRunAndResults,
  type JobFieldsDoc,
  type JobSearchResultDoc,
} from "@/lib/exempliphai/firestore";
import {
  filterDirectApplicationLinks,
  isDirectApplicationUrl,
  type JobLink,
} from "@/lib/exempliphai/jobLinks";

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
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  why_match?: string;
  directUrl: string;
  directUrlLabel?: string;
  links?: JobLink[];
  resultId?: string;
  dedupeKey?: string;
};

function extractFirstJsonObject(text: string): string | null {
  const s = String(text || "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
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
${desiredLocation || "(none)"}

Profile:
${JSON.stringify(profile || {}, null, 2)}

Resume details:
${JSON.stringify(resumeDetails || {}, null, 2)}
`;
}

function parseValidatedCandidates(text: string): ValidatedCandidate[] {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Validated candidates must be a JSON array.");

  const out: ValidatedCandidate[] = [];
  for (const item of parsed) {
    const title = String(item?.title || "").trim();
    const company = String(item?.company || "").trim();
    const location = String(item?.location || "").trim();
    const salary = String(item?.salary || "").trim();
    const directUrl = String(item?.directUrl || item?.url || "").trim();

    if (!title || !directUrl) continue;
    if (!isDirectApplicationUrl(directUrl)) continue;

    out.push({
      title,
      company,
      location,
      salary,
      directUrl,
      directUrlLabel: item?.directUrlLabel ? String(item.directUrlLabel) : "",
      sourceSystem: item?.sourceSystem ? String(item.sourceSystem) : "",
      confidenceScore: Number.isFinite(item?.confidenceScore)
        ? Number(item.confidenceScore)
        : undefined,
    });
  }

  // De-dupe by directUrl+title+company.
  const seen = new Set<string>();
  const deduped: ValidatedCandidate[] = [];
  for (const c of out) {
    const k = `${canonUrlKey(c.directUrl)}|${c.title.toLowerCase()}|${(c.company || "").toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(c);
  }

  return deduped;
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
  const [validatedCandidatesText, setValidatedCandidatesText] = useState("");

  const [apiKey, setApiKey] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [results, setResults] = useState<Array<{ id: string; data: JobSearchResultDoc }>>([]);

  const recs: JobRec[] = useMemo(() => {
    return results
      .map(({ id, data }) => {
        const directUrl = String((data as any)?.directUrl || "").trim();
        const links = directUrl
          ? filterDirectApplicationLinks([
              {
                label: String((data as any)?.directUrlLabel || "Apply"),
                url: directUrl,
              },
            ])
          : [];

        return {
          title: String((data as any)?.title || "").trim(),
          company: String((data as any)?.company || "").trim(),
          location: String((data as any)?.location || "").trim(),
          salary: String((data as any)?.salary || "").trim(),
          why_match: String((data as any)?.whyMatch || "").trim(),
          directUrl,
          directUrlLabel: String((data as any)?.directUrlLabel || "Apply"),
          links: links.slice(0, 4),
          resultId: String((data as any)?.resultId || id),
          dedupeKey: String((data as any)?.dedupeKey || ""),
        };
      })
      .filter((r) => r.title && r.directUrl);
  }, [results]);

  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const v = localStorage.getItem("exempliphai_gemini_api_key") || "";
      setApiKey(v);
      const cand = localStorage.getItem("exempliphai_validated_candidates") || "";
      setValidatedCandidatesText(cand);
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
    try {
      localStorage.setItem(
        "exempliphai_validated_candidates",
        validatedCandidatesText || "",
      );
    } catch {
      // ignore
    }
  }, [validatedCandidatesText]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const unsubPrimary = onSnapshot(jobFieldsDocRef(db, user.uid), (snap) => {
      if (!snap.exists()) return;
      setJobFields(snap.data() as any);
    });

    return () => {
      unsubPrimary();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    // Default visible results:
    // applied=false, hidden=false, validationStatus='validated', stale=false.
    const q = query(
      collection(db, "users", user.uid, "jobSearchResults"),
      where("applied", "==", false),
      where("hidden", "==", false),
      where("stale", "==", false),
      where("validationStatus", "==", "validated"),
      orderBy("updatedAt", "desc"),
      limit(50),
    );

    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, data: d.data() as any }));
      setResults(next);
    });

    return () => unsub();
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
    const k = canonUrlKey(String(rec.directUrl || ""));
    return k && appliedKeys.has(k);
  }

  async function markApplied(rec: JobRec) {
    if (!user) return;

    const links = Array.isArray(rec?.links) ? rec.links : [];
    const first = links.find(
      (l) => l && typeof l.url === "string" && isDirectApplicationUrl(l.url),
    );
    if (!first?.url)
      throw new Error("No direct application link for this recommendation.");

    const { db } = getFirebase();

    // Keep appliedJobs tracking (history)
    await markAppliedJob(db, user.uid, {
      url: first.url,
      company: rec.company || "Unknown",
      role: rec.title || "Unknown",
      title: rec.title || "",
    });

    // Also flip applied=true on the cached jobSearchResults doc so it disappears
    // from the default visible list.
    await markJobSearchResultApplied(db, user.uid, {
      resultId: rec.resultId,
      dedupeKey: rec.dedupeKey,
    });
  }

  async function rankAndPersist() {
    setErrorMsg("");
    setLoading(true);

    try {
      if (!user) throw new Error("Not signed in");
      if (!apiKey.trim())
        throw new Error("Missing Gemini API key (stored only in this browser).");

      const profile = (jobFields?.sync || {}) as Record<string, any>;
      const resumeDetails = (jobFields?.resumeDetails || {}) as any;

      const candidates = parseValidatedCandidates(validatedCandidatesText);
      if (!candidates.length) {
        throw new Error(
          "No validated candidates found. Paste a JSON array with directUrl fields (direct posting/apply links).",
        );
      }

      const promptText = buildGeminiRankingPrompt({
        profile,
        resumeDetails,
        desiredLocation,
        candidates,
      });

      const out = (await geminiGenerateJson({
        apiKey: apiKey.trim(),
        promptText,
      })) as any;

      const list = Array.isArray(out?.recommendations) ? out.recommendations : [];

      const urlAllow = new Set<string>(candidates.map((c) => String(c.directUrl)));

      const ranked: Array<
        Pick<
          JobSearchResultDoc,
          | "resultId"
          | "runId"
          | "dedupeKey"
          | "title"
          | "company"
          | "location"
          | "salary"
          | "whyMatch"
          | "directUrl"
          | "directUrlLabel"
          | "linkDomain"
          | "sourceSystem"
          | "confidenceScore"
        >
      > = [];

      for (const r of list) {
        const links = filterDirectApplicationLinks((r as any)?.links).slice(0, 4);
        const first = links[0];
        const url = String(first?.url || "").trim();
        if (!url) continue;
        if (!urlAllow.has(url)) continue; // strict membership check

        const title = String((r as any)?.title || "").trim();
        if (!title) continue;

        const cand = candidates.find((c) => String(c.directUrl) === url) || null;

        ranked.push({
          // ids filled in helper
          resultId: "",
          runId: "",
          dedupeKey: "",
          title,
          company: String((r as any)?.company || cand?.company || "").trim(),
          location: String((r as any)?.location || cand?.location || "").trim(),
          salary: String((r as any)?.salary || cand?.salary || "").trim(),
          whyMatch: String((r as any)?.why_match || "").trim(),
          directUrl: url,
          directUrlLabel: String(first?.label || cand?.directUrlLabel || "Apply").trim(),
          linkDomain: domainFromUrl(url),
          sourceSystem: String(cand?.sourceSystem || "openclaw"),
          confidenceScore: Number.isFinite(cand?.confidenceScore)
            ? Number(cand?.confidenceScore)
            : null,
        });

        if (ranked.length >= 15) break;
      }

      const { db } = getFirebase();
      const runId = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `run_${Date.now()}`;

      await upsertJobSearchRunAndResults(db, user.uid, {
        run: {
          runId,
          desiredLocation: String(desiredLocation || ""),
          modelName: "gemini-3-flash-preview",
          temperature: 0.3,
          totalCandidatesSeen: candidates.length,
          totalValidated: ranked.length,
          totalRejected: Math.max(0, candidates.length - ranked.length),
          totalStored: ranked.length,
        },
        results: ranked.map((r) => ({
          ...r,
          runId,
          // dedupeKey/resultId are computed by helper if blank
        })),
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
            <Link className="text-sm text-primary underline" href={("/profile" as any)}>
              Profile
            </Link>
            <Link className="text-sm text-primary underline" href={("/dashboard" as any)}>
              Dashboard
            </Link>
          </div>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Source of truth: <span className="font-mono">users/{user?.uid}/jobSearchResults</span>
          . This page never asks the model to invent job URLs.
        </p>

        <div className="mt-6 grid gap-4">
          <div className="rounded-xl border bg-card p-4">
            <p className="m-0 text-sm text-muted-foreground">
              Paste a JSON array of <b>validated candidates</b> (each with a direct posting/apply URL), then rank and persist.
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
                onClick={() => void rankAndPersist()}
                disabled={loading}
              >
                {loading ? "Ranking…" : "Rank + Save"}
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

              <label className="grid gap-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  VALIDATED_CANDIDATES (JSON array)
                </span>
                <textarea
                  className="min-h-[140px] w-full rounded-md border bg-background p-3 font-mono text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  value={validatedCandidatesText}
                  onChange={(e) => setValidatedCandidatesText(e.target.value)}
                  placeholder='[{"title":"...","company":"...","directUrl":"https://..."}]'
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
            <div className="text-sm font-semibold">Active recommendations</div>

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
