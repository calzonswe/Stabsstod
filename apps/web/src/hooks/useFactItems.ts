// useFactItems — plan.md §5 / M17
//
// Facts, assumptions and information needs on the Vet/Antar/Vet ej board.
// Same offline-first flow as useLogbook: create/transition → newRecord →
// LocalStore.addLocalRecord (records + outbox) → materialized view.
//
// A status transition is a NEW VERSION of the same entity: parentIds = the
// entity's current heads, payload.status = the new status. History is kept.

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export type FactStatus = 'verified' | 'assumption' | 'info_need' | 'refuted';

export interface FactItemView {
  entityId: string;
  current: RecordEnvelope | null;
  lastPut: RecordEnvelope | null;
  /** Column to show the item in: last status that is not 'refuted'. */
  displayStatus: FactStatus | null;
  conflict: boolean;
  heads: RecordEnvelope[];
  history: RecordEnvelope[];
  retracted: boolean;
}

export interface FactDraft {
  text: string;
  status: FactStatus;
  source?: string;
  logEntryId?: string;
}

export interface UseFactItemsResult {
  facts: FactItemView[];
  loading: boolean;
  error: string;
  createFact: (draft: FactDraft) => Promise<void>;
  changeStatus: (entityId: string, status: FactStatus) => Promise<void>;
  retractFact: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useFactItems(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseFactItemsResult {
  const [facts, setFacts] = useState<FactItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const factRecords = records.filter((r) => r.entityType === 'fact_item');
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of factRecords) {
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const views: FactItemView[] = [];
      for (const [entityId, entityRecords] of byEntity) {
        const mat = materializeOne(entityRecords, entityId);
        if (!mat) continue;
        const putsInOrder = [...mat.history].reverse().filter((r) => r.kind === 'put');
        const lastPut = putsInOrder[0] ?? null;
        const lastStatus = (lastPut?.payload as { status?: FactStatus } | undefined)
          ?.status;
        // Refuted items stay in their original column, struck through.
        const displayStatus =
          lastStatus === 'refuted'
            ? (putsInOrder.find((r) =>
                (r.payload as { status?: FactStatus }).status !== 'refuted',
              )?.payload as { status: FactStatus } | undefined)?.status ?? null
            : (lastStatus as FactStatus | undefined) ?? null;
        views.push({
          entityId,
          current: mat.current,
          lastPut,
          displayStatus,
          conflict: mat.conflict,
          heads: mat.heads,
          history: mat.history,
          retracted: mat.retracted,
        });
      }
      views.sort((a, b) =>
        (b.lastPut?.hlc ?? '').localeCompare(a.lastPut?.hlc ?? ''),
      );
      setFacts(views);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load fact items');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createFact = useCallback(
    async (draft: FactDraft): Promise<void> => {
      if (!store) return;
      try {
        const state = loadHlcState();
        const entityId = crypto.randomUUID();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'fact_item',
          incidentId,
          parentIds: [],
          functionId: null,
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
        setError(err instanceof Error ? err.message : 'failed to create fact item');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  // Status transition = new version with the current heads as parents.
  const changeStatus = useCallback(
    async (entityId: string, status: FactStatus): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat || !mat.current) return;
        const parentIds = mat.heads.map((h) => h.id);
        const lastPayload = ([...mat.history]
          .reverse()
          .find((r) => r.kind === 'put')?.payload ??
          (mat.current.payload as Record<string, unknown> | undefined)) as
          | Record<string, unknown>
          | undefined;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'fact_item',
          incidentId,
          parentIds,
          functionId: mat.current.functionId,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: { ...lastPayload, status },
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to change fact status');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const retractFact = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const parentIds = mat.heads.map((h) => h.id);
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'fact_item',
          incidentId,
          parentIds,
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
        setError(err instanceof Error ? err.message : 'failed to retract fact item');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return { facts, loading, error, createFact, changeStatus, retractFact, refresh };
}
