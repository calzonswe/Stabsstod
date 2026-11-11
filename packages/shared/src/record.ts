import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import { hlcTick, type HLCState } from './hlc.js';

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
  // Server-only fields, added on ingest. Optional so clients can create
  // envelopes without them; the server assigns serverSeq on push.
  serverSeq: z.number().int().nonnegative().optional(),
  receivedAt: z.string().datetime().optional(),
});

export type RecordEnvelope = z.infer<typeof RecordEnvelopeSchema>;

export type RetractPayload = { reason: string };

/** Create a new record envelope, advancing the caller's HLC state. */
export function newRecord(opts: {
  entityId: string;
  entityType: EntityType;
  incidentId: string;
  parentIds: string[];
  functionId: string | null;
  authorId: string;
  deviceId: string;
  schemaVersion: number;
  payload: unknown;
  createdAtClient: string;
  kind: 'put' | 'retract';
  state: HLCState;
}): { record: RecordEnvelope; state: HLCState } {
  const { state, hlc } = hlcTick(opts.state, opts.deviceId);
  const record: RecordEnvelope = {
    id: uuidv7(),
    entityId: opts.entityId,
    entityType: opts.entityType,
    incidentId: opts.incidentId,
    parentIds: opts.parentIds,
    functionId: opts.functionId,
    authorId: opts.authorId,
    deviceId: opts.deviceId,
    hlc,
    createdAtClient: opts.createdAtClient,
    kind: opts.kind,
    schemaVersion: opts.schemaVersion,
    payload: opts.payload,
  };
  return { record, state };
}
