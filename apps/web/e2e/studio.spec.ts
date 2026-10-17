import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const sampleImage = resolve(__dirname, '../../../demo-assets/images/sample-16x9.png');

test('studio happy path in demo mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /open weights — verified/ })).toBeVisible();
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /\/media\//, { timeout: 15_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Open in ComfyUI' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});

test('generate stays disabled until an image and a preset are chosen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeDisabled();
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeEnabled();
});

test('double click sends a single generation', async ({ page }) => {
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/generations')) posts++;
  });
  await page.goto('/');
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate/ }).dblclick();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  expect(posts).toBe(1);
});

test('french toggle', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'FR' }).click();
  await expect(page.getByRole('button', { name: /^Générer/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /open weights — vérifié/ })).toBeVisible();
});

test('open stack page lists three Apache-2.0 models', async ({ page }) => {
  await page.goto('/open-stack');
  const rows = page.locator('[data-testid=model-row]');
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) await expect(row).toContainText('Apache-2.0');
});

test('a sample photo lets a visitor try without their own image', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with a sample photo' }).click();
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
});

test('a generation the server no longer knows ends as lost instead of freezing', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.route(/\/api\/generations\/[^/]+$/, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ status: 404, json: { error: 'not-found' } }) : route.continue(),
  );
  await expect(page.getByRole('alert').filter({ hasText: 'lost' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeEnabled();
});

test('repeated server errors while polling end in an error state', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.route(/\/api\/generations\/[^/]+$/, (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeEnabled();
});
