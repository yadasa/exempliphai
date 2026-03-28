// Exempliphai website → extension auth bridge.
//
// Goal: let the extension reuse the website's Firebase session.
// We detect the Firebase Web SDK auth record from the page origin's storage.
//
// Typical Firebase Web SDK key:
//   localStorage['firebase:authUser:<API_KEY>:[DEFAULT]']
// Value:
//   { uid, email, providerData: [...], stsTokenManager: { accessToken, refreshToken, expirationTime } }
//
// This script:
// - Responds to extension requests for the latest ID token
// - Proactively notifies the extension background when the token changes

(function () {
  const POLL_MS = 15_000;
  const KEY_PREFIX = 'firebase:authUser:';
  const CUSTOM_TOKEN_KEY = 'EXEMPLIPHAI_FIREBASE_CUSTOM_TOKEN';

  function safeParseJson(raw) {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function extractFirebaseAuthRecord(obj, keyHint) {
    try {
      if (!obj || typeof obj !== 'object') return null;

      const stm = obj.stsTokenManager || obj.sts_token_manager || {};
      const idToken = stm.accessToken || stm.access_token || '';
      const refreshToken = stm.refreshToken || stm.refresh_token || '';
      const expirationTime = stm.expirationTime || stm.expiration_time || 0;

      if (idToken && obj.uid) {
        return {
          uid: String(obj.uid || ''),
          email: obj.email ? String(obj.email) : '',
          providerId: obj?.providerData?.[0]?.providerId ? String(obj.providerData[0].providerId) : '',
          idToken: String(idToken),
          refreshToken: refreshToken ? String(refreshToken) : '',
          expiresAtMs: Number(expirationTime) || 0,
          key: String(keyHint || ''),
        };
      }
    } catch (_) {}

    return null;
  }

  function findFirebaseAuthRecordInWebStorage() {
    try {
      const stores = [];
      try { if (typeof localStorage !== 'undefined') stores.push(localStorage); } catch (_) {}
      try { if (typeof sessionStorage !== 'undefined') stores.push(sessionStorage); } catch (_) {}

      for (const st of stores) {
        if (!st) continue;
        for (let i = 0; i < st.length; i++) {
          const k = st.key(i);
          if (!k || !String(k).startsWith(KEY_PREFIX)) continue;
          const raw = st.getItem(k);
          if (!raw) continue;

          const obj = safeParseJson(raw);
          const rec = extractFirebaseAuthRecord(obj, k);
          if (rec) return rec;
        }
      }
    } catch (_) {}

    return null;
  }

  async function findFirebaseAuthRecordInIndexedDb() {
    // Firebase Auth default persistence is IndexedDB in modern SDKs.
    // The DB is typically: firebaseLocalStorageDb
    // Store: firebaseLocalStorage
    // Entries often contain keys like `firebase:authUser:<API_KEY>:[DEFAULT]`.
    try {
      if (typeof indexedDB === 'undefined') return null;

      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('firebaseLocalStorageDb');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });

      const tx = db.transaction(['firebaseLocalStorage'], 'readonly');
      const store = tx.objectStore('firebaseLocalStorage');

      const rows = await new Promise((resolve) => {
        const out = [];
        const cursorReq = store.openCursor();
        cursorReq.onerror = () => resolve(out);
        cursorReq.onsuccess = () => {
          const cur = cursorReq.result;
          if (!cur) {
            resolve(out);
            return;
          }
          out.push(cur.value);
          cur.continue();
        };
      });

      try { db.close(); } catch (_) {}

      for (const row of rows) {
        // Row shapes vary by Firebase versions.
        // Common shapes:
        // 1) { fbase_key: string, value: string }
        // 2) { key: string, value: string }
        // 3) { [key]: ..., value: ... }
        const k = String(row?.fbase_key || row?.key || row?.K || row?.name || '');
        if (!k || !k.startsWith(KEY_PREFIX)) continue;

        const raw = row?.value;
        const obj = typeof raw === 'string' ? safeParseJson(raw) : raw;
        const rec = extractFirebaseAuthRecord(obj, k);
        if (rec) return rec;
      }
    } catch (_) {}

    return null;
  }

  async function findFirebaseAuthRecord() {
    const fromWebStorage = findFirebaseAuthRecordInWebStorage();
    if (fromWebStorage) return fromWebStorage;
    return await findFirebaseAuthRecordInIndexedDb();
  }

  function payloadHash(p) {
    try {
      return [p?.uid, p?.expiresAtMs, (p?.idToken || '').slice(0, 24)].join('|');
    } catch (_) {
      return '';
    }
  }

  let lastSent = '';

  async function notifyBackgroundIfChanged() {
    try {
      const rec = await findFirebaseAuthRecord();
      if (!rec || !rec.uid || !rec.idToken) {
        if (lastSent !== 'CLEARED') {
          lastSent = 'CLEARED';
          chrome.runtime.sendMessage({ action: 'FIREBASE_AUTH_CLEAR' });
        }
        return;
      }

      const h = payloadHash(rec);
      if (h && h === lastSent) return;
      lastSent = h;

      chrome.runtime.sendMessage({
        action: 'FIREBASE_AUTH_UPDATE',
        uid: rec.uid,
        email: rec.email,
        providerId: rec.providerId,
        idToken: rec.idToken,
        refreshToken: rec.refreshToken,
        expiresAtMs: rec.expiresAtMs,
        source: 'siteAuthBridge',
      });
    } catch (_) {}
  }

  // Proactive polling.
  try {
    notifyBackgroundIfChanged().catch(() => {});
    setInterval(() => notifyBackgroundIfChanged().catch(() => {}), POLL_MS);
    window.addEventListener('storage', () => notifyBackgroundIfChanged().catch(() => {}));
  } catch (_) {}

  function getCustomToken() {
    try {
      const v = localStorage.getItem(CUSTOM_TOKEN_KEY);
      return v ? String(v).trim() : '';
    } catch (_) {
      return '';
    }
  }

  // Request/response API
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      // Preferred: pull Firebase Web SDK tokens
      if (msg?.action === 'EXEMPLIPHAI_GET_ID_TOKEN') {
        (async () => {
          const rec = await findFirebaseAuthRecord();
          if (!rec || !rec.uid || !rec.idToken) {
            sendResponse({ ok: false, reason: 'no_firebase_auth_found' });
            return;
          }

          sendResponse({ ok: true, ...rec });
        })().catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));

        // indicate async response
        return true;
      }

      // Back-compat: site can optionally mint and store a Firebase custom token
      if (msg?.action === 'EXEMPLIPHAI_GET_CUSTOM_TOKEN') {
        const token = getCustomToken();
        if (!token) {
          sendResponse({ ok: false, reason: 'no_custom_token_found', key: CUSTOM_TOKEN_KEY });
          return;
        }
        sendResponse({ ok: true, token });
        return;
      }

      sendResponse({ ok: false, ignored: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  });
})();
