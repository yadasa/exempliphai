<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { pullProfileFromCloudNow } from '../sw/firebaseSync';

type Whoami = {
  ok: boolean;
  authed: boolean;
  uid: string | null;
  email: string | null;
  providerId?: string | null;
  expiresAtMs?: number | null;
  updatedAtMs?: number | null;
  error?: string;
};

type SiteTokenResp =
  | {
      ok: true;
      uid: string;
      email?: string;
      providerId?: string;
      idToken: string;
      refreshToken?: string;
      expiresAtMs?: number;
      key?: string;
    }
  | { ok: false; reason?: string; error?: string };

const status = ref<Whoami | null>(null);
const busy = ref(false);
const connecting = ref(false);
const err = ref<string | null>(null);
const msg = ref<string | null>(null);

const msgFading = ref(false);
let msgTimer: number | null = null;
let msgClearTimer: number | null = null;

const ENV = (import.meta as any).env || {};
const DEBUG_AUTH = String((ENV as any).VITE_DEBUG_AUTH || '') === '1';
function dbg(...args: any[]) {
  try {
    if (DEBUG_AUTH) console.debug('AccountSyncCard[auth]', ...args);
  } catch (_) {}
}

const isAuthed = computed(() => !!status.value?.authed && !!status.value?.uid);

const profileName = ref<{ first: string; last: string; full: string } | null>(null);

function titleCaseWord(w: string): string {
  const s = String(w || '').trim();
  if (!s) return '';
  return s.slice(0, 1).toUpperCase() + s.slice(1).toLowerCase();
}

function nameFromEmail(email: string): { first: string; last: string; full: string } | null {
  const e = String(email || '').trim();
  const local = e.includes('@') ? e.split('@')[0] : e;
  const parts = local
    .split(/[^a-zA-Z0-9]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) return null;

  const first = titleCaseWord(parts[0]);
  const last = parts.length >= 2 ? titleCaseWord(parts[parts.length - 1]) : '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  return { first, last, full };
}

const connectedAsText = computed(() => {
  if (!isAuthed.value) return '';

  const fromProfile = profileName.value;
  if (fromProfile?.full) return fromProfile.full;

  const email = String(status.value?.email || '').trim();
  const fromEmail = email ? nameFromEmail(email) : null;
  if (fromEmail?.full) return fromEmail.full;

  const uid = String(status.value?.uid || '').trim();
  if (email) return email;
  return uid ? `User ${uid.slice(0, 8)}` : 'Connected';
});

const LOGIN_URL = 'https://exempliph.ai/login/';
const POLL_MS = 5_000;
const MAX_WAIT_MS = 2 * 60_000;
let pollTimer: number | null = null;
let stopAtMs = 0;

function clearMsgTimers() {
  if (msgTimer != null) window.clearTimeout(msgTimer);
  if (msgClearTimer != null) window.clearTimeout(msgClearTimer);
  msgTimer = null;
  msgClearTimer = null;
}

function setError(e: any) {
  err.value = String(e?.message || e);
  msg.value = null;
  msgFading.value = false;
  clearMsgTimers();
}

function setMessage(m: string) {
  msg.value = m;
  err.value = null;
  msgFading.value = false;
  clearMsgTimers();

  // Auto-fade success banners after a short delay.
  msgTimer = window.setTimeout(() => {
    msgFading.value = true;
    msgClearTimer = window.setTimeout(() => {
      msg.value = null;
      msgFading.value = false;
      clearMsgTimers();
    }, 350);
  }, 3_000);
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

async function sendBg(message: any): Promise<any> {
  dbg('sendBg →', { action: message?.action || null, message });
  return await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      const e = chrome?.runtime?.lastError;
      if (e) {
        dbg('sendBg lastError', { action: message?.action || null, error: e.message || String(e) });
        reject(new Error(e.message || String(e)));
        return;
      }
      dbg('sendBg ←', { action: message?.action || null, resp });
      resolve(resp || {});
    });
  });
}

async function whoami(source = 'AccountSyncCard') {
  const resp = (await sendBg({ action: 'FIREBASE_WHOAMI', source })) as Whoami;
  dbg('whoami', resp);
  if (resp?.ok) {
    status.value = resp;
  } else if (connecting.value) {
    // Surface SW errors in the popup during the sign-in/connect flow.
    err.value = (resp as any)?.error || (resp as any)?.reason || 'Failed to read auth status';
    msg.value = null;
  }
  return resp;
}

async function sendToServiceWorker(rec: SiteTokenResp & { ok: true }) {
  const payload = {
    action: 'FIREBASE_AUTH_UPDATE',
    uid: rec.uid,
    email: rec.email || '',
    providerId: rec.providerId || '',
    idToken: rec.idToken,
    refreshToken: rec.refreshToken || '',
    expiresAtMs: Number.isFinite(rec.expiresAtMs) ? rec.expiresAtMs : undefined,
    source: 'AccountSyncCard',
  };

  const r = await sendBg(payload);
  if (!r?.ok) throw new Error(r?.reason || r?.error || 'Failed to set auth');
}

function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve((tabs && tabs[0]) || null);
    });
  });
}

async function getIdTokenFromTab(tabId: number): Promise<SiteTokenResp> {
  return await new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { action: 'EXEMPLIPHAI_GET_ID_TOKEN' }, (r) => {
        const e = chrome?.runtime?.lastError;
        if (e) {
          console.debug('AccountSyncCard: tabs.sendMessage error', e);
          resolve({ ok: false, error: e.message || String(e) });
          return;
        }
        resolve((r || { ok: false }) as SiteTokenResp);
      });
    } catch (e: any) {
      resolve({ ok: false, error: String(e?.message || e) });
    }
  });
}

async function tryConnectFromTab(tabId: number): Promise<boolean> {
  dbg('tryConnectFromTab', { tabId });
  const rec = await getIdTokenFromTab(tabId);
  if (!rec || rec.ok !== true || !rec.uid || !rec.idToken) {
    dbg('no token from tab', { tabId, rec });
    return false;
  }
  dbg('token pulled from tab', { tabId, uid: rec.uid, hasIdToken: !!rec.idToken, key: (rec as any)?.key || null });
  await sendToServiceWorker(rec);
  await whoami('tryConnectFromTab').catch(() => {});
  return true;
}

async function tryConnectFromAnyExempliphTab(): Promise<boolean> {
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query(
      {
        url: [
          '*://exempliph.ai/*',
          '*://www.exempliph.ai/*',
          '*://exempliphai.com/*',
          '*://www.exempliphai.com/*',
        ],
      },
      (t) => resolve(t || [])
    );
  });

  for (const t of tabs) {
    if (!t?.id) continue;
    const ok = await tryConnectFromTab(t.id).catch(() => false);
    if (ok) return true;
  }

  return false;
}

async function openLogin(tab: chrome.tabs.Tab | null) {
  // If the user is already on an Exempliph page, re-use that tab.
  if (tab?.id && isExempliphUrl(String(tab.url || ''))) {
    await new Promise<void>((resolve) => {
      chrome.tabs.update(tab.id!, { url: LOGIN_URL, active: true }, () => resolve());
    });
    return;
  }

  await new Promise<void>((resolve) => {
    chrome.tabs.create({ url: LOGIN_URL, active: true }, () => resolve());
  });
}

function stopPolling() {
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  connecting.value = false;
  stopAtMs = 0;
}

function startPolling() {
  stopPolling();
  connecting.value = true;
  stopAtMs = Date.now() + MAX_WAIT_MS;
  dbg('startPolling', { pollMs: POLL_MS, maxWaitMs: MAX_WAIT_MS });

  pollTimer = window.setInterval(() => {
    (async () => {
      dbg('poll tick');

      // If we already became authed (e.g. via siteAuthBridge push), stop.
      const w = await whoami('poll').catch(() => null);
      if (w?.authed) {
        dbg('poll: already authed');
        stopPolling();
        setMessage('Connected. Firebase sync enabled.');
        return;
      }

      if (stopAtMs && Date.now() > stopAtMs) {
        dbg('poll: timeout');
        stopPolling();
        setError('Timed out waiting for sign-in. Please finish logging in on the website, then try again.');
        return;
      }

      const ok = await tryConnectFromAnyExempliphTab().catch(() => false);
      dbg('poll: tryConnectFromAnyExempliphTab result', { ok });
      if (ok) {
        stopPolling();
        setMessage('Connected. Firebase sync enabled.');
      }
    })().catch((e) => {
      dbg('poll tick failed', { error: String((e as any)?.message || e) });
    });
  }, POLL_MS);
}

async function signIn() {
  busy.value = true;
  err.value = null;
  msg.value = null;

  try {
    const tab = await getActiveTab();

    // Best case: user is already on exempliph.ai and signed in.
    if (tab?.id && isExempliphUrl(String(tab.url || ''))) {
      const ok = await tryConnectFromTab(tab.id).catch(() => false);
      if (ok) {
        setMessage('Connected. Firebase sync enabled.');
        return;
      }
    }

    // Otherwise, send them to the website login flow and wait.
    await openLogin(tab);
    setMessage('Finish signing in on the website…');
    startPolling();
  } catch (e) {
    setError(e);
  } finally {
    busy.value = false;
  }
}

async function doSignOut() {
  busy.value = true;
  err.value = null;
  msg.value = null;
  try {
    const resp = await sendBg({ action: 'FIREBASE_SIGN_OUT' });
    if (!resp?.ok) throw new Error(resp?.error || 'Sign-out failed');
    await whoami();
    setMessage('Signed out.');
  } catch (e) {
    setError(e);
  } finally {
    busy.value = false;
  }
}

function onStorageChanged(changes: any, areaName: string) {
  if (areaName === 'local') {
    if (changes?.firebaseAuth) whoami().catch(() => {});
    return;
  }

  if (areaName === 'sync') {
    // Keep the displayed name in sync when cloud pulls update chrome.storage.sync.
    if (changes?.['Full Name'] || changes?.['First Name'] || changes?.['Last Name']) {
      loadProfileName().catch(() => {});
    }
  }
}

async function loadProfileName() {
  try {
    chrome.storage.sync.get(['Full Name', 'First Name', 'Last Name'], (res) => {
      const full = String((res as any)?.['Full Name'] || '').trim();
      const first = String((res as any)?.['First Name'] || '').trim();
      const last = String((res as any)?.['Last Name'] || '').trim();
      const combined = full || [first, last].filter(Boolean).join(' ').trim();
      if (combined) {
        profileName.value = { first, last, full: combined };
      }
    });
  } catch (_) {}
}

watch(
  () => isAuthed.value,
  (authed) => {
    if (authed) loadProfileName().catch(() => {});
  },
  { immediate: true }
);

onMounted(() => {
  // Nudge SW on popup open:
  // - pull auth from any open Exempliph tab (if needed)
  // - pull latest Firestore profile → chrome.storage so website edits appear in the popup
  ;(async () => {
    try {
      await sendBg({ action: 'FIREBASE_POPUP_OPENED', source: 'AccountSyncCard' });
    } catch (_) {}
    await pullProfileFromCloudNow('lite');  // Fresh on popup open
    await loadProfileName().catch(() => {});
  })().catch(() => {});

  whoami('mounted').catch(() => {});

  // If the user already signed in on the website (maybe with the popup closed),
  // try to connect immediately on next popup open.
  tryConnectFromAnyExempliphTab()
    .then((ok) => {
      dbg('mounted: tryConnectFromAnyExempliphTab', { ok });
      if (ok) setMessage('Connected. Firebase sync enabled.');
    })
    .catch(() => {});

  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch (_) {}
});

onBeforeUnmount(() => {
  stopPolling();
  clearMsgTimers();
  try {
    chrome.storage.onChanged.removeListener(onStorageChanged);
  } catch (_) {}
});
</script>

<template>
  <div class="action-card" style="margin-bottom: 1rem;">
    <h3 style="margin-top: 0;">Account & Sync</h3>

    <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.35;">
      Sign in to start applying. Cloud sync backs up your profile, resume details, applied jobs, and job search results.
    </p>

    <div v-if="err" class="banner err" role="alert">{{ err }}</div>
    <div v-if="msg" class="banner ok" :class="{ fadeout: msgFading }" role="status" aria-live="polite">{{ msg }}</div>

    <div class="row" style="align-items: center; justify-content: space-between;">
      <div>
        <div style="font-weight: 900;">Status</div>
        <div style="opacity: 0.85; font-size: 0.85rem; margin-top: 2px;">
          <template v-if="isAuthed">
            Connected as <span class="code">{{ connectedAsText }}</span>
          </template>
          <template v-else>
            Not signed in.
          </template>
        </div>
      </div>
    </div>

    <button
      v-if="isAuthed"
      class="btn danger signout-wide"
      type="button"
      @click="doSignOut"
      :disabled="busy || connecting"
      style="margin-top: 0.65rem;"
    >
      Sign out
    </button>

    <div v-if="!isAuthed" class="sync-row" style="margin-top: 0.75rem;">
      <button class="btn primary sign-in" type="button" @click="signIn" :disabled="busy || connecting">
        <div class="sign-in-title">{{ connecting ? 'Connecting…' : 'Sign In' }}</div>
        <div class="sign-in-sub">Sign in to access our best features</div>
      </button>
    </div>

    <div v-if="!isAuthed" style="margin-top: 0.6rem; opacity: 0.85; font-size: 0.85rem; line-height: 1.35;">
      Tip: If you’re already signed in on an <span class="code">exempliph.ai</span> tab, this will connect instantly.
    </div>
  </div>
</template>

<style scoped>
.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.banner {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--card-border);
  margin-bottom: 10px;
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.banner.err {
  border-color: rgba(239, 68, 68, 0.6);
}
.banner.ok {
  border-color: rgba(34, 197, 94, 0.5);
}
.banner.ok.fadeout {
  opacity: 0;
  transform: translateY(-2px);
}

.btn {
  padding: 0.7rem 1rem;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 800;
  transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease;
  background: var(--card-bg);
  color: var(--text-primary);
  border: 1px solid var(--card-border);
}

.btn.primary {
  background: var(--gradient-primary);
  color: white;
  border: none;
}

.btn.danger {
  background: linear-gradient(135deg, #ef4444, #b91c1c);
  color: white;
  border: none;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.row {
  display: flex;
  gap: 10px;
}

.sync-row {
  display: flex;
  gap: 10px;
}

.sign-in {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
}

.signout-wide {
  width: 100%;
}

.sign-in-title {
  font-size: 1rem;
  font-weight: 900;
}

.sign-in-sub {
  font-size: 0.85rem;
  font-weight: 700;
  opacity: 0.92;
}
</style>
