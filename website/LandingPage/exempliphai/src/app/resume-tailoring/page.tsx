"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import {
  getDownloadURL,
  getMetadata,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import {
  extensionStateDocRef,
  jobFieldsDocRef,
  normalizeExtensionStateToJobFields,
  patchJobFields,
  type JobFieldsDoc,
  type UploadMeta,
} from "@/lib/exempliphai/firestore";
import { buildTailorResumePrompt } from "@/lib/exempliphai/tailorPrompt";
import { downloadBlob, simplePdfFromText } from "@/lib/exempliphai/simplePdf";

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function u8ToArrayBuffer(u8: Uint8Array): ArrayBuffer {
  // TS lib.dom types sometimes model slice() as ArrayBuffer | SharedArrayBuffer.
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function extractFirstJsonObject(text: string): string | null {
  const s = String(text || "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

async function geminiTailor({
  apiKey,
  prompt,
  resumePdfBase64,
}: {
  apiKey: string;
  prompt: string;
  resumePdfBase64: string;
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(
    apiKey,
  )}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                data: resumePdfBase64,
                mime_type: "application/pdf",
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.25,
        responseMimeType: "application/json",
      },
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || (json as any)?.error) {
    const msg = (json as any)?.error?.message || `Gemini HTTP ${resp.status}`;
    throw new Error(msg);
  }

  const outText = (json as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!outText) throw new Error("Gemini response missing text");

  const s = String(outText);
  const jsonText = extractFirstJsonObject(s) || s;
  return JSON.parse(jsonText);
}

export default function ResumeTailoringPage() {
  return (
    <RequireAuth>
      <Inner />
    </RequireAuth>
  );
}

function Inner() {
  const { user } = useAuth();

  const [jobFields, setJobFields] = useState<JobFieldsDoc | null>(null);

  const [apiKey, setApiKey] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  const [busy, setBusy] = useState<null | "tailor" | "save" | "upload">(null);
  const [err, setErr] = useState<string>("");
  const [msg, setMsg] = useState<string>("");

  const [tailoredText, setTailoredText] = useState<string>("");
  const [tailoredMeta, setTailoredMeta] = useState<any>(null);

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

    const apply = (data: JobFieldsDoc | null) => {
      setJobFields(data);

      const t = String(data?.tailoredResume?.text || "");
      const m = data?.tailoredResume?.meta || null;
      setTailoredText((prev: string) => (prev ? prev : t));
      setTailoredMeta((prev: any) => (prev ? prev : m));
    };

    const unsubPrimary = onSnapshot(jobFieldsDocRef(db, user.uid), (snap) => {
      primaryExists = snap.exists();
      if (!snap.exists()) return;
      apply(snap.data() as any);
    });

    const unsubExt = onSnapshot(extensionStateDocRef(db, user.uid), (snap) => {
      if (primaryExists) return;
      if (!snap.exists()) return;
      apply(normalizeExtensionStateToJobFields(snap.data() as any));
    });

    return () => {
      unsubPrimary();
      unsubExt();
    };
  }, [user?.uid]);

  const resumeUrl = jobFields?.uploads?.resume?.downloadUrl || "";
  const tailoredUploadUrl = jobFields?.uploads?.tailoredResume?.downloadUrl || "";

  const metaText = useMemo(() => {
    const m = tailoredMeta || jobFields?.tailoredResume?.meta;
    if (!m) return "";
    const jt = String(m?.jobTitle || m?.job_title || "").trim();
    const co = String(m?.company || "").trim();
    const at = String(m?.createdAt || m?.updatedAt || "").trim();
    const url = String(m?.pageUrl || m?.page_url || "").trim();
    const title = [jt, co].filter(Boolean).join(" @ ");
    const bits = [title || url || "Unknown job", at ? `Saved ${at}` : "Saved"];
    return bits.filter(Boolean).join(" · ");
  }, [tailoredMeta, jobFields?.tailoredResume?.meta]);

  async function uploadTailoredPdf(text: string) {
    if (!user) throw new Error("Not signed in");
    const { storage, db } = getFirebase();

    const bytes = simplePdfFromText(text);
    const blob = new Blob([u8ToArrayBuffer(bytes)], { type: "application/pdf" });

    const safeName = `resume-tailored.pdf`;
    const path = `data/uploads/${user.uid}/tailoredResume/${Date.now()}_${safeName}`;
    const r = storageRef(storage, path);

    await uploadBytes(r, blob, { contentType: "application/pdf" });
    const [url, meta] = await Promise.all([getDownloadURL(r), getMetadata(r)]);

    const uploadMeta: UploadMeta = {
      bucket: meta.bucket,
      path: meta.fullPath,
      contentType: meta.contentType || "application/pdf",
      size: Number(meta.size || 0),
      updated: String(meta.updated || new Date().toISOString()),
      downloadUrl: url,
      name: safeName,
      kind: "tailoredResume",
      storedAt: new Date().toISOString(),
    };

    await patchJobFields(db, user.uid, {
      uploads: { tailoredResume: uploadMeta },
    });

    return uploadMeta;
  }

  async function tailorNow() {
    setErr("");
    setMsg("");
    setBusy("tailor");

    try {
      if (!user) throw new Error("Not signed in");
      if (!apiKey.trim()) throw new Error("Missing Gemini API key (saved only in this browser). ");
      if (!resumeUrl) throw new Error("No resume found in Storage yet. Upload one on the Profile → Experience tab.");

      const res = await fetch(resumeUrl);
      if (!res.ok) throw new Error(`Failed to fetch resume PDF (${res.status})`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 7_500_000) throw new Error("Resume PDF too large for inline upload.");
      const resumeB64 = arrayBufferToBase64(buf);

      const prompt = buildTailorResumePrompt({
        jobTitle,
        company,
        pageUrl,
        jobDescription,
      });

      const out = await geminiTailor({
        apiKey: apiKey.trim(),
        prompt,
        resumePdfBase64: resumeB64,
      });

      const t = String(out?.tailored_resume_text || "").trim();
      if (!t) throw new Error("No tailored_resume_text returned.");

      let pageKey = pageUrl;
      try {
        const u = new URL(pageUrl);
        pageKey = `${u.origin}${u.pathname}`;
      } catch {
        // ignore
      }

      const meta = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pageUrl,
        pageKey,
        jobTitle: String(out?.job_title || jobTitle || ""),
        company: String(out?.company || company || ""),
      };

      setTailoredText(t);
      setTailoredMeta(meta);
      setMsg("Tailored. Review and click Save.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function saveTailored() {
    setErr("");
    setMsg("");
    setBusy("save");

    try {
      if (!user) throw new Error("Not signed in");
      if (!tailoredText.trim()) throw new Error("Nothing to save yet.");

      const { db } = getFirebase();

      await patchJobFields(db, user.uid, {
        tailoredResume: {
          text: tailoredText,
          meta: tailoredMeta || null,
          name: "resume-tailored.pdf",
        },
      });

      // Also upload a PDF copy for easy download.
      setBusy("upload");
      await uploadTailoredPdf(tailoredText);

      setMsg("Saved to Firestore + Storage.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(null);
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
          <h1 className="text-2xl font-semibold tracking-tight">Resume Tailoring</h1>
          <div className="flex gap-3">
            <Link className="text-sm text-primary underline" href={"/profile" as any}>
              Profile
            </Link>
            <Link className="text-sm text-primary underline" href={"/job-search" as any}>
              Job Search
            </Link>
          </div>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Uses your uploaded resume from Storage and saves results to{" "}
          <span className="font-mono">users/{user?.uid}/jobFields/current</span>.
        </p>

        {err ? (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
            {err}
          </div>
        ) : null}
        {msg ? (
          <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
            {msg}
          </div>
        ) : null}

        <div className="mt-6 grid gap-6">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-sm font-semibold">Inputs</div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-sm font-medium">Job title</span>
                <input
                  className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Software Engineer"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">Company</span>
                <input
                  className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme"
                />
              </label>

              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-medium">Job posting URL (optional)</span>
                <input
                  className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  placeholder="https://..."
                />
              </label>

              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-medium">Job description</span>
                <textarea
                  className="min-h-40 rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the job description here…"
                />
              </label>

              <label className="grid gap-1 md:col-span-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Gemini API key (stored only in this browser)
                </span>
                <input
                  className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza…"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="bg-gradient-primary h-11 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] disabled:opacity-60"
                onClick={() => void tailorNow()}
                disabled={busy !== null}
              >
                {busy === "tailor" ? "Tailoring…" : "Tailor"}
              </button>

              {resumeUrl ? (
                <a
                  className="h-11 rounded-md border bg-card px-4 text-sm font-semibold transition hover:bg-muted"
                  href={resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View current resume
                </a>
              ) : null}
            </div>

            {!resumeUrl ? (
              <div className="mt-3 text-sm text-muted-foreground">
                No resume upload found yet.
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Tailored resume</div>
                <div className="mt-1 text-xs text-muted-foreground">{metaText || "—"}</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-11 rounded-md border bg-card px-4 text-sm font-semibold transition hover:bg-muted disabled:opacity-60"
                  disabled={!tailoredText.trim()}
                  onClick={() =>
                    downloadBlob(
                      new Blob([tailoredText], { type: "text/plain;charset=utf-8" }),
                      "resume-tailored.txt",
                    )
                  }
                >
                  Download .txt
                </button>

                <button
                  type="button"
                  className="h-11 rounded-md border bg-card px-4 text-sm font-semibold transition hover:bg-muted disabled:opacity-60"
                  disabled={!tailoredText.trim()}
                  onClick={() => {
                    const bytes = simplePdfFromText(tailoredText);
                    downloadBlob(
                      new Blob([u8ToArrayBuffer(bytes)], { type: "application/pdf" }),
                      "resume-tailored.pdf",
                    );
                  }}
                >
                  Download PDF
                </button>

                {tailoredUploadUrl ? (
                  <a
                    className="h-11 rounded-md border bg-card px-4 text-sm font-semibold transition hover:bg-muted"
                    href={tailoredUploadUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View saved PDF
                  </a>
                ) : null}
              </div>
            </div>

            <textarea
              className="mt-4 min-h-[420px] w-full rounded-lg border bg-background p-3 font-mono text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              spellCheck={false}
              value={tailoredText}
              onChange={(e) => setTailoredText(e.target.value)}
              placeholder="Tailored resume text will appear here…"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="bg-gradient-primary h-11 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] disabled:opacity-60"
                disabled={!tailoredText.trim() || busy !== null}
                onClick={() => void saveTailored()}
              >
                {busy === "save" || busy === "upload" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
