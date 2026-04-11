<script setup lang="ts">
import JobTracker from '@/components/JobTracker.vue';
import SignInGate from '@/components/SignInGate.vue';
import { useIsAuthed } from '@/composables/Auth';

const { isAuthed } = useIsAuthed();
</script>

<template>
  <JobTracker v-if="isAuthed" />
  <SignInGate v-else-if="isAuthed === false" />
  <div v-else class="action-card" style="padding: 14px; opacity: 0.85;">
    Loading…
  </div>
</template>
