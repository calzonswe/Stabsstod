// useTimeline — plan.md §5 / M23
//
// Timeline (tidslinjal): manual timeline_event records plus **derived** items
// (task deadlines, decisions — briefings/shifts arrive in M24/M25). Same
// offline-first flow as the other module hooks: writes go to the local Dexie
// store first, then sync.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  materializeOne,
  newRecord,
  deriveTimelineItems,
  manualTimelineItems,
  taskDeadlineItems,
  decisionTimelineItems,
  briefingTimelineItems,
  shiftTimelineItems,
  type BriefingPayload,
  type DecisionPayload,
  type RecordEnvelope,
  type ShiftPayload,
  type TaskPayload,
  type TimelineEventPayload,
  type TimelineItem,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export interface TimelineEventDraft {
  title: string;
  time: string;
  endTime?: string;
  type: TimelineEventPayload['type'];
  scope: TimelineEventPayload['scope'];
}

export interface ManualEventEntry {
  entityId: string;
  functionId: string | null;
  retracted: boolean;
}

interface TimelineData {
  events: (ManualEventEntry & { current: RecordEnvelope | null })[];
  tasks: { entityId: string; payload: TaskPayload }[];
  decisions: { entityId: string; payload: DecisionPayload }[];
  briefings: { entityId: string; payload: BriefingPayload }[];
  shifts: { entityId: string; payload: ShiftPayload }[];
}

export interface UseTimelineResult {
  items: TimelineItem[];
  manualEvents: ManualEventEntry[];
  loading: boolean;
  error: string;
  createEvent: (draft: TimelineEventDraft, functionId: string | null) => Promise<void>;
  retractEvent: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useTimeline(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseTimelineResult {
  const [data, setData] = useState<TimelineData>({ events: [], tasks: [], decisions: [], briefings: [], shifts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const byEntity = (entityType: string): Map<string, RecordEnvelope[]> => {
        const m = new Map<string, RecordEnvelope[]>();
        for (const r of records) {
          if (r.entityType !== entityType) continue;
          const list = m.get(r.entityId) ?? [];
          list.push(r);
          m.set(r.entityId, list);
        }
        return m;
      };
      const events = [...byEntity('timeline_event').entries()]
        .map(([entityId, recs]) => {
          const mat = materializeOne(recs, entityId);
          if (!mat) return null;
          return {
            entityId,
            current: mat.current,
            retracted: mat.retracted,
            functionId: mat.current?.functionId ?? null,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      const tasks = [...byEntity('task').entries()]
        .map(([entityId, recs]) => {
          const mat = materializeOne(recs, entityId);
          return mat && !mat.retracted && mat.current
            ? { entityId, payload: mat.current.payload as TaskPayload }
            : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      const decisions = [...byEntity('decision').entries()]
        .map(([entityId, recs]) => {
          const mat = materializeOne(recs, entityId);
          return mat && !mat.retracted && mat.current
            ? { entityId, payload: mat.current.payload as DecisionPayload }
            : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      const briefings = [...byEntity('briefing').entries()]
        .map(([entityId, recs]) => {
          const mat = materializeOne(recs, entityId);
          return mat && !mat.retracted && mat.current
            ? { entityId, payload: mat.current.payload as BriefingPayload }
            : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      const shifts = [...byEntity('shift').entries()]
        .map(([entityId, recs]) => {
          const mat = materializeOne(recs, entityId);
          return mat && !mat.retracted && mat.current
            ? { entityId, payload: mat.current.payload as ShiftPayload }
            : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      setData({ events, tasks, decisions, briefings, shifts });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load timeline');
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

  const items = useMemo(
    () =>
      deriveTimelineItems({
        manual: manualTimelineItems(
          data.events
            .filter((e) => !e.retracted && e.current)
            .map((e) => ({
              entityId: e.entityId,
              payload: e.current!.payload as TimelineEventPayload,
            })),
        ),
        tasks: taskDeadlineItems(data.tasks),
        decisions: decisionTimelineItems(data.decisions),
        // Bounded so an unbounded recurring briefing cannot flood the timeline.
        briefings: briefingTimelineItems(data.briefings, {
          horizonEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        }),
        // Shifts are finite (start–end), so no horizon is needed.
        shifts: shiftTimelineItems(data.shifts),
      }),
    [data],
  );

  const manualEvents = useMemo(
    () => data.events.map((e) => ({ entityId: e.entityId, functionId: e.functionId, retracted: e.retracted })),
    [data],
  );

  const createEvent = useCallback(
    async (draft: TimelineEventDraft, functionId: string | null): Promise<void> => {
      if (!store) return;
      try {
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: crypto.randomUUID(),
          entityType: 'timeline_event',
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
        setError(err instanceof Error ? err.message : 'failed to create timeline event');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  const retractEvent = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const mat = materializeOne(records, entityId);
        if (!mat) return;
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'timeline_event',
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
        setError(err instanceof Error ? err.message : 'failed to retract timeline event');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    items,
    manualEvents,
    loading,
    error,
    createEvent,
    retractEvent,
    refresh,
  };
}
