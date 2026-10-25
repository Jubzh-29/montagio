import { expect, test } from '@playwright/test';

test('Sample keeps a description the visitor typed before it', async ({ page }) => {
  await page.goto('/?tab=camera');
  const scene = page.getByRole('textbox', { name: 'What the photo shows', exact: true });
  await scene.fill('my own words about the photo');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await expect(page.locator('img[class*="monitorMedia"]')).toBeVisible();
  await expect(scene).toHaveValue('my own words about the photo');
});

test('the latest creations are labelled, and a clip shows a frame past its first', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  const strip = page.getByTestId('recent-strip');
  const item = strip.getByRole('link', { name: /^Reuse: Crash Push/ }).first();
  await expect(item).toContainText('Crash Push');
  await expect(item.locator('video')).toHaveAttribute('src', /#t=0\.5$/);
});

test('in demo mode, a result says that no model ran', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/^Demo render: no model ran here\. With a GPU, Wan 2\.2 Fun Camera Turbo \(Apache-2\.0\) makes it\.$/);
});

test('the sample photo fits the tab: a subject for an effect, a face for an avatar, a character for a motion', async ({ page }) => {
  for (const [tab, label, file] of [
    ['effects', 'Effects', 'sample-subject'],
    ['avatar', 'Avatar', 'sample-portrait'],
    ['motion', 'Motion', 'sample-character'],
    ['camera', 'Camera', 'sample-16x9'],
  ] as const) {
    await page.goto(`/?tab=${tab}`);
    // The tab is settled (the extensions have answered) before the sample is asked for.
    await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    await expect(page.getByTestId('photo-slot').locator('img')).toHaveAttribute('src', new RegExp(`${file}\.png$`));
  }
});

test('a disabled button looks disabled', async ({ page }) => {
  await page.goto('/?tab=camera');
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  await expect(edit).toBeDisabled();
  expect(await edit.evaluate((element) => getComputedStyle(element).cursor)).toBe('not-allowed');
  expect(Number(await edit.evaluate((element) => getComputedStyle(element).opacity))).toBeLessThan(1);
});

test('the Open Stack row a caption links to is marked in ink, not in the lime of action', async ({ page }) => {
  await page.goto('/open-stack#model-wan22-i2v-a14b-fun-camera');
  const row = page.locator('#model-wan22-i2v-a14b-fun-camera');
  await expect(row).toHaveAttribute('data-target', 'true');
  const shadow = await row.evaluate((element) => getComputedStyle(element).boxShadow);
  // The lime accent (--rec, oklch(0.89 0.22 132)) is the colour of action.
  expect(shadow).not.toContain('0.89 0.22 132');
  expect(shadow).not.toBe('none');
});

test.describe('on a 1440×900 screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Quality, Turbo and Fast sit by Generate, each with its time', async ({ page }) => {
    await page.goto('/?tab=camera');
    const block = page.locator('[class*="generateBlock"]');
    // The pill (its radio is visually hidden) is on screen, beside Generate.
    // "2 min" holds a no-break space: \s matches it.
    await expect(block.locator('label').filter({ hasText: /^Fast · ~2\smin/ })).toBeInViewport();
    await expect(block.locator('label').filter({ hasText: /^Turbo · ~1\smin/ })).toBeInViewport();
    await expect(block.getByRole('radio', { name: /^Turbo · ~1 min/ })).toBeChecked();
    await expect(block.getByRole('radio', { name: /^Quality · ~9 min/ })).toBeAttached();
    await block.getByRole('radio', { name: /^Fast/ }).check({ force: true });
    await expect(page.getByRole('button', { name: /^Generate/ })).toHaveText('Generate (~2 min)');
    // Turbo says what its minute costs.
    await block.getByRole('radio', { name: /^Turbo/ }).check({ force: true });
    await expect(page.getByRole('button', { name: /^Generate/ })).toHaveText('Generate (~1 min)');
    await expect(block).toContainText('The same moves in 4 steps: a little less detail');
  });
});
