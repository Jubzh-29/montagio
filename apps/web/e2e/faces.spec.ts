import { expect, test } from '@playwright/test';

test('a starting face becomes a character in two clicks, with its settings and its traits', async ({ page }) => {
  await page.goto('/characters');
  const faces = page.getByRole('list', { name: 'Start from a face' });
  await faces.getByRole('button', { name: 'Marlo', exact: true }).click();
  await expect(faces.getByRole('button', { name: 'Marlo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Its settings fill the form: the style, the traits, the words; its picture is the portrait to name.
  await expect(page.getByRole('radio', { name: 'Extreme', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('group', { name: 'Hair' }).getByRole('button', { name: 'Sculptural', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Skin' }).getByRole('button', { name: 'Porcelain', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Started from Marlo' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Marlo');
  await page.getByRole('button', { name: 'Save the character', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Marlo', level: 2 })).toBeVisible();
  await expect(page.getByText(/^Extreme · Sculptural · Porcelain · a man in his sixties/)).toBeVisible();
  // Its pictures go to the Studio through the face itself.
  await expect(page.getByRole('region', { name: 'Marlo' }).getByRole('link', { name: 'Avatar', exact: true }).first()).toHaveAttribute('href', /from=face%3Amarlo/);
});

test('a trait chip lets go when pressed again, and only one per row stays pressed', async ({ page }) => {
  await page.goto('/characters');
  const skin = page.getByRole('group', { name: 'Skin' });
  await skin.getByRole('button', { name: 'Stone', exact: true }).click();
  await skin.getByRole('button', { name: 'Chrome', exact: true }).click();
  await expect(skin.getByRole('button', { name: 'Stone', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(skin.getByRole('button', { name: 'Chrome', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await skin.getByRole('button', { name: 'Chrome', exact: true }).click();
  await expect(skin.getByRole('button', { name: 'Chrome', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('in the Avatar tab, a face stands in for a photo: no consent to tick, and it renders', async ({ page }) => {
  await page.goto('/?tab=avatar');
  await expect(page.getByRole('link', { name: 'Avatar', exact: true })).toHaveAttribute('aria-current', 'page');
  const faces = page.getByRole('list', { name: 'Start from a face' });
  await faces.getByRole('button', { name: 'Odile', exact: true }).click();
  await expect(page.getByTestId('photo-slot').locator('img')).toHaveAttribute('src', '/media/demo-assets/faces/odile.jpg');
  await expect(faces.getByRole('button', { name: 'Odile', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'What the photo says' }).fill('Good morning, I bake bread for the whole village.');
  await expect(page.getByRole('checkbox', { name: /consent/i })).toHaveCount(0);
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 30_000 });
});

test('a link to a face opens the tab with that face as the start photo', async ({ page }) => {
  await page.goto('/?tab=motion&from=face%3Abolt');
  await expect(page.getByTestId('photo-slot').locator('img')).toHaveAttribute('src', '/media/demo-assets/faces/bolt.jpg');
  await expect(page).toHaveURL(/\?tab=motion$/);
});
