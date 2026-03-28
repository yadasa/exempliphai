/*
 * Migration helper: linkedinPdf -> coverLetter and legacy paths -> users/{uid}/profile/current.
 *
 * Usage (from exempliphai/functions):
 *   npm i
 *   node migrateProfile.js
 *
 * Auth:
 *   - set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON, OR
 *   - run in a Firebase environment with default creds.
 *
 * Optional:
 *   - DELETE_LEGACY=1 to delete old fields after copy.
 */

const admin = require('firebase-admin');

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const db = admin.firestore();
  const shouldDelete = String(process.env.DELETE_LEGACY || '') === '1';

  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} users`);

  let migrated = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;

    const legacyJobFieldsRef = db.doc(`users/${uid}/jobFields/current`);
    const profileRef = db.doc(`users/${uid}/profile/current`);

    const [legacyJobFieldsSnap, profileSnap] = await Promise.all([
      legacyJobFieldsRef.get().catch(() => null),
      profileRef.get().catch(() => null),
    ]);

    const legacy = legacyJobFieldsSnap && legacyJobFieldsSnap.exists ? legacyJobFieldsSnap.data() : null;
    const profile = profileSnap && profileSnap.exists ? profileSnap.data() : null;

    const writes = {};
    const deletes = {};

    // 1) uploads.linkedinPdf -> uploads.coverLetter
    const legacyLinkedin = legacy?.uploads?.linkedinPdf;
    const legacyCover = legacy?.uploads?.coverLetter;

    const haveCoverAlready = profile?.uploads?.coverLetter || legacyCover;
    if (!haveCoverAlready && legacyLinkedin) {
      writes['uploads.coverLetter'] = legacyLinkedin;
      if (shouldDelete) {
        deletes['uploads.linkedinPdf'] = admin.firestore.FieldValue.delete();
      }
    }

    // 2) Move jobFields/current fields to profile/current (best-effort merge)
    // Copy over resumeDetails/localProfile/tailoredResume/uploads if present.
    for (const k of ['sync', 'resumeDetails', 'localProfile', 'tailoredResume', 'uploads']) {
      if (legacy && Object.prototype.hasOwnProperty.call(legacy, k) && profile?.[k] == null) {
        writes[k] = legacy[k];
      }
    }

    // 3) settings -> sync (legacy root users/{uid}.settings)
    const settings = userDoc.data()?.settings;
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      // If profile.sync doesn't already contain these keys, merge them in.
      // We keep both for safety unless DELETE_LEGACY=1.
      const existingSync = (profile?.sync && typeof profile.sync === 'object') ? profile.sync : {};
      const merged = { ...settings, ...existingSync };
      writes['sync'] = merged;
      if (shouldDelete) {
        await userDoc.ref.update({ settings: admin.firestore.FieldValue.delete() }).catch(() => {});
      }
    }

    const hasWrites = Object.keys(writes).length || Object.keys(deletes).length;
    if (!hasWrites) continue;

    const patch = { ...writes, ...deletes, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    await profileRef.set(patch, { merge: true });

    migrated++;
    if (migrated % 25 === 0) console.log(`Migrated ${migrated}/${usersSnap.size}…`);
  }

  console.log(`Done. Migrated ${migrated} users.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
