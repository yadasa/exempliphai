import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env var ${name}. Copy .env.example -> .env.local and fill it in.`,
    );
  }
  return v;
}

export type FirebaseClients = {
  auth: Auth;
  db: Firestore;
};

let cached: FirebaseClients | null = null;

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

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

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
  }

  cached = { auth, db };
  return cached;
}
