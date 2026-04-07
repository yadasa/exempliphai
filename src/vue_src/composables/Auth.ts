import { onBeforeUnmount, onMounted, ref } from 'vue';

export function useIsAuthed() {
  const isAuthed = ref(false);

  const refresh = () => {
    try {
      chrome.storage.local.get(['firebaseAuth'], (res) => {
        const fa = (res as any)?.firebaseAuth;
        isAuthed.value = !!(fa && typeof fa === 'object' && fa.uid && fa.idToken);
      });
    } catch (_) {
      isAuthed.value = false;
    }
  };

  const onChanged = (changes: any, area: string) => {
    if (area !== 'local') return;
    if (changes?.firebaseAuth) refresh();
  };

  onMounted(() => {
    refresh();
    try {
      chrome.storage.onChanged.addListener(onChanged as any);
    } catch (_) {}
  });

  onBeforeUnmount(() => {
    try {
      chrome.storage.onChanged.removeListener(onChanged as any);
    } catch (_) {}
  });

  return { isAuthed, refresh };
}
