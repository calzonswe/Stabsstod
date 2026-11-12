// SituationEditor tests — M18
//
// Versioning: each save creates a NEW VERSION of the same entity with the
// previous head as parent; the current picture shows the latest version.
// Diff: picking two versions renders +/- lines via renderSnapshotText/diffLines.
//
// This file enables RTL cleanup between tests (the global Vitest config has
// no auto-cleanup), so queries can use plain getBy* without stale DOM from
// earlier tests interfering.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import SituationEditor from './SituationEditor.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, renderSnapshotText } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m18';

function makeStore(userId: string): LocalStore {
  return new LocalStore({ userId });
}

async function seedSnapshot(
  store: LocalStore,
  entityId: string,
  payload: Record<string, unknown>,
  authorId = 'user-2',
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType: 'situation_snapshot',
    incidentId: INCIDENT,
    parentIds: [],
    functionId: null,
    authorId,
    deviceId: getDeviceId(),
    schemaVersion: 1,
    payload,
    createdAtClient: new Date().toISOString(),
    kind: 'put',
    state,
  });
  saveHlcState(next, getDeviceId());
  await store.ingestRemoteRecords([record]);
  return record;
}

describe('SituationEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows "no snapshot yet" when nothing is saved', async () => {
    const store = makeStore('user-m18-0');
    render(
      <I18nextProvider i18n={i18n}>
        <SituationEditor store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Ingen lägesbild sparad än.')).toBeInTheDocument();
    });
  });

  it('saving creates a new version with the previous head as parent', async () => {
    const store = makeStore('user-m18-1');
    const first = await seedSnapshot(store, 'snapshot-m18-1', {
      whatHappened: 'Brand i lager 3',
      current: 'Släckningsarbete pågår',
      consequences: 'Rök i angränsande fastigheter',
      protectedValues: ['life', 'property'],
    });

    render(
      <I18nextProvider i18n={i18n}>
        <SituationEditor store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    // The current picture shows the latest version, and the editor is
    // pre-filled from the latest version (committed form state — waiting on
    // the value, not just the display, so the prefill effect has run).
    await waitFor(() => {
      const textareas = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
      expect(textareas.length).toBe(6);
      expect(textareas[1].value).toBe('Släckningsarbete pågår');
    });

    // Change the "current" field (textarea order: whatHappened, current,
    // consequences, FIS ×3).
    const textareas = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    fireEvent.change(textareas[1], {
      target: { value: 'Brand under kontroll, varma fläcker bevakas' },
    });

    // Save as new version.
    fireEvent.click(screen.getByRole('button', { name: 'Spara som ny version' }));

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('snapshot-m18-1');
      expect(records.length).toBe(2);
      const second = records.find((r) => r.id !== first.id)!;
      expect(second.kind).toBe('put');
      expect(second.parentIds).toContain(first.id);
      expect((second.payload as { current: string }).current).toBe(
        'Brand under kontroll, varma fläcker bevakas',
      );
    });

    // The current picture now shows the newest version's text.
    await waitFor(() => {
      expect(
        screen.getAllByText('Brand under kontroll, varma fläcker bevakas').length,
      ).toBeGreaterThan(0);
    });
  });

  it('protected values round-trip through a save', async () => {
    const store = makeStore('user-m18-2');
    render(
      <I18nextProvider i18n={i18n}>
        <SituationEditor store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Ingen lägesbild sparad än.')).toBeInTheDocument();
    });

    // Check "Miljö" and "Liv" checkboxes, fill a field, save.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Miljö' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Liv' }));
    const textareas = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    fireEvent.change(textareas[0], { target: { value: 'Kemutsläpp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara som ny version' }));

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('snapshot-incident-m18');
      expect(records.length).toBe(1);
      const payload = records[0].payload as { protectedValues: string[] };
      expect(payload.protectedValues).toContain('environment');
      expect(payload.protectedValues).toContain('life');
    });
  });

  it('picking two versions shows a +/- diff', async () => {
    const store = makeStore('user-m18-3');
    const first = await seedSnapshot(store, 'snapshot-m18-3', {
      current: 'Brand släckt',
      protectedValues: [],
    });

    // Seed a second version directly (different payload).
    const state = loadHlcState();
    const secondPayload = {
      current: 'Brand släckt, 2 skadade transporteras',
      consequences: 'Kvarvarande varma fläcker',
      protectedValues: ['health'],
    };
    const { record: second, state: next2 } = newRecord({
      entityId: 'snapshot-m18-3',
      entityType: 'situation_snapshot',
      incidentId: INCIDENT,
      parentIds: [first.id],
      functionId: null,
      authorId: 'user-2',
      deviceId: getDeviceId(),
      schemaVersion: 1,
      payload: secondPayload,
      createdAtClient: new Date().toISOString(),
      kind: 'put',
      state,
    });
    saveHlcState(next2, getDeviceId());
    await store.ingestRemoteRecords([second]);

    render(
      <I18nextProvider i18n={i18n}>
        <SituationEditor store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    // Open version history.
    await waitFor(() => {
      expect(screen.getByText('Nuvarande lägesbild (senaste versionen)')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Versioner' }));

    // Two versions listed as radio pairs (from/to).
    await waitFor(() => {
      expect(document.querySelectorAll('input[type="radio"]').length).toBe(4);
    });
    const radios = document.querySelectorAll('input[type="radio"]');
    fireEvent.click(radios[0]); // v1 "from"
    fireEvent.click(radios[3]); // v2 "to"

    // Diff shows added lines from renderSnapshotText of the new version.
    await waitFor(() => {
      expect(screen.getByText('Ändringar mellan versioner')).toBeInTheDocument();
    });
    const expectedAdded = renderSnapshotText(secondPayload).split('\n');
    const addedLines = Array.from(document.querySelectorAll('.bg-green-50'));
    const addedText = addedLines.map((el) => el.textContent);
    expect(addedText.length).toBe(expectedAdded.length);
    expect(addedText[0]).toContain(expectedAdded[0]);
    // And the removed line for the changed "current" field.
    const removedLines = Array.from(document.querySelectorAll('.bg-red-50'));
    expect(removedLines.length).toBeGreaterThan(0);
    expect(removedLines.some((el) => el.textContent?.includes('Brand släckt'))).toBe(true);
  });
});
