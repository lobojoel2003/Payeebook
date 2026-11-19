import { test, expect } from '@playwright/test';
import { openDemo, download } from './helpers';

test('fills a court account from the demo ledger and downloads the PDF', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/reports?template=us-generic-annual-account');
  const preview = page.getByTestId('report-preview');
  await expect(preview).toContainText('Schedule B — Receipts');
  await expect(page.getByText('Start + receipts − disbursements = end')).toBeVisible();
  const { name, bytes } = await download(page, () => page.getByTestId('download-pdf').click());
  expect(name).toMatch(/\.pdf$/);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(20_000);
  await expect(page.getByText('Saved reports')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Annual account/ })).toBeVisible();
});

test('marking a report as filed locks its period', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/reports?template=ssa-623-payee-report');
  await page.getByRole('button', { name: /Mark as filed/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as filed' }).click();
  await expect(page.getByText(/are locked/).first()).toBeVisible();
  await page.goto('#/transactions');
  await expect(page.getByLabel('Locked by a filed report').first()).toBeVisible();
  await page.goto('#/activity');
  await expect(page.getByTestId('audit-status')).toContainText('Chain verified');
  await expect(page.getByText(/Marked SSA-623 as filed/)).toBeVisible();
});
