// Sitrep data selection — plan.md §5 / M35.
//
// Pure selectors that assemble all sitrep sections from the incident's
// record bag. Used both by the print view (rendered live from local records,
// works offline) and when saving a sitrep (the returned data is frozen into
// the sitrep record's `snapshot` so it can be re-printed later exactly as
// it was at save time).

import {
  EntityType,
  type RecordEnvelope,
} from './record.js';
import {
  currentPayloads,
  selectMission,
  selectDirection,
  type MissionWidget,
  type DirectionWidget,
} from './dashboard.js';
import {
  type FactItemPayload,
  type DecisionRequestPayload,
  type DecisionPayload,
  type TaskPayload,
  type ResourcePayload,
  type TimelineEventPayload,
  type MapFeaturePayload,
  type SituationSnapshotPayload,
} from './entityRegistry.js';

/** Non-terminal task statuses — a task still counts as "open". */
const NON_TERMINAL_STATUSES = new Set([
  'proposed',
  'todo',
  'doing',
  'blocked',
]);

/**
 * All sitrep sections derived from the incident's record bag.
 *
 * `now` (epoch ms) is injected so time-bound rules (e.g. overdue tasks) are
 * deterministic in tests. Reserved for future use — currently all non-terminal
 * tasks are shown regardless of due time.
 */
export interface SitrepSectionData {
  mission: MissionWidget | null;
  direction: DirectionWidget | null;
  /** The current situation snapshot, or null if none exists. */
  situation: SituationSnapshotPayload | null;
  /** All current (non-retracted) fact items. */
  facts: FactItemPayload[];
  /** Open decision requests and recorded decisions. */
  decisions: {
    requests: DecisionRequestPayload[];
    decisions: DecisionPayload[];
  };
  /** All non-terminal tasks. */
  tasks: TaskPayload[];
  /** All current (non-retracted) resources. */
  resources: ResourcePayload[];
  /** All current (non-retracted) timeline events, sorted by time. */
  timeline: TimelineEventPayload[];
  /** All current (non-retracted) map features. */
  map: MapFeaturePayload[];
}

export function selectSitrepSections(records: RecordEnvelope[]): SitrepSectionData {
  const mission = selectMission(records);
  const direction = selectDirection(records);

  const situation =
    currentPayloads<SituationSnapshotPayload>(records, EntityType.situationSnapshot)[0] ??
    null;

  const facts = currentPayloads<FactItemPayload>(records, EntityType.factItem).sort(
    (a, b) => {
      const order = { verified: 0, assumption: 1, info_need: 2, refuted: 3 };
      return (
        (order[a.status ?? 'info_need'] ?? 2) - (order[b.status ?? 'info_need'] ?? 2) ||
        a.text.localeCompare(b.text)
      );
    },
  );

  const decisionRequests = currentPayloads<DecisionRequestPayload>(
    records,
    EntityType.decisionRequest,
  ).filter((dr) => dr.status === 'open');
  decisionRequests.sort((a, b) => {
    const ta = new Date(a.neededBy ?? '').getTime();
    const tb = new Date(b.neededBy ?? '').getTime();
    return ta - tb;
  });
  const decisions = currentPayloads<DecisionPayload>(records, EntityType.decision);

  const tasks = currentPayloads<TaskPayload>(records, EntityType.task).filter(
    (t) => NON_TERMINAL_STATUSES.has(t.status),
  );
  tasks.sort((a, b) => {
    const da = a.due ? new Date(a.due).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.due ? new Date(b.due).getTime() : Number.MAX_SAFE_INTEGER;
    return da - db || a.title.localeCompare(b.title);
  });

  const resources = currentPayloads<ResourcePayload>(records, EntityType.resource).sort(
    (a, b) => a.name.localeCompare(b.name),
  );

  const timeline = currentPayloads<TimelineEventPayload>(records, EntityType.timelineEvent).sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );

  const map = currentPayloads<MapFeaturePayload>(records, EntityType.mapFeature).sort(
    (a, b) => a.label.localeCompare(b.label),
  );

  return {
    mission,
    direction,
    situation,
    facts,
    decisions: { requests: decisionRequests, decisions },
    tasks,
    resources,
    timeline,
    map,
  };
}

export type { SitrepPayload } from './entityRegistry.js';
