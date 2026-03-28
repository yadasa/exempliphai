import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
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
