import { expect, test } from '@playwright/test';

test('Share 9:16: a caption to copy, then the 9:16 with the Montagio end card, or without it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Pan Left' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });

  const toggle = page.getByTestId('share-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByTestId('share-panel');

  // The caption is written here: the move's name, the AI mention, the hashtags; it copies as it reads.
  const caption = panel.getByTestId('share-caption');
  await expect(caption).toHaveValue(/^Pan Left: one photo, one camera move\.\nAI-generated with .+\n\n#AIgenerated #Montagio/);
  await panel.getByTestId('share-copy').click();
  await expect(panel.getByTestId('share-copy')).toHaveText('Copied');
  // The system clipboard may hand the lines back with CRLF (Windows): the words are what is compared.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, '\n')).toBe(await caption.inputValue());

  // The end card is ticked: the 9:16 is made with it, then downloads.
  await expect(panel.getByTestId('share-end-card')).toBeChecked();
  const [made] = await Promise.all([
    page.waitForResponse((res) => new URL(res.url()).pathname === '/api/share' && res.request().method() === 'POST'),
    panel.getByTestId('share-make').click(),
  ]);
  expect(made.request().postDataJSON()).toMatchObject({ source: 'generation', endCard: true });
  await expect(panel.getByTestId('share-download')).toHaveAttribute('href', /^\/media\/data\/shares\/.+\/montagio-9x16\.mp4$/, { timeout: 60_000 });
  await expect(panel.getByTestId('share-result')).toBeVisible();
  await expect(panel).toContainText('The file says it is AI-generated');
  await expect(panel).toContainText('The file also carries its recipe: entered text and SHA-256 input hashes, never source media or local paths.');

  // Unticked, the 9:16 is made again, without the card.
  await panel.getByTestId('share-end-card').uncheck();
  await expect(panel.getByTestId('share-download')).toHaveCount(0);
  const [again] = await Promise.all([
    page.waitForResponse((res) => new URL(res.url()).pathname === '/api/share' && res.request().method() === 'POST'),
    panel.getByTestId('share-make').click(),
  ]);
  expect(again.request().postDataJSON()).toMatchObject({ endCard: false });
  await expect(panel.getByTestId('share-download')).toBeVisible({ timeout: 60_000 });
});
