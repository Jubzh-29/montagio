import { expect, test } from '@playwright/test';

const AVATAR = '/?tab=avatar';

test('an avatar from the sample photo: the clip and its caption', async ({ page }) => {
  await page.goto(AVATAR);
  await expect(page.getByRole('link', { name: 'Avatar', exact: true })).toHaveAttribute('aria-current', 'page');
  // No wall on this tab: the canvas shows the monitor.
  await expect(page.getByRole('button', { name: 'Gallery', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('textbox', { name: 'What the photo says' }).fill('Welcome to the studio: here is what we make.');
  await expect(page.getByText('≈ 2.9 s of speech', { exact: true })).toBeVisible();
  // The slate under the monitor says how long the take may last, not a camera clip's 5 s.
  await expect(page.getByText('480p · 2.9 s', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/S2V/);
});

test('a long French text warns before Generate', async ({ page }) => {
  await page.goto(AVATAR);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Français', exact: true }).click();
  await page.getByRole('textbox', { name: 'What the photo says' }).fill('Bonjour '.repeat(37));
  await expect(page.getByText('This may last over 15 s, the most an avatar animates: shorten the text.')).toBeVisible();
  // The real voice decides: Generate stays open.
  await expect(page.getByRole('button', { name: /^Generate/ })).toBeEnabled();
});

test('without the avatar extension, no Avatar tab', async ({ page }) => {
  await page.route('**/api/extensions', async (route) => {
    const response = await route.fetch();
    const info = (await response.json()) as { extensions: string[] };
    return route.fulfill({ response, json: { ...info, extensions: info.extensions.filter((id) => id !== 'avatar') } });
  });
  await page.goto(AVATAR);
  await expect(page.getByRole('link', { name: 'Camera', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Avatar', exact: true })).toHaveCount(0);
});

test('on the French interface, the avatar speaks French by default', async ({ page }) => {
  await page.goto(AVATAR);
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Français', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
