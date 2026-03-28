import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

export type ResumeDetails = {
  skills?: string[];
  experiences?: Array<{
    jobTitle?: string;
    jobEmployer?: string;
    jobDuration?: string;
    isCurrentEmployer?: boolean;
    roleBulletsString?: string;
  }>;
  certifications?: Array<{
    name?: string;
    issuer?: string;
    issueDate?: string;
    expirationDate?: string;
    credentialId?: string;
    url?: string;
  }>;
};

export type UploadMeta = {
  bucket?: string;
  path?: string;
  contentType?: string;
  size?: number;
  updated?: string;
  downloadUrl?: string;
  name?: string;
  kind?: string;
  storedAt?: string;
};

export type JobFieldsDoc = {
  schemaVersion?: number;
  canonicalSource?: "extension" | "website" | string;

  sync?: Record<string, any>;
  resumeDetails?: ResumeDetails | null;
  localProfile?: Record<string, any> | null;
  tailoredResume?: {
    text?: string;
    meta?: any;
    name?: string;
  };
  uploads?: {
    resume?: UploadMeta | null;
    coverLetter?: UploadMeta | null;
    tailoredResume?: UploadMeta | null;

    // Back-compat (read-only): previous name.
    linkedinPdf?: UploadMeta | null;
  };

  updatedAt?: any;
};

export function jobFieldsDocRef(db: Firestore, uid: string) {
  return doc(db, "users", uid, "jobFields", "current");
}

export async function patchJobFields(db: Firestore, uid: string, patch: Partial<JobFieldsDoc>) {
  // Canonical document: users/{uid}/jobFields/current
  // Website must always use merge-safe partial writes.
  await setDoc(
    jobFieldsDocRef(db, uid),
    {
      ...patch,
      updatedAt: serverTimestamp(),
    } as DocumentData,
    { merge: true },
  );
}

export type AppliedJobDoc = {
  url: string;
  domain: string;
  title?: string;
  role?: string;
  company?: string;
  applied?: boolean;
  timestamp?: any;
};

export function appliedJobIdFromUrl(url: string): string {
  const u = String(url || "");
  try {
    return btoa(u)
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .slice(0, 150);
  } catch {
    return btoa(u.replace(/[^\x00-\x7F]+/g, ""))
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .slice(0, 150);
  }
}

export function domainFromUrl(url: string): string {
  try {
    const u = new URL(String(url || ""));
    return u.hostname;
  } catch {
    return "";
  }
}

export function canonUrlKey(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const base = `${u.origin}${u.pathname}`;
    return base.replace(/\/+$/g, "");
  } catch {
    return raw;
  }
}

export async function markAppliedJob(
  db: Firestore,
  uid: string,
  job: { url: string; company?: string; role?: string; title?: string },
) {
  const url = String(job.url || "").trim().slice(0, 2000);
  if (!url) throw new Error("Missing url");

  const docId = appliedJobIdFromUrl(url);

  await setDoc(
    doc(db, "users", uid, "appliedJobs", docId),
    {
      url,
      domain: domainFromUrl(url),
      title: String(job.title || job.role || "").slice(0, 200),
      role: String(job.role || "").slice(0, 200),
      company: String(job.company || "").slice(0, 200),
      applied: true,
      timestamp: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies DocumentData,
    { merge: true },
  );
}

export type JobSearchDoc = {
  timestamp?: any;
  searchOptions?: { desiredLocation?: string };
  generatedJobs?: any[];
  version?: string;
  generated_at?: string;
};

export async function createJobSearch(
  db: Firestore,
  uid: string,
  docData: Omit<JobSearchDoc, "timestamp">,
) {
  await addDoc(collection(db, "users", uid, "jobSearches"), {
    ...docData,
    timestamp: serverTimestamp(),
  } satisfies DocumentData);
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Search v0.2 (zero-hallucination links)
// Canonical source of truth:
// - users/{uid}/jobSearchRuns/{runId}
// - users/{uid}/jobSearchResults/{resultId}
// Website reads jobSearchResults and MUST NOT regenerate links.
// ─────────────────────────────────────────────────────────────────────────────

export type JobSearchRunDoc = {
  runId: string;
  desiredLocation?: string;
  queryFingerprint?: string;
  profileFingerprint?: string;
  modelName?: string;
  temperature?: number;
  createdAt?: any;
  completedAt?: any;
  totalCandidatesSeen?: number;
  totalValidated?: number;
  totalRejected?: number;
  totalStored?: number;
  updatedAt?: any;
};

export type JobSearchResultDoc = {
  resultId: string;
  runId: string;
  dedupeKey: string;
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  whyMatch?: string;
  directUrl: string;
  directUrlLabel?: string;
  linkDomain?: string;
  sourceSystem?: string;
  confidenceScore?: number | null;
  validationStatus: "validated" | "invalid" | string;
  applied: boolean;
  appliedAt?: any;
  hidden: boolean;
  stale: boolean;
  firstSeenAt?: any;
  lastSeenAt?: any;
  lastValidatedAt?: any;
  createdAt?: any;
  updatedAt?: any;
};

export function resultIdFromDedupeKey(dedupeKey: string): string {
  // Firestore doc ids: use base64url-ish to keep it URL-safe and deterministic.
  return appliedJobIdFromUrl(String(dedupeKey || ""));
}

export function dedupeKeyForJobResult(input: {
  company?: string;
  title: string;
  location?: string;
  directUrl: string;
}): string {
  return [
    String(input.company || "").trim(),
    String(input.title || "").trim(),
    String(input.location || "").trim(),
    String(input.directUrl || "").trim(),
  ].join("|");
}

export async function upsertJobSearchRunAndResults(
  db: Firestore,
  uid: string,
  payload: {
    run: Omit<JobSearchRunDoc, "createdAt" | "completedAt" | "updatedAt"> & { runId: string };
    results: Array<
      Omit<
        JobSearchResultDoc,
        | "createdAt"
        | "updatedAt"
        | "firstSeenAt"
        | "lastSeenAt"
        | "lastValidatedAt"
        | "validationStatus"
        | "applied"
        | "hidden"
        | "stale"
      > & { directUrl: string; title: string }
    >;
  },
) {
  const now = serverTimestamp();

  const batch = writeBatch(db);

  batch.set(
    doc(db, "users", uid, "jobSearchRuns", payload.run.runId),
    {
      ...payload.run,
      createdAt: now,
      completedAt: now,
      updatedAt: now,
    } satisfies DocumentData,
    { merge: true },
  );

  for (const r of payload.results.slice(0, 50)) {
    const dedupeKey = String(r.dedupeKey || "").trim() || dedupeKeyForJobResult(r);
    const resultId = String(r.resultId || "").trim() || resultIdFromDedupeKey(dedupeKey);

    batch.set(
      doc(db, "users", uid, "jobSearchResults", resultId),
      {
        ...r,
        resultId,
        dedupeKey,
        validationStatus: "validated",
        applied: false,
        appliedAt: null,
        hidden: false,
        stale: false,
        firstSeenAt: now,
        lastSeenAt: now,
        lastValidatedAt: now,
        createdAt: now,
        updatedAt: now,
      } satisfies DocumentData,
      { merge: true },
    );
  }

  await batch.commit();
}

export async function markJobSearchResultApplied(
  db: Firestore,
  uid: string,
  input: { resultId?: string; dedupeKey?: string },
) {
  const resultId = String(input.resultId || "").trim() || (input.dedupeKey ? resultIdFromDedupeKey(input.dedupeKey) : "");
  if (!resultId) throw new Error("Missing resultId");

  await setDoc(
    doc(db, "users", uid, "jobSearchResults", resultId),
    {
      applied: true,
      appliedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies DocumentData,
    { merge: true },
  );
}
