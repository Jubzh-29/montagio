import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Every request the page makes must stay on its own origin (no CDN, no font host,
 * no analytics) and find its file (a 404 would show in the jury's console).
 */
function watchRequests(page: Page): () => string[] {
  const urls: string[] = [];
  const failed: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  return () => [
    ...urls.filter((url) => !url.startsWith('http://localhost:3101/') && !url.startsWith('blob:') && !url.startsWith('data:')),
    ...failed,
  ];
}

const probe = (file: string) =>
  JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration:format_tags=comment', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  ) as { streams: { width: number; height: number }[]; format: { duration: string; tags?: { comment?: string } } };

test('the showcase plays the pre-generated clip of a sample and a preset', async ({ page }) => {
  const foreign = watchRequests(page);
  await page.goto('/');
  await expect(page.getByText(/clips pre-generated with Montagio on open weights/)).toBeVisible();
  await page.getByRole('button', { name: /Placeholder landscape A/ }).click();
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Show clip/ }).click();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /\/showcase\/clips\/crash-push--landscape-a\.mp4$/);
  await expect(page.getByTestId('result-caption')).toHaveText(/Placeholder|Pre-generated with Montagio/);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Open in ComfyUI' }).click();
  const workflow = await download;
  expect(workflow.suggestedFilename()).toBe('montagio-crash-push.json');
  expect(readFileSync(await workflow.path(), 'utf8')).toContain('"class_type"');
  await expect(page.getByRole('link', { name: 'Source code (AGPL-3.0)' })).toHaveAttribute('href', 'https://example.invalid/montagio');
  expect(foreign()).toEqual([]);
});

test('a dropped photo is explained, never uploaded', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Placeholder landscape A/ })).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['not really a png'], 'my-photo.png', { type: 'image/png' }));
    return transfer;
  });
  await page.getByTestId('monitor').dispatchEvent('drop', { dataTransfer });
  // Next adds its own role="alert" (the route announcer): pick ours by its text.
  await expect(page.getByRole('alert').filter({ hasText: 'Run Montagio on your machine' })).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});

test('the remix is checked for real but not rendered', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: 'Remix preset' }).click();
  const editor = page.locator('#remix-yaml');
  await expect(editor).toHaveValue(/id: crash-push/);
  await page.getByRole('button', { name: 'Check preset' }).click();
  await expect(page.getByText('Valid preset: Crash Push')).toBeVisible();
  await editor.fill((await editor.inputValue()).replace(/^camera:\n( {2}.*\n)+/m, ''));
  await page.getByRole('button', { name: 'Check preset' }).click();
  await expect(page.getByText('Fix these lines before generating:')).toBeVisible();
  await expect(page.getByText(/Your remix is checked here for real/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Generate remix/ })).toHaveCount(0);
});

test('a three-shot film is assembled by FFmpeg in the browser', async ({ page }) => {
  const foreign = watchRequests(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sequence', exact: true }).click();
  await expect(page.getByText(/every shot starts from the sample photo/)).toBeVisible();
  await page.getByRole('button', { name: /Placeholder landscape A/ }).click();
  for (const name of ['Crash Push', 'Pan Left', 'Slow Push']) await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: /^Assemble film/ }).click();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /^blob:/, { timeout: 90_000 });
  const caption = (await page.getByTestId('result-caption').textContent()) ?? '';

  const filmDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download film' }).click();
  const film = probe(await (await filmDownload).path());
  expect(Number(film.format.duration)).toBeGreaterThan(14.7);
  expect(Number(film.format.duration)).toBeLessThan(15.7);
  expect(film.format.tags?.comment).toBe(/Placeholder/.test(caption) ? 'Montagio showcase placeholder' : 'AI-generated');

  const verticalDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download 9:16' }).click();
  expect(probe(await (await verticalDownload).path()).streams[0]).toMatchObject({ width: 720, height: 1280 });
  expect(foreign()).toEqual([]);
});

test('a portrait clip fits the monitor instead of being cropped', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Placeholder portrait A/ }).click();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('button', { name: /^Show clip/ }).click();
  const video = page.locator('video[data-testid=result]');
  await expect(video).toHaveAttribute('src', /pan-left--portrait-a.mp4$/);
  const [frame, media] = await Promise.all([page.getByTestId('monitor').boundingBox(), video.boundingBox()]);
  expect(media!.height).toBeLessThanOrEqual(frame!.height + 1);
  expect(media!.width).toBeLessThanOrEqual(frame!.width + 1);
});

test('disabled controls say why', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Scene (optional)')).toBeDisabled();
  await expect(page.getByText('Scene text applies when you generate locally.')).toBeVisible();
  const fast = page.getByRole('radio', { name: /Wan 2\.2 5B/ });
  await expect(fast).toBeDisabled();
  await expect(page.locator('label', { has: fast })).toContainText('local only');
});

test('french texts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Voir le clip/ })).toBeVisible();
  await expect(page.getByText(/clips pré-générés avec Montagio sur des poids ouverts/)).toBeVisible();
});

test('the open stack page loads directly', async ({ page }) => {
  const problems = watchRequests(page);
  await page.goto('/open-stack/');
  const rows = page.locator('[data-testid=model-row]');
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) await expect(row).toContainText('Apache-2.0');
  // Back to the studio by the header link: a client navigation, no failed prefetch.
  await page.getByRole('link', { name: 'Back to the studio' }).click();
  await expect(page.getByRole('button', { name: /^Show clip/ })).toBeVisible();
  expect(problems()).toEqual([]);
});

test('a missing data.json shows the generic error, not a blank page', async ({ page }) => {
  await page.route('**/showcase/data.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();
  await page.goto('/open-stack/');
  await expect(page.getByRole('heading', { name: 'Open stack' })).toBeVisible();
});

test('when FFmpeg cannot load, the film says so and single clips still play', async ({ page }) => {
  await page.route('**/ffmpeg/ffmpeg-core.js', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sequence', exact: true }).click();
  await page.getByRole('button', { name: /Placeholder landscape A/ }).click();
  for (const name of ['Crash Push', 'Pan Left']) await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: /^Assemble film/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'FFmpeg could not start in this browser' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Single shot', exact: true }).click();
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Show clip/ }).click();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /crash-push--landscape-a\.mp4$/);
});
