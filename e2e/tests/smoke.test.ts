import { test, expect } from '@playwright/test';

test('PWA smoke test: offline reload shows Offline chip', async ({ page }) => {
  // Load app online
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Välkommen');

  // Go offline
  await page.context().setOffline(true);

  // Reload the page
  await page.reload();

  // App should still render from cache
  await expect(page.locator('h1')).toContainText('Välkommen');

  // Should show the Offline chip
  await expect(page.locator('text=Offline')).toBeVisible();
});
