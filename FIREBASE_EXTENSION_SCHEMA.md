# Exempliphai Chrome Extension → Firebase data model (proposed)

## Collections

### `/users/{uid}`
User root (website-owned). Extension writes only within the user’s own tree.

### `/users/{uid}/extension/state`
Single doc holding most extension state (small/medium sized):

```jsonc
{
  "version": 1,
  "updatedAt": "<serverTimestamp>",
  "settings": {
    "geminiApiKey": "...",
    "theme": "light|dark",
    "privacyToggle": true,

    "cloudSyncEnabled": false,
    "aiMappingEnabled": true,
    "autoSubmitEnabled": false,
    "autoTailorEnabled": false,
    "listModeEnabled": false,
    "closePreviousTabs": false,
    "autofillDelayMs": 2500
  },
  "uiProfileFields": {
    "First Name": "Kei",
    "Last Name": "...",
    "Phone Type": "Mobile",
    "Race": "..."
    // ... all other chrome.storage.sync keys except reserved settings keys
  },
  "localProfile": {
    // LOCAL_PROFILE schema-driven object (Simplify-compatible)
    "first_name": "...",
    "experience": [ { "company": "..." } ]
  },
  "resumeDetails": {
    "skills": ["JavaScript"],
    "experiences": [ {"jobTitle":"","jobEmployer":""} ],
    "certifications": [ {"name":"","issuer":""} ]
  },
  "localState": {
    "jobQueue": [ {"url":"https://...","status":"pending"} ],
    "currentIndex": 0,
    "listModePaused": true,
    "listModeActiveJob": null,
    "listModeNextOpenAt": 0,

    "aiUsageLog": [ {"date":"...","tokensIn":123,"tokensOut":45,"costCents":0.01} ],

    "atsConfigOverride": { /* optional */ },

    "Resume_tailored_text": "...",
    "Resume_tailored_meta": {"pageUrl":"...","pageKey":"..."}
  },
  "jobSearchLast": {
    "generated_at": "2026-...",
    "desiredLocation": "NYC",
    "recommendations": [ {"title":"..."} ]
  },
  "jobSearchLastId": "2026_...",
  "fileMeta": {
    "resumes": {"sha256":"...","path":"data/uploads/...","downloadUrl":"..."},
    "linkedinPdfs": {"sha256":"...","path":"data/uploads/...","downloadUrl":"..."},
    "resumesTailored": {"sha256":"...","path":"data/uploads/...","downloadUrl":"..."}
  }
}
```

### `/users/{uid}/appliedJobs/{jobId}`
Applied jobs (subcollection; jobId derived from URL):

```jsonc
{
  "url": "https://...",
  "company": "Acme",
  "role": "Software Engineer",
  "appliedAt": "<timestamp>",
  "updatedAt": "<serverTimestamp>"
}
```

### `/users/{uid}/jobSearches/{searchId}`
Persist job search results per run:

```jsonc
{
  "generatedAt": "<timestamp>",
  "desiredLocation": "Remote",
  "recommendations": [
    {
      "title": "...",
      "company": "...",
      "location": "...",
      "salary": "...",
      "why_match": "...",
      "links": [{"label":"...","url":"https://..."}]
    }
  ],
  "updatedAt": "<serverTimestamp>"
}
```

### `/users/{uid}/files/{kind}`
Metadata for uploaded files (actual bytes stored in Storage):

```jsonc
{
  "kind": "resumes|linkedinPdfs|resumesTailored",
  "path": "data/uploads/<uid>/resumes/<sha>-resume.pdf",
  "filename": "resume.pdf",
  "sha256": "...",
  "downloadUrl": "https://firebasestorage.googleapis.com/...",
  "updatedAt": "<serverTimestamp>"
}
```

## Storage paths

- `gs://<bucket>/data/uploads/{uid}/resumes/...`
- `gs://<bucket>/data/uploads/{uid}/coverLetters/...` (reserved)
- `gs://<bucket>/data/uploads/{uid}/linkedinPdfs/...`
- `gs://<bucket>/data/uploads/{uid}/resumesTailored/...`

## Sync behavior

- Source of truth: Firestore/Storage.
- Extension keeps a local cache in `chrome.storage.local`/`chrome.storage.sync` for fast UI + content script compatibility.
- Autosave: any storage change schedules a Firestore flush via `chrome.alarms` after 30s (debounced).
- Offline: flush failures schedule a retry alarm.
