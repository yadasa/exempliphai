import { browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirebase } from "@/lib/firebase/client";

let persistenceReadyPromise: Promise<void> | null = null;

/**
 * Ensures Firebase Auth persistence is set (once per page lifetime).
 *
 * Firebase setPersistence() is async and can move/copy auth state between backends.
 * We cache the promise to avoid multiple concurrent transitions.
 */
export function ensureAuthPersistence(): Promise<void> {
  if (persistenceReadyPromise) return persistenceReadyPromise;

  const { auth } = getFirebase();
  if (!auth) {
    persistenceReadyPromise = Promise.resolve();
    return persistenceReadyPromise;
  }

  persistenceReadyPromise = setPersistence(auth, browserLocalPersistence)
    .catch((err) => {
      console.warn("[auth] setPersistence failed", err);
    })
    .then(() => {});

  return persistenceReadyPromise;
}

// Debug helper for manual testing.
export function resetAuthPersistencePromiseForDebug() {
  persistenceReadyPromise = null;
}
