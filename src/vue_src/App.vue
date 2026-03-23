<script setup lang="ts">
import PrivacyToggle from '@/components/PrivacyToggle.vue';
import Explanation from '@/components/Explanation.vue';
import EnterSkill from '@/components/EnterSkill.vue';
import EnterWorkExperience from '@/components/EnterWorkExperience.vue';
import EnterCertification from '@/components/EnterCertification.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { useTheme } from '@/composables/Theme';

import { nextTick, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const { loadTheme } = useTheme();
const route = useRoute();
const router = useRouter();

onMounted(() => {
  loadTheme();

  chrome.action?.onClicked?.addListener(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (!tabId) return;
      chrome.tabs.sendMessage(tabId, { action: 'TRIGGER_AI_REPLY' });
    });
  });
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

  <div class="app-container">
    <div class="headerDiv">
      <h1 class="aSelfTop">Exempliphai</h1>
      <div class="aRight gap-2">
        <ThemeToggle />
        <PrivacyToggle />
      </div>
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

.content-area {
  flex: 1;
  overflow: auto;
  padding-top: 0.25rem;
  /* Fix cut-off (e.g., Disability Status) behind fixed tab bar */
  padding-bottom: calc(var(--tab-bar-height) + 28px);
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
</style>
