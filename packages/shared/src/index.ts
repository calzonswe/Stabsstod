// @stabsstod/shared — pure logic: record model, HLC, materialization, permissions, entity schemas.
export type { EntityType, RecordEnvelope, RetractPayload } from './record.js';
export { RecordEnvelopeSchema, newRecord } from './record.js';
export type { HLCState } from './hlc.js';
export { hlcInitialState, hlcFormat, hlcParse, hlcCompare, hlcTick, hlcReceive } from './hlc.js';
export type { Materialization } from './materialize.js';
export { materialize, materializeOne } from './materialize.js';
export type { FunctionPreset, TemplateText } from './presets.js';
export { FUNCTION_PRESETS, TEMPLATE_TEXTS, getPreset, getTemplate } from './presets.js';
export type { EntitySchema, LogEntryPayload, FactItemPayload } from './entityRegistry.js';
export { FactItemStatus, PROTECTED_VALUES } from './entityRegistry.js';
export type { SituationSnapshotPayload } from './entityRegistry.js';
export type { ScenarioPayload } from './entityRegistry.js';
export type { MissionPayload, DirectionPayload } from './entityRegistry.js';
export { ScenarioHorizon, ScenarioLikelihood } from './entityRegistry.js';
export type {
  DecisionRequestPayload,
  DecisionPayload,
  TaskPayload,
  TimelineEventPayload,
  BriefingPayload,
  BriefingReportPayload,
  ShiftPayload,
  HandoverNotePayload,
  ActorRelation,
  ActorPayload,
} from './entityRegistry.js';
export { TaskStatus, TaskPriority, TaskReportForm } from './entityRegistry.js';
export { TimelineEventType, TimelineEventScope } from './entityRegistry.js';
export { BriefingKind, BriefingStatus, BriefingRecurrenceSchema } from './entityRegistry.js';
export { ShiftRole } from './entityRegistry.js';
export { ActorStatus } from './entityRegistry.js';
export type { BriefingRecurrence } from './entityRegistry.js';
export type { TaskLike } from './tasks.js';
export { isTaskOverdue, groupTasksByStatus, TASK_STATUS_ORDER, TERMINAL_TASK_STATUSES } from './tasks.js';
export type { TimelineSource, TimelineItem, TimelineItemSources } from './timeline.js';
export {
  manualTimelineItems,
  taskDeadlineItems,
  decisionTimelineItems,
  briefingTimelineItems,
  shiftTimelineItems,
  deriveTimelineItems,
} from './timeline.js';
export type { ShiftInfo, ShiftWarning } from './shifts.js';
export {
  MAX_SHIFT_HOURS,
  MIN_HANDOVER_OVERLAP_MS,
  shiftIsTooLong,
  insufficientOverlapWarnings,
  chiefDecisionMakerChangingAtOnce,
  wholeFunctionChangingAtOnce,
  collectShiftWarnings,
  onDutyNow,
} from './shifts.js';
export type { OccurrenceOptions, NextBriefing } from './briefings.js';
export { briefingOccurrences, nextBriefingTime } from './briefings.js';
export type { DiffLine } from './diff.js';
export { diffLines, renderSnapshotText } from './diff.js';
export { getEntitySchema, validateEntityPayload } from './entityRegistry.js';
export type { ScenarioGroup, ScenarioGroupItem } from './scenarios.js';
export { groupScenarios, HORIZON_ORDER, LIKELIHOOD_ORDER } from './scenarios.js';
export type { Actor, IncidentRole, Action, RecordLike, CanContext } from './permissions.js';
export { can } from './permissions.js';
