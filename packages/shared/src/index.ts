// @stabsstod/shared — pure logic: record model, HLC, materialization, permissions, entity schemas.
export type { EntityType, RecordEnvelope, RetractPayload } from './record.js';
export { RecordEnvelopeSchema, newRecord } from './record.js';
export type { HLCState } from './hlc.js';
export { hlcInitialState, hlcFormat, hlcParse, hlcCompare, hlcTick, hlcReceive } from './hlc.js';
export type { Materialization } from './materialize.js';
export { materialize, materializeOne } from './materialize.js';
export type { FunctionPreset, TemplateText } from './presets.js';
export { FUNCTION_PRESETS, TEMPLATE_TEXTS, getPreset, getTemplate } from './presets.js';
export type { EntitySchema, LogEntryPayload } from './entityRegistry.js';
export { getEntitySchema, validateEntityPayload } from './entityRegistry.js';
export type { Actor, IncidentRole, Action, RecordLike, CanContext } from './permissions.js';
export { can } from './permissions.js';
