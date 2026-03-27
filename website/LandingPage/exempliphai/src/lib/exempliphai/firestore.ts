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
    linkedinPdf?: UploadMeta | null;
    tailoredResume?: UploadMeta | null;
  };
  updatedAt?: any;
};

export function jobFieldsDocRef(db: Firestore, uid: string) {
  return doc(db, "users", uid, "jobFields", "current");
}

/**
 * Optional newer schema location (see FIREBASE_EXTENSION_SCHEMA.md).
 * Website reads/writes both paths for compatibility.
 */
export function extensionStateDocRef(db: Firestore, uid: string) {
  return doc(db, "users", uid, "extension", "state");
}

export function normalizeExtensionStateToJobFields(data: any): JobFieldsDoc {
  const uiProfileFields =
    data && typeof data === "object" && data.uiProfileFields && typeof data.uiProfileFields === "object"
      ? data.uiProfileFields
      : data && typeof data === "object" && data.sync && typeof data.sync === "object"
        ? data.sync
        : {};

  const resumeDetails =
    data && typeof data === "object"
      ? (data.resumeDetails ?? data.Resume_details ?? null)
      : null;

  const localState =
    data && typeof data === "object" && data.localState && typeof data.localState === "object"
      ? data.localState
      : {};

  const tailoredText = typeof localState.Resume_tailored_text === "string" ? localState.Resume_tailored_text : "";
  const tailoredMeta = localState.Resume_tailored_meta && typeof localState.Resume_tailored_meta === "object" ? localState.Resume_tailored_meta : null;
  const tailoredName = typeof localState.Resume_tailored_name === "string" ? localState.Resume_tailored_name : "";

  const fileMeta =
    data && typeof data === "object" && data.fileMeta && typeof data.fileMeta === "object"
      ? data.fileMeta
      : {};

  const uploads: any = {};
  if (fileMeta.resumes) uploads.resume = fileMeta.resumes;
  if (fileMeta.linkedinPdfs) uploads.linkedinPdf = fileMeta.linkedinPdfs;
  if (fileMeta.resumesTailored) uploads.tailoredResume = fileMeta.resumesTailored;

  return {
    sync: uiProfileFields,
    resumeDetails,
    tailoredResume: tailoredText || tailoredMeta || tailoredName ? { text: tailoredText, meta: tailoredMeta, name: tailoredName } : undefined,
    uploads: Object.keys(uploads).length ? uploads : undefined,
  };
}

function extensionPatchFromJobFields(patch: Partial<JobFieldsDoc>): Record<string, any> {
  const out: Record<string, any> = {};

  if (Object.prototype.hasOwnProperty.call(patch, "sync")) {
    out.uiProfileFields = patch.sync ?? {};
  }

  if (Object.prototype.hasOwnProperty.call(patch, "resumeDetails")) {
    out.resumeDetails = patch.resumeDetails ?? null;
    // Legacy key name used by the extension's local storage.
    out.Resume_details = patch.resumeDetails ?? null;
  }

  if (patch.tailoredResume) {
    out.localState = {
      Resume_tailored_text: String(patch.tailoredResume.text || ""),
      Resume_tailored_meta: patch.tailoredResume.meta ?? null,
      Resume_tailored_name: String(patch.tailoredResume.name || ""),
    };
  }

  if (patch.uploads) {
    const fm: any = {};
    if (Object.prototype.hasOwnProperty.call(patch.uploads, "resume")) fm.resumes = patch.uploads.resume;
    if (Object.prototype.hasOwnProperty.call(patch.uploads, "linkedinPdf")) fm.linkedinPdfs = patch.uploads.linkedinPdf;
    if (Object.prototype.hasOwnProperty.call(patch.uploads, "tailoredResume")) fm.resumesTailored = patch.uploads.tailoredResume;
    out.fileMeta = fm;
  }

  return out;
}

export async function patchJobFields(
  db: Firestore,
  uid: string,
  patch: Partial<JobFieldsDoc>,
) {
  // Primary (current extension implementation): users/{uid}/jobFields/current
  await setDoc(
    jobFieldsDocRef(db, uid),
    {
      ...patch,
      updatedAt: serverTimestamp(),
    } as DocumentData,
    { merge: true },
  );

  // Secondary (schema doc): users/{uid}/extension/state
  const extPatch = extensionPatchFromJobFields(patch);
  if (Object.keys(extPatch).length) {
    await setDoc(
      extensionStateDocRef(db, uid),
      {
        ...extPatch,
        updatedAt: serverTimestamp(),
      } as DocumentData,
      { merge: true },
    );
  }
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
