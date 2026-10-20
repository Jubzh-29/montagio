import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const sampleImage = resolve(__dirname, '../../../demo-assets/images/sample-16x9.png');
// The camera presets live in the Camera tab; with every extension on, the Studio opens on Effects.
const CAMERA = '/?tab=camera';

test('studio happy path in demo mode', async ({ page }) => {
  await page.goto(CAMERA);
  await expect(page.getByRole('link', { name: /open weights — verified/ })).toBeVisible();
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /\/media\//, { timeout: 15_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/^AI-generated · .+ [(]Apache-2.0[)]$/);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Open in ComfyUI' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});

test('generate stays disabled until an image and a preset are chosen', async ({ page }) => {
  await page.goto(CAMERA);
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
  await page.goto(CAMERA);
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate/ }).dblclick();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  expect(posts).toBe(1);
});

test('french toggle', async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'FR', exact: true }).click();
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
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
});

test('a generation the server no longer knows ends as lost instead of freezing', async ({ page }) => {
  await page.goto(CAMERA);
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
  await page.goto(CAMERA);
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.route(/\/api\/generations\/[^/]+$/, (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeEnabled();
});

test('a slow first upload cannot replace a newer photo', async ({ page }) => {
  let uploads = 0;
  await page.route('**/api/uploads', async (route) => {
    uploads += 1;
    if (uploads === 1) await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  const refs: string[] = [];
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/uploads')) refs.push(((await response.json()) as { imageRef: string }).imageRef);
  });
  await page.goto(CAMERA);
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.setInputFiles('input[type=file]', sampleImage);
  await expect.poll(() => refs.length, { timeout: 10_000 }).toBe(2);
  const newest = refs[0]!; // the second upload answers first
  const body = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/api/generations'));
  await page.getByRole('button', { name: /^Generate/ }).click();
  expect(((await body).postDataJSON() as { imageRef: string }).imageRef).toBe(newest);
});

test('the photo cannot be swapped while a render is running', async ({ page }) => {
  await page.goto(CAMERA);
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('input[type=file]')).toBeDisabled();
});

test('the Generate button is reachable without scrolling on a laptop screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(CAMERA);
  await expect(page.getByRole('button', { name: 'Crash Push' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeInViewport();
});

test('the gallery requests no preview video that does not exist', async ({ page }) => {
  // Missing previews must not be requested at all: on a slow server, a dozen 404s hold the
  // browser's six connections and stall the app's own calls. Existing previews may load.
  const missing: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/media/presets/previews/') && response.status() === 404) missing.push(response.url());
  });
  await page.goto(CAMERA);
  await expect(page.getByRole('button', { name: 'Crash Push' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(missing).toEqual([]);
});

test('a tab is a link: Film opens its wall, the header marks it, the URL keeps it', async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('link', { name: 'Film', exact: true }).click();
  await expect(page).toHaveURL(/[?]tab=film$/);
  await expect(page.getByRole('link', { name: 'Film', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Crash Push' })).toBeVisible();
});

test('a tab the Studio does not show falls back to the first one', async ({ page }) => {
  await page.goto('/?tab=nowhere');
  await expect(page.locator('nav').getByRole('link').first()).toHaveAttribute('aria-current', 'page');
});

test('a camera clip gets its HD version', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /^HD 1080p/ }).click();
  await expect(page.getByRole('link', { name: 'Download in HD' })).toHaveAttribute('href', /\/media\/data\/jobs\/.+\/output\.mp4$/, { timeout: 15_000 });
  await expect(page.getByTestId('hd-caption')).toHaveText(/SeedVR2/);
});

test('with no extension shown, no extension button anywhere', async ({ page }) => {
  await page.route('**/api/extensions', (route) => route.fulfill({ json: { extensions: [], effects: [], hooks: [], estimates: { t2i: 12 } } }));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Camera', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const tab of ['Effects', 'Avatar']) await expect(page.getByRole('link', { name: tab, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /^HD 1080p/ })).toHaveCount(0);
});
