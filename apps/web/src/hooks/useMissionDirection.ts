// useMissionDirection — plan.md §5 / M20
//
// Two single-entity-per-incident versioned modules:
//   mission   — written by decision_maker / chief_of_staff / deputy_chief
//               (can() gates the UI); "acknowledge — same understanding" by
//               the chief_of_staff creates a NEW VERSION with
//               acknowledgedByChief set.
//   direction — desired vs actual direction + divergence note, written by
//               chief_of_staff / deputy_chief only.
//
// Both follow the offline-first flow: newRecord → LocalStore.addLocalRecord
// (records + outbox) → materialized view.

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export interface MissionPayloadShape {
  content: string;
  staffShouldDo?: string;
  staffShouldNotDo?: string;
  deadline?: string;
  issuedBy: string;
  acknowledgedByChief?: { userId: string; at: string };
}

export interface DirectionPayloadShape {
  desired: string;
  actual?: string;
  divergenceNote?: string;
  validFrom: string;
}

/** Shared single-entity versioned view (mission or direction). */
export interface VersionedEntityView {
  entityId: string;
  current: RecordEnvelope | null;
  lastPut: RecordEnvelope | null;
  versions: RecordEnvelope[];
  retracted: boolean;
}

function useVersionedEntity(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
  entityType: 'mission' | 'direction',
  entityIdBase: string,
): {
  view: VersionedEntityView | null;
  loading: boolean;
  error: string;
  saveVersion: (
    build: (entityId: string, parentIds: string[], functionId: string | null) => Record<string, unknown>,
  ) => Promise<void>;
  retract: (reason: string) => Promise<void>;
} {
  const [view, setView] = useState<VersionedEntityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const mine = records.filter((r) => r.entityType === entityType);
      if (mine.length === 0) {
        setView(null);
      } else {
        const entityId = mine[0].entityId;
        const mat = materializeOne(mine, entityId);
        if (!mat) {
          setView(null);
        } else {
          setView({
            entityId,
            current: mat.current,
            lastPut: [...mat.history].reverse().find((r) => r.kind === 'put') ?? null,
            versions: mat.history
              .filter((r) => r.kind === 'put')
              .sort((a, b) => a.hlc.localeCompare(b.hlc)),
            retracted: mat.retracted,
          });
        }
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : `failed to load ${entityType}`);
    } finally {
      setLoading(false);
    }
  }, [store, incidentId, entityType]);

  useEffect(() => {
    void refresh();
    if (!store) return;
    // M39: re-query on ingestion. Local writes route through
    // ingestRemoteRecords, so this covers server pulls too.
    return store.subscribe(() => {
      void refresh();
    });
  }, [refresh, store]);

  const saveVersion = useCallback(
    async (
      build: (
        entityId: string,
        parentIds: string[],
        functionId: string | null,
      ) => Record<string, unknown>,
    ): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByIncident(incidentId);
        const existing = records.filter((r) => r.entityType === entityType);
        const entityId = existing[0]?.entityId ?? entityIdBase;
        const heads = existing.length
          ? (materializeOne(existing, entityId)?.heads ?? [])
          : [];
        const state = loadHlcState();
        const payload = build(
          entityId,
          heads.map((h) => h.id),
          existing[0]?.functionId ?? null,
        );
        const { record, state: nextState } = newRecord({
          entityId,
          entityType,
          incidentId,
          parentIds: heads.map((h) => h.id),
          functionId: existing[0]?.functionId ?? null,
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
        setError(err instanceof Error ? err.message : `failed to save ${entityType}`);
      }
    },
    [store, incidentId, authorId, deviceId, entityIdBase, entityType, refresh],
  );

  const retract = useCallback(
    async (reason: string): Promise<void> => {
      if (!store || !view) return;
      try {
        const records = await store.getRecordsByEntity(view.entityId);
        const mat = materializeOne(records, view.entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: view.entityId,
          entityType,
          incidentId,
          parentIds: mat.heads.map((h) => h.id),
          functionId: mat.current?.functionId ?? null,
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
        setError(err instanceof Error ? err.message : `failed to retract ${entityType}`);
      }
    },
    [store, incidentId, authorId, deviceId, view, entityType, refresh],
  );

  return { view, loading, error, saveVersion, retract };
}

export function useMission(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): {
  mission: VersionedEntityView | null;
  loading: boolean;
  error: string;
  saveMission: (payload: MissionPayloadShape) => Promise<void>;
  acknowledge: () => Promise<void>;
  retractMission: (reason: string) => Promise<void>;
} {
  const { view, loading, error, saveVersion, retract } = useVersionedEntity(
    store,
    incidentId,
    authorId,
    'mission',
    `mission-${incidentId}`,
  );

  const saveMission = useCallback(
    async (payload: MissionPayloadShape): Promise<void> => {
      await saveVersion(() => ({ ...payload }));
    },
    [saveVersion],
  );

  // Acknowledge = new version: last put payload + acknowledgedByChief set.
  const acknowledge = useCallback(
    async (): Promise<void> => {
      await saveVersion(() => {
        const last = view?.lastPut?.payload as MissionPayloadShape | undefined;
        return {
          ...(last ?? {}),
          acknowledgedByChief: {
            userId: authorId,
            at: new Date().toISOString(),
          },
        };
      });
    },
    [saveVersion, view, authorId],
  );

  return {
    mission: view,
    loading,
    error,
    saveMission,
    acknowledge,
    retractMission: retract,
  };
}

export function useDirection(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): {
  direction: VersionedEntityView | null;
  loading: boolean;
  error: string;
  saveDirection: (payload: DirectionPayloadShape) => Promise<void>;
  retractDirection: (reason: string) => Promise<void>;
} {
  const { view, loading, error, saveVersion, retract } = useVersionedEntity(
    store,
    incidentId,
    authorId,
    'direction',
    `direction-${incidentId}`,
  );

  const saveDirection = useCallback(
    async (payload: DirectionPayloadShape): Promise<void> => {
      await saveVersion(() => ({ ...payload }));
    },
    [saveVersion],
  );

  return {
    direction: view,
    loading,
    error,
    saveDirection,
    retractDirection: retract,
  };
}
