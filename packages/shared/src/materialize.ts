// Materialization — plan.md §5.2
//
// Pure function: given a set of records for one or more entities, compute the
// current state of each entity: heads, conflict, current version, history and
// retract status. Deterministic regardless of input order.

import type { RecordEnvelope } from './record.js';
import { hlcCompare } from './hlc.js';

export interface Materialization {
  entityId: string;
  current: RecordEnvelope | null;
  heads: RecordEnvelope[];
  conflict: boolean;
  history: RecordEnvelope[];
  retracted: boolean;
}

/**
 * Group records by entityId and materialize each entity's current state.
 *
 * Heads = records not listed in any other record's parentIds (within the entity).
 * Current = the head with the greatest hlc (tie-break: deviceId).
 * Conflict = more than one head.
 * Retracted = current record's kind is 'retract'.
 * History = all records of the entity ordered by hlc.
 *
 * Deterministic: shuffling the input records yields the same result.
 */
export function materialize(records: RecordEnvelope[]): Map<string, Materialization> {
  const byEntity = new Map<string, RecordEnvelope[]>();
  for (const r of records) {
    const list = byEntity.get(r.entityId) ?? [];
    list.push(r);
    byEntity.set(r.entityId, list);
  }

  const result = new Map<string, Materialization>();
  for (const [entityId, entityRecords] of byEntity) {
    // Collect every parent id referenced within this entity.
    const allParentIds = new Set<string>();
    for (const r of entityRecords) {
      for (const p of r.parentIds) {
        allParentIds.add(p);
      }
    }

    // Heads = records whose id is not referenced as a parent by any record.
    const heads = entityRecords.filter((r) => !allParentIds.has(r.id));

    // Current = head with greatest hlc; tie-break by deviceId (ascending).
    let current: RecordEnvelope | null = null;
    if (heads.length > 0) {
      current = heads.reduce((best, h) => {
        const c = hlcCompare(h.hlc, best.hlc);
        if (c > 0) return h;
        if (c < 0) return best;
        return h.deviceId > best.deviceId ? h : best;
      });
    }

    const history = [...entityRecords].sort((a, b) => hlcCompare(a.hlc, b.hlc));

    result.set(entityId, {
      entityId,
      current,
      heads,
      conflict: heads.length > 1,
      history,
      retracted: current === null ? false : current.kind === 'retract',
    });
  }

  return result;
}

export function materializeOne(
  records: RecordEnvelope[],
  entityId: string,
): Materialization | undefined {
  return materialize(records).get(entityId);
}
