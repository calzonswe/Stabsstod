// Actors tests — M26
//
// Accept: staff member creates an actor → record carries the actor's own
// functionId. Relations add/remove and status changes are new versions.
// Filter by text + status. SVG actor map with nodes/edges. Retract with
// reason. Observer sees list/graph but no write UI.
//
// Seeding via newRecord + store.ingestRemoteRecords; Swedish assertions
// (default lng = sv).

import { describe, expect, it, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import Actors from './Actors.tsx';
import { LocalStore } from '../localStore.js';
import {
  ActorStatus,
  type Actor,
  type ActorPayload,
  newRecord,
} from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m26';
function actorFor(userId: string, role: Actor['role'], functionIds: string[]): Actor {
  return { userId, incidentId: INCIDENT, role, functionIds };
}

function component(actor: Actor | null, store: LocalStore) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Actors store={store} incidentId={INCIDENT} authorId={actor?.userId ?? ''} actor={actor} />
    </I18nextProvider>,
  );
}

async function seed(
  store: LocalStore,
  entityId: string,
  payload: Record<string, unknown>,
  functionId: string | null,
  opts: { authorId?: string; createdAtClient?: string } = {},
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType: 'actor',
    incidentId: INCIDENT,
    parentIds: [],
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

async function seedActor(
  store: LocalStore,
  entityId: string,
  name: string,
  status: ActorPayload['status'] = ActorStatus.involved,
  functionId: string | null = 'fn-1',
  opts: { authorId?: string; createdAtClient?: string } = {},
) {
  return seed(store, entityId, { name, type: 'Organisation', role: 'Ansvarig', contact: '070-000 00 00', status, relations: [] }, functionId, opts);
}

async function headOf(store: LocalStore, entityId: string) {
  const records = await store.getRecordsByEntity(entityId);
  return records.sort((a, b) => (a.createdAtClient ?? '').localeCompare(b.createdAtClient ?? ''))[records.length - 1];
}

describe('Actors (M26)', () => {
  afterEach(() => {
    cleanup();
  });

  it('staff member creates an actor with its own functionId', async () => {
    const store = new LocalStore({ userId: 'user-m26-0' });
    component(actorFor('user-1', 'staff_member', ['fn-1']), store);

    await waitFor(() =>
      expect(screen.getByTestId('actor-name')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId('actor-name'), { target: { value: 'Polisen' } });
    fireEvent.change(screen.getByTestId('actor-type'), { target: { value: 'Organisation' } });
    fireEvent.change(screen.getByTestId('actor-role'), { target: { value: 'Undersöker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    await waitFor(async () => {
      const records = await store.getRecordsByIncident(INCIDENT);
      const put = records.find((r) => r.entityType === 'actor' && r.kind === 'put');
      expect(put).toBeDefined();
      expect(put!.functionId).toBe('fn-1');
      expect(put!.parentIds).toEqual([]);
      const payload = put!.payload as ActorPayload;
      expect(payload.name).toBe('Polisen');
      expect(payload.type).toBe('Organisation');
      expect(payload.role).toBe('Undersöker');
      expect(payload.status).toBe(ActorStatus.involved);
    });
  });

  it('add relation = new version with merged payload and parentIds', async () => {
    const store = new LocalStore({ userId: 'user-m26-1' });
    await seedActor(store, 'actor-a', 'Polisen', ActorStatus.involved, 'fn-1', { authorId: 'user-1' });
    await seedActor(store, 'actor-b', 'Brandkåren', ActorStatus.involved, 'fn-1', { authorId: 'user-1' });
    component(actorFor('user-1', 'staff_member', ['fn-1']), store);

    await waitFor(() => expect(screen.getByTestId(`actor-card-actor-a`)).toBeInTheDocument());
    const target = within(screen.getByTestId(`actor-card-actor-a`)).getByTestId(`actor-relation-target-actor-a`);
    fireEvent.change(target, { target: { value: 'actor-b' } });
    const text = within(screen.getByTestId(`actor-card-actor-a`)).getByTestId(`actor-relation-text-actor-a`);
    fireEvent.change(text, { target: { value: 'samarbetar med' } });
    fireEvent.click(within(screen.getByTestId(`actor-card-actor-a`)).getByRole('button', { name: 'Lägg till relation' }));

    // One new version of A: relations merged, same entityId, parent = first head.
    await waitFor(async () => {
      const records = await store.getRecordsByEntity('actor-a');
      expect(records.length).toBe(2);
      const head = await headOf(store, 'actor-a');
      expect(head.parentIds.length).toBe(1);
      const payload = head.payload as ActorPayload;
      expect(payload.relations).toEqual([{ actorId: 'actor-b', relation: 'samarbetar med' }]);
    });
    // B untouched.
    expect((await store.getRecordsByEntity('actor-b')).length).toBe(1);
  });

  it('remove relation = new version with relations: []', async () => {
    const store = new LocalStore({ userId: 'user-m26-2' });
    await seedActor(store, 'actor-a', 'Polisen', ActorStatus.involved, 'fn-1', { authorId: 'user-1' });
    await seedActor(store, 'actor-b', 'Brandkåren', ActorStatus.involved, 'fn-1', { authorId: 'user-1' });
    component(actorFor('user-1', 'staff_member', ['fn-1']), store);

    await waitFor(() => expect(screen.getByTestId(`actor-card-actor-a`)).toBeInTheDocument());
    fireEvent.change(screen.getByTestId(`actor-relation-target-actor-a`), { target: { value: 'actor-b' } });
    fireEvent.change(screen.getByTestId(`actor-relation-text-actor-a`), { target: { value: 'samarbetar med' } });
    fireEvent.click(within(screen.getByTestId(`actor-card-actor-a`)).getByRole('button', { name: 'Lägg till relation' }));

    // Relation present after add.
    await waitFor(() =>
      expect(
        within(screen.getByTestId(`actor-card-actor-a`)).getByText(
          /samarbetar med/,
        ),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('actor-relation-remove-actor-b'));

    // Relation removed from the UI (refresh done) before checking the record.
    await waitFor(() =>
      expect(
        screen.queryByTestId('actor-relation-remove-actor-b'),
      ).toBeNull(),
    );

    await waitFor(async () => {
      const head = await headOf(store, 'actor-a');
      expect((head.payload as ActorPayload).relations).toEqual([]);
    });
  });

  it('set status = new version of the same actor (informed → involved)', async () => {
    const store = new LocalStore({ userId: 'user-m26-3' });
    await seedActor(store, 'actor-a', 'Polisen', ActorStatus.informed, 'fn-1', { authorId: 'user-1' });
    component(actorFor('user-1', 'staff_member', ['fn-1']), store);

    await waitFor(() => expect(screen.getByTestId(`actor-card-actor-a`)).toBeInTheDocument());
    const status = within(screen.getByTestId(`actor-card-actor-a`)).getByTestId(`actor-status-actor-a`);
    fireEvent.change(status, { target: { value: 'involved' } });

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('actor-a');
      expect(records.length).toBe(2);
      const head = await headOf(store, 'actor-a');
      expect((head.payload as ActorPayload).status).toBe(ActorStatus.involved);
    });
  });

  it('filters by text and status', async () => {
    const store = new LocalStore({ userId: 'user-m26-4' });
    await seedActor(store, 'actor-a', 'Polisen', ActorStatus.involved, 'fn-1', { authorId: 'user-1' });
    await seedActor(store, 'actor-b', 'Brandkåren', ActorStatus.informed, 'fn-1', { authorId: 'user-1' });
    await seedActor(store, 'actor-c', 'Sjukvården', ActorStatus.shouldBeInvolved, 'fn-1', { authorId: 'user-1' });
    component(actorFor('user-1', 'staff_member', ['fn-1']), store);

    await waitFor(() => expect(screen.getByTestId('actor-card-actor-a')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('actor-search'), { target: { value: 'polisen' } });
    expect(screen.queryByTestId('actor-card-actor-b')).toBeNull();
    expect(screen.queryByTestId('actor-card-actor-c')).toBeNull();

    fireEvent.change(screen.getByTestId('actor-search'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('actor-status-filter'), { target: { value: 'informed' } });
    expect(screen.queryByTestId('actor-card-actor-a')).toBeNull();
    expect(screen.queryByTestId('actor-card-actor-c')).toBeNull();
    expect(screen.getByTestId('actor-card-actor-b')).toBeInTheDocument();
  });

  it('actor graph: all actors as nodes, one edge per relation', async () => {
    const store = new LocalStore({ userId: 'user-m26-5' });
    await seedActor(store, 'actor-a', 'Polisen', ActorStatus.involved, 'fn-1', { authorId: 'user-1' });
    await seedActor(store, 'actor-b', 'Brandkåren', ActorStatus.informed, 'fn-1', { authorId: 'user-1' });
    await seedActor(store, 'actor-c', 'Sjukvården', ActorStatus.shouldBeInvolved, 'fn-1', { authorId: 'user-1' });
    // Add relation A → B.
    await seed(store, 'actor-a', {
      name: 'Polisen', type: 'Organisation', role: 'Ansvarig', contact: '', status: ActorStatus.involved,
      relations: [{ actorId: 'actor-b', relation: 'samarbetar med' }],
    }, 'fn-1', { authorId: 'user-1' });
    component(actorFor('user-1', 'staff_member', ['fn-1']), store);

    await waitFor(() => expect(screen.getByTestId('actor-graph')).toBeInTheDocument());
    expect(screen.getByTestId('actor-node-actor-a')).toBeInTheDocument();
    expect(screen.getByTestId('actor-node-actor-b')).toBeInTheDocument();
    expect(screen.getByTestId('actor-node-actor-c')).toBeInTheDocument();
    expect(screen.getByTestId('actor-edge-actor-a:actor-b')).toBeInTheDocument();
  });

  it('retract with reason = retract record with parentIds; row gone', async () => {
    const store = new LocalStore({ userId: 'user-m26-6' });
    const put = await seedActor(store, 'actor-a', 'Polisen', ActorStatus.involved, 'fn-1', { authorId: 'user-1' });
    component(actorFor('user-chief', 'chief_of_staff', []), store);

    const row = await screen.findByTestId('actor-card-actor-a');
    fireEvent.click(within(row).getByRole('button', { name: 'Ta bort' }));
    fireEvent.change(within(row).getByPlaceholderText('Anledning (obligatorisk)'), { target: { value: 'Felaktig post' } });
    const confirms = within(row).getAllByRole('button', { name: 'Ta bort' });
    fireEvent.click(confirms[confirms.length - 1]);

    await waitFor(() => expect(screen.queryByTestId('actor-card-actor-a')).toBeNull());

    const records = (await store.getRecordsByEntity('actor-a')).filter((r) => r.entityType === 'actor');
    expect(records.length).toBe(2);
    const retract = records.find((r) => r.kind === 'retract');
    expect(retract).toBeDefined();
    expect((retract!.payload as { reason: string }).reason).toBe('Felaktig post');
    expect(retract!.parentIds).toEqual([put.id]);
  });

  it('observer sees list and graph but no write UI', async () => {
    const store = new LocalStore({ userId: 'user-m26-7' });
    await seedActor(store, 'actor-a', 'Polisen', ActorStatus.involved, 'fn-1', { authorId: 'user-1' });
    component(actorFor('user-obs', 'observer', ['fn-1']), store);

    await waitFor(() => expect(screen.getByTestId('actor-card-actor-a')).toBeInTheDocument());
    expect(screen.getByTestId('actor-graph')).toBeInTheDocument();

    // No create form, no status select, no relation add, no retract.
    expect(screen.queryByRole('button', { name: 'Spara' })).toBeNull();
    expect(screen.queryByTestId('actor-status-actor-a')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lägg till relation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ta bort' })).toBeNull();
    expect(screen.queryByPlaceholderText('Anledning (obligatorisk)')).toBeNull();
  });
});
