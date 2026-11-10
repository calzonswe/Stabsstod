import { describe, expect, it } from 'vitest';
import { can, type Actor, type RecordLike } from './permissions.js';
import { EntityType } from './record.js';

// ---------------------------------------------------------------------------
// can() — table-driven permission matrix (plan.md §7)
//
// Roles × entity types × own/foreign function × action (write / retract).
// Read is always allowed for any incident member and is not part of the
// matrix below.
// ---------------------------------------------------------------------------

const INCIDENT = 'incident-1';

function actor(role: Actor['role'], functionIds: string[] = [], userId = 'user-1'): Actor {
  return { userId, incidentId: INCIDENT, role, functionIds };
}

function record(overrides: Partial<RecordLike> = {}): RecordLike {
  return {
    entityType: EntityType.logEntry,
    incidentId: INCIDENT,
    functionId: 'fn-1',
    authorId: 'user-1',
    ...overrides,
  };
}

const OWN_FN = 'fn-1';
const FOREIGN_FN = 'fn-99';

function ownFnActor(role: Actor['role']): Actor {
  return actor(role, [OWN_FN]);
}

describe('can() permission matrix (plan.md §7)', () => {
  describe('read — every incident member can read', () => {
    it.each([
      'chief_of_staff',
      'deputy_chief',
      'function_lead',
      'staff_member',
      'decision_maker',
      'observer',
    ] as const)('allows %s to read any record of the incident', (role) => {
      expect(can(actor(role), 'read', record(), {})).toBe(true);
    });

    it('denies read to a user not in the incident', () => {
      const other = actor('staff_member', [], 'user-2');
      other.incidentId = 'incident-2';
      expect(can(other, 'read', record(), {})).toBe(false);
    });
  });

  describe('write — default rule: own function or chief/deputy', () => {
    it.each([
      ['chief_of_staff', OWN_FN, true],
      ['chief_of_staff', FOREIGN_FN, true],
      ['chief_of_staff', null, true],
      ['deputy_chief', OWN_FN, true],
      ['deputy_chief', FOREIGN_FN, true],
      ['deputy_chief', null, true],
      ['function_lead', OWN_FN, true],
      ['function_lead', FOREIGN_FN, false],
      ['function_lead', null, false],
      ['staff_member', OWN_FN, true],
      ['staff_member', FOREIGN_FN, false],
      ['staff_member', null, false],
      ['decision_maker', OWN_FN, true],
      ['decision_maker', FOREIGN_FN, false],
      ['decision_maker', null, false],
      ['observer', OWN_FN, false],
      ['observer', FOREIGN_FN, false],
      ['observer', null, false],
    ] as const)('default write: role=%s functionId=%s => %s', (role, functionId, expected) => {
      // Actor is always a member of OWN_FN; record.functionId decides own vs foreign.
      const a = actor(role, [OWN_FN]);
      expect(can(a, 'write', record({ functionId }), {})).toBe(expected);
    });
  });

  describe('write — type gates override the default', () => {
    it.each([
      // mission: decision_maker, chief_of_staff, deputy_chief
      [EntityType.mission, 'decision_maker', OWN_FN, true],
      [EntityType.mission, 'chief_of_staff', FOREIGN_FN, true],
      [EntityType.mission, 'deputy_chief', null, true],
      [EntityType.mission, 'function_lead', OWN_FN, false],
      [EntityType.mission, 'staff_member', OWN_FN, false],
      [EntityType.mission, 'observer', OWN_FN, false],
      // decision: decision_maker always; chief_of_staff only with delegated_chief
      [EntityType.decision, 'decision_maker', FOREIGN_FN, true],
      [EntityType.decision, 'chief_of_staff', OWN_FN, false],
      [EntityType.decision, 'chief_of_staff', null, false],
      [EntityType.decision, 'deputy_chief', OWN_FN, false],
      // decision_request: any writer for own function (default rule)
      [EntityType.decisionRequest, 'staff_member', OWN_FN, true],
      [EntityType.decisionRequest, 'staff_member', FOREIGN_FN, false],
      [EntityType.decisionRequest, 'chief_of_staff', null, true],
      // briefing / shift / direction / closurePlan: chief / deputy only
      [EntityType.briefing, 'chief_of_staff', OWN_FN, true],
      [EntityType.briefing, 'deputy_chief', FOREIGN_FN, true],
      [EntityType.briefing, 'staff_member', OWN_FN, false],
      [EntityType.shift, 'chief_of_staff', OWN_FN, true],
      [EntityType.shift, 'function_lead', OWN_FN, false],
      [EntityType.direction, 'deputy_chief', OWN_FN, true],
      [EntityType.closurePlan, 'chief_of_staff', OWN_FN, true],
      [EntityType.closurePlan, 'staff_member', OWN_FN, false],
      // timeline_event: chief/deputy any; function_lead own function
      [EntityType.timelineEvent, 'chief_of_staff', null, true],
      [EntityType.timelineEvent, 'deputy_chief', FOREIGN_FN, true],
      [EntityType.timelineEvent, 'function_lead', OWN_FN, true],
      [EntityType.timelineEvent, 'function_lead', FOREIGN_FN, false],
      [EntityType.timelineEvent, 'staff_member', OWN_FN, false],
      // task: chief/deputy/function_lead any; others only proposed + own function
      [EntityType.task, 'chief_of_staff', FOREIGN_FN, true],
      [EntityType.task, 'deputy_chief', null, true],
      [EntityType.task, 'function_lead', FOREIGN_FN, true],
      [EntityType.task, 'staff_member', OWN_FN, false], // not proposed → denied
      // briefing_report: members of reporting function (default rule)
      [EntityType.briefingReport, 'staff_member', OWN_FN, true],
      [EntityType.briefingReport, 'staff_member', FOREIGN_FN, false],
      [EntityType.briefingReport, 'chief_of_staff', null, true],
      // handover_note: default rule
      [EntityType.handoverNote, 'staff_member', OWN_FN, true],
      [EntityType.handoverNote, 'staff_member', FOREIGN_FN, false],
    ] as const)(
      'type gate: entity=%s role=%s functionId=%s => %s',
      (
        entityType: EntityType,
        role: Actor['role'],
        functionId: string | null,
        expected: boolean,
      ) => {
        // Actor is always a member of OWN_FN; record.functionId decides own vs foreign.
        const a = actor(role, [OWN_FN]);
        expect(can(a, 'write', record({ entityType, functionId }), {})).toBe(expected);
      },
    );

    it('decision: chief_of_staff writes when mandate=delegated_chief', () => {
      const a = ownFnActor('chief_of_staff');
      expect(
        can(
          a,
          'write',
          record({
            entityType: EntityType.decision,
            mandate: 'delegated_chief',
          }),
          {},
        ),
      ).toBe(true);
    });

    it('decision: chief_of_staff does NOT write when mandate=decision_maker', () => {
      const a = ownFnActor('chief_of_staff');
      expect(
        can(
          a,
          'write',
          record({
            entityType: EntityType.decision,
            mandate: 'decision_maker',
          }),
          {},
        ),
      ).toBe(false);
    });

    it('decision: deputy_chief does NOT write even with delegated_chief', () => {
      const a = ownFnActor('deputy_chief');
      expect(
        can(
          a,
          'write',
          record({
            entityType: EntityType.decision,
            mandate: 'delegated_chief',
          }),
          {},
        ),
      ).toBe(false);
    });

    it('task: non-chief/deputy/lead may create proposed task for own function', () => {
      const a = actor('staff_member', [OWN_FN]);
      expect(
        can(
          a,
          'write',
          record({
            entityType: EntityType.task,
            functionId: OWN_FN,
            status: 'proposed',
          }),
          {},
        ),
      ).toBe(true);
    });

    it('task: non-chief/deputy/lead may NOT create non-proposed task', () => {
      const a = actor('staff_member', [OWN_FN]);
      expect(
        can(
          a,
          'write',
          record({
            entityType: EntityType.task,
            functionId: OWN_FN,
            status: 'todo',
          }),
          {},
        ),
      ).toBe(false);
    });

    it('task: staff_member writing foreign function is denied even when proposed', () => {
      const a = actor('staff_member', [OWN_FN]);
      expect(
        can(
          a,
          'write',
          record({
            entityType: EntityType.task,
            functionId: FOREIGN_FN,
            status: 'proposed',
          }),
          {},
        ),
      ).toBe(false);
    });
  });

  describe('retract — author or chief/deputy', () => {
    it.each([
      ['chief_of_staff', 'user-1', true],
      ['chief_of_staff', 'user-2', true],
      ['deputy_chief', 'user-99', true],
      ['function_lead', 'user-1', true],
      ['function_lead', 'user-2', false],
      ['staff_member', 'user-1', true],
      ['staff_member', 'user-2', false],
      ['decision_maker', 'user-1', true],
      ['decision_maker', 'user-2', false],
      ['observer', 'user-1', true], // observer who authored it can retract (author rule)
    ] as const)('retract: role=%s author=%s => %s', (role, authorId, expected) => {
      const a = ownFnActor(role);
      expect(can(a, 'retract', record({ authorId }), {})).toBe(expected);
    });

    it('retract: denies when authorId is missing and actor is not chief/deputy', () => {
      const a = ownFnActor('staff_member');
      expect(can(a, 'retract', record({ authorId: undefined }), {})).toBe(false);
    });

    it('retract: denies when record is in another incident', () => {
      const a = ownFnActor('chief_of_staff');
      expect(can(a, 'retract', record({ incidentId: 'incident-2' }), {})).toBe(false);
    });
  });

  describe('write — safety edges', () => {
    it('denies write when actor is not in the record incident', () => {
      const a = actor('chief_of_staff', [OWN_FN], 'user-1');
      a.incidentId = 'incident-2';
      expect(can(a, 'write', record(), {})).toBe(false);
    });

    it('denies write for null recordOrDraft', () => {
      expect(can(ownFnActor('chief_of_staff'), 'write', null, {})).toBe(false);
    });

    it('denies write when entityType is unknown (falls back to default rule)', () => {
      const a = ownFnActor('staff_member');
      expect(
        can(
          a,
          'write',
          record({ entityType: 'unknownEntity' as EntityType, functionId: OWN_FN }),
          {},
        ),
      ).toBe(true);
    });
  });
});
