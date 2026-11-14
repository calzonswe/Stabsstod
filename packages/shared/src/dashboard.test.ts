// Dashboard selector tests — plan.md §5 / M32.
//
// Pure selector functions tested from fixtures. No React, no network.

import { describe, expect, it } from 'vitest';
import { hlcInitialState } from './hlc.js';
import { EntityType, newRecord, type RecordEnvelope } from './record.js';
import {
  selectMission,
  selectDirection,
  selectElapsedTime,
  selectNextBriefing,
  selectShiftChanges,
  selectFunctionStatusBoard,
  selectRecentLogEntries,
  selectFactCounts,
  selectDecisionsWaiting,
  selectOverdueTasks,
  selectTimeScaleStrip,
  selectMiniMapFeatures,
  selectSyncHealth,
  selectConflictCount,
  formatHms,
} from './dashboard.js';

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

describe('dashboard selectors (M32)', () => {
  describe('selectMission', () => {
    it('returns empty widget when no mission', () => {
      const w = selectMission([]);
      expect(w.hasMission).toBe(false);
      expect(w.content).toBeNull();
    });

    it('returns current mission payload', () => {
      const r = makeRecord({
        entityType: EntityType.mission,
        payload: {
          content: 'Rädda liv',
          staffShouldDo: 'Evakuera',
          staffShouldNotDo: 'Springa',
          deadline: '2026-11-15T08:00:00Z',
          issuedBy: 'user-dm-1',
          acknowledgedByChief: { userId: 'user-cs-1', at: '2026-11-14T09:00:00Z' },
        },
      });
      const w = selectMission([r]);
      expect(w.hasMission).toBe(true);
      expect(w.content).toBe('Rädda liv');
      expect(w.staffShouldDo).toBe('Evakuera');
      expect(w.staffShouldNotDo).toBe('Springa');
      expect(w.deadline).toBe('2026-11-15T08:00:00Z');
      expect(w.issuedBy).toBe('user-dm-1');
      expect(w.acknowledgedByChief).toEqual({ userId: 'user-cs-1', at: '2026-11-14T09:00:00Z' });
    });

    it('ignores retracted mission', () => {
      const r = makeRecord({
        entityType: EntityType.mission,
        kind: 'retract',
        payload: { reason: 'replaced' },
      });
      const w = selectMission([r]);
      expect(w.hasMission).toBe(false);
    });
  });

  describe('selectDirection', () => {
    it('returns empty widget when no direction', () => {
      const w = selectDirection([]);
      expect(w.hasDirection).toBe(false);
      expect(w.diverged).toBe(false);
    });

    it('reports diverged when actual differs from desired', () => {
      const r = makeRecord({
        entityType: EntityType.direction,
        payload: {
          desired: 'Håll avstånd',
          actual: 'Avstånd ej upprätthållet',
          divergenceNote: 'Personal trängs',
          validFrom: '2026-11-14T08:00:00Z',
        },
      });
      const w = selectDirection([r]);
      expect(w.hasDirection).toBe(true);
      expect(w.diverged).toBe(true);
      expect(w.desired).toBe('Håll avstånd');
      expect(w.actual).toBe('Avstånd ej upprätthållet');
    });

    it('reports not diverged when actual equals desired', () => {
      const r = makeRecord({
        entityType: EntityType.direction,
        payload: {
          desired: 'Håll avstånd',
          actual: 'Håll avstånd',
          validFrom: '2026-11-14T08:00:00Z',
        },
      });
      const w = selectDirection([r]);
      expect(w.diverged).toBe(false);
    });

    it('reports not diverged when actual is missing', () => {
      const r = makeRecord({
        entityType: EntityType.direction,
        payload: { desired: 'Håll avstånd', validFrom: '2026-11-14T08:00:00Z' },
      });
      const w = selectDirection([r]);
      expect(w.diverged).toBe(false);
    });
  });

  describe('selectElapsedTime', () => {
    it('returns null when no start time', () => {
      expect(selectElapsedTime(null, NOW)).toBeNull();
    });

    it('formats elapsed hh:mm:ss', () => {
      const startedAt = new Date(NOW - 3_661_000).toISOString(); // 1h 1m 1s ago
      expect(selectElapsedTime(startedAt, NOW)).toBe('01:01:01');
    });

    it('handles future start (negative)', () => {
      const startedAt = new Date(NOW + 1000).toISOString();
      expect(selectElapsedTime(startedAt, NOW)).toBe('-00:00:01');
    });
  });

  describe('selectNextBriefing', () => {
    it('returns empty when no briefings', () => {
      const w = selectNextBriefing([], NOW);
      expect(w.hasBriefing).toBe(false);
    });

    it('returns the next upcoming briefing', () => {
      const r1 = makeRecord({
        entityType: EntityType.briefing,
        payload: {
          title: 'Senare',
          scheduledAt: new Date(NOW + 2 * 3600 * 1000).toISOString(),
          kind: 'first_briefing',
          status: 'planned',
        },
      });
      const r2 = makeRecord({
        entityType: EntityType.briefing,
        payload: {
          title: 'Tidigare',
          scheduledAt: new Date(NOW + 3600 * 1000).toISOString(),
          kind: 'recurring',
          status: 'planned',
        },
      });
      const w = selectNextBriefing([r1, r2], NOW);
      expect(w.hasBriefing).toBe(true);
      expect(w.title).toBe('Tidigare');
      expect(w.inMs).toBe(3600 * 1000);
    });

    it('ignores briefings in the past', () => {
      const r = makeRecord({
        entityType: EntityType.briefing,
        payload: {
          title: 'Gammal',
          scheduledAt: new Date(NOW - 3600 * 1000).toISOString(),
          kind: 'first_briefing',
          status: 'held',
        },
      });
      const w = selectNextBriefing([r], NOW);
      expect(w.hasBriefing).toBe(false);
    });
  });

  describe('selectShiftChanges', () => {
    it('returns shifts starting/ending within the window', () => {
      const start = new Date(NOW + 3600 * 1000).toISOString(); // +1h
      const end = new Date(NOW + 5 * 3600 * 1000).toISOString(); // +5h
      const r = makeRecord({
        entityType: EntityType.shift,
        payload: {
          functionId: 'fn-1',
          userId: 'user-1',
          role: 'function_lead',
          start,
          end,
        },
      });
      const changes = selectShiftChanges([r], NOW, 4 * 3600 * 1000); // 4h window
      // start at +1h (in window), end at +5h (outside 4h window)
      expect(changes.length).toBe(1);
      expect(changes[0].kind).toBe('start');
      expect(changes[0].functionId).toBe('fn-1');
    });

    it('is empty when no shifts in window', () => {
      const start = new Date(NOW + 10 * 3600 * 1000).toISOString(); // +10h
      const end = new Date(NOW + 12 * 3600 * 1000).toISOString(); // +12h
      const r = makeRecord({
        entityType: EntityType.shift,
        payload: { functionId: 'fn-1', userId: 'user-1', role: 'staff_member', start, end },
      });
      expect(selectShiftChanges([r], NOW, 4 * 3600 * 1000)).toEqual([]);
    });
  });

  describe('selectFunctionStatusBoard', () => {
    it('returns green for a function with no tasks and a lead on duty', () => {
      const now = NOW;
      const start = new Date(now - 3600 * 1000).toISOString();
      const end = new Date(now + 3600 * 1000).toISOString();
      const shift = makeRecord({
        entityType: EntityType.shift,
        payload: { functionId: 'fn-1', userId: 'user-lead', role: 'function_lead', start, end },
      });
      const board = selectFunctionStatusBoard({
        functions: [{ id: 'fn-1', name: 'Ledning' }],
        members: [{ userId: 'user-lead', userName: 'Lead Person', functionIds: ['fn-1'] }],
        taskRecords: [],
        shiftRecords: [shift],
        briefingReportRecords: [],
        now,
      });
      expect(board.length).toBe(1);
      expect(board[0].functionName).toBe('Ledning');
      expect(board[0].leadOnDuty?.userId).toBe('user-lead');
      expect(board[0].openTasks).toBe(0);
      expect(board[0].overdueTasks).toBe(0);
      expect(board[0].rag).toBe('green');
    });

    it('sets lastUpdate from the newest record attributed to the function', () => {
      const now = NOW;
      const start = new Date(now - 3600 * 1000).toISOString();
      const end = new Date(now + 3600 * 1000).toISOString();
      const shift = makeRecord({
        entityType: EntityType.shift,
        functionId: 'fn-1',
        createdAtClient: '2026-11-14T10:00:00Z',
        payload: { functionId: 'fn-1', userId: 'user-lead', role: 'function_lead', start, end },
      });
      const report = makeRecord({
        entityType: EntityType.briefingReport,
        functionId: 'fn-1',
        createdAtClient: '2026-11-14T11:00:00Z',
        payload: { briefingId: 'b1', done: 'x', planned: 'y', challenges: '', collaborationNeeds: '' },
      });
      const board = selectFunctionStatusBoard({
        functions: [{ id: 'fn-1', name: 'Ledning' }],
        members: [],
        taskRecords: [],
        shiftRecords: [shift],
        briefingReportRecords: [report],
        now,
      });
      expect(board[0].lastUpdate).toBe('2026-11-14T11:00:00Z');
    });

    it('picks the latest challenge by creation time (empty keeps previous)', () => {
      const now = NOW;
      const r10 = makeRecord({
        entityType: EntityType.briefingReport,
        functionId: 'fn-1',
        createdAtClient: '2026-11-14T10:00:00Z',
        payload: { briefingId: 'b1', done: '', planned: '', challenges: 'Gammal utmaning', collaborationNeeds: '' },
      });
      const r11 = makeRecord({
        entityType: EntityType.briefingReport,
        functionId: 'fn-1',
        createdAtClient: '2026-11-14T11:00:00Z',
        payload: { briefingId: 'b2', done: '', planned: '', challenges: '', collaborationNeeds: '' },
      });
      const r12 = makeRecord({
        entityType: EntityType.briefingReport,
        functionId: 'fn-1',
        createdAtClient: '2026-11-14T12:00:00Z',
        payload: { briefingId: 'b3', done: '', planned: '', challenges: 'Ny utmaning', collaborationNeeds: '' },
      });
      const run = (reports: RecordEnvelope[]) =>
        selectFunctionStatusBoard({
          functions: [{ id: 'fn-1', name: 'Ledning' }],
          members: [],
          taskRecords: [],
          shiftRecords: [],
          briefingReportRecords: reports,
          now,
        });
      // Newest non-empty challenge wins, regardless of store order.
      expect(run([r11, r10, r12])[0].latestChallenge).toBe('Ny utmaning');
      // An empty challenges field keeps the previous challenge.
      expect(run([r11, r10])[0].latestChallenge).toBe('Gammal utmaning');
    });

    it('returns red when overdue task exists', () => {
      const now = NOW;
      const duePast = new Date(now - 3600 * 1000).toISOString();
      const task = makeRecord({
        entityType: EntityType.task,
        payload: {
          title: 'Överförd',
          description: '',
          assigneeFunctionId: 'fn-1',
          assigneeUserId: null,
          due: duePast,
          priority: 'normal',
          status: 'todo',
          reportForm: 'none',
        },
      });
      const board = selectFunctionStatusBoard({
        functions: [{ id: 'fn-1', name: 'Ledning' }],
        members: [],
        taskRecords: [task],
        shiftRecords: [],
        briefingReportRecords: [],
        now,
      });
      expect(board[0].overdueTasks).toBe(1);
      expect(board[0].rag).toBe('red');
    });

    it('returns amber when open (non-overdue) tasks exist', () => {
      const now = NOW;
      const dueFuture = new Date(now + 86400 * 1000).toISOString();
      const task = makeRecord({
        entityType: EntityType.task,
        payload: {
          title: 'Öppen',
          description: '',
          assigneeFunctionId: 'fn-1',
          assigneeUserId: null,
          due: dueFuture,
          priority: 'normal',
          status: 'todo',
          reportForm: 'none',
        },
      });
      const board = selectFunctionStatusBoard({
        functions: [{ id: 'fn-1', name: 'Ledning' }],
        members: [{ userId: 'user-lead', userName: 'Lead Person', functionIds: ['fn-1'] }],
        taskRecords: [task],
        shiftRecords: [
          makeRecord({
            entityType: EntityType.shift,
            payload: {
              functionId: 'fn-1',
              userId: 'user-lead',
              role: 'function_lead',
              start: new Date(now - 3600 * 1000).toISOString(),
              end: new Date(now + 3600 * 1000).toISOString(),
            },
          }),
        ],
        briefingReportRecords: [],
        now,
      });
      expect(board[0].openTasks).toBe(1);
      expect(board[0].overdueTasks).toBe(0);
      expect(board[0].rag).toBe('amber');
    });

    it('returns red when no lead on duty', () => {
      const board = selectFunctionStatusBoard({
        functions: [{ id: 'fn-1', name: 'Ledning' }],
        members: [],
        taskRecords: [],
        shiftRecords: [],
        briefingReportRecords: [],
        now: NOW,
      });
      expect(board[0].leadOnDuty).toBeNull();
      expect(board[0].rag).toBe('red');
    });
  });

  describe('selectRecentLogEntries', () => {
    it('returns latest entries first, limited', () => {
      const t1 = new Date(NOW - 1000).toISOString();
      const t2 = new Date(NOW - 2000).toISOString();
      const t3 = new Date(NOW - 3000).toISOString();
      const r1 = makeRecord({ entityType: EntityType.logEntry, payload: { text: 'A', category: 'info', eventTime: t1, source: '', visibility: 'incident' } });
      const r2 = makeRecord({ entityType: EntityType.logEntry, payload: { text: 'B', category: 'event', eventTime: t2, source: '', visibility: 'incident' } });
      const r3 = makeRecord({ entityType: EntityType.logEntry, payload: { text: 'C', category: 'decision', eventTime: t3, source: '', visibility: 'incident' } });
      const entries = selectRecentLogEntries([r1, r2, r3], 2);
      expect(entries.length).toBe(2);
      expect(entries[0].text).toBe('A');
      expect(entries[1].text).toBe('B');
    });

    it('ignores retracted entries', () => {
      const r = makeRecord({ entityType: EntityType.logEntry, kind: 'retract', payload: { reason: 'x' } });
      expect(selectRecentLogEntries([r], 5)).toEqual([]);
    });
  });

  describe('selectFactCounts', () => {
    it('counts statuses and finds oldest assumption', () => {
      const tOld = new Date(NOW - 86400 * 1000).toISOString();
      const tNew = new Date(NOW).toISOString();
      const r1 = makeRecord({ entityType: EntityType.factItem, payload: { text: 'Vet', status: 'verified', eventTime: tNew, source: '', logEntryId: null } });
      const r2 = makeRecord({ entityType: EntityType.factItem, payload: { text: 'Antar gammal', status: 'assumption', eventTime: tOld, source: '', logEntryId: null } });
      const r3 = makeRecord({ entityType: EntityType.factItem, payload: { text: 'Antar ny', status: 'assumption', eventTime: tNew, source: '', logEntryId: null } });
      const r4 = makeRecord({ entityType: EntityType.factItem, payload: { text: 'Vet ej', status: 'info_need', eventTime: tNew, source: '', logEntryId: null } });
      const c = selectFactCounts([r1, r2, r3, r4]);
      expect(c.verified).toBe(1);
      expect(c.assumption).toBe(2);
      expect(c.infoNeed).toBe(1);
      expect(c.oldestUnverifiedAssumption?.text).toMatch(/Antar/);
    });
  });

  describe('selectDecisionsWaiting', () => {
    it('returns open decision requests sorted by neededBy', () => {
      const early = new Date(NOW - 1000).toISOString();
      const late = new Date(NOW + 1000).toISOString();
      const r1 = makeRecord({ entityType: EntityType.decisionRequest, payload: { question: 'Sen', status: 'open', neededBy: late, options: [] } });
      const r2 = makeRecord({ entityType: EntityType.decisionRequest, payload: { question: 'Tidig', status: 'open', neededBy: early, options: [] } });
      const r3 = makeRecord({ entityType: EntityType.decisionRequest, payload: { question: 'Besluten', status: 'decided', neededBy: late, options: [] } });
      const ds = selectDecisionsWaiting([r1, r2, r3]);
      expect(ds.length).toBe(2);
      expect(ds[0].question).toBe('Tidig');
      expect(ds[1].question).toBe('Sen');
    });
  });

  describe('selectOverdueTasks', () => {
    it('returns overdue non-terminal tasks sorted by due', () => {
      const due1 = new Date(NOW - 7200 * 1000).toISOString();
      const due2 = new Date(NOW - 3600 * 1000).toISOString();
      const dueFuture = new Date(NOW + 86400 * 1000).toISOString();
      const r1 = makeRecord({ entityType: EntityType.task, payload: { title: 'T1', description: '', assigneeFunctionId: 'fn-1', assigneeUserId: null, due: due1, priority: 'normal', status: 'todo', reportForm: 'none' } });
      const r2 = makeRecord({ entityType: EntityType.task, payload: { title: 'T2', description: '', assigneeFunctionId: 'fn-1', assigneeUserId: null, due: due2, priority: 'normal', status: 'doing', reportForm: 'none' } });
      const r3 = makeRecord({ entityType: EntityType.task, payload: { title: 'T3 framtid', description: '', assigneeFunctionId: 'fn-1', assigneeUserId: null, due: dueFuture, priority: 'normal', status: 'todo', reportForm: 'none' } });
      const r4 = makeRecord({ entityType: EntityType.task, payload: { title: 'T4 done', description: '', assigneeFunctionId: 'fn-1', assigneeUserId: null, due: due1, priority: 'normal', status: 'done', reportForm: 'none' } });
      const overdue = selectOverdueTasks([r1, r2, r3, r4], NOW);
      expect(overdue.length).toBe(2);
      expect(overdue.map((t) => t.title)).toEqual(['T1', 'T2']);
    });
  });

  describe('selectTimeScaleStrip', () => {
    it('groups scenarios by horizon', () => {
      const r1 = makeRecord({ entityType: EntityType.scenario, payload: { title: 'Nu', horizon: 'hours', likelihood: 'probable', description: '' } });
      const r2 = makeRecord({ entityType: EntityType.scenario, payload: { title: '48h', horizon: 'two_days', likelihood: 'possible', description: '' } });
      const r2b = makeRecord({ entityType: EntityType.scenario, payload: { title: '48h b', horizon: 'two_days', likelihood: 'probable', description: '' } });
      const r3 = makeRecord({ entityType: EntityType.scenario, payload: { title: '2v', horizon: 'two_weeks', likelihood: 'probable', description: '' } });
      const strip = selectTimeScaleStrip([r1, r2, r2b, r3]);
      expect(strip.now.length).toBe(1);
      expect(strip.fortyEightHours.length).toBe(2);
      expect(strip.twoWeeks.length).toBe(1);
    });
  });

  describe('selectMiniMapFeatures', () => {
    it('returns features sorted by label', () => {
      const r1 = makeRecord({ entityType: EntityType.mapFeature, payload: { label: 'B-område', layer: 'situation', geometry: { type: 'Point', coordinates: [1, 2] }, severity: 'info', validity: 'now' } });
      const r2 = makeRecord({ entityType: EntityType.mapFeature, payload: { label: 'A-område', layer: 'operations', geometry: { type: 'Point', coordinates: [3, 4] }, severity: 'warning', validity: 'forecast' } });
      const features = selectMiniMapFeatures([r1, r2]);
      expect(features.map((f) => f.label)).toEqual(['A-område', 'B-område']);
    });
  });

  describe('selectSyncHealth', () => {
    it('counts pending, rejected, conflicts', () => {
      const outbox = [
        { id: 'o1', status: 'pending' as const },
        { id: 'o2', status: 'pending' as const },
        { id: 'o3', status: 'rejected' as const, reason: 'conflict' },
      ];
      const h = selectSyncHealth(outbox, 2);
      expect(h.pending).toBe(2);
      expect(h.rejected).toBe(1);
      expect(h.conflicts).toBe(2);
    });
  });

  describe('selectConflictCount', () => {
    it('counts entities with more than one head', () => {
      // Two head records for the same entity (no shared parent) → conflict.
      const a = makeRecord({
        entityType: EntityType.logEntry,
        entityId: 'entity-conflict',
        payload: { text: 'v1', category: 'info', eventTime: '2026-01-01T00:00:00Z', source: '', visibility: 'incident' },
      });
      const b = makeRecord({
        entityType: EntityType.logEntry,
        entityId: 'entity-conflict',
        payload: { text: 'v2', category: 'info', eventTime: '2026-01-01T00:00:00Z', source: '', visibility: 'incident' },
      });
      // A clean single-head entity.
      const c = makeRecord({
        entityType: EntityType.logEntry,
        payload: { text: 'v3', category: 'info', eventTime: '2026-01-01T00:00:00Z', source: '', visibility: 'incident' },
      });
      expect(selectConflictCount([a, b, c])).toBe(1);
    });

    it('is zero for clean records and empty input', () => {
      const r = makeRecord({
        entityType: EntityType.logEntry,
        payload: { text: 'v1', category: 'info', eventTime: '2026-01-01T00:00:00Z', source: '', visibility: 'incident' },
      });
      expect(selectConflictCount([r])).toBe(0);
      expect(selectConflictCount([])).toBe(0);
    });
  });

  describe('formatHms', () => {
    it('formats positive, zero and negative deltas', () => {
      expect(formatHms(3_661_000)).toBe('01:01:01');
      expect(formatHms(0)).toBe('00:00:00');
      expect(formatHms(-1000)).toBe('-00:00:01');
    });
  });

  describe('mixed record bags (dashboard feeds all records to each selector)', () => {
    const logPayload = { text: 'Ett', category: 'info', eventTime: '2026-11-14T11:00:00Z', source: '', visibility: 'incident' };
    const missionPayload = { content: 'M1', issuedBy: 'x' };

    it('selectMission ignores non-mission records', () => {
      const log = makeRecord({ entityType: EntityType.logEntry, payload: logPayload });
      const mission = makeRecord({ entityType: EntityType.mission, payload: missionPayload });
      const w = selectMission([log, mission]);
      expect(w.hasMission).toBe(true);
      expect(w.content).toBe('M1');
    });

    it('selectRecentLogEntries ignores non-log records', () => {
      const mission = makeRecord({ entityType: EntityType.mission, payload: missionPayload });
      const log = makeRecord({ entityType: EntityType.logEntry, payload: logPayload });
      const entries = selectRecentLogEntries([mission, log], 10);
      expect(entries.map((e) => e.text)).toEqual(['Ett']);
    });

    it('selectFactCounts ignores non-fact records', () => {
      const mission = makeRecord({ entityType: EntityType.mission, payload: missionPayload });
      const fact = makeRecord({ entityType: EntityType.factItem, payload: { text: 'F1', status: 'verified' } });
      const counts = selectFactCounts([mission, fact]);
      expect(counts.verified).toBe(1);
      expect(counts.assumption).toBe(0);
      expect(counts.oldestUnverifiedAssumption).toBeNull();
    });

    it('selectMiniMapFeatures ignores non-map records', () => {
      const log = makeRecord({ entityType: EntityType.logEntry, payload: logPayload });
      const feature = makeRecord({
        entityType: EntityType.mapFeature,
        payload: { label: 'A', layer: 'situation', geometry: { type: 'Point', coordinates: [1, 2] }, severity: 'info', validity: 'now' },
      });
      const features = selectMiniMapFeatures([log, feature]);
      expect(features.map((f) => f.label)).toEqual(['A']);
    });

    it('selectDecisionsWaiting ignores non-decision records', () => {
      const log = makeRecord({ entityType: EntityType.logEntry, payload: logPayload });
      const dr = makeRecord({
        entityType: EntityType.decisionRequest,
        payload: { question: 'Q1', options: [{ title: 'A', pros: ['p'], cons: ['c'] }], status: 'open' },
      });
      const waiting = selectDecisionsWaiting([log, dr]);
      expect(waiting.map((d) => d.question)).toEqual(['Q1']);
    });
  });
});
