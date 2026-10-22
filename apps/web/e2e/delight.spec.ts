import { expect, test, type Page } from '@playwright/test';

const CAMERA = '/?tab=camera';

async function cameraWithSample(page: Page) {
  await page.goto(CAMERA);
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
}

test('render times read in minutes, and Quality and Fast say what they trade', async ({ page }) => {
  await cameraWithSample(page);
  await expect(page.getByRole('button', { name: /^Generate/ })).toHaveText('Generate (~9 min)');
  const picker = page.getByRole('group', { name: 'Model' });
  await expect(picker).toContainText('Follows the move exactly');
  await expect(picker).toContainText('Follows the move from its text');
  await expect(picker).toContainText('~2 min');
});

test('while a clip renders, the slate counts, the tab title records, and the visitor may leave; then the clip is revealed', async ({ page }) => {
  // The render is held at 42 % for as long as the test looks at the wait.
  let hold = true;
  await page.route('**/api/generations/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const record = (await response.json()) as Record<string, unknown>;
    if (!hold) return route.fulfill({ response, json: record });
    return route.fulfill({ response, json: { ...record, state: 'running', progress: 0.42, outputUrl: undefined } });
  });
  await cameraWithSample(page);
  const title = await page.title();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page).toHaveTitle(/^● REC 42\s?%/);
  const slate = page.getByTestId('slate');
  await expect(slate).toContainText(/REC \d+:\d\d/);
  await expect(slate).toContainText('~9 min left');
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
