import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    ...urls.filter((url) => !url.startsWith('http://127.0.0.1:3101/') && !url.startsWith('blob:') && !url.startsWith('data:')),
    ...failed,
  ];
}

const probe = (file: string) =>
  JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration:format_tags=comment', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  ) as { streams: { codec_type: string; width: number; height: number; r_frame_rate: string }[]; format: { duration: string; tags?: { comment?: string } } };

const result = (page: Page) => page.locator('video[data-testid=result]');
/** The canvas shows the monitor on arrival; the wall of presets is its other view. */
const showGallery = (page: Page) => page.getByRole('button', { name: 'Gallery', exact: true }).click();

/** The showcase opens on a clip already playing: the wall's first effect on the first sample photo it was rendered on, Squish on the convertible. */
const arrival = (page: Page) => expect(result(page)).toHaveAttribute('src', /\/showcase\/effects\/squish--landscape-b\.mp4$/);

test('the showcase opens on an effect, then plays the pre-generated clip of a camera preset', async ({ page }) => {
  const foreign = watchRequests(page);
  await page.goto('/');
  await arrival(page);
  // The tab, the effect and the caption match the clip: Effects, Squish, the effects model.
  await expect(page.getByRole('link', { name: 'Effects', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Squish' })).toBeVisible();
  await expect(page.getByTestId('result-caption')).toHaveText(/Pre-generated with Montagio · Wan 2[.]1 I2V 480p [(]effects[)]/);
  // What the showcase is stays in sight under the clip.
  await expect(page.getByText(/clips pre-generated with Montagio on open weights/)).toBeVisible();
  // The camera presets are on the Camera tab, on the photo the arrival picked.
  await page.getByRole('link', { name: 'Camera', exact: true }).click();
  await showGallery(page);
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('button', { name: /^Show clip/ }).click();
  await expect(result(page)).toHaveAttribute('src', /\/showcase\/clips\/pan-left--landscape-b\.mp4$/);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Open in ComfyUI' }).click();
  const workflow = await download;
  expect(workflow.suggestedFilename()).toBe('montagio-pan-left.json');
  expect(readFileSync(await workflow.path(), 'utf8')).toContain('"class_type"');
  await expect(page.getByRole('link', { name: 'Source code (AGPL-3.0)' })).toHaveAttribute('href', 'https://example.invalid/montagio');
  expect(foreign()).toEqual([]);
});

test('a pre-generated clip shows its recipe, and Reproduce at home leads to the install guide', async ({ page }) => {
  const foreign = watchRequests(page);
  await page.goto('/');
  await arrival(page);
  // The recipes are the camera clips': the arrival's effect example has none.
  await page.getByRole('link', { name: 'Camera', exact: true }).click();
  await showGallery(page);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Show clip/ }).click();
  await expect(result(page)).toHaveAttribute('src', /\/showcase\/clips\/crash-push--landscape-b\.mp4$/);
  const panel = page.getByTestId('recipe-panel');
  await panel.getByText('Recipe', { exact: true }).click();
  await expect(panel.getByText('Seed', { exact: true })).toBeVisible();
  await expect(panel).toContainText('SeedVR2 1080p');
  await expect(panel).toContainText('identical result on the same setup, very close elsewhere');
  await expect(panel.getByTestId('recipe-home')).toHaveAttribute('href', 'https://example.invalid/montagio/blob/main/docs/INSTALL.md#reproduce-a-recipe');
  await expect(panel.getByTestId('recipe-reproduce')).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByTestId('recipe-download').click()]);
  const recipe = JSON.parse(readFileSync((await download.path())!, 'utf8')) as { schema: string; steps: { name: string }[]; request?: unknown };
  expect(recipe.schema).toBe('montagio/recipe@1');
  expect(recipe.steps.map((step) => step.name)).toEqual(['camera', 'upscale']);
  expect(recipe.request).toBeDefined();
  expect(foreign()).toEqual([]);
});

test('a dropped photo is explained, never uploaded', async ({ page }) => {
  await page.goto('/');
  await arrival(page);
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
  await page.goto('/?tab=camera');
  await showGallery(page);
  await page.getByRole('button', { name: 'Crash Push' }).click();
  // Once a clip shows, the result has its own "Remix preset": take the gallery's.
  await page.locator('aside').getByRole('button', { name: 'Remix preset', exact: true }).click();
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
  // The arrival clip has already picked a sample photo.
  await arrival(page);
  await page.getByRole('link', { name: 'Film', exact: true }).click();
  await expect(page.getByText(/every shot starts from the sample photo/)).toBeVisible();
  for (const name of ['Crash Push', 'Pan Left', 'Slow Push']) await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: /^Assemble film/ }).click();
  await expect(result(page)).toHaveAttribute('src', /^blob:/, { timeout: 90_000 });
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
  await arrival(page);
  await page.getByRole('button', { name: 'Other sample photo' }).click();
  await page.getByRole('button', { name: /Yellow raincoat on a rainy night/ }).click();
  await page.getByRole('link', { name: 'Camera', exact: true }).click();
  await showGallery(page);
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('button', { name: /^Show clip/ }).click();
  const video = result(page);
  await expect(video).toHaveAttribute('src', /pan-left--portrait-a.mp4$/);
  const [frame, media] = await Promise.all([page.getByTestId('monitor').boundingBox(), video.boundingBox()]);
  expect(media!.height).toBeLessThanOrEqual(frame!.height + 1);
  expect(media!.width).toBeLessThanOrEqual(frame!.width + 1);
});

test('disabled controls say why', async ({ page }) => {
  await page.goto('/?tab=camera');
  await expect(page.getByLabel('What the photo shows', { exact: true })).toBeDisabled();
  await expect(page.getByText('Locally, you describe your own photo here.')).toBeVisible();
  // By Generate, the showcase's model choice says Fast is for a local install.
  const fast = page.locator('[class*="generateBlock"]').getByRole('radio', { name: /^Fast/ });
  await expect(fast).toBeDisabled();
  await expect(page.locator('[class*="generateBlock"] label', { has: page.getByRole('radio', { name: /^Fast/ }) })).toContainText('local only');
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
  // Every model of the stack, the effects and hooks included, not only the camera's (19 with the camera's Turbo, Whisper, the restyle, the object swap and the trend skeleton).
  await expect(rows).toHaveCount(19);
  for (const row of await rows.all()) await expect(row).toContainText(/Apache-2\.0|MIT/);
  await expect(page.locator('#model-wan21-i2v-effects')).toBeVisible();
  // Back to the studio by the header link: a client navigation, no failed prefetch.
  await page.getByRole('link', { name: 'Back to the studio' }).click();
  await expect(page.getByRole('button', { name: /^Show clip/ })).toBeVisible();
  expect(problems()).toEqual([]);
});

test('a missing data.json says the catalogue failed, not a blank page', async ({ page }) => {
  await page.route('**/showcase/data.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  // The canvas opens on the wall, which says what failed and what to do.
  await expect(page.getByText('The camera moves could not be loaded. Reload the page to try again.')).toBeVisible();
  await page.goto('/open-stack/');
  await expect(page.getByRole('heading', { name: 'Open stack' })).toBeVisible();
});

test('when FFmpeg cannot load, the film says so and single clips still play', async ({ page }) => {
  await page.route('**/ffmpeg/ffmpeg-core.js', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await arrival(page);
  await page.getByRole('link', { name: 'Film', exact: true }).click();
  for (const name of ['Crash Push', 'Pan Left']) await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: /^Assemble film/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'FFmpeg could not start in this browser' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('link', { name: 'Camera', exact: true }).click();
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Show clip/ }).click();
  await expect(result(page)).toHaveAttribute('src', /crash-push--landscape-b\.mp4$/);
});

test('the showcase shows only the tabs it can play, and no photo tool beyond the samples', async ({ page }) => {
  await page.goto('/');
  await arrival(page);
  // Explore, the creation tabs the showcase has clips for, the examples of the other functions, then History.
  const tabs = page.getByRole('navigation', { name: 'Creation' }).getByRole('link');
  await expect(tabs).toHaveText(['Explore', 'Effects', 'Camera', 'Film', 'Examples', 'History']);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  // Text to image offers the texts the sample photos were made from, never a text of one's own.
  await page.getByRole('button', { name: 'Text to image', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'The texts of the sample photos' }).getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('textbox', { name: 'Describe the photo' })).toHaveCount(0);
});

test('the showcase history shows the clip of this visit, and says it keeps only this visit', async ({ page }) => {
  const problems = watchRequests(page);
  await page.goto('/');
  await arrival(page);
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.getByText(/keeps only this visit/)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Clip · Squish' })).toBeVisible();
  expect(problems()).toEqual([]);
});

test('/history/ loads directly, with nothing outside its origin', async ({ page }) => {
  const problems = watchRequests(page);
  await page.goto('/history/');
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText('Your creations will show here.')).toBeVisible();
  expect(problems()).toEqual([]);
});

/** The showcase's data.json as the GPU session would leave it: Squish rendered on the first sample (its clip stands in). */
async function withSquishExample(page: Page) {
  await page.route('**/showcase/data.json', async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as Record<string, unknown>;
    const squish = {
      id: 'squish',
      name: 'Squish',
      description: 'The subject gets squished.',
      modelId: 'wan21-i2v-effects',
      modelName: 'Wan 2.1 I2V 480p (effects)',
      license: 'Apache-2.0',
      examples: [{ sample: 'landscape-a', url: 'clips/pan-left--landscape-a.mp4', workflowUrl: 'workflows/pan-left--landscape-a.json' }],
    };
    return route.fulfill({ response, json: { ...data, effects: [squish], hooks: [] } });
  });
}

test('with an effect example, the showcase opens on it, and offers it only on its photo', async ({ page }) => {
  const problems = watchRequests(page);
  await withSquishExample(page);
  await page.goto('/');
  // Effects first: the showcase opens on its first effect's example, captioned with that effect's model.
  await expect(page.getByRole('link', { name: 'Effects', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(result(page)).toHaveAttribute('src', /\/showcase\/clips\/pan-left--landscape-a\.mp4$/);
  await expect(page.getByRole('region', { name: 'Squish' })).toBeVisible();
  await expect(page.getByTestId('result-caption')).toHaveText(/Wan 2[.]1 I2V 480p [(]effects[)]/);
  // Its model's name leads to its line of the open stack proof.
  await expect(page.getByTestId('result-caption').getByRole('link', { name: 'Wan 2.1 I2V 480p (effects)' })).toHaveAttribute(
    'href',
    /\/open-stack\/?#model-wan21-i2v-effects$/,
  );
  // The example is pre-rendered: the subject field says so instead of being ignored.
  await expect(page.getByRole('textbox', { name: /What the photo shows/ })).toBeDisabled();
  await expect(page.getByText('What the photo shows applies when you generate locally.')).toBeVisible();
  // Another sample photo has no example: the wall offers nothing there.
  await page.getByRole('button', { name: 'Other sample photo' }).click();
  await page.getByRole('button', { name: /Yellow raincoat on a rainy night/ }).click();
  await showGallery(page);
  await expect(page.getByRole('button', { name: 'Squish' })).toHaveCount(0);
  expect(problems()).toEqual([]);
});

type Feature = { id: string; feature: string; url: string; audio: boolean; inputs: { url: string }[]; steps: { workflowUrl: string }[]; hd?: { fps: number; workflowUrl: string } };
const featuresOf = async (page: Page) => ((await (await page.request.get('/showcase/data.json')).json()) as { features?: Feature[] }).features ?? [];

test('the examples page shows every function the showcase cannot run, from what it started to each workflow', async ({ page }) => {
  const problems = watchRequests(page);
  const features = await featuresOf(page);
  expect(features.length).toBeGreaterThan(0);
  await page.goto('/explore/');
  await page.getByRole('link', { name: 'See every function at work' }).click();
  await expect(page.getByRole('heading', { name: 'Every function, rendered', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Examples', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const example of features) {
    const card = page.getByTestId(`example-${example.id}`);
    await expect(card).toBeVisible();
    await expect(card.locator('video').last()).toHaveAttribute('src', new RegExp(`/showcase/${example.url.replace(/[.]/g, '[.]')}$`));
    await expect(card.getByRole('link', { name: 'Open in ComfyUI' })).toHaveCount(example.steps.length + (example.hd ? 1 : 0));
    // A clip that speaks plays with its sound; the others stay muted.
    expect(await card.locator('video').last().evaluate((video: HTMLVideoElement) => video.muted)).toBe(!example.audio);
  }
  // The first workflow of the first example is a ComfyUI graph, saved under the app's name.
  const first = page.getByTestId(`example-${features[0]!.id}`).getByRole('link', { name: 'Open in ComfyUI' }).first();
  const [download] = await Promise.all([page.waitForEvent('download'), first.click()]);
  expect(download.suggestedFilename()).toBe(`montagio-${features[0]!.id}-1.json`);
  const graph = JSON.parse(readFileSync((await download.path())!, 'utf8')) as Record<string, { class_type?: string }>;
  expect(Object.values(graph).every((node) => typeof node.class_type === 'string')).toBe(true);
  expect(problems()).toEqual([]);
});

test('a speaking example is a 1080p file at 32 fps with its sound and the AI mention', async ({ page }) => {
  const speaking = (await featuresOf(page)).find((example) => example.audio && example.hd);
  test.skip(!speaking, 'no speaking example with an HD pass in this build');
  const file = join(mkdtempSync(join(tmpdir(), 'montagio-example-')), 'example.mp4');
  writeFileSync(file, await (await page.request.get(`/showcase/${speaking!.url}`)).body());
  const info = probe(file);
  expect(info.streams.map((stream) => stream.codec_type).sort()).toEqual(['audio', 'video']);
  const video = info.streams.find((stream) => stream.codec_type === 'video')!;
  expect([video.width, video.height].sort((a, b) => a - b)).toEqual([1080, 1920]);
  expect(video.r_frame_rate).toBe('32/1');
  expect(info.format.tags?.comment).toBe('AI-generated');
});

test('the trend remix and translation pages show their own examples, beside the note on the local app', async ({ page }) => {
  const problems = watchRequests(page);
  const features = await featuresOf(page);
  for (const [path, kinds, note] of [
    ['/remix/', ['remix'], /The trend remix runs in the app installed on your machine/],
    ['/translate/', ['translate', 'captions'], /Translation runs in the app installed on your machine/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByText(note)).toBeVisible();
    for (const example of features.filter((candidate) => (kinds as readonly string[]).includes(candidate.feature))) {
      await expect(page.getByTestId(`example-${example.id}`)).toBeVisible();
    }
  }
  await page.goto('/voice/');
  await expect(page.getByText(/Voice change runs in the app installed on your machine/)).toBeVisible();
  expect(problems()).toEqual([]);
});
