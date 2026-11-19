/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function git(cmd: string, fallback: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
}

// Build metadata. CI sets BUILD_NUMBER from the workflow run number; local builds
// fall back to the commit count so every build still gets a monotonic number.
const buildNumber = process.env.BUILD_NUMBER ?? git('rev-list --count HEAD', '0');
const commit = (process.env.GITHUB_SHA ?? git('rev-parse HEAD', 'unknown')).slice(0, 7);
const buildDate = new Date().toISOString();
const channel = process.env.BUILD_CHANNEL ?? (process.env.CI ? 'ci' : 'local');

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
    __COMMIT_SHA__: JSON.stringify(commit),
    __BUILD_DATE__: JSON.stringify(buildDate),
    __BUILD_CHANNEL__: JSON.stringify(channel),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Payeebook',
        short_name: 'Payeebook',
        description:
          'Free, local-first accounts for Social Security representative payees, guardians and conservators.',
        theme_color: '#1f5f4f',
        background_color: '#f6f5f1',
        display: 'standalone',
        start_url: './',
        scope: './',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,yaml,woff2}'],
        globIgnores: ['vendor/tesseract/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // OCR engine and language data are large, so they are cached on first use
            // instead of being downloaded with the app shell.
            urlPattern: ({ url }) => url.pathname.includes('/vendor/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'payeebook-ocr',
              expiration: { maxEntries: 20 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/db/**/*.ts', 'src/pdf/**/*.ts'],
      exclude: ['**/*.test.ts'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
    },
  },
});
