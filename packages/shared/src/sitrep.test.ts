// Sitrep selector tests — plan.md §5 / M35.
//
// Pure selector tested from fixtures. No React, no network.

import { describe, expect, it } from 'vitest';
import { hlcInitialState } from './hlc.js';
import { EntityType, newRecord, type RecordEnvelope } from './record.js';
import { selectSitrepSections } from './sitrep.js';

let hlcState = hlcInitialState();

let entitySeq = 0;

function makeRecord(opts: {
  entityType: EntityType;
  payload: unknown;
  kind?: 'put' | 'retract';
  functionId?: string | null;
  entityId?: string;
  parentIds?: string[];
  createdAtClient?: string;
}): RecordEnvelope {
  entitySeq += 1;
  const { record, state: nextState } = newRecord({
    entityId: opts.entityId ?? `entity-${entitySeq}`,
    entityType: opts.entityType,
    incidentId: 'incident-1',
    parentIds: opts.parentIds ?? [],
    functionId: opts.functionId ?? null,
    authorId: 'author-1',
    deviceId: 'device-1',
    createdAtClient: opts.createdAtClient ?? new Date().toISOString(),
    kind: opts.kind ?? 'put',
    schemaVersion: 1,
    payload: opts.payload,
    state: hlcState,
  });
  hlcState = nextState;
  return record;
}

describe('selectSitrepSections (M35)', () => {
  it('returns empty sections for an empty record bag', () => {
    const data = selectSitrepSections([]);
    expect(data.mission?.hasMission).toBe(false);
    expect(data.mission?.content).toBeNull();
    expect(data.direction?.hasDirection).toBe(false);
    expect(data.direction?.desired).toBeNull();
    expect(data.situation).toBeNull();
    expect(data.facts).toEqual([]);
    expect(data.decisions.requests).toEqual([]);
    expect(data.decisions.decisions).toEqual([]);
    expect(data.tasks).toEqual([]);
    expect(data.resources).toEqual([]);
    expect(data.timeline).toEqual([]);
    expect(data.map).toEqual([]);
  });

  it('assembles mission, direction, facts, tasks, resources, timeline, map', () => {
    const records = [
      makeRecord({
        entityType: EntityType.mission,
        entityId: 'mission-1',
        payload: {
          content: 'Skydda befintlig bebyggelse',
          staffShouldDo: 'Etablera avspärrningar',
          staffShouldNotDo: 'Gå in i farozonen',
          deadline: '2026-11-15T08:00:00Z',
          issuedBy: 'user-chief',
        },
      }),
      makeRecord({
        entityType: EntityType.direction,
        entityId: 'direction-1',
        payload: {
          desired: 'Fullständig utrymning',
          actual: 'Delvis utrymning',
          divergenceNote: 'Resursbrist',
          validFrom: '2026-11-14T08:00:00Z',
        },
      }),
      makeRecord({
        entityType: EntityType.factItem,
        entityId: 'fact-1',
        payload: {
          text: 'Branden är under kontroll',
          status: 'verified',
        },
      }),
      makeRecord({
        entityType: EntityType.factItem,
        entityId: 'fact-2',
        payload: {
          text: 'Okänt antal skadade',
          status: 'assumption',
        },
      }),
      makeRecord({
        entityType: EntityType.task,
        entityId: 'task-1',
        payload: {
          title: 'Avspärrningar',
          description: '',
          assigneeFunctionId: 'fn-1',
          assigneeUserId: null,
          priority: 'normal',
          status: 'todo',
          reportForm: 'none',
        },
      }),
      makeRecord({
        entityType: EntityType.task,
        entityId: 'task-2',
        payload: {
          title: 'Utredning',
          description: '',
          assigneeFunctionId: 'fn-2',
          assigneeUserId: null,
          priority: 'high',
          status: 'done',
          reportForm: 'none',
        },
      }),
      makeRecord({
        entityType: EntityType.resource,
        entityId: 'resource-1',
        payload: {
          name: 'Brandbil',
          type: 'vehicle',
          quantity: 2,
          status: 'deployed',
        },
      }),
      makeRecord({
        entityType: EntityType.timelineEvent,
        entityId: 'timeline-1',
        payload: {
          title: 'Larm',
          time: '2026-11-14T08:00:00Z',
          type: 'event',
          scope: 'internal',
        },
      }),
      makeRecord({
        entityType: EntityType.mapFeature,
        entityId: 'map-1',
        payload: {
          label: 'Uppsamlingplats',
          layer: 'situation',
          geometry: { type: 'Point', coordinates: [18.0, 59.0] },
          severity: 'info',
          validity: 'now',
        },
      }),
    ];

    const data = selectSitrepSections(records);

    expect(data.mission?.content).toBe('Skydda befintlig bebyggelse');
    expect(data.mission?.hasMission).toBe(true);
    expect(data.direction?.desired).toBe('Fullständig utrymning');
    expect(data.direction?.diverged).toBe(true);
    expect(data.situation).toBeNull();
    // Both facts present, sorted by status then text.
    expect(data.facts.map((f) => f.text)).toEqual([
      'Branden är under kontroll',
      'Okänt antal skadade',
    ]);
    // Only non-terminal tasks (task-2 is 'done' → excluded).
    expect(data.tasks.map((t) => t.title)).toEqual(['Avspärrningar']);
    expect(data.resources.map((r) => r.name)).toEqual(['Brandbil']);
    expect(data.timeline.map((t) => t.title)).toEqual(['Larm']);
    expect(data.map.map((m) => m.label)).toEqual(['Uppsamlingplats']);
  });

  it('excludes retracted records', () => {
    const base = makeRecord({
      entityType: EntityType.task,
      entityId: 'task-retracted',
      payload: {
        title: 'Uppgift',
        description: '',
        assigneeFunctionId: 'fn-1',
        assigneeUserId: null,
        priority: 'normal',
        status: 'todo',
        reportForm: 'none',
      },
    });
    const retract = makeRecord({
      entityType: EntityType.task,
      entityId: 'task-retracted',
      parentIds: [base.id],
      payload: { reason: 'Avbruten' },
      kind: 'retract',
    });

    const data = selectSitrepSections([base, retract]);
    expect(data.tasks).toEqual([]);
  });

  it('includes situation snapshot when present', () => {
    makeRecord({
      entityType: EntityType.situationSnapshot,
      entityId: 'sit-1',
      payload: {
        whatHappened: 'Brand i lokal',
        current: 'Under kontroll',
        consequences: 'Inga skador',
        protectedValues: ['life', 'property'],
      },
    });

    const data = selectSitrepSections([]);
    // The record was added to the shared hlcState but not passed to the function,
    // so it should not appear.
    expect(data.situation).toBeNull();

    const records = [
      makeRecord({
        entityType: EntityType.situationSnapshot,
        entityId: 'sit-2',
        payload: {
          whatHappened: 'Brand i lokal',
          current: 'Under kontroll',
          consequences: 'Inga skador',
          protectedValues: ['life', 'property'],
        },
      }),
    ];
    const data2 = selectSitrepSections(records);
    expect(data2.situation?.whatHappened).toBe('Brand i lokal');
    expect(data2.situation?.current).toBe('Under kontroll');
  });
});
