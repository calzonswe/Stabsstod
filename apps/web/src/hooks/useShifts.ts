// useShifts — plan.md §5 / M25
//
// Shifts and handovers: the chief of staff (or deputy) plans the roster —
// who is on duty in which function, when, holding which incident role while
// on the shift. Handover notes carry "the most important to hand over" from
// the outgoing person to the incoming one.
//
// Same offline-first flow as the other module hooks: writes go to the local
// Dexie store first, then sync. A shift is written by chief/deputy only
// (CHIEF_DEPUTY_WRITE); the record's functionId is the shift's function.
// A handover note's record functionId is the function being handed over
// (what can() gates on: members of that function, chief/deputy any).
//
// One shift = one entity; a correction is a retract + a new shift
// (append-only). One handover note = one record.

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type HandoverNotePayload,
  type RecordEnvelope,
  type ShiftPayload,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export type ShiftDraft = ShiftPayload;
export type HandoverNoteDraft = HandoverNotePayload;

export interface ShiftView {
  entityId: string;
  functionId: string | null;
  current: RecordEnvelope | null;
  conflict: boolean;
  retracted: boolean;
}

export interface HandoverNoteView {
  entityId: string;
  functionId: string | null;
  current: RecordEnvelope | null;
  retracted: boolean;
}

export interface UseShiftsResult {
  shifts: ShiftView[];
  notes: HandoverNoteView[];
  loading: boolean;
  error: string;
  createShift: (draft: ShiftDraft) => Promise<void>;
  retractShift: (entityId: string, reason: string) => Promise<void>;
  addNote: (
    draft: HandoverNoteDraft,
    functionId: string | null,
  ) => Promise<void>;
  retractNote: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useShifts(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseShiftsResult {
  const [shifts, setShifts] = useState<ShiftView[]>([]);
  const [notes, setNotes] = useState<HandoverNoteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of records) {
        if (r.entityType !== 'shift' && r.entityType !== 'handover_note') {
          continue;
        }
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const sViews: ShiftView[] = [];
      const nViews: HandoverNoteView[] = [];
      for (const [entityId, entityRecords] of byEntity) {
        const mat = materializeOne(entityRecords, entityId);
        if (!mat) continue;
        const view = {
          entityId,
          current: mat.current,
          functionId: mat.current?.functionId ?? null,
          retracted: mat.retracted,
        };
        if (entityRecords[0].entityType === 'shift') {
          sViews.push({ ...view, conflict: mat.conflict });
        } else {
          nViews.push(view);
        }
      }
      // Roster order: by start time (stable for equal times).
      sViews.sort(
        (a, b) =>
          ((a.current?.payload as ShiftPayload | undefined)?.start ?? '').localeCompare(
            (b.current?.payload as ShiftPayload | undefined)?.start ?? '',
          ),
      );
      // Notes: newest first.
      nViews.sort(
        (a, b) =>
          (b.current?.createdAtClient ?? '').localeCompare(
            a.current?.createdAtClient ?? '',
          ),
      );
      setShifts(sViews);
      setNotes(nViews);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load shifts');
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

  const createShift = useCallback(
    async (draft: ShiftDraft): Promise<void> => {
      if (!store) return;
      try {
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: crypto.randomUUID(),
          entityType: 'shift',
          incidentId,
          parentIds: [],
          functionId: draft.functionId,
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
        setError(err instanceof Error ? err.message : 'failed to create shift');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const retractShift = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'shift',
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
        setError(
          err instanceof Error ? err.message : 'failed to retract shift',
        );
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const addNote = useCallback(
    async (draft: HandoverNoteDraft, functionId: string | null): Promise<void> => {
      if (!store) return;
      try {
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: crypto.randomUUID(),
          entityType: 'handover_note',
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
        setError(
          err instanceof Error ? err.message : 'failed to add handover note',
        );
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const retractNote = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'handover_note',
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
        setError(
          err instanceof Error ? err.message : 'failed to retract handover note',
        );
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    shifts,
    notes,
    loading,
    error,
    createShift,
    retractShift,
    addNote,
    retractNote,
    refresh,
  };
}
