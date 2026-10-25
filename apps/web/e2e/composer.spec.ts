import { expect, test, type Locator } from '@playwright/test';

/** Whether the element's centre is under another element (the Generate block, a caption). */
const coveredAtCentre = (element: Locator) =>
  element.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top !== node && !node.contains(top);
  });

test.describe('on a 1440×900 screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the choice is one row, its thumbnail beside its name; the start photo follows it', async ({ page }) => {
    await page.goto('/?tab=effects');
    const choice = page.getByTestId('choice-card');
    await expect(choice).toContainText('Squish');
    const box = (await choice.boundingBox())!;
    expect(box.height).toBeLessThan(120);
    const photo = (await page.getByTestId('photo-slot').boundingBox())!;
    expect(photo.y - (box.y + box.height)).toBeLessThan(80);
  });

  test('the Generate block is opaque, with a rule over it, and leaves the fields of Camera uncovered', async ({ page }) => {
    await page.goto('/?tab=camera');
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    const block = page.locator('[class*="generateBlock"]');
    const style = await block.evaluate((element) => {
      const css = getComputedStyle(element);
      return { image: css.backgroundImage, top: css.borderTopWidth };
    });
    expect(style).toEqual({ image: 'none', top: '1px' });
    for (const name of ['What the photo shows']) {
      const field = page.getByRole('textbox', { name, exact: true });
      await field.scrollIntoViewIfNeeded();
      expect(await coveredAtCentre(field)).toBe(false);
    }
  });

  test('a disabled Generate is an outline, not the grey of the option selected above it', async ({ page }) => {
    await page.goto('/?tab=camera');
    const generate = page.getByRole('button', { name: /^Generate/ });
    await expect(generate).toBeDisabled();
    const selected = page.locator('[class*="generateBlock"] label[data-selected="true"]');
    const ground = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await ground(generate)).not.toBe(await ground(selected));
    expect(await generate.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe('solid');
  });

  test('once an image is made in the atelier, Use this photo is the accent button', async ({ page }) => {
    await page.goto('/?tab=camera');
    // The accent as the page computes it (--rec): a button read mid-transition gives a colour in between.
    const accent = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('span'));
      probe.style.backgroundColor = 'var(--rec)';
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    await page.getByRole('button', { name: 'Text to image', exact: true }).click();
    await page.getByRole('textbox', { name: 'Describe the photo' }).fill('a red fox in the snow');
    const create = page.getByRole('button', { name: /^Create image/ });
    // toHaveCSS waits out the background's transition from disabled to enabled.
    await expect(create).toHaveCSS('background-color', accent);
    await create.click();
    const use = page.getByRole('button', { name: 'Use this photo', exact: true });
    await expect(use).toBeVisible({ timeout: 15_000 });
    await expect(use).toHaveCSS('background-color', accent);
    await expect(create).not.toHaveCSS('background-color', accent);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const tab of ['avatar', 'motion']) {
    test(`${tab}: the empty monitor keeps its words apart from the example's caption`, async ({ page }) => {
      await page.goto(`/?tab=${tab}`);
      const monitor = page.getByTestId('monitor');
      const hint = monitor.getByText('Add it under Start photo.');
      const caption = monitor.getByText('Example made with Montagio · AI-generated');
      await expect(caption).toBeVisible();
      const a = (await hint.boundingBox())!;
      const b = (await caption.boundingBox())!;
      expect(a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    });
  }
});

test('on Open Stack, a weight under 0.1 GB reads in MB, not "0.0 GB"', async ({ page }) => {
  await page.goto('/open-stack');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/^0[.,]0 GB$/)).toHaveCount(0);
  await expect(page.getByText(/^\d+([.,]\d)? MB$/).first()).toBeVisible();
});
