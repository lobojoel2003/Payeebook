#!/usr/bin/env node
/**
 * Regenerate the README screenshots from the demo book.
 *   npm run build && npm run screenshots
 * Needs Playwright's Chromium. The PDF preview also needs `pdftoppm` (poppler).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'images');
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch();
const tmp = mkdtempSync(join(tmpdir(), 'payeebook-shots-'));

async function demoPage(context) {
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /Explore a demo/ }).click();
  await page.getByTestId('total-funds').waitFor({ timeout: 30_000 });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(4500); // let the welcome toast fade
  return page;
}

async function shot(page, name, opts = {}) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`), ...opts });
  console.log(`docs/images/${name}.png`);
}

const desktop = { viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 };

// Light mode tour
{
  const ctx = await browser.newContext(desktop);
  const page = await demoPage(ctx);
  await shot(page, 'dashboard');

  await page.goto(`${BASE}#/transactions`);
  await page.getByTestId('tx-table').waitFor();
  await shot(page, 'transactions');

  await page.goto(`${BASE}#/import`);
  await page.getByRole('button', { name: /Try a sample file/ }).click();
  await page.getByTestId('import-run').waitFor();
  await shot(page, 'import');

  await page.goto(`${BASE}#/receipts`);
  await page.locator('.receipt-card').first().waitFor();
  await shot(page, 'receipts');

  await page.goto(`${BASE}#/reports?template=ssa-623-payee-report`);
  await page.getByTestId('report-preview').waitFor();
  await shot(page, 'reports');

  // PDF preview
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-pdf').click(),
  ]);
  const pdf = join(tmp, 'report.pdf');
  await dl.saveAs(pdf);
  try {
    execFileSync('pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', '3', pdf, join(tmp, 'page')]);
    // pdftoppm zero-pads page numbers to the width of the page count (page-01.png).
    const pages = readdirSync(tmp)
      .filter((f) => /^page-\d+\.png$/.test(f))
      .sort()
      .map((f) => join(tmp, f));
    const html = `<html><body style="margin:0;padding:28px;background:#e8e6df;display:flex;gap:24px">${pages
      .map(
        (p) =>
          `<img src="file://${p}" style="width:420px;box-shadow:0 6px 24px rgb(0 0 0/18%);background:#fff">`,
      )
      .join('')}</body></html>`;
    const sheet = join(tmp, 'sheet.html');
    writeFileSync(sheet, html);
    const p2 = await ctx.newPage();
    await p2.setViewportSize({
      width: 56 + pages.length * 420 + (pages.length - 1) * 24,
      height: 600,
    });
    await p2.goto(`file://${sheet}`);
    await p2.waitForTimeout(300);
    await p2.screenshot({ path: join(out, 'report-pdf.png'), fullPage: true });
    console.log('docs/images/report-pdf.png');
  } catch (e) {
    console.warn(`Skipping PDF preview (${e.message})`);
  }

  // Read-only share, opened by a sibling
  await page.goto(`${BASE}#/share`);
  await page.getByTestId('share-readonly').click();
  await page
    .getByRole('dialog')
    .getByLabel(/Protect with a passphrase/)
    .uncheck();
  const [snap] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('dialog').getByRole('button', { name: 'Create file' }).click(),
  ]);
  const snapFile = join(tmp, 'book.payeebook');
  await snap.saveAs(snapFile);
  await ctx.close();

  const sib = await browser.newContext(desktop);
  const sp = await sib.newPage();
  await sp.goto(BASE);
  await sp.getByRole('button', { name: /Open a shared book/ }).click();
  await sp.getByTestId('shared-file').setInputFiles(snapFile);
  await sp.getByRole('button', { name: 'Open read-only' }).click();
  await sp.getByText('Read-only shared book').waitFor();
  await sp.waitForTimeout(4500);
  await sp.goto(`${BASE}#/activity`);
  await sp.getByTestId('audit-status').waitFor();
  await shot(sp, 'shared-readonly');
  await sib.close();
}

// Dark mode
{
  const ctx = await browser.newContext({ ...desktop, colorScheme: 'dark' });
  const page = await demoPage(ctx);
  await shot(page, 'dashboard-dark');
  await ctx.close();
}

// Phone
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await demoPage(ctx);
  await shot(page, 'mobile');
  await ctx.close();
}

await browser.close();
stop();
