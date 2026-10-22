import { expect, test } from '@playwright/test';

test('a skip link comes first and leads past the header', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('after Use this photo, the focus goes back to the button that opened the atelier', async ({ page }) => {
  await page.goto('/?tab=camera');
  const opener = page.getByRole('button', { name: 'Text to image', exact: true });
  await opener.click();
  await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a red fox');
  await page.getByRole('button', { name: /^Create image/ }).click();
  await page.getByRole('button', { name: 'Use this photo', exact: true }).click({ timeout: 15_000 });
  await expect(opener).toBeFocused();
});

test('the Format and Look groups have a visible label', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  const format = page.getByRole('radiogroup', { name: 'Format' });
  await expect(format).toBeVisible();
  const labelledBy = await format.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();
  await expect(page.locator(`[id="${labelledBy}"]`)).toBeVisible();
});

test.describe('on a 1440×900 screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('only the previews in view play: a tile below the fold waits until it is seen', async ({ page }) => {
    await page.goto('/');
    const first = page.getByRole('button', { name: 'Squish', exact: true }).locator('video');
    const below = page.getByRole('button', { name: 'Ignite', exact: true });
    await expect.poll(() => first.evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
    expect(await below.evaluate((tile) => tile.getBoundingClientRect().top > window.innerHeight)).toBe(true);
    expect(await below.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    await below.scrollIntoViewIfNeeded();
    await expect.poll(() => below.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
  });
});
