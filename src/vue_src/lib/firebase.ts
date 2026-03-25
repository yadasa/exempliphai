import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';

function requireEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`Missing env var ${name}. Copy .env.example -> .env and fill it in.`);
  return String(v);
}

export type FirebaseClients = {
  auth: Auth;
  db: Firestore;
};

let cached: FirebaseClients | null = null;

export function getFirebase(): FirebaseClients {
  if (cached) return cached;

  const firebaseConfig = {
    apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
    authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: requireEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requireEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requireEnv('VITE_FIREBASE_APP_ID'),
  };

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const useEmulators = String((import.meta as any).env?.VITE_FIREBASE_USE_EMULATORS || 'false').toLowerCase() === 'true';
  if (useEmulators) {
    const authUrl = String((import.meta as any).env?.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://localhost:9099');
    const fsHost = String((import.meta as any).env?.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST || 'localhost');
    const fsPort = Number((import.meta as any).env?.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080);
    try {
      connectAuthEmulator(auth, authUrl, { disableWarnings: true });
    } catch (_) {}
    try {
      connectFirestoreEmulator(db, fsHost, fsPort);
    } catch (_) {}
  }

  cached = { auth, db };
  return cached;
}
