// Notifications tests — plan.md §5.8 / M34
//
// Each rule from plan.md §5.8 tested with fixture records and a fake clock:
//   task_assigned, task_overdue, briefing_soon, shift_change,
//   decision_needed, conflict.

import { describe, expect, it } from 'vitest';
import { hlcInitialState } from './hlc.js';
import { EntityType, newRecord, type RecordEnvelope } from './record.js';
import { BRIEFING_SOON_WINDOW_MS, deriveNotifications } from './notifications.js';
import type { HomeIdentity } from './functionHome.js';

let hlcState = hlcInitialState();

function makeRecord(opts: {
  entityType: EntityType;
  payload: unknown;
  kind?: 'put' | 'retract';
  functionId?: string | null;
  entityId?: string;
  parentIds?: string[];
  createdAtClient?: string;
}): RecordEnvelope {
  const { record, state: nextState } = newRecord({
    entityId: opts.entityId ?? `entity-${Math.random().toString(36).slice(2)}`,
    entityType: opts.entityType,
    incidentId: 'incident-1',
    parentIds: opts.parentIds ?? [],
    functionId: opts.functionId ?? null,
    authorId: 'author-1',
    deviceId: 'device-1',
    createdAtClient: opts.createdAtClient ?? new Date().toISOString(),
    kind: opts.kind ?? 'put',
    schemaVersion: 1,
    payload: opts.payload,
    state: hlcState,
  });
  hlcState = nextState;
  return record;
}

const NOW = new Date('2026-11-14T12:00:00Z').getTime();
const inMin = (min: number) => new Date(NOW + min * 60_000).toISOString();
const ME: HomeIdentity = { userId: 'user-me', functionIds: ['fn-1', 'fn-2'] };

function taskPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: 'Uppgift',
    description: '',
    assigneeFunctionId: 'fn-1',
    assigneeUserId: 'user-me',
    due: inMin(60),
    priority: 'normal',
    status: 'todo',
    reportForm: 'none',
    ...overrides,
  };
}

function briefingPayload(scheduledAt: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: 'Dagsbrief',
    scheduledAt,
    kind: 'other',
    agenda: [],
    status: 'planned',
    ...overrides,
  };
}

function shiftPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    functionId: 'fn-1',
    userId: 'user-me',
    role: 'function_lead',
    start: inMin(-60),
    end: inMin(60),
    ...overrides,
  };
}

// Two heads sharing a common parent → conflict on the entity.
function conflictPair(
  entityId: string,
  functionId: string,
): RecordEnvelope[] {
  const base = makeRecord({
    entityType: EntityType.task,
    entityId,
    functionId,
    payload: taskPayload({ title: 'Botten' }),
  });
  const a = makeRecord({
    entityType: EntityType.task,
    entityId,
    functionId,
    parentIds: [base.id],
    payload: taskPayload({ title: 'Version A' }),
  });
  const b = makeRecord({
    entityType: EntityType.task,
    entityId,
    functionId,
    parentIds: [base.id],
    payload: taskPayload({ title: 'Version B' }),
  });
  return [base, a, b];
}

describe('deriveNotifications (M34)', () => {
  it('returns nothing for an empty record bag', () => {
    expect(deriveNotifications({ records: [], me: ME, now: NOW })).toEqual([]);
  });

  describe('task_assigned', () => {
    it('notifies for each non-terminal task assigned to me', () => {
      const records = [
        makeRecord({ entityType: EntityType.task, entityId: 'task-a', payload: taskPayload({ title: 'A' }) }),
        makeRecord({ entityType: EntityType.task, entityId: 'task-b', payload: taskPayload({ title: 'B' }) }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      const assigned = items.filter((i) => i.kind === 'task_assigned');
      expect(assigned.map((i) => i.id)).toEqual(['task_assigned:task-a', 'task_assigned:task-b']);
      expect(assigned.map((i) => i.subject)).toEqual(['A', 'B']);
    });

    it('ignores tasks assigned to someone else and terminal tasks', () => {
      const records = [
        makeRecord({
          entityType: EntityType.task,
          entityId: 'task-other',
          payload: taskPayload({ assigneeUserId: 'user-other' }),
        }),
        makeRecord({
          entityType: EntityType.task,
          entityId: 'task-done',
          payload: taskPayload({ status: 'done' }),
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'task_assigned')).toHaveLength(0);
      expect(items.filter((i) => i.kind === 'task_overdue')).toHaveLength(0);
    });
  });

  describe('task_overdue', () => {
    it('notifies when my task is past its due time', () => {
      const records = [
        makeRecord({
          entityType: EntityType.task,
          entityId: 'task-sen',
          payload: taskPayload({ title: 'Sen', due: inMin(-30) }),
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      const overdue = items.find((i) => i.kind === 'task_overdue');
      expect(overdue).toEqual({
        id: 'task_overdue:task-sen',
        kind: 'task_overdue',
        refId: 'task-sen',
        subject: 'Sen',
        at: inMin(-30),
      });
      // The task also still notifies as assigned.
      expect(items.map((i) => i.id)).toContain('task_assigned:task-sen');
    });

    it('does not notify when the due time is in the future', () => {
      const records = [
        makeRecord({
          entityType: EntityType.task,
          entityId: 'task-ok',
          payload: taskPayload({ due: inMin(30) }),
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'task_overdue')).toHaveLength(0);
    });
  });

  describe('briefing_soon', () => {
    it('notifies when the next occurrence starts within 10 min', () => {
      const records = [
        makeRecord({
          entityType: EntityType.briefing,
          entityId: 'brief-1',
          payload: briefingPayload(inMin(5)),
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'briefing_soon')).toEqual([
        {
          id: `briefing_soon:brief-1:${inMin(5)}`,
          kind: 'briefing_soon',
          refId: 'brief-1',
          subject: 'Dagsbrief',
          at: inMin(5),
        },
      ]);
    });

    it('does not notify outside the window, for cancelled briefings, or for past times', () => {
      const records = [
        makeRecord({
          entityType: EntityType.briefing,
          entityId: 'brief-later',
          payload: briefingPayload(inMin(BRIEFING_SOON_WINDOW_MS / 60_000 + 20)), // 30 min
        }),
        makeRecord({
          entityType: EntityType.briefing,
          entityId: 'brief-cancelled',
          payload: briefingPayload(inMin(5), { status: 'cancelled' }),
        }),
        makeRecord({
          entityType: EntityType.briefing,
          entityId: 'brief-past',
          payload: briefingPayload(inMin(-30)),
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'briefing_soon')).toHaveLength(0);
    });
  });

  describe('shift_change', () => {
    it('notifies when my next shift starts within 30 min', () => {
      const records = [
        makeRecord({
          entityType: EntityType.shift,
          entityId: 'shift-start',
          payload: shiftPayload({ start: inMin(10), end: inMin(190) }),
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'shift_change')).toEqual([
        {
          id: 'shift_change:shift-start:start',
          kind: 'shift_change',
          refId: 'shift-start',
          subject: '',
          at: inMin(10),
        },
      ]);
    });

    it('notifies when my current shift ends within 30 min', () => {
      const records = [
        makeRecord({
          entityType: EntityType.shift,
          entityId: 'shift-end',
          payload: shiftPayload({ start: inMin(-120), end: inMin(20) }),
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'shift_change')).toEqual([
        {
          id: 'shift_change:shift-end:end',
          kind: 'shift_change',
          refId: 'shift-end',
          subject: '',
          at: inMin(20),
        },
      ]);
    });

    it('does not notify outside the window, for other users, or for ended shifts', () => {
      const records = [
        makeRecord({
          entityType: EntityType.shift,
          entityId: 'shift-later',
          payload: shiftPayload({ start: inMin(60), end: inMin(300) }),
        }),
        makeRecord({
          entityType: EntityType.shift,
          entityId: 'shift-other',
          payload: shiftPayload({ userId: 'user-other', start: inMin(10), end: inMin(190) }),
        }),
        makeRecord({
          entityType: EntityType.shift,
          entityId: 'shift-past',
          payload: shiftPayload({ start: inMin(-300), end: inMin(-290) }),
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'shift_change')).toHaveLength(0);
    });
  });

  describe('decision_needed', () => {
    it('notifies for an open request my function is needed for', () => {
      const records = [
        makeRecord({
          entityType: EntityType.decisionRequest,
          entityId: 'decision-1',
          payload: {
            question: 'Beslut om förstärkning?',
            options: [{ title: 'Ja', pros: ['p'], cons: ['c'] }],
            neededBy: 'fn-1',
            status: 'open',
          },
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'decision_needed')).toEqual([
        {
          id: 'decision_needed:decision-1',
          kind: 'decision_needed',
          refId: 'decision-1',
          subject: 'Beslut om förstärkning?',
          at: null,
        },
      ]);
    });

    it('ignores decided requests and requests for other functions', () => {
      const records = [
        makeRecord({
          entityType: EntityType.decisionRequest,
          entityId: 'decision-decided',
          payload: {
            question: 'Besluten',
            options: [{ title: 'Ja', pros: ['p'], cons: ['c'] }],
            neededBy: 'fn-1',
            status: 'decided',
          },
        }),
        makeRecord({
          entityType: EntityType.decisionRequest,
          entityId: 'decision-other',
          payload: {
            question: 'Annans fråga',
            options: [{ title: 'Ja', pros: ['p'], cons: ['c'] }],
            neededBy: 'fn-9',
            status: 'open',
          },
        }),
      ];
      const items = deriveNotifications({ records, me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'decision_needed')).toHaveLength(0);
    });
  });

  describe('conflict', () => {
    it('notifies on a conflict in my function and not on others\' functions', () => {
      const mine = conflictPair('task-conf-mine', 'fn-1');
      const others = conflictPair('task-conf-other', 'fn-9');
      const items = deriveNotifications({ records: [...mine, ...others], me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'conflict')).toEqual([
        {
          id: 'conflict:task-conf-mine',
          kind: 'conflict',
          refId: 'task-conf-mine',
          subject: 'task',
          at: null,
        },
      ]);
    });

    it('does not notify on a clean (non-conflicting) entity chain', () => {
      const base = makeRecord({
        entityType: EntityType.task,
        entityId: 'task-clean',
        functionId: 'fn-1',
        payload: taskPayload({ title: 'Botten' }),
      });
      const child = makeRecord({
        entityType: EntityType.task,
        entityId: 'task-clean',
        functionId: 'fn-1',
        parentIds: [base.id],
        payload: taskPayload({ title: 'Uppdaterad' }),
      });
      const items = deriveNotifications({ records: [base, child], me: ME, now: NOW });
      expect(items.filter((i) => i.kind === 'conflict')).toHaveLength(0);
    });
  });

  describe('ordering and stability', () => {
    it('orders by fixed kind order, then time, then id — stable across input order', () => {
      const myTaskOverdue = makeRecord({
        entityType: EntityType.task,
        entityId: 't-overdue',
        payload: taskPayload({ title: 'Sen', due: inMin(-30) }),
      });
      const myTaskOpen = makeRecord({
        entityType: EntityType.task,
        entityId: 't-open',
        payload: taskPayload({ title: 'Öppen' }),
      });
      const conflict = conflictPair('c-1', 'fn-1');
      const decision = makeRecord({
        entityType: EntityType.decisionRequest,
        entityId: 'd-1',
        payload: {
          question: 'Beslut?',
          options: [{ title: 'Ja', pros: ['p'], cons: ['c'] }],
          neededBy: 'fn-2',
          status: 'open',
        },
      });
      const briefing = makeRecord({
        entityType: EntityType.briefing,
        entityId: 'b-1',
        payload: briefingPayload(inMin(5)),
      });
      const shift = makeRecord({
        entityType: EntityType.shift,
        entityId: 's-1',
        payload: shiftPayload({ start: inMin(10), end: inMin(190) }),
      });

      // The conflict pair's current record is also my task (entity c-1).
      const records = [myTaskOverdue, myTaskOpen, ...conflict, decision, briefing, shift];
      const a = deriveNotifications({ records, me: ME, now: NOW });
      const b = deriveNotifications({ records: [...records].reverse(), me: ME, now: NOW });
      expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
      expect(a.map((i) => i.id)).toEqual([
        'task_overdue:t-overdue',
        'conflict:c-1',
        'task_assigned:t-overdue',
        // Both due in +60 min: tie broken by id ('c-1' < 't-open').
        'task_assigned:c-1',
        'task_assigned:t-open',
        'decision_needed:d-1',
        `briefing_soon:b-1:${inMin(5)}`,
        'shift_change:s-1:start',
      ]);
    });
  });
});
