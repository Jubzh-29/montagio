import { expect, test } from '@playwright/test';

const CAMERA = '/?tab=camera';

async function makeClip(page: import('@playwright/test').Page) {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('textbox', { name: /Scene/ }).fill('a harbour at dawn');
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
}

test('a clip made in the studio is in the history and comes back with Reuse', async ({ page }) => {
  await makeClip(page);
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page).toHaveURL(/\/history\/?$/);
  const card = page.getByRole('listitem').filter({ hasText: 'Clip · Pan Left' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: 'Download' })).toHaveAttribute('href', /\/media\/data\/generations\//);
  await card.getByRole('link', { name: 'Reuse' }).click();
  await expect(page).toHaveURL(/[?]tab=camera$/);
  await expect(page.getByRole('button', { name: 'Pan Left' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: /Scene/ })).toHaveValue('a harbour at dawn');
  await expect(page.getByTestId('photo-slot').locator('img')).toHaveAttribute('src', /\/media\/data\/uploads\//);
});

test('the recent strip shows the last creation under the result', async ({ page }) => {
  await makeClip(page);
  await expect(page.getByRole('heading', { name: 'Your latest creations' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Reuse: Pan Left/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'See all', exact: true })).toHaveAttribute('href', '/history');
});

test('the history speaks French', async ({ page }) => {
  await page.goto('/history');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Historique', exact: true })).toHaveAttribute('aria-current', 'page');
});

async function renderHeld(page: import('@playwright/test').Page) {
  await makeClip(page);
  // The next render's polls are held, so it stays running.
  await page.route('**/api/generations/*', (route) => (route.request().method() === 'GET' ? new Promise(() => undefined) : route.continue()));
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
}

test('the recent strip is out of reach while a render runs', async ({ page }) => {
  await renderHeld(page);
  await expect(page.getByTestId('recent-strip')).toHaveAttribute('inert', '');
});

test('a Reuse that comes during a render waits for its end', async ({ page }) => {
  await renderHeld(page);
  let reprises = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/history') reprises++;
  });
  await page.locator('a[href*="from="]').first().dispatchEvent('click');
  await expect(page).toHaveURL(/from=/);
  await page.waitForTimeout(2000);
  expect(reprises).toBe(0);
  await expect(page.getByRole('progressbar')).toBeVisible();
});
