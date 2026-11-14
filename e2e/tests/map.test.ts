// Map E2E — M29
//
// Log in, create an incident through the API, open the map tab and verify:
//   - the local PMTiles basemap renders (container flips to data-loaded=true)
//   - or, when the map file was never fetched, the missing-file card shows
//   - no request ever leaves the origin (offline-capable basemap)

import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MAP_FILE = join(here, '..', '..', 'data', 'maps', 'sweden.pmtiles');

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill('admin');
  await page.locator('input[type="password"]').fill('stabsstod');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === '/');
}

test('map tab renders the local basemap without external requests', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (req) => {
    try {
      const url = new URL(req.url());
      // blob: / data: URLs are local in-memory URLs (e.g. object URLs for
      // same-origin images), not network requests to another host — they don't
      // violate the offline-basemap requirement.
      if (url.protocol === 'blob:' || url.protocol === 'data:') return;
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(req.url());
      }
    } catch {
      // non-URL request (e.g. data:) — ignore
    }
  });

  await login(page);

  // Create an incident with the session cookie.
  const created = await page.request.post('/api/incidents', {
    data: {
      name: `Karttest ${Date.now()}`,
      type: 'Karttest',
      startedAt: new Date().toISOString(),
      presetId: 'small',
    },
  });
  expect(created.ok()).toBeTruthy();
  const { incident } = (await created.json()) as { incident: { id: string } };

  await page.goto(`/incidents/${incident.id}`);
  // M32: the creator is chief_of_staff and therefore lands on the dashboard
  // by default (once per browser session, per incident). The map lives in the
  // workspace — step back via the dashboard's "Tillbaka" link.
  const backLink = page.getByRole('link', { name: 'Tillbaka' });
  await expect(backLink).toBeVisible({ timeout: 15_000 });
  await backLink.click();
  await page.waitForURL((url) => url.pathname === `/incidents/${incident.id}`);
  await expect(page.getByRole('button', { name: 'Karta' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Karta' }).click();

  if (existsSync(MAP_FILE)) {
    await expect(
      page.locator('[data-testid="map-container"][data-loaded="true"]'),
    ).toHaveCount(1, { timeout: 30000 });
  } else {
    await expect(page.locator('[data-testid="map-missing"]')).toHaveCount(1);
  }

  // Give the map time to pull tiles, glyphs and sprite.
  await page.waitForTimeout(3000);
  expect(externalRequests).toEqual([]);
});
