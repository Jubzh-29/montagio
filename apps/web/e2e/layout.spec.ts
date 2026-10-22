import { expect, test } from '@playwright/test';

const CAMERA = '/?tab=camera';

test('one tile for the moves and the effects: a sentence-case name, the description as its caption', async ({ page }) => {
  await page.goto('/');
  const squish = page.getByRole('button', { name: 'Squish', exact: true });
  await expect(squish).toHaveAccessibleDescription('Hands press the subject flat like soft clay.');
  const wallName = squish.locator('[class*="tileName"]');
  expect(await wallName.evaluate((element) => getComputedStyle(element).textTransform)).toBe('none');
  const wallRadius = await squish.locator('[class*="tileMedia"]').evaluate((element) => getComputedStyle(element).borderRadius);
  await page.goto(CAMERA);
  const crashPush = page.getByRole('button', { name: 'Crash Push', exact: true });
  await expect(crashPush).toHaveAccessibleDescription('Fast push toward the subject, ending tight.');
  expect(await crashPush.locator('[class*="tileMedia"]').evaluate((element) => getComputedStyle(element).borderRadius)).toBe(wallRadius);
});

test('the canvas switch reads as tabs; the pill is kept for options', async ({ page }) => {
  await page.goto('/');
  const gallery = page.getByRole('button', { name: 'Gallery', exact: true });
  const option = page.getByRole('button', { name: 'All', exact: true });
  await expect(option).toBeVisible();
  // A pill is a rounded box around its options; the view switch is a row of underlined words.
  const radiusOfGroup = (element: Element) => getComputedStyle(element.parentElement!).borderRadius;
  expect(await gallery.evaluate(radiusOfGroup)).toBe('0px');
  expect(await option.evaluate(radiusOfGroup)).not.toBe('0px');
});

test('with the atelier open, Generate steps back, and the canvas switch leads away and back to it', async ({ page }) => {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a red fox');
  const primary = await page.getByRole('button', { name: /^Create image/ }).evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await page.getByRole('button', { name: /^Generate/ }).evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(primary);
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pan Left', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Photo atelier', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Describe the photo' })).toHaveValue('a red fox');
});

test.describe('on a 1440×900 screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the required description of the photo is not under the Generate block', async ({ page }) => {
    await page.goto(CAMERA);
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    const field = page.getByRole('textbox', { name: 'What the photo shows', exact: true });
    await expect(field).toBeVisible();
    const covered = await field.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top !== element && !element.contains(top);
    });
    expect(covered).toBe(false);
  });
});

test('Remix preset sits on the choice card, beside Change', async ({ page }) => {
  await page.goto(CAMERA);
  await expect(page.getByTestId('choice-card').getByRole('button', { name: 'Remix preset', exact: true })).toBeVisible();
});
