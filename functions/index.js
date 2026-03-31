"use strict";

const admin = require("firebase-admin");
const {
  onCall,
  onRequest,
  HttpsError,
} = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");

// Initialize Admin
try {
  admin.initializeApp();
} catch {
  // ignore if already initialized
}

const db = admin.firestore();

const { bumpPublicAggregate, safeNum } = require('./_publicStats');

const REGION = process.env.FUNCTION_REGION || "us-central1";

const REFERRAL = {
  CODE_LEN: 8,

  // Points
  JOIN_POINTS: 1,
  ONBOARDING_POINTS: 1,
  FIRST_JOB_POINTS: 1,
  PAID_CONVERSION_POINTS: 6,

  // Redemption
  REDEEM_PLUS_POINTS_COST: 10,
  REDEEM_PLUS_DAYS: 7,
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

// Allowed web origins for callable functions.
// Note: callable endpoints still perform CORS checks in the browser.
const WEB_CORS = [
  /^https:\/\/(www\.)?exempliph\.ai$/i,
  /^https:\/\/exempliphai\.(web\.app|firebaseapp\.com)$/i,
  /^http:\/\/localhost:\d+$/i,
];

// NOTE: Callable referral functions are kept for backwards compatibility, but the website
// should use same-origin /api/referrals/* endpoints to avoid callable CORS/IAM issues.
exports.getOrCreateReferralCode = onCall({ region: REGION, cors: true, invoker: "public" }, async (req) => {
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
const Stripe = require('stripe');

const TOKENS_PER_USD = 333;
const MARKUP = 3.33;
const LOW_BALANCE_THRESHOLD = 30;

const TOKEN_PACKS = {
  1: 250,
  5: 1500,
  10: 3330,
  25: 8890,
  50: 19000,
};

function getStripeClient() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) throw new HttpsError('failed-precondition', 'stripe_not_configured');
  return new Stripe(key);
}

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

function httpStatusFromError(e) {
  const code = String(e?.code || e?.details?.code || '').toLowerCase();
  if (code === 'unauthenticated') return 401;
  if (code === 'permission-denied') return 403;
  if (code === 'invalid-argument') return 400;
  if (code === 'failed-precondition') return 400;
  if (code === 'resource-exhausted') return 402;
  if (code === 'not-found') return 404;
  return 500;
}

function sendHttpError(res, e) {
  const status = httpStatusFromError(e);
  const msg = String(e?.message || e);
  res.status(status).json({ ok: false, error: status === 500 ? 'internal' : msg });
}

async function requireUidFromAuthHeader(req) {
  const h = String(req.get('authorization') || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new HttpsError('unauthenticated', 'Missing Authorization Bearer token');
  const idToken = m[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded?.uid) throw new HttpsError('unauthenticated', 'Invalid token');
    return decoded.uid;
  } catch (err) {
    // Normalize Firebase Admin errors to a consistent HTTP auth error.
    throw new HttpsError('unauthenticated', 'Invalid token');
  }
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

// Stripe webhooks must verify the raw request body. This must run BEFORE express.json.
api.post(
  ['/stripe/webhook', '/api/stripe/webhook'],
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const stripe = getStripeClient();
      const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
      if (!secret) throw new HttpsError('failed-precondition', 'stripe_webhook_not_configured');

      const sig = String(req.get('stripe-signature') || '');
      const rawBody = req.rawBody || req.body;

      let evt;
      try {
        evt = stripe.webhooks.constructEvent(rawBody, sig, secret);
      } catch (e) {
        res.status(400).send(`Webhook Error: ${String(e?.message || e)}`);
        return;
      }

      if (evt.type === 'checkout.session.completed') {
        const session = evt.data.object;
        const uid = String(session?.metadata?.uid || '').trim();
        const tokens = Number(session?.metadata?.tokens || 0);
        const usd = Number(session?.metadata?.usd || 0);

        if (uid && Number.isFinite(tokens) && tokens > 0) {
          const walletRef = db.doc(`users/${uid}/wallet/extokens`);
          await db.runTransaction(async (tx) => {
            tx.set(
              walletRef,
              {
                tokens: admin.firestore.FieldValue.increment(tokens),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                lifetimePurchasedTokens: admin.firestore.FieldValue.increment(tokens),
                lifetimePurchasedUsd: admin.firestore.FieldValue.increment(Number.isFinite(usd) ? usd : 0),
                lastTopUp: {
                  tokens,
                  usd: Number.isFinite(usd) ? usd : null,
                  sessionId: String(session?.id || ''),
                  at: admin.firestore.FieldValue.serverTimestamp(),
                },
              },
              { merge: true },
            );
          });
        }
      }

      res.json({ received: true });
    } catch (e) {
      logger.error('stripe webhook failed', e);
      // Stripe treats non-2xx as retry; return 500 only for transient errors.
      res.status(500).json({ ok: false, error: 'internal' });
    }
  },
);

api.use(express.json({ limit: '2mb' }));

// Some Firebase Hosting rewrites forward the full path (e.g. /api/...)
// to this service. To keep things robust, serve routes both at the root
// and under /api.
const apiRouter = express.Router();

// Health / rewrite diagnostics
apiRouter.get('/__ping', (req, res) => res.json({ ok: true, service: 'api' }));
// NOTE: /__rewrite_test__ is temporary; safe to remove once Hosting rewrites are stable.
apiRouter.get('/__rewrite_test__', (req, res) => res.json({ ok: true, rewrite: true }));

api.use(apiRouter);
api.use('/api', apiRouter);

// Referral endpoints for website (avoid callable CORS issues)
apiRouter.get('/referrals/code', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);

    const userRef = db.doc(`users/${uid}`);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const already = snap.get('referral.code');
      if (isNonEmptyString(already)) return { code: already, created: false };

      for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomCode(REFERRAL.CODE_LEN);
        const codeRef = db.doc(`referralCodes/${code}`);
        const codeSnap = await tx.get(codeRef);
        if (codeSnap.exists) continue;

        tx.set(codeRef, { uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
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

      throw new Error('resource_exhausted');
    });

    res.json({ ok: true, code: result.code });
  } catch (e) {
    logger.error('referrals/code failed', e);
    sendHttpError(res, e);
  }
});

apiRouter.get('/referrals/list', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);

    const snaps = await db.collection(`users/${uid}/referrals`).orderBy('createdAt', 'desc').limit(200).get();

    const referrals = snaps.docs.map((d) => {
      const data = d.data() || {};
      const masked = pickMaskedIdentity({ displayName: data.referredDisplayName, phoneNumber: data.referredPhoneNumber });
      return {
        referredUid: String(data.referredUid || d.id),
        createdAt: data.createdAt ? data.createdAt.toDate?.().toISOString?.() || null : null,
        pointsAwarded: Number(data.pointsAwarded || 0),
        who: masked,
      };
    });

    const totalPoints = referrals.reduce((sum, r) => sum + (Number.isFinite(r.pointsAwarded) ? r.pointsAwarded : 0), 0);

    res.json({ ok: true, totalReferrals: referrals.length, totalPoints, referrals });
  } catch (e) {
    logger.error('referrals/list failed', e);
    sendHttpError(res, e);
  }
});

apiRouter.post('/referrals/apply', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);
    const attributionId = String(req.body?.attributionId || '').trim();
    if (!isNonEmptyString(attributionId)) {
      res.status(400).json({ ok: false, error: 'missing_attributionId' });
      return;
    }

    const attrRef = db.doc(`referralAttributions/${attributionId}`);
    const userRef = db.doc(`users/${uid}`);

    const out = await db.runTransaction(async (tx) => {
      const [attrSnap, userSnap] = await Promise.all([tx.get(attrRef), tx.get(userRef)]);
      if (!attrSnap.exists) return { ok: false, error: 'not_found' };

      if (attrSnap.get('applied') === true) {
        return { ok: true, alreadyApplied: true, referrerUid: attrSnap.get('referrerUid') || null };
      }

      const code = String(attrSnap.get('code') || '').trim().toUpperCase();
      if (!isNonEmptyString(code)) return { ok: false, error: 'missing_code' };

      const referrerUid = await resolveReferrerUidByCode(code);
      if (!referrerUid) {
        tx.set(
          attrRef,
          {
            applied: true,
            appliedAt: admin.firestore.FieldValue.serverTimestamp(),
            appliedByUid: uid,
            referrerUid: null,
            error: 'unknown_code',
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
            error: 'self_referral',
          },
          { merge: true },
        );
        return { ok: true, applied: true, referrerUid };
      }

      const referralDocRef = db.doc(`users/${referrerUid}/referrals/${uid}`);
      const referralDocSnap = await tx.get(referralDocRef);

      const referredDisplayName = String(userSnap.get('account.displayName') || '');
      const referredPhoneNumber = String(userSnap.get('account.phoneNumber') || '');

      if (!referralDocSnap.exists) {
        tx.set(referralDocRef, {
          referredUid: uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          attributionId,
          pointsAwarded: REFERRAL.JOIN_POINTS,
          joinAwarded: true,
          referredDisplayName: referredDisplayName || null,
          referredPhoneNumber: referredPhoneNumber || null,
        });

        tx.set(
          db.doc(`users/${referrerUid}`),
          {
            referral: {
              pointsEarned: admin.firestore.FieldValue.increment(REFERRAL.JOIN_POINTS),
              referralsCount: admin.firestore.FieldValue.increment(1),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

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

    res.json(out);
  } catch (e) {
    logger.error('referrals/apply failed', e);
    sendHttpError(res, e);
  }
});

// Redeem points for a 1-week Plus pass.
function isAdminUid(uid) {
  const allow = String(process.env.ADMIN_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Default admin (Kei) fallback if env not set.
  if (!allow.length) {
    return uid === 'LYAb2f5EumaPrlAUTr0LQmVj7Gt1';
  }
  return allow.includes(uid);
}

// One-time helper: rebuild the public aggregate stats from all users.
// Protect this endpoint to avoid expensive scans.
apiRouter.post('/publicStats/rebuild', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);
    if (!isAdminUid(uid)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }

    // Scan all users and sum their stats.
    const snaps = await db.collection('users').select('stats').get();
    let autofillsTotal = 0;
    let customAnswersTotal = 0;

    for (const d of snaps.docs) {
      const data = d.data() || {};
      autofillsTotal += safeNum(data?.stats?.autofills?.total);
      customAnswersTotal += safeNum(data?.stats?.customAnswersGenerated?.total);
    }

    await db.doc('publicStats/aggregate').set(
      {
        autofillsTotal,
        customAnswersTotal,
        rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    res.json({ ok: true, autofillsTotal, customAnswersTotal });
  } catch (e) {
    logger.error('publicStats/rebuild failed', e);
    sendHttpError(res, e);
  }
});

apiRouter.post('/referrals/redeem', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);

    const cost = REFERRAL.REDEEM_PLUS_POINTS_COST;
    const days = REFERRAL.REDEEM_PLUS_DAYS;

    const userRef = db.doc(`users/${uid}`);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const curPoints = Number(snap.get('referral.pointsEarned') || 0);
      const points = Number.isFinite(curPoints) ? curPoints : 0;
      if (points < cost) {
        return { ok: false, error: 'insufficient_points', points, cost };
      }

      const nowMs = Date.now();
      const curUntil = snap.get('paidPlanUntil');
      const curUntilMs = curUntil?.toMillis?.() ? Number(curUntil.toMillis()) : 0;
      const baseMs = Math.max(nowMs, curUntilMs);
      const nextUntil = admin.firestore.Timestamp.fromMillis(baseMs + days * 24 * 60 * 60 * 1000);

      tx.set(
        userRef,
        {
          paidPlan: true,
          paidPlanUntil: nextUntil,
          referral: {
            pointsEarned: admin.firestore.FieldValue.increment(-cost),
            redeemedPlusWeeks: admin.firestore.FieldValue.increment(1),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { ok: true, cost, nextUntil: nextUntil.toDate().toISOString() };
    });

    if (result?.ok === false) {
      res.status(400).json(result);
      return;
    }

    res.json(result);
  } catch (e) {
    logger.error('referrals/redeem failed', e);
    sendHttpError(res, e);
  }
});

// Balance endpoint for UI
apiRouter.get('/billing/balance', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);
    const tokens = await getBalanceTokens(uid);
    res.json({ ok: true, tokens, low: tokens < LOW_BALANCE_THRESHOLD });
  } catch (e) {
    logger.error('balance failed', e);
    sendHttpError(res, e);
  }
});

// Stripe checkout for buying tokens (website)
apiRouter.post('/tokens/checkout', async (req, res) => {
  try {
    const uid = await requireUidFromAuthHeader(req);

    const usd = Number(req.body?.usd || 0);
    const usdKey = String(usd);
    const tokens = TOKEN_PACKS[usdKey];
    if (!tokens) {
      res.status(400).json({ ok: false, error: 'invalid_pack' });
      return;
    }

    const stripe = getStripeClient();

    const origin = String(req.get('origin') || 'https://exempliph.ai');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(usd * 100),
            product_data: {
              name: `ExempliPhai Tokens`,
              description: `${tokens.toLocaleString()} tokens`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/tokens?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/tokens?canceled=1`,
      metadata: {
        uid,
        usd: String(usd),
        tokens: String(tokens),
      },
    });

    res.json({ ok: true, url: session.url });
  } catch (e) {
    logger.error('tokens/checkout failed', e);
    sendHttpError(res, e);
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
  const lrad = Math.max(0, Number(req.body?.lrad || 0) || 0); // last result age in days (if supported)

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
    if (lrad) params.set('lrad', String(lrad));
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
      query: { q, location, limit, start, no_cache, lrad },
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

apiRouter.post('/search/jobs', async (req, res) => {
  try {
    await handleSerpSearch(req, res, 'jobs');
  } catch (e) {
    logger.error('search/jobs failed', e);
    const msg = String(e?.message || e);
    const insufficient = msg.includes('insufficient_balance');
    res.status(insufficient ? 402 : 500).json({ ok: false, error: insufficient ? 'insufficient_balance' : msg });
  }
});

apiRouter.post('/search/web', async (req, res) => {
  try {
    await handleSerpSearch(req, res, 'web');
  } catch (e) {
    logger.error('search/web failed', e);
    const msg = String(e?.message || e);
    const insufficient = msg.includes('insufficient_balance');
    res.status(insufficient ? 402 : 500).json({ ok: false, error: insufficient ? 'insufficient_balance' : msg });
  }
});

apiRouter.post('/search/:action', async (req, res) => {
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
apiRouter.post('/ai/:action', async (req, res) => {
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


exports.applyAttribution = onCall({ region: REGION, cors: true, invoker: "public" }, async (req) => {
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
        pointsAwarded: REFERRAL.JOIN_POINTS,
        joinAwarded: true,
        referredDisplayName: referredDisplayName || null,
        referredPhoneNumber: referredPhoneNumber || null,
      });

      tx.set(
        db.doc(`users/${referrerUid}`),
        {
          referral: {
            pointsEarned: admin.firestore.FieldValue.increment(
              REFERRAL.JOIN_POINTS,
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

exports.listMyReferrals = onCall({ region: REGION, cors: true, invoker: "public" }, async (req) => {
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
// Keep a public aggregate count of autofills/custom answers for the marketing homepage.
exports.onUserStatsAggregate = onDocumentWritten(
  { region: REGION, document: "users/{uid}" },
  async (event) => {
    try {
      const before = event.data?.before?.data() || {};
      const after = event.data?.after?.data() || {};

      const beforeAutofills = safeNum(before?.stats?.autofills?.total);
      const afterAutofills = safeNum(after?.stats?.autofills?.total);
      const beforeCustom = safeNum(before?.stats?.customAnswersGenerated?.total);
      const afterCustom = safeNum(after?.stats?.customAnswersGenerated?.total);

      const autofillsDelta = afterAutofills - beforeAutofills;
      const customDelta = afterCustom - beforeCustom;

      if (!autofillsDelta && !customDelta) return;

      await bumpPublicAggregate({
        db,
        admin,
        autofillsDelta,
        customAnswersDelta: customDelta,
      });
    } catch (e) {
      logger.error('publicStats aggregate update failed', e);
    }
  },
);

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
      !!before?.paidPlan ||
      !!before?.billing?.isPaid ||
      String(before?.billing?.planStatus || "").toLowerCase() === "paid" ||
      String(before?.subscription?.status || "").toLowerCase() === "active" ||
      String(before?.plan?.tier || "").toLowerCase() === "pro";

    const afterPaid =
      !!after?.paidPlan ||
      !!after?.billing?.isPaid ||
      String(after?.billing?.planStatus || "").toLowerCase() === "paid" ||
      String(after?.subscription?.status || "").toLowerCase() === "active" ||
      String(after?.plan?.tier || "").toLowerCase() === "pro";

    if (beforePaid || !afterPaid) return;

    const referrerUid = after?.referral?.referredByUid;
    if (!isNonEmptyString(referrerUid)) return;

    const bonusApplied = !!after?.referral?.paidConversionBonusApplied;

    const beforeOnboarding = !!before?.onboarding?.completedAt;
    const afterOnboarding = !!after?.onboarding?.completedAt;

    const beforeAutofills = Number(before?.stats?.autofills?.total || 0) || 0;
    const afterAutofills = Number(after?.stats?.autofills?.total || 0) || 0;

    const hitOnboarding = !beforeOnboarding && afterOnboarding;
    const hitFirstJob = beforeAutofills <= 0 && afterAutofills > 0;

    // If nothing to do, bail.
    if ((beforePaid || !afterPaid || bonusApplied) && !hitOnboarding && !hitFirstJob) {
      // paid conversion already handled or not applicable, and no milestones
      if (!hitOnboarding && !hitFirstJob) return;
    }

    const referralDocRef = db.doc(`users/${referrerUid}/referrals/${uid}`);

    await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${uid}`);
      const [userSnap, referralSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(referralDocRef),
      ]);

      const cur = userSnap.data() || {};
      if (!referralSnap.exists) return; // must have applied attribution

      const referralData = referralSnap.data() || {};

      // Paid conversion
      if (!cur?.referral?.paidConversionBonusApplied && afterPaid && !beforePaid) {
        tx.set(
          db.doc(`users/${referrerUid}`),
          {
            referral: {
              pointsEarned: admin.firestore.FieldValue.increment(REFERRAL.PAID_CONVERSION_POINTS),
              paidConversionBonusEarned: admin.firestore.FieldValue.increment(REFERRAL.PAID_CONVERSION_POINTS),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        tx.set(
          referralDocRef,
          {
            pointsAwarded: admin.firestore.FieldValue.increment(REFERRAL.PAID_CONVERSION_POINTS),
            paidConversionBonusAwarded: REFERRAL.PAID_CONVERSION_POINTS,
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
      }

      // Onboarding milestone
      if (hitOnboarding && !referralData?.onboardingAwarded) {
        tx.set(
          db.doc(`users/${referrerUid}`),
          {
            referral: {
              pointsEarned: admin.firestore.FieldValue.increment(REFERRAL.ONBOARDING_POINTS),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        tx.set(
          referralDocRef,
          {
            pointsAwarded: admin.firestore.FieldValue.increment(REFERRAL.ONBOARDING_POINTS),
            onboardingAwarded: true,
            onboardingAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      // First job milestone (first autofill)
      if (hitFirstJob && !referralData?.firstJobAwarded) {
        tx.set(
          db.doc(`users/${referrerUid}`),
          {
            referral: {
              pointsEarned: admin.firestore.FieldValue.increment(REFERRAL.FIRST_JOB_POINTS),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        tx.set(
          referralDocRef,
          {
            pointsAwarded: admin.firestore.FieldValue.increment(REFERRAL.FIRST_JOB_POINTS),
            firstJobAwarded: true,
            firstJobAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    });

    if (afterPaid && !beforePaid && !bonusApplied) {
      logger.info("Paid conversion bonus awarded", { uid, referrerUid });
    }
    if (hitOnboarding) {
      logger.info("Referral onboarding milestone awarded", { uid, referrerUid });
    }
    if (hitFirstJob) {
      logger.info("Referral first job milestone awarded", { uid, referrerUid });
    }
  },
);
