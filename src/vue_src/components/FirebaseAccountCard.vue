<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { getFirebase } from '@/lib/firebase';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

const KEY = 'LOCAL_PROFILE';
const LEGACY_KEY = 'EXEMPLIPHAI_LOCAL_PROFILE';

const phone = ref('');
const smsCode = ref('');
const sending = ref(false);
const verifying = ref(false);
const syncBusy = ref(false);
const err = ref<string | null>(null);
const msg = ref<string | null>(null);

const referralBusy = ref(false);
const referralCode = ref<string>('');
const referralLink = computed(() => {
  const base = String((import.meta as any).env?.VITE_SITE_BASE_URL || 'https://exempliphai.com').replace(/\/+$/, '');
  return referralCode.value ? `${base}/r/${referralCode.value}` : '';
});

const user = ref<User | null>(null);
const confirmation = ref<ConfirmationResult | null>(null);
let unsub: (() => void) | null = null;
let recaptcha: RecaptchaVerifier | null = null;

const isAuthed = computed(() => !!user.value);

function setError(e: any) {
  err.value = String(e?.message || e);
  msg.value = null;
}

function setMessage(m: string) {
  msg.value = m;
  err.value = null;
}

async function sendCode() {
  err.value = null;
  msg.value = null;
  sending.value = true;
  try {
    const { auth } = getFirebase();

    if (!recaptcha) {
      recaptcha = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });
    }

    confirmation.value = await signInWithPhoneNumber(auth, phone.value.trim(), recaptcha);
    setMessage('SMS sent. Enter the code to verify.');
  } catch (e) {
    // If reCAPTCHA is in a bad state, rebuild it.
    try {
      recaptcha?.clear();
    } catch (_) {}
    recaptcha = null;
    setError(e);
  } finally {
    sending.value = false;
  }
}

async function verifyCode() {
  err.value = null;
  msg.value = null;
  verifying.value = true;
  try {
    if (!confirmation.value) throw new Error('Send the SMS code first.');
    await confirmation.value.confirm(smsCode.value.trim());
    setMessage('Signed in.');
    smsCode.value = '';
  } catch (e) {
    setError(e);
  } finally {
    verifying.value = false;
  }
}

async function doSignOut() {
  err.value = null;
  msg.value = null;
  try {
    const { auth } = getFirebase();
    await signOut(auth);
    confirmation.value = null;
    setMessage('Signed out.');
  } catch (e) {
    setError(e);
  }
}

async function loadLocalProfile(): Promise<Record<string, any>> {
  const got = await chrome.storage.local.get([KEY, LEGACY_KEY]);
  const p = (got as any)[KEY] || (got as any)[LEGACY_KEY] || {};
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

async function saveLocalProfile(p: Record<string, any>) {
  await chrome.storage.local.set({ [KEY]: p, [LEGACY_KEY]: p });
}

async function pushToCloud() {
  syncBusy.value = true;
  err.value = null;
  msg.value = null;
  try {
    const u = user.value;
    if (!u) throw new Error('Sign in first.');
    const { db } = getFirebase();

    const p = await loadLocalProfile();
    await setDoc(
      doc(db, 'users', u.uid),
      {
        ...p,
        account: {
          phoneNumber: u.phoneNumber || null,
          uid: u.uid,
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    setMessage('Uploaded local profile to Firestore (users/{uid}).');
  } catch (e) {
    setError(e);
  } finally {
    syncBusy.value = false;
  }
}

async function pullFromCloud() {
  syncBusy.value = true;
  err.value = null;
  msg.value = null;
  try {
    const u = user.value;
    if (!u) throw new Error('Sign in first.');
    const { db } = getFirebase();

    const snap = await getDoc(doc(db, 'users', u.uid));
    if (!snap.exists()) {
      throw new Error('No profile found in Firestore for this user yet.');
    }

    const data = snap.data() as any;
    // Remove metadata fields
    delete data.updatedAt;
    // Keep account as-is (optional)

    await saveLocalProfile(data);
    setMessage('Downloaded Firestore profile into LOCAL_PROFILE.');
  } catch (e) {
    setError(e);
  } finally {
    syncBusy.value = false;
  }
}

async function loadReferralCode() {
  referralBusy.value = true;
  err.value = null;
  msg.value = null;
  try {
    const u = user.value;
    if (!u) throw new Error('Sign in first.');

    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'getOrCreateReferralCode');
    const res = await fn({});
    referralCode.value = String((res.data as any)?.code || '');

    if (referralCode.value) {
      setMessage('Referral code loaded.');
    }
  } catch (e) {
    setError(e);
  } finally {
    referralBusy.value = false;
  }
}

async function copyReferralLink() {
  try {
    if (!referralLink.value) throw new Error('Load your referral code first.');
    await navigator.clipboard.writeText(referralLink.value);
    setMessage('Copied referral link.');
  } catch (e) {
    setError(e);
  }
}

onMounted(() => {
  try {
    const { auth } = getFirebase();
    unsub = onAuthStateChanged(auth, (u) => {
      user.value = u;
    });
  } catch (e: any) {
    setError(e);
  }
});

onBeforeUnmount(() => {
  try {
    unsub?.();
  } catch (_) {}
  unsub = null;
  try {
    recaptcha?.clear();
  } catch (_) {}
  recaptcha = null;
});
</script>

<template>
  <div class="action-card">
    <h3>Account (Firebase Phone Auth)</h3>
    <p>Sign in with SMS to sync your LOCAL_PROFILE to Firestore (<span class="code">users/&lt;uid&gt;</span>).</p>

    <div v-if="err" class="banner err" role="alert">{{ err }}</div>
    <div v-if="msg" class="banner ok" role="status" aria-live="polite">{{ msg }}</div>

    <div class="row">
      <div class="col">
        <label class="lab" for="fb-phone">Phone (E.164)</label>
        <input
          id="fb-phone"
          class="input"
          v-model="phone"
          placeholder="+15551234567"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          :disabled="isAuthed || sending || verifying"
        />
      </div>
      <button class="btn primary" type="button" @click="sendCode" :disabled="isAuthed || sending || verifying || !phone.trim()">
        {{ sending ? 'Sending…' : 'Send Code' }}
      </button>
    </div>

    <div class="row" style="margin-top: 10px;">
      <div class="col">
        <label class="lab" for="fb-sms">SMS Code</label>
        <input
          id="fb-sms"
          class="input"
          v-model="smsCode"
          placeholder="123456"
          inputmode="numeric"
          autocomplete="one-time-code"
          :disabled="isAuthed || verifying"
        />
      </div>
      <button class="btn" type="button" @click="verifyCode" :disabled="isAuthed || verifying || !smsCode.trim()">
        {{ verifying ? 'Verifying…' : 'Verify' }}
      </button>
    </div>

    <div v-if="isAuthed" class="authed">
      <div><b>Signed in:</b> {{ user?.phoneNumber || user?.uid }}</div>
      <button class="btn danger" type="button" @click="doSignOut">Sign out</button>
    </div>

    <div v-if="isAuthed" class="referrals">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div>
          <div style="font-weight:900;">Referrals</div>
          <div style="opacity:0.82; font-size:0.85rem; margin-top:2px;">Share your link to earn points.</div>
        </div>
        <a class="btn" :href="String((import.meta as any).env?.VITE_SITE_BASE_URL || 'https://exempliphai.com').replace(/\/+$/, '') + '/account'" target="_blank" rel="noreferrer">
          Open account
        </a>
      </div>

      <div class="sync-row" style="margin-top:10px;">
        <button class="btn" type="button" @click="loadReferralCode" :disabled="referralBusy">{{ referralBusy ? 'Loading…' : (referralCode ? 'Refresh code' : 'Get code') }}</button>
        <button class="btn primary" type="button" @click="copyReferralLink" :disabled="!referralLink">Copy link</button>
      </div>

      <div v-if="referralCode" style="margin-top:10px;">
        <div style="opacity:0.82; font-size:0.85rem;">Code: <span class="code">{{ referralCode }}</span></div>
        <div style="opacity:0.82; font-size:0.85rem; margin-top:4px; word-break:break-all;">Link: <span class="code">{{ referralLink }}</span></div>
      </div>
    </div>

    <div class="sync-row">
      <button class="btn" type="button" @click="pullFromCloud" :disabled="!isAuthed || syncBusy">{{ syncBusy ? 'Working…' : 'Pull from Cloud' }}</button>
      <button class="btn primary" type="button" @click="pushToCloud" :disabled="!isAuthed || syncBusy">{{ syncBusy ? 'Working…' : 'Push to Cloud' }}</button>
    </div>

    <!-- reCAPTCHA container (invisible) -->
    <div id="recaptcha-container"></div>
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

.row {
  display: flex;
  gap: 10px;
  align-items: end;
}

.col { flex: 1; }

.lab {
  display: block;
  font-size: 0.85rem;
  opacity: 0.85;
  margin-bottom: 4px;
}

.input {
  width: 100%;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--text-primary);
  padding: 10px;
  border-radius: 12px;
  outline: none;
  transition: box-shadow 0.12s ease, border-color 0.12s ease;
}

.input:focus-visible {
  border-color: color-mix(in srgb, var(--accent-color) 65%, var(--card-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 22%, transparent);
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

.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 28%, transparent);
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

.authed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
}

.sync-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.referrals {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--card-border);
}

@media (max-width: 560px) {
  .row, .sync-row, .authed { flex-direction: column; align-items: stretch; }
}
</style>
