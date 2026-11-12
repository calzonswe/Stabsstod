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
