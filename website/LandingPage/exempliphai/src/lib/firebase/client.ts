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

function env(name: string): string {
  const v = process.env[name];
  // In local/dev environments we still want pages to render without crashing,
  // even if Firebase isn't configured yet.
  if (!v) return "";
  return v;
}

export type FirebaseClients = {
  // Note: when Firebase env vars are missing we intentionally return `null` clients
  // casted to these types so the app can render and pages can show friendly errors.
  auth: Auth;
  db: Firestore;
  functions: Functions;
  /** True when all required NEXT_PUBLIC_FIREBASE_* vars are present */
  configured: boolean;
};

let cached: FirebaseClients | null = null;
let warnedMissingEnv = false;

export function getFirebase(): FirebaseClients {
  if (cached) return cached;

  const firebaseConfig = {
    apiKey: env("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: env("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: env("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    storageBucket: env("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: env("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
    appId: env("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };

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
      configured: false,
    };
    return cached;
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app);

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
  }

  cached = { auth, db, functions, configured: true };
  return cached;
}
