import { expect, test, type Page } from '@playwright/test';

const CAMERA = '/?tab=camera';

async function cameraWithSample(page: Page) {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
}

test('render times read in minutes, and Turbo, Quality and Fast say what they trade', async ({ page }) => {
  await cameraWithSample(page);
  // Crash Push starts on the Turbo, which a GPU session validated for it.
  await expect(page.getByRole('button', { name: /^Generate/ })).toHaveText('Generate (~1 min)');
  // By Generate, each tier with its time, and what the chosen one buys.
  const picker = page.getByRole('group', { name: 'Model' });
  await expect(picker).toContainText('The same moves in 4 steps: a little less detail');
  await picker.getByRole('radio', { name: /^Quality · ~9 min/ }).check({ force: true });
  await expect(picker).toContainText('Follows the move exactly');
  await expect(page.getByRole('button', { name: /^Generate/ })).toHaveText('Generate (~9 min)');
  await expect(picker.getByRole('radio', { name: /^Fast · ~2 min/ })).toBeAttached();
  await picker.getByRole('radio', { name: /^Fast/ }).check({ force: true });
  await expect(picker).toContainText('Follows the move from its text');
});

test('each move starts on its own default model until the visitor picks one', async ({ page }) => {
  await cameraWithSample(page);
  const picker = page.getByRole('group', { name: 'Model' });
  await expect(picker.getByRole('radio', { name: /^Turbo/ })).toBeChecked();
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  // Rise & Push keeps the 20 steps: in 4 the subject leaves the frame.
  await page.getByRole('button', { name: 'Rise & Push' }).click();
  await expect(picker.getByRole('radio', { name: /^Quality/ })).toBeChecked();
  await page.getByRole('button', { name: 'Slow Push' }).click();
  await expect(picker.getByRole('radio', { name: /^Turbo/ })).toBeChecked();
  // A choice of the visitor stays.
  await picker.getByRole('radio', { name: /^Fast/ }).check({ force: true });
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await expect(picker.getByRole('radio', { name: /^Fast/ })).toBeChecked();
});

test('while a clip renders, the slate counts, the tab title records, and the visitor may leave; then the clip is revealed', async ({ page }) => {
  // The render is held at 2 % (under the 5 % where the time left follows the progress) while the test looks at the wait.
  let hold = true;
  await page.route('**/api/generations/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const record = (await response.json()) as Record<string, unknown>;
    if (!hold) return route.fulfill({ response, json: record });
    return route.fulfill({ response, json: { ...record, state: 'running', progress: 0.02, outputUrl: undefined } });
  });
  await cameraWithSample(page);
  const title = await page.title();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page).toHaveTitle(/^● REC 2\s?%/);
  const slate = page.getByTestId('slate');
  await expect(slate).toContainText(/REC \d+:\d\d/);
  await expect(slate).toContainText('~1 min left');
  await expect(page.getByTestId('leave-hint')).toHaveText('You can leave this tab: the clip goes to History when it is ready.');
  // The camera plan keeps moving over the photo while the clip renders.
  await expect(page.locator('[class*="photoPlan"]')).toHaveAttribute('data-rendering', 'true');
  hold = false;
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveTitle(title);
  await expect(page.getByTestId('leave-hint')).toHaveCount(0);
  // The reveal: Download is the result's first action, and the focus is on it.
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeFocused();
});
