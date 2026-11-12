// useTasks — plan.md §5 / M22
//
// Tasks (stabsarbetsplan items): create, edit (new version), move status
// (new version), cancel (new version), retract with reason. List per
// incident, offline-first flow as the other module hooks. The record's
// functionId is the task's assignee function — that is what can() gates on.

import { useCallback, useEffect, useState } from 'react';
import {
  materializeOne,
  newRecord,
  type RecordEnvelope,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export interface TaskDraft {
  title: string;
  description: string;
  assigneeFunctionId: string;
  assigneeUserId?: string;
  due?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'proposed' | 'todo' | 'doing' | 'blocked' | 'done' | 'cancelled';
  reportForm: 'oral' | 'written' | 'none';
  parentTaskId?: string;
}

export interface TaskView {
  entityId: string;
  current: RecordEnvelope | null;
  lastPut: RecordEnvelope | null;
  conflict: boolean;
  heads: RecordEnvelope[];
  history: RecordEnvelope[];
  retracted: boolean;
}

export interface UseTasksResult {
  tasks: TaskView[];
  loading: boolean;
  error: string;
  createTask: (draft: TaskDraft) => Promise<void>;
  editTask: (entityId: string, draft: TaskDraft) => Promise<void>;
  moveTask: (entityId: string, status: TaskDraft['status']) => Promise<void>;
  cancelTask: (entityId: string) => Promise<void>;
  retractTask: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useTasks(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseTasksResult {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of records.filter((r) => r.entityType === 'task')) {
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const views: TaskView[] = [];
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
      setTasks(views);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const writeTaskVersion = useCallback(
    async (
      entityId: string,
      parentIds: string[],
      functionId: string | null,
      draft: TaskDraft,
    ): Promise<void> => {
      if (!store) return;
      const state = loadHlcState();
      const { record, state: nextState } = newRecord({
        entityId,
        entityType: 'task',
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

  const createTask = useCallback(
    async (draft: TaskDraft): Promise<void> => {
      if (!store) return;
      try {
        await writeTaskVersion(
          crypto.randomUUID(),
          [],
          draft.assigneeFunctionId,
          draft,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to create task');
      }
    },
    [store, writeTaskVersion, refresh],
  );

  // Edit = new version with the current heads as parents.
  const editTask = useCallback(
    async (entityId: string, draft: TaskDraft): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        await writeTaskVersion(
          entityId,
          mat.heads.map((h) => h.id),
          mat.current?.functionId ?? draft.assigneeFunctionId,
          draft,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to edit task');
      }
    },
    [store, writeTaskVersion, refresh],
  );

  // Status change (kanban move) = new version, same payload + new status.
  const moveTask = useCallback(
    async (entityId: string, status: TaskDraft['status']): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        const current = mat?.current?.payload as TaskDraft | undefined;
        if (!mat || !current) return;
        await writeTaskVersion(
          entityId,
          mat.heads.map((h) => h.id),
          mat.current?.functionId ?? current.assigneeFunctionId,
          { ...current, status },
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to move task');
      }
    },
    [store, writeTaskVersion, refresh],
  );

  const cancelTask = useCallback(
    async (entityId: string): Promise<void> => {
      await moveTask(entityId, 'cancelled');
    },
    [moveTask],
  );

  const retractTask = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'task',
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
        setError(err instanceof Error ? err.message : 'failed to retract task');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    tasks,
    loading,
    error,
    createTask,
    editTask,
    moveTask,
    cancelTask,
    retractTask,
    refresh,
  };
}
