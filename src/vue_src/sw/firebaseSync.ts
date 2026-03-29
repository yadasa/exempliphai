// Firebase backend integration for the MV3 service worker.
//
// Auth: pulled from exempliph.ai / exempliphai.com pages by contentScripts/siteAuthBridge.js
// and stored in chrome.storage.local.firebaseAuth.
//
// Data:
// - users/{uid} (sync/profile + settings + stats)
// - users/{uid}/autofills/* (tracking)
// - users/{uid}/customAnswers/* (tracking)
// - users/{uid}/appliedJobs/* (tracking)
// - users/{uid}/jobSearches/* (tracking)
//
// Offline: a small IndexedDB queue retries writes when auth/network is unavailable.

type FirebaseAuthState = {
  uid: string;
  idToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  email?: string;
  providerId?: string;
  updatedAtMs: number;
};

type QueueOp = {
  id?: number;
  kind:
    | 'firestorePatchDoc'
    | 'firestoreUpdateDoc'
    | 'firestoreCreateDoc'
    | 'firestoreDeleteDoc'
    | 'firestoreCommit'
    | 'storageUpload';
  payload: any;
  createdAtMs: number;
  tries: number;
  lastError?: string;
};

const ENV = (import.meta as any).env || {};

const DEBUG_AUTH = String((ENV as any).VITE_DEBUG_AUTH || '') === '1';
function dbg(...args: any[]) {
  try {
    if (DEBUG_AUTH) console.debug('FirebaseSync[auth]', ...args);
  } catch (_) {}
}

const FIREBASE = {
  apiKey: String(ENV.VITE_FIREBASE_API_KEY || ''),
  projectId: String(ENV.VITE_FIREBASE_PROJECT_ID || ''),
  storageBucket: String(ENV.VITE_FIREBASE_STORAGE_BUCKET || ''),
};

const FIRESTORE_BASE = () =>
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE.projectId)}/databases/(default)/documents`;

const FIRESTORE_COMMIT = () =>
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE.projectId)}/databases/(default)/documents:commit`;

const SECURE_TOKEN = () =>
  `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE.apiKey)}`;

const STORAGE_UPLOAD_BASE = () =>
  `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(FIREBASE.storageBucket)}/o`;

const AUTOSAVE_ALARM = 'FIREBASE_AUTOSAVE_JOBFIELDS';
const FLUSH_ALARM_PERIODIC = 'FIREBASE_SYNC_FLUSH_QUEUE_PERIODIC';
const FLUSH_ALARM_SOON = 'FIREBASE_SYNC_FLUSH_QUEUE_SOON';

// Auth: keep trying to connect to an open Exempliph tab even if the popup closes.
// Alarms can only run at 1-minute granularity, so we combine an alarm wake-up
// with a short in-memory interval while the SW is alive.
const AUTH_POLL_ALARM = 'FIREBASE_AUTH_POLL_ALARM';
const AUTH_POLL_ALARM_PERIOD_MIN = 1;
const AUTH_POLL_INTERVAL_MS = 10_000;

// Profile pull: bring website-written updates (Firestore → chrome.storage) back into the extension.
// There is no realtime listener in the MV3 SW; we do a lightweight periodic pull.

let authState: FirebaseAuthState | null = null;
let applyingRemote = false;
let autosaveScheduledAt = 0;
let appliedJobsSyncScheduledAt = 0;
let jobSearchSyncScheduledAt = 0;

let authPollTimer: any = null;
let authPollInFlight = false;
let lastAuthPollAt = 0;

// Immediate jobFields sync: push a snapshot as soon as relevant storage keys change.
// We keep the 30s alarm-based autosave as a fallback, but the primary path is instant.
let immediateJobFieldsPushInFlight = false;
let immediateJobFieldsPushQueued = false;
let immediateJobFieldsPushTimer: any = null;
let immediateJobFieldsPushLastAt = 0;
// Debounce writes so rapid typing collapses into a single Firestore update.
// Acceptance target: visible in Firestore within ~5s of last edit.
const IMMEDIATE_JOBFIELDS_PUSH_THROTTLE_MS = 5000;
const PULL_PROFILE_ALARM = 'PULL_PROFILE_ALARM';
const PULL_PROFILE_PERIOD_MIN = 1;
let profilePullInFlight = false;
let profilePullQueued = false;
let lastProfilePullAt = 0;
const PULL_PROFILE_THROTTLE_MS = 30_000;  // Lite pull every 30s, full every 1min

// Avoid pulling while the user is actively editing locally (prevents overwriting).
let lastLocalJobFieldsChangeAt = 0;

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB queue
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'exempliphai_firebase_sync_queue';
const DB_VERSION = 1;
const STORE = 'ops';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function enqueue(op: Omit<QueueOp, 'id' | 'tries'> & { tries?: number }): Promise<number> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    const next = { ...op, tries: op.tries ?? 0 } satisfies QueueOp;

    // Coalesce: if we already have a pending write for the same document path,
    // drop the older one and keep only the most recent.
    const shouldCoalesce = next.kind === 'firestorePatchDoc' || next.kind === 'firestoreUpdateDoc';
    const nextPath = shouldCoalesce ? String(next?.payload?.path || '') : '';

    const addNext = () => {
      const req = store.add(next);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result as number);
    };

    if (!shouldCoalesce || !nextPath) {
      addNext();
      return;
    }

    const cursorReq = store.openCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) {
        addNext();
        return;
      }

      try {
        const v = cur.value as QueueOp;
        if ((v.kind === 'firestorePatchDoc' || v.kind === 'firestoreUpdateDoc') && String(v?.payload?.path || '') === nextPath) {
          cur.delete();
        }
      } catch (_) {}

      cur.continue();
    };
  });
}

async function listOps(limit = 25): Promise<QueueOp[]> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const out: QueueOp[] = [];

    const cursorReq = store.openCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur || out.length >= limit) {
        resolve(out);
        return;
      }
      out.push(cur.value as QueueOp);
      cur.continue();
    };
  });
}

async function updateOp(op: QueueOp): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put(op);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

async function deleteOp(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function base64UrlDecode(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(b64);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes.charCodeAt(i));
  return out;
}

function parseJwt(token: string): any {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

function domainFromUrl(url: string): string {
  try {
    const u = new URL(String(url || ''));
    return u.hostname;
  } catch {
    return '';
  }
}

function nowIso() {
  return new Date().toISOString();
}

function requireFirebaseConfig(): boolean {
  return !!(FIREBASE.apiKey && FIREBASE.projectId && FIREBASE.storageBucket);
}

function isExempliphUrl(url: string): boolean {
  try {
    const u = new URL(String(url || ''));
    const h = u.hostname.toLowerCase();
    return h === 'exempliph.ai' || h === 'www.exempliph.ai' || h === 'exempliphai.com' || h === 'www.exempliphai.com';
  } catch {
    return false;
  }
}

async function getIdTokenFromTab(tabId: number): Promise<any> {
  return await new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { action: 'EXEMPLIPHAI_GET_ID_TOKEN' }, (resp) => {
        const e = chrome?.runtime?.lastError;
        if (e) {
          dbg('tabs.sendMessage(EXEMPLIPHAI_GET_ID_TOKEN) failed', { tabId, error: e.message || String(e) });
          resolve({ ok: false, error: e.message || String(e) });
        } else {
          resolve(resp || { ok: false });
        }
      });
    } catch (e: any) {
      dbg('tabs.sendMessage threw', { tabId, error: String(e?.message || e) });
      resolve({ ok: false, error: String(e?.message || e) });
    }
  });
}

async function tryAuthFromAnyExempliphTab(reason: string): Promise<boolean> {
  if (authPollInFlight) return false;
  if (Date.now() - lastAuthPollAt < 2_000) return false;
  if (authState?.uid && authState?.idToken) return true;

  authPollInFlight = true;
  lastAuthPollAt = Date.now();

  try {
    const tabs = await chrome.tabs.query({
      url: [
        '*://exempliph.ai/*',
        '*://www.exempliph.ai/*',
        '*://exempliphai.com/*',
        '*://www.exempliphai.com/*',
      ],
    });

    dbg('auth poll', { reason, candidateTabs: (tabs || []).map((t) => ({ id: t?.id || null, url: t?.url || '' })) });

    for (const t of tabs || []) {
      if (!t?.id) continue;
      if (t.url && !isExempliphUrl(String(t.url))) continue;
      const rec = await getIdTokenFromTab(t.id);
      if (rec?.ok === true && rec?.uid && rec?.idToken) {
        dbg('auth pull succeeded from tab', { reason, tabId: t.id, source: rec?.key || rec?.source || null });
        const jwt = parseJwt(String(rec.idToken || ''));
        const uid = String(rec.uid || jwt?.user_id || jwt?.sub || '').trim();
        const email = String(rec.email || jwt?.email || '').trim();

        const next: FirebaseAuthState = {
          uid,
          idToken: String(rec.idToken || '').trim(),
          refreshToken: rec.refreshToken ? String(rec.refreshToken).trim() : undefined,
          expiresAtMs: Number.isFinite(rec.expiresAtMs) ? Number(rec.expiresAtMs) : undefined,
          email: email || undefined,
          providerId: String(rec.providerId || jwt?.firebase?.sign_in_provider || ''),
          updatedAtMs: Date.now(),
        };

        authState = next;
        await setStoredAuth(next);
        await pullFromCloudAndPopulateLocal().catch(() => {});
        pullProfileFromCloudNow('full');
        // scheduleAutosave('jobFields'); // removed: jobFields now sync immediately on storage changes
        scheduleFlushSoon();

        return true;
      }
    }

    return false;
  } catch (e) {
    console.debug('FirebaseSync: auth pull failed', reason, e);
    return false;
  } finally {
    authPollInFlight = false;
  }
}

async function getStoredAuth(): Promise<FirebaseAuthState | null> {
  const got = await chrome.storage.local.get(['firebaseAuth']);
  const st = (got as any)?.firebaseAuth;
  if (!st || typeof st !== 'object') return null;
  if (!st.uid || !st.idToken) return null;
  return {
    uid: String(st.uid),
    idToken: String(st.idToken),
    refreshToken: st.refreshToken ? String(st.refreshToken) : undefined,
    expiresAtMs: Number.isFinite(st.expiresAtMs) ? Number(st.expiresAtMs) : undefined,
    email: st.email ? String(st.email) : undefined,
    providerId: st.providerId ? String(st.providerId) : undefined,
    updatedAtMs: Number.isFinite(st.updatedAtMs) ? Number(st.updatedAtMs) : Date.now(),
  };
}

async function setStoredAuth(next: FirebaseAuthState | null) {
  if (!next) {
    await chrome.storage.local.remove(['firebaseAuth']);
    return;
  }
  await chrome.storage.local.set({ firebaseAuth: next });
}

async function ensureFreshIdToken(): Promise<FirebaseAuthState | null> {
  if (!authState) return null;
  if (!requireFirebaseConfig()) return null;

  const exp = Number(authState.expiresAtMs || 0);
  const needsRefresh = !!(authState.refreshToken && exp && Date.now() > exp - 2 * 60_000);
  if (!needsRefresh) return authState;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(authState.refreshToken || ''),
    });

    const res = await fetch(SECURE_TOKEN(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || `securetoken HTTP ${res.status}`);
    }

    const idToken = String(json.access_token || '');
    const refreshToken = String(json.refresh_token || authState.refreshToken || '');
    const expiresInSec = Number(json.expires_in || 0);
    const uid = String(json.user_id || authState.uid);

    const next: FirebaseAuthState = {
      ...authState,
      uid,
      idToken,
      refreshToken,
      expiresAtMs: expiresInSec ? Date.now() + expiresInSec * 1000 : authState.expiresAtMs,
      updatedAtMs: Date.now(),
    };

    authState = next;
    await setStoredAuth(next);
    return next;
  } catch (e) {
    console.warn('FirebaseSync: token refresh failed', e);
    return authState;
  }
}

function toFirestoreValue(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };

  const t = typeof v;
  if (t === 'string') return { stringValue: v };
  if (t === 'boolean') return { booleanValue: v };
  if (t === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }

  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map((x) => toFirestoreValue(x)) } };
  }

  if (t === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, vv] of Object.entries(v)) {
      fields[k] = toFirestoreValue(vv);
    }
    return { mapValue: { fields } };
  }

  return { stringValue: String(v) };
}

function fromFirestoreValue(v: any): any {
  if (!v || typeof v !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(v, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(v, 'stringValue')) return String(v.stringValue);
  if (Object.prototype.hasOwnProperty.call(v, 'booleanValue')) return !!v.booleanValue;
  if (Object.prototype.hasOwnProperty.call(v, 'integerValue')) return Number(v.integerValue);
  if (Object.prototype.hasOwnProperty.call(v, 'doubleValue')) return Number(v.doubleValue);
  if (Object.prototype.hasOwnProperty.call(v, 'timestampValue')) return String(v.timestampValue);
  if (Object.prototype.hasOwnProperty.call(v, 'arrayValue')) {
    const arr = v.arrayValue?.values;
    return Array.isArray(arr) ? arr.map(fromFirestoreValue) : [];
  }
  if (Object.prototype.hasOwnProperty.call(v, 'mapValue')) {
    const f = v.mapValue?.fields || {};
    const out: any = {};
    for (const [k, vv] of Object.entries(f)) out[k] = fromFirestoreValue(vv);
    return out;
  }
  return null;
}

function docFields(data: Record<string, any>): any {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data || {})) fields[k] = toFirestoreValue(v);
  return { fields };
}

async function authedFetch(url: string, init: RequestInit = {}) {
  const st = await ensureFreshIdToken();
  if (!st?.idToken) throw new Error('no_auth');

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${st.idToken}`);
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  return await fetch(url, { ...init, headers });
}

async function firestoreGetDoc(path: string): Promise<any | null> {
  const url = `${FIRESTORE_BASE()}/${path}`;
  const res = await authedFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestoreGetDoc ${res.status}`);
  const json = (await res.json()) as any;
  return json;
}

async function firestorePatchDoc(path: string, data: Record<string, any>): Promise<void> {
  const top = Object.keys(data || {});
  const qs = top.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
  const url = `${FIRESTORE_BASE()}/${path}?${qs}`;
  const body = JSON.stringify(docFields(data));
  const res = await authedFetch(url, { method: 'PATCH', body });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`firestorePatchDoc ${res.status}: ${t.slice(0, 300)}`);
  }
}

// Field-level update with a custom updateMask (including nested field paths).
// NOTE: field paths may include backticks to escape spaces, e.g. "sync.`Full Name`".
async function firestoreUpdateDoc(path: string, data: Record<string, any>, fieldPaths: string[]): Promise<void> {
  const fps = Array.from(new Set((fieldPaths || []).filter(Boolean)));
  if (!fps.length) return;
  const qs = fps.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
  const url = `${FIRESTORE_BASE()}/${path}?${qs}`;
  const body = JSON.stringify(docFields(data));
  const res = await authedFetch(url, { method: 'PATCH', body });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`firestoreUpdateDoc ${res.status}: ${t.slice(0, 300)}`);
  }
}

function parseFirestoreFieldPath(path: string): string[] {
  const s = String(path || '');
  const out: string[] = [];
  let cur = '';
  let inTick = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '`') {
      inTick = !inTick;
      continue;
    }
    if (!inTick && ch === '.') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.filter((x) => x.length > 0);
}

function setNestedValue(obj: any, segments: string[], value: any) {
  if (!segments.length) return;
  let cur = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[segments[segments.length - 1]] = value;
}

async function firestoreDeleteDoc(path: string): Promise<void> {
  const url = `${FIRESTORE_BASE()}/${path}`;
  const res = await authedFetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const t = await res.text().catch(() => '');
    throw new Error(`firestoreDeleteDoc ${res.status}: ${t.slice(0, 300)}`);
  }
}

async function firestoreCreateDoc(collectionPath: string, data: Record<string, any>): Promise<void> {
  const url = `${FIRESTORE_BASE()}/${collectionPath}`;
  const body = JSON.stringify(docFields(data));
  const res = await authedFetch(url, { method: 'POST', body });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`firestoreCreateDoc ${res.status}: ${t.slice(0, 300)}`);
  }
}

async function firestoreRunQuery(parentDocPath: string, structuredQuery: any): Promise<any[]> {
  const url = `${FIRESTORE_BASE()}/${parentDocPath}:runQuery`;
  const res = await authedFetch(url, { method: 'POST', body: JSON.stringify({ structuredQuery }) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`firestoreRunQuery ${res.status}: ${t.slice(0, 300)}`);
  }

  const rows = (await res.json().catch(() => [])) as any[];
  const docs: any[] = [];
  for (const r of rows || []) {
    if (r?.document) docs.push(r.document);
  }
  return docs;
}

async function firestoreCommit(writes: any[]): Promise<void> {
  const url = FIRESTORE_COMMIT();
  const res = await authedFetch(url, { method: 'POST', body: JSON.stringify({ writes }) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`firestoreCommit ${res.status}: ${t.slice(0, 300)}`);
  }
}

function userDocName(uid: string): string {
  return `projects/${FIREBASE.projectId}/databases/(default)/documents/users/${uid}`;
}

async function incrementStats({ autofills = 0, customAnswersGenerated = 0, setLastAutofill = false } = {}) {
  if (!authState) return;
  const uid = authState.uid;

  const transforms: any[] = [];
  if (autofills) {
    transforms.push({
      fieldPath: 'stats.autofills.total',
      increment: { integerValue: String(autofills) },
    });
    if (setLastAutofill) {
      transforms.push({
        fieldPath: 'stats.lastAutofill',
        setToServerValue: 'REQUEST_TIME',
      });
    }
  }

  if (customAnswersGenerated) {
    transforms.push({
      fieldPath: 'stats.customAnswersGenerated.total',
      increment: { integerValue: String(customAnswersGenerated) },
    });
  }

  if (!transforms.length) return;

  await firestoreCommit([
    {
      transform: {
        document: userDocName(uid),
        fieldTransforms: transforms,
      },
    },
  ]);
}

async function enqueueStatsIncrement({
  autofills = 0,
  customAnswersGenerated = 0,
  setLastAutofill = false,
  setLastCustomAnswer = false,
} = {}): Promise<boolean> {
  if (!authState) return false;

  const uid = authState.uid;
  const transforms: any[] = [];

  if (autofills) {
    transforms.push({ fieldPath: 'stats.autofills.total', increment: { integerValue: String(autofills) } });
    if (setLastAutofill) transforms.push({ fieldPath: 'stats.lastAutofill', setToServerValue: 'REQUEST_TIME' });
  }

  if (customAnswersGenerated) {
    transforms.push({
      fieldPath: 'stats.customAnswersGenerated.total',
      increment: { integerValue: String(customAnswersGenerated) },
    });
    if (setLastCustomAnswer) transforms.push({ fieldPath: 'stats.lastCustomAnswer', setToServerValue: 'REQUEST_TIME' });
  }

  if (!transforms.length) return false;

  await enqueue({
    kind: 'firestoreCommit',
    payload: {
      writes: [
        {
          transform: {
            document: userDocName(uid),
            fieldTransforms: transforms,
          },
        },
      ],
    },
    createdAtMs: Date.now(),
  });

  // Local cache for quick UI.
  try {
    const got = await chrome.storage.local.get(['cloudStats']);
    const cur = ((got as any).cloudStats || {}) as any;

    const next: any = { ...cur };

    if (autofills) {
      next.autofills = { total: Number(cur?.autofills?.total || 0) + Number(autofills || 0) };
      if (setLastAutofill) next.lastAutofill = nowIso();
    }

    if (customAnswersGenerated) {
      next.customAnswersGenerated = {
        total: Number(cur?.customAnswersGenerated?.total || 0) + Number(customAnswersGenerated || 0),
      };
      if (setLastCustomAnswer) next.lastCustomAnswer = nowIso();
    }

    await chrome.storage.local.set({ cloudStats: next });
  } catch (_) {}

  scheduleFlushSoon();
  return true;
}

async function ensureUserRootDoc() {
  if (!authState) return;
  const uid = authState.uid;

  const existing = await firestoreGetDoc(`users/${uid}`).catch(() => null);

  const baseSettings = await new Promise<any>((resolve) => {
    chrome.storage.sync.get(
      [
        'ThemeSetting',
        'PrivacyToggle',
        'aiMappingEnabled',
        'autoSubmitEnabled',
        'autoTailorEnabled',
        'listModeEnabled',
        'closePreviousTabs',
        'autofillDelayMs',
      ],
      (res) => resolve(res || {})
    );
  });

  const settings = {
    ThemeSetting: baseSettings.ThemeSetting || 'light',
    PrivacyToggle: baseSettings.PrivacyToggle === true,
    aiMappingEnabled: baseSettings.aiMappingEnabled === true,
    autoSubmitEnabled: baseSettings.autoSubmitEnabled === true,
    autoTailorEnabled: baseSettings.autoTailorEnabled === true,
    listModeEnabled: baseSettings.listModeEnabled === true,
    closePreviousTabs: baseSettings.closePreviousTabs === true,
    autofillDelayMs: Number.isFinite(baseSettings.autofillDelayMs) ? Number(baseSettings.autofillDelayMs) : 2500,
  };

  const next: any = {
    settings,
    account: {
      uid,
      email: authState.email || null,
      providerId: authState.providerId || null,
    },
    updatedAt: new Date(),
  };

  if (!existing) {
    next.createdAt = new Date();
    next.stats = {
      autofills: { total: 0 },
      customAnswersGenerated: { total: 0 },
      lastAutofill: null,
    };
  }

  // Patch creates the doc if it doesn't exist.
  await firestorePatchDoc(`users/${uid}`, next);
}

function filterSyncForCloud(syncAll: Record<string, any>): Record<string, any> {
  const blocked = new Set([
    'API Key',
    // Legacy experimental toggle (we now use Firebase)
    'cloudSyncEnabled',
    'AppliedJobsSync',
  ]);

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(syncAll || {})) {
    if (blocked.has(k)) continue;
    out[k] = v;
  }
  return out;
}

const FIREBASE_SYNC_STATUS_KEY = 'firebaseSync_status';
const FIREBASE_SYNC_DIRTY_KEY = 'firebaseSync_dirty';

let lastCloudSyncSnapshot: Record<string, any> | null = null;
let lastLocalProfileSnapshot: any | null = null;
let lastLocalUploadsSnapshot: any | null = null;
let lastTailoredResumeSnapshot: any | null = null;

async function setSyncStatus(status: 'saving' | 'synced' | 'offline') {
  try {
    await chrome.storage.local.set({ [FIREBASE_SYNC_STATUS_KEY]: status });
  } catch (_) {}
}

async function setDirty(dirty: boolean) {
  try {
    await chrome.storage.local.set({ [FIREBASE_SYNC_DIRTY_KEY]: dirty });
  } catch (_) {}
}

function isEqualJson(a: any, b: any) {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

function escapeFieldPathSegment(seg: string) {
  // Backtick-escape any segment containing spaces or punctuation.
  // Firestore field paths support backticks (also used in the SDK).
  return /^[A-Za-z0-9_]+$/.test(seg) ? seg : `\`${seg.replace(/`/g, '\\`')}\``;
}

async function pushProfileUpdates() {
  if (!authState) return;
  if (!requireFirebaseConfig()) return;

  // Ensure root user doc exists for account/stats, but do NOT write profile fields here.
  await ensureUserRootDoc().catch(() => {});

  const uid = authState.uid;
  const profileDocPath = `users/${uid}/profile/current`;

  // Collect current state.
  const syncAll = (await new Promise<Record<string, any>>((resolve) => {
    chrome.storage.sync.get(null, (res) => resolve((res as any) || {}));
  })) as any;
  const sync = filterSyncForCloud(syncAll);

  const local = (await chrome.storage.local.get([
    'Resume_details',
    'LOCAL_PROFILE',
    'EXEMPLIPHAI_LOCAL_PROFILE',
    'Resume_tailored_text',
    'Resume_tailored_meta',
    'Resume_tailored_name',
    // Upload metadata (NOT base64 blobs)
    'uploads_resume',
    'uploads_coverLetter',
    'uploads_tailored_resume',
  ]).catch(() => ({} as any))) as any;

  const resumeDetails = local?.Resume_details ?? null;

  const localProfile =
    local?.LOCAL_PROFILE != null
      ? local.LOCAL_PROFILE
      : local?.EXEMPLIPHAI_LOCAL_PROFILE != null
        ? local.EXEMPLIPHAI_LOCAL_PROFILE
        : null;

  const tailoredResume: any = {};
  if (typeof local?.Resume_tailored_text === 'string') tailoredResume.text = local.Resume_tailored_text;
  if (local?.Resume_tailored_meta && typeof local.Resume_tailored_meta === 'object') tailoredResume.meta = local.Resume_tailored_meta;
  if (typeof local?.Resume_tailored_name === 'string') tailoredResume.name = local.Resume_tailored_name;
  const tailoredResumeFinal = Object.keys(tailoredResume).length ? tailoredResume : null;

  const uploads: any = {};
  if (local?.uploads_resume && typeof local.uploads_resume === 'object') uploads.resume = local.uploads_resume;
  if (local?.uploads_coverLetter && typeof local.uploads_coverLetter === 'object') uploads.coverLetter = local.uploads_coverLetter;
  if (local?.uploads_tailored_resume && typeof local.uploads_tailored_resume === 'object') uploads.tailoredResume = local.uploads_tailored_resume;
  const uploadsFinal = Object.keys(uploads).length ? uploads : null;

  // Compute diffs (field-level where possible).
  const updatesByFieldPath: Record<string, any> = {};
  const updateMask: string[] = [];

  // Always bump updatedAt when anything changes.
  let anyChange = false;

  // sync.* (granular)
  if (!lastCloudSyncSnapshot) {
    // First push: write all sync keys as individual updates.
    for (const [k, v] of Object.entries(sync || {})) {
      const fp = `sync.${escapeFieldPathSegment(k)}`;
      updatesByFieldPath[fp] = v;
      updateMask.push(fp);
      anyChange = true;
    }
  } else {
    const prev = lastCloudSyncSnapshot || {};
    const next = sync || {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of keys) {
      if (isEqualJson(prev[k], next[k])) continue;
      const fp = `sync.${escapeFieldPathSegment(k)}`;
      updatesByFieldPath[fp] = next[k] ?? null;
      updateMask.push(fp);
      anyChange = true;
    }
  }

  // resumeDetails (whole object)
  if (!lastLocalProfileSnapshot || !isEqualJson(lastLocalProfileSnapshot.resumeDetails, resumeDetails)) {
    updatesByFieldPath['resumeDetails'] = resumeDetails;
    updateMask.push('resumeDetails');
    updatesByFieldPath['resumeDetailsUpdatedAt'] = new Date();
    updateMask.push('resumeDetailsUpdatedAt');
    anyChange = true;
  }

  // localProfile (whole object)
  if (!lastLocalProfileSnapshot || !isEqualJson(lastLocalProfileSnapshot.localProfile, localProfile)) {
    updatesByFieldPath['localProfile'] = localProfile;
    updateMask.push('localProfile');
    updatesByFieldPath['localProfileUpdatedAt'] = new Date();
    updateMask.push('localProfileUpdatedAt');
    anyChange = true;
  }

  // tailoredResume (whole object)
  if (!lastTailoredResumeSnapshot || !isEqualJson(lastTailoredResumeSnapshot, tailoredResumeFinal)) {
    updatesByFieldPath['tailoredResume'] = tailoredResumeFinal;
    updateMask.push('tailoredResume');
    updatesByFieldPath['tailoredResumeUpdatedAt'] = new Date();
    updateMask.push('tailoredResumeUpdatedAt');
    anyChange = true;
  }

  // uploads.* (granular where possible)
  if (!lastLocalUploadsSnapshot) {
    if (uploadsFinal && typeof uploadsFinal === 'object') {
      for (const [k, v] of Object.entries(uploadsFinal)) {
        const fp = `uploads.${escapeFieldPathSegment(k)}`;
        updatesByFieldPath[fp] = v;
        updateMask.push(fp);
        anyChange = true;
      }
    }
  } else {
    const prev = lastLocalUploadsSnapshot || {};
    const next = uploadsFinal || {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of keys) {
      if (isEqualJson(prev[k], next[k])) continue;
      const fp = `uploads.${escapeFieldPathSegment(k)}`;
      updatesByFieldPath[fp] = (next as any)[k] ?? null;
      updateMask.push(fp);
      anyChange = true;
    }
  }
  if (updateMask.some((p) => p.startsWith('uploads.'))) {
    updatesByFieldPath['uploadsUpdatedAt'] = new Date();
    updateMask.push('uploadsUpdatedAt');
  }

  if (!anyChange) return;

  // Materialize nested document body for the updateMask.
  const bodyObj: any = {};
  for (const [fp, v] of Object.entries(updatesByFieldPath)) {
    setNestedValue(bodyObj, parseFirestoreFieldPath(fp), v);
  }
  // Always update updatedAt for visibility.
  bodyObj.updatedAt = new Date();
  updateMask.push('updatedAt');

  await setDirty(true);
  await setSyncStatus(navigator.onLine ? 'saving' : 'offline');

  try {
    await firestoreUpdateDoc(profileDocPath, bodyObj, updateMask);

    // Receipt: indicates the last confirmed write.
    await firestorePatchDoc(`users/${uid}/sync/profile`, {
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    }).catch(() => {});

    lastCloudSyncSnapshot = sync;
    lastLocalProfileSnapshot = { resumeDetails, localProfile };
    lastTailoredResumeSnapshot = tailoredResumeFinal;
    lastLocalUploadsSnapshot = uploadsFinal || {};

    await setDirty(false);
    await setSyncStatus('synced');
  } catch (_) {
    // Offline/network/auth: enqueue for later flush.
    await enqueue({
      kind: 'firestoreUpdateDoc',
      payload: { path: profileDocPath, data: bodyObj, fieldPaths: updateMask },
      createdAtMs: Date.now(),
    });
    await setSyncStatus('offline');
  }
}

function scheduleImmediateJobFieldsPush(reason: string) {
  // Avoid infinite loops when we're applying remote state into local storage.
  if (applyingRemote) return;

  // Throttle slightly to collapse rapid key-by-key writes into a single Firestore patch.
  const run = async () => {
    immediateJobFieldsPushTimer = null;

    if (immediateJobFieldsPushInFlight) {
      immediateJobFieldsPushQueued = true;
      return;
    }

    immediateJobFieldsPushInFlight = true;
    try {
      await pushProfileUpdates();
    } catch (_) {
      // pushProfileUpdates already enqueues on failures.
    } finally {
      immediateJobFieldsPushInFlight = false;
      immediateJobFieldsPushLastAt = Date.now();

      if (immediateJobFieldsPushQueued) {
        immediateJobFieldsPushQueued = false;
        scheduleImmediateJobFieldsPush('queued');
      }
    }

    // If anything was enqueued, make sure we flush quickly.
    scheduleFlushSoon();
  };

  const now = Date.now();
  const since = now - Number(immediateJobFieldsPushLastAt || 0);

  if (since < IMMEDIATE_JOBFIELDS_PUSH_THROTTLE_MS) {
    if (!immediateJobFieldsPushTimer) {
      immediateJobFieldsPushTimer = setTimeout(() => run().catch(() => {}), IMMEDIATE_JOBFIELDS_PUSH_THROTTLE_MS);
    }
    return;
  }

  run().catch(() => {});
}

export async function pullProfileFromCloudNow(mode: 'lite' | 'full' = 'lite') {
  if (profilePullInFlight) {
    profilePullQueued = true;
    return;
  }
  if (Date.now() - lastProfilePullAt < PULL_PROFILE_THROTTLE_MS && mode === 'lite') return;

  profilePullInFlight = true;
  try {
    await pullFromCloudAndPopulateLocal();
    lastProfilePullAt = Date.now();
  } finally {
    profilePullInFlight = false;
    if (profilePullQueued) {
      profilePullQueued = false;
      pullProfileFromCloudNow('lite');
    }
  }
}

async function pullFromCloudAndPopulateLocalLite() {
  if (!authState) return;
  if (!requireFirebaseConfig()) return;

  const uid = authState.uid;

  const userDoc = await firestoreGetDoc(`users/${uid}`).catch(() => null);
  const jfDoc = await firestoreGetDoc(`users/${uid}/profile/current`).catch(() => null);

  const userData = userDoc?.fields ? fromFirestoreValue({ mapValue: { fields: userDoc.fields } }) : null;
  const jfData = jfDoc?.fields ? fromFirestoreValue({ mapValue: { fields: jfDoc.fields } }) : null;

  applyingRemote = true;
  try {
    // Sync storage (labels/settings)
    if (jfData?.sync && typeof jfData.sync === 'object') {
      await chrome.storage.sync.set(jfData.sync);
    }

    // settings may also be present under users/{uid}
    if (userData?.settings && typeof userData.settings === 'object') {
      await chrome.storage.sync.set(userData.settings);
    }

    // Local storage (resume details, local profile, tailored)
    const localPatch: any = {};
    if (jfData?.resumeDetails != null) localPatch.Resume_details = jfData.resumeDetails;
    if (jfData?.localProfile != null) {
      localPatch.LOCAL_PROFILE = jfData.localProfile;
      localPatch.EXEMPLIPHAI_LOCAL_PROFILE = jfData.localProfile;
    }

    if (jfData?.tailoredResume && typeof jfData.tailoredResume === 'object') {
      if (typeof jfData.tailoredResume.text === 'string') localPatch.Resume_tailored_text = jfData.tailoredResume.text;
      if (jfData.tailoredResume.meta && typeof jfData.tailoredResume.meta === 'object') localPatch.Resume_tailored_meta = jfData.tailoredResume.meta;
      if (typeof jfData.tailoredResume.name === 'string') localPatch.Resume_tailored_name = jfData.tailoredResume.name;
    }

    if (jfData?.uploads && typeof jfData.uploads === 'object') {
      if (jfData.uploads.resume) localPatch.uploads_resume = jfData.uploads.resume;
      if (jfData.uploads.coverLetter) localPatch.uploads_coverLetter = jfData.uploads.coverLetter;
      if (jfData.uploads.tailoredResume) localPatch.uploads_tailored_resume = jfData.uploads.tailoredResume;
    }

    if (Object.keys(localPatch).length) {
      await chrome.storage.local.set(localPatch);
    }

    // Stats → local cache for UI
    if (userData?.stats && typeof userData.stats === 'object') {
      await chrome.storage.local.set({ cloudStats: userData.stats });
    }
  } finally {
    applyingRemote = false;
  }
}

async function pullFromCloudAndPopulateLocal() {
  if (!authState) authState = await getStoredAuth().catch(() => null);
  if (!authState) return;
  if (!requireFirebaseConfig()) return;

  const uid = authState.uid;

  const userDoc = await firestoreGetDoc(`users/${uid}`).catch(() => null);
  const jfDoc = await firestoreGetDoc(`users/${uid}/profile/current`).catch(() => null);

  const userData = userDoc?.fields ? fromFirestoreValue({ mapValue: { fields: userDoc.fields } }) : null;
  const jfData = jfDoc?.fields ? fromFirestoreValue({ mapValue: { fields: jfDoc.fields } }) : null;

  applyingRemote = true;
  try {
    // Sync storage (labels/settings)
    if (jfData?.sync && typeof jfData.sync === 'object') {
      await chrome.storage.sync.set(jfData.sync);
    }

    // settings may also be present under users/{uid}
    if (userData?.settings && typeof userData.settings === 'object') {
      await chrome.storage.sync.set(userData.settings);
    }

    // Local storage (resume details, local profile, tailored)
    const localPatch: any = {};
    if (jfData?.resumeDetails != null) localPatch.Resume_details = jfData.resumeDetails;
    if (jfData?.localProfile != null) {
      localPatch.LOCAL_PROFILE = jfData.localProfile;
      localPatch.EXEMPLIPHAI_LOCAL_PROFILE = jfData.localProfile;
    }

    if (jfData?.tailoredResume && typeof jfData.tailoredResume === 'object') {
      if (typeof jfData.tailoredResume.text === 'string') localPatch.Resume_tailored_text = jfData.tailoredResume.text;
      if (jfData.tailoredResume.meta && typeof jfData.tailoredResume.meta === 'object') localPatch.Resume_tailored_meta = jfData.tailoredResume.meta;
      if (typeof jfData.tailoredResume.name === 'string') localPatch.Resume_tailored_name = jfData.tailoredResume.name;
    }

    if (jfData?.uploads && typeof jfData.uploads === 'object') {
      if (jfData.uploads.resume) localPatch.uploads_resume = jfData.uploads.resume;
      if (jfData.uploads.coverLetter) localPatch.uploads_coverLetter = jfData.uploads.coverLetter;
      if (jfData.uploads.tailoredResume) localPatch.uploads_tailored_resume = jfData.uploads.tailoredResume;
    }

    // Pull applied jobs (last 6 months) into local cache for the Dashboard UI.
    try {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);

      const docs = await firestoreRunQuery(`users/${uid}`, {
        from: [{ collectionId: 'appliedJobs' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'timestamp' },
            op: 'GREATER_THAN',
            value: { timestampValue: cutoff.toISOString() },
          },
        },
        orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
        limit: 200,
      });

      const jobs = (docs || [])
        .map((d: any) => {
          const data = d?.fields ? fromFirestoreValue({ mapValue: { fields: d.fields } }) : {};
          return {
            company: String(data?.company || ''),
            role: String(data?.role || data?.title || ''),
            date: String(data?.timestamp || ''),
            url: String(data?.url || ''),
          };
        })
        .filter((j: any) => j.url);

      localPatch.AppliedJobs = jobs;
    } catch (_) {}

    // Pull most recent job search to restore the Job Search tab quickly.
    try {
      const docs = await firestoreRunQuery(`users/${uid}`, {
        from: [{ collectionId: 'jobSearches' }],
        orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
        limit: 1,
      });

      const d0 = docs?.[0];
      const data = d0?.fields ? fromFirestoreValue({ mapValue: { fields: d0.fields } }) : null;
      if (data) {
        localPatch.jobSearchLast = {
          version: String(data.version || '0.1'),
          generated_at: String(data.generated_at || data.timestamp || nowIso()),
          desiredLocation: String(data?.searchOptions?.desiredLocation || ''),
          recommendations: Array.isArray(data.generatedJobs) ? data.generatedJobs : [],
        };
      }
    } catch (_) {}

    if (Object.keys(localPatch).length) {
      await chrome.storage.local.set(localPatch);
    }

    // Stats → local cache for UI
    if (userData?.stats && typeof userData.stats === 'object') {
      await chrome.storage.local.set({ cloudStats: userData.stats });
    }
  } finally {
    applyingRemote = false;
  }
}

function scheduleAutosave(kind: 'jobFields' | 'appliedJobs' | 'jobSearch' = 'jobFields') {
  const when = Date.now() + 30_000;

  if (kind === 'jobFields') {
    autosaveScheduledAt = when;
    chrome.alarms.create(AUTOSAVE_ALARM, { when });
    return;
  }

  if (kind === 'appliedJobs') {
    appliedJobsSyncScheduledAt = when;
    chrome.alarms.create(AUTOSAVE_ALARM + '_APPLIED', { when });
    return;
  }

  if (kind === 'jobSearch') {
    jobSearchSyncScheduledAt = when;
    chrome.alarms.create(AUTOSAVE_ALARM + '_JOBSEARCH', { when });
  }
}

async function flushQueueOnce(limit = 25) {
  if (!authState) return;
  if (!requireFirebaseConfig()) return;

  const ops = await listOps(limit);
  if (!ops.length) return;

  for (const op of ops) {
    if (!op.id) continue;

    try {
      if (op.kind === 'firestorePatchDoc') {
        await firestorePatchDoc(op.payload.path, op.payload.data);
      } else if (op.kind === 'firestoreUpdateDoc') {
        await firestoreUpdateDoc(op.payload.path, op.payload.data, op.payload.fieldPaths);
      } else if (op.kind === 'firestoreCreateDoc') {
        await firestoreCreateDoc(op.payload.collectionPath, op.payload.data);
      } else if (op.kind === 'firestoreDeleteDoc') {
        await firestoreDeleteDoc(op.payload.path);
      } else if (op.kind === 'firestoreCommit') {
        await firestoreCommit(op.payload.writes);
      } else if (op.kind === 'storageUpload') {
        const meta = await storageUpload(op.payload);
        try {
          const cloudMetaKey = op?.payload?.cloudMetaKey;
          const kind = op?.payload?.kind;
          const safeName = op?.payload?.safeName;
          if (cloudMetaKey && kind) {
            const patch: any = {};
            patch[String(cloudMetaKey)] = {
              ...meta,
              name: safeName || '',
              kind,
              storedAt: nowIso(),
            };
            await chrome.storage.local.set(patch);
            scheduleImmediateJobFieldsPush('queue.storageUploadMeta');
          }
        } catch (_) {}
      }

      await deleteOp(op.id);
    } catch (e: any) {
      op.tries = (Number(op.tries) || 0) + 1;
      op.lastError = String(e?.message || e);
      await updateOp(op);

      // Back off a bit; otherwise we burn CPU in alarm loops.
      await sleep(250);

      // Stop early on auth errors
      const msg = String(e?.message || e);
      if (msg.includes('no_auth') || msg.includes('401') || msg.includes('403')) return;
    }
  }
}

async function flushQueue() {
  try {
    await flushQueueOnce(25);
  } catch (e) {
    console.warn('FirebaseSync: flushQueue failed', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage uploads
// ─────────────────────────────────────────────────────────────────────────────

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64LooksLikePdf(b64: string): boolean {
  try {
    const sample = String(b64 || '').slice(0, 32);
    if (!sample) return false;
    const padded = sample + '='.repeat((4 - (sample.length % 4)) % 4);
    const head = atob(padded);
    return head.startsWith('%PDF');
  } catch (_) {
    return false;
  }
}

async function storageUpload({ path, base64, contentType }: { path: string; base64: string; contentType: string }) {
  const url = `${STORAGE_UPLOAD_BASE()}?uploadType=media&name=${encodeURIComponent(path)}`;
  const bytes = b64ToUint8(base64);
  const res = await authedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: bytes,
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message || `storageUpload HTTP ${res.status}`);
  }

  // If downloadTokens exists, build a direct download URL
  const token = String(json.downloadTokens || '').split(',')[0] || '';
  const bucket = String(json.bucket || FIREBASE.storageBucket);
  const name = String(json.name || path);
  const downloadUrl = token
    ? `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media&token=${encodeURIComponent(token)}`
    : '';

  return {
    bucket,
    path: name,
    contentType: String(json.contentType || contentType || ''),
    size: Number(json.size || 0),
    updated: String(json.updated || ''),
    downloadUrl,
  };
}

async function maybeUploadChangedPdf(localKey: string, nameKey: string, cloudMetaKey: string, kind: 'resume' | 'coverLetter' | 'tailoredResume') {
  if (!authState) return;
  if (!requireFirebaseConfig()) return;

  const uid = authState.uid;

  const got = (await chrome.storage.local.get([localKey, nameKey])) as any;
  const b64 = String(got?.[localKey] || '').trim();
  const filename = String(got?.[nameKey] || '').trim();

  if (!b64) return;

  // File size guard: keep below ~10MB base64 (~7.5MB binary)
  if (b64.length > 14_000_000) {
    console.warn('FirebaseSync: skipping upload (too large)', localKey, b64.length);
    return;
  }

  // Safety: prevent uploading non-PDF data under a PDF content-type.
  if (!b64LooksLikePdf(b64)) {
    console.warn('FirebaseSync: skipping upload (not a PDF)', { localKey, filename });
    return;
  }

  const safeName = filename || `${kind}.pdf`;
  const path = `data/uploads/${uid}/${kind}/${Date.now()}_${safeName}`.replace(/\s+/g, '_');

  // Queue storage upload so it works offline too.
  const meta = await storageUpload({ path, base64: b64, contentType: 'application/pdf' }).catch(async (e) => {
    await enqueue({
      kind: 'storageUpload',
      payload: {
        path,
        base64: b64,
        contentType: 'application/pdf',
        cloudMetaKey,
        kind,
        safeName,
      },
      createdAtMs: Date.now(),
    });
    throw e;
  });

  const patch: any = {};
  patch[cloudMetaKey] = {
    ...meta,
    name: safeName,
    kind,
    storedAt: nowIso(),
  };

  await chrome.storage.local.set(patch);

  // Persist the uploads{} metadata (merged) immediately.
  scheduleImmediateJobFieldsPush('uploads.meta');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracking
// ─────────────────────────────────────────────────────────────────────────────

async function trackAutofill(ev: any) {
  if (!authState) return;

  const uid = authState.uid;
  const url = String(ev?.finalUrl || ev?.url || '');
  const domain = ev?.domain ? String(ev.domain) : domainFromUrl(url);
  const fieldsFilled = Array.isArray(ev?.fieldsFilled) ? ev.fieldsFilled.map((x: any) => String(x)).slice(0, 120) : [];

  const doc: any = {
    url,
    domain,
    timestamp: new Date(ev?.ts ? Number(ev.ts) : Date.now()),
    ok: ev?.ok === true,
    source: String(ev?.source || ''),
    reason: String(ev?.reason || ''),
    fieldsFilled,
    filledCount: Number.isFinite(ev?.filledCount) ? Number(ev.filledCount) : fieldsFilled.length,
    autoSubmit: ev?.autoSubmit && typeof ev.autoSubmit === 'object' ? ev.autoSubmit : null,
  };

  // Queue the create op
  await enqueue({ kind: 'firestoreCreateDoc', payload: { collectionPath: `users/${uid}/autofills`, data: doc }, createdAtMs: Date.now() });

  // Increment stats atomically
  await enqueue({
    kind: 'firestoreCommit',
    payload: {
      writes: [
        {
          transform: {
            document: userDocName(uid),
            fieldTransforms: [
              { fieldPath: 'stats.autofills.total', increment: { integerValue: '1' } },
              { fieldPath: 'stats.lastAutofill', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        },
      ],
    },
    createdAtMs: Date.now(),
  });

  // Also keep local cache for quick UI
  try {
    const got = await chrome.storage.local.get(['cloudStats', 'cloudAutofillsHistory']);
    const cur = ((got as any).cloudStats || {}) as any;

    const next = {
      ...cur,
      autofills: { total: Number(cur?.autofills?.total || 0) + 1 },
      lastAutofill: nowIso(),
    };

    const prevHist = Array.isArray((got as any).cloudAutofillsHistory) ? (got as any).cloudAutofillsHistory : [];
    const item = {
      url: String(doc.url || ''),
      domain: String(doc.domain || ''),
      filledCount: Number(doc.filledCount || 0),
      source: String(doc.source || ''),
      reason: String(doc.reason || ''),
      ts: nowIso(),
    };

    await chrome.storage.local.set({
      cloudStats: next,
      cloudAutofillsHistory: [item, ...prevHist].slice(0, 50),
    });
  } catch (_) {}

  scheduleFlushSoon();
}

async function trackCustomAnswer(ev: any) {
  if (!authState) return;
  const uid = authState.uid;

  const doc: any = {
    prompt: String(ev?.prompt || '').slice(0, 2000),
    answer: String(ev?.answer || ''),
    usedInJob: {
      url: String(ev?.url || ''),
      domain: String(ev?.domain || domainFromUrl(ev?.url || '')),
      jobTitle: String(ev?.jobTitle || ''),
      company: String(ev?.company || ''),
    },
    timestamp: new Date(ev?.ts ? Number(ev.ts) : Date.now()),
    source: String(ev?.source || 'ai_answer'),
  };

  await enqueue({ kind: 'firestoreCreateDoc', payload: { collectionPath: `users/${uid}/customAnswers`, data: doc }, createdAtMs: Date.now() });

  await enqueue({
    kind: 'firestoreCommit',
    payload: {
      writes: [
        {
          transform: {
            document: userDocName(uid),
            fieldTransforms: [
              { fieldPath: 'stats.customAnswersGenerated.total', increment: { integerValue: '1' } },
              { fieldPath: 'stats.lastCustomAnswer', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        },
      ],
    },
    createdAtMs: Date.now(),
  });

  // Local cache for UI (previews)
  try {
    const got = await chrome.storage.local.get(['cloudStats', 'cloudCustomAnswersHistory']);
    const cur = ((got as any).cloudStats || {}) as any;

    const nextStats = {
      ...cur,
      customAnswersGenerated: { total: Number(cur?.customAnswersGenerated?.total || 0) + 1 },
      lastCustomAnswer: nowIso(),
    };

    const prevHist = Array.isArray((got as any).cloudCustomAnswersHistory) ? (got as any).cloudCustomAnswersHistory : [];
    const item = {
      prompt: String(doc.prompt || '').slice(0, 800),
      answerPreview: String(doc.answer || '').slice(0, 500),
      url: String(doc?.usedInJob?.url || ''),
      domain: String(doc?.usedInJob?.domain || ''),
      ts: nowIso(),
      source: String(doc.source || 'ai_answer'),
    };

    await chrome.storage.local.set({
      cloudStats: nextStats,
      cloudCustomAnswersHistory: [item, ...prevHist].slice(0, 50),
    });
  } catch (_) {}

  scheduleFlushSoon();
}

function appliedJobIdFromUrl(url: string): string {
  const u = String(url || '');
  try {
    return btoa(u).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_').slice(0, 150);
  } catch (_) {
    // Fallback: strip non-ascii
    return btoa(u.replace(/[^\x00-\x7F]+/g, '')).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_').slice(0, 150);
  }
}

async function trackAppliedJob(job: any) {
  if (!authState) return;
  const uid = authState.uid;

  const url = String(job?.url || '').slice(0, 2000);
  if (!url) return;

  const domain = domainFromUrl(url);

  const doc: any = {
    url,
    domain,
    title: String(job?.title || job?.role || '').slice(0, 200),
    role: String(job?.role || '').slice(0, 200),
    company: String(job?.company || '').slice(0, 200),
    applied: true,
    timestamp: new Date(job?.date ? String(job.date) : nowIso()),
  };

  const id = appliedJobIdFromUrl(url);

  await enqueue({ kind: 'firestorePatchDoc', payload: { path: `users/${uid}/appliedJobs/${id}`, data: doc }, createdAtMs: Date.now() });
  scheduleFlushSoon();
}

async function syncAppliedJobsDelta(oldVal: any, newVal: any) {
  if (!authState) return;
  const uid = authState.uid;

  const oldJobs = Array.isArray(oldVal) ? oldVal : [];
  const newJobs = Array.isArray(newVal) ? newVal : [];

  const norm = (j: any) => ({
    url: String(j?.url || '').slice(0, 2000),
    company: String(j?.company || '').slice(0, 200),
    role: String(j?.role || '').slice(0, 200),
    date: String(j?.date || ''),
  });

  const oldEntries = oldJobs
    .map((j: any) => {
      const jj = norm(j);
      return [jj.url, jj] as [string, any];
    })
    .filter(([u]) => !!u);

  const newEntries = newJobs
    .map((j: any) => {
      const jj = norm(j);
      return [jj.url, jj] as [string, any];
    })
    .filter(([u]) => !!u);

  const oldMap = new Map<string, any>(oldEntries);
  const newMap = new Map<string, any>(newEntries);

  // Upserts (new or changed)
  for (const [url, j] of newMap.entries()) {
    const prev = oldMap.get(url);
    if (!prev || prev.company !== j.company || prev.role !== j.role) {
      trackAppliedJob(j).catch(() => {});
    }
  }

  // Deletions (removed URLs)
  for (const [url] of oldMap.entries()) {
    if (newMap.has(url)) continue;
    const id = appliedJobIdFromUrl(url);
    await enqueue({ kind: 'firestoreDeleteDoc', payload: { path: `users/${uid}/appliedJobs/${id}` }, createdAtMs: Date.now() });
  }

  scheduleFlushSoon();
}

async function trackJobSearch(last: any) {
  if (!authState) return;
  const uid = authState.uid;

  const doc: any = {
    timestamp: new Date(),
    searchOptions: {
      desiredLocation: String(last?.desiredLocation || ''),
    },
    generatedJobs: Array.isArray(last?.recommendations) ? last.recommendations.slice(0, 15) : [],
    version: String(last?.version || '0.1'),
    generated_at: String(last?.generated_at || nowIso()),
  };

  await enqueue({ kind: 'firestoreCreateDoc', payload: { collectionPath: `users/${uid}/jobSearches`, data: doc }, createdAtMs: Date.now() });
  scheduleFlushSoon();
}

function scheduleFlushSoon() {
  chrome.alarms.create(FLUSH_ALARM_SOON, { when: Date.now() + 5_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public init
// ─────────────────────────────────────────────────────────────────────────────

export function initFirebaseExtensionSync() {
  dbg('initFirebaseExtensionSync', { hasConfig: requireFirebaseConfig() });

  // Alarms
  try {
    chrome.alarms.create(FLUSH_ALARM_PERIODIC, { periodInMinutes: 1 });
    chrome.alarms.create(AUTH_POLL_ALARM, { periodInMinutes: AUTH_POLL_ALARM_PERIOD_MIN });
    // PULL_PROFILE_ALARM created below
  } catch (e) {
    // Shouldn't happen (permissions), but helps diagnose "nothing is happening" reports.
    console.warn('FirebaseSync: failed to create alarms', e);
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === AUTOSAVE_ALARM) {
      if (Date.now() + 50 < autosaveScheduledAt) return;
      pushProfileUpdates().catch(() => {});
      return;
    }

    if (alarm?.name === AUTOSAVE_ALARM + '_APPLIED') {
      // reserved
      return;
    }

    if (alarm?.name === AUTOSAVE_ALARM + '_JOBSEARCH') {
      // reserved
      return;
    }

    if (alarm?.name === FLUSH_ALARM_PERIODIC || alarm?.name === FLUSH_ALARM_SOON) {
      flushQueue().catch(() => {});
    }

    if (alarm?.name === AUTH_POLL_ALARM) {
      tryAuthFromAnyExempliphTab('alarm').catch(() => {});
    }

    // PULL_PROFILE_ALARM handled below
  });

  // Auth init
  getStoredAuth()
    .then(async (st) => {
      if (st) {
        authState = st;
        await pullProfileFromCloudNow('full').catch(() => {});
        // scheduleAutosave('jobFields'); // removed: jobFields now sync immediately on storage changes
        scheduleFlushSoon();
      }
    })
    .catch(() => {});

  // Background auth polling: if the user signs in on the website with the popup closed,
  // we still want to pick up their Firebase session.
  tryAuthFromAnyExempliphTab('startup').catch(() => {});
  try {
    if (!authPollTimer) {
      authPollTimer = setInterval(() => {
        tryAuthFromAnyExempliphTab('interval').catch(() => {});
      }, AUTH_POLL_INTERVAL_MS);
    }
  } catch (_) {}

  // Storage listeners → immediate Firestore sync
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (applyingRemote) return;

    const hasRelevantSyncChange = () => {
      if (!changes || typeof changes !== 'object') return false;

      // Keep consistent with filterSyncForCloud(). If ONLY these keys change, skip the push.
      const blocked = new Set(['API Key', 'cloudSyncEnabled', 'AppliedJobsSync']);

      for (const k of Object.keys(changes)) {
        if (blocked.has(k)) continue;
        return true;
      }
      return false;
    };

    const hasRelevantLocalJobFieldsChange = () => {
      if (!changes || typeof changes !== 'object') return false;
      const keys = new Set([
        'Resume_details',
        'LOCAL_PROFILE',
        'EXEMPLIPHAI_LOCAL_PROFILE',
        'Resume_tailored_text',
        'Resume_tailored_meta',
        'Resume_tailored_name',
        // Upload metadata (NOT base64 blobs)
        'uploads_resume',
        'uploads_coverLetter',
        'uploads_tailored_resume',
      ]);

      for (const k of Object.keys(changes)) {
        if (keys.has(k)) return true;
      }
      return false;
    };

    if (areaName === 'sync') {
      if (hasRelevantSyncChange()) {
        lastLocalJobFieldsChangeAt = Date.now();
        scheduleImmediateJobFieldsPush('storage.sync.onChanged');
      }
    }

    if (areaName === 'local') {
      // Keep in-memory authState in sync if some other context writes to storage.
      if (changes?.firebaseAuth) {
        try {
          const next = changes.firebaseAuth.newValue;
          if (next && typeof next === 'object' && next.uid && next.idToken) {
            authState = {
              uid: String(next.uid),
              idToken: String(next.idToken),
              refreshToken: next.refreshToken ? String(next.refreshToken) : undefined,
              expiresAtMs: Number.isFinite(next.expiresAtMs) ? Number(next.expiresAtMs) : undefined,
              email: next.email ? String(next.email) : undefined,
              providerId: next.providerId ? String(next.providerId) : undefined,
              updatedAtMs: Number.isFinite(next.updatedAtMs) ? Number(next.updatedAtMs) : Date.now(),
            };
          } else {
            authState = null;
          }
        } catch (_) {}
      }

      if (hasRelevantLocalJobFieldsChange()) {
        lastLocalJobFieldsChangeAt = Date.now();
        scheduleImmediateJobFieldsPush('storage.local.onChanged');
      }

      if (changes?.jobSearchLast) {
        try {
          const next = changes.jobSearchLast.newValue;
          if (authState && next && typeof next === 'object') {
            trackJobSearch(next).catch(() => {});
          }
        } catch (_) {}
      }

      if (changes?.AppliedJobs) {
        try {
          if (authState) syncAppliedJobsDelta(changes.AppliedJobs.oldValue, changes.AppliedJobs.newValue).catch(() => {});
        } catch (_) {}
      }

      // PDF uploads: base64 changes trigger Storage uploads; metadata is synced via profile/current immediately.
      if (changes?.Resume || changes?.Resume_name) {
        maybeUploadChangedPdf('Resume', 'Resume_name', 'uploads_resume', 'resume').catch(() => {});
      }
      if (changes?.['Cover Letter'] || changes?.['Cover Letter_name']) {
        maybeUploadChangedPdf('Cover Letter', 'Cover Letter_name', 'uploads_coverLetter', 'coverLetter').catch(() => {});
      }
      if (changes?.Resume_tailored_pdf || changes?.Resume_tailored_name) {
        maybeUploadChangedPdf('Resume_tailored_pdf', 'Resume_tailored_name', 'uploads_tailored_resume', 'tailoredResume').catch(() => {});
      }
    }
  });

  // Messages
  chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    (async () => {
      if (!msg || typeof msg !== 'object') {
        sendResponse({ ok: false });
        return;
      }

      if (msg.action === 'FIREBASE_WHOAMI') {
        if (!authState) {
          authState = await getStoredAuth().catch(() => null);
        }

        // If popup asks "whoami" while the user is signed in on the website but
        // before we got a storage push, proactively poll open Exempliph tabs.
        if (!authState) {
          await tryAuthFromAnyExempliphTab('whoami').catch(() => false);
        }

        dbg('whoami', { authed: !!authState, uid: authState?.uid || null, source: msg?.source || null });
        sendResponse({
          ok: true,
          authed: !!authState,
          uid: authState?.uid || null,
          email: authState?.email || null,
          providerId: authState?.providerId || null,
          expiresAtMs: authState?.expiresAtMs || null,
          updatedAtMs: authState?.updatedAtMs || null,
        });
        return;
      }

      if (msg.action === 'FIREBASE_POPUP_OPENED') {
        // Popup opened: (1) best-effort auth pull from an open Exempliph tab if we don't have auth yet
        // (2) always pull latest cloud profile → chrome.storage so website edits show up in the extension.
        const hadAuth = !!(authState?.uid && authState?.idToken);

        let pulledAuth = false;
        if (!hadAuth) {
          pulledAuth = await tryAuthFromAnyExempliphTab('popup_opened').catch(() => false);
        }

        // (profile pull is triggered separately by the popup UI)
        sendResponse({ ok: true, polled: !hadAuth, authed: !!authState, pulledAuth, pulledProfile: false });
        return;
      }

      if (msg.action === 'FIREBASE_SIGN_OUT' || msg.action === 'FIREBASE_AUTH_CLEAR') {
        authState = null;
        await setStoredAuth(null);
        sendResponse({ ok: true });
        return;
      }

      // Website → extension auth update
      if (msg.action === 'FIREBASE_AUTH_UPDATE') {
        console.debug('FirebaseSync: FIREBASE_AUTH_UPDATE', { source: msg?.source || null, hasToken: !!String(msg?.idToken || '').trim(), uid: msg?.uid || null, email: msg?.email || null });
        const idToken = String(msg.idToken || '').trim();
        const refreshToken = String(msg.refreshToken || '').trim();
        const expiresAtMs = Number.isFinite(msg.expiresAtMs) ? Number(msg.expiresAtMs) : undefined;

        const jwt = idToken ? parseJwt(idToken) : null;
        const uid = String(msg.uid || jwt?.user_id || jwt?.sub || '').trim();
        const email = String(msg.email || jwt?.email || '').trim();

        if (!uid || !idToken) {
          sendResponse({ ok: false, reason: 'missing_uid_or_token' });
          return;
        }

        const next: FirebaseAuthState = {
          uid,
          idToken,
          refreshToken: refreshToken || undefined,
          expiresAtMs,
          email: email || undefined,
          providerId: String(msg.providerId || jwt?.firebase?.sign_in_provider || ''),
          updatedAtMs: Date.now(),
        };

        authState = next;
        try {
          await setStoredAuth(next);
          dbg('stored auth updated', { uid, email: next.email || null, updatedAtMs: next.updatedAtMs });
        } catch (e) {
          console.warn('FirebaseSync: setStoredAuth failed', e);
        }

        // Pull latest cloud snapshot to hydrate popup/options immediately
        await pullProfileFromCloudNow('full').catch(() => {});
        // scheduleAutosave('jobFields'); // removed: jobFields now sync immediately on storage changes
        scheduleFlushSoon();

        sendResponse({ ok: true, uid });
        return;
      }

      // FIREBASE_AUTH_CLEAR handled above.

      if (msg.action === 'TRACK_CUSTOM_ANSWER') {
        await trackCustomAnswer(msg);
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === 'FIREBASE_INCREMENT_STATS') {
        // Best-effort: allow UIs to count AI usage that doesn't map to autofills/custom answer docs.
        if (!authState) authState = await getStoredAuth().catch(() => null);
        const ok = await enqueueStatsIncrement({
          autofills: Number(msg?.autofills || 0),
          customAnswersGenerated: Number(msg?.customAnswersGenerated || 0),
          setLastAutofill: msg?.setLastAutofill === true,
          setLastCustomAnswer: msg?.setLastCustomAnswer === true,
        }).catch(() => false);
        sendResponse({ ok: !!ok });
        return;
      }

      if (msg.action === 'TRACK_APPLIED_JOB') {
        await trackAppliedJob(msg.job || msg);
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === 'SYNC_NOW') {
        await pushProfileUpdates().catch(() => {});
        await flushQueue().catch(() => {});
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === 'GET_CLOUD_STATE') {
        sendResponse({ ok: true, authed: !!authState, uid: authState?.uid || null, hasConfig: requireFirebaseConfig() });
        return;
      }

      // Passive: observe autofill completion messages
      if (msg.action === 'LIST_MODE_AUTOFILL_RESULT') {
        // Only track successful autofills
        if (msg.ok === true) await trackAutofill(msg);
        sendResponse({ ok: true, observed: true });
        return;
      }

      sendResponse({ ok: false, ignored: true });
    })().catch((e) => {
      sendResponse({ ok: false, error: String(e?.message || e) });
    });

    return true;
  });

  // Periodic pull alarm
  chrome.alarms.create(PULL_PROFILE_ALARM, { periodInMinutes: PULL_PROFILE_PERIOD_MIN });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PULL_PROFILE_ALARM) pullProfileFromCloudNow('full');
  });
}
