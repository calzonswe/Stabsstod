// @stabsstod/shared — pure logic: record model, HLC, materialization, permissions, entity schemas.
export type { EntityType, RecordEnvelope, RetractPayload } from './record.js';
export { RecordEnvelopeSchema } from './record.js';
export type { FunctionPreset, TemplateText } from './presets.js';
export { FUNCTION_PRESETS, TEMPLATE_TEXTS, getPreset, getTemplate } from './presets.js';
export type { Actor, IncidentRole, Action, RecordLike, CanContext } from './permissions.js';
export { can } from './permissions.js';
