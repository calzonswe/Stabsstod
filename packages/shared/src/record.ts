import { z } from 'zod';

// Entity types from plan.md §6 (Entity catalogue) — the source of truth.
export const EntityType = {
  attachment: 'attachment',
  logEntry: 'log_entry',
  factItem: 'fact_item',
  situationSnapshot: 'situation_snapshot',
  scenario: 'scenario',
  mission: 'mission',
  direction: 'direction',
  decisionRequest: 'decision_request',
  decision: 'decision',
  task: 'task',
  timelineEvent: 'timeline_event',
  briefing: 'briefing',
  briefingReport: 'briefing_report',
  shift: 'shift',
  handoverNote: 'handover_note',
  actor: 'actor',
  resource: 'resource',
  mapFeature: 'map_feature',
  sitrep: 'sitrep',
  closurePlan: 'closure_plan',
  evaluation: 'evaluation',
} as const;

export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export const RecordEnvelopeSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  entityType: z.string(),
  incidentId: z.string(),
  parentIds: z.array(z.string()),
  functionId: z.string().nullable(),
  authorId: z.string(),
  deviceId: z.string(),
  hlc: z.string(),
  createdAtClient: z.string().datetime(),
  kind: z.enum(['put', 'retract']),
  schemaVersion: z.number().int().positive(),
  payload: z.unknown(),
});

export type RecordEnvelope = z.infer<typeof RecordEnvelopeSchema>;

export type RetractPayload = { reason: string };
