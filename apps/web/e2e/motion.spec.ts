import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const MOTION = '/?tab=motion';
const referenceClip = resolve(__dirname, '../../../demo-assets/clips/_default.mp4');

test('a motion transfer in demo mode: the photo, a reference clip, the rights box, the clip', async ({ page }) => {
  await page.goto(MOTION);
  await expect(page.getByRole('link', { name: 'Motion', exact: true })).toHaveAttribute('aria-current', 'page');
  // No wall on this tab: the canvas shows the monitor.
  await expect(page.getByRole('button', { name: 'Gallery', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  // A clip of one's own replaces the sample dance, and asks for the rights.
  await page.setInputFiles('#motion-video-input', referenceClip);
  // The server keeps 5 s at most, without the sound, and says so.
  await expect(page.getByTestId('motion-video-kept')).toHaveText(/^[\d.]+ s kept of [\d.]+ s, without its sound$/, { timeout: 30_000 });
  await page.getByRole('textbox', { name: 'What it does (optional)' }).fill('waves, then turns around');
  const generate = page.getByRole('button', { name: /^Generate/ });
  await expect(generate).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I hold the rights on this video and on this photo' }).check();
  await generate.click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/Animate/);
  await expect(page.getByTestId('motion-no-sound')).toBeVisible();
});

test('Sample brings the character and its dance: no rights to confirm, and the GPU render of that pair', async ({ page }) => {
  await page.goto(MOTION);
  await expect(page.getByRole('link', { name: 'Motion', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await expect(page.getByTestId('motion-video-kept')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('checkbox', { name: 'I hold the rights on this video and on this photo' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/^Demo render: no model ran here\. On a GPU, .*Animate.* made this clip of the same sample photo · AI-generated$/);
});

test('the Motion tab draws no camera move over the photo', async ({ page }) => {
  const plan = page.locator('[class*="photoPlan"]');
  const photo = page.locator('img[class*="monitorMedia"]');
  // On Camera, the move in hand frames the photo: the locator finds it.
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Monitor', exact: true }).click();
  await expect(photo).toBeVisible();
  await expect(plan).toHaveCount(1);
  // A motion transfer moves the character, not the camera.
  await page.goto(MOTION);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await expect(photo).toBeVisible();
  await expect(plan).toHaveCount(0);
});

test('without the rights box, Generate stays disabled', async ({ page }) => {
  await page.goto(MOTION);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.setInputFiles('#motion-video-input', referenceClip);
  await expect(page.getByTestId('motion-video-kept')).toBeVisible({ timeout: 30_000 });
  const rights = page.getByRole('checkbox', { name: 'I hold the rights on this video and on this photo' });
  await expect(rights).not.toBeChecked();
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeDisabled();
  await rights.check();
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeEnabled();
});

test('without the motion extension, no Motion tab', async ({ page }) => {
  await page.route('**/api/extensions', async (route) => {
    const response = await route.fetch();
    const info = (await response.json()) as { extensions: string[] };
    return route.fulfill({ response, json: { ...info, extensions: info.extensions.filter((id) => id !== 'motion') } });
  });
  await page.goto(MOTION);
  await expect(page.getByRole('link', { name: 'Camera', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Motion', exact: true })).toHaveCount(0);
});
