import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDemo, download } from './helpers';

test('shares an encrypted read-only copy that a sibling can verify', async ({ page, browser }) => {
  await openDemo(page);
  await page.goto('#/share');
  await page.getByTestId('share-readonly').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Passphrase', { exact: true }).fill('purple elephant garden');
  await dialog.getByLabel('Repeat passphrase').fill('purple elephant garden');
  const { name, bytes } = await download(page, () =>
    dialog.getByRole('button', { name: 'Create file' }).click(),
  );
  expect(name).toMatch(/\.payeebook$/);
  expect(bytes.toString()).not.toContain('Margaret');
  const fingerprint = (await dialog.getByTestId('fingerprint').textContent())!.trim();

  const dir = mkdtempSync(join(tmpdir(), 'pb-'));
  const file = join(dir, name);
  writeFileSync(file, bytes);

  // A sibling on another device.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('./');
  await p2.getByRole('button', { name: /Open a shared book/ }).click();
  await p2.getByTestId('shared-file').setInputFiles(file);
  await p2.getByPlaceholder(/Ask the sender/).fill('purple elephant garden');
  await p2.getByRole('button', { name: 'Open read-only' }).click();
  await expect(p2.getByText('Read-only shared book')).toBeVisible();
  await expect(p2.getByText('Fingerprint verified')).toBeVisible();
  await expect(p2.locator('.banner code')).toHaveText(fingerprint);
  await expect(p2.getByRole('heading', { level: 1, name: 'Margaret Ellis' })).toBeVisible();
  await expect(p2.getByRole('link', { name: 'Import' })).toHaveCount(0);
  await p2.goto('#/transactions');
  await expect(p2.getByTestId('tx-table').getByRole('combobox')).toHaveCount(0);
  await other.close();
});

test('backs up and restores on another device', async ({ page, browser }) => {
  await openDemo(page);
  await page.goto('#/share');
  const { bytes } = await download(page, () => page.getByTestId('backup').click());
  expect(bytes.subarray(0, 15).toString()).toBe('SQLite format 3');
  const dir = mkdtempSync(join(tmpdir(), 'pb-'));
  const file = join(dir, 'backup.sqlite');
  writeFileSync(file, bytes);

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('./');
  await p2.getByRole('button', { name: /Restore a backup/ }).click();
  await p2.getByRole('dialog').locator('input[type=file]').setInputFiles(file);
  await expect(p2.getByText(/contains 1 book/)).toBeVisible();
  await p2.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(p2.getByRole('heading', { level: 1, name: 'Margaret Ellis' })).toBeVisible();
  await other.close();
});
