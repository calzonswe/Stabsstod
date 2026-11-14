// PWA smoke test — plan.md M13 accept (first real run in M29).
//
// Log in online, go offline, reload: the app must still render from the
// service worker cache and show the Offline chip in the header.

import { test, expect, type Page } from '@playwright/test';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill('admin');
  await page.locator('input[type="password"]').fill('stabsstod');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === '/');
}

test('PWA smoke test: offline reload shows Offline chip', async ({ page }) => {
  // Load app online (also installs the service worker and precaches the shell).
  await login(page);
  await expect(page.locator('h1')).toContainText('Välkommen');

  // Wait until the page is controlled by the active service worker (clientsClaim
  // in the SW takes over existing clients, but there can be a small gap between
  // `reg.active` being set and the page actually being controlled).
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  // Go offline
  await page.context().setOffline(true);

  // Reload the page
  await page.reload();

  // App should still render from cache
  await expect(page.locator('h1')).toContainText('Välkommen');

  // Should show the Offline chip (exact match: the home subtitle also
  // contains the word "offline").
  await expect(page.locator('header').getByText('Offline', { exact: true })).toBeVisible();
});
