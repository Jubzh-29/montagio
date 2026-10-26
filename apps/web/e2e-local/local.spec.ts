import { expect, test, type Page } from '@playwright/test';

/**
 * The Studio opens on Effects: a camera move and a film are one tab away, once the tab has opened. The link is a
 * client navigation, and until /api/extensions answers the header already marks Camera (the Studio's guess): the
 * URL says when the tab is the one asked for.
 */
async function openTab(page: Page, name: 'Camera' | 'Film') {
  await page.goto('/');
  const link = page.getByRole('link', { name, exact: true });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`[?]tab=${name.toLowerCase()}$`));
  await expect(link).toHaveAttribute('aria-current', 'page');
}

test('local mode: sample photo, one click, a clip from the proxy', async ({ page }) => {
  await openTab(page, 'Camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /\/media\/data\/generations\/.+\/clip\.mp4$/, {
    timeout: 30_000,
  });
  // The clip came through the proxy: a model's caption, where the demo backend's says "Demo render: no model ran here".
  await expect(page.getByTestId('ai-caption')).toHaveText(/^AI-generated · .+ [(](Apache-2\.0|MIT)[)]$/);
});

test('local mode: a two-shot film', async ({ page }) => {
  await openTab(page, 'Film');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  for (const name of ['Crash Push', 'Pan Left']) await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: /^Generate film/ }).click();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /\/media\/data\/sequences\/.+\/film\.mp4$/, {
    timeout: 60_000,
  });
});
