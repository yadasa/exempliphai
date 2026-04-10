<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

type KillSwitchState = {
  locked?: boolean;
  message?: string;
  ctaUrl?: string;
};

const locked = ref(false);
const message = ref('Download the official version on Chrome Web Store');
const ctaUrl = ref('');

function applyState(st: any) {
  const s = (st || {}) as KillSwitchState;
  locked.value = s.locked === true;
  if (typeof s.message === 'string' && s.message.trim()) message.value = s.message;
  if (typeof s.ctaUrl === 'string') ctaUrl.value = s.ctaUrl;
}

async function load() {
  try {
    chrome.storage.local.get(['REMOTE_KILL_SWITCH'], (res) => {
      applyState(res?.REMOTE_KILL_SWITCH);
    });
  } catch (_) {}
}

let _listener: any = null;

onMounted(() => {
  load();

  _listener = (changes: any, area: string) => {
    if (area !== 'local') return;
    if (!changes?.REMOTE_KILL_SWITCH) return;
    applyState(changes.REMOTE_KILL_SWITCH.newValue);
  };

  try {
    chrome.storage.onChanged.addListener(_listener);
  } catch (_) {}
});

onUnmounted(() => {
  try {
    if (_listener) chrome.storage.onChanged.removeListener(_listener);
  } catch (_) {}
});
</script>

<template>
  <div v-if="locked" class="ks-backdrop">
    <div class="ks-card">
      <h2 class="ks-title">Extension disabled</h2>
      <p class="ks-msg">{{ message }}</p>
      <a v-if="ctaUrl" class="ks-btn" :href="ctaUrl" target="_blank" rel="noreferrer">Download Link</a>
    </div>
  </div>
</template>

<style scoped>
.ks-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: rgba(2, 6, 23, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.ks-card {
  width: 100%;
  max-width: 360px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 18px;
  color: white;
  backdrop-filter: blur(10px);
  box-sizing: border-box;
}

.ks-title {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 800;
}

.ks-msg {
  margin: 0 0 14px 0;
  font-size: 13px;
  line-height: 1.35;
  opacity: 0.95;
}

.ks-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  background: #a78bfa; /* lavender */
  color: white;
  text-decoration: none;
  font-weight: 800;
  font-size: 13px;
  box-sizing: border-box;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

.ks-btn:hover {
  filter: brightness(1.05);
}
</style>
