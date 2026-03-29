import { ref, computed } from 'vue';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

const toastOn = ref(false);
const toastMessage = ref('');
const toastVariant = ref<ToastVariant>('info');

let hideTimer: number | null = null;

function clearHideTimer() {
  if (hideTimer != null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function useToast() {
  const hideToast = () => {
    clearHideTimer();
    toastOn.value = false;
  };

  const showToast = (
    message: string,
    opts?: {
      variant?: ToastVariant;
      timeoutMs?: number;
    }
  ) => {
    clearHideTimer();

    toastMessage.value = String(message || '').trim();
    toastVariant.value = (opts?.variant || 'info') as ToastVariant;
    toastOn.value = true;

    const timeoutMs = Number.isFinite(opts?.timeoutMs) ? Number(opts?.timeoutMs) : 3000;
    if (timeoutMs > 0) {
      hideTimer = window.setTimeout(() => {
        toastOn.value = false;
        hideTimer = null;
      }, timeoutMs);
    }
  };

  return {
    toastOn: computed(() => toastOn.value),
    toastMessage: computed(() => toastMessage.value),
    toastVariant: computed(() => toastVariant.value),
    showToast,
    hideToast,
  };
}
