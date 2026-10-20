import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const sampleImage = resolve(__dirname, '../../../demo-assets/images/sample-16x9.png');

test('sequence happy path: three moves, one film, a 9:16 cut', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?tab=film');
  await page.setInputFiles('input[type=file]', sampleImage);
  for (const name of ['Crash Push', 'Pan Left', 'Slow Push']) await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: /^Generate film/ }).click();
  await expect(page.getByText(/Shot 1\/3/)).toBeVisible();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /\/media\/data\/sequences\//, {
    timeout: 60_000,
  });
  await expect(page.getByRole('link', { name: 'Download 9:16' })).toHaveAttribute('href', /film-9x16\.mp4$/);
  await expect(page.getByRole('link', { name: 'Download film' })).toHaveAttribute('href', /film\.mp4$/);
});

test('generate film needs two shots', async ({ page }) => {
  await page.goto('/?tab=film');
  await page.setInputFiles('input[type=file]', sampleImage);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await expect(page.getByRole('button', { name: /^Generate film/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await expect(page.getByRole('button', { name: /^Generate film/ })).toBeEnabled();
});

test('a shot can be removed and the list is capped at three', async ({ page }) => {
  await page.goto('/?tab=film');
  for (const name of ['Crash Push', 'Pan Left', 'Slow Push', 'Crash Push']) await page.getByRole('button', { name }).click();
  const shots = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Remove shot/ }) });
  await expect(shots).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove shot 2' }).click();
  await expect(shots).toHaveCount(2);
  await expect(shots.nth(1)).toContainText('Slow Push');
});

test('each shot can carry its own optional text', async ({ page }) => {
  await page.goto('/?tab=film');
  await page.setInputFiles('input[type=file]', sampleImage);
  for (const name of ['Crash Push', 'Pan Left']) await page.getByRole('button', { name }).click();
  await page.getByLabel('Scene (optional)').fill('a harbour at dawn');
  await page.getByRole('textbox', { name: 'Text for shot 2' }).fill('the fog lifts');
  const request = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/sequences'));
  await page.getByRole('button', { name: /^Generate film/ }).click();
  const body = (await request).postDataJSON() as { shots: { presetId: string; userPrompt?: string }[] };
  expect(body.shots[0]).toMatchObject({ presetId: 'crash-push', userPrompt: 'a harbour at dawn' });
  expect(body.shots[1]).toMatchObject({ presetId: 'pan-left', userPrompt: 'a harbour at dawn, the fog lifts' });
});
