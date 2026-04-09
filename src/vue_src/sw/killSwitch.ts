// Remote kill-switch for non-store installs.
//
// Policy:
// - Read Firestore doc (public): /global/config
// - If doc.testallowed === false AND installType !== 'normal' => LOCK
// - Store lock state in chrome.storage.local under REMOTE_KILL_SWITCH so:
//   - popup UI can render an overlay
//   - legacy background + content scripts can short-circuit

export type KillSwitchDoc = {
  testallowed?: boolean;
  message?: string;
  ctaUrl?: string;
  updatedAt?: any;
};

export type KillSwitchState = {
  locked: boolean;
  reason: 'ok' | 'non_store_disabled' | 'fetch_failed' | 'no_management_permission';
  installType?: string;
  testallowed?: boolean;
  message?: string;
  ctaUrl?: string;
  fetchedAtMs: number;
};

const STORAGE_KEY = 'REMOTE_KILL_SWITCH';
const ALARM_NAME = 'KILL_SWITCH_REFRESH';
const REFRESH_PERIOD_MIN = 5;

// Hardcode project id since this extension is single-tenant.
// (Also avoids reliance on Vite env injection being present.)
const FIREBASE_PROJECT_ID = 'exempliphai';

function isDocTestAllowed(doc: KillSwitchDoc | null) {
  // default true (allowed) unless explicitly false
  if (!doc || typeof doc !== 'object') return true;
  return doc.testallowed !== false;
}

function parseFirestoreDoc(json: any): KillSwitchDoc | null {
  // Firestore REST shape: { fields: { testallowed: { booleanValue: true }, message: { stringValue: '...' } ... } }
  try {
    const f = json?.fields;
    if (!f || typeof f !== 'object') return null;

    const pick = (k: string) => f?.[k];
    const bool = (k: string) => {
      const v = pick(k);
      if (v?.booleanValue === true) return true;
      if (v?.booleanValue === false) return false;
      return undefined;
    };
    const str = (k: string) => {
      const v = pick(k);
      const s = v?.stringValue;
      return typeof s === 'string' ? s : undefined;
    };

    return {
      testallowed: bool('testallowed'),
      message: str('message'),
      ctaUrl: str('ctaUrl'),
      updatedAt: pick('updatedAt'),
    };
  } catch {
    return null;
  }
}

async function getInstallTypeSafe(): Promise<string | null> {
  try {
    if (!chrome?.management?.getSelf) return null;
    const self = await new Promise<any>((resolve, reject) => {
      chrome.management.getSelf((info) => {
        const err = chrome?.runtime?.lastError;
        if (err) reject(new Error(err.message || String(err)));
        else resolve(info);
      });
    });
    const t = String(self?.installType || '').trim();
    return t || null;
  } catch {
    return null;
  }
}

async function fetchKillDoc(): Promise<KillSwitchDoc | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_PROJECT_ID
  )}/databases/(default)/documents/global/config`;

  const res = await fetch(url, {
    method: 'GET',
    // No auth header (public doc)
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Firestore kill doc fetch failed: ${res.status}`);
  }

  const json = await res.json();
  return parseFirestoreDoc(json);
}

export async function computeKillSwitchState(): Promise<KillSwitchState> {
  const fetchedAtMs = Date.now();

  // If management permission is missing, we cannot distinguish store vs sideload.
  // In that case, do NOT lock (to avoid accidentally bricking store installs).
  const installType = await getInstallTypeSafe();
  if (!installType) {
    return {
      locked: false,
      reason: 'no_management_permission',
      fetchedAtMs,
    };
  }

  try {
    const doc = await fetchKillDoc();
    const testallowed = isDocTestAllowed(doc);

    const nonStore = installType !== 'normal';
    const locked = nonStore && testallowed === false;

    return {
      locked,
      reason: locked ? 'non_store_disabled' : 'ok',
      installType,
      testallowed,
      message: doc?.message,
      ctaUrl: doc?.ctaUrl,
      fetchedAtMs,
    };
  } catch (e: any) {
    // Fail-open for safety: if we can't read the flag, do not lock.
    // (Otherwise transient Firestore outages would brick unpacked installs.)
    return {
      locked: false,
      reason: 'fetch_failed',
      installType,
      fetchedAtMs,
      message: 'Unable to check remote config. Please try again later.',
    };
  }
}

export async function writeKillSwitchState(st: KillSwitchState) {
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: st }, () => resolve());
  });
}

export async function getKillSwitchState(): Promise<KillSwitchState | null> {
  return await new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (res) => resolve(res?.[STORAGE_KEY] || null));
  });
}

export async function refreshKillSwitchState() {
  const st = await computeKillSwitchState();
  await writeKillSwitchState(st);
  return st;
}

export async function initKillSwitch() {
  // Refresh now
  await refreshKillSwitchState();

  // Keep it fresh (MV3 alarm granularity is minutes)
  try {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MIN });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name !== ALARM_NAME) return;
      refreshKillSwitchState().catch(() => {});
    });
  } catch {
    // ignore
  }
}

export async function isLocked(): Promise<boolean> {
  const st = await getKillSwitchState();
  return st?.locked === true;
}

export const KILL_SWITCH_STORAGE_KEY = STORAGE_KEY;
