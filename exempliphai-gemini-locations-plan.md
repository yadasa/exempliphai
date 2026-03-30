# Exempliphai — Gemini locations + proxy & billing plan (extension-side)

**Date:** 2026-03-30

## Scope / how this was scanned

Extension-side only (per request):

- `src/public/contentScripts/`
- `src/vue_src/`
- `dist/contentScripts/`
- popup/background build artifacts under `dist/` (not website / LandingPage)

Search patterns used (grep): `gemini|generativelanguage|generateContent|GEMINI|geminiTailor|mapFieldsToFillPlan|generateNarrativeAnswer|generateTier1`

---

## 1) All Gemini handling/calls (files / lines / functions)

> Notes:
> - `dist/contentScripts/*` is **byte-identical** to `src/public/contentScripts/*` in this repo at time of scan (`diff -q` shows no differences). Line numbers match.
> - The popup UI is compiled into `dist/assets/index-*.js` and contains Gemini calls corresponding to the Vue sources.

### A. Content script provider: direct Gemini REST calls

#### `src/public/contentScripts/providers/gemini.js`

**Key constants / endpoint:**
- `GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'` (line **56**)
- Default models (line **48** etc.):
  - `GEMINI_DEFAULT_MODEL = 'gemini-3-flash-preview'`
  - `GEMINI_TAILOR_MODEL = 'gemini-3-pro-preview'`

**Direct network call:** `geminiGenerateContent(...)` (starts line **245**)

```js
245	async function geminiGenerateContent({
246	  apiKey,
247	  model,
248	  systemPrompt,
249	  userPrompt,
250	  timeoutMs,
251	  responseMimeType,
252	  temperature = 0.2,
253	}) {
254	  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
...
263	    const res = await fetch(url, {
264	      method: 'POST',
265	      headers: { 'Content-Type': 'application/json' },
266	      signal: controller.signal,
267	      body: JSON.stringify({
268	        contents: [
269	          {
270	            role: 'user',
271	            parts: [{ text: combined }],
272	          },
273	        ],
274	        generationConfig: {
275	          temperature,
276	          ...(responseMimeType ? { responseMimeType } : {}),
277	        },
278	      }),
279	    });
...
299	    return { raw: json, text };
300	  } finally {
301	    cancel();
302	  }
303	}
```

**Gemini-dependent provider methods:**
- `createGeminiProvider(cfg)` (line **327**)
  - `mapFieldsToFillPlan(args)` → calls `geminiGenerateContent(...)` (line **336**)
  - `generateNarrativeAnswer(args)` → calls `geminiGenerateContent(...)` (line **366**)
- Convenience exports:
  - `mapFieldsToFillPlan(args)` (line **392**)
  - `generateNarrativeAnswer(args)` (line **402**)

**Global exposure used by other scripts:**
- `globalThis.__exempliphaiProviders.gemini = { ... }` (line **415**)

#### `dist/contentScripts/providers/gemini.js`

Same code + same line numbers as `src/public/contentScripts/providers/gemini.js`.

---

### B. Content script: direct Gemini calls in `autofill.js`

#### `src/public/contentScripts/autofill.js`

##### B1) Right-click “AI Answer” (Tier-2-ish) — direct fetch

Function: **`callGemini(parts, { temperature })`** (defined around line **676**)

```js
676	    const callGemini = async (parts, { temperature = 0.2 } = {}) => {
677	      const response = await fetch(
678	        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
679	        {
680	          method: 'POST',
681	          headers: { 'Content-Type': 'application/json' },
682	          body: JSON.stringify({
683	            contents: [{ parts }],
684	            generationConfig: { temperature: Number.isFinite(temperature) ? temperature : 0.2 },
685	          }),
686	        }
687	      );
...
694	      const candidate = json?.candidates?.[0];
695	      const answerText = candidate?.content?.parts?.[0]?.text;
696	      if (!answerText) throw new Error('AI response missing text');
...
698	      // Best-effort token/cost logging (Gemini returns usageMetadata for many models/tiers)
699	      try {
700	        const usage = json?.usageMetadata || json?.usage || {};
701	        const tokensIn = Number(
702	          usage.promptTokenCount ?? usage.prompt_tokens ?? usage.inputTokenCount ?? usage.input_tokens ?? 0
703	        );
704	        const tokensOut = Number(
705	          usage.candidatesTokenCount ??
706	            usage.candidates_tokens ??
707	            usage.outputTokenCount ??
708	            usage.output_tokens ??
709	            usage.completionTokenCount ??
710	            0
711	        );
...
721	        await _saAppendAiUsageLog(entry);
722	      } catch (_) {}
723	
724	      return String(answerText).trim();
725	    };
```

Also related Gemini “handling” in this file:
- Local-only usage logging + cost estimate constants:
  - `_SA_GEMINI_15_FLASH_USD_PER_1M_INPUT` (line **70**)
  - `_SA_GEMINI_15_FLASH_USD_PER_1M_OUTPUT` (line **71**)
  - `_saEstimateGemini15FlashCostCents(tokensIn, tokensOut)` (line **73**)
  - `_saAppendAiUsageLog(entry)` (line **92**)

##### B2) Auto-tailor resume before autofill — direct fetch (includes PDF inline_data)

Function: **`_saMaybeAutoTailorBeforeAutofill({ source })`**

Direct Gemini call block (around lines **1677–1712**):

```js
1677	    const prompt = `You are an expert resume writer.\n\nRewrite the attached resume PDF ...`;
1679	    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${encodeURIComponent(apiKey)}`;
1681	    const res = await fetch(url, {
1682	      method: 'POST',
1683	      headers: { 'Content-Type': 'application/json' },
1684	      body: JSON.stringify({
1685	        contents: [
1686	          {
1687	            role: 'user',
1688	            parts: [
1689	              { text: prompt },
1690	              { inline_data: { data: resumeB64, mime_type: 'application/pdf' } },
1691	            ],
1692	          },
1693	        ],
1694	        generationConfig: { temperature: 1.0, responseMimeType: 'application/json' },
1695	      }),
1696	    });
...
1704	    const outText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
1705	    if (!outText) throw new Error('Gemini response missing text');
...
1711	    const out = JSON.parse(jsonText);
1712	    const tailored = String(out?.tailored_resume_text || '').trim();
```

##### B3) Hybrid AI mapping + dropdown picking — uses the Gemini provider (indirect)

- `ensureAiDepsLoaded()` dynamically imports:
  - `contentScripts/providers/gemini.js` (line **4228**) which contains direct Gemini REST fetches

```js
4205	async function ensureAiDepsLoaded() {
...
4227	  try {
4228	    await import(chrome.runtime.getURL('contentScripts/providers/gemini.js'));
4229	  } catch (e) {
4230	    console.warn('SmartApply: Failed to load gemini provider', e);
4231	    return false;
4232	  }
```

- Dropdown option picking calls the provider’s Tier-2 method:
  - `_saAiPickBestDropdownOptionText(...)` → `provider.generateNarrativeAnswer(...)` (line **4305**)

```js
4289	    const provider = globalThis.__exempliphaiProviders?.gemini;
4290	    if (!provider?.generateNarrativeAnswer) return null;
...
4304	    const text = await _saEnqueueAiDropdownTask(() =>
4305	      provider.generateNarrativeAnswer({
4306	        apiKey,
4307	        questionText: prompt,
4308	        maxWords: 20,
4309	        tone: 'direct',
4310	        model,
4311	        timeoutMs,
4312	        maxRetries: 1,
4313	      })
4314	    );
```

- Tier-1 mapping entry from this file:
  - `tryHybridAiMapping(...)` → `aiFillPlan.generateTier1(...)` (line **4534**)

```js
4534	  const tier1 = await aiFillPlan.generateTier1(
4535	    {
4536	      domain,
4537	      page_url: pageUrl,
4538	      snapshot_hash: `sha256:${now.toString(36)}`,
4539	      unresolved_fields,
4540	    },
4541	    allowedProfileKeys,
4542	    { apiKey, allowAiMapping: true, timeoutMs: 20000, outerRetries: 1 }
4543	  );
```

#### `dist/contentScripts/autofill.js`

Same code + same line numbers as `src/public/contentScripts/autofill.js`.

---

### C. Content script: Tier-1 orchestrator (Gemini provider plumbing)

#### `src/public/contentScripts/aiFillPlan.js`

This file does **not** call Gemini directly, but it is a key integration point:

- `mapUnresolvedFieldsToFillPlan(args)` (line **57**) enforces `apiKey` for `providerName === 'gemini'` (line **80**) and calls:
  - `provider.mapFieldsToFillPlan(...)` (line **93**)

```js
57	  global.mapUnresolvedFieldsToFillPlan = async function mapUnresolvedFieldsToFillPlan(args) {
...
79	      if (providerName === 'gemini') {
80	        if (!args?.apiKey) throw new Error('AI mapping requires Gemini API Key');
...
93	    const planRaw = await provider.mapFieldsToFillPlan({
94	      apiKey: args?.apiKey,
95	      model: args?.model,
...
103	      maxRetries: args?.maxRetries,
104	    });
```

- `generateTier1(snapshot, allowedProfileKeys, consents)` (line **224**) also requires `consents.apiKey` (line **230–233**) and then calls:
  - `provider.mapFieldsToFillPlan(...)` (line **280**)

```js
224	  global.generateTier1 = async function generateTier1(snapshot, allowedProfileKeys, consents = {}) {
...
230	    const apiKey = consents?.apiKey;
231	    if (!apiKey) {
232	      return { ok: false, actions: [], plan: null, error: _err('missing_api_key', 'Missing API key') };
233	    }
...
280	          planRaw = await provider.mapFieldsToFillPlan({
281	            apiKey,
```

#### `dist/contentScripts/aiFillPlan.js`

Same code + same line numbers as `src/public/contentScripts/aiFillPlan.js`.

---

### D. Popup UI (Vue sources): direct Gemini REST calls

#### `src/vue_src/components/InputField.vue`

##### D1) Manual resume tailoring — direct fetch (Gemini Pro) + PDF inline_data (or resume text fallback)

Function: **`tailorResume()`** (starts line **284**)

Direct Gemini call (line **323–357**):

```ts
284	    const tailorResume = async () => {
...
295	        if (!apiKey) throw new Error('Missing Gemini API key. Add it in Settings.');
...
323	        const resp = await fetch(
324	          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
325	          {
326	            method: 'POST',
327	            headers: { 'Content-Type': 'application/json' },
328	            body: JSON.stringify({
329	              contents: [
330	                {
331	                  role: 'user',
332	                  parts: [
333	                    { text: prompt },
334	                    ...(resumeMime === 'application/pdf'
335	                      ? [
336	                          {
337	                            inline_data: {
338	                              data: resumeB64,
339	                              mime_type: 'application/pdf',
340	                            },
341	                          },
342	                        ]
343	                      : [
344	                          {
345	                            text: `\n\n--- RESUME_TEXT_START ---\n${resumeText}\n--- RESUME_TEXT_END ---\n`,
346	                          },
347	                        ]),
348	                  ],
349	                },
350	              ],
351	              generationConfig: {
352	                temperature: 1.0,
353	                responseMimeType: 'application/json',
354	              },
355	            }),
356	          }
357	        );
```

##### D2) Resume parsing (extract profile/skills/experience) — direct fetch (Gemini Flash)

Function: **`parseResumeFromTextWithGemini(apiKey, resumeText)`** (starts line **531**)

Direct Gemini call (line **584–605**):

```ts
531	    const parseResumeFromTextWithGemini = async (apiKey: string, resumeText: string) => {
...
584	      const resp = await fetch(
585	        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
586	        {
587	          method: 'POST',
588	          headers: { 'Content-Type': 'application/json' },
589	          body: JSON.stringify({
590	            contents: [
591	              {
592	                role: 'user',
593	                parts: [
594	                  { text: prompt },
595	                  { text: `\n\n--- RESUME_TEXT_START ---\n${resumeText}\n--- RESUME_TEXT_END ---\n` },
596	                ],
597	              },
598	            ],
599	            generationConfig: {
600	              temperature: 0.2,
601	              responseMimeType: 'application/json',
602	            },
603	          }),
604	        }
605	      );
```

#### `src/vue_src/views/JobSearchView.vue`

Function: **`geminiGenerateJson({ apiKey, promptText })`** (starts line **88**)

Direct Gemini call:

```ts
88	async function geminiGenerateJson({ apiKey, promptText }: { apiKey: string; promptText: string }) {
89	  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${encodeURIComponent(
90	    apiKey
91	  )}`;
92	
93	  const res = await fetch(url, {
94	    method: 'POST',
95	    headers: { 'Content-Type': 'application/json' },
96	    body: JSON.stringify({
97	      contents: [{ role: 'user', parts: [{ text: promptText }] }],
98	      generationConfig: {
99	        temperature: 1.0,
100	        responseMimeType: 'application/json',
101	      },
102	    }),
103	  });
```

Usage site:
- `generateRecommendations()` → `geminiGenerateJson(...)` (line **256**)

---

### E. Popup UI (compiled build artifact): direct Gemini calls

#### `dist/assets/index-C-hVjSEU.js`

This is the compiled/minified output for the popup UI. It contains `fetch("https://generativelanguage.googleapis.com/...:generateContent?key=...")` corresponding to:

- `InputField.vue` tailoring call (Gemini Pro)
- `InputField.vue` resume parsing call (Gemini Flash)
- `JobSearchView.vue` job recommendations call (Gemini Pro)

`grep -n "generativelanguage.googleapis.com" dist/assets/index-C-hVjSEU.js` hits around lines **486**, **493**, **584** (minified context; line numbers will change when rebuilt).

---

## 2) Proxy plan (replace direct Gemini calls with server proxy)

### Goals

- **Remove all client-side Gemini API key handling** (no more `chrome.storage.sync['API Key']` usage for Gemini).
- Route all AI calls through a **single authenticated server endpoint**.
- Server injects the Gemini key, calls Gemini, returns:
  - result payload (text/JSON)
  - **usage** (prompt tokens, completion tokens, total)
  - request id / audit metadata
- Centralize enforcement:
  - rate limits
  - max payload sizes
  - allowed models/actions
  - per-user quotas / billing

### Proposed API shape

**Client → server**

- `POST https://<YOUR_API_HOST>/api/ai/{action}`
- Query string `?uid=` is optional for debugging; **server must ignore it** and use the uid from the verified auth token.
- Headers:
  - `Authorization: Bearer <FirebaseIdToken>`
  - `Content-Type: application/json`

Example request body (generic):

```json
{
  "model": "gemini-3-pro-preview",
  "input": {
    "system": "...",
    "user": "...",
    "contents": [{"role":"user","parts":[{"text":"..."}]}]
  },
  "client": {
    "source": "contentScript|popup",
    "version": "1.0.0"
  }
}
```

**Server → client**

```json
{
  "ok": true,
  "action": "generateNarrativeAnswer",
  "requestId": "ai_...",
  "result": {
    "text": "...",
    "json": null,
    "raw": null
  },
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 456,
    "total_tokens": 579
  },
  "provider": {
    "name": "gemini",
    "model": "gemini-3-pro-preview"
  }
}
```

### Action map (what to proxy)

Replace every direct `fetch("https://generativelanguage.googleapis.com/...:generateContent?key=...")` with one of:

- `action = mapFieldsToFillPlan` (Tier-1)
  - Used by `src/public/contentScripts/providers/gemini.js` via `provider.mapFieldsToFillPlan(...)`
  - Used indirectly by `aiFillPlan.generateTier1(...)`
- `action = generateNarrativeAnswer` (Tier-2)
  - Used by `src/public/contentScripts/providers/gemini.js`
  - Used indirectly by dropdown picking `_saAiPickBestDropdownOptionText(...)`
- `action = aiAnswer` (right-click “AI Answer” block currently in `autofill.js`)
  - Or rewrite that flow to use `generateNarrativeAnswer` with your existing provider interface
- `action = resumeTailor`
  - Used by `InputField.vue` tailorResume + `autofill.js` auto-tailor
  - Prefer sending **resume extracted text** + job description instead of raw PDF to keep requests small
- `action = resumeParse`
  - Used by `parseResumeFromTextWithGemini(...)`
- `action = jobRecs`
  - Used by `JobSearchView.vue`

### Security requirements

1. **Authentication**
   - Verify Firebase ID token server-side (`admin.auth().verifyIdToken(...)`).
   - Derive uid from token; do not trust `uid` query param.

2. **Rate limiting**
   - Per-uid: e.g. requests/min + tokens/day.
   - Per-IP fallback.

3. **Payload validation**
   - Enforce max input size (prompt text, JSON, resume text).
   - Enforce allowed `action` set.
   - Enforce allowed `model` set (don’t allow arbitrary models).

4. **Logging / audit**
   - Log: uid, action, model, timestamp, token usage, latency, status.
   - Never log full resume content; keep hashes/lengths.

5. **Client endpoint “obfuscation”**
   - Endpoint rotation / env-based host selection is fine, but treat it as **defense-in-depth only**.
   - Real security = server auth + quotas.

### Where to implement client networking (recommended)

To avoid CORS/host_permission complexity and to centralize auth, route AI proxy calls through the **MV3 service worker** (background):

- Popup + content scripts call: `chrome.runtime.sendMessage({ action: 'AI_PROXY', aiAction: '...', payload: {...} })`
- Background (`src/vue_src/sw/firebaseSync.ts` already has `authedFetch(...)`) performs:
  - `fetch('https://<YOUR_API_HOST>/api/ai/...', {Authorization: Bearer <idToken>})`
  - returns response to sender

This leverages the existing Firebase auth state (`chrome.storage.local.firebaseAuth`) and avoids exposing tokens to content scripts.

---

## 3) Billing plan (prepaid ExempliPhai tokens via Stripe)

### Overview

- **Prepay:** Users buy **ExempliPhai tokens** via Stripe.
  - **Exchange rate:** **$1 = 333 tokens**
  - Store balance in Firestore: `users/{uid}/exempliphai_balance.tokens`
- **Usage deduction:** Every proxied Gemini call returns usage; the server computes USD cost, applies markup, then deducts tokens **atomically**.
- **Low balance halt (client):** if `balance < 30`, disable AI actions and show: `Low balance (X tokens)—top up via Stripe`.

### Firestore schema

**Balance doc (authoritative):** `users/{uid}/exempliphai_balance`

```json
{
  "tokens": 3330,
  "updatedAt": "<server timestamp>",
  "lifetimePurchasedTokens": 9990,
  "lifetimeDeductedTokens": 6660
}
```

Notes:
- Only `tokens` is required by this plan; the lifetime fields are optional but useful for audits.
- Writes to balances should be server-only (Stripe webhook + AI proxy), with client read access for display.

### Usage → USD cost → token deduction

#### Step-by-step (server authoritative)

1. Proxy calls Gemini; Gemini responds with `{ result, usage: { prompt_tokens, completion_tokens } }`.
2. Compute **your** (provider) USD cost:

   ```text
   your_usd = (prompt_tokens / 1_000_000) * input_usd_per_1m
           + (completion_tokens / 1_000_000) * output_usd_per_1m
   ```

   Example rates (Gemini Pro-style pricing):
   - `input_usd_per_1m = 3.50`
   - `output_usd_per_1m = 10.50`

3. Apply markup:

   ```text
   bill_usd = your_usd * 3.33
   ```

4. Convert to ExempliPhai tokens and round up:

   ```text
   deduct_tokens = ceil(bill_usd * 333)
   ```

5. Firestore **transaction** (atomic):
   - Read `users/{uid}/exempliphai_balance.tokens`
   - If `balance < deduct_tokens`, reject the call
   - Else `balance -= deduct_tokens`

6. Respond to client:

```json
{
  "result": { "text": "..." },
  "usage": { "prompt_tokens": 123, "completion_tokens": 456 },
  "deducted_tokens": 41,
  "new_balance": 3289
}
```

Important implementation note:
- To avoid paying Gemini for requests that will later be rejected due to insufficient funds, you typically also do a **pre-check** (e.g., require a minimum balance and/or require balance ≥ worst-case max for that action based on server-enforced output limits). The required behavior above (reject if balance < deduct) should still be enforced in the transaction.

### Stripe “Top Up” (token packs)

- Packs (examples):
  - **$5 = 1,665 tokens**
  - **$10 = 3,330 tokens**
  - **$20 = 6,660 tokens**

Recommended approach:
- Use fixed Stripe Prices for each pack.
- Put the token credit amount in `price.metadata.tokens` (or in Checkout Session metadata) so the webhook can credit an exact integer token amount (no rounding).
- Webhook credits Firestore `users/{uid}/exempliphai_balance.tokens += packTokens` (transaction) and stores the Stripe event/session id for idempotency.

### Client UX

- Add a popup dashboard panel:
  - Token balance gauge
  - “Top Up” button → Stripe Checkout
- After every AI proxy response, update local UI state with `new_balance`.
- **Low balance halt:**
  - `if (balance < 30) { disableAiButtons(); notify("Low balance (X tokens)—top up via Stripe"); }`

---

## Code stubs (server proxy + client usage)

> These are **stubs / examples** to illustrate the intended integration. They are not wired into the extension build yet.

### Server stub: AI proxy with prepaid deduction (Firebase HTTPS / Express-style)

```ts
// functions/src/aiProxy.ts (example)
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

const TOKENS_PER_USD = 333;
const MARKUP = 3.33;

// Example rates (Gemini Pro-style). Keep these in config per model.
const USD_PER_1M_INPUT = 3.50;
const USD_PER_1M_OUTPUT = 10.50;

function requireAuth(req: functions.https.Request) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new functions.https.HttpsError('unauthenticated', 'Missing Authorization bearer token');
  return m[1];
}

function extractUsageTokens(geminiJson: any): { prompt_tokens: number; completion_tokens: number } {
  const usage = geminiJson?.usageMetadata || geminiJson?.usage || {};
  const prompt_tokens = Number(
    usage.promptTokenCount ?? usage.prompt_tokens ?? usage.inputTokenCount ?? usage.input_tokens ?? 0
  );
  const completion_tokens = Number(
    usage.candidatesTokenCount ??
      usage.candidates_tokens ??
      usage.outputTokenCount ??
      usage.output_tokens ??
      usage.completionTokenCount ??
      0
  );
  return { prompt_tokens, completion_tokens };
}

function calcProviderUsd({ prompt_tokens, completion_tokens }: { prompt_tokens: number; completion_tokens: number }) {
  return (prompt_tokens / 1_000_000) * USD_PER_1M_INPUT + (completion_tokens / 1_000_000) * USD_PER_1M_OUTPUT;
}

export const aiProxy = functions.https.onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }

    const idToken = requireAuth(req);
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const { model, input } = (req.body || {}) as any;

    const geminiApiKey = process.env.GEMINI_API_KEY; // set via functions config / secrets
    if (!geminiApiKey) throw new Error('missing_gemini_api_key');

    // OPTIONAL pre-check: block obviously-low balances before calling Gemini.
    // (Still enforce the post-call transaction check below.)
    const balanceRef = admin.firestore().doc(`users/${uid}/exempliphai_balance`);
    const balanceSnap = await balanceRef.get();
    const currentBalance = Number(balanceSnap.exists ? balanceSnap.get('tokens') : 0);
    if (!Number.isFinite(currentBalance) || currentBalance < 30) {
      res.status(402).json({ ok: false, error: 'low_balance', balance: currentBalance });
      return;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model || 'gemini-3-pro-preview'
    )}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const json = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok || (json as any)?.error) {
      res.status(502).json({ ok: false, error: (json as any)?.error?.message || `Gemini HTTP ${geminiRes.status}` });
      return;
    }

    const { prompt_tokens, completion_tokens } = extractUsageTokens(json);

    const your_usd = calcProviderUsd({ prompt_tokens, completion_tokens });
    const bill_usd = your_usd * MARKUP;
    const deduct_tokens = Math.ceil(bill_usd * TOKENS_PER_USD);

    // Atomic deduct (authoritative): reject if insufficient.
    const new_balance = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(balanceRef);
      const bal = Number(snap.exists ? snap.get('tokens') : 0);
      if (!Number.isFinite(bal) || bal < deduct_tokens) {
        throw new functions.https.HttpsError('resource-exhausted', 'Insufficient token balance');
      }
      const next = bal - deduct_tokens;
      tx.set(
        balanceRef,
        {
          tokens: next,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lifetimeDeductedTokens: admin.firestore.FieldValue.increment(deduct_tokens),
        },
        { merge: true }
      );
      return next;
    });

    const text = (json as any)?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({
      ok: true,
      result: { text },
      usage: { prompt_tokens, completion_tokens },
      deducted_tokens: deduct_tokens,
      new_balance,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    res.status(500).json({ ok: false, error: msg });
  }
});
```

### Server stub: Stripe Checkout + webhook credit

```ts
// functions/src/stripeTopup.ts (example)
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

admin.initializeApp();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

// 1) Create Checkout session (called by extension server-side, after verifying Firebase auth)
export const createTopupCheckout = functions.https.onRequest(async (req, res) => {
  // TODO: verify Firebase ID token → uid (same as aiProxy)
  const uid = '...';

  const { priceId, successUrl, cancelUrl } = (req.body || {}) as any;

  // Never trust client-supplied token amounts; map priceId → token credit server-side.
  const PACK_TOKENS_BY_PRICE: Record<string, number> = {
    // 'price_5usd': 1665,
    // 'price_10usd': 3330,
    // 'price_20usd': 6660,
  };
  const packTokens = Number(PACK_TOKENS_BY_PRICE[String(priceId)] || 0);
  if (!Number.isFinite(packTokens) || packTokens <= 0) {
    res.status(400).json({ ok: false, error: 'invalid_price' });
    return;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { uid, tokens: String(packTokens) },
  });

  res.json({ ok: true, url: session.url, packTokens });
});

// 2) Webhook: credit tokens on checkout.session.completed
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = String(req.headers['stripe-signature'] || '');
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let evt: Stripe.Event;
  try {
    evt = stripe.webhooks.constructEvent(req.rawBody, sig, whSecret);
  } catch (err: any) {
    res.status(400).send(`Webhook signature verification failed: ${String(err?.message || err)}`);
    return;
  }

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data.object as Stripe.Checkout.Session;
    const uid = String(session.metadata?.uid || '');
    if (!uid) {
      res.status(200).json({ ok: true });
      return;
    }

    // Prefer getting the exact token credit from metadata.
    // Alternative: read the Stripe Price metadata via line items.
    const packTokens = Number(session.metadata?.tokens || 0);

    if (Number.isFinite(packTokens) && packTokens > 0) {
      const ref = admin.firestore().doc(`users/${uid}/exempliphai_balance`);
      await admin.firestore().runTransaction(async (tx) => {
        tx.set(
          ref,
          {
            tokens: admin.firestore.FieldValue.increment(packTokens),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lifetimePurchasedTokens: admin.firestore.FieldValue.increment(packTokens),
          },
          { merge: true }
        );
      });
    }
  }

  res.status(200).json({ ok: true });
});
```

### Client stub: calling the AI proxy (MV3 background)

```ts
// In the MV3 service worker (background).
// Reuse your existing authedFetch(...) which sends Authorization: Bearer <FirebaseIdToken>.
export async function callAiProxy(aiAction: string, payload: any) {
  const res = await authedFetch(`https://<YOUR_API_HOST>/api/ai/${encodeURIComponent(aiAction)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) throw new Error(json?.error || `AI proxy HTTP ${res.status}`);

  return json as {
    result: any;
    usage: { prompt_tokens: number; completion_tokens: number };
    deducted_tokens: number;
    new_balance: number;
  };
}
```

### Client stub: start Stripe Top Up (popup → server → Stripe Checkout)

```ts
export async function startTopupCheckout(priceId: string) {
  const res = await authedFetch(`https://<YOUR_API_HOST>/api/billing/topup/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      priceId,
      successUrl: 'https://<YOUR_APP>/topup/success',
      cancelUrl: 'https://<YOUR_APP>/topup/cancel',
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false || !json?.url) throw new Error(json?.error || 'missing_checkout_url');

  // In extension UI:
  chrome.tabs.create({ url: String(json.url) });
}
```

### Client stub: low-balance gate

```ts
function applyBalanceGate(balance: number) {
  if (balance < 30) {
    // disable AI buttons & show banner/toast
    // "Low balance (X tokens)—top up via Stripe"
  }
}

// After every AI proxy call:
// const { new_balance } = await callAiProxy(...)
// applyBalanceGate(new_balance)
```

---

## 4) Migration / tests

### Migration

- Create `users/{uid}/exempliphai_balance` docs for existing users.
- If you have a legacy balance field (e.g., `users/{uid}/billing/current.tokenBalance`), migrate it once:
  - Copy → `users/{uid}/exempliphai_balance.tokens`
  - Keep the legacy field read-only during a transition window (optional), then remove.
- Ensure all AI calls are routed through the proxy before enabling billing enforcement.

### Tests / checks

- Unit tests:
  - `calcProviderUsd()` and `deduct_tokens = ceil(bill_usd * 333)` rounding behavior.
  - Edge cases: zero usage, missing usage metadata, very small charges.
- Integration tests:
  - Firestore transaction correctness under concurrency (no negative balances).
  - Insufficient balance returns a clear error and does not change balances.
- Stripe tests:
  - Webhook idempotency (same event delivered twice does not double-credit).
  - Pack token credit matches configured metadata.

### Git notes

- This plan does **not** modify runtime code yet; it documents all current Gemini call sites and the intended proxy/billing migration path.
