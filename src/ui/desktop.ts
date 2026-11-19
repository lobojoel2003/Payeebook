import { isDesktopApp } from '../buildInfo';

/** In the desktop app, open external links in the system browser instead of the app window. */
export function installDesktopLinkHandler() {
  if (!isDesktopApp) return;
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || !/^(https?:|mailto:)/.test(a.href)) return;
    if (new URL(a.href).origin === window.location.origin) return;
    e.preventDefault();
    void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(a.href));
  });
}
