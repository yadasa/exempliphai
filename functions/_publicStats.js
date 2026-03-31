"use strict";

// Public aggregate stats (marketing site)
// Stored at: /publicStats/aggregate

function safeNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

async function bumpPublicAggregate({ db, admin, autofillsDelta = 0, customAnswersDelta = 0 }) {
  const ref = db.doc('publicStats/aggregate');
  const patch = {
    autofillsTotal: admin.firestore.FieldValue.increment(safeNum(autofillsDelta)),
    customAnswersTotal: admin.firestore.FieldValue.increment(safeNum(customAnswersDelta)),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(patch, { merge: true });
}

module.exports = { bumpPublicAggregate, safeNum };
