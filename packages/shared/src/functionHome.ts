// Function home selectors — plan.md §10 / M33.
//
// Pure selectors for the function workspace home — the default landing page
// for non-chief roles (function_lead / staff_member / decision_maker /
// observer). Same conventions as dashboard.ts: the caller passes the
// incident's full mixed record bag and the selectors filter by entity type
// internally. All times are compared against an injected `now` (epoch ms)
// so tests are deterministic.

import type {
  BriefingPayload,
  DecisionRequestPayload,
  HandoverNotePayload,
  RecordEnvelope,
  ShiftPayload,
  TaskPayload,
} from './index.js';
import { EntityType } from './record.js';
import { materialize } from './materialize.js';
import { nextBriefingTime } from './briefings.js';
import { isTaskOverdue, TERMINAL_TASK_STATUSES } from './tasks.js';

/** The signed-in user the home is rendered for. */
export interface HomeIdentity {
  userId: string;
  functionIds: string[];
}

/** Window in which "my shift starts" counts as needing attention (30 min). */
export const SHIFT_SOON_WINDOW_MS = 30 * 60_000;

interface Current<T> {
  entityId: string;
  functionId: string | null;
  createdAtClient: string;
  payload: T;
}

function currentRecords<T>(records: RecordEnvelope[], entityType: EntityType): Current<T>[] {
  const out: Current<T>[] = [];
  for (const [, mat] of materialize(records)) {
    const cur = mat.current;
    if (cur && !mat.retracted && cur.entityType === entityType) {
      out.push({
        entityId: cur.entityId,
        functionId: cur.functionId,
        createdAtClient: cur.createdAtClient,
        payload: cur.payload as T,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// My tasks
// ---------------------------------------------------------------------------

export interface MyTask extends TaskPayload {
  entityId: string;
  overdue: boolean;
}

/**
 * The non-terminal tasks personally assigned to me (`assigneeUserId`),
 * sorted by due time (earliest first, no due last) then by title. The
 * `overdue` flag is computed against the injected `now`.
 */
export function selectMyTasks(records: RecordEnvelope[], id: HomeIdentity, now: number): MyTask[] {
  const mine = currentRecords<TaskPayload>(records, EntityType.task).filter(
    (t) => t.payload.assigneeUserId === id.userId && !TERMINAL_TASK_STATUSES.includes(t.payload.status),
  );
  mine.sort((a, b) => {
    const da = a.payload.due ? Date.parse(a.payload.due) : Number.MAX_SAFE_INTEGER;
    const db = b.payload.due ? Date.parse(b.payload.due) : Number.MAX_SAFE_INTEGER;
    return da - db || a.payload.title.localeCompare(b.payload.title);
  });
  const at = new Date(now);
  return mine.map((t) => ({
    ...t.payload,
    entityId: t.entityId,
    overdue: isTaskOverdue(t.payload, at),
  }));
}

// ---------------------------------------------------------------------------
// Upcoming briefing + my missing reports
// ---------------------------------------------------------------------------

export interface UpcomingBriefingHome {
  hasBriefing: boolean;
  /** entityId of the briefing the next occurrence belongs to. */
  briefingId: string | null;
  title: string | null;
  kind: string | null;
  /** The next occurrence time (recurrence aware), ISO. */
  at: string | null;
  inMs: number | null;
  /** My functions that have no current report for this briefing yet. */
  missingReports: string[];
}

/**
 * The soonest upcoming planned briefing occurrence (recurrence aware, via
 * nextBriefingTime) plus which of my functions still owe a report for it.
 */
export function selectUpcomingBriefing(
  records: RecordEnvelope[],
  id: HomeIdentity,
  now: number,
): UpcomingBriefingHome {
  const briefings = currentRecords<BriefingPayload>(records, EntityType.briefing);
  const next = nextBriefingTime(
    briefings.map((b) => ({
      id: b.entityId,
      scheduledAt: b.payload.scheduledAt,
      status: b.payload.status,
      recurrence: b.payload.recurrence,
    })),
    new Date(now).toISOString(),
  );
  if (!next) {
    return {
      hasBriefing: false,
      briefingId: null,
      title: null,
      kind: null,
      at: null,
      inMs: null,
      missingReports: [],
    };
  }
  const source = briefings.find((b) => b.entityId === next.briefingId);
  const reported = new Set(
    currentRecords<{ briefingId: string }>(records, EntityType.briefingReport)
      .filter(
        (r) =>
          r.payload.briefingId === next.briefingId &&
          r.functionId !== null &&
          id.functionIds.includes(r.functionId),
      )
      .map((r) => r.functionId as string),
  );
  const missingReports = id.functionIds.filter((fid) => !reported.has(fid));
  return {
    hasBriefing: true,
    briefingId: next.briefingId,
    title: source?.payload.title ?? null,
    kind: source?.payload.kind ?? null,
    at: next.time,
    inMs: new Date(next.time).getTime() - now,
    missingReports,
  };
}

// ---------------------------------------------------------------------------
// My current / next shift + handover notes
// ---------------------------------------------------------------------------

export interface MyShift {
  entityId: string;
  functionId: string;
  start: string;
  end: string;
  role: string;
}

export interface MyShiftView {
  /** The shift covering `now` (both boundaries inclusive), if any. */
  current: MyShift | null;
  /** The earliest of my shifts starting after `now`, if any. */
  next: MyShift | null;
  /**
   * Handover notes addressed to me or tied to my current/next shift (by the
   * shift being handed over), newest first.
   */
  handoverNotes: Array<{ text: string; fromUserId: string; shiftId: string | null; at: string }>;
}

export function selectMyShift(records: RecordEnvelope[], id: HomeIdentity, now: number): MyShiftView {
  const mine = currentRecords<ShiftPayload>(records, EntityType.shift)
    .filter((s) => s.payload.userId === id.userId)
    .map((s) => ({
      entityId: s.entityId,
      functionId: s.payload.functionId,
      start: s.payload.start,
      end: s.payload.end,
      role: s.payload.role,
    }));
  const covering = mine.filter((s) => Date.parse(s.start) <= now && now <= Date.parse(s.end));
  const current =
    covering.sort(
      (a, b) => Date.parse(b.start) - Date.parse(a.start) || a.entityId.localeCompare(b.entityId),
    )[0] ?? null;
  const upcoming = mine
    .filter((s) => Date.parse(s.start) > now)
    .sort(
      (a, b) => Date.parse(a.start) - Date.parse(b.start) || a.entityId.localeCompare(b.entityId),
    );
  const next = upcoming[0] ?? null;

  const relevantShiftIds = new Set<string>([current?.entityId, next?.entityId].filter(Boolean));
  const notes = currentRecords<HandoverNotePayload>(records, EntityType.handoverNote)
    .filter(
      (n) =>
        n.payload.toUserId === id.userId ||
        (n.payload.shiftId !== undefined && relevantShiftIds.has(n.payload.shiftId)),
    )
    .sort(
      (a, b) => b.createdAtClient.localeCompare(a.createdAtClient) || b.entityId.localeCompare(a.entityId),
    );
  return {
    current,
    next,
    handoverNotes: notes.map((n) => ({
      text: n.payload.text,
      fromUserId: n.payload.fromUserId,
      shiftId: n.payload.shiftId ?? null,
      at: n.createdAtClient,
    })),
  };
}

// ---------------------------------------------------------------------------
// Items needing my attention
// ---------------------------------------------------------------------------

export type AttentionItem =
  | { kind: 'task_overdue'; id: string; title: string; due: string }
  | { kind: 'task_blocked'; id: string; title: string }
  | { kind: 'decision_needed'; id: string; question: string; neededBy: string | null }
  | { kind: 'briefing_report_pending'; id: string; title: string; at: string; missingFunctions: string[] }
  | { kind: 'shift_soon'; id: string; start: string; inMs: number };

const KIND_ORDER: Record<AttentionItem['kind'], number> = {
  task_overdue: 0,
  task_blocked: 1,
  decision_needed: 2,
  briefing_report_pending: 3,
  shift_soon: 4,
};

function attentionTime(item: AttentionItem): number {
  switch (item.kind) {
    case 'task_overdue':
      return Date.parse(item.due);
    case 'briefing_report_pending':
      return Date.parse(item.at);
    case 'shift_soon':
      return Date.parse(item.start);
    default:
      return 0;
  }
}

/**
 * Everything that needs my attention right now, in stable urgency order:
 * my overdue tasks, my blocked tasks, open decision requests my function is
 * needed for, a briefing report still missing, and a shift starting within
 * SHIFT_SOON_WINDOW_MS.
 */
export function selectNeedsAttention(
  records: RecordEnvelope[],
  id: HomeIdentity,
  now: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const task of selectMyTasks(records, id, now)) {
    if (task.overdue && task.due) {
      items.push({ kind: 'task_overdue', id: task.entityId, title: task.title, due: task.due });
    }
    if (task.status === 'blocked') {
      items.push({ kind: 'task_blocked', id: task.entityId, title: task.title });
    }
  }

  for (const dr of currentRecords<DecisionRequestPayload>(records, EntityType.decisionRequest)) {
    if (dr.payload.status !== 'open') continue;
    const neededBy = dr.payload.neededBy ?? null;
    if (neededBy !== null && id.functionIds.includes(neededBy)) {
      items.push({ kind: 'decision_needed', id: dr.entityId, question: dr.payload.question, neededBy });
    }
  }

  const briefing = selectUpcomingBriefing(records, id, now);
  if (briefing.hasBriefing && briefing.missingReports.length > 0 && briefing.at !== null) {
    items.push({
      kind: 'briefing_report_pending',
      id: briefing.briefingId ?? '',
      title: briefing.title ?? '',
      at: briefing.at,
      missingFunctions: briefing.missingReports,
    });
  }

  const { next } = selectMyShift(records, id, now);
  if (next) {
    const inMs = Date.parse(next.start) - now;
    if (inMs <= SHIFT_SOON_WINDOW_MS) {
      items.push({ kind: 'shift_soon', id: next.entityId, start: next.start, inMs });
    }
  }

  items.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      attentionTime(a) - attentionTime(b) ||
      a.id.localeCompare(b.id),
  );
  return items;
}
