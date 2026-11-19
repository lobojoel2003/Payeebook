import { useSyncExternalStore } from 'react';
import { isDesktopApp } from './buildInfo';

/**
 * Service worker registration for offline use. When a new version has been
 * downloaded, the app shows a banner instead of reloading under the user.
 */
let needRefresh = false;
let offlineReady = false;
let update: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function registerServiceWorker() {
  if (isDesktopApp || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    update = registerSW({
      immediate: true,
      onNeedRefresh() {
        needRefresh = true;
        emit();
      },
      onOfflineReady() {
        offlineReady = true;
        emit();
      },
    });
  } catch {
    /* offline support is optional */
  }
}

export function usePwaStatus() {
  const snapshot = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => `${needRefresh}|${offlineReady}`,
  );
  const [nr, or] = snapshot.split('|');
  return {
    needRefresh: nr === 'true',
    offlineReady: or === 'true',
    applyUpdate: () => update?.(true),
    dismiss: () => {
      needRefresh = false;
      offlineReady = false;
      emit();
    },
  };
}
