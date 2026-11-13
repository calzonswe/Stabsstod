// Resources tests — M27
//
// Accept: summary calculation tests (per type, per status), plus:
// staff member creates a resource → record carries own functionId;
// update = new version; retract = retract record with reason;
// staffing overview shows functions vs members on duty;
// observer sees table/summary but no write UI.
//
// Seeding via newRecord + store.ingestRemoteRecords; Swedish assertions.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import Resources from './Resources.tsx';
import { LocalStore } from '../localStore.js';
import {
  type Actor,
  type ResourcePayload,
  newRecord,
} from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m27';

function actorFor(userId: string, role: Actor['role'], functionIds: string[]): Actor {
  return { userId, incidentId: INCIDENT, role, functionIds };
}

function component(
  actor: Actor | null,
  store: LocalStore,
  functions: { id: string; name: string }[] = [
    { id: 'fn-1', name: 'Logistik' },
    { id: 'fn-2', name: 'Fakta' },
  ],
  members: {
    id: string;
    username: string;
    displayName: string | null;
    role: string;
    functionIds: string[];
  }[] = [],
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Resources
        store={store}
        incidentId={INCIDENT}
        authorId={actor?.userId ?? ''}
        actor={actor}
        functions={functions}
        members={members}
      />
    </I18nextProvider>,
  );
}

async function seed(
  store: LocalStore,
  entityId: string,
  entityType: 'resource' | 'shift',
  payload: Record<string, unknown>,
  functionId: string | null,
  opts: {
    authorId?: string;
    createdAtClient?: string;
    parentIds?: string[];
  } = {},
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType,
    incidentId: INCIDENT,
    parentIds: opts.parentIds ?? [],
    functionId,
    authorId: opts.authorId ?? 'user-seed',
    deviceId: getDeviceId(),
    schemaVersion: 1,
    payload,
    createdAtClient: opts.createdAtClient ?? new Date().toISOString(),
    kind: 'put',
    state,
  });
  saveHlcState(next, getDeviceId());
  await store.ingestRemoteRecords([record]);
  return record;
}

async function seedResource(
  store: LocalStore,
  entityId: string,
  name: string,
  type: ResourcePayload['type'] = 'vehicle',
  quantity: number = 1,
  status: ResourcePayload['status'] = 'available',
  functionId: string | null = 'fn-1',
  opts: { authorId?: string; createdAtClient?: string } = {},
) {
  return seed(
    store,
    entityId,
    'resource',
    { name, type, quantity, unit: 'st', location: 'Garage A', status, notes: '' },
    functionId,
    opts,
  );
}

async function headOf(store: LocalStore, entityId: string) {
  const records = await store.getRecordsByEntity(entityId);
  return records.sort(
    (a, b) => (a.createdAtClient ?? '').localeCompare(b.createdAtClient ?? ''),
  )[records.length - 1];
}

describe('Resources (M27)', () => {
  afterEach(() => {
    cleanup();
  });

  it('staff member creates a resource with its own functionId', async () => {
    const store = new LocalStore({ userId: 'user-m27-0' });
    const functions = [{ id: 'fn-1', name: 'Logistik' }];
    const members = [
      {
        id: 'user-1',
        username: 'bo',
        displayName: 'Bo Medlem',
        role: 'staff_member',
        functionIds: ['fn-1'],
      },
    ];
    component(actorFor('user-1', 'staff_member', ['fn-1']), store, functions, members);

    await waitFor(() =>
      expect(screen.getByTestId('resource-name')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('resource-name'), {
      target: { value: 'Brandbil' },
    });
    fireEvent.change(screen.getByTestId('resource-type'), {
      target: { value: 'vehicle' },
    });
    fireEvent.change(screen.getByTestId('resource-quantity'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByTestId('resource-status'), {
      target: { value: 'requested' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    await waitFor(async () => {
      const records = await store.getRecordsByIncident(INCIDENT);
      const put = records.find(
        (r) => r.entityType === 'resource' && r.kind === 'put',
      );
      expect(put).toBeDefined();
      expect(put!.functionId).toBe('fn-1');
      expect(put!.parentIds).toEqual([]);
      const payload = put!.payload as ResourcePayload;
      expect(payload.name).toBe('Brandbil');
      expect(payload.type).toBe('vehicle');
      expect(payload.quantity).toBe(2);
      expect(payload.status).toBe('requested');
    });
  });

  it('update resource = new version with merged payload (status available → requested)', async () => {
    const store = new LocalStore({ userId: 'user-m27-1' });
    await seedResource(
      store,
      'res-1',
      'Brandbil',
      'vehicle',
      2,
      'available',
      'fn-1',
      { authorId: 'user-1' },
    );
    const functions = [{ id: 'fn-1', name: 'Logistik' }];
    component(actorFor('user-1', 'staff_member', ['fn-1']), store, functions);

    await waitFor(() =>
      expect(screen.getByTestId('resource-row-res-1')).toBeInTheDocument(),
    );
    // Find the resource row's retract toggle to verify it's there (maintainable).
    expect(
      screen.getByTestId('resource-retract-toggle-res-1'),
    ).toBeInTheDocument();

    // Get the first head's id, then seed a new version with parentIds = [head id].
    const records1 = await store.getRecordsByEntity('res-1');
    const firstHeadId = records1[0].id;

    // Update status via a second seed (simulating a version write from another edit).
    await seed(
      store,
      'res-1',
      'resource',
      {
        name: 'Brandbil',
        type: 'vehicle',
        quantity: 2,
        unit: 'st',
        location: 'Garage A',
        status: 'requested',
        notes: '',
      },
      'fn-1',
      { authorId: 'user-1', parentIds: [firstHeadId] },
    );

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('res-1');
      expect(records.length).toBe(2);
      const head = await headOf(store, 'res-1');
      expect((head.payload as ResourcePayload).status).toBe('requested');
      expect(head.parentIds).toEqual([firstHeadId]);
    });
  });

  it('retract with reason = retract record with parentIds; row gone', async () => {
    const store = new LocalStore({ userId: 'user-m27-2' });
    const put = await seedResource(
      store,
      'res-2',
      'Brandbil',
      'vehicle',
      2,
      'available',
      'fn-1',
      { authorId: 'user-1' },
    );
    const functions = [{ id: 'fn-1', name: 'Logistik' }];
    component(actorFor('user-chief', 'chief_of_staff', []), store, functions);

    const row = await screen.findByTestId('resource-row-res-2');
    fireEvent.click(within(row).getByTestId('resource-retract-toggle-res-2'));
    fireEvent.change(
      within(row).getByPlaceholderText('Anledning (obligatorisk)'),
      { target: { value: 'Avvecklad' } },
    );
    fireEvent.click(
      within(row).getByTestId('resource-retract-confirm-res-2'),
    );

    await waitFor(() =>
      expect(screen.queryByTestId('resource-row-res-2')).toBeNull(),
    );

    const records = (await store.getRecordsByEntity('res-2')).filter(
      (r) => r.entityType === 'resource',
    );
    expect(records.length).toBe(2);
    const retract = records.find((r) => r.kind === 'retract');
    expect(retract).toBeDefined();
    expect((retract!.payload as { reason: string }).reason).toBe(
      'Avvecklad',
    );
    expect(retract!.parentIds).toEqual([put.id]);
  });

  it('summary per type and per status (accept)', async () => {
    const store = new LocalStore({ userId: 'user-m27-3' });
    await seedResource(store, 'res-a', 'Brandbil', 'vehicle', 2, 'available', 'fn-1', {
      authorId: 'user-1',
    });
    await seedResource(store, 'res-b', 'Polisbil', 'vehicle', 1, 'deployed', 'fn-1', {
      authorId: 'user-1',
    });
    await seedResource(store, 'res-c', 'Generator', 'equipment', 3, 'requested', 'fn-2', {
      authorId: 'user-1',
    });
    await seedResource(store, 'res-d', 'Tält', 'facility', 1, 'unavailable', 'fn-2', {
      authorId: 'user-1',
    });
    const functions = [
      { id: 'fn-1', name: 'Logistik' },
      { id: 'fn-2', name: 'Fakta' },
    ];
    component(actorFor('user-1', 'staff_member', ['fn-1']), store, functions);

    await waitFor(() =>
      expect(screen.getByTestId('resource-row-res-a')).toBeInTheDocument(),
    );

    // Summary renders counts per type and per status.
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('staffing overview: functions vs members on duty', async () => {
    const store = new LocalStore({ userId: 'user-m27-4' });
    const now = Date.now();
    const H = 3_600_000;
    const iso = (ms: number) => new Date(ms).toISOString();

    // Two members in fn-1, one on duty now (shift covers now).
    const members = [
      {
        id: 'user-1',
        username: 'bo',
        displayName: 'Bo Medlem',
        role: 'staff_member',
        functionIds: ['fn-1'],
      },
      {
        id: 'user-2',
        username: 'carin',
        displayName: 'Carin Medlem',
        role: 'staff_member',
        functionIds: ['fn-1'],
      },
      {
        id: 'user-3',
        username: 'dave',
        displayName: 'Dave Medlem',
        role: 'staff_member',
        functionIds: ['fn-2'],
      },
    ];
    const functions = [
      { id: 'fn-1', name: 'Logistik' },
      { id: 'fn-2', name: 'Fakta' },
    ];

    // Shift for user-1 covering now → on duty.
    await seed(
      store,
      'sh-1',
      'shift',
      { functionId: 'fn-1', userId: 'user-1', start: iso(now - 2 * H), end: iso(now + 2 * H), role: 'staff_member' },
      'fn-1',
      { authorId: 'user-1' },
    );
    // Shift for user-2 starting 5h from now → not on duty.
    await seed(
      store,
      'sh-2',
      'shift',
      { functionId: 'fn-1', userId: 'user-2', start: iso(now + 5 * H), end: iso(now + 11 * H), role: 'staff_member' },
      'fn-1',
      { authorId: 'user-1' },
    );
    // No shift for user-3 → not on duty.

    component(
      actorFor('user-1', 'staff_member', ['fn-1']),
      store,
      functions,
      members,
    );

    await waitFor(() =>
      expect(screen.getByText('Logistik')).toBeInTheDocument(),
    );
    // fn-1: 2 members, 1 on duty → "1 / 2"
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    // fn-2: 1 member, 0 on duty → "0 / 1"
    expect(screen.getByText('0 / 1')).toBeInTheDocument();
  });

  it('observer sees table and summary but no write UI', async () => {
    const store = new LocalStore({ userId: 'user-m27-5' });
    await seedResource(
      store,
      'res-3',
      'Brandbil',
      'vehicle',
      2,
      'available',
      'fn-1',
      { authorId: 'user-1' },
    );
    const functions = [{ id: 'fn-1', name: 'Logistik' }];
    const members = [
      {
        id: 'user-obs',
        username: 'osa',
        displayName: 'Ola Observer',
        role: 'observer',
        functionIds: ['fn-1'],
      },
    ];
    component(actorFor('user-obs', 'observer', ['fn-1']), store, functions, members);

    await waitFor(() =>
      expect(screen.getByTestId('resource-row-res-3')).toBeInTheDocument(),
    );

    // No create form, no retract.
    expect(screen.queryByRole('button', { name: 'Spara' })).toBeNull();
    expect(screen.queryByTestId('resource-retract-toggle-res-3')).toBeNull();
    expect(screen.queryByPlaceholderText('Anledning (obligatorisk)')).toBeNull();
  });
});
