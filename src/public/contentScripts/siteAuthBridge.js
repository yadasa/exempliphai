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

  // Optional, website-controlled shadow record in localStorage to make bridging reliable
  // even when Firebase Auth persistence is IndexedDB.
  const SHADOW_AUTH_KEY = 'EXEMPLIPHAI_FIREBASE_AUTH_SHADOW';

  // Back-compat: custom token support (not currently used in the extension).
  const CUSTOM_TOKEN_KEY = 'EXEMPLIPHAI_FIREBASE_CUSTOM_TOKEN';

  function isDebug() {
    try { return localStorage.getItem('EXEMPLIPHAI_DEBUG_AUTH_BRIDGE') === '1'; } catch (_) { return false; }
  }

  function debug(...args) {
    try { if (isDebug()) console.debug('[siteAuthBridge]', ...args); } catch (_) {}
  }

  function safeParseJson(raw) {
    try {
      if (typeof raw !== 'string') return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function normalizeMaybeWrappedAuthObj(obj) {
    // Some Firebase/localStorage adapters wrap values.
    // Common shapes:
    //   { value: "{...}" }
    //   { value: { ... } }
    //   { currentUser: { ... } }
    //   { auth: { ... } }
    try {
      let cur = obj;
      for (let i = 0; i < 4; i++) {
        if (!cur || typeof cur !== 'object') break;
        if (cur.currentUser && typeof cur.currentUser === 'object') { cur = cur.currentUser; continue; }
        if (cur.auth && typeof cur.auth === 'object') { cur = cur.auth; continue; }
        if (Object.prototype.hasOwnProperty.call(cur, 'value')) {
          const v = cur.value;
          if (typeof v === 'string') {
            const p = safeParseJson(v);
            if (p && typeof p === 'object') { cur = p; continue; }
          }
          if (v && typeof v === 'object') { cur = v; continue; }
        }
        break;
      }
      return cur;
    } catch (_) {
      return obj;
    }
  }

  function extractFirebaseAuthRecord(obj, keyHint) {
    try {
      obj = normalizeMaybeWrappedAuthObj(obj);
      if (!obj || typeof obj !== 'object') return null;

      let stm = obj.stsTokenManager || obj.sts_token_manager || obj.tokenManager || obj.token_manager || {};
      if (typeof stm === 'string') {
        const p = safeParseJson(stm);
        if (p && typeof p === 'object') stm = p;
      }

      const idToken = stm.accessToken || stm.access_token || stm.idToken || stm.id_token || '';
      const refreshToken = stm.refreshToken || stm.refresh_token || '';
      const expirationTime = stm.expirationTime || stm.expiration_time || stm.expiresAt || stm.expires_at || 0;

      const uid = obj.uid || obj.userId || obj.user_id || obj.localId || '';

      if (idToken && uid) {
        return {
          uid: String(uid || ''),
          email: obj.email ? String(obj.email) : '',
          providerId: obj?.providerData?.[0]?.providerId ? String(obj.providerData[0].providerId) : (obj.providerId ? String(obj.providerId) : ''),
          idToken: String(idToken),
          refreshToken: refreshToken ? String(refreshToken) : '',
          expiresAtMs: Number(expirationTime) || 0,
          key: String(keyHint || ''),
        };
      }

      debug('extractFirebaseAuthRecord: missing token/uid', { keyHint, hasUid: !!uid, hasToken: !!idToken, stmType: typeof stm });
    } catch (e) {
      debug('extractFirebaseAuthRecord: error', { keyHint, error: String(e?.message || e) });
    }

    return null;
  }

  function findFirebaseAuthRecordInWebStorage() {
    try {
      // 1) Prefer the website-provided shadow record (if present)
      try {
        const rawShadow = localStorage.getItem(SHADOW_AUTH_KEY);
        if (rawShadow) {
          debug('shadow key present');
          const shadowObj = safeParseJson(rawShadow);
          const rec = extractFirebaseAuthRecord(shadowObj, SHADOW_AUTH_KEY);
          if (rec) return rec;
          debug('shadow key parse failed', { len: String(rawShadow || '').length });
        } else {
          debug('shadow key missing');
        }
      } catch (e) {
        debug('shadow key read error', String(e?.message || e));
      }

      // 2) Otherwise fall back to scanning Firebase authUser keys
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
          if (!obj) {
            debug('authUser key JSON parse failed', { key: k, len: String(raw || '').length });
            continue;
          }

          const rec = extractFirebaseAuthRecord(obj, k);
          if (rec) return rec;
        }
      }
    } catch (e) {
      debug('findFirebaseAuthRecordInWebStorage error', String(e?.message || e));
    }

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

        // Row value shapes vary by Firebase versions.
        // We try a few common patterns:
        // - stringified JSON
        // - object with nested { value: <string|object> }
        // - object itself
        let raw = row?.value;
        if (raw && typeof raw === 'object' && 'value' in raw) raw = raw.value;
        if (raw && typeof raw === 'object' && 'value' in raw) raw = raw.value;

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
        debug('no auth found');
        if (lastSent !== 'CLEARED') {
          lastSent = 'CLEARED';
          chrome.runtime.sendMessage({ action: 'FIREBASE_AUTH_CLEAR', source: 'siteAuthBridge' }, () => {
            const e = chrome?.runtime?.lastError;
            if (e) debug('sendMessage FIREBASE_AUTH_CLEAR failed', String(e.message || e));
          });
        }
        return;
      }

      const h = payloadHash(rec);
      if (h && h === lastSent) return;
      lastSent = h;

      debug('auth changed → FIREBASE_AUTH_UPDATE', { uid: rec.uid, email: rec.email, providerId: rec.providerId, expiresAtMs: rec.expiresAtMs, key: rec.key });

      chrome.runtime.sendMessage(
        {
          action: 'FIREBASE_AUTH_UPDATE',
          uid: rec.uid,
          email: rec.email,
          providerId: rec.providerId,
          idToken: rec.idToken,
          refreshToken: rec.refreshToken,
          expiresAtMs: rec.expiresAtMs,
          source: 'siteAuthBridge',
        },
        () => {
          const e = chrome?.runtime?.lastError;
          if (e) debug('sendMessage FIREBASE_AUTH_UPDATE failed', String(e.message || e));
        }
      );
    } catch (e) {
      debug('notifyBackgroundIfChanged error', String(e?.message || e));
    }
  }

  // Proactive polling.
  try {
    notifyBackgroundIfChanged().catch(() => {});
    setInterval(() => notifyBackgroundIfChanged().catch(() => {}), POLL_MS);
    window.addEventListener('storage', () => notifyBackgroundIfChanged().catch(() => {}));

    // Faster wakeups: when the page regains focus or the auth provider notifies.
    window.addEventListener('focus', () => notifyBackgroundIfChanged().catch(() => {}));
    document.addEventListener('visibilitychange', () => notifyBackgroundIfChanged().catch(() => {}));
    window.addEventListener('exempliphai-auth-changed', () => notifyBackgroundIfChanged().catch(() => {}));
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

      // Debug helper: quick visibility into what the bridge can see.
      if (msg?.action === 'EXEMPLIPHAI_DEBUG_DUMP_AUTH') {
        (async () => {
          const rec = await findFirebaseAuthRecord();
          const dump = { shadow: null, keys: [] };

          try {
            const rawShadow = localStorage.getItem(SHADOW_AUTH_KEY);
            dump.shadow = rawShadow ? safeParseJson(rawShadow) : null;
          } catch (_) {}

          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (!k || !String(k).startsWith(KEY_PREFIX)) continue;
              const raw = localStorage.getItem(k);
              dump.keys.push({ key: k, ok: !!safeParseJson(raw || '') });
            }
          } catch (_) {}

          sendResponse({ ok: true, rec: rec || null, dump });
        })().catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));

        return true;
      }

      // Request: clear website Firebase session (so the extension can't instantly re-auth from the website tab)
      if (msg?.action === 'EXEMPLIPHAI_SITE_SIGN_OUT') {
        (async () => {
          try {
            // Remove shadow + custom token
            try { localStorage.removeItem(SHADOW_AUTH_KEY); } catch (_) {}
            try { localStorage.removeItem(CUSTOM_TOKEN_KEY); } catch (_) {}

            // Remove Firebase auth keys from localStorage/sessionStorage
            const stores = [];
            try { if (typeof localStorage !== 'undefined') stores.push(localStorage); } catch (_) {}
            try { if (typeof sessionStorage !== 'undefined') stores.push(sessionStorage); } catch (_) {}

            for (const st of stores) {
              if (!st) continue;
              const toDelete = [];
              for (let i = 0; i < st.length; i++) {
                const k = st.key(i);
                if (k && String(k).startsWith(KEY_PREFIX)) toDelete.push(k);
              }
              for (const k of toDelete) {
                try { st.removeItem(k); } catch (_) {}
              }
            }

            // Clear IndexedDB Firebase persistence (best effort)
            try {
              if (typeof indexedDB !== 'undefined') {
                // Most reliable: delete the whole db
                indexedDB.deleteDatabase('firebaseLocalStorageDb');
              }
            } catch (_) {}

            // Nudge the bridge to re-evaluate and notify SW
            try { window.dispatchEvent(new Event('exempliphai-auth-changed')); } catch (_) {}

            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
          }
        })();

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
