<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

const status = ref<{ uid: string | null; email: string | null; phoneNumber: string | null } | null>(null);
const busy = ref(false);
const err = ref<string | null>(null);
const msg = ref<string | null>(null);

const customToken = ref('');

const isAuthed = computed(() => !!status.value?.uid);

function setError(e: any) {
  err.value = String(e?.message || e);
  msg.value = null;
}
function setMessage(m: string) {
  msg.value = m;
  err.value = null;
}

async function sendBg(msg: any): Promise<any> {
  return await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const e = chrome?.runtime?.lastError;
      if (e) reject(new Error(e.message || String(e)));
      else resolve(resp || {});
    });
  });
}

async function whoami() {
  const resp = await sendBg({ action: 'FIREBASE_WHOAMI' });
  if (resp?.ok) {
    status.value = { uid: resp.uid, email: resp.email, phoneNumber: resp.phoneNumber };
  }
}

async function signInWithToken(token: string) {
  const t = String(token || '').trim();
  if (!t) throw new Error('Missing custom token');
  const resp = await sendBg({ action: 'FIREBASE_SIGN_IN_WITH_CUSTOM_TOKEN', token: t });
  if (!resp?.ok) throw new Error(resp?.error || 'Sign-in failed');
  await whoami();
}

async function connectFromWebsiteTab() {
  busy.value = true;
  err.value = null;
  msg.value = null;
  try {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (t) => resolve(t || []));
    });
    const tabId = tabs?.[0]?.id;
    if (!tabId) throw new Error('No active tab found');

    const resp = await new Promise<any>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'EXEMPLIPHAI_GET_CUSTOM_TOKEN' }, (r) => {
        const e = chrome?.runtime?.lastError;
        if (e) reject(new Error(e.message || String(e)));
        else resolve(r || {});
      });
    });

    const token = String(resp?.token || '').trim();
    if (!token) {
      throw new Error(
        'No custom token found on this page.\n\nExpected localStorage key: EXEMPLIPHAI_FIREBASE_CUSTOM_TOKEN (string).'
      );
    }

    await signInWithToken(token);
    setMessage('Connected. Firebase sync is now enabled.');
  } catch (e) {
    setError(e);
  } finally {
    busy.value = false;
  }
}

async function signInManual() {
  busy.value = true;
  err.value = null;
  msg.value = null;
  try {
    await signInWithToken(customToken.value);
    customToken.value = '';
    setMessage('Signed in.');
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

onMounted(() => {
  whoami().catch(() => {});
});
</script>

<template>
  <div class="action-card" style="margin-bottom: 1rem;">
    <h3 style="margin-top: 0;">Account & Sync (Firebase)</h3>

    <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.35;">
      The extension syncs your profile, resume details, applied jobs, and job search results to Firestore under
      <span class="code">users/&lt;uid&gt;</span>.
    </p>

    <div v-if="err" class="banner err" role="alert">{{ err }}</div>
    <div v-if="msg" class="banner ok" role="status" aria-live="polite">{{ msg }}</div>

    <div class="row" style="align-items: center; justify-content: space-between;">
      <div>
        <div style="font-weight: 900;">Status</div>
        <div style="opacity: 0.85; font-size: 0.85rem; margin-top: 2px;">
          <template v-if="isAuthed">
            Signed in: <span class="code">{{ status?.email || status?.phoneNumber || status?.uid }}</span>
          </template>
          <template v-else>
            Not signed in.
          </template>
        </div>
      </div>

      <button v-if="isAuthed" class="btn danger" type="button" @click="doSignOut" :disabled="busy">Sign out</button>
    </div>

    <div v-if="!isAuthed" class="sync-row" style="margin-top: 0.75rem;">
      <button class="btn primary" type="button" @click="connectFromWebsiteTab" :disabled="busy">
        {{ busy ? 'Working…' : 'Connect from website tab' }}
      </button>
    </div>

    <details v-if="!isAuthed" style="margin-top: 0.75rem;">
      <summary style="cursor: pointer; font-weight: 800;">Advanced: paste custom token</summary>
      <div style="margin-top: 0.6rem;">
        <textarea
          v-model="customToken"
          spellcheck="false"
          placeholder="Paste Firebase custom token…"
          style="width: 100%; min-height: 90px; border-radius: 12px; border: 1px solid var(--card-border); background: var(--bg-secondary); color: var(--text-primary); padding: 10px;"
        />
        <button class="btn primary" type="button" @click="signInManual" :disabled="busy || !customToken.trim()" style="margin-top: 0.5rem;">
          Sign in
        </button>
      </div>
    </details>
  </div>
</template>

<style scoped>
.code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

.banner {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--card-border);
  margin-bottom: 10px;
}
.banner.err { border-color: rgba(239,68,68,0.6); }
.banner.ok { border-color: rgba(34,197,94,0.5); }

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
</style>
