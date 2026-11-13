// useBriefings — plan.md §5 / M24
//
// Staff briefings (stabsorientering): the chief of staff (or deputy)
// schedules single or recurring briefings with an agenda; each function
// pre-fills its report (done / planned / challenges / collaboration needs)
// before the briefing. Same offline-first flow as the other module hooks:
// writes go to the local Dexie store first, then sync.
//
// A briefing is incident-level (record functionId = null); the write rule is
// chief/deputy only (CHIEF_DEPUTY_WRITE). A report belongs to one briefing
// and one function: the record's functionId IS the reporting function, which
// is what can() gates on (members of the reporting function).
//
// Editing (status, minutes, agenda) = a new version of the same entity.
// "Delete" = a retract record with a reason (append-only).

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type BriefingPayload,
  type BriefingReportPayload,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export type BriefingDraft = BriefingPayload;

export interface BriefingView {
  entityId: string;
  current: RecordEnvelope | null;
  lastPut: RecordEnvelope | null;
  conflict: boolean;
  heads: RecordEnvelope[];
  history: RecordEnvelope[];
  retracted: boolean;
}

export interface ReportView {
  entityId: string;
  briefingId: string;
  functionId: string | null;
  current: RecordEnvelope | null;
  lastPut: RecordEnvelope | null;
  retracted: boolean;
}

export interface ReportDraft {
  done: string;
  planned: string;
  challenges: string;
  collaborationNeeds: string;
}

export interface UseBriefingsResult {
  briefings: BriefingView[];
  reports: ReportView[];
  loading: boolean;
  error: string;
  createBriefing: (draft: BriefingDraft) => Promise<void>;
  editBriefing: (entityId: string, draft: BriefingDraft) => Promise<void>;
  retractBriefing: (entityId: string, reason: string) => Promise<void>;
  saveReport: (
    briefingId: string,
    functionId: string | null,
    draft: ReportDraft,
  ) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useBriefings(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseBriefingsResult {
  const [briefings, setBriefings] = useState<BriefingView[]>([]);
  const [reports, setReports] = useState<ReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of records) {
        if (r.entityType !== 'briefing' && r.entityType !== 'briefing_report') {
          continue;
        }
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const bViews: BriefingView[] = [];
      const rViews: ReportView[] = [];
      for (const [entityId, entityRecords] of byEntity) {
        const mat = materializeOne(entityRecords, entityId);
        if (!mat) continue;
        const lastPut =
          [...mat.history].reverse().find((r) => r.kind === 'put') ?? null;
        if (entityRecords[0].entityType === 'briefing') {
          bViews.push({
            entityId,
            current: mat.current,
            lastPut,
            conflict: mat.conflict,
            heads: mat.heads,
            history: mat.history,
            retracted: mat.retracted,
          });
        } else {
          const current = mat.current;
          rViews.push({
            entityId,
            briefingId: current
              ? ((current.payload as BriefingReportPayload).briefingId)
              : lastPut
                ? ((lastPut.payload as BriefingReportPayload).briefingId)
                : '',
            functionId: current?.functionId ?? null,
            current,
            lastPut,
            retracted: mat.retracted,
          });
        }
      }
      bViews.sort((a, b) =>
        (b.lastPut?.hlc ?? '').localeCompare(a.lastPut?.hlc ?? ''),
      );
      setBriefings(bViews);
      setReports(rViews);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load briefings');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const writeBriefingVersion = useCallback(
    async (
      entityId: string,
      parentIds: string[],
      draft: BriefingDraft,
    ): Promise<void> => {
      if (!store) return;
      const state = loadHlcState();
      const { record, state: nextState } = newRecord({
        entityId,
        entityType: 'briefing',
        incidentId,
        parentIds,
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
    },
    [store, incidentId, authorId, deviceId],
  );

  const createBriefing = useCallback(
    async (draft: BriefingDraft): Promise<void> => {
      if (!store) return;
      try {
        await writeBriefingVersion(crypto.randomUUID(), [], draft);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to create briefing');
      }
    },
    [store, writeBriefingVersion, refresh],
  );

  // Edit (agenda, minutes, status, recurrence) = new version, parents =
  // current heads.
  const editBriefing = useCallback(
    async (entityId: string, draft: BriefingDraft): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        await writeBriefingVersion(entityId, mat.heads.map((h) => h.id), draft);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to edit briefing');
      }
    },
    [store, writeBriefingVersion, refresh],
  );

  const retractBriefing = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'briefing',
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
        setError(
          err instanceof Error ? err.message : 'failed to retract briefing',
        );
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  // One report per briefing per function. Saving again for the same
  // (briefing, function) writes a new version of the existing report entity;
  // otherwise a new entity.
  const saveReport = useCallback(
    async (
      briefingId: string,
      functionId: string | null,
      draft: ReportDraft,
    ): Promise<void> => {
      if (!store) return;
      try {
        const existing = reports.find(
          (r) =>
            r.briefingId === briefingId &&
            r.functionId === functionId &&
            !r.retracted,
        );
        let parentIds: string[] = [];
        let entityId: string = crypto.randomUUID();
        if (existing) {
          const records = await store.getRecordsByEntity(existing.entityId);
          const mat = materializeOne(records, existing.entityId);
          if (!mat) return;
          entityId = existing.entityId;
          parentIds = mat.heads.map((h) => h.id);
        }
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'briefing_report',
          incidentId,
          parentIds,
          functionId,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: { briefingId, ...draft },
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'failed to save briefing report',
        );
      }
    },
    [store, reports, incidentId, authorId, deviceId, refresh],
  );

  return {
    briefings,
    reports,
    loading,
    error,
    createBriefing,
    editBriefing,
    retractBriefing,
    saveReport,
    refresh,
  };
}
