import { EntityType } from './record.js';

// ---------------------------------------------------------------------------
// Roles and permissions — plan.md §7
//
// One pure function `can(actor, action, recordOrDraft, context)` used by both
// the server (authoritative) and the client (to hide/disable UI).
//
// Incident roles: chief_of_staff | deputy_chief | function_lead |
// staff_member | decision_maker | observer.
//
// Read: every incident member can read every record of that incident.
//
// Write rule (default): a user may create a record (or a new version) whose
// functionId is one of the user's functions in this incident.
// chief_of_staff and deputy_chief may write any functionId, including null.
//
// Type gates (override the default) per entityType — see plan.md §7.
// ---------------------------------------------------------------------------

export type IncidentRole =
  | 'chief_of_staff'
  | 'deputy_chief'
  | 'function_lead'
  | 'staff_member'
  | 'decision_maker'
  | 'observer';

export type Action = 'read' | 'write' | 'retract';

export interface Actor {
  userId: string;
  incidentId: string;
  role: IncidentRole;
  functionIds: string[]; // functions this actor is a member of in this incident
}

export interface RecordLike {
  entityType: EntityType;
  incidentId: string;
  functionId: string | null;
  authorId?: string;
  status?: string; // task status (proposed, todo, doing, …)
  mandate?: 'decision_maker' | 'delegated_chief'; // decision mandate
}

export interface RecordLike {
  entityType: EntityType;
  incidentId: string;
  functionId: string | null;
  authorId?: string;
  status?: string; // task status (proposed, todo, doing, …)
  mandate?: 'decision_maker' | 'delegated_chief'; // decision mandate
}

export interface RecordLike {
  entityType: EntityType;
  incidentId: string;
  functionId: string | null;
  authorId?: string;
  status?: string; // task status (proposed, todo, doing, …)
  mandate?: 'decision_maker' | 'delegated_chief'; // decision mandate
}

// Reserved for future context; kept for signature stability per plan.md §7.
export type CanContext = unknown;

// Incident-wide (null) functionId may only be written by chief/deputy.
const CHIEF_OR_DEPUTY: Set<IncidentRole> = new Set(['chief_of_staff', 'deputy_chief']);

// Entity types that only chief_of_staff / deputy_chief may write.
const CHIEF_DEPUTY_WRITE: Set<EntityType> = new Set([
  EntityType.briefing,
  EntityType.shift,
  EntityType.direction,
  EntityType.closurePlan,
]);

function defaultWriteAllowed(actor: Actor, functionId: string | null): boolean {
  const isOwnFunction = functionId != null && actor.functionIds.includes(functionId);
  return isOwnFunction || CHIEF_OR_DEPUTY.has(actor.role);
}

function canWrite(actor: Actor, r: RecordLike): boolean {
  // Observers may write nothing.
  if (actor.role === 'observer') {
    return false;
  }

  switch (r.entityType) {
    case EntityType.mission:
      return ['decision_maker', 'chief_of_staff', 'deputy_chief'].includes(actor.role);

    case EntityType.decision:
      if (actor.role === 'decision_maker') {
        return true;
      }
      if (actor.role === 'chief_of_staff') {
        return r.mandate === 'delegated_chief';
      }
      return false;

    case EntityType.decisionRequest:
      return defaultWriteAllowed(actor, r.functionId);

    case EntityType.timelineEvent:
      if (CHIEF_OR_DEPUTY.has(actor.role)) {
        return true;
      }
      if (actor.role === 'function_lead') {
        return defaultWriteAllowed(actor, r.functionId);
      }
      return false;

    case EntityType.task:
      if (CHIEF_OR_DEPUTY.has(actor.role) || actor.role === 'function_lead') {
        return true;
      }
      // Others may create only 'proposed' tasks, and only for their own function.
      return r.status === 'proposed' && defaultWriteAllowed(actor, r.functionId);

    case EntityType.briefingReport:
      return defaultWriteAllowed(actor, r.functionId); // members of reporting function

    case EntityType.handoverNote:
      return defaultWriteAllowed(actor, r.functionId);

    default:
      if (CHIEF_DEPUTY_WRITE.has(r.entityType)) {
        return CHIEF_OR_DEPUTY.has(actor.role);
      }
      return defaultWriteAllowed(actor, r.functionId);
  }
}

export function can(
  actor: Actor,
  action: Action,
  recordOrDraft: RecordLike | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context: CanContext,
): boolean {
  const r = recordOrDraft;
  if (!r) {
    return false;
  }
  // The actor must be a member of the record's incident.
  if (actor.incidentId !== r.incidentId) {
    return false;
  }

  if (action === 'read') {
    // Every incident member can read every record of that incident.
    return true;
  }

  if (action === 'retract') {
    // The record's author, or chief_of_staff / deputy_chief.
    return (r.authorId != null && r.authorId === actor.userId) || CHIEF_OR_DEPUTY.has(actor.role);
  }

  // action === 'write'
  return canWrite(actor, r);
}
