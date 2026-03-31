"use strict";

const admin = require("firebase-admin");
const {
  onCall,
  onRequest,
  HttpsError,
} = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");

// Initialize Admin
try {
  admin.initializeApp();
} catch {
  // ignore if already initialized
}

const db = admin.firestore();

const REGION = process.env.FUNCTION_REGION || "us-central1";

const REFERRAL = {
  CODE_LEN: 8,
  SIGNUP_POINTS: 100,
  PAID_CONVERSION_BONUS_POINTS: 500,
};

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function randomCode(len) {
  // URL-friendly, case-insensitive.
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // avoid 0O1I
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function maskName(name) {
  const n = String(name || "").trim();
  if (!n) return "—";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const p = parts[0];
    return p.length <= 2 ? `${p[0] || ""}*` : `${p[0]}***`;
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first[0] || ""}*** ${last[0] || ""}***`;
}

function maskPhone(phone) {
  const p = String(phone || "");
  const digits = p.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

function pickMaskedIdentity({ displayName, phoneNumber }) {
  if (isNonEmptyString(displayName)) return maskName(displayName);
  if (isNonEmptyString(phoneNumber)) return maskPhone(phoneNumber);
  return "—";
}

async function resolveReferrerUidByCode(code) {
  const snap = await db.doc(`referralCodes/${code}`).get();
  if (!snap.exists) return null;
  const uid = snap.get("uid");
  return isNonEmptyString(uid) ? uid : null;
}

// Mint a Firebase custom token for the currently signed-in user.
// Intended for bridging website auth → extension auth (optional).
exports.mintCustomToken = onCall({ region: REGION, cors: true }, async (req) => {
  const auth = req.auth;
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const token = await admin.auth().createCustomToken(auth.uid);
  return { token };
});

exports.getOrCreateReferralCode = onCall({ region: REGION, cors: true }, async (req) => {
  const auth = req.auth;
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const uid = auth.uid;
  const userRef = db.doc(`users/${uid}`);

  // Fast path
  const userSnap = await userRef.get();
  const existing = userSnap.get("referral.code");
  if (isNonEmptyString(existing)) {
    return { code: existing };
  }

  // Transaction: create a unique code and bind it.
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const already = snap.get("referral.code");
    if (isNonEmptyString(already)) return { code: already, created: false };

    // Try a few times to avoid collisions.
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = randomCode(REFERRAL.CODE_LEN);
      const codeRef = db.doc(`referralCodes/${code}`);
      const codeSnap = await tx.get(codeRef);
      if (codeSnap.exists) continue;

      tx.set(codeRef, {
        uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(
        userRef,
        {
          referral: {
            code,
            pointsEarned: admin.firestore.FieldValue.increment(0),
            referralsCount: admin.firestore.FieldValue.increment(0),
            paidConversionBonusEarned: admin.firestore.FieldValue.increment(0),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { code, created: true };
    }

    throw new HttpsError(
      "resource-exhausted",
      "Could not allocate a referral code. Please try again.",
    );
  });

  return { code: result.code };
});

// Public endpoint called by /r/[code] route.
// Creates an attribution record and returns { attributionId }.
exports.createAttribution = onRequest({ region: REGION }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    const code = String(req.query.code || req.body?.code || "")
      .trim()
      .toUpperCase();

    if (!isNonEmptyString(code)) {
      return res.status(400).json({ error: "missing_code" });
    }

    // Don't validate existence here (avoid enumeration differences).
    const ref = db.collection("referralAttributions").doc();
    await ref.set({
      code,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      userAgent: String(req.get("user-agent") || ""),
      // For anti-abuse you can add: ipHash, session fingerprint, etc.
      applied: false,
    });

    return res.json({ attributionId: ref.id });
  } catch (e) {
    logger.error("createAttribution failed", e);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * AI Proxy + prepaid token billing (ExempliPhai).
 *
 * IMPORTANT:
 * - No client-side Gemini keys.
 * - All AI calls come here with Firebase ID token.
 * - Server forwards to Gemini with GEMINI_API_KEY.
 * - Server deducts ExempliPhai token balance (prepaid) in a Firestore transaction.
 */
const express = require('express');
const cors = require('cors');

const TOKENS_PER_USD = 333;
const MARKUP = 3.33;
const LOW_BALANCE_THRESHOLD = 30;

// SerpAPI (Google Jobs) billing: SerpAPI does not return per-request cost.
// We bill a configurable USD amount per request (your cost), then apply the same markup.
const SERPAPI_USD_PER_REQUEST = Number(process.env.SERPAPI_USD_PER_REQUEST || 0.033); // default: 3.3¢ per search

// Gemini pricing table (USD per 1M tokens). Keep this updated.
const GEMINI_USD_PER_1M = {
  'gemini-3-flash-preview': { input: 0.35, output: 0.53 },
  'gemini-3-pro-preview': { input: 3.5, output: 10.5 },
};

function pickModelRates(model) {
  const m = String(model || '').trim();
  return GEMINI_USD_PER_1M[m] || GEMINI_USD_PER_1M['gemini-3-pro-preview'];
}

async function requireUidFromAuthHeader(req) {
  const h = String(req.get('authorization') || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new HttpsError('unauthenticated', 'Missing Authorization Bearer token');
  const idToken = m[1];
  const decoded = await admin.auth().verifyIdToken(idToken);
  if (!decoded?.uid) throw new HttpsError('unauthenticated', 'Invalid token');
  return decoded.uid;
}

function extractUsageTokens(geminiJson) {
  const usage = geminiJson?.usageMetadata || geminiJson?.usage || {};
  const prompt_tokens = Number(
    usage.promptTokenCount ?? usage.prompt_tokens ?? usage.inputTokenCount ?? usage.input_tokens ?? 0,
  );
  const completion_tokens = Number(
    usage.candidatesTokenCount ??
      usage.candidates_tokens ??
      usage.outputTokenCount ??
      usage.output_tokens ??
      usage.completionTokenCount ??
      0,
  );
  return {
    prompt_tokens: Number.isFinite(prompt_tokens) ? prompt_tokens : 0,
    completion_tokens: Number.isFinite(completion_tokens) ? completion_tokens : 0,
  };
}

function calcProviderUsd({ model, prompt_tokens, completion_tokens }) {
  const rates = pickModelRates(model);
  return (prompt_tokens / 1_000_000) * rates.input + (completion_tokens / 1_000_000) * rates.output;
}

function toBillableDeductTokens(billUsd) {
  const usd = Number.isFinite(billUsd) ? billUsd : 0;
  return Math.max(0, Math.ceil(usd * TOKENS_PER_USD));
}

async function deductWalletUsd({ uid, your_usd, meta }) {
  const providerUsd = Number.isFinite(Number(your_usd)) ? Number(your_usd) : 0;
  const bill_usd = providerUsd * MARKUP;
  const deduct_tokens = toBillableDeductTokens(bill_usd);

  const walletRef = db.doc(`users/${uid}/wallet/extokens`);

  const new_balance = await db.runTransaction(async (tx) => {
    const snap = await tx.get(walletRef);
    const cur = Number(snap.exists ? snap.get('tokens') : 0);
    const curTokens = Number.isFinite(cur) ? cur : 0;
    if (curTokens < deduct_tokens) {
      throw new HttpsError('resource-exhausted', 'insufficient_balance');
    }
    const next = curTokens - deduct_tokens;

    tx.set(
      walletRef,
      {
        tokens: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lifetimeDeductedTokens: admin.firestore.FieldValue.increment(deduct_tokens),
        lifetimeProviderUsd: admin.firestore.FieldValue.increment(providerUsd),
        ...(meta ? { lastCharge: { ...meta, providerUsd, bill_usd, deduct_tokens, at: admin.firestore.FieldValue.serverTimestamp() } } : {}),
      },
      { merge: true },
    );

    return next;
  });

  return { bill_usd, deducted_tokens: deduct_tokens, new_balance };
}

async function getBalanceTokens(uid) {
  // Store extension prepaid tokens in a dedicated wallet doc:
  //   users/{uid}/wallet/extokens
  // This keeps billing separate from other user fields.
  const ref = db.doc(`users/${uid}/wallet/extokens`);
  const snap = await ref.get();
  const tokens = Number(snap.exists ? snap.get('tokens') : 0);
  return Number.isFinite(tokens) ? tokens : 0;
}

const api = express();
api.use(cors({ origin: true }));
api.use(express.json({ limit: '2mb' }));

// Balance endpoint for UI
api.get('/billing/balance', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);
    const tokens = await getBalanceTokens(uid);
    res.json({ ok: true, tokens, low: tokens < LOW_BALANCE_THRESHOLD });
  } catch (e) {
    logger.error('balance failed', e);
    res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
});

// SerpAPI search endpoint(s)
// Preferred endpoints:
//   POST /search/jobs  (SerpAPI engine=google_jobs)
//   POST /search/web   (SerpAPI engine=google)
// Back-compat:
//   POST /search/:action   where action in { jobs, web }
async function handleSerpSearch(req, res, action) {
  const uid = await requireUidFromAuthHeader(req);

  // Enforce low-balance gate BEFORE paying SerpAPI.
  const bal = await getBalanceTokens(uid);
  if (bal < LOW_BALANCE_THRESHOLD) {
    res.status(402).json({ ok: false, error: 'low_balance', tokens: bal, threshold: LOW_BALANCE_THRESHOLD });
    return;
  }

  const serpKey = process.env.SERPAPI_API_KEY;
  if (!serpKey) {
    res.status(500).json({ ok: false, error: 'missing_server_serpapi_key' });
    return;
  }

  let q = String(req.body?.q || '').trim();
  const location = String(req.body?.location || '').trim();
  const limit = Math.min(50, Math.max(1, Number(req.body?.limit || 20)));
  const start = Math.max(0, Number(req.body?.start || 0) || 0);
  const no_cache = req.body?.no_cache === true || String(req.body?.no_cache || '') === 'true';

  // Apply user's desired job type preferences (remote/hybrid/in-person) if present.
  // Stored at /users/{uid}/desiredJobType as an array or a map of booleans.
  try {
    const userSnap = await db.doc(`users/${uid}`).get();
    const dj = userSnap.exists ? userSnap.get('desiredJobType') : null;

    const types = Array.isArray(dj)
      ? dj.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
      : dj && typeof dj === 'object'
        ? Object.keys(dj).filter((k) => !!dj[k]).map((k) => String(k).trim().toLowerCase())
        : [];

    // SerpAPI Google Jobs doesn't have a universally reliable remote/hybrid filter parameter.
    // For now we bias the query text.
    if (types.includes('remote') && !/\bremote\b/i.test(q)) q = `${q} remote`;
    if (types.includes('hybrid') && !/\bhybrid\b/i.test(q)) q = `${q} hybrid`;
    if ((types.includes('in-person') || types.includes('inperson') || types.includes('onsite') || types.includes('on-site')) && !/\b(on\s*-?site|in\s*-?person)\b/i.test(q)) {
      q = `${q} onsite`;
    }
  } catch (_) {}
  if (!q) {
    res.status(400).json({ ok: false, error: 'missing_q' });
    return;
  }

  if (action === 'jobs') {
    const params = new URLSearchParams();
    params.set('engine', 'google_jobs');
    params.set('q', q);
    if (location) params.set('location', location);
    params.set('hl', 'en');
    if (start) params.set('start', String(start));
    if (no_cache) params.set('no_cache', 'true');
    params.set('api_key', serpKey);

    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const sRes = await fetch(url, { method: 'GET' });
    const json = await sRes.json().catch(() => ({}));

    if (!sRes.ok || json?.error) {
      res.status(502).json({ ok: false, error: json?.error || `serpapi_http_${sRes.status}`, details: json });
      return;
    }

    const jobs = Array.isArray(json?.jobs_results) ? json.jobs_results : [];
    const out = jobs.slice(0, limit).map((j) => {
      const apply = Array.isArray(j?.apply_options) ? j.apply_options : [];
      const related = Array.isArray(j?.related_links) ? j.related_links : [];
      return {
        title: String(j?.title || '').trim(),
        company: String(j?.company_name || '').trim(),
        location: String(j?.location || '').trim(),
        via: String(j?.via || '').trim(),
        description: String(j?.description || '').trim(),
        job_id: String(j?.job_id || '').trim(),
        posted_at: String(j?.detected_extensions?.posted_at || '').trim(),
        schedule_type: String(j?.detected_extensions?.schedule_type || '').trim(),
        apply_options: apply
          .map((a) => ({ title: String(a?.title || '').trim(), link: String(a?.link || '').trim() }))
          .filter((a) => a.link),
        related_links: related
          .map((l) => ({ text: String(l?.text || '').trim(), link: String(l?.link || '').trim() }))
          .filter((l) => l.link),
      };
    });

    const charge = await deductWalletUsd({
      uid,
      your_usd: SERPAPI_USD_PER_REQUEST,
      meta: { kind: 'search', provider: 'serpapi', engine: 'google_jobs', action, q, location },
    });

    res.json({
      ok: true,
      action: 'jobs',
      provider: { name: 'serpapi', engine: 'google_jobs' },
      query: { q, location, limit, start, no_cache },
      results: out,
      billing: {
        your_usd: SERPAPI_USD_PER_REQUEST,
        bill_usd: charge.bill_usd,
        deducted_tokens: charge.deducted_tokens,
        tokens_per_usd: TOKENS_PER_USD,
        markup: MARKUP,
      },
      new_balance: charge.new_balance,
    });
    return;
  }

  if (action === 'web') {
    const params = new URLSearchParams();
    params.set('engine', 'google');
    params.set('q', q);
    if (location) params.set('location', location);
    params.set('hl', 'en');
    params.set('api_key', serpKey);

    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const sRes = await fetch(url, { method: 'GET' });
    const json = await sRes.json().catch(() => ({}));

    if (!sRes.ok || json?.error) {
      res.status(502).json({ ok: false, error: json?.error || `serpapi_http_${sRes.status}`, details: json });
      return;
    }

    const org = Array.isArray(json?.organic_results) ? json.organic_results : [];
    const out = org.slice(0, limit).map((r) => ({
      position: Number(r?.position || 0) || null,
      title: String(r?.title || '').trim(),
      link: String(r?.link || '').trim(),
      snippet: String(r?.snippet || '').trim(),
      source: String(r?.source || '').trim(),
    })).filter((r) => r.link || r.snippet);

    const charge = await deductWalletUsd({
      uid,
      your_usd: SERPAPI_USD_PER_REQUEST,
      meta: { kind: 'search', provider: 'serpapi', engine: 'google', action, q, location },
    });

    res.json({
      ok: true,
      action: 'web',
      provider: { name: 'serpapi', engine: 'google' },
      query: { q, location, limit },
      results: out,
      billing: {
        your_usd: SERPAPI_USD_PER_REQUEST,
        bill_usd: charge.bill_usd,
        deducted_tokens: charge.deducted_tokens,
        tokens_per_usd: TOKENS_PER_USD,
        markup: MARKUP,
      },
      new_balance: charge.new_balance,
    });
    return;
  }

  res.status(400).json({ ok: false, error: 'invalid_action' });
}

api.post('/search/jobs', async (req, res) => {
  try {
    await handleSerpSearch(req, res, 'jobs');
  } catch (e) {
    logger.error('search/jobs failed', e);
    const msg = String(e?.message || e);
    const insufficient = msg.includes('insufficient_balance');
    res.status(insufficient ? 402 : 500).json({ ok: false, error: insufficient ? 'insufficient_balance' : msg });
  }
});

api.post('/search/web', async (req, res) => {
  try {
    await handleSerpSearch(req, res, 'web');
  } catch (e) {
    logger.error('search/web failed', e);
    const msg = String(e?.message || e);
    const insufficient = msg.includes('insufficient_balance');
    res.status(insufficient ? 402 : 500).json({ ok: false, error: insufficient ? 'insufficient_balance' : msg });
  }
});

api.post('/search/:action', async (req, res) => {
  try {
    const action = String(req.params.action || '').trim();
    await handleSerpSearch(req, res, action);
  } catch (e) {
    logger.error('search proxy failed', e);
    const msg = String(e?.message || e);
    const insufficient = msg.includes('insufficient_balance');
    res.status(insufficient ? 402 : 500).json({ ok: false, error: insufficient ? 'insufficient_balance' : msg });
  }
});

// AI proxy endpoint
api.post('/ai/:action', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);
    const action = String(req.params.action || '').trim();

    // Enforce low-balance gate BEFORE paying Gemini.
    const bal = await getBalanceTokens(uid);
    if (bal < LOW_BALANCE_THRESHOLD) {
      res.status(402).json({ ok: false, error: 'low_balance', tokens: bal, threshold: LOW_BALANCE_THRESHOLD });
      return;
    }

    const model = String(req.body?.model || 'gemini-3-pro-preview').trim();
    const input = req.body?.input;

    if (!input || typeof input !== 'object') {
      res.status(400).json({ ok: false, error: 'missing_input' });
      return;
    }

    // Allowlist actions (defense in depth)
    const allowedActions = new Set([
      'mapFieldsToFillPlan',
      'generateNarrativeAnswer',
      'aiAnswer',
      'resumeKeywords',
      'resumeTailor',
      'resumeParse',
      'jobRecs',
    ]);
    if (!allowedActions.has(action)) {
      res.status(400).json({ ok: false, error: 'invalid_action' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY;
    if (!apiKey) {
      res.status(500).json({ ok: false, error: 'missing_server_gemini_key' });
      return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const gRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const json = await gRes.json().catch(() => ({}));
    if (!gRes.ok || json?.error) {
      const msg = json?.error?.message || `Gemini HTTP ${gRes.status}`;
      res.status(502).json({ ok: false, error: msg, details: json?.error || null });
      return;
    }

    const { prompt_tokens, completion_tokens } = extractUsageTokens(json);
    const your_usd = calcProviderUsd({ model, prompt_tokens, completion_tokens });

    const charge = await deductWalletUsd({
      uid,
      your_usd,
      meta: { kind: 'ai', provider: 'gemini', model, action },
    });

    const bill_usd = charge.bill_usd;
    const deduct_tokens = charge.deducted_tokens;
    const new_balance = charge.new_balance;

    const outText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({
      ok: true,
      action,
      result: { text: String(outText) },
      provider: { name: 'gemini', model },
      usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens },
      billing: {
        your_usd,
        bill_usd,
        deducted_tokens: deduct_tokens,
        tokens_per_usd: TOKENS_PER_USD,
        markup: MARKUP,
      },
      new_balance,
    });
  } catch (e) {
    logger.error('ai proxy failed', e);
    const msg = String(e?.message || e);
    const insufficient = msg.includes('insufficient_balance');
    res.status(insufficient ? 402 : 500).json({ ok: false, error: insufficient ? 'insufficient_balance' : msg });
  }
});

// IMPORTANT: declare secrets so Cloud Functions injects them into process.env
exports.api = onRequest({ region: REGION, secrets: ['GEMINI_API_KEY', 'SERPAPI_API_KEY'] }, api);


exports.applyAttribution = onCall({ region: REGION, cors: true }, async (req) => {
  const auth = req.auth;
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = auth.uid;

  const attributionId = String(req.data?.attributionId || "").trim();
  if (!isNonEmptyString(attributionId)) {
    throw new HttpsError("invalid-argument", "Missing attributionId.");
  }

  const attrRef = db.doc(`referralAttributions/${attributionId}`);
  const userRef = db.doc(`users/${uid}`);

  const out = await db.runTransaction(async (tx) => {
    const [attrSnap, userSnap] = await Promise.all([
      tx.get(attrRef),
      tx.get(userRef),
    ]);

    if (!attrSnap.exists) {
      throw new HttpsError("not-found", "Attribution not found.");
    }

    if (attrSnap.get("applied") === true) {
      return {
        ok: true,
        alreadyApplied: true,
        referrerUid: attrSnap.get("referrerUid") || null,
      };
    }

    const code = String(attrSnap.get("code") || "")
      .trim()
      .toUpperCase();
    if (!isNonEmptyString(code)) {
      throw new HttpsError("failed-precondition", "Attribution missing code.");
    }

    const referrerUid = await resolveReferrerUidByCode(code);
    if (!referrerUid) {
      // Mark applied to prevent retry abuse, but with no referrer.
      tx.set(
        attrRef,
        {
          applied: true,
          appliedAt: admin.firestore.FieldValue.serverTimestamp(),
          appliedByUid: uid,
          referrerUid: null,
          error: "unknown_code",
        },
        { merge: true },
      );
      return { ok: true, applied: true, referrerUid: null };
    }

    if (referrerUid === uid) {
      tx.set(
        attrRef,
        {
          applied: true,
          appliedAt: admin.firestore.FieldValue.serverTimestamp(),
          appliedByUid: uid,
          referrerUid,
          error: "self_referral",
        },
        { merge: true },
      );
      return { ok: true, applied: true, referrerUid };
    }

    const referralDocRef = db.doc(`users/${referrerUid}/referrals/${uid}`);
    const referralDocSnap = await tx.get(referralDocRef);

    // Determine identity to store (masked later in list API, but we store raw-ish too).
    const referredDisplayName = String(
      userSnap.get("account.displayName") || "",
    );
    const referredPhoneNumber = String(
      userSnap.get("account.phoneNumber") || auth.token?.phone_number || "",
    );

    if (!referralDocSnap.exists) {
      tx.set(referralDocRef, {
        referredUid: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        attributionId,
        pointsAwarded: REFERRAL.SIGNUP_POINTS,
        referredDisplayName: referredDisplayName || null,
        referredPhoneNumber: referredPhoneNumber || null,
      });

      tx.set(
        db.doc(`users/${referrerUid}`),
        {
          referral: {
            pointsEarned: admin.firestore.FieldValue.increment(
              REFERRAL.SIGNUP_POINTS,
            ),
            referralsCount: admin.firestore.FieldValue.increment(1),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    // Mark attribution applied and mark user as referred (for later paid conversion bonus).
    tx.set(
      attrRef,
      {
        applied: true,
        appliedAt: admin.firestore.FieldValue.serverTimestamp(),
        appliedByUid: uid,
        referrerUid,
      },
      { merge: true },
    );

    tx.set(
      userRef,
      {
        referral: {
          referredByUid: referrerUid,
          attributionId,
          referredByCode: code,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { ok: true, applied: true, referrerUid };
  });

  return out;
});

exports.listMyReferrals = onCall({ region: REGION, cors: true }, async (req) => {
  const auth = req.auth;
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = auth.uid;

  const snaps = await db
    .collection(`users/${uid}/referrals`)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const referrals = snaps.docs.map((d) => {
    const data = d.data() || {};
    const masked = pickMaskedIdentity({
      displayName: data.referredDisplayName,
      phoneNumber: data.referredPhoneNumber,
    });

    return {
      referredUid: String(data.referredUid || d.id),
      createdAt: data.createdAt ? data.createdAt.toDate?.().toISOString?.() || null : null,
      pointsAwarded: Number(data.pointsAwarded || 0),
      who: masked,
    };
  });

  const totalPoints = referrals.reduce(
    (sum, r) => sum + (Number.isFinite(r.pointsAwarded) ? r.pointsAwarded : 0),
    0,
  );

  return {
    totalReferrals: referrals.length,
    totalPoints,
    referrals,
  };
});

// Bonus points when a referred user becomes paid.
// Heuristic: any of these fields flips falsey -> truthy:
// - billing.isPaid
// - billing.planStatus === 'paid'
// - subscription.status === 'active'
// - plan.tier === 'pro'
exports.onUserPaidPlan = onDocumentUpdated(
  { region: REGION, document: "users/{uid}" },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const uid = event.params.uid;

    const beforePaid =
      !!before?.billing?.isPaid ||
      String(before?.billing?.planStatus || "").toLowerCase() === "paid" ||
      String(before?.subscription?.status || "").toLowerCase() === "active" ||
      String(before?.plan?.tier || "").toLowerCase() === "pro";

    const afterPaid =
      !!after?.billing?.isPaid ||
      String(after?.billing?.planStatus || "").toLowerCase() === "paid" ||
      String(after?.subscription?.status || "").toLowerCase() === "active" ||
      String(after?.plan?.tier || "").toLowerCase() === "pro";

    if (beforePaid || !afterPaid) return;

    const referrerUid = after?.referral?.referredByUid;
    if (!isNonEmptyString(referrerUid)) return;

    const bonusApplied = !!after?.referral?.paidConversionBonusApplied;
    if (bonusApplied) return;

    const referralDocRef = db.doc(`users/${referrerUid}/referrals/${uid}`);

    await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const [userSnap, referralSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(referralDocRef),
      ]);

      const cur = userSnap.data() || {};
      if (cur?.referral?.paidConversionBonusApplied) return;

      // Only award if referral record exists (ensures attribution path).
      if (!referralSnap.exists) return;

      tx.set(
        db.doc(`users/${referrerUid}`),
        {
          referral: {
            pointsEarned: admin.firestore.FieldValue.increment(
              REFERRAL.PAID_CONVERSION_BONUS_POINTS,
            ),
            paidConversionBonusEarned: admin.firestore.FieldValue.increment(
              REFERRAL.PAID_CONVERSION_BONUS_POINTS,
            ),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.set(
        referralDocRef,
        {
          paidConversionBonusAwarded: REFERRAL.PAID_CONVERSION_BONUS_POINTS,
          paidConversionAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.set(
        userRef,
        {
          referral: {
            paidConversionBonusApplied: true,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    logger.info("Paid conversion bonus awarded", { uid, referrerUid });
  },
);
