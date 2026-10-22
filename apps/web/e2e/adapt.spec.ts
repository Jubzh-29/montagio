import { expect, test } from '@playwright/test';

// A phone: what the audit saw at 375 px.
test.use({ viewport: { width: 375, height: 812 } });

test('on a phone, the wall comes before the form, in one row that scrolls sideways', async ({ page }) => {
  await page.goto('/');
  const firstTile = page.getByRole('button', { name: 'Squish' });
  await expect(firstTile).toBeVisible();
  const tileTop = (await firstTile.boundingBox())!.y;
  const photoTop = (await page.getByRole('heading', { name: 'Start photo' }).boundingBox())!.y;
  expect(tileTop).toBeLessThan(photoTop);
  // The whole wall is one row: the photo slot stays a thumb away.
  const wall = page.getByTestId('effect-wall');
  expect(await wall.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  // On arrival, without scrolling: the effects are what a visitor sees first.
  await expect(firstTile).toBeInViewport();
});

test('on a phone, the tabs scroll sideways and say there are more', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('navigation', { name: 'Creation' });
  await expect(tabs).toHaveAttribute('data-more-after', 'true');
  await tabs.getByRole('link', { name: 'History', exact: true }).scrollIntoViewIfNeeded();
  await expect(tabs.getByRole('link', { name: 'History', exact: true })).toBeInViewport();
  await expect(tabs).not.toHaveAttribute('data-more-after', 'true');
  await expect(tabs).toHaveAttribute('data-more-before', 'true');
});

test('on a phone, the header is opaque over the page it covers', async ({ page }) => {
  await page.goto('/');
  const background = await page.locator('header').first().evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).not.toMatch(/\/ 0\.\d+\)|rgba\(.*, 0\.\d+\)/);
});

test('a result is not covered by Replace photo', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await expect(page.getByTestId('monitor').getByText('Replace photo')).toBeVisible();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('monitor').getByText('Replace photo')).toHaveCount(0);
});

test('tiles show a still frame while their clip loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Squish' }).locator('video')).toHaveAttribute('poster', /squish\.jpg$/);
  await page.goto('/?tab=camera');
  await expect(page.getByRole('button', { name: 'Crash Push' }).locator('video')).toHaveAttribute('poster', /crash-push\.jpg$/);
});

test('on a phone, the Open Stack rows keep a margin on the right', async ({ page }) => {
  await page.goto('/open-stack');
  const rows = page.locator('[data-testid=model-row]');
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    const box = (await row.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375 - 16);
  }
});
