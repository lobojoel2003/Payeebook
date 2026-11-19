import { test, expect } from '@playwright/test';
import { openDemo } from './helpers';

test('works on a phone @mobile', async ({ page }) => {
  await openDemo(page);
  const nav = page.locator('.bottom-nav');
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Receipts' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Receipts' })).toBeVisible();
  await nav.getByRole('link', { name: 'More' }).click();
  await expect(page.getByRole('link', { name: /Reconcile/ })).toBeVisible();
});
