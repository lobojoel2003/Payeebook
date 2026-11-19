import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createBook } from './helpers';

test('reads a receipt photo on-device and records the purchase', async ({ page }) => {
  test.setTimeout(150_000);
  await createBook(page);
  await page.goto('#/receipts');
  await page
    .getByTestId('receipt-file')
    .setInputFiles(fileURLToPath(new URL('./fixtures/receipt.png', import.meta.url)));
  const job = page.getByTestId('receipt-job');
  await expect(job.getByText(/Read with \d+% confidence/)).toBeVisible({ timeout: 120_000 });
  await expect(job.getByRole('textbox', { name: 'Receipt total' })).toHaveValue('11.47');
  await expect(job.locator('input[type=date]')).toHaveValue('2026-03-14');
  await job.getByRole('radio', { name: /new cash or card payment/ }).check();
  await job.getByRole('combobox', { name: 'Category' }).selectOption('food');
  await page.getByTestId('receipt-save').click();
  await expect(page.getByText('Receipt saved and attached.')).toBeVisible();
  await page.goto('#/transactions');
  await expect(page.getByTestId('tx-table')).toContainText('-$11.47');
  await expect(page.getByTestId('tx-table').getByLabel('1 receipt')).toBeVisible();
});
