import { expect, test } from '@playwright/test';

test("Trend remix in demo mode: the sample, its shots, a character, Gemma's post, the 9:16", async ({ page }) => {
  await page.goto('/remix');
  await expect(page.getByRole('heading', { level: 1, name: 'Trend remix' })).toBeVisible();
  // The import by link exists only in the app on a machine of its own: never in the demo.
  await expect(page.getByRole('button', { name: 'A link' })).toHaveCount(0);
  await page.getByRole('button', { name: 'The example', exact: true }).first().click();
  await page.getByRole('button', { name: 'Use the example' }).click();
  const shots = page.locator('ol li').filter({ hasText: /^Shot \d/ });
  await expect(shots).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByText('6.0 s · 16 fps · 3 shots')).toBeVisible();

  // The character: the sample photo, and the face box, ticked each time.
  await page.getByRole('group', { name: 'The character' }).getByRole('button', { name: 'The example' }).click();
  await page.getByRole('button', { name: 'Use the example' }).last().click();
  const make = page.getByRole('button', { name: /^Remix 3 shot/ });
  await expect(make).toBeDisabled();
  await page.getByRole('checkbox', { name: /The person in this photo is me/ }).check();
  await expect(make).toBeEnabled();

  // Gemma reads the shots and drafts the post (the demo gives a file written beforehand).
  await page.getByRole('button', { name: /^Read the trend with Gemma/ }).click();
  await expect(page.getByRole('textbox', { name: 'Caption' })).toHaveValue(/Three moves, one character/, { timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: 'Hashtags' })).toHaveValue('#dance #remix #warmup #moves');

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/remix') && request.method() === 'POST');
  await make.click();
  const body = (await sent).postDataJSON() as { cuts: number[]; mode: string; faceConsent: boolean; keepSound: boolean; post: { hashtags: string[] } };
  expect(body).toMatchObject({ cuts: [32, 64], mode: 'motion', faceConsent: true, keepSound: false });
  expect(body.post.hashtags).toEqual(['dance', 'remix', 'warmup', 'moves']);
  const result = page.locator('section[aria-labelledby=trend-result] video');
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Download the 9:16' })).toHaveAttribute('href', /remix-9x16\.mp4$/);
  await expect(page.getByRole('button', { name: 'Copy the caption and hashtags' })).toBeVisible();
});

test('the cuts can be corrected: one removed, a shot cut in two', async ({ page }) => {
  await page.goto('/remix');
  await page.getByRole('button', { name: 'The example', exact: true }).first().click();
  await page.getByRole('button', { name: 'Use the example' }).click();
  const shots = page.locator('ol li').filter({ hasText: /^Shot \d/ });
  await expect(shots).toHaveCount(3, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Remove this cut' }).first().click();
  await expect(shots).toHaveCount(2);
  await expect(shots.first()).toContainText('0.0–4.0 s');
  await shots.first().getByRole('button', { name: 'Cut in two' }).click();
  await expect(shots).toHaveCount(3);
  await expect(shots.first()).toContainText('0.0–2.0 s');
});
