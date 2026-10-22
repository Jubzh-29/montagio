import { expect, test } from '@playwright/test';

for (const { tab, kind, file } of [
  { tab: 'avatar', kind: 'Talking photo · up to 15 s', file: 'avatar' },
  { tab: 'motion', kind: 'Reference video · up to 5 s', file: 'motion' },
]) {
  test(`${tab}: a looping example in its card and on the empty monitor, and the card says what it makes`, async ({ page }) => {
    await page.goto(`/?tab=${tab}`);
    const card = page.getByTestId('choice-card');
    await expect(card.locator('video')).toHaveAttribute('src', new RegExp(`/extensions/previews/${file}\\.mp4$`));
    await expect(card.locator('video')).toHaveAttribute('poster', new RegExp(`/extensions/previews/${file}\\.jpg$`));
    await expect(card).toContainText(kind);
    const monitor = page.getByTestId('monitor');
    await expect(monitor.locator('video')).toHaveAttribute('src', new RegExp(`/extensions/previews/${file}\\.mp4$`));
    await expect(monitor).toContainText('Example made with Montagio · AI-generated');
  });
}

test('one place to add a photo: the empty monitor says where it is, without a second drop zone', async ({ page }) => {
  await page.goto('/?tab=avatar');
  const monitor = page.getByTestId('monitor');
  await expect(monitor).toContainText('Your photo shows here');
  await expect(monitor).toContainText('Add it under Start photo.');
  await expect(monitor.getByText('Choose a photo')).toHaveCount(0);
  await expect(monitor.getByText('Try with a sample photo')).toHaveCount(0);
});

test('the sample photo is a real scene, and comes described', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What the photo shows', exact: true })).toHaveValue(/^a quiet fishing harbour at golden hour/);
});
