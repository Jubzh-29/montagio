import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function makeClip(page: Page) {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('textbox', { name: 'What the photo shows', exact: true }).fill('a harbour at dawn');
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
}

test('a result shows its recipe: seed, weights linked to Open Stack, the honest note, and the JSON to download', async ({ page }) => {
  await makeClip(page);
  const panel = page.getByTestId('recipe-panel');
  await panel.getByText('Recipe', { exact: true }).click();
  await expect(panel.getByText('Seed', { exact: true })).toBeVisible();
  await expect(panel.getByTestId('recipe-weight').first().getByRole('link')).toHaveAttribute('href', /\/open-stack#model-/);
  await expect(panel).toContainText('identical result on the same setup, very close elsewhere');
  await expect(panel).toContainText('Demo render: no model ran here');
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByTestId('recipe-download').click()]);
  expect(download.suggestedFilename()).toMatch(/^montagio-recipe-camera-[0-9a-f-]+\.json$/);
  const recipe = JSON.parse(await readFile((await download.path())!, 'utf8')) as { schema: string; seed: number; request: { body: { seed: number } } };
  expect(recipe.schema).toBe('montagio/recipe@1');
  expect(recipe.request.body.seed).toBe(recipe.seed);
});

test('Reproduce from History renders with the same seed and says the workflow is the same', async ({ page }) => {
  await makeClip(page);
  const items = (await (await page.request.get('/api/history')).json()) as { key: string; reprise: { seed?: number } }[];
  const seed = items[0]!.reprise.seed!;
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByTestId('history-reproduce').first().click();
  await expect(page).toHaveURL(/[?]tab=camera$/);
  await expect(page.getByTestId('replay-seed')).toContainText(`Seed ${seed}`);
  const [request] = await Promise.all([
    page.waitForRequest((req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/generations'),
    page.getByRole('button', { name: /^Generate/ }).click(),
  ]);
  expect((request.postDataJSON() as { seed?: number }).seed).toBe(seed);
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('recipe-compare')).toHaveText('Same workflow as the original.');
});

test('New seed drops the seed: the next render draws its own', async ({ page }) => {
  await makeClip(page);
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByTestId('history-reproduce').first().click();
  await page.getByRole('button', { name: 'New seed', exact: true }).click();
  await expect(page.getByTestId('replay-seed')).toHaveCount(0);
  const [request] = await Promise.all([
    page.waitForRequest((req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/generations'),
    page.getByRole('button', { name: /^Generate/ }).click(),
  ]);
  expect((request.postDataJSON() as { seed?: number }).seed).toBeUndefined();
});
