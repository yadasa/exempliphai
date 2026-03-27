import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

function requireEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`Missing env var ${name}. Copy .env.example -> .env and fill it in.`);
  return String(v);
}

export type FirebaseClients = {
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
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
  const functions = getFunctions(app);
  const storage = getStorage(app);

  const useEmulators = String((import.meta as any).env?.VITE_FIREBASE_USE_EMULATORS || 'false').toLowerCase() === 'true';
  if (useEmulators) {
    const authUrl = String((import.meta as any).env?.VITE_FIREBASE_AUTH_EMULATOR_URL || 'http://localhost:9099');
    const fsHost = String((import.meta as any).env?.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST || 'localhost');
    const fsPort = Number((import.meta as any).env?.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080);
    const fnHost = String((import.meta as any).env?.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || 'localhost');
    const fnPort = Number((import.meta as any).env?.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5001);
    const stHost = String((import.meta as any).env?.VITE_FIREBASE_STORAGE_EMULATOR_HOST || 'localhost');
    const stPort = Number((import.meta as any).env?.VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9199);
    try {
      connectAuthEmulator(auth, authUrl, { disableWarnings: true });
    } catch (_) {}
    try {
      connectFirestoreEmulator(db, fsHost, fsPort);
    } catch (_) {}
    try {
      connectFunctionsEmulator(functions, fnHost, fnPort);
    } catch (_) {}
    try {
      connectStorageEmulator(storage, stHost, stPort);
    } catch (_) {}
  }

  cached = { auth, db, functions, storage };
  return cached;
}
