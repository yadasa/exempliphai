import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";
import {
  getFunctions,
  connectFunctionsEmulator,
  type Functions,
} from "firebase/functions";
import {
  getStorage,
  connectStorageEmulator,
  type FirebaseStorage,
} from "firebase/storage";

// NOTE: In Next.js client bundles, `process.env.FOO` gets inlined at build time,
// but `process.env[name]` (dynamic access) does NOT. So we must read each
// NEXT_PUBLIC_* var via static property access.

export type FirebaseClients = {
  // Note: when Firebase env vars are missing we intentionally return `null` clients
  // casted to these types so the app can render and pages can show friendly errors.
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
  /** True when all required NEXT_PUBLIC_FIREBASE_* vars are present */
  configured: boolean;
};

let cached: FirebaseClients | null = null;
let warnedMissingEnv = false;

export function getFirebase(): FirebaseClients {
  if (cached) return cached;

  // Debug helper: verify NEXT_PUBLIC_* env vars are being inlined by Next.js.
  // (Project ID is not secret.)
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    console.debug(
      "[firebase] NEXT_PUBLIC_FIREBASE_PROJECT_ID =",
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    );
    console.log('All NEXT_PUBLIC_FIREBASE_* loaded:', {
      API_KEY: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? 'YES' : 'NO',
      AUTH_DOMAIN: !!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ? 'YES' : 'NO',
      PROJECT_ID: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? 'YES' : 'NO',
      APP_ID: !!process.env.NEXT_PUBLIC_FIREBASE_APP_ID ? 'YES' : 'NO',
      STORAGE: !!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ? 'YES' : 'NO',
      MESSAGING: !!process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ? 'YES' : 'NO'
    });
  }

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };

  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    console.log("firebaseConfig:", {
      apiKey: !!firebaseConfig.apiKey,
      authDomain: !!firebaseConfig.authDomain,
      projectId: !!firebaseConfig.projectId,
      storageBucket: !!firebaseConfig.storageBucket,
      messagingSenderId: !!firebaseConfig.messagingSenderId,
      appId: !!firebaseConfig.appId,
    });
  }

  const required = {
    NEXT_PUBLIC_FIREBASE_API_KEY: firebaseConfig.apiKey,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
    NEXT_PUBLIC_FIREBASE_APP_ID: firebaseConfig.appId,
  } as const;

  const isConfigured = Object.values(required).every((v) => !!v);

  if (!isConfigured) {
    if (!warnedMissingEnv && typeof window !== "undefined") {
      warnedMissingEnv = true;
      const missing = Object.entries(required)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      // Don't print secret values (only names + presence).
      console.warn(
        "[firebase] Client not configured. Missing env vars:",
        missing.join(", "),
      );
    }

    // Don't crash the whole app (dev DX + better error surfacing in UI).
    cached = {
      auth: null as unknown as Auth,
      db: null as unknown as Firestore,
      functions: null as unknown as Functions,
      storage: null as unknown as FirebaseStorage,
      configured: false,
    };
    return cached;
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app);
  const storage = getStorage(app);

  const useEmulators =
    String(process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS || "false").toLowerCase() ===
    "true";

  if (useEmulators) {
    const authUrl =
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ||
      "http://localhost:9099";
    const fsHost =
      process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST || "localhost";
    const fsPort = Number(
      process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080,
    );
    const fnHost =
      process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_HOST || "localhost";
    const fnPort = Number(
      process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5001,
    );
    const stHost =
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST || "localhost";
    const stPort = Number(
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_PORT || 9199,
    );

    try {
      connectAuthEmulator(auth, authUrl, { disableWarnings: true });
    } catch {
      // ignore if already connected
    }

    try {
      connectFirestoreEmulator(db, fsHost, fsPort);
    } catch {
      // ignore if already connected
    }

    try {
      connectFunctionsEmulator(functions, fnHost, fnPort);
    } catch {
      // ignore if already connected
    }

    try {
      connectStorageEmulator(storage, stHost, stPort);
    } catch {
      // ignore if already connected
    }
  }

  cached = { auth, db, functions, storage, configured: true };
  return cached;
}
