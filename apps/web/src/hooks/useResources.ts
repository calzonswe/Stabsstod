// useResources — plan.md §5 / M27
//
// Resources, staffing and logistics (samordning): the things the staff
// needs or has — personnel, vehicle, equipment, facility, other — with a
// status (available / deployed / requested / unavailable).
//
// Same offline-first flow as the other module hooks: writes go to the local
// Dexie store first, then sync. The record's functionId is the function the
// resource belongs to / is requested for — that is what can() gates on:
// members of that function may edit, chief/deputy any function, observers
// write nothing; retract = author or chief/deputy (already in can()).
//
// Everything is versioned: editing a resource writes a NEW VERSION of the
// same entity (parentIds = current heads, payload = current payload merged
// with the change). Retract is a retract record with a reason (append-only).

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type RecordEnvelope,
  type ResourcePayload,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export type ResourceDraft = ResourcePayload;

export interface ResourceView {
  entityId: string;
  functionId: string | null;
  current: RecordEnvelope | null;
  conflict: boolean;
  retracted: boolean;
}

export interface UseResourcesResult {
  resources: ResourceView[];
  loading: boolean;
  error: string;
  createResource: (draft: ResourceDraft, functionId: string | null) => Promise<void>;
  updateResource: (
    entityId: string,
    mutate: (payload: ResourcePayload) => ResourcePayload,
  ) => Promise<void>;
  retractResource: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useResources(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseResourcesResult {
  const [resources, setResources] = useState<ResourceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of records) {
        if (r.entityType !== 'resource') continue;
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const views: ResourceView[] = [];
      for (const [entityId, entityRecords] of byEntity) {
        const mat = materializeOne(entityRecords, entityId);
        if (!mat) continue;
        views.push({
          entityId,
          current: mat.current,
          functionId: mat.current?.functionId ?? null,
          conflict: mat.conflict,
          retracted: mat.retracted,
        });
      }
      // List order: by name (stable for equal names).
      views.sort(
        (a, b) =>
          ((a.current?.payload as ResourcePayload | undefined)?.name ?? '').localeCompare(
            (b.current?.payload as ResourcePayload | undefined)?.name ?? '',
          ),
      );
      setResources(views);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load resources');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
    if (!store) return;
    // M39: re-query on ingestion. Local writes route through
    // ingestRemoteRecords, so this covers server pulls too.
    return store.subscribe(() => {
      void refresh();
    });
  }, [refresh, store]);

  const createResource = useCallback(
    async (draft: ResourceDraft, functionId: string | null): Promise<void> => {
      if (!store) return;
      try {
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: crypto.randomUUID(),
          entityType: 'resource',
          incidentId,
          parentIds: [],
          functionId,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: draft,
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to create resource');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  // A version write: same entityId, parentIds = current heads, payload =
  // current payload with the change applied.
  const writeVersion = useCallback(
    async (
      entityId: string,
      mutate: (payload: ResourcePayload) => ResourcePayload,
    ): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat || !mat.current) return;
        const currentPayload = mat.current.payload as ResourcePayload;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'resource',
          incidentId,
          parentIds: mat.heads.map((h) => h.id),
          functionId: mat.current.functionId,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: mutate(currentPayload),
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to update resource');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const updateResource = useCallback(
    async (entityId: string, mutate: (payload: ResourcePayload) => ResourcePayload): Promise<void> => {
      await writeVersion(entityId, mutate);
    },
    [writeVersion],
  );

  const retractResource = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'resource',
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
        setError(err instanceof Error ? err.message : 'failed to retract resource');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    resources,
    loading,
    error,
    createResource,
    updateResource,
    retractResource,
    refresh,
  };
}
