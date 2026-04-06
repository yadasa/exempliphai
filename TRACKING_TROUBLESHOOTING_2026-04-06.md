# ExempliPhai Tracking Troubleshooting (2026-04-06)

## Goal
Restore end-to-end tracking so the following update again:
- Firestore subcollections:
  - `users/{uid}/appliedJobs`
  - `users/{uid}/autofills`
  - `users/{uid}/customAnswers`
- Aggregates on `users/{uid}`:
  - `stats.autofills.total`
  - `stats.customAnswersGenerated.total`
- Website dashboard UI (Applied Jobs chart, tracking widgets)

## Symptoms observed
1) Website dashboard showed console errors and missing route payloads (404s) for Next/React Server Components payload files.
   - Example requests that 404’d: `dashboard/__next.dashboard.__PAGE__.txt?_rsc=...`
2) Tracking stopped end-to-end:
   - No new documents appeared in Firestore under:
     - `users/{uid}/appliedJobs`
     - `users/{uid}/autofills`
     - `users/{uid}/customAnswers`
3) After fixing website console errors, tracking still did not resume.

## What we verified in Firestore (schema)
A screenshot of Firestore confirmed the expected structure exists for the user:
- Document: `users/LYAb2f5EumaPrlAUTr0LQmVj7Gt1`
- Subcollections present:
  - `appliedJobs`, `autofills`, `customAnswers`, `jobSearches`
- Stats fields present:
  - `stats.autofills.total`, `stats.customAnswersGenerated.total`

## What we verified in code (paths)
The extension/service-worker tracking code uses the same paths as Firestore:
- `trackAppliedJob()` writes: `users/${uid}/appliedJobs/${id}`
- `trackAutofill()` writes: `users/${uid}/autofills` and increments `stats.autofills.total`
- `trackCustomAnswer()` writes: `users/${uid}/customAnswers` and increments `stats.customAnswersGenerated.total`

Conclusion: this is NOT a Firestore-path mismatch.

## What we tried (chronological)
### A) Website build/deploy issues (fixed)
Observed website console 404s for `__PAGE__` payload files. Local `out/` contained different filenames, suggesting a build/output mismatch.

Actions taken:
- Rebuilt and deployed hosting multiple times.
- Identified builds were running **Turbopack** when using `npx next build`.
- Confirmed the project has scripts to force webpack:
  - `website/LandingPage/exempliphai/package.json`: `build: next build --webpack`

Fix applied:
- Cleaned `out/` and `.next/` using PowerShell `Remove-Item`.
- Rebuilt using **webpack** via `npm run build`.
- Deployed hosting via `npx firebase deploy --only hosting`.

Result:
- Website console errors disappeared after the webpack build deploy.

### B) Firestore tracking still not resuming (current problem)
Even after website console errors were gone:
- New docs still did NOT appear in:
  - `users/{uid}/appliedJobs`
  - `users/{uid}/autofills`
  - `users/{uid}/customAnswers`

Also noted:
- User reported “there’s nothing in the extension service worker’s console”, suggesting we may not be attached to the right worker console, or the SW isn’t running/receiving events.

## Current hypothesis (most likely)
The extension is not writing to Firestore because the MV3 service worker does not have a valid auth state:
- In `src/vue_src/sw/firebaseSync.ts`, tracking functions bail out early when not authed:
  - `if (!authState) return;`

So the most likely root causes are:
1) Extension is not signed in / not receiving a Firebase ID token update.
2) The MV3 service worker is not running, not receiving the `FIREBASE_AUTH_UPDATE` message, or not persisting auth.
3) Writes are attempted but failing (401/403) and errors are not visible due to not viewing the correct SW console.

## Relevant code pointers
- MV3 SW entry: `src/vue_src/sw/background.ts`
- Firebase sync + tracking: `src/vue_src/sw/firebaseSync.ts`
  - message handlers: `TRACK_APPLIED_JOB`, `TRACK_CUSTOM_ANSWER`, `LIST_MODE_AUTOFILL_RESULT`
  - tracking fns: `trackAppliedJob`, `trackAutofill`, `trackCustomAnswer`

## Key lesson learned
For this website repo (Next 16 static export), do NOT use `npx next build` (Turbopack) for production hosting exports.
Use `npm run build` which forces `next build --webpack`.

---

## Next steps (to run now)
See assistant’s troubleshooting plan after this doc.
