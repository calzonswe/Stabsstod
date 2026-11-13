// fact_item schema tests — M17
//
// The fact_item payload carries a board status (vet/antar/vet ej + refuted)
// and is validated on server ingest. Status transitions are new versions of
// the same entity — history is the caller's job (materialize), validated in
// the web tests.

import { describe, expect, it } from 'vitest';
import { EntityType } from './record.js';
import { validateEntityPayload } from './entityRegistry.js';

const validBase = {
  text: 'Eldslösa i lager 3 under kontroll',
  status: 'verified',
};

describe('fact_item payload schema', () => {
  it('accepts a valid fact with all board statuses', () => {
    for (const status of ['verified', 'assumption', 'info_need', 'refuted']) {
      const result = validateEntityPayload(EntityType.factItem, {
        ...validBase,
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional source and log entry link', () => {
    const result = validateEntityPayload(EntityType.factItem, {
      ...validBase,
      source: ' Räddningstjänsten via radio',
      logEntryId: 'abc-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = validateEntityPayload(EntityType.factItem, {
      ...validBase,
      status: 'maybe',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty text', () => {
    const result = validateEntityPayload(EntityType.factItem, {
      ...validBase,
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing status', () => {
    const result = validateEntityPayload(EntityType.factItem, {
      text: 'Ingen status',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-object payloads', () => {
    const result = validateEntityPayload(EntityType.factItem, 'not an object');
    expect(result.success).toBe(false);
  });
});

// scenario — M19
const scenarioBase = {
  title: 'Sjukt pålägg på tal',
  description: 'Resurser tar slut om intensiteten består',
  horizon: 'two_days',
  likelihood: 'probable',
};

describe('scenario payload schema', () => {
  it('accepts a valid scenario with all horizons', () => {
    for (const horizon of ['hours', 'two_days', 'two_weeks', 'custom']) {
      const result = validateEntityPayload(EntityType.scenario, {
        ...scenarioBase,
        horizon,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional contingency plan, task link and custom horizon text', () => {
    const result = validateEntityPayload(EntityType.scenario, {
      ...scenarioBase,
      horizon: 'custom',
      customHorizon: 'Inom 36 timmar',
      implications: 'Bemanningsteknik måste aktiveras',
      contingencyPlan: 'Aktivera reservbemanning',
      taskId: 'task-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty description', () => {
    const result = validateEntityPayload(EntityType.scenario, {
      ...scenarioBase,
      description: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown horizon', () => {
    const result = validateEntityPayload(EntityType.scenario, {
      ...scenarioBase,
      horizon: 'a_year',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown likelihood', () => {
    const result = validateEntityPayload(EntityType.scenario, {
      ...scenarioBase,
      likelihood: 'impossible',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = validateEntityPayload(EntityType.scenario, {
      ...scenarioBase,
      title: '',
    });
    expect(result.success).toBe(false);
  });
});

// mission — M20
const missionBase = {
  content: 'Rädda liv och begränsa spridning',
  issuedBy: 'user-dm-1',
};

describe('mission payload schema', () => {
  it('accepts a valid mission with all optional fields', () => {
    const result = validateEntityPayload(EntityType.mission, {
      ...missionBase,
      staffShouldDo: 'Prioritera evakuering',
      staffShouldNotDo: 'Ej engagera sig i taktik',
      deadline: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts an acknowledged mission (set by a later version)', () => {
    const result = validateEntityPayload(EntityType.mission, {
      ...missionBase,
      acknowledgedByChief: { userId: 'user-cos', at: new Date().toISOString() },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = validateEntityPayload(EntityType.mission, {
      ...missionBase,
      content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing issuedBy', () => {
    const result = validateEntityPayload(EntityType.mission, {
      content: 'Ingen utställare',
    });
    expect(result.success).toBe(false);
  });
});

// direction — M20
const directionBase = {
  desired: 'Läget under kontroll inom 24 h',
  validFrom: new Date().toISOString(),
};

describe('direction payload schema', () => {
  it('accepts desired + actual + divergence note', () => {
    const result = validateEntityPayload(EntityType.direction, {
      ...directionBase,
      actual: 'Läget fortfarande ovisst',
      divergenceNote: 'Resurser saknas i norra delen',
    });
    expect(result.success).toBe(true);
  });

  it('accepts desired only (no actual yet)', () => {
    const result = validateEntityPayload(EntityType.direction, directionBase);
    expect(result.success).toBe(true);
  });

  it('rejects empty desired', () => {
    const result = validateEntityPayload(EntityType.direction, {
      ...directionBase,
      desired: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing validFrom', () => {
    const result = validateEntityPayload(EntityType.direction, {
      desired: 'Något',
    });
    expect(result.success).toBe(false);
  });
});

// decision_request — M21
const decisionRequestBase = {
  question: 'Should we upgrade the fleet management system?',
  options: [
    { title: 'Yes', pros: ['Better efficiency'], cons: ['Cost'] },
    { title: 'No', pros: ['Safe'], cons: ['Delay'] },
  ],
  status: 'open' as const,
};

describe('decision_request payload schema', () => {
  it('accepts a valid request with options and recommendation', () => {
    const result = validateEntityPayload(EntityType.decisionRequest, {
      ...decisionRequestBase,
      recommendation: 'Proceed with vendor A',
    });
    expect(result.success).toBe(true);
  });

  it('accepts neededBy (functionId)', () => {
    const result = validateEntityPayload(EntityType.decisionRequest, {
      ...decisionRequestBase,
      neededBy: 'fn-logistics',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty question', () => {
    const result = validateEntityPayload(EntityType.decisionRequest, {
      ...decisionRequestBase,
      question: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing options', () => {
    const result = validateEntityPayload(EntityType.decisionRequest, {
      question: 'Q',
      status: 'open',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown status', () => {
    const result = validateEntityPayload(EntityType.decisionRequest, {
      ...decisionRequestBase,
      status: 'pending' as const,
    });
    expect(result.success).toBe(false);
  });
});

// decision — M21
const decisionBase = {
  requestId: 'dr-123',
  text: 'Upgrade fleet management system',
  decidedByUserId: 'user-dm-1',
  decidedAt: new Date().toISOString(),
  mandate: 'decision_maker' as const,
};

describe('decision payload schema', () => {
  it('accepts a valid decision with all fields', () => {
    const result = validateEntityPayload(EntityType.decision, {
      ...decisionBase,
      rationale: 'Current system failing',
    });
    expect(result.success).toBe(true);
  });

  it('accepts without rationale', () => {
    const result = validateEntityPayload(EntityType.decision, decisionBase);
    expect(result.success).toBe(true);
  });

  it('rejects empty text', () => {
    const result = validateEntityPayload(EntityType.decision, {
      ...decisionBase,
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts without requestId (optional per plan.md §6)', () => {
    const result = validateEntityPayload(EntityType.decision, {
      text: 'Something',
      decidedByUserId: 'u',
      decidedAt: new Date().toISOString(),
      mandate: 'decision_maker',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty requestId', () => {
    const result = validateEntityPayload(EntityType.decision, {
      requestId: '',
      text: 'Something',
      decidedByUserId: 'u',
      decidedAt: new Date().toISOString(),
      mandate: 'decision_maker',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown mandate', () => {
    const result = validateEntityPayload(EntityType.decision, {
      ...decisionBase,
      mandate: 'ceo' as const,
    });
    expect(result.success).toBe(false);
  });
});

// task — M22
const taskBase = {
  title: 'Beställ vattenprover',
  description: 'Ta prover från brunn 2 och 5.',
  assigneeFunctionId: 'fn-resources',
  priority: 'normal' as const,
  status: 'todo' as const,
  reportForm: 'none' as const,
};

describe('task payload schema', () => {
  it('accepts a valid task with all optional fields', () => {
    const result = validateEntityPayload(EntityType.task, {
      ...taskBase,
      assigneeUserId: 'user-9',
      due: new Date().toISOString(),
      parentTaskId: 'task-parent-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts every status, priority and report form', () => {
    for (const status of ['proposed', 'todo', 'doing', 'blocked', 'done', 'cancelled']) {
      expect(
        validateEntityPayload(EntityType.task, { ...taskBase, status }).success,
      ).toBe(true);
    }
    for (const priority of ['low', 'normal', 'high', 'critical']) {
      expect(
        validateEntityPayload(EntityType.task, { ...taskBase, priority }).success,
      ).toBe(true);
    }
    for (const reportForm of ['oral', 'written', 'none']) {
      expect(
        validateEntityPayload(EntityType.task, { ...taskBase, reportForm }).success,
      ).toBe(true);
    }
  });

  it('rejects missing title', () => {
    expect(
      validateEntityPayload(EntityType.task, {
        ...taskBase,
        title: '',
      }).success,
    ).toBe(false);
  });

  it('rejects missing assigneeFunctionId', () => {
    const payload: Record<string, unknown> = { ...taskBase };
    delete payload.assigneeFunctionId;
    expect(
      validateEntityPayload(EntityType.task, payload).success,
    ).toBe(false);
  });

  it('rejects unknown status', () => {
    expect(
      validateEntityPayload(EntityType.task, {
        ...taskBase,
        status: 'archived',
      }).success,
    ).toBe(false);
  });
});

// timeline_event — M23
const timelineBase = {
  title: 'Stabsorientering',
  time: '2026-11-12T09:00:00Z',
  type: 'meeting' as const,
  scope: 'internal' as const,
};

describe('timeline_event payload schema', () => {
  it('accepts a valid event with an optional endTime', () => {
    const result = validateEntityPayload(EntityType.timelineEvent, {
      ...timelineBase,
      endTime: '2026-11-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts every type and scope', () => {
    for (const type of ['meeting', 'deadline', 'decision', 'milestone', 'external', 'other']) {
      expect(
        validateEntityPayload(EntityType.timelineEvent, { ...timelineBase, type }).success,
      ).toBe(true);
    }
    for (const scope of ['internal', 'external']) {
      expect(
        validateEntityPayload(EntityType.timelineEvent, { ...timelineBase, scope }).success,
      ).toBe(true);
    }
  });

  it('rejects missing title', () => {
    expect(
      validateEntityPayload(EntityType.timelineEvent, {
        ...timelineBase,
        title: '',
      }).success,
    ).toBe(false);
  });

  it('rejects a non-datetime time', () => {
    expect(
      validateEntityPayload(EntityType.timelineEvent, {
        ...timelineBase,
        time: 'tomorrow',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown type and an unknown scope', () => {
    expect(
      validateEntityPayload(EntityType.timelineEvent, {
        ...timelineBase,
        type: 'party',
      }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.timelineEvent, {
        ...timelineBase,
        scope: 'public',
      }).success,
    ).toBe(false);
  });
});

// briefing / briefing_report — M24
const briefingBase = {
  title: 'Stabsorientering',
  scheduledAt: '2026-11-12T09:00:00Z',
  kind: 'recurring' as const,
  agenda: ['Stabschefen ger nulägesbeskrivning'],
  status: 'planned' as const,
};

describe('briefing payload schema', () => {
  it('accepts a valid briefing with a recurrence', () => {
    const result = validateEntityPayload(EntityType.briefing, {
      ...briefingBase,
      minutes: 'Godkänt.',
      recurrence: { intervalHours: 2, maxCount: 6, endsAt: '2026-11-13T09:00:00Z' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts every kind and status', () => {
    for (const kind of ['first_gathering', 'first_briefing', 'recurring', 'other']) {
      expect(
        validateEntityPayload(EntityType.briefing, { ...briefingBase, kind }).success,
      ).toBe(true);
    }
    for (const status of ['planned', 'held', 'cancelled']) {
      expect(
        validateEntityPayload(EntityType.briefing, { ...briefingBase, status }).success,
      ).toBe(true);
    }
  });

  it('rejects a missing title and an empty agenda item', () => {
    expect(
      validateEntityPayload(EntityType.briefing, { ...briefingBase, title: '' }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.briefing, {
        ...briefingBase,
        agenda: ['ok', ''],
      }).success,
    ).toBe(false);
  });

  it('rejects a non-datetime scheduledAt and a bad recurrence interval', () => {
    expect(
      validateEntityPayload(EntityType.briefing, {
        ...briefingBase,
        scheduledAt: 'immediately',
      }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.briefing, {
        ...briefingBase,
        recurrence: { intervalHours: 0 },
      }).success,
    ).toBe(false);
  });
});

describe('briefing_report payload schema', () => {
  it('accepts a valid report for a function', () => {
    const result = validateEntityPayload(EntityType.briefingReport, {
      briefingId: 'brief-1',
      done: 'Prover tagna',
      planned: 'Analysera prov',
      challenges: 'Saknar utrustning',
      collaborationNeeds: 'Behöver labb',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing briefingId', () => {
    const payload: Record<string, unknown> = {
      briefingId: 'brief-1',
      done: '',
      planned: '',
      challenges: '',
      collaborationNeeds: '',
    };
    delete payload.briefingId;
    expect(
      validateEntityPayload(EntityType.briefingReport, payload).success,
    ).toBe(false);
  });
});

// shift / handover_note — M25
const shiftBase = {
  functionId: 'fn-1',
  userId: 'user-a',
  start: '2026-11-12T08:00:00Z',
  end: '2026-11-12T16:00:00Z',
  role: 'function_lead',
};

describe('shift payload schema', () => {
  it('accepts a valid shift in every role', () => {
    const roles = [
      'chief_of_staff',
      'deputy_chief',
      'function_lead',
      'staff_member',
      'decision_maker',
      'observer',
    ] as const;
    for (const role of roles) {
      expect(
        validateEntityPayload(EntityType.shift, { ...shiftBase, role }).success,
      ).toBe(true);
    }
  });

  it('rejects a shift where end is not after start', () => {
    // Equal end is rejected (the shift must have a positive length).
    expect(
      validateEntityPayload(EntityType.shift, {
        ...shiftBase,
        end: '2026-11-12T08:00:00Z',
      }).success,
    ).toBe(false);
    // End before start is rejected too.
    expect(
      validateEntityPayload(EntityType.shift, {
        ...shiftBase,
        start: '2026-11-12T16:00:00Z',
        end: '2026-11-12T08:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('rejects missing or empty fields', () => {
    const missingUser: Record<string, unknown> = { ...shiftBase };
    delete missingUser.userId;
    expect(validateEntityPayload(EntityType.shift, missingUser).success).toBe(
      false,
    );
    expect(
      validateEntityPayload(EntityType.shift, { ...shiftBase, functionId: '' }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.shift, {
        ...shiftBase,
        start: '2026-11-12 08:00:00',
      }).success,
    ).toBe(false);
  });

  it('rejects a bad role', () => {
    expect(
      validateEntityPayload(EntityType.shift, { ...shiftBase, role: 'boss' }).success,
    ).toBe(false);
  });
});

describe('handover_note payload schema', () => {
  it('accepts a note, with and without shiftId/toUserId', () => {
    expect(
      validateEntityPayload(EntityType.handoverNote, {
        shiftId: 'shift-1',
        fromUserId: 'user-a',
        toUserId: 'user-b',
        text: 'Varning för provrörelser',
      }).success,
    ).toBe(true);
    expect(
      validateEntityPayload(EntityType.handoverNote, {
        fromUserId: 'user-a',
        text: 'Standaröverlämning',
      }).success,
    ).toBe(true);
  });

  it('rejects an empty text or a missing fromUserId', () => {
    expect(
      validateEntityPayload(EntityType.handoverNote, {
        fromUserId: 'user-a',
        text: '',
      }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.handoverNote, {
        text: 'Hej',
      }).success,
    ).toBe(false);
  });
});

// actor — M26
const actorBase = {
  name: 'Polisen',
  type: 'Organisation',
  role: 'Undersöker händelsen',
  contact: '070-123 45 67',
  status: 'involved',
  relations: [],
};

describe('actor payload schema', () => {
  it('accepts a valid actor in every status, with and without contact', () => {
    const statuses = ['involved', 'should_be_involved', 'informed'] as const;
    for (const status of statuses) {
      expect(
        validateEntityPayload(EntityType.actor, {
          ...actorBase,
          status,
          contact: undefined,
        }).success,
      ).toBe(true);
    }
    expect(
      validateEntityPayload(EntityType.actor, { ...actorBase }).success,
    ).toBe(true);
  });

  it('accepts relations (directed, free-form relation text)', () => {
    expect(
      validateEntityPayload(EntityType.actor, {
        ...actorBase,
        relations: [
          { actorId: 'actor-b', relation: 'Anmälningsmottagare' },
          { actorId: 'actor-c', relation: 'Informeras via' },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects missing name, type or role', () => {
    const missingName: Record<string, unknown> = { ...actorBase };
    delete missingName.name;
    expect(validateEntityPayload(EntityType.actor, missingName).success).toBe(
      false,
    );
    expect(
      validateEntityPayload(EntityType.actor, {
        ...actorBase,
        name: '',
        type: '',
        role: '',
      }).success,
    ).toBe(false);
  });

  it('rejects a bad status', () => {
    expect(
      validateEntityPayload(EntityType.actor, {
        ...actorBase,
        status: 'boss',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing relations array and relation entries without actorId or relation', () => {
    const missingRelations: Record<string, unknown> = { ...actorBase };
    delete missingRelations.relations;
    expect(
      validateEntityPayload(EntityType.actor, missingRelations).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.actor, {
        ...actorBase,
        relations: [{ relation: 'Ska involveras' }],
      }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.actor, {
        ...actorBase,
        relations: [{ actorId: 'actor-b' }],
      }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.actor, {
        ...actorBase,
        relations: [{ actorId: '', relation: 'x' }],
      }).success,
    ).toBe(false);
  });
});

// resource — M27
const resourceBase = {
  name: 'Brandbil',
  type: 'vehicle',
  quantity: 2,
  status: 'available',
};

describe('resource payload schema', () => {
  it('accepts a valid resource in every type and status, with and without optional fields', () => {
    const types = [
      'personnel',
      'vehicle',
      'equipment',
      'facility',
      'other',
    ] as const;
    const statuses = [
      'available',
      'deployed',
      'requested',
      'unavailable',
    ] as const;
    for (const type of types) {
      for (const status of statuses) {
        expect(
          validateEntityPayload(EntityType.resource, {
            ...resourceBase,
            type,
            status,
            unit: undefined,
            location: undefined,
            notes: undefined,
          }).success,
        ).toBe(true);
      }
    }
    // With all optional fields.
    expect(
      validateEntityPayload(EntityType.resource, {
        ...resourceBase,
        unit: 'st',
        location: 'Garage A',
        notes: 'Vinterdäck på',
      }).success,
    ).toBe(true);
  });

  it('rejects missing name, type, quantity or status', () => {
    const missingName: Record<string, unknown> = { ...resourceBase };
    delete missingName.name;
    expect(
      validateEntityPayload(EntityType.resource, missingName).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.resource, {
        ...resourceBase,
        name: '',
        type: '',
        quantity: -1,
        status: '',
      }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.resource, {
        ...resourceBase,
        quantity: 1.5,
      }).success,
    ).toBe(false);
  });

  it('rejects a bad type or status', () => {
    expect(
      validateEntityPayload(EntityType.resource, {
        ...resourceBase,
        type: 'drone',
      }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.resource, {
        ...resourceBase,
        status: 'on_order',
      }).success,
    ).toBe(false);
  });

  it('accepts quantity 0 (none available)', () => {
    expect(
      validateEntityPayload(EntityType.resource, {
        ...resourceBase,
        quantity: 0,
      }).success,
    ).toBe(true);
  });
});

// attachment — M28
const attachmentBase = {
  filename: 'rapport.pdf',
  mime: 'application/pdf',
  size: 12345,
  hash: 'a'.repeat(64), // sha256 hex
  linkedEntityIds: ['entity-1', 'entity-2'],
};

describe('attachment payload schema', () => {
  it('accepts a valid attachment with image, document or other mime', () => {
    for (const mime of [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'text/plain',
    ]) {
      expect(
        validateEntityPayload(EntityType.attachment, {
          ...attachmentBase,
          mime,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects missing filename, mime, size, hash or linkedEntityIds', () => {
    const missingFilename: Record<string, unknown> = { ...attachmentBase };
    delete missingFilename.filename;
    expect(
      validateEntityPayload(EntityType.attachment, missingFilename).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.attachment, {
        ...attachmentBase,
        filename: '',
        mime: '',
        size: -1,
        hash: '',
        linkedEntityIds: [],
      }).success,
    ).toBe(false);
    expect(
      validateEntityPayload(EntityType.attachment, {
        ...attachmentBase,
        size: 1.5,
      }).success,
    ).toBe(false);
    // linkedEntityIds must be non-empty (an attachment must link to something).
    expect(
      validateEntityPayload(EntityType.attachment, {
        ...attachmentBase,
        linkedEntityIds: [''],
      }).success,
    ).toBe(false);
  });

  it('accepts a single linked entity', () => {
    expect(
      validateEntityPayload(EntityType.attachment, {
        ...attachmentBase,
        linkedEntityIds: ['entity-1'],
      }).success,
    ).toBe(true);
  });
});
