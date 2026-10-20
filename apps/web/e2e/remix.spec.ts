import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// The remix routes (preset YAML, validate) compile on their first request in `next dev`:
// on a loaded machine that alone can pass the 5 s default, so their first answers get more.
const FIRST_COMPILE = { timeout: 15_000 };

// Once a clip is shown, two buttons say "Remix preset": the result's, and the gallery's while the editor is closed.
const resultRemix = (page: Page) =>
  page.getByRole('region', { name: 'Monitor' }).getByRole('button', { name: 'Remix preset', exact: true });
const galleryRemix = (page: Page) => page.locator('aside').getByRole('button', { name: 'Remix preset', exact: true });
const result = (page: Page) => page.locator('video[data-testid=result]');
// The canvas shows the wall (presets, or the remix editor in its place) or the monitor, one at a time.
const showGallery = (page: Page) => page.getByRole('button', { name: 'Gallery', exact: true }).click();
const showMonitor = (page: Page) => page.getByRole('button', { name: 'Monitor', exact: true }).click();

async function openRemix(page: Page) {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
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
  await expect(result(page)).toBeVisible({ timeout: 10_000 });
  // The editor that rendered this clip is where the result's "Remix preset" leads back.
  await resultRemix(page).click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(/speed: 0\.8/);
});

test('remix: a past remix reopens with its own text, not in the editor of another preset', async ({ page }) => {
  const editor = await openRemix(page);
  await editor.fill((await editor.inputValue()).replace('speed: 1.5', 'speed: 0.8'));
  await page.getByRole('button', { name: /^Generate remix/ }).click();
  await expect(result(page)).toBeVisible({ timeout: 10_000 });
  await showGallery(page);
  await page.getByRole('button', { name: 'Back to presets', exact: true }).click();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await galleryRemix(page).click();
  await expect(editor).toHaveValue(/id: pan-left/);
  await showMonitor(page);
  await resultRemix(page).click();
  await expect(editor).toHaveValue(/id: crash-push[\s\S]*speed: 0\.8/, FIRST_COMPILE);
  await expect(page.getByRole('heading', { name: 'Remix: Crash Push' })).toBeVisible();
  await expect(editor).toBeFocused();
});

test('remix: the result asks before replacing unsaved edits of another preset', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate \(/ }).click();
  await expect(result(page)).toBeVisible({ timeout: 10_000 });
  await showGallery(page);
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await galleryRemix(page).click();
  const editor = page.getByRole('textbox', { name: 'Preset YAML' });
  await expect(editor).toHaveValue(/id: pan-left/, FIRST_COMPILE);
  await editor.fill((await editor.inputValue()).replace('speed: 1.0', 'speed: 0.3'));

  const questions: string[] = [];
  page.once('dialog', (dialog) => {
    questions.push(dialog.message());
    void dialog.dismiss();
  });
  await showMonitor(page);
  await resultRemix(page).click();
  await expect.poll(() => questions).toEqual([expect.stringMatching(/Pan Left/)]);
  // Declined: nothing changed, the editor still holds the other preset's edits.
  await showGallery(page);
  await expect(editor).toHaveValue(/id: pan-left[\s\S]*speed: 0\.3/);

  page.once('dialog', (dialog) => void dialog.accept());
  await showMonitor(page);
  await resultRemix(page).click();
  await expect(editor).toHaveValue(/id: crash-push[\s\S]*speed: 1\.5/);
});

test('remix: a check result goes away when the model changes', async ({ page }) => {
  await openRemix(page);
  await page.getByRole('button', { name: 'Check preset', exact: true }).click();
  await expect(page.getByText('Valid preset: Crash Push')).toBeVisible(FIRST_COMPILE);
  await page.getByText('Wan 2.2 5B').click();
  await expect(page.getByText('Valid preset: Crash Push')).toBeHidden();
});

test('remix: a remix over 16 KB is refused and the editor gets the focus back', async ({ page }) => {
  const editor = await openRemix(page);
  await editor.fill(`${await editor.inputValue()}#${'x'.repeat(17 * 1024)}\n`);
  await page.getByRole('button', { name: /^Generate remix/ }).click();
  await expect(page.getByText('This preset is larger than 16 KB.')).toBeVisible(FIRST_COMPILE);
  await expect(editor).toBeFocused();
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
  await page.getByRole('button', { name: 'Back to presets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crash Push' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Generate/ })).toHaveText(/^Generate \(/);
});

test('remix: the editor belongs to the Camera tab, the Film tab closes it', async ({ page }) => {
  const editor = await openRemix(page);
  await page.getByRole('link', { name: 'Film', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Crash Push' })).toBeVisible();
});
