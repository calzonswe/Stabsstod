// Notifications — plan.md §5.8 / M34
//
// Pure client-side derivation: notifications are computed from the incident's
// local record bag + the signed-in user's identity + an injected clock
// (epoch ms), so they work fully offline. Every item has a STABLE id
// (`<kind>:<entityId>[:suffix]`) — the client persists which ids are read
// (Dexie, per user), so read/unread survives reloads without a server.
//
// Rules (plan.md §5.8):
//   task_assigned   — a non-terminal task is assigned to me
//   task_overdue    — my task is past its due time
//   briefing_soon   — the next briefing occurrence starts within 10 min
//   shift_change    — my shift starts or ends within 30 min
//   decision_needed — an open decision request my function is needed for
//   conflict        — a conflict on an entity of my function

import type { RecordEnvelope } from './record.js';
import { materialize } from './materialize.js';
import {
  selectMyShift,
  selectMyTasks,
  selectNeedsAttention,
  selectUpcomingBriefing,
  type HomeIdentity,
} from './functionHome.js';

/** "Briefing starts in" window (10 min). */
export const BRIEFING_SOON_WINDOW_MS = 10 * 60_000;
/** "My shift starts/ends in" window (30 min). */
export const SHIFT_CHANGE_WINDOW_MS = 30 * 60_000;

export type NotificationKind =
  | 'task_assigned'
  | 'task_overdue'
  | 'briefing_soon'
  | 'shift_change'
  | 'decision_needed'
  | 'conflict';

export interface NotificationItem {
  /** Stable id for read/unread tracking: `<kind>:<refId>[:suffix]`. */
  id: string;
  kind: NotificationKind;
  /** The entity the notification is about. */
  refId: string;
  /** Short subject line (task title, decision question, entity type, ...). */
  subject: string;
  /** Related time (ISO), or null when not time-bound. */
  at: string | null;
}

export interface NotificationsOptions {
  records: RecordEnvelope[];
  me: HomeIdentity;
  /** Injected clock (epoch ms) — tests use a fake time. */
  now: number;
}

const KIND_ORDER: Record<NotificationKind, number> = {
  task_overdue: 0,
  conflict: 1,
  task_assigned: 2,
  decision_needed: 3,
  briefing_soon: 4,
  shift_change: 5,
};

/**
 * Derive all notifications for `me` from the incident's local records.
 * Deterministic: the same records + clock yield the same items in the same
 * order (fixed kind order, then time, then id).
 */
export function deriveNotifications(opts: NotificationsOptions): NotificationItem[] {
  const { records, me, now } = opts;
  const items: NotificationItem[] = [];

  // 1. My tasks: assignment + overdue.
  for (const task of selectMyTasks(records, me, now)) {
    items.push({
      id: `task_assigned:${task.entityId}`,
      kind: 'task_assigned',
      refId: task.entityId,
      subject: task.title,
      at: task.due ?? null,
    });
    if (task.overdue && task.due) {
      items.push({
        id: `task_overdue:${task.entityId}`,
        kind: 'task_overdue',
        refId: task.entityId,
        subject: task.title,
        at: task.due,
      });
    }
  }

  // 2. The next briefing occurrence starts within the window.
  const briefing = selectUpcomingBriefing(records, me, now);
  if (
    briefing.hasBriefing &&
    briefing.at !== null &&
    briefing.inMs !== null &&
    briefing.inMs >= 0 &&
    briefing.inMs <= BRIEFING_SOON_WINDOW_MS
  ) {
    items.push({
      id: `briefing_soon:${briefing.briefingId ?? ''}:${briefing.at}`,
      kind: 'briefing_soon',
      refId: briefing.briefingId ?? '',
      subject: briefing.title ?? '',
      at: briefing.at,
    });
  }

  // 3. My shift starts or ends within the window.
  const { current, next } = selectMyShift(records, me, now);
  if (current) {
    const inMs = Date.parse(current.end) - now;
    if (inMs >= 0 && inMs <= SHIFT_CHANGE_WINDOW_MS) {
      items.push({
        id: `shift_change:${current.entityId}:end`,
        kind: 'shift_change',
        refId: current.entityId,
        subject: '',
        at: current.end,
      });
    }
  }
  if (next) {
    const inMs = Date.parse(next.start) - now;
    if (inMs <= SHIFT_CHANGE_WINDOW_MS) {
      items.push({
        id: `shift_change:${next.entityId}:start`,
        kind: 'shift_change',
        refId: next.entityId,
        subject: '',
        at: next.start,
      });
    }
  }

  // 4. Open decision requests my function is needed for (shared with
  //    selectNeedsAttention so the two stay in sync).
  for (const item of selectNeedsAttention(records, me, now)) {
    if (item.kind === 'decision_needed') {
      items.push({
        id: `decision_needed:${item.id}`,
        kind: 'decision_needed',
        refId: item.id,
        subject: item.question,
        at: null,
      });
    }
  }

  // 5. Conflicts on entities of my function.
  for (const [, mat] of materialize(records)) {
    if (!mat.conflict || mat.retracted) continue;
    const cur = mat.current;
    if (cur && cur.functionId !== null && me.functionIds.includes(cur.functionId)) {
      items.push({
        id: `conflict:${mat.entityId}`,
        kind: 'conflict',
        refId: mat.entityId,
        subject: cur.entityType,
        at: null,
      });
    }
  }

  items.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.at ? Date.parse(a.at) : Number.MAX_SAFE_INTEGER) -
        (b.at ? Date.parse(b.at) : Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id),
  );
  return items;
}
