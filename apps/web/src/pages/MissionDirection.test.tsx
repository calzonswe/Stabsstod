// MissionDirection tests — M20
//
// Permission gating (only decision_maker/chief/deputy may edit mission; only
// chief/deputy may edit direction; acknowledge is chief-of-staff only);
// acknowledgement creates a new version; desired vs actual side by side.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import MissionDirection from './MissionDirection.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, can, type Actor } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m20';

function makeStore(userId: string): LocalStore {
  return new LocalStore({ userId });
}

function actorFor(role: Actor['role']): Actor {
  return {
    userId: 'user-1',
    incidentId: INCIDENT,
    role,
    functionIds: ['fn-1'],
  };
}

function component(actor: Actor | null, store: LocalStore) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MissionDirection store={store} incidentId={INCIDENT} authorId="user-1" actor={actor} />
    </I18nextProvider>,
  );
}

async function seedEntity(
  store: LocalStore,
  entityType: 'mission' | 'direction',
  payload: Record<string, unknown>,
) {
  const state = loadHlcState();
  const entityId = `${entityType}-${INCIDENT}`;
  const { record, state: next } = newRecord({
    entityId,
    entityType,
    incidentId: INCIDENT,
    parentIds: [],
    functionId: null,
    authorId: 'user-dm',
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

describe('MissionDirection (permissions and versioning)', () => {
  afterEach(() => {
    cleanup();
  });

  it('observer sees no edit buttons (mission or direction)', async () => {
    const store = makeStore('user-m20-0');
    component(actorFor('observer'), store);

    await waitFor(() => {
      expect(screen.getByText('Inget uppdrag satt än.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Redigera uppdrag' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redigera inriktning' })).toBeNull();
    expect(screen.getByText('Ingen önskad inriktning satt än.')).toBeInTheDocument();
  });

  it('function_lead may edit neither mission nor direction (permission parity with can())', async () => {
    const store = makeStore('user-m20-1');
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByText('Inget uppdrag satt än.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Redigera uppdrag' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redigera inriktning' })).toBeNull();

    // And the pure function agrees — the same can() the UI used.
    const actor = actorFor('function_lead');
    expect(can(actor, 'write', { entityType: 'mission', incidentId: INCIDENT, functionId: null }, {})).toBe(false);
    expect(can(actor, 'write', { entityType: 'direction', incidentId: INCIDENT, functionId: null }, {})).toBe(false);
  });

  it('decision_maker may edit the mission but not the direction', async () => {
    const store = makeStore('user-m20-2');
    component(actorFor('decision_maker'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Redigera uppdrag' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Redigera inriktning' })).toBeNull();
    // Acknowledge is the chief of staff's action, not the decision maker's.
    expect(screen.queryByRole('button', { name: /Bekräfta/ })).toBeNull();
  });

  it('chief of staff sees both editors and the acknowledge action', async () => {
    const store = makeStore('user-m20-3');
    component(actorFor('chief_of_staff'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Redigera inriktning' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Redigera uppdrag' })).toBeInTheDocument();
    // Acknowledge is disabled until a mission exists.
    const ack = screen.getByRole('button', { name: /Bekräfta/ }) as HTMLButtonElement;
    expect(ack.disabled).toBe(true);
  });

  it('saving the mission writes a version; acknowledging creates a new version with acknowledgedByChief', async () => {
    const store = makeStore('user-m20-4');
    const first = await seedEntity(store, 'mission', {
      content: 'Rädda liv och begränsa spridning',
      issuedBy: 'user-dm',
    });

    component(actorFor('chief_of_staff'), store);

    await waitFor(() => {
      expect(screen.getByText('Rädda liv och begränsa spridning')).toBeInTheDocument();
    });

    // Acknowledge.
    const ack = screen.getByRole('button', { name: /Bekräfta/ }) as HTMLButtonElement;
    expect(ack.disabled).toBe(false);
    fireEvent.click(ack);

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('mission-incident-m20');
      expect(records.length).toBe(2);
      const second = records.find((r) => r.id !== first.id)!;
      expect(second.kind).toBe('put');
      expect(second.parentIds).toContain(first.id);
      const payload = second.payload as { acknowledgedByChief?: { userId: string } };
      expect(payload.acknowledgedByChief?.userId).toBe('user-1');
      // The content carries over from the previous version.
      expect((payload as { content: string }).content).toBe('Rädda liv och begränsa spridning');
    });

    await waitFor(() => {
      expect(screen.getByText(/bekräftat av stabschefen/)).toBeInTheDocument();
    });
  });

  it('direction renders desired vs actual side by side with divergence note', async () => {
    const store = makeStore('user-m20-5');
    await seedEntity(store, 'direction', {
      desired: 'Läget under kontroll inom 24 h',
      actual: 'Läget fortfarande ovisst',
      divergenceNote: 'Resurser saknas i norra delen',
      validFrom: new Date().toISOString(),
    });

    component(actorFor('chief_of_staff'), store);

    await waitFor(() => {
      expect(screen.getByText('Läget under kontroll inom 24 h')).toBeInTheDocument();
      expect(screen.getByText('Läget fortfarande ovisst')).toBeInTheDocument();
      expect(screen.getByText(/Resurser saknas i norra delen/)).toBeInTheDocument();
    });
  });

  it('chief saves the direction (new version, outbox entry, both fields)', async () => {
    const store = makeStore('user-m20-6');
    component(actorFor('chief_of_staff'), store);

    await waitFor(() => {
      expect(screen.getByText('Ingen önskad inriktning satt än.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Redigera inriktning' }));

    const textareas = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    // Direction editor textareas: desired, actual, divergenceNote — plus the
    // mission editor's hidden ones? Mission editor isn't rendered when not
    // editing, so order is desired(0), actual(1), divergenceNote(2).
    expect(textareas.length).toBe(3);
    fireEvent.change(textareas[0], { target: { value: 'Hålla läget' } });
    fireEvent.change(textareas[1], { target: { value: 'Förlopp pågår' } });
    fireEvent.change(textareas[2], { target: { value: 'Försenad i norr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('direction-incident-m20');
      expect(records.length).toBe(1);
      const p = records[0].payload as { desired: string; actual: string; divergenceNote: string };
      expect(p.desired).toBe('Hålla läget');
      expect(p.actual).toBe('Förlopp pågår');
      expect(p.divergenceNote).toBe('Försenad i norr');
    });

    const pending = await store.getPendingOutbox();
    expect(pending.some((e) => e.record.entityType === 'direction')).toBe(true);
  });
});
