import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const sampleImage = resolve(__dirname, '../../../demo-assets/images/sample-16x9.png');
const CAMERA = '/?tab=camera';

test('a text makes the start photo, then a camera move animates it', async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a lighthouse at dusk, waves crashing');
  await page.getByRole('radio', { name: '9:16' }).click();
  await page.getByRole('button', { name: /^Create image/ }).click();
  await expect(page.getByTestId('atelier-result')).toHaveAttribute('src', /\/media\/data\/uploads\//, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Use this photo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create the start photo from a text' })).toHaveCount(0);
  await expect(page.getByTestId('photo-slot').locator('img')).toHaveAttribute('src', /\/media\/data\/uploads\//);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
});

test('a double click on Create image makes one job', async ({ page }) => {
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/images')) posts++;
  });
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a red fox');
  await page.getByRole('button', { name: /^Create image/ }).dblclick();
  await expect(page.getByTestId('atelier-result')).toBeVisible({ timeout: 15_000 });
  expect(posts).toBe(1);
});

test('the atelier stays open when the extensions answer late', async ({ page }) => {
  // On a slow first load the Studio guesses Camera, then Effects opens: that must not close the atelier.
  let release!: () => void;
  const late = new Promise<void>((done) => (release = done));
  await page.route('**/api/extensions', async (route) => {
    await late;
    await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a red kite over a field');
  release();
  await expect(page.getByRole('link', { name: 'Effects', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: 'Describe the photo' })).toHaveValue('a red kite over a field');
  await page.getByRole('button', { name: /^Create image/ }).click();
  await page.getByRole('button', { name: 'Use this photo', exact: true }).click({ timeout: 15_000 });
});

test('editing an imported photo asks for consent first', async ({ page }) => {
  await page.goto(CAMERA);
  await page.setInputFiles('input[type=file]', sampleImage);
  await expect(page.getByTestId('photo-slot').locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'What to change' }).fill('make it snow');
  const apply = page.getByRole('button', { name: /^Edit [(]/ });
  await expect(apply).toBeDisabled();
  await page.getByRole('checkbox', { name: /I am the person in this photo/ }).check();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByTestId('atelier-result')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Before', { exact: true })).toBeVisible();
});

test('the sample photo needs no consent to be edited', async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'What to change' }).fill('make it night');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit [(]/ })).toBeEnabled();
});

test('the atelier speaks French', async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await page.getByRole('button', { name: 'Texte → image', exact: true }).click();
  await expect(page.getByRole('heading', { name: "Créer la photo de départ à partir d'un texte" })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Créer l'image/ })).toBeDisabled();
});
