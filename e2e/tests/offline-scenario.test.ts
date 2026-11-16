// Offline end-to-end scenario — plan.md §10 M39
//
// Two staff members (A and B) in one incident:
//
//   1. Both online: A creates a fact, and B's board receives it.
//   2. A goes offline: creates a log entry, a task and a map feature,
//      and marks the fact as verified.
//   3. B (still online) refutes the same fact and creates a
//      decision request.
//   4. A reconnects: everything converges, and the double edit of the
//      fact shows a conflict badge.
//   5. A resolves the conflict with a merge record (keeping the
//      verified version).
//   6. B converges to the same merged state.
//   7. The database holds the complete append-only history: four fact
//      versions in causal order, one record per offline write, nothing
//      overwritten, nothing deleted.
//
// The sync loop runs on the real plan §5.3 triggers (online event, SSE
// records events, tab focus). Where a step needs a particular sync to have
// happened before the test can observe it, the test dispatches the tab-focus
// trigger, which is one of those same real triggers.

import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres:stabsstod@localhost:5432/stabsstod';

const SUFFIX = Date.now();
const USERNAME_A = `m39-a-${SUFFIX}`;
const USERNAME_B = `m39-b-${SUFFIX}`;
const PASSWORD = 'M39-offline-pass-1';

const FACT_TEXT = `M39-faktum ${SUFFIX}`;
const LOG_TEXT = `M39-loggpost ${SUFFIX}`;
const TASK_TITLE = `M39-uppgift ${SUFFIX}`;
const MAP_LABEL = `M39-punkt ${SUFFIX}`;
const QUESTION = `M39-fråga ${SUFFIX}`;

/** Tab-focus trigger (plan §5.3) — forces a push + pull when visible. */
function focusSync(page: Page): Promise<void> {
  return page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
}

/**
 * The fact card: the <p> holding the fact text (exact — the conflict
 * banner's <pre> holds the text only as part of a JSON payload) and its
 * nearest card container.
 */
function factCard(page: Page, text: string) {
  return page
    .getByText(text, { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "rounded")][1]');
}

async function loginAs(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === '/');
}

/** Open the incident workspace (chiefs see the dashboard once per session). */
async function openIncidentWorkspace(page: Page, incidentId: string): Promise<void> {
  await page.goto(`/incidents/${incidentId}`);
  const back = page.getByRole('link', { name: 'Tillbaka' });
  await expect(back).toBeVisible({ timeout: 15_000 });
  await back.click();
  await page.waitForURL((url) => url.pathname === `/incidents/${incidentId}`);
  await expect(page.getByRole('button', { name: 'Läge' })).toBeVisible({ timeout: 15_000 });
}

async function createUser(page: Page, username: string, displayName: string): Promise<string> {
  const res = await page.request.post('/api/admin/users', {
    data: { username, password: PASSWORD, displayName },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { user: { id: string } };
  return body.user.id;
}

async function createIncident(page: Page, memberA: string, memberB: string): Promise<string> {
  const res = await page.request.post('/api/incidents', {
    data: {
      name: `M39 offline ${SUFFIX}`,
      type: 'Test',
      startedAt: new Date().toISOString(),
      presetId: 'small',
      members: [
        { userId: memberA, role: 'chief_of_staff' },
        { userId: memberB, role: 'chief_of_staff' },
      ],
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { incident: { id: string } };
  return body.incident.id;
}

test('offline edits converge and the append-only history is complete', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);

  // ---------------------------------------------------------------------------
  // Setup: admin creates two users and an incident they are both chiefs of.
  // ---------------------------------------------------------------------------
  await loginAs(page, 'admin', 'stabsstod');
  const userA = await createUser(page, USERNAME_A, 'M39 A');
  const userB = await createUser(page, USERNAME_B, 'M39 B');
  const incidentId = await createIncident(page, userA, userB);

  // ---------------------------------------------------------------------------
  // A and B (separate browser contexts = separate devices) open the incident.
  // ---------------------------------------------------------------------------
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  pageA.on('pageerror', (err) => console.log('[A pageerror]', String(err).slice(0, 300)));
  pageA.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[A console.error]', msg.text().slice(0, 300));
  });
  await loginAs(pageA, USERNAME_A, PASSWORD);
  await openIncidentWorkspace(pageA, incidentId);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  pageB.on('pageerror', (err) => console.log('[B pageerror]', String(err).slice(0, 300)));
  pageB.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[B console.error]', msg.text().slice(0, 300));
  });
  await loginAs(pageB, USERNAME_B, PASSWORD);
  await openIncidentWorkspace(pageB, incidentId);

  // ---------------------------------------------------------------------------
  // Phase 1 — both online: A creates a fact, B's board receives it.
  // ---------------------------------------------------------------------------
  await pageA.getByRole('button', { name: 'Ny post' }).click();
  const factForm = pageA
    .locator('form')
    .filter({ has: pageA.getByPlaceholder('Beskriv factum eller antagandet') });
  await factForm.getByPlaceholder('Beskriv factum eller antagandet').fill(FACT_TEXT);
  await factForm.getByRole('button', { name: 'Spara' }).click();
  await expect(pageA.getByText(FACT_TEXT, { exact: true })).toBeVisible({ timeout: 10_000 });

  // A's engine only pushes on a sync trigger (plan §5.3): focus the tab.
  await focusSync(pageA);

  // B receives the record via its SSE subscription (pull on 'records'
  // event); the focus trigger is the fallback if the event arrived late.
  const factOnB = pageB.getByText(FACT_TEXT, { exact: true });
  try {
    await factOnB.waitFor({ timeout: 15_000 });
  } catch {
    await focusSync(pageB);
    await factOnB.waitFor({ timeout: 30_000 });
  }

  // ---------------------------------------------------------------------------
  // Phase 2 — A goes offline and works: log entry, task, map feature,
  // and the fact status change. All writes land in A's local store.
  // ---------------------------------------------------------------------------
  // Load the map while A is still online (tiles are served by the API);
  // drawing and saving are purely local.
  await pageA.getByRole('button', { name: 'Karta' }).click();
  await expect(
    pageA.locator('[data-testid="map-container"][data-loaded="true"]'),
  ).toHaveCount(1, { timeout: 60_000 });
  await pageA.waitForTimeout(3000);

  await contextA.setOffline(true);
  await pageA.waitForFunction(() => navigator.onLine === false, undefined, {
    timeout: 10_000,
  });

  // Map feature (offline): point mode → click → panel → label → save.
  await pageA.locator('button[title="Punkt"]').click();
  await pageA.locator('[data-testid="map-container"] canvas').click({
    position: { x: 400, y: 200 },
  });
  const mapPanelHeading = pageA.getByText('Nytt kartobjekt');
  await expect(mapPanelHeading).toBeVisible({ timeout: 10_000 });
  const mapPanel = mapPanelHeading.locator('xpath=..');
  await mapPanel.locator('input').first().fill(MAP_LABEL);
  await pageA.getByRole('button', { name: 'Spara objekt' }).click();
  await expect(pageA.getByText(MAP_LABEL).first()).toBeVisible({ timeout: 10_000 });

  // Log entry (offline). (exact: the header also has a "Logga ut" button)
  await pageA.getByRole('button', { name: 'Logg', exact: true }).click();
  await pageA.getByRole('button', { name: 'Ny loggpost' }).click();
  const logForm = pageA.locator('form').filter({ has: pageA.getByPlaceholder('Vad har hänt?') });
  await logForm.getByPlaceholder('Vad har hänt?').fill(LOG_TEXT);
  await logForm.getByRole('button', { name: 'Spara' }).click();
  await expect(pageA.getByText(LOG_TEXT).first()).toBeVisible({ timeout: 10_000 });

  // Task (offline).
  await pageA.getByRole('button', { name: 'Samordning' }).click();
  await pageA.getByRole('button', { name: 'Ny uppgift' }).click();
  await pageA.getByPlaceholder('Vad ska göras?').fill(TASK_TITLE);
  await pageA.getByRole('button', { name: 'Spara' }).click();
  await expect(pageA.getByText(TASK_TITLE).first()).toBeVisible({ timeout: 10_000 });

  // Fact: A marks it verified (first half of the double edit).
  await pageA.getByRole('button', { name: 'Läge' }).click();
  await pageA.getByRole('button', { name: 'Verifierad' }).click();
  await expect(factCard(pageA, FACT_TEXT).getByRole('button', { name: 'Återkalla' }))
    .toBeVisible({ timeout: 10_000 });

  // ---------------------------------------------------------------------------
  // Phase 3 — B stays online: refutes the same fact (second half of the
  // double edit) and creates a decision request.
  // ---------------------------------------------------------------------------
  await pageB.getByRole('button', { name: 'Avfärdad' }).click();
  await expect(
    pageB.locator('p.line-through', { hasText: FACT_TEXT }),
  ).toBeVisible({ timeout: 10_000 });

  await pageB.getByRole('button', { name: 'Inriktning' }).click();
  await pageB.getByRole('button', { name: 'Ny beslutsfråga' }).click();
  const questionInput = pageB.getByPlaceholder('Vad ska avgöras?');
  await questionInput.fill(QUESTION);
  // The request form is a plain div (no <form>), so scope via the question
  // input's container — the Inriktning tab also holds other "Spara" buttons.
  const requestForm = questionInput.locator('xpath=..');
  await requestForm.getByPlaceholder('Alternativ 1 — Alternativ').fill('Alternativ A');
  await requestForm.getByPlaceholder('Fördelar (en per rad)').fill('Billigast');
  await requestForm.getByPlaceholder('Nackdelar (en per rad)').fill('Längre leveranstid');
  await requestForm.getByRole('button', { name: 'Spara' }).click();
  await expect(pageB.getByText(QUESTION).first()).toBeVisible({ timeout: 10_000 });

  // ---------------------------------------------------------------------------
  // Phase 4 — A reconnects: A's engine pushes the four offline records and
  // re-subscribes to SSE; B pushes its two; both pull each other's records.
  // The double edit now shows a conflict badge on A's board.
  // ---------------------------------------------------------------------------
  await contextA.setOffline(false);
  await pageA.waitForFunction(() => navigator.onLine === true, undefined, {
    timeout: 10_000,
  });

  // Focus triggers guarantee that each side has run a full push + pull,
  // regardless of SSE event ordering.
  await focusSync(pageA);
  await focusSync(pageB);
  await focusSync(pageA);

  // (Card-scoped: the other components on the Läge tab have their own
  // conflict badges for their own entities.)
  const conflictBadge = factCard(pageA, FACT_TEXT).getByRole('button', {
    name: 'Konflikt',
  });
  try {
    await conflictBadge.waitFor({ timeout: 15_000 });
  } catch {
    // Safety net: re-fire the online event in case the browser's own was
    // lost, then nudge the sync loop on both sides again.
    await pageA.evaluate(() => window.dispatchEvent(new Event('online')));
    await focusSync(pageA);
    await focusSync(pageB);
    await focusSync(pageA);
    await conflictBadge.waitFor({ timeout: 30_000 });
  }

  // ---------------------------------------------------------------------------
  // Phase 5 — A resolves the conflict: pick the verified head, which writes
  // a merge record carrying BOTH heads as parents (the conflict collapses).
  // ---------------------------------------------------------------------------
  await conflictBadge.click();
  const verifiedPre = pageA.locator('pre', { hasText: '"status": "verified"' }).first();
  await expect(verifiedPre).toBeVisible({ timeout: 10_000 });
  const verifiedCard = verifiedPre.locator(
    'xpath=ancestor::div[contains(@class, "rounded")][1]',
  );
  await verifiedCard.getByRole('button').click();

  // The merge record made the entity single-headed: badge gone, and the
  // merged (verified) status shows its action button.
  await expect(factCard(pageA, FACT_TEXT).getByRole('button', { name: 'Konflikt' }))
    .toHaveCount(0, { timeout: 10_000 });
  await expect(factCard(pageA, FACT_TEXT).getByRole('button', { name: 'Återkalla' }))
    .toBeVisible({ timeout: 10_000 });

  // ---------------------------------------------------------------------------
  // Phase 6 — B converges to the same merged state.
  // ---------------------------------------------------------------------------
  await focusSync(pageA); // push the merge record
  await focusSync(pageB); // pull it

  // B is still on the Inriktning tab from phase 3; the fact board only
  // renders under Läge.
  await pageB.getByRole('button', { name: 'Läge' }).click();
  // Wait for the card so the count assertions below can't pass vacuously
  // while the board is still loading.
  await expect(pageB.getByText(FACT_TEXT, { exact: true })).toBeVisible({ timeout: 15_000 });
  // Transient conflict (v2_a + v2_b pulled, merge not yet) is fine — it
  // converges as B's engine pulls the merge record.
  await expect(factCard(pageB, FACT_TEXT).getByRole('button', { name: 'Konflikt' }))
    .toHaveCount(0, { timeout: 30_000 });
  await expect(factCard(pageB, FACT_TEXT).getByRole('button', { name: 'Återkalla' }))
    .toBeVisible({ timeout: 10_000 });
  await expect(pageB.locator('p.line-through', { hasText: FACT_TEXT }))
    .toHaveCount(0, { timeout: 10_000 });

  // ---------------------------------------------------------------------------
  // Phase 7 — append-only history in the database: every change is a new
  // versioned record, nothing overwritten, nothing deleted.
  // ---------------------------------------------------------------------------
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows: factRows } = await client.query(
      `SELECT id, parent_ids, payload, author_id, kind, server_seq
         FROM records
        WHERE incident_id = $1 AND entity_type = 'fact_item'
        ORDER BY server_seq`,
      [incidentId],
    );
    expect(factRows).toHaveLength(4);
    const [v1, v2a, v2b, merge] = factRows;

    // V1: the original fact (A, assumption, no parents).
    expect(v1.parent_ids).toEqual([]);
    expect(v1.payload.status).toBe('assumption');
    expect(v1.author_id).toBe(userA);

    // V2_A / V2_B: the double edit — both versions parented on V1,
    // one verified (A), one refuted (B), distinct authors.
    expect(v2a.parent_ids).toEqual([v1.id]);
    expect(v2b.parent_ids).toEqual([v1.id]);
    expect([v2a.payload.status, v2b.payload.status].sort()).toEqual([
      'refuted',
      'verified',
    ]);
    expect(new Set([v2a.author_id, v2b.author_id]).size).toBe(2);

    // Merge: A's resolution — both heads as parents, verified payload.
    expect([...merge.parent_ids].sort()).toEqual([v2a.id, v2b.id].sort());
    expect(merge.payload.status).toBe('verified');
    expect(merge.author_id).toBe(userA);

    // Every record is a 'put' with a server-assigned sequence.
    for (const r of factRows) {
      expect(r.kind).toBe('put');
      expect(r.server_seq).toBeTruthy();
    }

    const rowsFor = async (entityType: string) => {
      const res = await client.query(
        `SELECT author_id, payload FROM records
          WHERE incident_id = $1 AND entity_type = $2`,
        [incidentId, entityType],
      );
      return res.rows as { author_id: string; payload: Record<string, unknown> }[];
    };

    const logRows = await rowsFor('log_entry');
    expect(logRows).toHaveLength(1);
    expect(logRows[0].author_id).toBe(userA);
    expect(logRows[0].payload.text).toBe(LOG_TEXT);

    const taskRows = await rowsFor('task');
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0].author_id).toBe(userA);
    expect(taskRows[0].payload.title).toBe(TASK_TITLE);

    const mapRows = await rowsFor('map_feature');
    expect(mapRows).toHaveLength(1);
    expect(mapRows[0].author_id).toBe(userA);
    expect((mapRows[0].payload.geometry as { type: string }).type).toBe('Point');
    expect(mapRows[0].payload.label).toBe(MAP_LABEL);

    const decisionRows = await rowsFor('decision_request');
    expect(decisionRows).toHaveLength(1);
    expect(decisionRows[0].author_id).toBe(userB);
    expect(decisionRows[0].payload.question).toBe(QUESTION);
  } finally {
    await client.end();
  }
});
