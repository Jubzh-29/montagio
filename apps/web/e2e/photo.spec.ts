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
  // The photo comes described by its own text: the camera move follows it.
  await expect(page.getByRole('textbox', { name: 'What the photo shows', exact: true })).toHaveValue('a lighthouse at dusk, waves crashing');
  await page.getByRole('button', { name: 'Crash Push' }).click();
  const body = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/api/generations'));
  await page.getByRole('button', { name: /^Generate/ }).click();
  expect(((await body).postDataJSON() as { userPrompt?: string }).userPrompt).toBe('a lighthouse at dusk, waves crashing');
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
  await expect(page.getByTestId('ai-caption')).toHaveText(/^After · AI-generated · Qwen-Image-Edit-2511.*[(]Apache-2[.]0[)]$/);
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

test('the atelier keeps its text and its image across a tab change', async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a red kite over a field');
  await page.getByRole('button', { name: /^Create image/ }).click();
  await page.getByRole('link', { name: 'Film', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Describe the photo' })).toBeHidden();
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Describe the photo' })).toHaveValue('a red kite over a field');
  await page.getByRole('button', { name: 'Use this photo', exact: true }).click({ timeout: 15_000 });
});

test('an edit ComfyUI refuses takes the Edit button away', async ({ page }) => {
  let refused = false;
  await page.route('**/api/edits', (route) => {
    refused = true;
    return route.fulfill({ status: 422, json: { error: 'workflow-rejected' } });
  });
  // Once ComfyUI refused it, the server hides the extension (and the one that requires it).
  await page.route('**/api/extensions', async (route) => {
    if (!refused) return route.continue();
    const response = await route.fetch();
    const info = (await response.json()) as { extensions: string[] };
    return route.fulfill({ response, json: { ...info, extensions: info.extensions.filter((id) => id !== 'edit' && id !== 'transitions') } });
  });
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'What to change' }).fill('make it night');
  await page.getByRole('button', { name: /^Edit [(]/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /./ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});

test('another photo asks for consent again in the atelier', async ({ page }) => {
  await page.goto(CAMERA);
  const slot = page.getByTestId('photo-slot').locator('img');
  await page.setInputFiles('input[type=file]', sampleImage);
  await expect(slot).toBeVisible();
  const first = await slot.getAttribute('src');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const consent = page.getByRole('checkbox', { name: /I am the person in this photo/ });
  await consent.check();
  await page.setInputFiles('input[type=file]', sampleImage);
  await expect(slot).not.toHaveAttribute('src', first!);
  await expect(consent).not.toBeChecked();
});

test('an edit keeps showing the photo it started from', async ({ page }) => {
  // The edit's polls are held, so it stays running while the visitor loads another photo.
  await page.route('**/api/jobs/*', () => new Promise(() => undefined));
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const before = page.getByRole('figure').filter({ hasText: 'Before' }).locator('img');
  const first = await before.getAttribute('src');
  await page.getByRole('textbox', { name: 'What to change' }).fill('make it night');
  await page.getByRole('button', { name: /^Edit [(]/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.setInputFiles('input[type=file]', sampleImage);
  await expect(page.getByTestId('photo-slot').locator('img')).not.toHaveAttribute('src', first!);
  await expect(before).toHaveAttribute('src', first!);
});
