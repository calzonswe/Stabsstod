// Function home selector tests — plan.md §10 / M33.
//
// Pure selector functions tested from fixtures. No React, no network.

import { describe, expect, it } from 'vitest';
import { hlcInitialState } from './hlc.js';
import { EntityType, newRecord, type RecordEnvelope } from './record.js';
import {
  SHIFT_SOON_WINDOW_MS,
  selectMyShift,
  selectMyTasks,
  selectNeedsAttention,
  selectUpcomingBriefing,
  type HomeIdentity,
} from './functionHome.js';

let hlcState = hlcInitialState();

let entitySeq = 0;

function makeRecord(opts: {
  entityType: EntityType;
  payload: unknown;
  kind?: 'put' | 'retract';
  functionId?: string | null;
  entityId?: string;
  createdAtClient?: string;
}): RecordEnvelope {
  entitySeq += 1;
  const { record, state: nextState } = newRecord({
    entityId: opts.entityId ?? `entity-${entitySeq}`,
    entityType: opts.entityType,
    incidentId: 'incident-1',
    parentIds: [],
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
const at = (minFromNow: number) => new Date(NOW + minFromNow * 60_000).toISOString();

const ME: HomeIdentity = { userId: 'user-me', functionIds: ['fn-1', 'fn-2'] };

const taskPayload = (
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  title: 'Uppgift',
  description: '',
  assigneeFunctionId: 'fn-1',
  assigneeUserId: 'user-me',
  due: null,
  priority: 'normal',
  status: 'todo',
  reportForm: 'oral',
  ...overrides,
});

describe('function home selectors (M33)', () => {
  describe('selectMyTasks', () => {
    it('returns only my non-terminal tasks, sorted by due (none last), with overdue flag', () => {
      const records = [
        makeRecord({ entityType: EntityType.task, entityId: 't-late', payload: taskPayload({ title: 'B' }) }),
        makeRecord({
          entityType: EntityType.task,
          entityId: 't-overdue',
          payload: taskPayload({ title: 'A', due: at(-60) }),
        }),
        makeRecord({
          entityType: EntityType.task,
          entityId: 't-soon',
          payload: taskPayload({ title: 'C', due: at(30) }),
        }),
        // Someone else's task.
        makeRecord({
          entityType: EntityType.task,
          entityId: 't-other',
          payload: taskPayload({ title: 'D', assigneeUserId: 'user-other' }),
        }),
        // Terminal task of mine.
        makeRecord({
          entityType: EntityType.task,
          entityId: 't-done',
          payload: taskPayload({ title: 'E', status: 'done', due: at(-120) }),
        }),
      ];
      const tasks = selectMyTasks(records, ME, NOW);
      expect(tasks.map((t) => t.entityId)).toEqual(['t-overdue', 't-soon', 't-late']);
      expect(tasks[0].overdue).toBe(true);
      expect(tasks[1].overdue).toBe(false);
      expect(tasks[2].overdue).toBe(false);
    });

    it('returns empty when I have no tasks', () => {
      expect(selectMyTasks([], ME, NOW)).toEqual([]);
    });
  });

  describe('selectUpcomingBriefing', () => {
    const briefing = (entityId: string, scheduledAt: string, status: string) =>
      makeRecord({
        entityType: EntityType.briefing,
        entityId,
        payload: {
          title: `Brief ${entityId}`,
          scheduledAt,
          kind: 'recurring',
          agenda: [],
          status,
        },
      });

    it('returns empty when no briefing is upcoming', () => {
      const w = selectUpcomingBriefing([], ME, NOW);
      expect(w.hasBriefing).toBe(false);
      expect(w.missingReports).toEqual([]);
    });

    it('picks the soonest planned occurrence and lists my missing reports', () => {
      const records = [
        briefing('brief-later', at(120), 'planned'),
        briefing('brief-soon', at(30), 'planned'),
        // A held briefing must not count.
        briefing('brief-held', at(10), 'held'),
        // Report for fn-1 only → fn-2 still missing.
        makeRecord({
          entityType: EntityType.briefingReport,
          entityId: 'report-1',
          functionId: 'fn-1',
          payload: { briefingId: 'brief-soon', done: '', planned: '', challenges: '', collaborationNeeds: '' },
        }),
        // A report for another briefing must not count.
        makeRecord({
          entityType: EntityType.briefingReport,
          entityId: 'report-2',
          functionId: 'fn-2',
          payload: { briefingId: 'brief-later', done: '', planned: '', challenges: '', collaborationNeeds: '' },
        }),
      ];
      const w = selectUpcomingBriefing(records, ME, NOW);
      expect(w.hasBriefing).toBe(true);
      expect(w.briefingId).toBe('brief-soon');
      expect(w.title).toBe('Brief brief-soon');
      expect(w.inMs).toBe(30 * 60_000);
      expect(w.missingReports).toEqual(['fn-2']);
    });

    it('respects recurrence: the next occurrence, not the original time', () => {
      const records = [
        makeRecord({
          entityType: EntityType.briefing,
          entityId: 'brief-rec',
          payload: {
            title: 'Varje timme',
            scheduledAt: at(-90),
            kind: 'recurring',
            agenda: [],
            status: 'planned',
            recurrence: { intervalHours: 1, maxCount: 6 },
          },
        }),
      ];
      const w = selectUpcomingBriefing(records, ME, NOW);
      // Occurrences: -90, -30, +30, +90, +150, +210 → next is +30 min.
      expect(w.hasBriefing).toBe(true);
      expect(w.inMs).toBe(30 * 60_000);
      expect(w.missingReports).toEqual(['fn-1', 'fn-2']);
    });

    it('a retracted report makes the function missing again', () => {
      const records = [
        briefing('brief-soon', at(30), 'planned'),
        makeRecord({
          entityType: EntityType.briefingReport,
          entityId: 'report-1',
          functionId: 'fn-1',
          payload: { briefingId: 'brief-soon', done: '', planned: '', challenges: '', collaborationNeeds: '' },
        }),
        makeRecord({
          entityType: EntityType.briefingReport,
          entityId: 'report-1',
          functionId: 'fn-1',
          kind: 'retract',
          payload: { reason: 'rewrite' },
        }),
      ];
      const w = selectUpcomingBriefing(records, ME, NOW);
      expect(w.missingReports).toEqual(['fn-1', 'fn-2']);
    });
  });

  describe('selectMyShift', () => {
    const shift = (
      entityId: string,
      start: number,
      end: number,
      overrides: Partial<Record<string, unknown>> = {},
    ) =>
      makeRecord({
        entityType: EntityType.shift,
        entityId,
        payload: {
          functionId: 'fn-1',
          userId: 'user-me',
          role: 'staff_member',
          start: at(start),
          end: at(end),
          ...overrides,
        },
      });

    it('finds the current shift (covering now) and the next upcoming shift', () => {
      const records = [
        shift('shift-current', -60, 120),
        shift('shift-next', 120, 240),
        shift('shift-later', 300, 420),
        // Someone else's shift.
        shift('shift-other', -60, 120, { userId: 'user-other' }),
      ];
      const view = selectMyShift(records, ME, NOW);
      expect(view.current?.entityId).toBe('shift-current');
      expect(view.next?.entityId).toBe('shift-next');
    });

    it('is empty when I have no shifts', () => {
      const view = selectMyShift([], ME, NOW);
      expect(view.current).toBeNull();
      expect(view.next).toBeNull();
      expect(view.handoverNotes).toEqual([]);
    });

    it('collects handover notes addressed to me or tied to my shifts, newest first', () => {
      const records = [
        shift('shift-current', -60, 120),
        shift('shift-next', 120, 240),
        // Addressed to me.
        makeRecord({
          entityType: EntityType.handoverNote,
          entityId: 'note-mine',
          functionId: 'fn-1',
          createdAtClient: at(-20),
          payload: { fromUserId: 'user-prev', toUserId: 'user-me', text: 'Till mig' },
        }),
        // Tied to my current shift.
        makeRecord({
          entityType: EntityType.handoverNote,
          entityId: 'note-current',
          functionId: 'fn-1',
          createdAtClient: at(-40),
          payload: { shiftId: 'shift-current', fromUserId: 'user-prev', text: 'För aktuell' },
        }),
        // Tied to my next shift.
        makeRecord({
          entityType: EntityType.handoverNote,
          entityId: 'note-next',
          functionId: 'fn-1',
          createdAtClient: at(-5),
          payload: { shiftId: 'shift-next', fromUserId: 'user-prev', text: 'För nästa' },
        }),
        // Tied to someone else's shift only.
        makeRecord({
          entityType: EntityType.handoverNote,
          entityId: 'note-other',
          functionId: 'fn-1',
          createdAtClient: at(-1),
          payload: { shiftId: 'shift-other', fromUserId: 'user-x', text: 'Inte min' },
        }),
      ];
      const view = selectMyShift(records, ME, NOW);
      expect(view.handoverNotes.map((n) => n.text)).toEqual(['För nästa', 'Till mig', 'För aktuell']);
      expect(view.handoverNotes[0].fromUserId).toBe('user-prev');
      expect(view.handoverNotes[0].shiftId).toBe('shift-next');
    });
  });

  describe('selectNeedsAttention', () => {
    it('returns nothing when nothing needs attention', () => {
      expect(selectNeedsAttention([], ME, NOW)).toEqual([]);
    });

    it('collects all kinds in stable urgency order', () => {
      const records: RecordEnvelope[] = [
        // My overdue + blocked tasks.
        makeRecord({
          entityType: EntityType.task,
          entityId: 't-overdue',
          payload: taskPayload({ title: 'Sen', due: at(-60) }),
        }),
        makeRecord({
          entityType: EntityType.task,
          entityId: 't-blocked',
          payload: taskPayload({ title: 'Blockerad', status: 'blocked', due: at(60) }),
        }),
        // Open decision needed by my function.
        makeRecord({
          entityType: EntityType.decisionRequest,
          entityId: 'dr-1',
          payload: {
            question: 'Besluta om X?',
            options: [{ title: 'A', pros: ['p'], cons: ['c'] }],
            neededBy: 'fn-2',
            status: 'open',
          },
        }),
        // Upcoming briefing without my report.
        makeRecord({
          entityType: EntityType.briefing,
          entityId: 'brief-1',
          payload: {
            title: 'Dagsbrief',
            scheduledAt: at(45),
            kind: 'recurring',
            agenda: [],
            status: 'planned',
          },
        }),
        // My shift starts in 10 min.
        makeRecord({
          entityType: EntityType.shift,
          entityId: 'shift-soon',
          payload: {
            functionId: 'fn-1',
            userId: 'user-me',
            role: 'staff_member',
            start: at(10),
            end: at(250),
          },
        }),
      ];
      const items = selectNeedsAttention(records, ME, NOW);
      expect(items.map((i) => i.kind)).toEqual([
        'task_overdue',
        'task_blocked',
        'decision_needed',
        'briefing_report_pending',
        'shift_soon',
      ]);
      expect(items[0]).toEqual({ kind: 'task_overdue', id: 't-overdue', title: 'Sen', due: at(-60) });
      expect(items[4]).toMatchObject({ kind: 'shift_soon', id: 'shift-soon', inMs: 10 * 60_000 });
    });

    it('omits the shift item when my next shift starts outside the window', () => {
      const records = [
        makeRecord({
          entityType: EntityType.shift,
          entityId: 'shift-later',
          payload: {
            functionId: 'fn-1',
            userId: 'user-me',
            role: 'staff_member',
            start: at(Math.ceil(SHIFT_SOON_WINDOW_MS / 60_000) + 60),
            end: at(Math.ceil(SHIFT_SOON_WINDOW_MS / 60_000) + 120),
          },
        }),
      ];
      expect(selectNeedsAttention(records, ME, NOW)).toEqual([]);
    });

    it('omits decision requests that are decided or for another function', () => {
      const records = [
        makeRecord({
          entityType: EntityType.decisionRequest,
          entityId: 'dr-decided',
          payload: {
            question: 'Beslutat?',
            options: [{ title: 'A', pros: ['p'], cons: ['c'] }],
            neededBy: 'fn-1',
            status: 'decided',
          },
        }),
        makeRecord({
          entityType: EntityType.decisionRequest,
          entityId: 'dr-other',
          payload: {
            question: 'Andra funktionen?',
            options: [{ title: 'A', pros: ['p'], cons: ['c'] }],
            neededBy: 'fn-99',
            status: 'open',
          },
        }),
      ];
      expect(selectNeedsAttention(records, ME, NOW)).toEqual([]);
    });

    it('omits the briefing item when my report exists', () => {
      const records = [
        makeRecord({
          entityType: EntityType.briefing,
          entityId: 'brief-1',
          payload: {
            title: 'Dagsbrief',
            scheduledAt: at(45),
            kind: 'recurring',
            agenda: [],
            status: 'planned',
          },
        }),
        makeRecord({
          entityType: EntityType.briefingReport,
          entityId: 'report-1',
          functionId: 'fn-1',
          payload: { briefingId: 'brief-1', done: '', planned: '', challenges: '', collaborationNeeds: '' },
        }),
        makeRecord({
          entityType: EntityType.briefingReport,
          entityId: 'report-2',
          functionId: 'fn-2',
          payload: { briefingId: 'brief-1', done: '', planned: '', challenges: '', collaborationNeeds: '' },
        }),
      ];
      expect(selectNeedsAttention(records, ME, NOW)).toEqual([]);
    });
  });
});
