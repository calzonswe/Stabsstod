import { z } from 'zod';

export const EntityType = {
  attachment: 'attachment',
  logEntry: 'logEntry',
  fact: 'fact',
  assumption: 'assumption',
  informationNeed: 'informationNeed',
  situationSnapshot: 'situationSnapshot',
  scenario: 'scenario',
  mission: 'mission',
  direction: 'direction',
  decision: 'decision',
  task: 'task',
  timelineEntry: 'timelineEntry',
  briefing: 'briefing',
  shift: 'shift',
  actor: 'actor',
  resource: 'resource',
  mapFeature: 'mapFeature',
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
