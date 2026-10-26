import { expect, test, type Page } from '@playwright/test';

/** From an Explore card to a finished camera clip: the HD and the ComfyUI workflow sit under it. */
async function clipFromCard(page: Page, card: RegExp) {
  await page.goto('/explore');
  await page.getByRole('link', { name: card }).click();
  await expect(page).toHaveURL(/[?]tab=camera$/);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
}

test('the HD 1080p card leads to a clip that offers its HD version', async ({ page }) => {
  await clipFromCard(page, /^HD 1080p/);
  await expect(page.getByRole('button', { name: /^HD 1080p/ })).toBeEnabled();
});

test('the Open in ComfyUI card leads to a clip whose workflow downloads', async ({ page }) => {
  await clipFromCard(page, /^Open in ComfyUI/);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: /^Open in ComfyUI/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});
