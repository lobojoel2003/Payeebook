import { test, expect } from '@playwright/test';
import { createBook } from './helpers';

test('a new book survives a reload (local-first storage)', async ({ page }) => {
  await createBook(page);
  await expect(page.getByTestId('total-funds')).toHaveText('$500.00');
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Rosa Diaz' })).toBeVisible();
  await page.goto('#/settings');
  await expect(page.getByTestId('app-version')).toContainText(/\d+\.\d+\.\d+ \(build \d+\)/);
});

test('adds a transaction by hand and tags it once for the future', async ({ page }) => {
  await createBook(page);
  await page.goto('#/transactions');
  await page.getByRole('button', { name: 'Add' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('e.g. Lakeview Apartments').fill('Lakeview Apartments');
  await dialog.getByRole('textbox', { name: 'Amount' }).fill('850');
  await dialog.getByRole('combobox', { name: 'Category' }).selectOption('housing');
  await dialog.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByTestId('tx-table')).toContainText('Lakeview Apartments');
  await expect(page.getByTestId('tx-table')).toContainText('-$850.00');
  await expect(page.getByTestId('tx-table')).toContainText('-$350.00');
});
