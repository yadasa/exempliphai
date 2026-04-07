<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

const goSettings = async () => {
  try {
    await router.push('/settings');
  } catch (_) {}
};
</script>

<template>
  <div class="gateWrap action-card">
    <h3 style="margin-top: 0;">Sign in to access features</h3>
    <p style="margin-top: 0.35rem; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.35;">
      Please sign in on the Settings tab to access your profile, dashboard, and job search.
    </p>
    <button class="action-btn export-btn" @click="goSettings" style="width: 100%; margin-top: 0.65rem;">
      Go to Settings
    </button>
  </div>
</template>

<style scoped>
.gateWrap {
  margin-top: 0.6rem;
}
</style>
