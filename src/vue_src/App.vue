<script setup lang="ts">
import PrivacyToggle from '@/components/PrivacyToggle.vue';
import Explanation from '@/components/Explanation.vue';
import ToastHost from '@/components/ToastHost.vue';
import EnterSkill from '@/components/EnterSkill.vue';
import EnterWorkExperience from '@/components/EnterWorkExperience.vue';
import EnterCertification from '@/components/EnterCertification.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { useTheme } from '@/composables/Theme';

import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LogoMain from '@/assets/logo-main.png';
import { printAsciiArt } from '@/utils/asciiArt';

const { loadTheme } = useTheme();
const route = useRoute();
const router = useRouter();

const tokensBalance = ref<number | null>(null);
let balanceTimer: any = null;

const refreshBalance = async () => {
  if (!chrome?.runtime?.sendMessage) return;
  await new Promise<void>((resolve) => {
    chrome.runtime.sendMessage({ action: 'BILLING_BALANCE' }, (resp) => {
      const err = chrome?.runtime?.lastError;
      if (err) {
        resolve();
        return;
      }
      const t = Number((resp as any)?.tokens ?? 0);
      tokensBalance.value = Number.isFinite(t) ? t : null;
      resolve();
    });
  });
};

const onStorageChanged = (changes: any, area: string) => {
  if (area !== 'local') return;
  if (changes?.ui_tokensBalance) {
    const next = Number(changes.ui_tokensBalance.newValue ?? 0);
    tokensBalance.value = Number.isFinite(next) ? next : 0;
  }
};

onMounted(() => {
  loadTheme();

  // Console logo (popup DevTools)
  try {
    printAsciiArt();
  } catch (_) {}


  try {
    chrome.storage?.onChanged?.addListener(onStorageChanged as any);
  } catch (_) {}

  // Nudge SW on popup open:
  // - pull auth from any open exempliph.ai tab (if needed)
  // - pull latest Firestore profile → chrome.storage
  try {
    chrome.runtime?.sendMessage?.({ action: 'FIREBASE_POPUP_OPENED', source: 'App' });
  } catch (_) {}

  // Initial token balance for the header.
  void refreshBalance();
  balanceTimer = setInterval(() => void refreshBalance(), 30_000);

  chrome.action?.onClicked?.addListener(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (!tabId) return;
      chrome.tabs.sendMessage(tabId, { action: 'TRIGGER_AI_REPLY' });
    });
  });
});

onUnmounted(() => {
  if (balanceTimer) clearInterval(balanceTimer);
  balanceTimer = null;
  try {
    chrome.storage?.onChanged?.removeListener(onStorageChanged as any);
  } catch (_) {}
});

const go = async (path: string) => {
  await router.push(path);
  await nextTick();
  const contentArea = document.querySelector('.content-area');
  if (contentArea) contentArea.scrollTop = 0;
};

const isActive = (name: string) => route.name === name;
</script>

<template>
  <EnterWorkExperience />
  <EnterSkill />
  <EnterCertification />
  <Explanation />
  <ToastHost />

  <div class="app-container">
    <div class="headerWrap">
      <div class="headerDiv">
        <div class="brandLeft">
          <img :src="LogoMain" alt="exempliphai" class="brandLogo" />
          <h1 class="aSelfTop">exempliphai</h1>
        </div>
        <div class="aRight gap-2">
          <ThemeToggle />
          <PrivacyToggle />
        </div>
      </div>
      <a
        v-if="tokensBalance !== null"
        class="headerBalance"
        href="https://exempliph.ai/tokens/"
        target="_blank"
        rel="noreferrer"
        title="Open tokens"
      >
        {{ tokensBalance.toLocaleString() }} tokens
      </a>
    </div>

    <div class="content-area px-4">
      <router-view />
    </div>

    <!-- Tab Bar -->
    <div class="tab-bar">
      <button @click="go('/profile')" :class="{ active: isActive('profile') }">
        <span class="tab-icon">👤</span> Profile
      </button>
      <button @click="go('/experience')" :class="{ active: isActive('experience') }">
        <span class="tab-icon">💼</span> Experience
      </button>
      <button @click="go('/dashboard')" :class="{ active: isActive('dashboard') }">
        <span class="tab-icon">📊</span> Dashboard
      </button>
      <button @click="go('/job-search')" :class="{ active: isActive('job-search') }">
        <span class="tab-icon">🔎</span> Job Search
      </button>
      <button @click="go('/settings')" :class="{ active: isActive('settings') }">
        <span class="tab-icon">⚙️</span> Settings
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 600px; /* Fixed height for extension popup */
  width: 400px;
  background: var(--bg-primary);
}

.headerWrap {
  position: relative;
}

.brandLeft {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.brandLogo {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: cover;
  flex: 0 0 auto;
}

.headerBalance {
  position: absolute;
  right: 1.35rem;
  bottom: -0.45rem;
  z-index: 9999;
  font-size: 0.72rem;
  font-weight: 800;
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow-1);
  text-decoration: none;
  cursor: pointer;
  transition: transform 120ms ease, filter 120ms ease, border-color 160ms ease;
}

.headerBalance:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  filter: drop-shadow(0 0 14px color-mix(in srgb, var(--accent-color) 40%, transparent));
}

.headerBalance:active {
  transform: translateY(0px) scale(0.99);
}

/* Reserve a little space for the floating token pill */
.headerWrap {
  padding-bottom: 0.32rem;
}

.content-area {
  flex: 1;
  overflow: auto;
  padding-top: 0.25rem;
  /* Fix cut-off (e.g., Disability Status) behind fixed tab bar */
  padding-bottom: calc(var(--tab-bar-height) + 72px);
}

.tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: var(--tab-bar-height);
  background: var(--tab-bar-bg);
  backdrop-filter: blur(10px);
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid var(--tab-border-top);
  z-index: 100;
  box-shadow: 0 -10px 30px rgba(15, 23, 42, 0.10);
}

.tab-bar button {
  background: none;
  border: none;
  color: var(--tab-text-inactive);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.78rem;
  font-weight: 600;
  transition: transform 0.12s ease, color 0.12s ease;
}

.tab-bar button:hover {
  transform: translateY(-1px);
}

.tab-bar button.active {
  color: var(--accent-color);
}

.tab-icon {
  font-size: 1.15rem;
  margin-bottom: 2px;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  line-height: 1;
}
</style>
