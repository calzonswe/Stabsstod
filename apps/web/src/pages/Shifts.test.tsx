// Shifts tests — M25
//
// Accept: pure warning functions (shared) plus the roster/warnings/
// on-duty/notes UI. Plus: chief schedules a shift (chief/deputy only),
// staff members see the roster without write UI but own-function note
// forms, handover notes are append-only records, newest note first, and
// retract is append-only with a reason.

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
import Shifts, { type MemberRef } from './Shifts.tsx';
import { LocalStore } from '../localStore.js';
import { newRecord, type Actor, type ShiftRole } from '@stabsstod/shared';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const INCIDENT = 'incident-m25';
const FUNCTIONS = [
  { id: 'fn-1', name: 'Logistik' },
  { id: 'fn-2', name: 'Fakta' },
];
const MEMBERS: MemberRef[] = [
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
    id: 'user-chief',
    username: 'anna',
    displayName: 'Anna Stabschef',
    role: 'chief_of_staff',
    functionIds: [],
  },
];

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function actorFor(
  userId: string,
  role: Actor['role'],
  functionIds: string[] = ['fn-1'],
): Actor {
  return { userId, incidentId: INCIDENT, role, functionIds };
}

function component(actor: Actor | null, store: LocalStore) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Shifts
        store={store}
        incidentId={INCIDENT}
        authorId={actor?.userId ?? ''}
        actor={actor}
        functions={FUNCTIONS}
        members={MEMBERS}
      />
    </I18nextProvider>,
  );
}

async function seed(
  store: LocalStore,
  entityId: string,
  entityType: 'shift' | 'handover_note',
  payload: Record<string, unknown>,
  functionId: string | null,
  opts: { authorId?: string; createdAtClient?: string } = {},
) {
  const state = loadHlcState();
  const { record, state: next } = newRecord({
    entityId,
    entityType,
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

async function seedShift(
  store: LocalStore,
  entityId: string,
  functionId: string,
  userId: string,
  start: string,
  end: string,
  role: ShiftRole = 'staff_member',
  opts: { authorId?: string; createdAtClient?: string } = {},
) {
  return seed(
    store,
    entityId,
    'shift',
    { functionId, userId, start, end, role },
    functionId,
    opts,
  );
}

describe('Shifts (M25)', () => {
  afterEach(() => {
    cleanup();
  });

  it('chief schedules a shift via the schedule form', async () => {
    const store = new LocalStore({ userId: 'user-m25-0' });
    component(actorFor('user-chief', 'chief_of_staff'), store);

    // The schedule form is visible for the chief.
    await waitFor(() => {
      expect(screen.getByText('Planera vakt')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('schedule-function'), {
      target: { value: 'fn-1' },
    });
    fireEvent.change(screen.getByTestId('schedule-user'), {
      target: { value: 'user-1' },
    });
    fireEvent.change(screen.getByTestId('schedule-role'), {
      target: { value: 'function_lead' },
    });
    fireEvent.change(screen.getByTestId('schedule-start'), {
      target: { value: '2027-01-01T08:00' },
    });
    fireEvent.change(screen.getByTestId('schedule-end'), {
      target: { value: '2027-01-01T16:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));

    // The record carries the function and the payload (TZ-safe compare).
    await waitFor(async () => {
      const records = await store.getRecordsByIncident(INCIDENT);
      const put = records.find(
        (r) => r.entityType === 'shift' && r.kind === 'put',
      );
      expect(put).toBeDefined();
      expect(put!.functionId).toBe('fn-1');
      const payload = put!.payload as {
        userId: string;
        role: string;
        start: string;
        end: string;
      };
      expect(payload.userId).toBe('user-1');
      expect(payload.role).toBe('function_lead');
      expect(Date.parse(payload.start)).toBe(Date.parse('2027-01-01T08:00'));
      expect(Date.parse(payload.end)).toBe(Date.parse('2027-01-01T16:00'));
    });
  });

  it('staff member sees the roster and own-function note form, no write UI', async () => {
    const store = new LocalStore({ userId: 'user-m25-1' });
    await seedShift(
      store,
      'sh-2',
      'fn-1',
      'user-1',
      '2027-01-01T08:00:00Z',
      '2027-01-01T16:00:00Z',
    );
    component(actorFor('user-1', 'staff_member'), store);

    // The roster shows the seeded shift…
    await waitFor(() => {
      expect(screen.getByTestId('shift-row-sh-2')).toBeInTheDocument();
    });
    // …no schedule form, no retract button…
    expect(screen.queryByText('Planera vakt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ta bort' })).toBeNull();
    // …but a note form for own function fn-1, none for fn-2.
    expect(screen.getByTestId('note-text-fn-1')).toBeInTheDocument();
    expect(screen.queryByTestId('note-text-fn-2')).toBeNull();
  });

  it('shows advisory warnings: shift over 8 h and overlap under 30 min', async () => {
    const store = new LocalStore({ userId: 'user-m25-2' });
    // 9 h shift + a second shift overlapping it by only 15 min.
    await seedShift(
      store,
      'sh-3a',
      'fn-1',
      'user-1',
      '2027-01-01T08:00:00Z',
      '2027-01-01T17:00:00Z',
    );
    await seedShift(
      store,
      'sh-3b',
      'fn-1',
      'user-2',
      '2027-01-01T16:45:00Z',
      '2027-01-02T00:45:00Z',
    );
    component(actorFor('user-chief', 'chief_of_staff'), store);

    await waitFor(() => {
      expect(screen.getByText('Varningar')).toBeInTheDocument();
    });
    expect(screen.getByText('Vakt över 8 timmar')).toBeInTheDocument();
    expect(screen.getByText('Överlapp under 30 min')).toBeInTheDocument();
  });

  it('on duty now lists exactly the shifts covering the current moment', async () => {
    const store = new LocalStore({ userId: 'user-m25-3' });
    const now = Date.now();
    // Covers now; the other shift starts 5 h from now.
    await seedShift(
      store,
      'sh-4a',
      'fn-1',
      'user-1',
      iso(now - 2 * H),
      iso(now + 2 * H),
    );
    await seedShift(
      store,
      'sh-4b',
      'fn-2',
      'user-2',
      iso(now + 5 * H),
      iso(now + 11 * H),
    );
    component(actorFor('user-chief', 'chief_of_staff'), store);

    const onDuty = await screen.findByTestId('on-duty-now');
    await waitFor(() => {
      expect(onDuty.textContent).toContain('Bo Medlem');
    });
    expect(onDuty.textContent).not.toContain('Carin Medlem');
  });

  it('staff member adds a handover note for own function', async () => {
    const store = new LocalStore({ userId: 'user-m25-4' });
    component(actorFor('user-1', 'staff_member'), store);

    const text = await screen.findByTestId('note-text-fn-1');
    fireEvent.change(text, { target: { value: 'Varning för provrörelser' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara notering' }));

    await waitFor(async () => {
      const records = await store.getRecordsByIncident(INCIDENT);
      const put = records.find(
        (r) => r.entityType === 'handover_note' && r.kind === 'put',
      );
      expect(put).toBeDefined();
      expect(put!.functionId).toBe('fn-1');
      expect(put!.parentIds).toEqual([]);
      const payload = put!.payload as { fromUserId: string; text: string };
      expect(payload.fromUserId).toBe('user-1');
      expect(payload.text).toBe('Varning för provrörelser');
    });
  });

  it('chief links a note to a shift and the incoming person (newest first)', async () => {
    const store = new LocalStore({ userId: 'user-m25-5' });
    const now = Date.now();
    // A shift in fn-1 to link the note to.
    await seedShift(
      store,
      'sh-6',
      'fn-1',
      'user-2',
      iso(now - 3 * H),
      iso(now + H),
    );
    // An older note, to assert newest-first ordering.
    await seed(
      store,
      'note-6-old',
      'handover_note',
      { fromUserId: 'user-1', text: 'Gamla notering' },
      'fn-1',
      { createdAtClient: iso(now - 5 * H) },
    );
    component(actorFor('user-chief', 'chief_of_staff'), store);

    const notes = await screen.findByTestId('notes-fn-1');
    fireEvent.change(within(notes).getByTestId('note-shift-fn-1'), {
      target: { value: 'sh-6' },
    });
    fireEvent.change(within(notes).getByTestId('note-to-fn-1'), {
      target: { value: 'user-1' },
    });
    fireEvent.change(within(notes).getByTestId('note-text-fn-1'), {
      target: { value: 'Nya notering' },
    });
    fireEvent.click(
      within(notes).getByRole('button', { name: 'Spara notering' }),
    );

    await waitFor(() => {
      expect(notes.textContent).toContain('Nya notering');
    });
    const newIdx = notes.textContent!.indexOf('Nya notering');
    const oldIdx = notes.textContent!.indexOf('Gamla notering');
    expect(newIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(oldIdx);

    const records = (await store.getRecordsByIncident(INCIDENT)).filter(
      (r) => r.entityType === 'handover_note' && r.kind === 'put',
    );
    expect(records.length).toBe(2);
    const put = records.find(
      (r) => (r.payload as { text: string }).text === 'Nya notering',
    );
    expect(put!.functionId).toBe('fn-1');
    expect(put!.payload).toEqual({
      shiftId: 'sh-6',
      fromUserId: 'user-chief',
      toUserId: 'user-1',
      text: 'Nya notering',
    });
  });

  it('chief retracts a shift with a reason (append-only)', async () => {
    const store = new LocalStore({ userId: 'user-m25-6' });
    const put = await seedShift(
      store,
      'sh-7',
      'fn-1',
      'user-1',
      '2027-01-01T08:00:00Z',
      '2027-01-01T16:00:00Z',
    );
    component(actorFor('user-chief', 'chief_of_staff'), store);

    const row = await screen.findByTestId('shift-row-sh-7');
    fireEvent.click(within(row).getByRole('button', { name: 'Ta bort' }));
    fireEvent.change(
      within(row).getByPlaceholderText('Anledning (obligatorisk)'),
      { target: { value: 'Fel planering' } },
    );
    // Two buttons named "Ta bort" (toggle + confirm); confirm is last.
    const confirmButtons = within(row).getAllByRole('button', { name: 'Ta bort' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId('shift-row-sh-7')).toBeNull();
    });

    const records = (await store.getRecordsByIncident(INCIDENT)).filter(
      (r) => r.entityId === 'sh-7',
    );
    expect(records.length).toBe(2);
    const retract = records.find((r) => r.kind === 'retract');
    expect(retract).toBeDefined();
    expect((retract!.payload as { reason: string }).reason).toBe(
      'Fel planering',
    );
    expect(retract!.parentIds).toEqual([put.id]);
  });

  it('observer sees the roster and notes but no write UI at all', async () => {
    const store = new LocalStore({ userId: 'user-m25-7' });
    await seedShift(
      store,
      'sh-8',
      'fn-1',
      'user-1',
      '2027-01-01T08:00:00Z',
      '2027-01-01T16:00:00Z',
    );
    await seed(
      store,
      'note-8',
      'handover_note',
      { fromUserId: 'user-1', text: 'Vidare i morgon' },
      'fn-1',
    );
    component(actorFor('user-obs', 'observer'), store);

    await waitFor(() => {
      expect(screen.getByTestId('shift-row-sh-8')).toBeInTheDocument();
    });
    expect(screen.getByText('Vidare i morgon')).toBeInTheDocument();

    // No schedule form, no note form, no retract anywhere.
    expect(screen.queryByText('Planera vakt')).toBeNull();
    expect(screen.queryByTestId('note-text-fn-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ta bort' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Spara notering' }),
    ).toBeNull();
  });
});
