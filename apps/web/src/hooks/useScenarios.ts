// useScenarios — plan.md §5 / M19
//
// Contingency scenarios: create/edit (new version), retract with reason.
// Same offline-first flow as the other module hooks. Grouping is pure
// (groupScenarios in shared); the board renders horizon × likelihood.

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export type ScenarioHorizon = 'hours' | 'two_days' | 'two_weeks' | 'custom';
export type ScenarioLikelihood = 'probable' | 'possible';

export interface ScenarioView {
  entityId: string;
  current: RecordEnvelope | null;
  lastPut: RecordEnvelope | null;
  conflict: boolean;
  heads: RecordEnvelope[];
  history: RecordEnvelope[];
  retracted: boolean;
}

export interface ScenarioDraft {
  title: string;
  // plan.md §6: description required, implications optional.
  description: string;
  implications?: string;
  horizon: ScenarioHorizon;
  customHorizon?: string;
  likelihood: ScenarioLikelihood;
  contingencyPlan?: string;
  taskId?: string;
}

export interface UseScenariosResult {
  scenarios: ScenarioView[];
  loading: boolean;
  error: string;
  createScenario: (draft: ScenarioDraft) => Promise<void>;
  editScenario: (entityId: string, draft: ScenarioDraft) => Promise<void>;
  retractScenario: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useScenarios(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseScenariosResult {
  const [scenarios, setScenarios] = useState<ScenarioView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const scenarioRecords = records.filter((r) => r.entityType === 'scenario');
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of scenarioRecords) {
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const views: ScenarioView[] = [];
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
      setScenarios(views);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load scenarios');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const writeVersion = useCallback(
    async (
      entityId: string,
      parentIds: string[],
      functionId: string | null,
      draft: ScenarioDraft,
    ): Promise<void> => {
      if (!store) return;
      const state = loadHlcState();
      const { record, state: nextState } = newRecord({
        entityId,
        entityType: 'scenario',
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
      await refresh();
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const createScenario = useCallback(
    async (draft: ScenarioDraft): Promise<void> => {
      if (!store) return;
      try {
        await writeVersion(crypto.randomUUID(), [], null, draft);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to create scenario');
      }
    },
    [store, writeVersion],
  );

  // Edit = new version with the current heads as parents.
  const editScenario = useCallback(
    async (entityId: string, draft: ScenarioDraft): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        await writeVersion(
          entityId,
          mat.heads.map((h) => h.id),
          mat.current?.functionId ?? null,
          draft,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to edit scenario');
      }
    },
    [store, writeVersion],
  );

  const retractScenario = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'scenario',
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
        setError(err instanceof Error ? err.message : 'failed to retract scenario');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return { scenarios, loading, error, createScenario, editScenario, retractScenario, refresh };
}
