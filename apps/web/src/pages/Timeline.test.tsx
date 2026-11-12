// Timeline tests — M23
//
// Accept: renders 200 items without freezing (windowing). Plus: derived
// items (task deadlines, decisions) merge with manual events, permission
// edges (observer/staff_member no create), function_lead creates via the
// form, chief retracts with reason (append-only).

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import Timeline from './Timeline.tsx';
import { LocalStore } from '../localStore.js';
import {
  newRecord,
  type Actor,
  type RecordEnvelope,
} from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m23';

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
      <Timeline
        store={store}
        incidentId={INCIDENT}
        authorId="user-1"
        actor={actor}
      />
    </I18nextProvider>,
  );
}

async function seed(
  store: LocalStore,
  entityId: string,
  entityType: 'timeline_event' | 'task' | 'decision',
  payload: Record<string, unknown>,
  functionId: string | null,
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType,
    incidentId: INCIDENT,
    parentIds: [],
    functionId,
    authorId: 'user-seed',
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

// Seed `count` manual timeline events, one per day, threading the HLC state
// through the loop and ingesting in one batch.
async function seedMany(
  store: LocalStore,
  count: number,
  make: (i: number) => { title: string; time: string },
) {
  let state = loadHlcState();
  const records: RecordEnvelope[] = [];
  for (let i = 0; i < count; i++) {
    const { title, time } = make(i);
    const { record, state: next } = newRecord({
      entityId: `te-big-${i}`,
      entityType: 'timeline_event',
      incidentId: INCIDENT,
      parentIds: [],
      functionId: 'fn-1',
      authorId: 'user-seed',
      deviceId: getDeviceId(),
      schemaVersion: 1,
      payload: { title, time, type: 'other', scope: 'internal' },
      createdAtClient: new Date().toISOString(),
      kind: 'put',
      state,
    });
    records.push(record);
    state = next;
  }
  saveHlcState(state, getDeviceId());
  await store.ingestRemoteRecords(records);
}

describe('Timeline (M23)', () => {
  afterEach(() => {
    cleanup();
  });

  it('observer sees the items but no create button and no remove buttons', async () => {
    const store = new LocalStore({ userId: 'user-m23-0' });
    await seed(
      store,
      'te-0',
      'timeline_event',
      {
        title: 'Stabsorientering',
        time: '2026-11-12T09:00:00Z',
        type: 'meeting',
        scope: 'internal',
      },
      'fn-1',
    );
    component(actorFor('observer'), store);

    await waitFor(() => {
      expect(screen.getByText('Stabsorientering')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Ny händelse' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Ta bort händelse' }),
    ).toBeNull();
  });

  it('staff_member sees the items but no create button', async () => {
    const store = new LocalStore({ userId: 'user-m23-1' });
    await seed(
      store,
      'te-1',
      'timeline_event',
      {
        title: 'Extern pressmöte',
        time: '2026-11-12T10:00:00Z',
        type: 'external',
        scope: 'external',
      },
      'fn-1',
    );
    component(actorFor('staff_member'), store);

    await waitFor(() => {
      expect(screen.getByText('Extern pressmöte')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Ny händelse' })).toBeNull();
  });

  it('merges manual events with derived task deadlines and decisions', async () => {
    const store = new LocalStore({ userId: 'user-m23-2' });
    await seed(
      store,
      'te-2',
      'timeline_event',
      {
        title: 'Stabsorientering',
        time: '2026-11-12T09:00:00Z',
        type: 'meeting',
        scope: 'internal',
      },
      'fn-1',
    );
    await seed(
      store,
      'tk-2',
      'task',
      {
        title: 'Beställ vattenprover',
        description: '',
        assigneeFunctionId: 'fn-1',
        due: '2026-11-12T12:00:00Z',
        priority: 'normal',
        status: 'todo',
        reportForm: 'none',
      },
      'fn-1',
    );
    await seed(
      store,
      'dc-2',
      'decision',
      {
        text: 'Uppgradera systemet',
        decidedByUserId: 'user-dm',
        decidedAt: '2026-11-12T11:00:00Z',
        mandate: 'decision_maker',
      },
      null,
    );
    component(actorFor('observer'), store);

    await waitFor(() => {
      expect(screen.getByText('Stabsorientering')).toBeInTheDocument();
      expect(screen.getByText('Beställ vattenprover')).toBeInTheDocument();
      expect(screen.getByText('Uppgradera systemet')).toBeInTheDocument();
    });
    // All three items (manual + two derived) are counted.
    expect(screen.getByText('3 händelser')).toBeInTheDocument();
  });

  it('renders 200 items without freezing — only the visible window is rendered', async () => {
    const store = new LocalStore({ userId: 'user-m23-3' });
    const start = Date.UTC(2026, 11, 1, 0, 0, 0);
    await seedMany(store, 200, (i) => ({
      title: `Händelse ${i}`,
      time: new Date(start + i * 86_400_000).toISOString(),
    }));
    component(actorFor('observer'), store);

    // The count label reflects the full derived list…
    await waitFor(() => {
      expect(screen.getByText('200 händelser')).toBeInTheDocument();
    });

    // …but only the items inside the visible window are rendered.
    const markers = screen.getAllByTestId('timeline-item');
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.length).toBeLessThan(50);
    // The far-future items are not in the DOM at all.
    expect(screen.queryByText('Händelse 199')).toBeNull();
    expect(screen.getByText('Händelse 0')).toBeInTheDocument();
  });

  it('function_lead creates a manual event via the form for own function', async () => {
    const store = new LocalStore({ userId: 'user-m23-4' });
    component(actorFor('function_lead'), store);

    const newButton = await screen.findByRole('button', { name: 'Ny händelse' });
    fireEvent.click(newButton);

    const titleInput = screen.getByPlaceholderText('Titel');
    fireEvent.change(titleInput, {
      target: { value: 'Extra stabsorientering' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    await waitFor(() => {
      expect(screen.getByText('Extra stabsorientering')).toBeInTheDocument();
    });

    const records = await store.getRecordsByIncident(INCIDENT);
    const put = records.find(
      (r) => r.entityType === 'timeline_event' && r.kind === 'put',
    );
    expect(put).toBeDefined();
    expect((put!.payload as { title: string }).title).toBe(
      'Extra stabsorientering',
    );
    expect(put!.functionId).toBe('fn-1');
  });

  it('chief retracts a manual event with a reason (append-only)', async () => {
    const store = new LocalStore({ userId: 'user-m23-5' });
    const put = await seed(
      store,
      'te-5',
      'timeline_event',
      {
        title: 'Översyn av plan',
        time: '2026-11-12T08:00:00Z',
        type: 'other',
        scope: 'internal',
      },
      'fn-1',
    );
    component(actorFor('chief_of_staff'), store);

    await waitFor(() => {
      expect(screen.getByText('Översyn av plan')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort händelse' }));

    fireEvent.change(screen.getByPlaceholderText('Anledning (obligatorisk)'), {
      target: { value: 'Fel tidpunkt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort' }));

    await waitFor(() => {
      expect(screen.queryByText('Översyn av plan')).toBeNull();
    });

    const records = (await store.getRecordsByIncident(INCIDENT)).filter(
      (r) => r.entityId === 'te-5',
    );
    expect(records.length).toBe(2);
    const retract = records.find((r) => r.kind === 'retract')!;
    expect(retract).toBeDefined();
    expect((retract.payload as { reason: string }).reason).toBe('Fel tidpunkt');
    expect(retract.parentIds).toEqual([put.id]);
  });
});
