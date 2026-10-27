import { expect, test, type Page } from '@playwright/test';

const result = (page: Page) => page.locator('video[data-testid=result]');

/**
 * The jury's golden path in the showcase, the static export with no server: it opens on a viral effect, then a camera
 * move with its 9:16 to post, a film assembled by FFmpeg in the browser, and the Open Stack, each step to its clip in
 * one visit, as a juror goes through them. It runs several times in a row.
 */
test('golden path: effect, camera move and its share, film, open stack', async ({ page }) => {
  test.setTimeout(240_000);

  await test.step('the arrival plays a viral effect', async () => {
    await page.goto('/');
    await expect(result(page)).toHaveAttribute('src', /\/showcase\/effects\/squish--landscape-b\.mp4$/);
    await expect(page.getByTestId('result-caption')).toContainText('Pre-generated with Montagio');
  });

  await test.step('a camera move, and its 9:16 to post with a caption to paste', async () => {
    await page.getByRole('link', { name: 'Camera', exact: true }).click();
    await page.getByRole('button', { name: 'Gallery', exact: true }).click();
    await page.getByRole('button', { name: 'Crash Push' }).click();
    await page.getByRole('button', { name: /^Show clip/ }).click();
    await expect(result(page)).toHaveAttribute('src', /\/showcase\/clips\/crash-push--landscape-b\.mp4$/);
    await page.getByTestId('share-toggle').click();
    await expect(page.getByTestId('share-caption')).toHaveValue(/^Crash Push: one photo, one camera move\.\nAI-generated with /);
    // No server here: the 9:16 prepared with the clip, without the end card the app adds at home.
    await expect(page.getByTestId('share-download')).toHaveAttribute('href', /\/showcase\/clips\/.+\.mp4$/);
    await expect(page.getByTestId('share-end-card')).toHaveCount(0);
    await expect(page.getByText('Montagio adds the end card when it runs on your machine.')).toBeVisible();
  });

  await test.step('a three-shot film assembled in the browser', async () => {
    await page.getByRole('link', { name: 'Film', exact: true }).click();
    for (const name of ['Crash Push', 'Pan Left', 'Slow Push']) await page.getByRole('button', { name }).click();
    await page.getByRole('button', { name: /^Assemble film/ }).click();
    await expect(result(page)).toHaveAttribute('src', /^blob:/, { timeout: 90_000 });
    await expect(page.getByRole('link', { name: 'Download 9:16' })).toHaveAttribute('href', /^blob:/);
  });

  await test.step('the open stack: every model and its licence', async () => {
    await page.getByRole('link', { name: /open weights — verified/ }).click();
    await expect(page).toHaveURL(/\/open-stack\/?$/);
    const rows = page.locator('[data-testid=model-row]');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) await expect(row).toContainText(/Apache-2\.0|MIT/);
  });
});
