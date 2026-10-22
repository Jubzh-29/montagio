import { expect, test } from '@playwright/test';

const CAMERA = '/?tab=camera';

test('in French, the moves and the effects have French names', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Écrasé/ })).toBeVisible();
  await page.getByRole('link', { name: 'Caméra', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Avancée lente/ })).toBeVisible();
});

test("History titles a clip by what its photo shows, not by its model", async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('textbox', { name: 'What the photo shows', exact: true }).fill('a harbour at dawn, seen from the pier');
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.goto('/history');
  const card = page.getByRole('listitem').filter({ hasText: 'a harbour at dawn, seen from the pier' }).first();
  await expect(card.locator('[class*="cardName"]')).toHaveText(/a harbour at dawn, seen from the pier/);
});

test('a failed render says so without its raw code, and Try again renders again', async ({ page }) => {
  let posts = 0;
  let fail = true;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/generations')) posts++;
  });
  await page.route('**/api/generations/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const record = (await response.json()) as Record<string, unknown>;
    return route.fulfill({ response, json: fail ? { ...record, state: 'failed', error: 'comfy-node-error-xyz', outputUrl: undefined } : record });
  });
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  const notice = page.getByTestId('monitor').getByRole('alert');
  await expect(notice).toContainText('The render failed.');
  await expect(notice).not.toContainText('comfy-node-error-xyz');
  fail = false;
  await notice.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  expect(posts).toBe(2);
});

test("an effect's example subject reads as an example, not as a typed value", async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: /What the photo shows/ })).toHaveAttribute('placeholder', /^e\.g\. /);
});
