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

const entitySchemas = new Map<EntityType, z.ZodTypeAny>([
  [EntityType.logEntry, logEntrySchema],
  [EntityType.factItem, factItemSchema],
  [EntityType.situationSnapshot, situationSnapshotSchema],
  [EntityType.scenario, scenarioSchema],
  [EntityType.mission, missionSchema],
  [EntityType.direction, directionSchema],
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
