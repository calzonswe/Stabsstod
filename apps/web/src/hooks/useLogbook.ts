// useLogbook — plan.md §5 / M16
//
// Hook encapsulating the logbook module's offline-first data flow:
//   create/retract → newRecord (HLC tick) → LocalStore.addLocalRecord
//   (records table + outbox) → materialized immediately → UI updates.
// The SyncEngine pushes the outbox to the server when online.
//
// List data is derived from the local records (materializeOne per entity),
// so it works fully offline.

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export interface LogEntryView {
  entityId: string;
  current: RecordEnvelope | null;
  /** Last kind:'put' record — used for display when current is a retract. */
  lastPut: RecordEnvelope | null;
  conflict: boolean;
  heads: RecordEnvelope[];
  history: RecordEnvelope[];
  retracted: boolean;
}

export interface LogEntryDraft {
  text: string;
  category: 'event' | 'info' | 'decision' | 'contact' | 'other';
  eventTime: string; // ISO datetime
  source?: string;
}

export interface UseLogbookResult {
  entries: LogEntryView[];
  loading: boolean;
  error: string;
  createEntry: (draft: LogEntryDraft) => Promise<void>;
  retractEntry: (entityId: string, reason: string) => Promise<void>;
  mergeEntry: (
    selectedHead: RecordEnvelope,
    allHeads: RecordEnvelope[],
  ) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useLogbook(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseLogbookResult {
  const [entries, setEntries] = useState<LogEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const logRecords = records.filter((r) => r.entityType === 'log_entry');
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of logRecords) {
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const views: LogEntryView[] = [];
      for (const [entityId, entityRecords] of byEntity) {
        const mat = materializeOne(entityRecords, entityId);
        if (!mat) continue;
        const lastPut =
          [...mat.history].reverse().find((r) => r.kind === 'put') ?? null;
        views.push({
          entityId,
          current: mat.current,
          lastPut,
          conflict: mat.conflict,
          heads: mat.heads,
          history: mat.history,
          retracted: mat.retracted,
        });
      }
      // Newest first by current record's HLC.
      views.sort((a, b) =>
        (b.current?.hlc ?? '').localeCompare(a.current?.hlc ?? ''),
      );
      setEntries(views);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load log entries');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createEntry = useCallback(
    async (draft: LogEntryDraft): Promise<void> => {
      if (!store) return;
      try {
        const state = loadHlcState();
        const entityId = crypto.randomUUID();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'log_entry',
          incidentId,
          parentIds: [],
          functionId: null,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: { ...draft, visibility: 'incident' },
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to create log entry');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const retractEntry = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        // Current heads of the entity become the parents of the retract.
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const parentIds = mat.heads.map((h) => h.id);
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'log_entry',
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
        setError(err instanceof Error ? err.message : 'failed to retract log entry');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const mergeEntry = useCallback(
    async (
      selectedHead: RecordEnvelope,
      allHeads: RecordEnvelope[],
    ): Promise<void> => {
      if (!store) return;
      try {
        // Merge record: payload of the chosen head, ALL heads as parents, so
        // materialize() collapses the conflict to a single head.
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: selectedHead.entityId,
          entityType: selectedHead.entityType as Parameters<typeof newRecord>[0]['entityType'],
          incidentId,
          parentIds: allHeads.map((h) => h.id),
          functionId: selectedHead.functionId,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: selectedHead.payload,
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to merge versions');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    entries,
    loading,
    error,
    createEntry,
    retractEntry,
    mergeEntry,
    refresh,
  };
}
