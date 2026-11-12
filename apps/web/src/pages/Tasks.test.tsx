// Tasks tests — M22
//
// Permission edge cases (observer no UI; staff_member may only propose for
// own function and cannot move; function_lead manages any function),
// overdue highlighting, subtask marker, stabsarbetsplan per-function view,
// status move = new version.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import Tasks from './Tasks.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, type Actor } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m22';
const FUNCTIONS = [
  { id: 'fn-1', name: 'Logistik' },
  { id: 'fn-2', name: 'Fakta' },
];

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
      <Tasks
        store={store}
        incidentId={INCIDENT}
        authorId="user-1"
        actor={actor}
        functions={FUNCTIONS}
      />
    </I18nextProvider>,
  );
}

async function seedTask(
  store: LocalStore,
  entityId: string,
  payload: Record<string, unknown>,
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType: 'task',
    incidentId: INCIDENT,
    parentIds: [],
    functionId: (payload.assigneeFunctionId as string) ?? null,
    authorId: 'user-lead',
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

const taskPayload = {
  title: 'Beställ vattenprover',
  description: 'Ta prover från brunn 2.',
  assigneeFunctionId: 'fn-1',
  priority: 'normal' as const,
  status: 'todo' as const,
  reportForm: 'none' as const,
};

describe('Tasks (M22)', () => {
  afterEach(() => {
    cleanup();
  });

  it('observer sees the board but no create button and no enabled moves', async () => {
    const store = new LocalStore({ userId: 'user-m22-0' });
    await seedTask(store, 'task-0', taskPayload);
    component(actorFor('observer'), store);

    await waitFor(() => {
      expect(screen.getByText('Beställ vattenprover')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Ny uppgift' })).toBeNull();
    const selects = screen.getAllByRole('combobox');
    // First combobox is the function filter; the rest are status selects.
    for (const s of selects.slice(1)) {
      expect((s as HTMLSelectElement).disabled).toBe(true);
    }
  });

  it('staff_member may create proposed tasks for own function but cannot move', async () => {
    const store = new LocalStore({ userId: 'user-m22-1' });
    await seedTask(store, 'task-1', taskPayload);
    component(actorFor('staff_member'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ny uppgift' })).toBeInTheDocument();
    });
    const selects = screen.getAllByRole('combobox');
    for (const s of selects.slice(1)) {
      expect((s as HTMLSelectElement).disabled).toBe(true);
    }
  });

  it('function_lead may move any function\'s tasks', async () => {
    const store = new LocalStore({ userId: 'user-m22-2' });
    await seedTask(store, 'task-2', {
      ...taskPayload,
      title: 'Uppdater lägesbild',
      assigneeFunctionId: 'fn-2',
    });
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByText('Uppdater lägesbild')).toBeInTheDocument();
    });
    const selects = screen.getAllByRole('combobox');
    expect((selects[selects.length - 1] as HTMLSelectElement).disabled).toBe(false);
  });

  it('creating a task via the form writes a proposed task record for the own function', async () => {
    const store = new LocalStore({ userId: 'user-m22-3' });
    component(actorFor('staff_member'), store);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ny uppgift' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ny uppgift' }));
    fireEvent.change(screen.getByPlaceholderText('Vad ska göras?'), {
      target: { value: 'Boka labb för prover' },
    });
    // staff_member: status forced to 'proposed' (plan.md §7).
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    await waitFor(async () => {
      const all = await store.getRecordsByIncident(INCIDENT);
      const task = all.find((r) => r.entityType === 'task');
      expect(task).toBeDefined();
      const p = task!.payload as {
        title: string;
        status: string;
        assigneeFunctionId: string;
        priority: string;
        reportForm: string;
      };
      expect(p.title).toBe('Boka labb för prover');
      expect(p.status).toBe('proposed');
      expect(p.assigneeFunctionId).toBe('fn-1');
      expect(p.priority).toBe('normal');
      expect(p.reportForm).toBe('none');
    });
  });

  it('moving a task writes a new version with the new status', async () => {
    const store = new LocalStore({ userId: 'user-m22-4' });
    const first = await seedTask(store, 'task-4', taskPayload);
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByText('Beställ vattenprover')).toBeInTheDocument();
    });
    const selects = screen.getAllByRole('combobox');
    const statusSelect = selects[selects.length - 1] as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'doing' } });

    await waitFor(async () => {
      const records = await store.getRecordsByEntity('task-4');
      expect(records.length).toBe(2);
      const second = records.find((r) => r.id !== first.id)!;
      expect(second.parentIds).toContain(first.id);
      expect((second.payload as { status: string }).status).toBe('doing');
      // The payload otherwise carries over.
      expect((second.payload as { title: string }).title).toBe('Beställ vattenprover');
    });
  });

  it('overdue task is highlighted with the overdue marker', async () => {
    const store = new LocalStore({ userId: 'user-m22-5' });
    await seedTask(store, 'task-5', {
      ...taskPayload,
      title: 'Skicka in rapport',
      due: '2026-01-01T00:00:00Z',
    });
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByText('Skicka in rapport')).toBeInTheDocument();
    });
    expect(screen.getByText(/Förfallen/)).toBeInTheDocument();
  });

  it('per-function view is the stabsarbetsplan (assignee, deadline, report form)', async () => {
    const store = new LocalStore({ userId: 'user-m22-6' });
    await seedTask(store, 'task-6', {
      ...taskPayload,
      title: 'Verifiera brunnsvatten',
      assigneeFunctionId: 'fn-2',
      due: '2027-01-01T12:00:00Z',
      reportForm: 'oral',
    });
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByText('Verifiera brunnsvatten')).toBeInTheDocument();
    });

    const filter = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: 'fn-2' } });

    await waitFor(() => {
      expect(screen.getByText('Stabsarbetsplan')).toBeInTheDocument();
      expect(screen.getByText(/Muntlig/)).toBeInTheDocument();
    });
  });

  it('subtask shows a link to its parent task', async () => {
    const store = new LocalStore({ userId: 'user-m22-7' });
    await seedTask(store, 'task-7-parent', {
      ...taskPayload,
      title: 'Hämta prover',
    });
    await seedTask(store, 'task-7-child', {
      ...taskPayload,
      title: 'Boka labb',
      parentTaskId: 'task-7-parent',
    });
    component(actorFor('function_lead'), store);

    await waitFor(() => {
      expect(screen.getByText(/↳ Hämta prover · Boka labb/)).toBeInTheDocument();
    });
  });
});
