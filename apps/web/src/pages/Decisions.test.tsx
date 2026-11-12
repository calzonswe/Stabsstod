// Decisions tests — M21
//
// Permission gating (requests: own-function writers; decisions: decision maker
// or chief with delegated mandate); recording a decision creates a new version
// of the request (status → decided) plus a decision record with requestId;
// withdraw is a new version; list with status filters.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import Decisions from './Decisions.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, type Actor } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m21';

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
      <Decisions store={store} incidentId={INCIDENT} authorId="user-1" actor={actor} />
    </I18nextProvider>,
  );
}

async function seedRequest(
  store: LocalStore,
  entityId: string,
  payload: Record<string, unknown>,
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType: 'decision_request',
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

const openRequest = {
  question: 'Skall vi uppgradera flötledningssystemet?',
  background: 'Läget är ovisst.',
  options: [
    { title: 'Ja', pros: ['Bättre'], cons: ['Kostar'] },
    { title: 'Nej', pros: ['Säkrare'], cons: ['Fördröjning'] },
  ],
  recommendation: 'Vänta med beslutet',
  status: 'open',
};

describe('Decisions (M21)', () => {
  afterEach(() => {
    cleanup();
  });

  it('observer sees the request but no write buttons', async () => {
    const store = new LocalStore({ userId: 'user-m21-0' });
    await seedRequest(store, 'dr-0', openRequest);
    component(actorFor('observer'), store);

    await waitFor(() => {
      expect(screen.getByText('Skall vi uppgradera flötledningssystemet?')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Ny beslutsfråga' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redovisa beslut' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dra tillbaka frågan' })).toBeNull();
  });

  it('function_lead may write requests (own function) but not record decisions', async () => {
    const store = new LocalStore({ userId: 'user-m21-1' });
    await seedRequest(store, 'dr-1', openRequest);
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ny beslutsfråga' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Redovisa beslut' })).toBeNull();
  });

  it('decision_maker may record the outcome on an open request', async () => {
    const store = new LocalStore({ userId: 'user-m21-2' });
    await seedRequest(store, 'dr-2', openRequest);
    component(actorFor('decision_maker'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Redovisa beslut' })).toBeInTheDocument();
    });
  });

  it('chief of staff may record the outcome with delegated mandate', async () => {
    const store = new LocalStore({ userId: 'user-m21-3' });
    await seedRequest(store, 'dr-3', openRequest);
    component(actorFor('chief_of_staff'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Redovisa beslut' })).toBeInTheDocument();
    });
  });

  it('recording a decision: new request version (status decided) + decision record with requestId', async () => {
    const store = new LocalStore({ userId: 'user-m21-4' });
    const first = await seedRequest(store, 'dr-4', openRequest);
    component(actorFor('decision_maker'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Redovisa beslut' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Redovisa beslut' }));
    fireEvent.change(screen.getByPlaceholderText('Beslutet'), {
      target: { value: 'Uppgradera systemet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spara beslut' }));

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('dr-4');
      expect(records.length).toBe(2);
      const second = records.find((r) => r.id !== first.id)!;
      expect(second.kind).toBe('put');
      expect(second.parentIds).toContain(first.id);
      expect((second.payload as { status: string }).status).toBe('decided');
      // The outcome is a separate decision record linked via requestId.
      const all = await store.getRecordsByIncident(INCIDENT);
      const decision = all.find((r) => r.entityType === 'decision');
      expect(decision).toBeDefined();
      expect((decision!.payload as { requestId: string }).requestId).toBe('dr-4');
      expect((decision!.payload as { mandate: string }).mandate).toBe('decision_maker');
    });

    await waitFor(() => {
      expect(screen.getByText('Uppgradera systemet')).toBeInTheDocument();
      expect(screen.getByText('Besluten')).toBeInTheDocument();
    });
  });

  it('withdrawing a request writes a new version with status withdrawn', async () => {
    const store = new LocalStore({ userId: 'user-m21-5' });
    const first = await seedRequest(store, 'dr-5', openRequest);
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dra tillbaka frågan' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dra tillbaka frågan' }));

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('dr-5');
      expect(records.length).toBe(2);
      const second = records.find((r) => r.id !== first.id)!;
      expect((second.payload as { status: string }).status).toBe('withdrawn');
    });
  });

  it('status filter shows only the selected status', async () => {
    const store = new LocalStore({ userId: 'user-m21-6' });
    await seedRequest(store, 'dr-6a', { ...openRequest, question: 'Öppen fråga', status: 'open' });
    await seedRequest(store, 'dr-6b', { ...openRequest, question: 'Besluten fråga', status: 'decided' });
    component(actorFor('decision_maker'), store);

    await waitFor(() => {
      expect(screen.getByText('Öppen fråga')).toBeInTheDocument();
    });
    expect(screen.getByText('Besluten fråga')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Beslutna' }));
    await waitFor(() => {
      expect(screen.queryByText('Öppen fråga')).toBeNull();
    });
    expect(screen.getByText('Besluten fråga')).toBeInTheDocument();
  });

  it('creating a request via the form writes a decision_request record', async () => {
    const store = new LocalStore({ userId: 'user-m21-7' });
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ny beslutsfråga' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ny beslutsfråga' }));

    fireEvent.change(screen.getByPlaceholderText('Vad ska avgöras?'), {
      target: { value: 'Nya frågan' },
    });
    fireEvent.change(screen.getByPlaceholderText('Alternativ 1 — Alternativ'), {
      target: { value: 'Alternativ A' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lägg till alternativ' }));
    fireEvent.change(screen.getByPlaceholderText('Alternativ 2 — Alternativ'), {
      target: { value: 'Alternativ B' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('Fördelar (en per rad)')[0], {
      target: { value: 'Billigt\nSäkert' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    await waitFor(async () => {
      const all = await store.getRecordsByIncident(INCIDENT);
      const request = all.find((r) => r.entityType === 'decision_request');
      expect(request).toBeDefined();
      const p = request!.payload as {
        question: string;
        status: string;
        options: { title: string; pros: string[] }[];
      };
      expect(p.question).toBe('Nya frågan');
      expect(p.status).toBe('open');
      expect(p.options).toHaveLength(2);
      expect(p.options[0].title).toBe('Alternativ A');
      expect(p.options[1].title).toBe('Alternativ B');
      expect(p.options[0].pros).toEqual(['Billigt', 'Säkert']);
    });
  });
});
