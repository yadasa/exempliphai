<script setup lang="ts">
const props = defineProps<{ compact?: boolean }>();
</script>

<template>
  <span
    class="plus-only-badge"
    :class="props.compact ? 'compact' : ''"
    role="note"
    aria-label="Plus only"
    title="Plus only"
  >
    <svg
      class="lock"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm3 8.73V17a1 1 0 1 1-2 0v-1.27a2 2 0 1 1 2 0Z"
      />
    </svg>
    <span>Plus only</span>
  </span>
</template>

<style scoped>
.plus-only-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 32%, var(--card-border));
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  color: var(--text-primary);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.01em;
  line-height: 1;
}

.plus-only-badge.compact {
  padding: 0.08rem 0.42rem;
  font-size: 0.64rem;
}

.lock {
  width: 0.8rem;
  height: 0.8rem;
  opacity: 0.92;
}

.plus-only-badge.compact .lock {
  width: 0.72rem;
  height: 0.72rem;
}
</style>
