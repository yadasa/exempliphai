// MV3 Service Worker entry (bundled by Vite)
// - Imports the legacy background logic (list mode, alarms, message handlers)
// - Adds Firebase sync (Firestore/Storage) for extension data

import { initKillSwitch, isLocked } from './killSwitch';
import './legacyBackground.js';
import { initFirebaseExtensionSync } from './firebaseSync';
import { printAsciiArt } from '../utils/asciiArt';

// Console logo (service worker DevTools)
// DevTools often attaches after startup; print a few times.
try {
  printAsciiArt();
  setTimeout(() => printAsciiArt(), 800);
  setTimeout(() => printAsciiArt(), 2400);
} catch (_) {}

(async () => {
  try {
    await initKillSwitch();
  } catch (e) {
    // If killswitch init fails, do not block extension.
    console.warn('KillSwitch init failed:', e);
  }

  // If locked, do not initialize Firebase sync (reduces unnecessary network activity)
  try {
    const locked = await isLocked();
    if (locked) {
      console.warn('KillSwitch active: skipping Firebase sync init');
      return;
    }
  } catch (_) {}

  try {
    initFirebaseExtensionSync();
  } catch (e) {
    // Keep the extension usable even if Firebase env vars aren't configured.
    console.warn('Firebase sync disabled:', e);
  }
})();
