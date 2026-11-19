import { test, expect } from '@playwright/test';
import { createBook } from './helpers';

test('imports a bank CSV, skips duplicates and remembers tags', async ({ page }) => {
  await createBook(page);
  await page.goto('#/import');
  await page.getByRole('button', { name: /Try a sample file/ }).click();
  await expect(page.getByText('7 new')).toBeVisible();
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('import-done')).toContainText('Imported 7 transactions');

  // The same file again: nothing new.
  await page.getByRole('button', { name: 'Import another file' }).click();
  await page.getByRole('button', { name: /Try a sample file/ }).click();
  await expect(page.getByText('7 already imported')).toBeVisible();
  await expect(page.getByTestId('import-run')).toBeDisabled();

  // SSA deposit was tagged by a built-in rule.
  await page.goto('#/transactions');
  const ssa = page.getByRole('row').filter({ hasText: 'SSA Treas' });
  await expect(ssa.getByRole('combobox')).toHaveValue('benefits_ssa');

  // Tag once: Cub Foods as Food, and remember it.
  const cub = page.getByRole('row').filter({ hasText: 'Cub Foods' });
  await cub.getByRole('combobox').selectOption('food');
  await page.getByRole('button', { name: /Yes, (remember|and tag)/ }).click();
  await expect(page.getByText(/Future imports from/)).toBeVisible();
  await page.goto('#/settings#rules');
  await expect(page.locator('#rules')).toContainText('CUB FOODS');
});
