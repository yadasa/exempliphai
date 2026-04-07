// MV3 Service Worker entry (bundled by Vite)
// - Imports the legacy background logic (list mode, alarms, message handlers)
// - Adds Firebase sync (Firestore/Storage) for extension data

import './legacyBackground.js';
import { initFirebaseExtensionSync } from './firebaseSync';
import { printAsciiArt } from '../utils/asciiArt';

// Console logo (service worker DevTools)
try {
  printAsciiArt();
} catch (_) {}

try {
  initFirebaseExtensionSync();
} catch (e) {
  // Keep the extension usable even if Firebase env vars aren't configured.
  console.warn('Firebase sync disabled:', e);
}
