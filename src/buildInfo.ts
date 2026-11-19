declare const __APP_VERSION__: string;
declare const __BUILD_NUMBER__: string;
declare const __COMMIT_SHA__: string;
declare const __BUILD_DATE__: string;
declare const __BUILD_CHANNEL__: string;

export const BUILD = {
  version: __APP_VERSION__,
  build: __BUILD_NUMBER__,
  commit: __COMMIT_SHA__,
  date: __BUILD_DATE__,
  channel: __BUILD_CHANNEL__,
};

export const REPO_URL = 'https://github.com/lobojoel2003/Payeebook';

export const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
