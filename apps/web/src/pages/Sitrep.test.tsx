// Sitrep tests — plan.md §10 / M35.
//
// Renders the sitrep print view from seeded local records and verifies
// section selection, printing controls, and save persistence.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import { Sitrep } from './Sitrep.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, EntityType, type RecordEnvelope } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-sitrep';
const NOW = new Date('2026-11-14T12:00:00Z').toISOString();

function makeStore(userId: string): LocalStore {
  return new LocalStore({ userId });
}

async function seed(
  store: LocalStore,
  entityId: string,
  entityType: EntityType,
  payload: unknown,
  functionId: string | null = null,
): Promise<RecordEnvelope> {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType,
    incidentId: INCIDENT,
    parentIds: [],
    functionId,
    authorId: 'user-sitrep',
    deviceId: getDeviceId(),
    schemaVersion: 1,
    payload,
    createdAtClient: NOW,
    kind: 'put',
    state,
  });
  saveHlcState(next, getDeviceId());
  await store.ingestRemoteRecords([record]);
  return record;
}

function renderSitrep(store: LocalStore) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Sitrep store={store} incidentId={INCIDENT} authorId="user-sitrep" />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Sitrep (M35)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders section selection with all sections checked by default', async () => {
    const store = makeStore('user-sitrep-1');
    renderSitrep(store);

    await waitFor(() => expect(screen.getByText('Avsnitt')).toBeInTheDocument());
    // All 9 sections should be checked.
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(9);
    checkboxes.forEach((cb) => expect(cb).toBeChecked());
  });

  it('renders mission section from seeded records', async () => {
    const store = makeStore('user-sitrep-2');
    await seed(store, 'mission-1', EntityType.mission, {
      content: 'Skydda befintlig bebyggelse',
      staffShouldDo: 'Etablera avspärrningar',
      staffShouldNotDo: 'Gå in i farozonen',
      deadline: '2026-11-15T08:00:00Z',
      issuedBy: 'user-chief',
    });
    renderSitrep(store);

    // Wait for the mission content to load from the local store.
    await waitFor(() => expect(screen.getByText('Skydda befintlig bebyggelse')).toBeInTheDocument());
    expect(screen.getByText('Etablera avspärrningar')).toBeInTheDocument();
  });

  it('toggling a section off hides it', async () => {
    const store = makeStore('user-sitrep-3');
    await seed(store, 'mission-1', EntityType.mission, {
      content: 'Skydda befintlig bebyggelse',
      staffShouldDo: 'Etablera avspärrningar',
      staffShouldNotDo: 'Gå in i farozonen',
      deadline: null,
      issuedBy: 'user-chief',
    });
    renderSitrep(store);

    await waitFor(() => expect(screen.getByText('Skydda befintlig bebyggelse')).toBeInTheDocument());

    // Uncheck "Uppdrag" (mission).
    const missionCheckbox = screen.getByRole('checkbox', { name: 'Uppdrag' });
    expect(missionCheckbox).toBeChecked();
    fireEvent.click(missionCheckbox);

    await waitFor(() => {
      expect(screen.queryByText('Skydda befintlig bebyggelse')).not.toBeInTheDocument();
    });
  });

  it('saving creates a sitrep record in the local store', async () => {
    const store = makeStore('user-sitrep-4');
    renderSitrep(store);

    await waitFor(() => expect(screen.getByText('Spara')).toBeInTheDocument());
    const saveButton = screen.getByText('Spara');
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText('Sparad')).toBeInTheDocument());

    const sitrepRecords = await store.getRecordsByEntity(`sitrep-${INCIDENT}`);
    expect(sitrepRecords.length).toBe(1);
    expect(sitrepRecords[0].entityType).toBe('sitrep');
    const payload = sitrepRecords[0].payload as {
      title: string;
      sections: string[];
      snapshot: Record<string, unknown>;
    };
    expect(payload.sections).toContain('mission');
    expect(payload.snapshot.mission).toBeDefined();
  });
});
