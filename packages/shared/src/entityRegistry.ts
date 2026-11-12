// Entity registry — plan.md §6
//
// Maps each EntityType to its zod payload schema. Schemas are used by the
// server to validate record payloads on ingest. `log_entry` (M16) and
// `fact_item` (M17) are defined; the remaining entity schemas are added in
// later milestones.

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

const entitySchemas = new Map<EntityType, z.ZodTypeAny>([
  [EntityType.logEntry, logEntrySchema],
  [EntityType.factItem, factItemSchema],
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
