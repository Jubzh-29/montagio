import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const referenceClip = resolve(__dirname, '../../../demo-assets/clips/_default.mp4');

test('Restyle in demo mode: a clip, what its scene becomes, the rights box, the clip', async ({ page }) => {
  await page.goto('/?tab=motion&mode=restyle');
  const modes = page.getByTestId('motion-mode');
  await expect(modes.getByRole('button')).toHaveText(['Move a character', 'Restyle the clip', 'Swap an object']);
  await expect(modes.getByRole('button', { name: 'Restyle the clip' })).toHaveAttribute('aria-pressed', 'true');
  await page.setInputFiles('#motion-video-input', referenceClip);
  await expect(page.getByTestId('motion-video-kept')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('textbox', { name: 'What the scene becomes' }).fill('a snowy winter evening');
  const generate = page.getByRole('button', { name: /^Generate/ });
  await expect(generate).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I hold the rights on this clip, and on the image if I add one' }).check();
  await generate.click();
  // Without a look image, the edit restyles the first frame first: two steps, then the clip.
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/VACE/);
  await expect(page.getByTestId('motion-no-sound')).toBeVisible();
});

test('Swap an object in demo mode: the object painted on the first frame is sent as points', async ({ page }) => {
  await page.goto('/?tab=motion&mode=swap');
  await expect(page.getByTestId('motion-mode').getByRole('button', { name: 'Swap an object' })).toHaveAttribute('aria-pressed', 'true');
  // The warning stands above the clip.
  await expect(page.getByTestId('swap-people')).toHaveText(/Never replace a real person in a real video without their consent/);
  await page.setInputFiles('#motion-video-input', referenceClip);
  const canvas = page.getByTestId('swap-mark').locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const generate = page.getByRole('button', { name: /^Generate/ });
  await expect(generate).toBeDisabled();
  await expect(page.locator('#generate-reason')).toHaveText('Paint the object to replace on the first image.');
  // A stroke across the middle of the first frame, once it is on screen (the mouse reaches nothing below the fold)
  // at its own size (the frame's).
  await expect(canvas).toHaveAttribute('width', /^\d+$/);
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('textbox', { name: 'What replaces it' }).fill('a red vintage motorbike');
  await page.getByRole('checkbox', { name: 'I hold the rights on this clip and on the photo, and the people filmed agree' }).check();
  const sent = page.waitForRequest((request) => request.url().endsWith('/api/swap') && request.method() === 'POST');
  await generate.click();
  const body = (await sent).postDataJSON() as { prompt: string; points: { x: number; y: number }[]; rights: boolean };
  expect(body.prompt).toBe('a red vintage motorbike');
  expect(body.rights).toBe(true);
  expect(body.points.length).toBeGreaterThan(0);
  for (const point of body.points) {
    // on the stroke: the middle band of the frame
    expect(point.x).toBeGreaterThan(0.35);
    expect(point.x).toBeLessThan(0.65);
    expect(point.y).toBeGreaterThan(0.4);
    expect(point.y).toBeLessThan(0.6);
  }
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ai-caption')).toHaveText(/object swap/);
});
