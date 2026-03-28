OpenClaw Execution PlanZero‑Hallucination Job Matching, Firestore Persistence, and Applied‑Job Filtering

Purpose: revise the Gemini-driven job search flow so the system never invents job links, only returns recommendations backed by direct posting/application URLs, and stores validated results in Firestore for later retrieval without repeat AI calls.

1. What OpenClaw must change immediately

- Stop using Gemini as the system that discovers or fabricates job links. Gemini may rank, summarize, and prune; it may not originate live URLs.

- Change the recommendation quota from a forced 10–15 results to ‘up to 15 validated results.’ Returning fewer results is correct if confidence is not high.

- Treat a recommendation as valid only when the pipeline has a direct posting/application URL that has already been retrieved and validated outside the model.

- Persist every validated search result to Firestore so later sessions can load prior results without spending another AI call.

- Add an explicit applied flag. A result with applied=true must be excluded from future visible recommendation lists by default.

2. Required architecture

- Stage A — retrieval: OpenClaw gathers candidate jobs from trusted sources and captures the exact direct URL returned by that source.

- Stage B — validation: OpenClaw opens or checks each candidate URL and confirms it is a direct posting or application page for the exact job.

- Stage C — model ranking: Gemini receives only the already validated candidate list. It can score and explain matches, but it is forbidden from inventing or modifying links.

- Stage D — persistence: the extension writes the validated results and the search run metadata into Firestore.

- Stage E — reuse: the website and extension first query Firestore for non-applied cached results before any new AI request is made.

3. Firestore storage model for cached job search results

- Store job search runs separately from individual result records. A run is the search event; a result record is a reusable job posting candidate.

- Always persist applied=false at creation time so the UI can filter with a clean equality query.

- Deduplicate results using a normalized dedupe key such as hash(company|title|location|directUrl).

- Persist the validated direct URL, the validation status, the source run id, and timestamps such as firstSeenAt and lastValidatedAt.

- Never store unvalidated results in the main active result list. If you want diagnostics, store rejects in a separate rejected/ subcollection or log array.

Recommended Firestore schema

users/{uid}/jobSearchRuns/{runId}

{

runId,

desiredLocation,

queryFingerprint,

profileFingerprint,

modelName,

temperature,

createdAt,

completedAt,

totalCandidatesSeen,

totalValidated,

totalRejected,

totalStored

}

users/{uid}/jobSearchResults/{resultId}

{

resultId,

runId,

dedupeKey,

title,

company,

location,

salary,

whyMatch,

directUrl,

directUrlLabel,

linkDomain,

sourceSystem,

confidenceScore,

validationStatus: "validated",

applied: false,

appliedAt: null,

hidden: false,

stale: false,

firstSeenAt,

lastSeenAt,

lastValidatedAt,

createdAt,

updatedAt

}

4. Query rules for the website and extension

- Default read path: query users/{uid}/jobSearchResults where applied == false, hidden == false, validationStatus == 'validated', stale == false.

- Sort by updatedAt or confidenceScore, then secondarily by createdAt descending.

- Only call the AI pipeline when the cache is empty, stale, explicitly refreshed, or the search fingerprint changes materially.

- When a user applies to a job, immediately write applied=true and appliedAt=server timestamp. The result must disappear from the active list on the next listener update.

- If a direct job URL later fails validation, mark stale=true or validationStatus='invalid' and hide it from the visible list.

visibleResults = jobSearchResults

.where("applied", "==", false)

.where("hidden", "==", false)

.where("validationStatus", "==", "validated")

.where("stale", "==", false)

5. Stronger autosave and verification system

- The current issue — text typed in the extension UI not appearing in Firestore or the website — means autosave cannot be a fire-and-forget timer only. It must become a save-plus-verify workflow.

- Every important write should have three states: queued, persisted, and verified.

- After each batch save, OpenClaw or the extension must re-read the saved Firestore document or rely on the snapshot callback and compare the echoed server data against the local payload.

- If the echo does not match within the allowed window, flag the write as unverified and retry with backoff.

- Coalesce pending writes by logical section so old snapshots cannot overwrite newer edits after offline recovery.

1. Keep a section-level dirty map: profile, resumeDetails, tailoredResume, uploads, jobSearchResults, settings.

2. When the user edits a field, update local state immediately and mark only that section dirty.

3. Start a short debounce timer; do not wait 30 seconds for critical profile text fields. Use a short autosave window for text entry and a longer window only for expensive operations.

4. Build a section-scoped payload instead of rewriting large top-level objects when only one child changed.

5. Write the payload to Firestore.

6. Store a local save token or hash for the attempted write.

7. Listen for the matching Firestore echo. If the returned section hash matches, mark the write verified.

8. If no verified echo arrives within the timeout, retry and surface a visible 'Sync delayed' indicator.

9. On service worker restart, flush only the latest pending payload per document path and section.

6. OpenClaw agent operating instructions

Copy/paste OpenClaw operating prompt

Mission:

Produce job recommendations with zero hallucinated links, persist validated results to Firestore, and ensure applied jobs no longer appear in active recommendation lists.

Non-negotiable rules:

- You may not invent, infer, reconstruct, or autocomplete job URLs.

- You may not output a recommendation unless a direct job posting or direct application URL has already been retrieved and validated.

- You may return fewer results than requested. Quality beats count.

- You must save validated search results to Firestore so future sessions can reuse them without another AI API call.

- Every saved job result must include applied=false at creation time.

- If a result is later marked applied=true, it must be excluded from future visible result lists.

Execution algorithm:

1. Read the user profile, resume details, desired location, and prior cached job results from Firestore.

2. Query Firestore first for active cached results that match the current search fingerprint.

3. If enough active cached results exist, return them and do not call Gemini.

4. If cache is missing, stale, or insufficient, gather fresh candidate jobs from trusted sources.

5. For each candidate, keep the exact retrieved direct URL. Do not modify it.

6. Validate each candidate URL by checking that it points to the exact posting/application page rather than a search page or generic careers page.

7. Reject any candidate whose URL is uncertain, generic, mismatched, or missing.

8. Send only the validated candidate set to Gemini for ranking and why-match generation.

9. Reject any Gemini output whose URL is not an exact match to one of the validated input candidates.

10. Persist the accepted results to Firestore with validationStatus='validated', applied=false, and timestamps.

11. Return only the active results where applied=false and validationStatus='validated'.

Persistence rules:

- Write a search run record and individual result records.

- Deduplicate by company + title + location + directUrl.

- Upsert existing results by dedupeKey.

- Update lastSeenAt and lastValidatedAt on repeat sightings.

- Mark stale results as stale=true instead of deleting immediately.

Visibility rules:

- Default visible list filters: applied=false, hidden=false, validationStatus='validated', stale=false.

- Applied jobs must not appear in the default active list.

Sync rules:

- After every write, verify that Firestore now contains the same value you attempted to save.

- If verification fails, retry with backoff and mark the write unverified until confirmed.

7. Revised Gemini prompt for the ranking stage only

- This prompt is safe only if Gemini receives a prevalidated candidate list. Do not use this prompt as a discovery engine for live URLs.

Return ONLY valid JSON with this exact structure:

{

"version": "0.2",

"generated_at": "[ISO timestamp]",

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

[prevalidated candidate array with exact direct URLs only]

Desired location:

[your input or "(none)"]

Profile:

[full JSON of profile fields]

Resume details:

[full JSON of Resume_details]

8. Runtime settings and safeguards

- The main reliability improvement is pipeline design, not a magic temperature value. If you keep the same model, use it as a ranker over validated inputs only.

- Lowering temperature can reduce variability, but it still does not guarantee truthful links. Treat temperature tuning as secondary.

- If you test a deeper reasoning model, keep the same non-negotiable rule: it may rank only from validated candidates and may not originate URLs.

- Add a hard post-model validator in code. If a returned URL is not an exact member of the validated candidate set, reject that recommendation.

- Add a minimum recommendation count of zero, not ten. An empty list is preferable to fabricated links.

- recommendation.links[0].url must equal one of the exact validated input URLs

- hostname/path must still parse as a specific posting/application page

- company/title/location must match the validated candidate record

- if any check fails, drop the recommendation

9. Firestore write rules for future reuse without extra AI cost

1. Before calling Gemini, check Firestore for cached active results for the same or substantially similar search fingerprint.

2. Only call Gemini when the cache is empty, stale, explicitly refreshed, or too small to satisfy the requested result window.

3. After every successful search run, write the normalized results to Firestore immediately.

4. When the website loads the recommendation page, it should first subscribe to Firestore results instead of asking the model again.

5. When a job is applied to, write applied=true and appliedAt immediately from the extension or website, then remove it from the active UI list via the listener/filter.

6. Optionally maintain a separate appliedJobs collection or mirror for audit history, but keep the visible recommendation list filtered from jobSearchResults.

10. Acceptance criteria

- No recommendation is returned with a guessed or reconstructed link.

- Gemini output URLs always exactly match a prevalidated candidate URL supplied to the model.

- Validated search results are written to Firestore and can be retrieved later without another AI call.

- A job marked applied=true disappears from the default recommendation list on both the extension and the website.

- Autosave writes are verified by read-back or snapshot echo, so typed UI content is not silently lost.

- Offline or queued writes are coalesced so older snapshots cannot overwrite newer user edits.

11. First implementation order for OpenClaw

1. Refactor the current prompt flow so Gemini receives only VALIDATED_CANDIDATES.

2. Implement exact-URL validation and a strict post-model URL membership check.

3. Add Firestore jobSearchRuns and jobSearchResults persistence.

4. Add applied=false default and applied=true filtering.

5. Change the website and extension to read cached Firestore results first.

6. Upgrade autosave from timer-only to write-plus-verify with section-level dirty tracking.

7. Add telemetry for rejected links, cache hits, cache misses, and unverified writes.