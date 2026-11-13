// briefings tests — M24
//
// Accept: recurrence expansion unit tests. A recurring briefing expands into
// concrete occurrence times bounded by maxCount / endsAt / horizon; the
// countdown helper finds the soonest upcoming planned occurrence.

import { describe, expect, it } from 'vitest';
import { briefingOccurrences, nextBriefingTime } from './briefings.js';

const START = '2026-11-12T08:00:00Z';

describe('briefingOccurrences', () => {
  it('a non-recurring briefing is a single occurrence at scheduledAt', () => {
    expect(briefingOccurrences(START, undefined)).toEqual([
      '2026-11-12T08:00:00.000Z',
    ]);
  });

  it('expands a recurrence up to maxCount occurrences', () => {
    const out = briefingOccurrences(START, { intervalHours: 2, maxCount: 4 });
    expect(out).toEqual([
      '2026-11-12T08:00:00.000Z',
      '2026-11-12T10:00:00.000Z',
      '2026-11-12T12:00:00.000Z',
      '2026-11-12T14:00:00.000Z',
    ]);
  });

  it('stops at endsAt, including an occurrence exactly at endsAt', () => {
    const out = briefingOccurrences(START, {
      intervalHours: 2,
      endsAt: '2026-11-12T12:00:00Z',
    });
    expect(out).toEqual([
      '2026-11-12T08:00:00.000Z',
      '2026-11-12T10:00:00.000Z',
      '2026-11-12T12:00:00.000Z',
    ]);
  });

  it('whichever bound comes first (maxCount vs endsAt) wins', () => {
    // maxCount 10 would allow 10, but endsAt 12:00 stops at 3.
    const byEnd = briefingOccurrences(START, {
      intervalHours: 2,
      maxCount: 10,
      endsAt: '2026-11-12T12:00:00Z',
    });
    expect(byEnd).toHaveLength(3);
    // maxCount 2 stops before endsAt 14:00.
    const byCount = briefingOccurrences(START, {
      intervalHours: 2,
      maxCount: 2,
      endsAt: '2026-11-12T14:00:00Z',
    });
    expect(byCount).toHaveLength(2);
  });

  it('from filters to occurrences at/after the given time', () => {
    const out = briefingOccurrences(START, { intervalHours: 2, maxCount: 4 }, {
      from: '2026-11-12T10:00:00Z',
    });
    expect(out).toEqual([
      '2026-11-12T10:00:00.000Z',
      '2026-11-12T12:00:00.000Z',
      '2026-11-12T14:00:00.000Z',
    ]);
  });

  it('horizonEnd caps the generation and limit caps the length', () => {
    const byHorizon = briefingOccurrences(
      START,
      { intervalHours: 2, maxCount: 4 },
      { horizonEnd: '2026-11-12T11:00:00Z' },
    );
    expect(byHorizon).toEqual([
      '2026-11-12T08:00:00.000Z',
      '2026-11-12T10:00:00.000Z',
    ]);
    const byLimit = briefingOccurrences(
      START,
      { intervalHours: 1 },
      { limit: 2 },
    );
    expect(byLimit).toHaveLength(2);
  });

  it('a recurrence exhausted before `from` yields nothing', () => {
    // Only 08:00 and 10:00 exist (maxCount 2); nothing at/after 12:00.
    const out = briefingOccurrences(START, { intervalHours: 2, maxCount: 2 }, {
      from: '2026-11-12T12:00:00Z',
    });
    expect(out).toEqual([]);
  });
});

describe('nextBriefingTime', () => {
  const A = {
    id: 'A',
    scheduledAt: '2026-11-12T08:00:00Z',
    status: 'planned',
    recurrence: { intervalHours: 4 } as const,
  };
  const B = {
    id: 'B',
    scheduledAt: '2026-11-12T11:30:00Z',
    status: 'planned',
  };
  const C = {
    id: 'C',
    scheduledAt: '2026-11-12T09:00:00Z',
    status: 'cancelled',
  };

  it('picks the soonest upcoming occurrence across planned briefings', () => {
    // now 10:00 → A next at 12:00, B at 11:30 → B wins.
    const next = nextBriefingTime([A, B, C], '2026-11-12T10:00:00Z');
    expect(next).toEqual({ time: '2026-11-12T11:30:00.000Z', briefingId: 'B' });
  });

  it('ignores non-planned briefings', () => {
    const next = nextBriefingTime([C], '2026-11-12T08:00:00Z');
    expect(next).toBeNull();
  });

  it('finds the next occurrence of a recurring briefing', () => {
    const next = nextBriefingTime([A], '2026-11-12T10:00:00Z');
    expect(next).toEqual({ time: '2026-11-12T12:00:00.000Z', briefingId: 'A' });
  });

  it('returns null when nothing is upcoming', () => {
    // A single past briefing has no occurrence at/after now.
    const past = { id: 'P', scheduledAt: '2026-11-11T08:00:00Z', status: 'planned' };
    const next = nextBriefingTime([past], '2026-11-12T00:00:00Z');
    expect(next).toBeNull();
  });
});
