# Exempliphai data model (extension + website)

This document describes the **current canonical Firestore schema** used by the Exempliphai Chrome extension + website.

## Canonical source of truth

- **Job fields / profile / resume details:** `users/{uid}/jobFields/current`
- **Job search cache (validated links only):** `users/{uid}/jobSearchResults` (+ `jobSearchRuns`)
- **Applied job history:** `users/{uid}/appliedJobs`

Non‑negotiable: the UI must never ask a model to invent job links. The website should **read cached validated results** from Firestore.

---

## Firestore paths

### `users/{uid}`
Website-owned root user doc. Extension writes within the user’s own tree.

### `users/{uid}/jobFields/current`
Single doc holding sync-safe user inputs.

Shape (high level):

```jsonc
{
  "schemaVersion": 2,
  "canonicalSource": "extension" | "website",

  // Mirrors chrome.storage.sync (UI fields + settings)
  "sync": { "First Name": "...", "API Key": "..." },

  // Mirrors chrome.storage.local.Resume_details
  "resumeDetails": { "skills": [], "experiences": [], "certifications": [] },

  // Mirrors LOCAL_PROFILE (Simplify-compatible)
  "localProfile": { "first_name": "...", "experience": [] },

  // Tailored resume text + metadata
  "tailoredResume": { "text": "...", "meta": {}, "name": "resume_tailored.pdf" },

  // Storage metadata only (actual bytes live in Storage)
  "uploads": {
    "resume": { "bucket": "...", "path": "...", "downloadUrl": "..." },
    "coverLetter": { "bucket": "...", "path": "...", "downloadUrl": "..." },
    "tailoredResume": { "bucket": "...", "path": "...", "downloadUrl": "..." }
  },

  "updatedAt": "<serverTimestamp>"
}
```

### `users/{uid}/appliedJobs/{jobId}`
Applied jobs history. `jobId` is derived deterministically from the job URL.

```jsonc
{
  "url": "https://...",
  "domain": "boards.greenhouse.io",
  "title": "Software Engineer",
  "company": "Acme",
  "applied": true,
  "timestamp": "<serverTimestamp>",
  "updatedAt": "<serverTimestamp>"
}
```

### `users/{uid}/jobSearchRuns/{runId}`
Metadata for a search run (the *event*).

```jsonc
{
  "runId": "...",
  "desiredLocation": "Remote",
  "queryFingerprint": "...",
  "profileFingerprint": "...",
  "modelName": "gemini-3-flash-preview",
  "temperature": 0.3,
  "createdAt": "<serverTimestamp>",
  "completedAt": "<serverTimestamp>",
  "totalCandidatesSeen": 120,
  "totalValidated": 12,
  "totalRejected": 108,
  "totalStored": 12,
  "updatedAt": "<serverTimestamp>"
}
```

### `users/{uid}/jobSearchResults/{resultId}`
Reusable validated job posting records (the *cache*). This is what UIs should display by default.

Visibility filter (default):

- `applied == false`
- `hidden == false`
- `stale == false`
- `validationStatus == "validated"`

```jsonc
{
  "resultId": "...",
  "runId": "...",
  "dedupeKey": "hash(company|title|location|directUrl)",

  "title": "...",
  "company": "...",
  "location": "...",
  "salary": "",
  "whyMatch": "1-2 sentences",

  "directUrl": "https://...",            // must be a direct posting/apply URL
  "directUrlLabel": "Apply",
  "linkDomain": "jobs.lever.co",

  "sourceSystem": "openclaw",
  "confidenceScore": 0.82,
  "validationStatus": "validated",

  "applied": false,
  "appliedAt": null,

  "hidden": false,
  "stale": false,

  "firstSeenAt": "<serverTimestamp>",
  "lastSeenAt": "<serverTimestamp>",
  "lastValidatedAt": "<serverTimestamp>",
  "createdAt": "<serverTimestamp>",
  "updatedAt": "<serverTimestamp>"
}
```

---

## Storage paths

- `gs://<bucket>/data/uploads/{uid}/resume/...`
- `gs://<bucket>/data/uploads/{uid}/coverLetter/...`
- `gs://<bucket>/data/uploads/{uid}/tailoredResume/...`

---

## Notes

- The legacy collection `users/{uid}/jobSearches` is deprecated. New UI reads `jobSearchResults`.
- Applied jobs must be reflected by setting `jobSearchResults.applied=true` (so they disappear from default lists) and optionally also writing to `appliedJobs` for audit/history.
