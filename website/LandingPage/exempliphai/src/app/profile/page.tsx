"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FieldPath,
  collection,
  deleteField,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
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
  profileDocRef,
  type JobFieldsDoc,
  type ResumeDetails,
  type UploadMeta,
} from "@/lib/exempliphai/firestore";

type FieldDef = {
  label: string;
  placeholder?: string;
  options?: string[];
};

const PROFILE_SECTIONS: Array<{ title?: string; fields: FieldDef[] }> = [
  {
    fields: [
      { label: "First Name", placeholder: "John" },
      { label: "Middle Name", placeholder: "Quincy" },
      { label: "Last Name", placeholder: "Pork" },
      { label: "Full Name", placeholder: "John Pork Sr." },
      { label: "Email", placeholder: "jpork@mit.edu" },
      { label: "Phone", placeholder: "123-345-6789" },
      {
        label: "Phone Type",
        options: ["Landline", "Mobile", "Office Phone"],
      },
    ],
  },
  {
    title: "Socials",
    fields: [
      { label: "LinkedIn", placeholder: "https://linkedin.com/in/johnpork" },
      { label: "Github", placeholder: "https://github.com/..." },
      { label: "LeetCode", placeholder: "https://leetcode.com/..." },
      { label: "Medium", placeholder: "https://medium.com/@..." },
      { label: "Personal Website", placeholder: "johnpork.com" },
      { label: "Other URL", placeholder: "https://..." },
    ],
  },
  {
    title: "Location",
    fields: [
      { label: "Location (Street)", placeholder: "123 Sesame St" },
      { label: "Location (City)", placeholder: "Albuquerque" },
      { label: "Location (State/Region)", placeholder: "New Mexico" },
      {
        label: "Location (Country)",
        placeholder: "United States of America",
      },
      { label: "Postal/Zip Code", placeholder: "87104" },
    ],
  },
  {
    title: "Additional Information",
    fields: [
      { label: "Legally Authorized to Work", options: ["Yes", "No"] },
      { label: "Requires Sponsorship", options: ["Yes", "No"] },
      { label: "Job Notice Period", placeholder: "Two weeks" },
      { label: "Expected Salary", placeholder: "$150,000" },
      { label: "Languages", placeholder: "English, Spanish" },
      { label: "Willing to Relocate", options: ["Yes", "No"] },
      { label: "Date Available", placeholder: "Immediately" },
      { label: "Security Clearance", options: ["Yes", "No"] },
    ],
  },
  {
    title: "Voluntary Identification",
    fields: [
      {
        label: "Pronouns",
        options: [
          "He/Him",
          "She/Her",
          "They/Them",
          "Decline To Self Identify",
          "Other",
        ],
      },
      {
        label: "Gender",
        options: ["Male", "Female", "Decline To Self Identify"],
      },
      {
        label: "Race",
        options: [
          "American Indian or Alaskan Native",
          "Asian",
          "Black or African American",
          "White",
          "Native Hawaiian or Other Pacific Islander",
          "Two or More Races",
          "Decline To Self Identify",
        ],
      },
      {
        label: "Hispanic/Latino",
        options: ["Yes", "No", "Decline To Self Identify"],
      },
      {
        label: "Veteran Status",
        options: [
          "I am not a protected veteran",
          "I identify as one or more of the classifications of a protected veteran",
          "I don't wish to answer",
        ],
      },
      {
        label: "Disability Status",
        options: [
          "Yes, I have a disability, or have had one in the past",
          "No, I do not have a disability and have not had one in the past",
          "I do not want to answer",
        ],
      },
    ],
  },
];

const EXPERIENCE_SYNC_FIELDS: Array<{ title: string; fields: FieldDef[] }> = [
  {
    title: "Work Experience",
    fields: [
      { label: "Current Employer", placeholder: "Apple" },
      { label: "Years of Experience", placeholder: "5" },
    ],
  },
  {
    title: "Education",
    fields: [
      {
        label: "School",
        placeholder: "Massachusetts Institute of Technology",
      },
      {
        label: "Degree",
        options: [
          "Associate's Degree",
          "Bachelor's Degree",
          "Doctor of Medicine (M.D.)",
          "Doctor of Philosophy (Ph.D.)",
          "Engineer's Degree",
          "High School",
          "Juris Doctor (J.D.)",
          "Master of Business Administration (M.B.A.)",
          "Master's Degree",
          "Other",
        ],
      },
      { label: "Discipline", placeholder: "Computer Science" },
      {
        label: "Start Date Month",
        options: [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ],
      },
      { label: "Start Date Year", placeholder: "2024" },
      {
        label: "End Date Month",
        options: [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ],
      },
      { label: "End Date Year", placeholder: "2025" },
      { label: "GPA", placeholder: "3.94" },
    ],
  },
];

function ensureObj(x: any): Record<string, any> {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function ensureResumeDetails(x: any): ResumeDetails {
  const d = x && typeof x === "object" ? x : {};
  return {
    skills: Array.isArray(d.skills) ? d.skills.map((s: any) => String(s)).filter(Boolean) : [],
    experiences: Array.isArray(d.experiences)
      ? d.experiences.map((e: any) => ensureObj(e)).slice(0, 50)
      : [],
    certifications: Array.isArray(d.certifications)
      ? d.certifications.map((c: any) => ensureObj(c)).slice(0, 50)
      : [],
  };
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileInner />
    </RequireAuth>
  );
}

function ProfileInner() {
  const { user } = useAuth();

  const [tab, setTab] = useState<"profile" | "experience" | "raw">("profile");

  const [jobFields, setJobFields] = useState<JobFieldsDoc | null>(null);

  // Draft state (edited locally; only persisted on Save)
  const [draftSyncFields, setDraftSyncFields] = useState<Record<string, string>>({});
  const [draftResumeDetails, setDraftResumeDetails] = useState<ResumeDetails>(() =>
    ensureResumeDetails(null),
  );

  // Baseline snapshot (last loaded/saved server state)
  const syncBaselineRef = useRef<string>("");
  const resumeBaselineRef = useRef<string>("");
  const syncBaselineObjRef = useRef<Record<string, any>>({});
  const resumeBaselineObjRef = useRef<ResumeDetails>(ensureResumeDetails(null));

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [uploadBusy, setUploadBusy] = useState<null | "resume" | "coverLetter">(null);
  const [fileDocs, setFileDocs] = useState<Array<{ id: string; data: any }>>([]);

  function normalizeSyncFields(x: any): Record<string, string> {
    const obj = ensureObj(x);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      const s = v == null ? "" : typeof v === "string" ? v : String(v);
      if (!s.trim()) continue;
      out[k] = s;
    }
    return out;
  }

  function applyServerSnapshot(
    data: JobFieldsDoc | null,
    opts?: { overwriteDraft?: boolean },
  ) {
    setJobFields(data);

    const nextSync = normalizeSyncFields(data?.sync || {});
    syncBaselineObjRef.current = nextSync;
    syncBaselineRef.current = JSON.stringify(nextSync);

    const nextRd = ensureResumeDetails(data?.resumeDetails || null);
    resumeBaselineObjRef.current = nextRd;
    resumeBaselineRef.current = JSON.stringify(nextRd);

    if (opts?.overwriteDraft !== false) {
      setDraftSyncFields(nextSync);
      setDraftResumeDetails(nextRd);
    }

    setLoadedAt(new Date().toISOString());
    setErr(null);
  }

  async function loadProfile(opts?: { overwriteDraft?: boolean }) {
    if (!user) return;
    const { db } = getFirebase();
    setLoadingProfile(true);

    try {
      const snap = await getDoc(profileDocRef(db, user.uid));
      const data = snap.exists() ? (snap.data() as any as JobFieldsDoc) : null;
      applyServerSnapshot(data, opts);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingProfile(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadProfile({ overwriteDraft: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const q = query(
      collection(db, "users", user.uid, "files"),
      orderBy("updatedAt", "desc"),
      limit(50),
    );

    const unsub = onSnapshot(q, (snap) => {
      setFileDocs(snap.docs.map((d) => ({ id: d.id, data: d.data() as any })));
    });

    return () => unsub();
  }, [user?.uid]);

  const dirty = useMemo(() => {
    const syncCur = JSON.stringify(draftSyncFields || {});
    const rdCur = JSON.stringify(draftResumeDetails || {});

    return syncCur !== syncBaselineRef.current || rdCur !== resumeBaselineRef.current;
  }, [draftSyncFields, draftResumeDetails]);

  async function save() {
    setErr(null);
    setMsg(null);

    if (!dirty) {
      setMsg("No changes to save.");
      return;
    }

    try {
      if (!user) throw new Error("Not signed in");
      const { db } = getFirebase();
      const docRef = profileDocRef(db, user.uid);

      setSaving(true);

      const prevSync = ensureObj(syncBaselineObjRef.current || {});
      const nextSync = ensureObj(draftSyncFields || {});

      const updateArgs: any[] = [];

      // sync.* (granular)
      {
        const keys = new Set([...Object.keys(prevSync), ...Object.keys(nextSync)]);
        for (const k of keys) {
          const prev = (prevSync as any)[k];
          const next = (nextSync as any)[k];

          if (JSON.stringify(prev ?? null) === JSON.stringify(next ?? null)) continue;

          const fp = new FieldPath("sync", String(k));
          if (next == null || (typeof next === "string" && !String(next).trim())) {
            updateArgs.push(fp, deleteField());
          } else {
            updateArgs.push(fp, next);
          }
        }
      }

      // resumeDetails (whole object)
      const prevRd = resumeBaselineObjRef.current;
      const nextRd = draftResumeDetails || ensureResumeDetails(null);
      if (JSON.stringify(prevRd ?? null) !== JSON.stringify(nextRd ?? null)) {
        updateArgs.push(new FieldPath("resumeDetails"), nextRd);
      }

      // Always bump updatedAt on Save
      updateArgs.push(new FieldPath("updatedAt"), serverTimestamp());

      if (!jobFields) {
        // First write (doc doesn't exist yet)
        await setDoc(
          docRef,
          {
            sync: nextSync,
            resumeDetails: nextRd,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await updateDoc(
          docRef,
          ...(updateArgs as unknown as [any, any, ...any[]]),
        );
      }

      applyServerSnapshot(
        {
          ...(jobFields || {}),
          sync: nextSync,
          resumeDetails: nextRd,
        },
        { overwriteDraft: false },
      );

      setMsg("Saved.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  function setSyncField(label: string, vRaw: string) {
    const v = String(vRaw || "");
    setDraftSyncFields((prev) => {
      const next = { ...(prev || {}) };
      if (!v.trim()) delete (next as any)[label];
      else (next as any)[label] = v;
      return next;
    });
  }

  function updateResumeDetails(patch: Partial<ResumeDetails>) {
    setDraftResumeDetails((prev) => ({ ...ensureResumeDetails(prev), ...patch }));
  }

  async function uploadPdf(kind: "resume" | "coverLetter", file: File) {
    if (!user) throw new Error("Not signed in");
    if (!file) return;

    const safeName = String(file.name || `${kind}.pdf`).replace(/\s+/g, "_");
    const path = `data/uploads/${user.uid}/${kind}/${Date.now()}_${safeName}`;

    const { storage, db } = getFirebase();
    setUploadBusy(kind);
    setErr(null);
    setMsg(null);

    try {
      const r = storageRef(storage, path);
      await uploadBytes(r, file, {
        contentType: file.type || "application/pdf",
      });
      const [url, meta] = await Promise.all([getDownloadURL(r), getMetadata(r)]);

      const uploadMeta: UploadMeta = {
        bucket: meta.bucket,
        path: meta.fullPath,
        contentType: meta.contentType || file.type || "application/pdf",
        size: Number(meta.size || file.size || 0),
        updated: String(meta.updated || new Date().toISOString()),
        downloadUrl: url,
        name: safeName,
        kind,
        storedAt: new Date().toISOString(),
      };

      await setDoc(
        profileDocRef(db, user.uid),
        {
          uploads: {
            [kind]: uploadMeta,
          } as any,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // Update local view immediately (we no longer keep a real-time listener on the profile doc)
      setJobFields((prev) => {
        const next = { ...(prev || {}) } as any;
        next.uploads = { ...(ensureObj((prev as any)?.uploads) as any), [kind]: uploadMeta };
        return next;
      });

      setMsg(`${kind === "resume" ? "Resume" : "Cover Letter"} uploaded.`);
    } finally {
      setUploadBusy(null);
    }
  }

  const uploads = jobFields?.uploads || {};
  const resumeUpload = uploads?.resume || null;
  const coverLetterUpload = uploads?.coverLetter || null;

  const draftPreviewDoc = useMemo(
    () => ({
      ...(jobFields || {}),
      sync: draftSyncFields || {},
      resumeDetails: draftResumeDetails || null,
    }),
    [jobFields, draftSyncFields, draftResumeDetails],
  );

  const pathText = user ? `users/${user.uid}/profile/current` : "users/{uid}/profile/current";

  return (
    <div className="container relative py-14 md:py-16">
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
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <div className="flex gap-3">
            <Link className="text-sm text-primary underline" href={"/account" as any}>
              Account
            </Link>
            <Link className="text-sm text-primary underline" href="/">
              Home
            </Link>
          </div>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Mirroring extension state from <span className="font-mono">{pathText}</span>. Changes are
          kept locally until you click <span className="font-semibold">Save</span>.
        </p>

        <div aria-live="polite" aria-atomic="true">
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
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Profile sections" className="flex flex-wrap gap-2">
            <button
              role="tab"
              aria-selected={tab === "profile"}
              className={`h-10 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "profile"
                  ? "bg-gradient-primary text-primary-foreground"
                  : "border bg-card hover:bg-muted"
              }`}
              onClick={() => setTab("profile")}
              type="button"
            >
              Profile
            </button>
            <button
              role="tab"
              aria-selected={tab === "experience"}
              className={`h-10 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "experience"
                  ? "bg-gradient-primary text-primary-foreground"
                  : "border bg-card hover:bg-muted"
              }`}
              onClick={() => setTab("experience")}
              type="button"
            >
              Experience
            </button>
            <button
              role="tab"
              aria-selected={tab === "raw"}
              className={`h-10 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "raw"
                  ? "bg-gradient-primary text-primary-foreground"
                  : "border bg-card hover:bg-muted"
              }`}
              onClick={() => setTab("raw")}
              type="button"
            >
              Raw JSON
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs text-muted-foreground">
              <span className={dirty ? "font-semibold text-amber-600" : ""}>
                {dirty ? "Unsaved changes" : "Up to date"}
              </span>
              {loadedAt ? (
                <span className="ml-2">Loaded {new Date(loadedAt).toLocaleString()}</span>
              ) : null}
            </div>

            <button
              className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setMsg(null);
                setErr(null);
                setDraftSyncFields(normalizeSyncFields(syncBaselineObjRef.current || {}));
                setDraftResumeDetails(ensureResumeDetails(resumeBaselineObjRef.current || null));
              }}
            >
              Reset
            </button>

            <button
              className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              type="button"
              disabled={loadingProfile || saving}
              onClick={() => {
                if (dirty) {
                  const ok = window.confirm(
                    "Reload from cloud and discard your unsaved changes?",
                  );
                  if (!ok) return;
                }
                void loadProfile({ overwriteDraft: true });
              }}
            >
              {loadingProfile ? "Reloading…" : "Reload"}
            </button>

            <button
              className="bg-gradient-primary h-10 rounded-md px-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              onClick={() => save()}
              type="button"
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="mt-6">
          {tab === "raw" ? (
            <textarea
              className="min-h-[520px] w-full rounded-lg border bg-background p-3 font-mono text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              spellCheck={false}
              value={JSON.stringify(draftPreviewDoc || {}, null, 2)}
              readOnly
            />
          ) : null}

          {tab === "profile" ? (
            <div className="grid gap-8">
              {PROFILE_SECTIONS.map((section, idx) => (
                <div key={idx}>
                  {section.title ? (
                    <h2 className="text-lg font-semibold">{section.title}</h2>
                  ) : null}
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {section.fields.map((f) => (
                      <Field
                        key={f.label}
                        field={f}
                        value={draftSyncFields?.[f.label] ?? ""}
                        onChange={(v) => setSyncField(f.label, v)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "experience" ? (
            <div className="grid gap-8">
              <div>
                <h2 className="text-lg font-semibold">Documents</h2>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <UploadCard
                    title="Resume"
                    busy={uploadBusy === "resume"}
                    meta={resumeUpload}
                    onUpload={(file) => void uploadPdf("resume", file)}
                  />
                  <UploadCard
                    title="Cover Letter"
                    busy={uploadBusy === "coverLetter"}
                    meta={coverLetterUpload}
                    onUpload={(file) => void uploadPdf("coverLetter", file)}
                  />
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  Tip: Uploading here saves to Firebase Storage under{" "}
                  <span className="font-mono">data/uploads/{user?.uid}/…</span>.
                </p>

                <div className="mt-4 rounded-xl border bg-background/40 p-4">
                  <div className="text-sm font-semibold">Uploaded files (optional)</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    If your account uses <span className="font-mono">users/{user?.uid}/files/*</span>, they’ll show up here.
                  </div>

                  {fileDocs.length ? (
                    <div className="mt-3 grid gap-2">
                      {fileDocs.map((f) => (
                        <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                          <div className="text-xs text-muted-foreground">
                            <span className="font-mono">{String((f.data as any)?.kind || f.id)}</span>
                            {((f.data as any)?.filename || (f.data as any)?.name) ? (
                              <span> · {String((f.data as any)?.filename || (f.data as any)?.name)}</span>
                            ) : null}
                          </div>
                          {(f.data as any)?.downloadUrl ? (
                            <a
                              className="text-xs font-semibold text-primary underline"
                              href={String((f.data as any).downloadUrl)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-muted-foreground">No file docs found.</div>
                  )}
                </div>
              </div>

              {EXPERIENCE_SYNC_FIELDS.map((section) => (
                <div key={section.title}>
                  <h2 className="text-lg font-semibold">{section.title}</h2>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {section.fields.map((f) => (
                      <Field
                        key={f.label}
                        field={f}
                        value={draftSyncFields?.[f.label] ?? ""}
                        onChange={(v) => setSyncField(f.label, v)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <ResumeDetailsEditor
                value={draftResumeDetails}
                onChange={(next) => updateResumeDetails(next)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium">{field.label}</span>

      {Array.isArray(field.options) && field.options.length ? (
        <select
          className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ""}
          type="text"
        />
      )}
    </label>
  );
}

function UploadCard({
  title,
  meta,
  busy,
  onUpload,
}: {
  title: string;
  meta: UploadMeta | null | undefined;
  busy: boolean;
  onUpload: (file: File) => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {meta?.name
              ? meta.name
              : meta?.path
                ? meta.path.split("/").slice(-1)[0]
                : "No file uploaded yet."}
          </div>
        </div>

        {meta?.downloadUrl ? (
          <a
            className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={meta.downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            View
          </a>
        ) : null}
      </div>

      <div className="mt-3">
        <label className="block">
          <span className="sr-only">Upload {title}</span>
          <input
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.currentTarget.value = "";
            }}
          />
        </label>

        {meta?.downloadUrl ? (
          <div className="mt-2 text-xs text-muted-foreground">
            Updated: {meta.updated ? new Date(meta.updated).toLocaleString() : "—"}
          </div>
        ) : null}
        {busy ? (
          <div className="mt-2 text-xs text-muted-foreground">Uploading…</div>
        ) : null}
      </div>
    </div>
  );
}

function ResumeDetailsEditor({
  value,
  onChange,
}: {
  value: ResumeDetails;
  onChange: (patch: Partial<ResumeDetails>) => void;
}) {
  const skills = Array.isArray(value?.skills) ? value.skills : [];
  const experiences = Array.isArray(value?.experiences) ? value.experiences : [];
  const certs = Array.isArray(value?.certifications)
    ? value.certifications
    : [];

  const [newSkill, setNewSkill] = useState("");

  const experienceFields = useMemo(
    () =>
      [
        { key: "jobTitle", label: "Job Title" },
        { key: "jobEmployer", label: "Employer" },
        { key: "jobDuration", label: "Duration" },
        { key: "isCurrentEmployer", label: "Current" },
        { key: "roleBulletsString", label: "Role Bullets" },
      ] as const,
    [],
  );

  const certFields = useMemo(
    () =>
      [
        { key: "name", label: "Name" },
        { key: "issuer", label: "Issuer" },
        { key: "issueDate", label: "Issue Date" },
        { key: "expirationDate", label: "Expiration Date" },
        { key: "credentialId", label: "Credential ID" },
        { key: "url", label: "URL" },
      ] as const,
    [],
  );

  return (
    <div className="grid gap-8">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Work Experience</h2>
          <button
            type="button"
            className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() =>
              onChange({
                experiences: [
                  ...experiences,
                  {
                    jobTitle: "",
                    jobEmployer: "",
                    jobDuration: "",
                    isCurrentEmployer: false,
                    roleBulletsString: "",
                  },
                ],
              })
            }
          >
            Add
          </button>
        </div>

        {experiences.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">No items yet.</div>
        ) : null}

        <div className="mt-3 grid gap-3">
          {experiences.map((ex: any, idx: number) => (
            <div key={idx} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Experience #{idx + 1}</div>
                <button
                  type="button"
                  className="h-9 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    const next = experiences.slice();
                    next.splice(idx, 1);
                    onChange({ experiences: next });
                  }}
                >
                  Remove
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {experienceFields.map((f) => {
                  const v = (ex as any)?.[f.key];
                  if (f.key === "isCurrentEmployer") {
                    return (
                      <label key={f.key} className="grid gap-1">
                        <span className="text-sm font-medium">{f.label}</span>
                        <select
                          className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                          value={v === true ? "true" : v === false ? "false" : ""}
                          onChange={(e) => {
                            const next = experiences.slice();
                            const item = { ...(ensureObj(ex) as any) };
                            item.isCurrentEmployer = e.target.value === "true";
                            next[idx] = item;
                            onChange({ experiences: next });
                          }}
                        >
                          <option value="">—</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </label>
                    );
                  }

                  if (f.key === "roleBulletsString") {
                    return (
                      <label key={f.key} className="grid gap-1 md:col-span-2">
                        <span className="text-sm font-medium">{f.label}</span>
                        <textarea
                          className="min-h-28 rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                          value={typeof v === "string" ? v : ""}
                          onChange={(e) => {
                            const next = experiences.slice();
                            const item = { ...(ensureObj(ex) as any) };
                            item.roleBulletsString = e.target.value;
                            next[idx] = item;
                            onChange({ experiences: next });
                          }}
                        />
                      </label>
                    );
                  }

                  return (
                    <label key={f.key} className="grid gap-1">
                      <span className="text-sm font-medium">{f.label}</span>
                      <input
                        className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                        value={typeof v === "string" ? v : ""}
                        onChange={(e) => {
                          const next = experiences.slice();
                          const item = { ...(ensureObj(ex) as any) };
                          item[f.key] = e.target.value;
                          next[idx] = item;
                          onChange({ experiences: next });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Skills</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          {skills.length ? (
            skills.map((s, idx) => (
              <button
                key={`${s}-${idx}`}
                type="button"
                className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
                title="Remove"
                onClick={() => {
                  const next = skills.slice();
                  next.splice(idx, 1);
                  onChange({ skills: next });
                }}
              >
                {s} ×
              </button>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">No skills yet.</div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            placeholder="Add a skill (e.g. React)"
          />
          <button
            type="button"
            className="bg-gradient-primary h-11 shrink-0 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03]"
            onClick={() => {
              const s = newSkill.trim();
              if (!s) return;
              setNewSkill("");
              const next = Array.from(new Set([...skills, s]));
              onChange({ skills: next });
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Certifications</h2>
          <button
            type="button"
            className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() =>
              onChange({
                certifications: [
                  ...certs,
                  {
                    name: "",
                    issuer: "",
                    issueDate: "",
                    expirationDate: "",
                    credentialId: "",
                    url: "",
                  },
                ],
              })
            }
          >
            Add
          </button>
        </div>

        {certs.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">No items yet.</div>
        ) : null}

        <div className="mt-3 grid gap-3">
          {certs.map((c: any, idx: number) => (
            <div key={idx} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Certification #{idx + 1}</div>
                <button
                  type="button"
                  className="h-9 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    const next = certs.slice();
                    next.splice(idx, 1);
                    onChange({ certifications: next });
                  }}
                >
                  Remove
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {certFields.map((f) => (
                  <label key={f.key} className="grid gap-1">
                    <span className="text-sm font-medium">{f.label}</span>
                    <input
                      className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                      value={typeof (c as any)?.[f.key] === "string" ? (c as any)[f.key] : ""}
                      onChange={(e) => {
                        const next = certs.slice();
                        const item = { ...(ensureObj(c) as any) };
                        item[f.key] = e.target.value;
                        next[idx] = item;
                        onChange({ certifications: next });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
