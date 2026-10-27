import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const productPhoto = resolve(__dirname, '../../../demo-assets/images/sample-subject.png');
const referenceClip = resolve(__dirname, '../../../demo-assets/clips/_default.mp4');

/** The clip on the monitor once a new render has answered: its source differs from the one before the click. */
async function newResult(page: Page, before: string | null) {
  const video = page.locator('video[data-testid=result]');
  await expect(video).toBeVisible({ timeout: 30_000 });
  if (before) await expect(video).not.toHaveAttribute('src', before, { timeout: 30_000 });
  return video;
}

const resultSrc = (page: Page) => page.locator('video[data-testid=result]').getAttribute('src', { timeout: 1_000 }).catch(() => null);

/**
 * The jury's golden path in the app, demo backend: the viral effect, the camera move shared in 9:16, the ad, Genjutsu, the trend
 * remix, the captions and the Open Stack, one after the other in one visit, each to its result. Each step is the one
 * of its own spec; this one checks they hold together as a visitor goes through them, and it runs several times.
 */
test('golden path: effect, camera move and its share, ad, Genjutsu, trend remix, captions, open stack', async ({ page }) => {
  test.setTimeout(420_000);

  await test.step('a viral effect on the sample photo', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    await page.getByRole('button', { name: 'Squish' }).click();
    await page.getByRole('button', { name: /^Generate/ }).click();
    await newResult(page, null);
    // The demo's caption says no model ran, and names the one that makes it on a GPU.
    await expect(page.getByTestId('ai-caption')).toContainText('Wan 2.1');
  });

  await test.step('a camera move', async () => {
    const before = await resultSrc(page);
    await page.getByRole('link', { name: 'Camera', exact: true }).click();
    await expect(page).toHaveURL(/[?]tab=camera$/);
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    await page.getByRole('button', { name: 'Gallery', exact: true }).click();
    await page.getByRole('button', { name: 'Crash Push' }).click();
    await page.getByRole('button', { name: /^Generate/ }).click();
    await newResult(page, before);
    await expect(page.getByTestId('ai-caption')).toContainText('Wan 2.2');
  });

  await test.step('the camera move shared in 9:16, with its caption and the end card', async () => {
    await page.getByTestId('share-toggle').click();
    await expect(page.getByTestId('share-caption')).toHaveValue(/^Crash Push: one photo, one camera move\./);
    await page.getByTestId('share-make').click();
    await expect(page.getByTestId('share-download')).toHaveAttribute('href', /montagio-9x16\.mp4$/, { timeout: 60_000 });
  });

  await test.step('an ad from a product photo', async () => {
    await page.getByRole('link', { name: 'Ads', exact: true }).click();
    await expect(page).toHaveURL(/\/ads\/?$/);
    await page.setInputFiles('#ad-product', productPhoto);
    // An imported photo asks for the consent box once it is up: check() waits for it.
    await page.getByRole('checkbox', { name: /I am the person in this photo/ }).check();
    await page.getByRole('button', { name: /^Make the ad/ }).click();
    await expect(page.locator('section[aria-labelledby=ad-result] video')).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Genjutsu: a clip restyled', async () => {
    await page.goto('/?tab=motion&mode=restyle');
    await expect(page.getByTestId('motion-mode').getByRole('button', { name: 'Restyle the clip' })).toHaveAttribute('aria-pressed', 'true');
    await page.setInputFiles('#motion-video-input', referenceClip);
    await expect(page.getByTestId('motion-video-kept')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'What the scene becomes' }).fill('a snowy winter evening');
    await page.getByRole('checkbox', { name: 'I hold the rights on this clip, and on the image if I add one' }).check();
    await page.getByRole('button', { name: /^Generate/ }).click();
    await newResult(page, null);
    await expect(page.getByTestId('ai-caption')).toContainText('VACE');
  });

  await test.step('a trend remixed with the example character', async () => {
    await page.goto('/remix');
    await page.getByRole('button', { name: 'The example', exact: true }).first().click();
    await page.getByRole('button', { name: 'Use the example' }).click();
    await expect(page.locator('ol li').filter({ hasText: /^Shot \d/ })).toHaveCount(3, { timeout: 60_000 });
    await page.getByRole('group', { name: 'The character' }).getByRole('button', { name: 'The example' }).click();
    await page.getByRole('button', { name: 'Use the example' }).last().click();
    await page.getByRole('checkbox', { name: /The person in this photo is me/ }).check();
    await page.getByRole('button', { name: /^Remix 3 shot/ }).click();
    await expect(page.locator('section[aria-labelledby=trend-result] video')).toBeVisible({ timeout: 90_000 });
  });

  await test.step('captions on a talking photo, exported in 9:16', async () => {
    await page.goto('/?tab=avatar');
    // Until /api/extensions answers, the Studio assumes Camera: Sample gives the avatar its line once the tab is Avatar.
    await expect(page.getByRole('link', { name: 'Avatar', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    await page.getByRole('button', { name: /^Generate/ }).click();
    await newResult(page, null);
    const panel = page.getByTestId('captions-panel');
    await panel.getByRole('button', { name: /^Make captions/ }).click();
    await expect(panel.getByTestId('captions-text')).not.toHaveValue('', { timeout: 30_000 });
    await panel.getByRole('button', { name: 'Export 9:16' }).click();
    await expect(panel.getByTestId('captions-result')).toBeVisible({ timeout: 60_000 });
  });

  await test.step('the open stack: every model and its licence', async () => {
    await page.getByRole('link', { name: /open weights — verified/ }).click();
    await expect(page).toHaveURL(/\/open-stack\/?$/);
    const rows = page.locator('[data-testid=model-row]');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) await expect(row).toContainText(/Apache-2\.0|MIT/);
  });
});
