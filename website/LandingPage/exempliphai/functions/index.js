/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

if (admin.apps.length === 0) {
  admin.initializeApp();
}

// Increment a global counter whenever the landing page logs a visit event.
// Path: global/metrics/pageVisits/{visitId}
exports.onLandingPageVisit = onDocumentCreated(
    {
      document: "global/metrics/pageVisits/{visitId}",
      region: "us-central1",
      maxInstances: 5,
    },
    async () => {
      const db = admin.firestore();
      await db.doc("global/metrics").set(
          { landingPageVisits: admin.firestore.FieldValue.increment(1) },
          { merge: true },
      );
    },
);

