import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const sampleImage = resolve(__dirname, '../../../demo-assets/images/sample-16x9.png');

test('the studio opens on the effects wall', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Effects', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Squish' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'One-photo effects' })).toBeVisible();
});

test('an effect on a text-made photo needs no consent, and its subject comes from the text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a golden retriever on a beach');
  await page.getByRole('button', { name: /^Create image/ }).click();
  await page.getByRole('button', { name: 'Use this photo', exact: true }).click({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Explode' }).click();
  await expect(page.getByRole('textbox', { name: /What the photo shows/ })).toHaveValue('a golden retriever on a beach');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/effects'));
  await page.getByRole('button', { name: /^Generate/ }).click();
  expect((await request).postDataJSON()).toMatchObject({ effectId: 'explode', subject: 'a golden retriever on a beach' });
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/Wan 2[.]1/);
});

test('an effect on an imported photo asks for consent', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: 'Squish' }).click();
  const generate = page.getByRole('button', { name: /^Generate/ });
  await expect(generate).toBeDisabled();
  await page.getByRole('checkbox', { name: /I am the person in this photo/ }).check();
  await expect(generate).toBeEnabled();
});

test('the wall requests no preview that does not exist', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/media/presets/effects/previews/') && response.status() === 404) missing.push(response.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Squish' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(missing).toEqual([]);
});
