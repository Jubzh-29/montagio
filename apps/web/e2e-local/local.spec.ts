import { expect, test } from '@playwright/test';

test('local mode: sample photo, one click, a clip from the proxy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with a sample photo' }).click();
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /\/media\/data\/generations\/.+\/clip\.mp4$/, {
    timeout: 30_000,
  });
});

test('local mode: a two-shot film', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sequence', exact: true }).click();
  await page.getByRole('button', { name: 'Try with a sample photo' }).click();
  for (const name of ['Crash Push', 'Pan Left']) await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: /^Generate film/ }).click();
  await expect(page.locator('video[data-testid=result]')).toHaveAttribute('src', /\/media\/data\/sequences\/.+\/film\.mp4$/, {
    timeout: 60_000,
  });
});
