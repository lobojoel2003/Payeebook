#!/usr/bin/env node
/**
 * Render the SVG logo to the PNG icons the PWA manifest, iOS and the desktop
 * app need. Run with `npm run icons` after changing public/favicon.svg.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// Maskable icons need the artwork inside the central 80% safe zone on a full-bleed background.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1f5f4f"/><g transform="translate(9.6 9.6) scale(0.7)">${inner.replace(/<rect[^>]*\/>/, '')}</g></svg>`;

const targets = [
  { file: 'public/pwa-192.png', size: 192, svg },
  { file: 'public/pwa-512.png', size: 512, svg },
  { file: 'public/pwa-maskable-512.png', size: 512, svg: maskable },
  { file: 'public/apple-touch-icon.png', size: 180, svg: maskable },
  { file: 'src-tauri/icons/source.png', size: 1024, svg },
  { file: 'docs/images/logo.png', size: 256, svg },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const sized = t.svg.replace('<svg ', `<svg width="${t.size}" height="${t.size}" `);
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  writeFileSync(join(root, t.file), buf);
  console.log(`wrote ${t.file} (${t.size}px)`);
}
await browser.close();
