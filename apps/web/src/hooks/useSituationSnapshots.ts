// useSituationSnapshots — plan.md §5 / M18
//
// The situation picture: each save is a NEW VERSION of the same entity.
// "Current picture" = the latest version's materialized current record.
// History keeps all versions for the diff view.

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export interface SituationSnapshotPayloadShape {
  whatHappened?: string;
  current?: string;
  consequences?: string;
  fis?: { fakta?: string; innebord?: string; slutsats?: string };
  protectedValues: string[];
}

export interface SituationVersionView {
  entityId: string;
  current: RecordEnvelope | null;
  lastPut: RecordEnvelope | null;
  /** Versions, oldest → newest (kind 'put'). */
  versions: RecordEnvelope[];
  retracted: boolean;
}

export interface UseSituationSnapshotsResult {
  snapshot: SituationVersionView | null;
  loading: boolean;
  error: string;
  saveVersion: (payload: SituationSnapshotPayloadShape) => Promise<void>;
  retractSnapshot: (reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSituationSnapshots(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseSituationSnapshotsResult {
  const [snapshot, setSnapshot] = useState<SituationVersionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const snapshotRecords = records.filter(
        (r) => r.entityType === 'situation_snapshot',
      );
      if (snapshotRecords.length === 0) {
        setSnapshot(null);
      } else {
        // All snapshots share one entityId per incident (single current picture).
        const entityId = snapshotRecords[0].entityId;
        const mat = materializeOne(snapshotRecords, entityId);
        if (!mat) {
          setSnapshot(null);
        } else {
          const versions = mat.history
            .filter((r) => r.kind === 'put')
            .sort((a, b) => a.hlc.localeCompare(b.hlc));
          setSnapshot({
            entityId,
            current: mat.current,
            lastPut: [...mat.history].reverse().find((r) => r.kind === 'put') ?? null,
            versions,
            retracted: mat.retracted,
          });
        }
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load situation picture');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveVersion = useCallback(
    async (payload: SituationSnapshotPayloadShape): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByIncident(incidentId);
        const existing = records.filter((r) => r.entityType === 'situation_snapshot');
        const entityId =
          existing[0]?.entityId ?? `snapshot-${incidentId}`;
        const heads = existing.length
          ? (materializeOne(existing, entityId)?.heads ?? [])
          : [];
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'situation_snapshot',
          incidentId,
          parentIds: heads.map((h) => h.id),
          functionId: null,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload,
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to save situation picture');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const retractSnapshot = useCallback(
    async (reason: string): Promise<void> => {
      if (!store || !snapshot) return;
      try {
        const records = await store.getRecordsByEntity(snapshot.entityId);
        const mat = materializeOne(records, snapshot.entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: snapshot.entityId,
          entityType: 'situation_snapshot',
          incidentId,
          parentIds: mat.heads.map((h) => h.id),
          functionId: null,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: { reason },
          createdAtClient: new Date().toISOString(),
          kind: 'retract',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to retract situation picture');
      }
    },
    [store, incidentId, authorId, deviceId, snapshot, refresh],
  );

  return { snapshot, loading, error, saveVersion, retractSnapshot, refresh };
}
