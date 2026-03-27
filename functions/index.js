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

exports.applyAttribution = onCall({ region: REGION }, async (req) => {
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

exports.listMyReferrals = onCall({ region: REGION }, async (req) => {
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
