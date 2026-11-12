// useDecisions — plan.md §5 / M21
//
// Decision requests (question, background, options with pros/cons,
// recommendation) and decisions (the outcome recorded by the decision maker,
// or the chief of staff with delegated mandate). List per incident, multiple
// requests allowed. Same offline-first flow as the other module hooks.
//
// A decision is recorded as:
//   1. a new version of the decision_request with status 'decided' (history),
//   2. a new `decision` record linked via requestId (the outcome itself).
//
// Withdrawing a request is a new version with status 'withdrawn'.
// "Delete" is a retract record with a reason (shared hook behaviour).

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export type DecisionRequestStatus = 'open' | 'decided' | 'withdrawn';

export interface DecisionOption {
  title: string;
  pros: string[];
  cons: string[];
}

export interface DecisionRequestDraft {
  question: string;
  background?: string;
  options: DecisionOption[];
  recommendation?: string;
  neededBy?: string;
  status: DecisionRequestStatus;
}

export interface DecisionDraft {
  requestId?: string;
  text: string;
  rationale?: string;
  decidedByUserId: string;
  decidedAt: string;
  mandate: 'decision_maker' | 'delegated_chief';
}

export interface VersionedListEntry {
  entityId: string;
  current: RecordEnvelope | null;
  lastPut: RecordEnvelope | null;
  conflict: boolean;
  heads: RecordEnvelope[];
  history: RecordEnvelope[];
  retracted: boolean;
}

export interface UseDecisionsResult {
  requests: VersionedListEntry[];
  decisions: VersionedListEntry[];
  loading: boolean;
  error: string;
  createRequest: (draft: DecisionRequestDraft) => Promise<void>;
  editRequest: (entityId: string, draft: DecisionRequestDraft) => Promise<void>;
  withdrawRequest: (entityId: string) => Promise<void>;
  recordDecision: (requestEntityId: string, draft: DecisionDraft) => Promise<void>;
  retractRequest: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function groupViews(
  records: RecordEnvelope[],
  entityType: string,
): VersionedListEntry[] {
  const byEntity = new Map<string, RecordEnvelope[]>();
  for (const r of records.filter((r) => r.entityType === entityType)) {
    const list = byEntity.get(r.entityId) ?? [];
    list.push(r);
    byEntity.set(r.entityId, list);
  }
  const views: VersionedListEntry[] = [];
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
  views.sort((a, b) =>
    (b.lastPut?.hlc ?? '').localeCompare(a.lastPut?.hlc ?? ''),
  );
  return views;
}

export function useDecisions(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseDecisionsResult {
  const [requests, setRequests] = useState<VersionedListEntry[]>([]);
  const [decisions, setDecisions] = useState<VersionedListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      setRequests(groupViews(records, 'decision_request'));
      setDecisions(groupViews(records, 'decision'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load decisions');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const writeRequestVersion = useCallback(
    async (
      entityId: string,
      parentIds: string[],
      functionId: string | null,
      draft: DecisionRequestDraft,
    ): Promise<void> => {
      if (!store) return;
      const state = loadHlcState();
      const { record, state: nextState } = newRecord({
        entityId,
        entityType: 'decision_request',
        incidentId,
        parentIds,
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
    },
    [store, incidentId, authorId, deviceId],
  );

  const createRequest = useCallback(
    async (draft: DecisionRequestDraft): Promise<void> => {
      if (!store) return;
      try {
        await writeRequestVersion(crypto.randomUUID(), [], null, draft);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to create decision request');
      }
    },
    [store, writeRequestVersion, refresh],
  );

  // Edit = new version with the current heads as parents.
  const editRequest = useCallback(
    async (entityId: string, draft: DecisionRequestDraft): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        await writeRequestVersion(
          entityId,
          mat.heads.map((h) => h.id),
          mat.current?.functionId ?? null,
          draft,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to edit decision request');
      }
    },
    [store, writeRequestVersion, refresh],
  );

  // Withdraw = a new version with status 'withdrawn' (plan.md §10 M21).
  const withdrawRequest = useCallback(
    async (entityId: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const current = mat.current?.payload as DecisionRequestDraft | undefined;
        if (!current) return;
        await editRequest(entityId, { ...current, status: 'withdrawn' });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to withdraw decision request');
      }
    },
    [store, editRequest],
  );

  const recordDecision = useCallback(
    async (requestEntityId: string, draft: DecisionDraft): Promise<void> => {
      if (!store) return;
      try {
        // 1. The request's status becomes 'decided' via a new version.
        const records = await store.getRecordsByEntity(requestEntityId);
        const mat = materializeOne(records, requestEntityId);
        if (!mat) return;
        const current = mat.current?.payload as DecisionRequestDraft | undefined;
        if (current && current.status !== 'decided') {
          await writeRequestVersion(
            requestEntityId,
            mat.heads.map((h) => h.id),
            mat.current?.functionId ?? null,
            { ...current, status: 'decided' },
          );
        }
        // 2. The outcome itself is a new `decision` record.
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: crypto.randomUUID(),
          entityType: 'decision',
          incidentId,
          parentIds: [],
          functionId: mat.current?.functionId ?? null,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: { ...draft, requestId: requestEntityId },
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to record decision');
      }
    },
    [store, incidentId, authorId, deviceId, writeRequestVersion, refresh],
  );

  const retractRequest = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'decision_request',
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
        setError(err instanceof Error ? err.message : 'failed to retract decision request');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    requests,
    decisions,
    loading,
    error,
    createRequest,
    editRequest,
    withdrawRequest,
    recordDecision,
    retractRequest,
    refresh,
  };
}
