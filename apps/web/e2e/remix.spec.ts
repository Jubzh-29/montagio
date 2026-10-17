import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// The remix routes (preset YAML, validate) compile on their first request in `next dev`:
// on a loaded machine that alone can pass the 5 s default, so their first answers get more.
const FIRST_COMPILE = { timeout: 15_000 };

async function openRemix(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with a sample photo' }).click();
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: 'Remix preset', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Preset YAML' });
  await expect(editor).toHaveValue(/id: crash-push/, FIRST_COMPILE);
  return editor;
}

test('remix: edit the speed, check, generate', async ({ page }) => {
  const editor = await openRemix(page);
  await editor.fill((await editor.inputValue()).replace('speed: 1.5', 'speed: 0.8'));
  await page.getByRole('button', { name: 'Check preset', exact: true }).click();
  await expect(page.getByText('Valid preset: Crash Push')).toBeVisible(FIRST_COMPILE);
  await page.getByRole('button', { name: /^Generate remix/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 10_000 });
});

test('remix: a typo is listed with its field', async ({ page }) => {
  const editor = await openRemix(page);
  // The live region is in the accessibility tree before anything is announced in it.
  const status = page.locator('#remix-status[aria-live=polite]');
  await expect(status).toBeAttached();
  await expect(status).not.toHaveCSS('display', 'none');
  await editor.fill((await editor.inputValue()).replace('speed: 1.5', 'sped: 1.5'));
  await page.getByRole('button', { name: 'Check preset', exact: true }).click();
  await expect(page.getByText(/camera.*sped/)).toBeVisible(FIRST_COMPILE);
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await expect(editor).toHaveAttribute('aria-describedby', 'remix-status');
});

test('remix: download the edited YAML', async ({ page }) => {
  const editor = await openRemix(page);
  await editor.fill((await editor.inputValue()).replace('speed: 1.5', 'speed: 0.8'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download YAML', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/remix\.yaml$/);
  expect(await readFile((await file.path())!, 'utf8')).toContain('speed: 0.8');
});

test('remix: back to presets restores the gallery', async ({ page }) => {
  await openRemix(page);
  await expect(page.getByRole('button', { name: 'Sequence', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to presets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crash Push' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Generate/ })).toHaveText(/^Generate \(/);
  await expect(page.getByRole('button', { name: 'Sequence', exact: true })).toBeEnabled();
});
