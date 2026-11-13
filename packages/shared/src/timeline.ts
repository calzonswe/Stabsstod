// timeline — plan.md §5 / M23
//
// Pure derivation for the horizontal timeline: merge manual `timeline_event`
// records with **derived** items (task deadlines, decisions; briefings and
// shifts are supplied by the same sources in M24/M25) into one list sorted by
// time. No framework dependencies; shared by the web UI.
//
// A timeline item always carries its source + the originating entity id so the
// UI can render a link and only manual items are retractable here.

import type {
  BriefingPayload,
  DecisionPayload,
  ShiftPayload,
  TaskPayload,
  TimelineEventPayload,
  TimelineEventScope,
  TimelineEventType,
} from './entityRegistry.js';
import { briefingOccurrences, type OccurrenceOptions } from './briefings.js';

/** Where a timeline item came from. */
export type TimelineSource = 'manual' | 'briefing' | 'shift' | 'task' | 'decision';

export interface TimelineItem {
  /** Stable id unique within the derived list (`<source>:<entityId>`). */
  id: string;
  source: TimelineSource;
  title: string;
  /** Event start, ISO datetime (UTC). */
  time: string;
  /** Optional end, ISO datetime (UTC). */
  endTime?: string;
  type: TimelineEventType;
  scope: TimelineEventScope;
  /** The originating entity (manual items: the timeline_event entity). */
  refEntityId?: string;
}

export interface TimelineItemSources {
  manual: TimelineItem[];
  briefings?: TimelineItem[];
  shifts?: TimelineItem[];
  tasks?: TimelineItem[];
  decisions?: TimelineItem[];
}

/** Map materialized timeline_event payloads to manual timeline items. */
export function manualTimelineItems(
  events: { entityId: string; payload: TimelineEventPayload }[],
): TimelineItem[] {
  return events.map((e) => ({
    id: `manual:${e.entityId}`,
    source: 'manual',
    title: e.payload.title,
    time: e.payload.time,
    endTime: e.payload.endTime,
    type: e.payload.type,
    scope: e.payload.scope,
    refEntityId: e.entityId,
  }));
}

/**
 * Task deadlines: every task that has a `due` time becomes a deadline item at
 * that time. Tasks without a due time have no place on the timeline.
 */
export function taskDeadlineItems(
  tasks: { entityId: string; payload: TaskPayload }[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const t of tasks) {
    if (!t.payload.due) continue;
    items.push({
      id: `task:${t.entityId}`,
      source: 'task',
      title: t.payload.title,
      time: t.payload.due,
      type: 'deadline',
      scope: 'internal',
      refEntityId: t.entityId,
    });
  }
  return items;
}

/**
 * Decisions: every recorded decision becomes a decision item at `decidedAt`.
 */
export function decisionTimelineItems(
  decisions: { entityId: string; payload: DecisionPayload }[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const d of decisions) {
    if (!d.payload.decidedAt) continue;
    items.push({
      id: `decision:${d.entityId}`,
      source: 'decision',
      title: d.payload.text,
      time: d.payload.decidedAt,
      type: 'decision',
      scope: 'internal',
      refEntityId: d.entityId,
    });
  }
  return items;
}

/**
 * Briefings (M24): every planned/held briefing becomes a meeting item. A
 * recurring briefing expands into one item per occurrence (bounded by the
 * occurrence options; callers should pass a `horizonEnd` in practice so an
 * unbounded recurrence cannot flood the timeline). Cancelled briefings are
 * omitted.
 */
export function briefingTimelineItems(
  briefings: { entityId: string; payload: BriefingPayload }[],
  options: OccurrenceOptions = {},
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const b of briefings) {
    if (b.payload.status === 'cancelled') continue;
    for (const time of briefingOccurrences(
      b.payload.scheduledAt,
      b.payload.recurrence,
      options,
    )) {
      items.push({
        id: `briefing:${b.entityId}:${time}`,
        source: 'briefing',
        title: b.payload.title,
        time,
        type: 'meeting',
        scope: 'internal',
        refEntityId: b.entityId,
      });
    }
  }
  return items;
}

/**
 * Shifts (M25): every shift becomes one item spanning the whole shift
 * (`time` = start, `endTime` = end), so the planner's handovers are visible
 * in the timeline next to briefings and deadlines. Shifts are finite, so no
 * horizon options are needed.
 */
export function shiftTimelineItems(
  shifts: { entityId: string; payload: ShiftPayload }[],
): TimelineItem[] {
  return shifts.map((s) => ({
    id: `shift:${s.entityId}`,
    source: 'shift',
    // The role the user holds while on the shift — the readable label is
    // resolved by the UI (shiftRoleLabel / locale).
    title: s.payload.role,
    time: s.payload.start,
    endTime: s.payload.end,
    type: 'other',
    scope: 'internal',
    refEntityId: s.entityId,
  }));
}

/**
 * Merge every source into one list sorted by event time (ascending). The sort
 * is stable, so items sharing a time keep source insertion order.
 */
export function deriveTimelineItems(sources: TimelineItemSources): TimelineItem[] {
  const all: TimelineItem[] = [
    ...sources.manual,
    ...(sources.briefings ?? []),
    ...(sources.shifts ?? []),
    ...(sources.tasks ?? []),
    ...(sources.decisions ?? []),
  ];
  return all.sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );
}
