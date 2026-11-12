// Logbook tests — M16
//
// Uses the real LocalStore over fake-indexeddb (wired in testSetup.ts):
//   create offline → entry appears immediately in the list
//   retract with reason → entry shown struck through
//   conflict banner + merge record parents

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import Logbook from './Logbook.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, type RecordEnvelope } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m16';

function makeLocalStore(userId: string): LocalStore {
  return new LocalStore({ userId });
}

async function seedConflictingHeads(
  store: LocalStore,
): Promise<{ heads: RecordEnvelope[]; entityId: string }> {
  const entityId = 'entity-conflict-1';
  const heads: RecordEnvelope[] = [];
  for (const [i, text] of ['Version A', 'Version B'].entries()) {
    const state = loadHlcState();
    const { record, state: next } = newRecord({
      entityId,
      entityType: 'log_entry',
      incidentId: INCIDENT,
      parentIds: [],
      functionId: null,
      authorId: `author-${i}`,
      deviceId: `device-${i}`,
      schemaVersion: 1,
      payload: {
        text,
        category: 'info',
        eventTime: new Date().toISOString(),
        visibility: 'incident',
      },
      createdAtClient: new Date().toISOString(),
      kind: 'put',
      state,
    });
    saveHlcState(next, getDeviceId());
    // Ingest as if pulled from the server (bypasses outbox).
    await store.ingestRemoteRecords([record]);
    heads.push(record);
  }
  return { heads, entityId };
}

describe('Logbook (offline-first write path)', () => {
  it('created entry appears immediately in the list, before any sync', async () => {
    const store = makeLocalStore('user-m16-1');
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <Logbook store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    // Open the form and fill it in.
    await waitFor(() => {
      expect(screen.getAllByText('Ny loggpost').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('Ny loggpost')[0]);

    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Brand i lager 3' } });

    // Submit — writes to local Dexie + outbox; no server involved.
    const saveButtons = screen.getAllByText('Spara');
    fireEvent.click(saveButtons[0]);

    // The entry is visible immediately from local data.
    await waitFor(() => {
      expect(screen.getAllByText('Brand i lager 3').length).toBeGreaterThan(0);
    });

    // It is in the outbox, waiting to sync.
    const pending = await store.getPendingOutbox();
    expect(pending.length).toBe(1);
    expect(pending[0].record.entityType).toBe('log_entry');
    expect(
      (pending[0].record.payload as { text: string }).text,
    ).toBe('Brand i lager 3');
  });

  it('retracted entry is shown struck through', async () => {
    const store = makeLocalStore('user-m16-2');
    const state = loadHlcState();
    const { record, state: next } = newRecord({
      entityId: 'entity-retract-1',
      entityType: 'log_entry',
      incidentId: INCIDENT,
      parentIds: [],
      functionId: null,
      authorId: 'user-1',
      deviceId: getDeviceId(),
      schemaVersion: 1,
      payload: {
        text: 'Post att återkalla',
        category: 'info',
        eventTime: new Date().toISOString(),
        visibility: 'incident',
      },
      createdAtClient: new Date().toISOString(),
      kind: 'put',
      state,
    });
    saveHlcState(next, getDeviceId());
    await store.ingestRemoteRecords([record]);

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <Logbook store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Post att återkalla').length).toBeGreaterThan(0);
    });

    // Click retract on the row, enter a reason, confirm.
    const retractButtons = container.querySelectorAll('button');
    const rowRetract = Array.from(retractButtons).find(
      (b) => b.textContent === 'Återkalla',
    );
    expect(rowRetract).toBeTruthy();
    fireEvent.click(rowRetract!);

    const reasonInput = container.querySelector(
      'input[placeholder="Anledning"]',
    ) as HTMLInputElement;
    fireEvent.change(reasonInput, { target: { value: 'Felinmatat' } });

    const confirms = screen.getAllByText('Återkalla');
    fireEvent.click(confirms[confirms.length - 1]);

    // The text is still there (history is kept) but struck through.
    await waitFor(() => {
      const struck = container.querySelector('.line-through');
      expect(struck).not.toBeNull();
      expect(struck!.textContent).toContain('Post att återkalla');
    });

    // The retract record went to the outbox as a new version.
    const pending = await store.getPendingOutbox();
    const retractRecord = pending.find((e) => e.record.kind === 'retract');
    expect(retractRecord).toBeTruthy();
    expect(
      (retractRecord!.record.payload as { reason: string }).reason,
    ).toBe('Felinmatat');
    // The retract names the original record as its parent.
    expect(retractRecord!.record.parentIds).toContain(record.id);
  });

  it('conflicting heads show the conflict banner and merge collapses them', async () => {
    const store = makeLocalStore('user-m16-3');
    const { entityId } = await seedConflictingHeads(store);

    render(
      <I18nextProvider i18n={i18n}>
        <Logbook store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    // The row displays the current head's payload (the head with the
    // greatest HLC — "Version B").
    await waitFor(() => {
      expect(screen.getAllByText('Version B').length).toBeGreaterThan(0);
    });

    // Open the conflict banner via the row's Konflikt chip.
    const conflictChip = screen.getAllByText('Konflikt')[0];
    fireEvent.click(conflictChip);

    // Banner shows both heads.
    await waitFor(() => {
      expect(screen.getAllByText('Flera versioner finns för denna entitet').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('author-0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('author-1').length).toBeGreaterThan(0);

    // "Use this version" on the non-current head merges with all heads as parents.
    const useButtons = screen.getAllByText('Använd denna version');
    fireEvent.click(useButtons[0]);

    await waitFor(() => {
      const pending = store.getPendingOutbox().then((all) =>
        all.filter((e) => e.record.entityId === entityId && e.record.parentIds.length === 2),
      );
      return pending.then((list) => expect(list.length).toBe(1));
    });
  });
});
