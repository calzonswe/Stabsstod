// Dashboard selectors — plan.md §5 / M32.
//
// Pure functions: given raw record data (already filtered to one entity type
// and incident), return derived dashboard values. No React, no network — easy
// to unit test from fixtures. All times compared against an injected `now`
// (epoch ms) so tests are deterministic.

import {
  type BriefingPayload,
  type DecisionRequestPayload,
  type DirectionPayload,
  type FactItemPayload,
  type LogEntryPayload,
  type MapFeaturePayload,
  type MissionPayload,
  type RecordEnvelope,
  type ScenarioPayload,
  type ShiftPayload,
  type TaskPayload,
} from './index.js';
import { EntityType } from './record.js';
import { materialize } from './materialize.js';
import { isTaskOverdue, TERMINAL_TASK_STATUSES } from './tasks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect the current (non-retracted) payload of every entity of
 * `entityType` in `records`. The dashboard feeds each selector the full
 * mixed record bag of an incident, so the filter is required.
 */
export function currentPayloads<T>(records: RecordEnvelope[], entityType: EntityType): T[] {
  const out: T[] = [];
  for (const [, mat] of materialize(records)) {
    const current = mat.current;
    if (current && !mat.retracted && current.entityType === entityType) {
      out.push(current.payload as T);
    }
  }
  return out;
}

/** Format a millisecond delta as [sign]hh:mm:ss (24 h clock, padded). */
export function formatHms(diffMs: number): string {
  const sign = diffMs < 0 ? '-' : '';
  const totalSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function msToHms(diffMs: number): string {
  return formatHms(diffMs);
}

// ---------------------------------------------------------------------------
// 1. Current mission
// ---------------------------------------------------------------------------

export interface MissionWidget {
  content: string | null;
  staffShouldDo: string | null;
  staffShouldNotDo: string | null;
  deadline: string | null;
  issuedBy: string | null;
  acknowledgedByChief: { userId: string; at: string } | null;
  hasMission: boolean;
}

export function selectMission(records: RecordEnvelope[]): MissionWidget {
  const missions = currentPayloads<MissionPayload>(records, EntityType.mission);
  const mission = missions[0];
  if (!mission) {
    return { hasMission: false, content: null, staffShouldDo: null, staffShouldNotDo: null, deadline: null, issuedBy: null, acknowledgedByChief: null };
  }
  return {
    hasMission: true,
    content: mission.content,
    staffShouldDo: mission.staffShouldDo ?? null,
    staffShouldNotDo: mission.staffShouldNotDo ?? null,
    deadline: mission.deadline ?? null,
    issuedBy: mission.issuedBy,
    acknowledgedByChief: mission.acknowledgedByChief ?? null,
  };
}

// ---------------------------------------------------------------------------
// 2. Direction divergence
// ---------------------------------------------------------------------------

export interface DirectionWidget {
  desired: string | null;
  actual: string | null;
  divergenceNote: string | null;
  validFrom: string | null;
  diverged: boolean;
  hasDirection: boolean;
}

export function selectDirection(records: RecordEnvelope[]): DirectionWidget {
  const directions = currentPayloads<DirectionPayload>(records, EntityType.direction);
  const direction = directions[0];
  if (!direction) {
    return { hasDirection: false, desired: null, actual: null, divergenceNote: null, validFrom: null, diverged: false };
  }
  const diverged = Boolean(direction.actual && direction.actual !== direction.desired);
  return {
    hasDirection: true,
    desired: direction.desired,
    actual: direction.actual ?? null,
    divergenceNote: direction.divergenceNote ?? null,
    validFrom: direction.validFrom,
    diverged,
  };
}

// ---------------------------------------------------------------------------
// 3. Elapsed time
// ---------------------------------------------------------------------------

export function selectElapsedTime(startedAt: string | null, now: number): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  return msToHms(now - start);
}

// ---------------------------------------------------------------------------
// 4. Next briefing
// ---------------------------------------------------------------------------

export interface BriefingWidget {
  title: string | null;
  scheduledAt: string | null;
  kind: string | null;
  status: string | null;
  inMs: number | null;
  hasBriefing: boolean;
}

export function selectNextBriefing(records: RecordEnvelope[], now: number): BriefingWidget {
  const briefings = currentPayloads<BriefingPayload>(records, EntityType.briefing);
  const upcoming = briefings
    .filter((b) => new Date(b.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const next = upcoming[0];
  if (!next) {
    return { hasBriefing: false, title: null, scheduledAt: null, kind: null, status: null, inMs: null };
  }
  return {
    hasBriefing: true,
    title: next.title,
    scheduledAt: next.scheduledAt,
    kind: next.kind,
    status: next.status,
    inMs: new Date(next.scheduledAt).getTime() - now,
  };
}

// ---------------------------------------------------------------------------
// 5. Shift changes next N hours
// ---------------------------------------------------------------------------

export interface ShiftChange {
  functionId: string;
  userId: string;
  role: string;
  start: string;
  end: string;
  kind: 'start' | 'end';
  at: string;
}

export function selectShiftChanges(records: RecordEnvelope[], now: number, windowMs: number): ShiftChange[] {
  const changes: ShiftChange[] = [];
  const windowEnd = now + windowMs;
  for (const shift of currentPayloads<ShiftPayload>(records, EntityType.shift)) {
    const startMs = new Date(shift.start).getTime();
    const endMs = new Date(shift.end).getTime();
    if (startMs >= now && startMs <= windowEnd) {
      changes.push({ functionId: shift.functionId, userId: shift.userId, role: shift.role, start: shift.start, end: shift.end, kind: 'start', at: shift.start });
    }
    if (endMs >= now && endMs <= windowEnd) {
      changes.push({ functionId: shift.functionId, userId: shift.userId, role: shift.role, start: shift.start, end: shift.end, kind: 'end', at: shift.end });
    }
  }
  changes.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return changes;
}

// ---------------------------------------------------------------------------
// 6. Function status board
// ---------------------------------------------------------------------------

export interface FunctionStatus {
  functionId: string;
  functionName: string;
  leadOnDuty: { userId: string; userName: string } | null;
  openTasks: number;
  overdueTasks: number;
  lastUpdate: string | null;
  latestChallenge: string | null;
  rag: 'red' | 'amber' | 'green';
}

interface FunctionStatusBoardOpts {
  functions: Array<{ id: string; name: string }>;
  members: Array<{ userId: string; userName: string; functionIds: string[] }>;
  taskRecords: RecordEnvelope[];
  shiftRecords: RecordEnvelope[];
  briefingReportRecords: RecordEnvelope[];
  now: number;
}

export function selectFunctionStatusBoard(opts: FunctionStatusBoardOpts): FunctionStatus[] {
  const { functions, members, taskRecords, shiftRecords, briefingReportRecords, now } = opts;

  const shiftsByFunction = new Map<string, ShiftPayload[]>();
  for (const shift of currentPayloads<ShiftPayload>(shiftRecords, EntityType.shift)) {
    const list = shiftsByFunction.get(shift.functionId) ?? [];
    list.push(shift);
    shiftsByFunction.set(shift.functionId, list);
  }

  const tasksByFunction = new Map<string, TaskPayload[]>();
  for (const task of currentPayloads<TaskPayload>(taskRecords, EntityType.task)) {
    const list = tasksByFunction.get(task.assigneeFunctionId) ?? [];
    list.push(task);
    tasksByFunction.set(task.assigneeFunctionId, list);
  }

  // Latest briefing-report challenge per function (record's functionId = reporting function).
  // Sorted by creation time so "latest" is by time, not store order; an empty
  // challenges field keeps the previous (challenge text does not expire).
  const reportsByFunction = new Map<string, string | null>();
  const reports = [...briefingReportRecords].sort((a, b) =>
    a.createdAtClient.localeCompare(b.createdAtClient),
  );
  for (const r of reports) {
    const mat = materialize([r]).get(r.entityId);
    if (!mat || !mat.current || mat.retracted) continue;
    if (r.entityType !== EntityType.briefingReport) continue;
    const report = mat.current.payload as { challenges: string };
    const fnId = r.functionId;
    if (fnId === null) continue;
    const prev = reportsByFunction.get(fnId);
    // Empty challenges text = "no challenge reported"; keep the previous one.
    reportsByFunction.set(fnId, (report.challenges || prev) ?? null);
  }

  // Last update per function: the most recent createdAtClient across all
  // records attributed to the function (any entity type).
  const lastUpdateByFunction = new Map<string, string>();
  for (const r of [...taskRecords, ...shiftRecords, ...briefingReportRecords]) {
    if (r.functionId === null) continue;
    const prev = lastUpdateByFunction.get(r.functionId);
    if (!prev || r.createdAtClient > prev) {
      lastUpdateByFunction.set(r.functionId, r.createdAtClient);
    }
  }

  const board: FunctionStatus[] = [];
  for (const fn of functions) {
    const fnShifts = shiftsByFunction.get(fn.id) ?? [];
    const leadOnDuty = fnShifts
      .filter((s) => s.role === 'function_lead')
      .find((s) => new Date(s.start).getTime() <= now && new Date(s.end).getTime() >= now);
    const leadMember = leadOnDuty ? members.find((m) => m.userId === leadOnDuty.userId) : undefined;

    const fnTasks = tasksByFunction.get(fn.id) ?? [];
    const openTasks = fnTasks.filter((t) => !TERMINAL_TASK_STATUSES.includes(t.status)).length;
    const overdueTasks = fnTasks.filter((t) => isTaskOverdue(t, new Date(now))).length;

    const latestChallenge = reportsByFunction.get(fn.id) ?? null;

    let rag: 'red' | 'amber' | 'green' = 'green';
    if (overdueTasks > 0 || !leadOnDuty) rag = 'red';
    else if (openTasks > 0) rag = 'amber';

    board.push({
      functionId: fn.id,
      functionName: fn.name,
      leadOnDuty: leadOnDuty ? { userId: leadOnDuty.userId, userName: leadMember?.userName ?? leadOnDuty.userId } : null,
      openTasks,
      overdueTasks,
      lastUpdate: lastUpdateByFunction.get(fn.id) ?? null,
      latestChallenge,
      rag,
    });
  }
  board.sort((a, b) => a.functionName.localeCompare(b.functionName));
  return board;
}

// ---------------------------------------------------------------------------
// 7. Latest log entries
// ---------------------------------------------------------------------------

export function selectRecentLogEntries(records: RecordEnvelope[], limit = 10): LogEntryPayload[] {
  const entries = currentPayloads<LogEntryPayload>(records, EntityType.logEntry)
    .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())
    .slice(0, limit);
  return entries;
}

// ---------------------------------------------------------------------------
// 8. Fact counts
// ---------------------------------------------------------------------------

export interface FactCounts {
  verified: number;
  assumption: number;
  infoNeed: number;
  /** The assumption whose entity was created earliest (by first record time). */
  oldestUnverifiedAssumption: { text: string; createdAt: string } | null;
}

export function selectFactCounts(records: RecordEnvelope[]): FactCounts {
  let verified = 0;
  let assumption = 0;
  let infoNeed = 0;
  let oldest: { text: string; createdAt: string } | null = null;
  for (const [, mat] of materialize(records)) {
    if (!mat.current || mat.retracted) continue;
    if (mat.current.entityType !== EntityType.factItem) continue;
    const fact = mat.current.payload as FactItemPayload;
    if (fact.status === 'verified') verified++;
    else if (fact.status === 'assumption') {
      assumption++;
      // Oldest = earliest first record of the entity (history is hlc-ascending).
      const first = mat.history[0];
      if (!first) continue;
      if (!oldest || first.createdAtClient < oldest.createdAt) {
        oldest = { text: fact.text, createdAt: first.createdAtClient };
      }
    } else if (fact.status === 'info_need') infoNeed++;
  }
  return {
    verified,
    assumption,
    infoNeed,
    oldestUnverifiedAssumption: oldest,
  };
}

// ---------------------------------------------------------------------------
// 9. Decisions waiting
// ---------------------------------------------------------------------------

export function selectDecisionsWaiting(records: RecordEnvelope[]): DecisionRequestPayload[] {
  const decisions = currentPayloads<DecisionRequestPayload>(records, EntityType.decisionRequest).filter((dr) => dr.status === 'open');
  decisions.sort((a, b) => {
    const ta = new Date(a.neededBy ?? '').getTime();
    const tb = new Date(b.neededBy ?? '').getTime();
    return ta - tb;
  });
  return decisions;
}

// ---------------------------------------------------------------------------
// 10. Overdue tasks
// ---------------------------------------------------------------------------

export function selectOverdueTasks(records: RecordEnvelope[], now: number): TaskPayload[] {
  const overdue = currentPayloads<TaskPayload>(records, EntityType.task).filter((t) => isTaskOverdue(t, new Date(now)));
  overdue.sort((a, b) => {
    const ta = new Date(a.due ?? '').getTime();
    const tb = new Date(b.due ?? '').getTime();
    return ta - tb;
  });
  return overdue;
}

// ---------------------------------------------------------------------------
// 11. Time-scale strip (scenarios)
// ---------------------------------------------------------------------------

export interface TimeScaleStrip {
  now: ScenarioPayload[];
  fortyEightHours: ScenarioPayload[];
  twoWeeks: ScenarioPayload[];
}

export function selectTimeScaleStrip(records: RecordEnvelope[]): TimeScaleStrip {
  const strip: TimeScaleStrip = { now: [], fortyEightHours: [], twoWeeks: [] };
  for (const scenario of currentPayloads<ScenarioPayload>(records, EntityType.scenario)) {
    if (scenario.horizon === 'hours') strip.now.push(scenario);
    else if (scenario.horizon === 'two_days') strip.fortyEightHours.push(scenario);
    else if (scenario.horizon === 'two_weeks') strip.twoWeeks.push(scenario);
    else strip.twoWeeks.push(scenario);
  }
  return strip;
}

// ---------------------------------------------------------------------------
// 12. Mini map features
// ---------------------------------------------------------------------------

export function selectMiniMapFeatures(records: RecordEnvelope[]): MapFeaturePayload[] {
  const features = currentPayloads<MapFeaturePayload>(records, EntityType.mapFeature);
  features.sort((a, b) => a.label.localeCompare(b.label));
  return features;
}

// ---------------------------------------------------------------------------
// 13. Sync health
// ---------------------------------------------------------------------------

export interface SyncHealth {
  pending: number;
  rejected: number;
  conflicts: number;
}

export interface OutboxEntryLike {
  id: string;
  status: 'pending' | 'rejected';
  reason?: string;
}

export function selectSyncHealth(outbox: OutboxEntryLike[], conflicts: number): SyncHealth {
  return {
    pending: outbox.filter((o) => o.status === 'pending').length,
    rejected: outbox.filter((o) => o.status === 'rejected').length,
    conflicts,
  };
}

/** Number of entities that currently have more than one head (conflict). */
export function selectConflictCount(records: RecordEnvelope[]): number {
  let count = 0;
  for (const [, mat] of materialize(records)) {
    if (mat.conflict && !mat.retracted) count++;
  }
  return count;
}
