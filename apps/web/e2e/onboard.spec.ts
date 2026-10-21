import { expect, test } from '@playwright/test';

const CAMERA = '/?tab=camera';

test('the Studio says what it does: a visible promise, and what each tab makes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^One photo → a few seconds of viral effect/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('tab-lede')).toContainText('Pick an effect');
  await page.getByRole('link', { name: 'Camera', exact: true }).click();
  await expect(page.getByTestId('tab-lede')).toContainText('camera move');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Une photo → un effet viral de quelques secondes/);
});

test('a photo on Camera shows on the monitor, with the frame of where the move ends', async ({ page }) => {
  await page.goto(CAMERA);
  await expect(page.getByRole('button', { name: 'Gallery', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  // No click on Monitor: the photo and the dashed frame of the chosen move are what the canvas shows.
  await expect(page.getByRole('button', { name: 'Monitor', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('img[class*="monitorMedia"]')).toBeVisible();
  await expect(page.locator('[class*="photoPlan"]')).toHaveCount(1);
  // The moves are one click away.
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pan Left' })).toBeVisible();
});

test('Hooks and Remix preset are explained where they are', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Effects animate your photo as it is. Hooks first edit it into an end frame, then animate the way there.')).toBeVisible();
  await page.goto(CAMERA);
  await expect(page.getByRole('button', { name: 'Remix preset', exact: true })).toHaveAccessibleDescription(/YAML/);
});

test('a disabled Create image says why', async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  const create = page.getByRole('button', { name: /^Create image/ });
  await expect(create).toBeDisabled();
  await expect(create).toHaveAccessibleDescription('Describe the photo to create it.');
  await expect(page.getByText('Describe the photo to create it.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a red fox');
  await expect(create).toBeEnabled();
  await expect(page.getByText('Describe the photo to create it.')).toHaveCount(0);
});
