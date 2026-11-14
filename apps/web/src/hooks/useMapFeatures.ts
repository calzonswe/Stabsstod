// useMapFeatures — plan.md §5 / M30
//
// Map features (ritade kartobjekt): points, lines, polygons and circles
// drawn on the map. Writes go to the local Dexie store first, then sync.
// Every save is a new version of the same entity (parentIds = current heads,
// payload = current payload merged with the change). Retract is a retract
// record with a reason (append-only).
//
// The record's functionId is the function the feature belongs to — that is
// what can() gates on: members of that function may edit, chief/deputy any
// function, observers write nothing; retract = author or chief/deputy
// (already in can()).

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type MapFeaturePayload,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export type MapFeatureDraft = MapFeaturePayload;

export interface MapFeatureView {
  entityId: string;
  functionId: string | null;
  current: RecordEnvelope | null;
  conflict: boolean;
  retracted: boolean;
}

export interface UseMapFeaturesResult {
  features: MapFeatureView[];
  loading: boolean;
  error: string;
  createFeature: (
    draft: MapFeatureDraft,
    functionId: string | null,
  ) => Promise<void>;
  updateFeature: (
    entityId: string,
    mutate: (payload: MapFeaturePayload) => MapFeaturePayload,
  ) => Promise<void>;
  retractFeature: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMapFeatures(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseMapFeaturesResult {
  const [features, setFeatures] = useState<MapFeatureView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of records) {
        if (r.entityType !== 'map_feature') continue;
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const views: MapFeatureView[] = [];
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
      // List order: by label (stable for equal labels).
      views.sort(
        (a, b) =>
          ((a.current?.payload as MapFeaturePayload | undefined)?.label ?? '').localeCompare(
            (b.current?.payload as MapFeaturePayload | undefined)?.label ?? '',
          ),
      );
      setFeatures(views);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load map features');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createFeature = useCallback(
    async (draft: MapFeatureDraft, functionId: string | null): Promise<void> => {
      if (!store) return;
      try {
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: crypto.randomUUID(),
          entityType: 'map_feature',
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
        setError(err instanceof Error ? err.message : 'failed to create map feature');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  // A version write: same entityId, parentIds = current heads, payload =
  // current payload with the change applied.
  const writeVersion = useCallback(
    async (
      entityId: string,
      mutate: (payload: MapFeaturePayload) => MapFeaturePayload,
    ): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat || !mat.current) return;
        const currentPayload = mat.current.payload as MapFeaturePayload;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'map_feature',
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
        setError(err instanceof Error ? err.message : 'failed to update map feature');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const updateFeature = useCallback(
    async (
      entityId: string,
      mutate: (payload: MapFeaturePayload) => MapFeaturePayload,
    ): Promise<void> => {
      await writeVersion(entityId, mutate);
    },
    [writeVersion],
  );

  const retractFeature = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'map_feature',
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
        setError(err instanceof Error ? err.message : 'failed to retract map feature');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    features,
    loading,
    error,
    createFeature,
    updateFeature,
    retractFeature,
    refresh,
  };
}
