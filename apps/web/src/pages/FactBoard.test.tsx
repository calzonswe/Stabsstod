// FactBoard tests — M17
//
// Board columns Vet/Antar/Vet ej; status transitions (assumption → verified
// or refuted) create a NEW VERSION with the previous head as parent; history
// is kept; owner filter works.

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import FactBoard from './FactBoard.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, materializeOne, type RecordEnvelope } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m17';

function makeStore(userId: string): LocalStore {
  return new LocalStore({ userId });
}

describe('FactBoard (status transitions and history)', () => {
  it('created items land in the right column (Antar by default)', async () => {
    const store = makeStore('user-m17-1');
    render(
      <I18nextProvider i18n={i18n}>
        <FactBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Antar').length).toBeGreaterThan(0);
    });

    // Board renders the three columns.
    expect(screen.getAllByText('Vet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vet ej').length).toBeGreaterThan(0);
  });

  it('assumption → verified creates a new version and keeps history', async () => {
    const store = makeStore('user-m17-2');

    // Seed one assumption directly into the local store.
    const state = loadHlcState();
    const { record, state: next } = newRecord({
      entityId: 'entity-fact-1',
      entityType: 'fact_item',
      incidentId: INCIDENT,
      parentIds: [],
      functionId: null,
      authorId: 'user-2',
      deviceId: getDeviceId(),
      schemaVersion: 1,
      payload: { text: 'Bränderna är under kontroll', status: 'assumption' },
      createdAtClient: new Date().toISOString(),
      kind: 'put',
      state,
    });
    saveHlcState(next, getDeviceId());
    await store.ingestRemoteRecords([record]);

    render(
      <I18nextProvider i18n={i18n}>
        <FactBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Bränderna är under kontroll').length).toBeGreaterThan(0);
    });

    // Click "Verifierad" on the assumption card.
    const verify = screen.getAllByText('Verifierad');
    fireEvent.click(verify[0]);

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('entity-fact-1');
      expect(records.length).toBe(2);
      // New version: kind put, status verified, previous head as parent.
      const newVersion = records.find((r) => r.id !== record.id)!;
      expect(newVersion.kind).toBe('put');
      expect((newVersion.payload as { status: string }).status).toBe('verified');
      expect(newVersion.parentIds).toContain(record.id);
    });

    // The card moved to the Vet column (three 'Vet' headers + card now there).
    await waitFor(() => {
      // The text appears exactly once — in the Vet column.
      expect(screen.getAllByText('Bränderna är under kontroll').length).toBe(1);
    });
  });

  it('assumption → refuted shows the item struck through in its column', async () => {
    const store = makeStore('user-m17-3');
    const state = loadHlcState();
    const { record, state: next } = newRecord({
      entityId: 'entity-fact-2',
      entityType: 'fact_item',
      incidentId: INCIDENT,
      parentIds: [],
      functionId: null,
      authorId: 'user-2',
      deviceId: getDeviceId(),
      schemaVersion: 1,
      payload: { text: 'Alla är evakuerade', status: 'assumption' },
      createdAtClient: new Date().toISOString(),
      kind: 'put',
      state,
    });
    saveHlcState(next, getDeviceId());
    await store.ingestRemoteRecords([record]);

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <FactBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Alla är evakuerade').length).toBeGreaterThan(0);
    });

    const refute = screen.getAllByText('Avfärdad');
    fireEvent.click(refute[0]);

    await waitFor(() => {
      const struck = container.querySelector('.line-through');
      expect(struck).not.toBeNull();
      expect(struck!.textContent).toContain('Alla är evakuerade');
    });

    // History keeps both versions.
    const records = await store.getRecordsByEntity('entity-fact-2');
    expect(records.length).toBe(2);
    const refuted = records.find((r) => r.id !== record.id)!;
    expect((refuted.payload as { status: string }).status).toBe('refuted');
    expect(refuted.parentIds).toContain(record.id);
  });

  it('owner filter hides other owners’ items', async () => {
    const store = makeStore('user-m17-4');
    for (const [i, text] of ['Fact from A', 'Fact from B'].entries()) {
      const state = loadHlcState();
      const { record, state: next } = newRecord({
        entityId: `entity-owner-${i}`,
        entityType: 'fact_item',
        incidentId: INCIDENT,
        parentIds: [],
        functionId: null,
        authorId: i === 0 ? 'author-a' : 'author-b',
        deviceId: getDeviceId(),
        schemaVersion: 1,
        payload: { text, status: 'verified' },
        createdAtClient: new Date().toISOString(),
        kind: 'put',
        state,
      });
      saveHlcState(next, getDeviceId());
      await store.ingestRemoteRecords([record]);
    }

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <FactBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Fact from A').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Fact from B').length).toBeGreaterThan(0);
    });

    // Pick owner 'author-a' in the owner filter (first select).
    const ownerSelect = container.querySelectorAll('select')[0];
    fireEvent.change(ownerSelect, { target: { value: 'author-a' } });

    await waitFor(() => {
      expect(screen.queryAllByText('Fact from B').length).toBe(0);
      expect(screen.getAllByText('Fact from A').length).toBeGreaterThan(0);
    });
  });

  it('materialize keeps the full version chain across transitions', async () => {
    // Direct materialize check: three versions chained by parentIds.
    const state = loadHlcState();
    let prevId: string | null = null;
    const versions: Parameters<typeof materializeOne>[0] = [];
    for (const status of ['assumption', 'verified', 'refuted'] as const) {
      const { record, state: next } = newRecord({
        entityId: 'entity-chain',
        entityType: 'fact_item',
        incidentId: INCIDENT,
        parentIds: prevId ? [prevId] : [],
        functionId: null,
        authorId: 'user-1',
        deviceId: getDeviceId(),
        schemaVersion: 1,
        payload: { text: 'Kedja', status },
        createdAtClient: new Date().toISOString(),
        kind: 'put',
        state,
      });
      saveHlcState(next, getDeviceId());
      versions.push(record);
      prevId = record.id;
    }

    const mat = materializeOne(versions, 'entity-chain');
    expect(mat).toBeTruthy();
    expect(mat!.history.length).toBe(3);
    expect(mat!.heads.length).toBe(1); // linear chain → single head
    expect((mat!.current!.payload as { status: string }).status).toBe('refuted');
  });

  it('conflicting heads show a conflict badge; merging collapses them (M39)', async () => {
    const store = makeStore('user-m17-5');
    const entityId = 'entity-fact-conflict';
    const heads: RecordEnvelope[] = [];
    for (const [i, status] of (['verified', 'refuted'] as const).entries()) {
      const state = loadHlcState();
      const { record, state: next } = newRecord({
        entityId,
        entityType: 'fact_item',
        incidentId: INCIDENT,
        parentIds: [],
        functionId: null,
        authorId: `author-${i}`,
        deviceId: `device-${i}`,
        schemaVersion: 1,
        payload: { text: 'Målvakten saknas', status },
        createdAtClient: new Date().toISOString(),
        kind: 'put',
        state,
      });
      saveHlcState(next, getDeviceId());
      await store.ingestRemoteRecords([record]);
      heads.push(record);
    }

    render(
      <I18nextProvider i18n={i18n}>
        <FactBoard store={store} incidentId={INCIDENT} authorId="user-1" />
      </I18nextProvider>,
    );

    // The card shows the conflict badge.
    const [badge] = await screen.findAllByText('Konflikt');
    fireEvent.click(badge);

    // Banner shows both heads.
    await waitFor(() => {
      expect(
        screen.getAllByText('Flera versioner finns för denna entitet').length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('author-0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('author-1').length).toBeGreaterThan(0);

    // "Use this version" on the non-current head writes a merge record.
    const [useButton] = screen.getAllByText('Använd denna version');
    fireEvent.click(useButton);

    await waitFor(async () => {
      const records = await store.getRecordsByEntity(entityId);
      const headIds = heads.map((h) => h.id);
      const merge = records.find(
        (r) =>
          r.parentIds.length === headIds.length &&
          r.parentIds.every((p) => headIds.includes(p)),
      );
      expect(merge).toBeTruthy();
      expect(merge!.kind).toBe('put');
    });

    // The badge is gone once the conflict collapsed to a single head.
    await waitFor(async () => {
      const records = await store.getRecordsByEntity(entityId);
      const mat = materializeOne(
        records,
        entityId,
      );
      expect(mat!.conflict).toBe(false);
    });
  });
});
