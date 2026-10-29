import { expect, test } from '@playwright/test';

test('History purges personal data only after the exact confirmation, and shows a remote failure', async ({ page }) => {
  await page.goto('/?tab=camera');
  await page.getByRole('button', { name: 'Sample', exact: true }).click();
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Crash Push' }).click();
  await page.getByRole('button', { name: /^Generate/ }).click();
  await expect(page.locator('video[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.goto('/history');
  const reproduce = page.getByTestId('history-reproduce').first();
  await expect(reproduce).toBeVisible();

  await page.getByTestId('purge-open').click();
  const dialog = page.getByTestId('purge-dialog');
  await expect(dialog).toBeVisible();
  const submit = page.getByTestId('purge-submit');
  await expect(submit).toBeDisabled();
  await page.getByTestId('purge-confirmation').fill('delete');
  await expect(submit).toBeDisabled();
  await page.getByTestId('purge-confirmation').fill('DELETE');
  await expect(submit).toBeEnabled();

  await page.route('**/api/data/purge', async (route) => {
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'remote-purge-incomplete' }) });
  });
  await submit.click();
  await expect(page.getByTestId('purge-error')).toContainText('Remote deletion could not be completed');
  await expect(reproduce).toBeVisible();

  await page.unroute('**/api/data/purge');
  await page.route('**/api/data/purge', async (route) => {
    await route.fulfill({ status: 204 });
  });
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Your creations will show here.')).toBeVisible();
  await expect(page.getByTestId('history-reproduce')).toHaveCount(0);
});
