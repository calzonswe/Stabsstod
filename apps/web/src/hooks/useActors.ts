// useActors — plan.md §5 / M26
//
// Actor analysis (aktörsanalys): the people and organisations involved in
// the incident, how the staff relates to them (status: involved / should be
// involved / informed) and the directed relations between actors (free-form
// relation text).
//
// Same offline-first flow as the other module hooks: writes go to the local
// Dexie store first, then sync. The record's functionId is the author's own
// function (chief/deputy → null) — that is what can() gates on: members of
// that function may edit, chief/deputy any function, observers write
// nothing; retract = author or chief/deputy (already in can()).
//
// Everything is versioned: adding/changing a relation or the status writes a
// NEW VERSION of the same entity (parentIds = current heads, payload =
// current payload merged with the change). Retract is a retract record with
// a reason (append-only).

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type ActorPayload,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export type ActorDraft = ActorPayload;

export interface ActorView {
  entityId: string;
  functionId: string | null;
  current: RecordEnvelope | null;
  conflict: boolean;
  retracted: boolean;
}

export interface UseActorsResult {
  actors: ActorView[];
  loading: boolean;
  error: string;
  createActor: (draft: ActorDraft, functionId: string | null) => Promise<void>;
  addRelation: (entityId: string, targetActorId: string, relation: string) => Promise<void>;
  removeRelation: (entityId: string, targetActorId: string) => Promise<void>;
  setStatus: (entityId: string, status: ActorPayload['status']) => Promise<void>;
  retractActor: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useActors(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseActorsResult {
  const [actors, setActors] = useState<ActorView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of records) {
        if (r.entityType !== 'actor') continue;
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const views: ActorView[] = [];
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
          ((a.current?.payload as ActorPayload | undefined)?.name ?? '').localeCompare(
            (b.current?.payload as ActorPayload | undefined)?.name ?? '',
          ),
      );
      setActors(views);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load actors');
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

  const createActor = useCallback(
    async (draft: ActorDraft, functionId: string | null): Promise<void> => {
      if (!store) return;
      try {
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: crypto.randomUUID(),
          entityType: 'actor',
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
        setError(err instanceof Error ? err.message : 'failed to create actor');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  // A version write: same entityId, parentIds = current heads, payload =
  // current payload with the change applied.
  const writeVersion = useCallback(
    async (
      entityId: string,
      mutate: (payload: ActorPayload) => ActorPayload,
    ): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat || !mat.current) return;
        const currentPayload = mat.current.payload as ActorPayload;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'actor',
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
        setError(err instanceof Error ? err.message : 'failed to update actor');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  // Upsert semantics: if a relation to this target already exists, update
  // its text; otherwise add it. Either way: one new version.
  const addRelation = useCallback(
    async (entityId: string, targetActorId: string, relation: string): Promise<void> => {
      await writeVersion(entityId, (p) => {
        const existing = p.relations.find((r) => r.actorId === targetActorId);
        return {
          ...p,
          relations: existing
            ? p.relations.map((r) =>
                r.actorId === targetActorId ? { ...r, relation } : r,
              )
            : [...p.relations, { actorId: targetActorId, relation }],
        };
      });
    },
    [writeVersion],
  );

  const removeRelation = useCallback(
    async (entityId: string, targetActorId: string): Promise<void> => {
      await writeVersion(entityId, (p) => ({
        ...p,
        relations: p.relations.filter((r) => r.actorId !== targetActorId),
      }));
    },
    [writeVersion],
  );

  const setStatus = useCallback(
    async (entityId: string, status: ActorPayload['status']): Promise<void> => {
      await writeVersion(entityId, (p) => ({ ...p, status }));
    },
    [writeVersion],
  );

  const retractActor = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'actor',
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
        setError(err instanceof Error ? err.message : 'failed to retract actor');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    actors,
    loading,
    error,
    createActor,
    addRelation,
    removeRelation,
    setStatus,
    retractActor,
    refresh,
  };
}
