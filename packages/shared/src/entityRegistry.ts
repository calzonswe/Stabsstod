// Entity registry — plan.md §6
//
// Maps each EntityType to its zod payload schema. Schemas are used by the
// server to validate record payloads on ingest. `log_entry` (M16),
// `fact_item` (M17) and `situation_snapshot` (M18) are defined; the remaining
// entity schemas are added in later milestones.

import { EntityType } from './record.js';
import { z } from 'zod';

export interface EntitySchema<TPayload = unknown> {
  type: EntityType;
  schema: z.ZodType<TPayload>;
  validate(
    payload: unknown,
  ): { success: true; data: TPayload } | { success: false; errors: z.ZodIssue[] };
}

const logEntrySchema = z.object({
  text: z.string().min(1),
  category: z.enum(['event', 'info', 'decision', 'contact', 'other']),
  eventTime: z.string().datetime(),
  source: z.string().optional(),
  visibility: z.literal('incident'),
});

// fact_item — M17: facts ("vet"), assumptions ("antar") and information needs
// ("vet ej") on the three-column board. Status transitions (assumption →
// verified / refuted) create a new version, keeping history. `refuted` items
// are displayed struck through in their original column.
export const FactItemStatus = {
  verified: 'verified',
  assumption: 'assumption',
  infoNeed: 'info_need',
  refuted: 'refuted',
} as const;

export type FactItemStatus = (typeof FactItemStatus)[keyof typeof FactItemStatus];

const factItemSchema = z.object({
  text: z.string().min(1),
  status: z.enum(['verified', 'assumption', 'info_need', 'refuted']),
  source: z.string().optional(),
  // Optional link to a log entry (entityId of a log_entry record).
  logEntryId: z.string().optional(),
});

// situation_snapshot — M18: the current situation picture. A new save is a
// new version of the same entity; "current picture" = the latest version.
export const PROTECTED_VALUES = [
  'life',
  'health',
  'property',
  'environment',
  'critical_society',
] as const;

export type ProtectedValue = (typeof PROTECTED_VALUES)[number];

const situationSnapshotSchema = z.object({
  whatHappened: z.string().optional(),
  current: z.string().optional(),
  consequences: z.string().optional(),
  // FIS fields (Fakta → Innebörd → Slutsatser) as three steps.
  fis: z
    .object({
      fakta: z.string().optional(),
      innebord: z.string().optional(),
      slutsats: z.string().optional(),
    })
    .optional(),
  protectedValues: z.array(
    z.enum(['life', 'health', 'property', 'environment', 'critical_society']),
  ),
});

// scenario — M19: contingency scenarios grouped by time horizon and
// likelihood, with an optional contingency plan text and an optional link
// to a task entity.
export const ScenarioHorizon = {
  hours: 'hours',
  twoDays: 'two_days',
  twoWeeks: 'two_weeks',
  custom: 'custom',
} as const;

export type ScenarioHorizon = (typeof ScenarioHorizon)[keyof typeof ScenarioHorizon];

export const ScenarioLikelihood = {
  probable: 'probable',
  possible: 'possible',
} as const;

export type ScenarioLikelihood = (typeof ScenarioLikelihood)[keyof typeof ScenarioLikelihood];

const scenarioSchema = z.object({
  title: z.string().min(1),
  // plan.md §6: description is required, implications optional.
  description: z.string().min(1),
  implications: z.string().optional(),
  horizon: z.enum(['hours', 'two_days', 'two_weeks', 'custom']),
  // Required when horizon is 'custom': free-text description of the horizon.
  customHorizon: z.string().optional(),
  likelihood: z.enum(['probable', 'possible']),
  contingencyPlan: z.string().optional(),
  // Optional link to a task entity (entityId).
  taskId: z.string().optional(),
});

// mission — M20: the mission statement. One entity per incident; a save or
// a chief-of-staff acknowledgement is a new version. Written by
// decision_maker / chief_of_staff / deputy_chief (permissions.ts).
const missionSchema = z.object({
  content: z.string().min(1),
  staffShouldDo: z.string().optional(),
  staffShouldNotDo: z.string().optional(),
  deadline: z.string().datetime().optional(),
  // Who issued the mission (userId of the decision maker).
  issuedBy: z.string().min(1),
  // Set by a LATER version when the chief of staff acknowledges.
  acknowledgedByChief: z
    .object({
      userId: z.string(),
      at: z.string().datetime(),
    })
    .optional(),
});

// direction — M20: desired vs actual direction, side by side, with an
// optional divergence note. Written by chief_of_staff / deputy_chief only.
const directionSchema = z.object({
  desired: z.string().min(1),
  actual: z.string().optional(),
  divergenceNote: z.string().optional(),
  validFrom: z.string().datetime(),
});

// decision_request — M21: request with options (pros/cons) and recommendation.
const decisionRequestSchema = z.object({
  question: z.string().min(1),
  background: z.string().optional(),
  options: z.array(
    z.object({
      title: z.string().min(1),
      pros: z.array(z.string()).min(1),
      cons: z.array(z.string()).min(1),
    }),
  ).min(1),
  recommendation: z.string().optional(),
  // Who is needed to decide this (functionId of the decision_maker).
  neededBy: z.string().optional(),
  // Status: open, decided, withdrawn.
  status: z.enum(['open', 'decided', 'withdrawn']),
});

// decision — M21: decision maker records the outcome of a decision request.
const decisionSchema = z.object({
  // Optional link to the decision_request entity (plan.md §6: requestId?).
  requestId: z.string().min(1).optional(),
  // The final decision text.
  text: z.string().min(1),
  // Rationale behind the decision.
  rationale: z.string().optional(),
  // Who decided (decision_maker or chief with delegated mandate).
  decidedByUserId: z.string(),
  // When the decision was made.
  decidedAt: z.string().datetime(),
  // Mandate: decision_maker or delegated_chief (from permissions.ts).
  mandate: z.enum(['decision_maker', 'delegated_chief']),
});


// task — M22: staff work plan item. `status` transitions (proposed → todo →
// doing → blocked/done/cancelled) create new versions; `parentTaskId` makes
// it a subtask; `due` is highlighted overdue in shared/tasks.ts.
export const TaskStatus = {
  proposed: 'proposed',
  todo: 'todo',
  doing: 'doing',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskPriority = {
  low: 'low',
  normal: 'normal',
  high: 'high',
  critical: 'critical',
} as const;

export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const TaskReportForm = {
  oral: 'oral',
  written: 'written',
  none: 'none',
} as const;

export type TaskReportForm = (typeof TaskReportForm)[keyof typeof TaskReportForm];

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  // Function the task is assigned to (stabsarbetsplan grouping).
  assigneeFunctionId: z.string().min(1),
  // Optional person on top of the function.
  assigneeUserId: z.string().optional(),
  due: z.string().datetime().optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  status: z.enum(['proposed', 'todo', 'doing', 'blocked', 'done', 'cancelled']),
  reportForm: z.enum(['oral', 'written', 'none']),
  // Subtask link: entityId of the parent task.
  parentTaskId: z.string().optional(),
});

// timeline_event — M23: a manual event on the horizontal timeline. Manual
// events are the user-authored items; the timeline also derives items from
// other entities (task deadlines, decisions; briefings/shifts in M24/M25).
// `scope` decides the side of the axis: internal below, external above.
export const TimelineEventType = {
  meeting: 'meeting',
  deadline: 'deadline',
  decision: 'decision',
  milestone: 'milestone',
  external: 'external',
  other: 'other',
} as const;

export type TimelineEventType = (typeof TimelineEventType)[keyof typeof TimelineEventType];

export const TimelineEventScope = {
  internal: 'internal',
  external: 'external',
} as const;

export type TimelineEventScope = (typeof TimelineEventScope)[keyof typeof TimelineEventScope];

const timelineEventSchema = z.object({
  title: z.string().min(1),
  // Event start (ISO datetime, stored UTC).
  time: z.string().datetime(),
  // Optional end (ISO datetime) for events that span a duration.
  endTime: z.string().datetime().optional(),
  type: z.enum(['meeting', 'deadline', 'decision', 'milestone', 'external', 'other']),
  scope: z.enum(['internal', 'external']),
});

// briefing — M24: a staff briefing (stabsorientering) scheduled by the chief
// of staff. `kind` decides which agenda template (presets.ts) pre-fills
// `agenda[]`. `recurrence` makes the briefing repeat on a fixed rhythm until
// it stops (see briefings.ts expandRecurrence).
export const BriefingKind = {
  firstGathering: 'first_gathering',
  firstBriefing: 'first_briefing',
  recurring: 'recurring',
  other: 'other',
} as const;

export type BriefingKind = (typeof BriefingKind)[keyof typeof BriefingKind];

export const BriefingStatus = {
  planned: 'planned',
  held: 'held',
  cancelled: 'cancelled',
} as const;

export type BriefingStatus = (typeof BriefingStatus)[keyof typeof BriefingStatus];

export const BriefingRecurrenceSchema = z.object({
  // Interval between occurrences, in hours.
  intervalHours: z.number().int().min(1),
  // Optional stop bounds — whichever comes first ends the recurrence.
  maxCount: z.number().int().min(1).optional(),
  endsAt: z.string().datetime().optional(),
});

export type BriefingRecurrence = z.infer<typeof BriefingRecurrenceSchema>;

const briefingSchema = z.object({
  title: z.string().min(1),
  scheduledAt: z.string().datetime(),
  kind: z.enum(['first_gathering', 'first_briefing', 'recurring', 'other']),
  // Agenda items (pre-filled from the template for the kind, editable).
  agenda: z.array(z.string().min(1)),
  // Meeting minutes (set by a later version while running the briefing).
  minutes: z.string().optional(),
  status: z.enum(['planned', 'held', 'cancelled']),
  recurrence: BriefingRecurrenceSchema.optional(),
});

// briefing_report — M24: each function prepares its report before the
// briefing (the four prepare-questions of the handbook). One report per
// function per briefing; the record `functionId` is the reporting function
// (what can() gates on).
const briefingReportSchema = z.object({
  // entityId of the briefing this report belongs to.
  briefingId: z.string().min(1),
  done: z.string(),
  planned: z.string(),
  challenges: z.string(),
  collaborationNeeds: z.string(),
});

const entitySchemas = new Map<EntityType, z.ZodTypeAny>([
  [EntityType.logEntry, logEntrySchema],
  [EntityType.factItem, factItemSchema],
  [EntityType.situationSnapshot, situationSnapshotSchema],
  [EntityType.scenario, scenarioSchema],
  [EntityType.mission, missionSchema],
  [EntityType.direction, directionSchema],
  [EntityType.decisionRequest, decisionRequestSchema],
  [EntityType.decision, decisionSchema],
  [EntityType.task, taskSchema],
  [EntityType.timelineEvent, timelineEventSchema],
  [EntityType.briefing, briefingSchema],
  [EntityType.briefingReport, briefingReportSchema],
]);

export function getEntitySchema(entityType: EntityType): z.ZodTypeAny | undefined {
  return entitySchemas.get(entityType);
}

export function validateEntityPayload(
  entityType: EntityType,
  payload: unknown,
): { success: true; data: unknown } | { success: false; errors: z.ZodIssue[] } {
  const schema = entitySchemas.get(entityType);
  if (!schema) {
    // No schema registered yet → accept anything (schema added in later milestone).
    return { success: true, data: payload };
  }
  const result = schema.safeParse(payload);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}

export type LogEntryPayload = z.infer<typeof logEntrySchema>;
export type FactItemPayload = z.infer<typeof factItemSchema>;
export type SituationSnapshotPayload = z.infer<typeof situationSnapshotSchema>;
export type ScenarioPayload = z.infer<typeof scenarioSchema>;
export type MissionPayload = z.infer<typeof missionSchema>;
export type DirectionPayload = z.infer<typeof directionSchema>;
export type DecisionRequestPayload = z.infer<typeof decisionRequestSchema>;
export type TaskPayload = z.infer<typeof taskSchema>;
export type DecisionPayload = z.infer<typeof decisionSchema>;
export type TimelineEventPayload = z.infer<typeof timelineEventSchema>;
export type BriefingPayload = z.infer<typeof briefingSchema>;
export type BriefingReportPayload = z.infer<typeof briefingReportSchema>;