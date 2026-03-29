<script setup lang="ts">
import { useToast } from '@/composables/Toast';

const { toastOn, toastMessage, toastVariant, hideToast } = useToast();
</script>

<template>
  <transition name="toast-fade">
    <div
      v-if="toastOn"
      class="toast"
      :class="toastVariant"
      role="status"
      aria-live="polite"
    >
      <div class="toastMsg">{{ toastMessage }}</div>
      <button class="toastClose" @click="hideToast" aria-label="Close">×</button>
    </div>
  </transition>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(var(--tab-bar-height, 64px) + 12px);
  z-index: 1000;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--toast-border, rgba(148, 163, 184, 0.35));

  background: var(--toast-bg, rgba(15, 23, 42, 0.92));
  color: var(--toast-text, #e2e8f0);

  box-shadow: 0 14px 35px rgba(2, 6, 23, 0.35);
  backdrop-filter: blur(8px);
}

.toastMsg {
  font-size: 0.9rem;
  line-height: 1.25;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toastClose {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 4px;
  opacity: 0.9;
}

.toastClose:hover {
  opacity: 1;
}

.toast.info {
  --toast-bg: rgba(15, 23, 42, 0.92);
}

.toast.success {
  --toast-bg: rgba(20, 83, 45, 0.92);
  --toast-border: rgba(34, 197, 94, 0.35);
}

.toast.warning {
  --toast-bg: rgba(120, 53, 15, 0.92);
  --toast-border: rgba(245, 158, 11, 0.35);
}

.toast.error {
  --toast-bg: rgba(127, 29, 29, 0.92);
  --toast-border: rgba(239, 68, 68, 0.35);
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
