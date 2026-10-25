import { expect, test } from '@playwright/test';

const AVATAR = '/?tab=avatar';

test('a talking avatar gets 9:16 captions: the words, a style, the exact preview, then the export', async ({ page }) => {
  await page.goto(AVATAR);
  await expect(page.getByRole('link', { name: 'Avatar', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  const line = page.getByRole('textbox', { name: 'What the photo says' });
  await expect(line).toHaveValue('Hello, this is a test of the Montagio avatar.');
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });

  const panel = page.getByTestId('captions-panel');
  await panel.getByRole('button', { name: /^Make captions/ }).click();
  // The words start from the typed text; Whisper heard "Shotrate" in the example clip.
  await expect(panel.getByTestId('captions-text')).toHaveValue('Hello, this is a test of the Montagio avatar.', { timeout: 30_000 });
  await expect(panel.getByRole('combobox', { name: 'Language' })).toHaveValue('auto');
  await expect(panel.getByText('Demo: Whisper did not run here; the timings come with the demo.')).toBeVisible();

  const pop = panel.getByRole('radio', { name: 'Pop' });
  await pop.click();
  await expect(pop).toHaveAttribute('aria-checked', 'true');
  // Arrow keys move the choice along the styles.
  await pop.press('ArrowRight');
  await expect(panel.getByRole('radio', { name: 'One word' })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByTestId('captions-preview')).toBeVisible({ timeout: 30_000 });

  await panel.getByRole('button', { name: 'Export 9:16' }).click();
  const video = panel.getByTestId('captions-result');
  await expect(video).toBeVisible({ timeout: 60_000 });
  const src = await video.getAttribute('src');
  expect(src).toMatch(/\/exports\/[^/]+\/video\.mp4$/);
  await expect(panel.getByRole('link', { name: 'Download 9:16' })).toHaveAttribute('download', 'montagio-captions-9x16.mp4');
  const clip = await page.request.get(src!);
  expect(clip.headers()['content-type']).toBe('video/mp4');
  expect((await clip.body()).length).toBeGreaterThan(10_000);
});

test('without the captions flag, a talking avatar shows no captions panel', async ({ page }) => {
  await page.route('**/api/extensions', async (route) => {
    const response = await route.fetch();
    const info = await response.json();
    delete info.captions;
    await route.fulfill({ response, json: info });
  });
  await page.goto(AVATAR);
  await expect(page.getByRole('link', { name: 'Avatar', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('textbox', { name: 'What the photo says' }).fill('Welcome to the studio: here is what we make.');
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('captions-panel')).toHaveCount(0);
});
