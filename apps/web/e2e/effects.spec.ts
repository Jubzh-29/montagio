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

test('an effect on a composed start photo needs no photo of its own', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Squish' }).click();
  await page.getByRole('button', { name: 'Character · Location · Product' }).click();
  await page.setInputFiles('#compose-character', sampleImage);
  await page.setInputFiles('#compose-location', sampleImage);
  await page.getByRole('checkbox', { name: /I am the person in this photo/ }).check();
  await expect(page.getByText('Pick a photo to start.')).toHaveCount(0);
  const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/effects'));
  await page.getByRole('button', { name: /^Generate/ }).click();
  const body = (await request).postDataJSON() as { effectId: string; compose?: unknown; imageRef?: string };
  expect(body).toMatchObject({ effectId: 'squish', compose: expect.anything() });
  expect(body.imageRef).toBeUndefined();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
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

test('Iris Dive on the sample photo: the end frame, then the clip', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Iris Dive' }).click();
  await expect(page.getByRole('textbox', { name: /What the photo shows/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByTestId('hook-end-frame')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('end-frame-caption')).toHaveText(/Qwen-Image-Edit-2511/);
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/Wan 2[.]2/);
});

test('Wardrobe Swap waits for its outfit, and an imported outfit asks for consent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Wardrobe Swap' }).click();
  const generate = page.getByRole('button', { name: /^Generate/ });
  await expect(generate).toBeDisabled();
  await expect(page.getByText('Add the outfit photo to generate.')).toBeVisible();
  await page.setInputFiles('#outfit-input', sampleImage);
  await expect(page.getByTestId('outfit-slot').locator('img')).toBeVisible();
  await expect(generate).toBeDisabled();
  await page.getByRole('checkbox', { name: /I am the person in this photo/ }).check();
  await expect(generate).toBeEnabled();
});

test('the filter shows hooks only', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Hooks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Iris Dive' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Squish' })).toHaveCount(0);
});

test('a hook ComfyUI refuses at its second step takes the hooks away', async ({ page }) => {
  let rejected = false;
  // The edit ran; the transition's workflow is refused while the job advances (a missing node or file).
  await page.route('**/api/jobs/*', async (route) => {
    const response = await route.fetch();
    const job = (await response.json()) as Record<string, unknown>;
    rejected = true;
    return route.fulfill({ response, json: { ...job, state: 'failed', error: 'workflow-rejected' } });
  });
  await page.route('**/api/extensions', async (route) => {
    const response = await route.fetch();
    const info = (await response.json()) as { extensions: string[] };
    if (!rejected) return route.fulfill({ response });
    return route.fulfill({ response, json: { ...info, extensions: info.extensions.filter((id) => id !== 'transitions'), hooks: [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Iris Dive' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Iris Dive' })).toHaveCount(0);
});

test('the Effects wall has its pause button', async ({ page }) => {
  await page.goto('/');
  // Its own button, in the wall: the Camera wall's one does not stop these tiles.
  const pause = page.getByRole('region', { name: 'One-photo effects' }).getByRole('button', { name: /^(Pause|Play) previews$/ });
  await expect(pause).toHaveCount(1);
  const before = await pause.getAttribute('aria-label');
  await pause.click();
  await expect(pause).not.toHaveAttribute('aria-label', before!);
});
