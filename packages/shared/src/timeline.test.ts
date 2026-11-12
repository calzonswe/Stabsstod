// timeline tests — M23
//
// Derivation (plan.md §10 M23 "Accept: derivation unit tests"): manual events,
// task deadlines and decisions are mapped to timeline items and merged into a
// single list sorted by event time.

import { describe, expect, it } from 'vitest';
import {
  deriveTimelineItems,
  manualTimelineItems,
  taskDeadlineItems,
  decisionTimelineItems,
  type TimelineItem,
} from './timeline.js';
import type { TaskPayload, DecisionPayload, TimelineEventPayload } from './entityRegistry.js';

const eventBase: TimelineEventPayload = {
  title: 'Stabsorientering',
  time: '2026-11-12T09:00:00Z',
  type: 'meeting',
  scope: 'internal',
};

const taskBase: TaskPayload = {
  title: 'Beställ vattenprover',
  description: '',
  assigneeFunctionId: 'fn-1',
  due: '2026-11-12T12:00:00Z',
  priority: 'normal',
  status: 'todo',
  reportForm: 'none',
};

const decisionBase: DecisionPayload = {
  requestId: 'dr-1',
  text: 'Uppgradera systemet',
  decidedByUserId: 'user-dm',
  decidedAt: '2026-11-12T11:00:00Z',
  mandate: 'decision_maker',
};

describe('manualTimelineItems', () => {
  it('maps each timeline_event payload to a manual item', () => {
    const items = manualTimelineItems([
      { entityId: 'te-1', payload: { ...eventBase, endTime: '2026-11-12T10:00:00Z' } },
      { entityId: 'te-2', payload: { ...eventBase, title: 'Extern pressmöte', scope: 'external', type: 'external' } },
    ]);
    expect(items).toEqual([
      {
        id: 'manual:te-1',
        source: 'manual',
        title: 'Stabsorientering',
        time: '2026-11-12T09:00:00Z',
        endTime: '2026-11-12T10:00:00Z',
        type: 'meeting',
        scope: 'internal',
        refEntityId: 'te-1',
      },
      {
        id: 'manual:te-2',
        source: 'manual',
        title: 'Extern pressmöte',
        time: '2026-11-12T09:00:00Z',
        endTime: undefined,
        type: 'external',
        scope: 'external',
        refEntityId: 'te-2',
      },
    ]);
  });
});

describe('taskDeadlineItems', () => {
  it('only tasks with a due time appear, as internal deadline items', () => {
    const items = taskDeadlineItems([
      { entityId: 't-1', payload: taskBase },
      { entityId: 't-2', payload: { ...taskBase, due: undefined, title: 'Ingen deadline' } },
    ]);
    expect(items).toEqual([
      {
        id: 'task:t-1',
        source: 'task',
        title: 'Beställ vattenprover',
        time: '2026-11-12T12:00:00Z',
        type: 'deadline',
        scope: 'internal',
        refEntityId: 't-1',
      },
    ]);
  });
});

describe('decisionTimelineItems', () => {
  it('maps each recorded decision to an internal decision item at decidedAt', () => {
    const items = decisionTimelineItems([
      { entityId: 'd-1', payload: decisionBase },
    ]);
    expect(items).toEqual([
      {
        id: 'decision:d-1',
        source: 'decision',
        title: 'Uppgradera systemet',
        time: '2026-11-12T11:00:00Z',
        type: 'decision',
        scope: 'internal',
        refEntityId: 'd-1',
      },
    ]);
  });
});

describe('deriveTimelineItems', () => {
  it('returns an empty list for empty sources', () => {
    expect(deriveTimelineItems({ manual: [] })).toEqual([]);
  });

  it('merges manual, task and decision items sorted by time', () => {
    const manual: TimelineItem[] = [
      {
        id: 'manual:te-1',
        source: 'manual',
        title: 'Möte',
        time: '2026-11-12T09:00:00Z',
        type: 'meeting',
        scope: 'internal',
      },
    ];
    const items = deriveTimelineItems({
      manual,
      tasks: taskDeadlineItems([{ entityId: 't-1', payload: taskBase }]),
      decisions: decisionTimelineItems([{ entityId: 'd-1', payload: decisionBase }]),
    });
    expect(items.map((i) => i.id)).toEqual([
      'manual:te-1', // 09:00
      'decision:d-1', // 11:00
      'task:t-1', // 12:00
    ]);
  });

  it('keeps a stable order for items sharing a time', () => {
    const items = deriveTimelineItems({
      manual: [
        { id: 'manual:a', source: 'manual', title: 'a', time: '2026-11-12T09:00:00Z', type: 'meeting', scope: 'internal' },
        { id: 'manual:b', source: 'manual', title: 'b', time: '2026-11-12T09:00:00Z', type: 'other', scope: 'external' },
      ],
      decisions: [
        { id: 'decision:c', source: 'decision', title: 'c', time: '2026-11-12T09:00:00Z', type: 'decision', scope: 'internal' },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['manual:a', 'manual:b', 'decision:c']);
  });

  it('accepts optional briefings/shifts sources (M24/M25)', () => {
    const items = deriveTimelineItems({
      manual: [],
      briefings: [
        { id: 'briefing:b-1', source: 'briefing', title: 'Briefing', time: '2026-11-12T08:00:00Z', type: 'meeting', scope: 'internal' },
      ],
      shifts: [
        { id: 'shift:s-1', source: 'shift', title: 'Vakthållning', time: '2026-11-12T10:00:00Z', type: 'other', scope: 'internal' },
      ],
    });
    expect(items.map((i) => i.source)).toEqual(['briefing', 'shift']);
  });
});
