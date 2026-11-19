import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

export async function openDemo(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: /Explore a demo/ }).click();
  await expect(page.getByTestId('total-funds')).toBeVisible({ timeout: 30_000 });
}

export async function createBook(page: Page, name = 'Rosa Diaz') {
  await page.goto('./');
  await page.getByRole('button', { name: /Start a book/ }).click();
  await page.getByPlaceholder('Beneficiary’s full name').fill(name);
  await page.getByPlaceholder('The person keeping these books').fill('Ana Diaz');
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('textbox', { name: /Balance at the start/ }).fill('500.00');
  await page.getByRole('button', { name: 'Create the book' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

export async function download(page: Page, action: () => Promise<unknown>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path!) };
}
