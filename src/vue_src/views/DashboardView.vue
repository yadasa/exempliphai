<script setup lang="ts">
import JobTracker from '@/components/JobTracker.vue';
import SignInGate from '@/components/SignInGate.vue';
import { useIsAuthed } from '@/composables/Auth';

const { isAuthed } = useIsAuthed();
</script>

<template>
  <SignInGate v-if="!isAuthed" />
  <JobTracker v-else />
</template>
