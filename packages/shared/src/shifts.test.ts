// shifts tests — M25
//
// Accept: pure functions for each warning with tests. Plus onDutyNow.

import { describe, expect, it } from 'vitest';
import {
  chiefDecisionMakerChangingAtOnce,
  collectShiftWarnings,
  insufficientOverlapWarnings,
  onDutyNow,
  shiftIsTooLong,
  wholeFunctionChangingAtOnce,
  type ShiftInfo,
} from './shifts.js';

const H = 3_600_000;

function shift(over: Partial<ShiftInfo>): ShiftInfo {
  return {
    functionId: 'fn-1',
    userId: 'user-a',
    start: '2026-11-12T08:00:00Z',
    end: '2026-11-12T16:00:00Z',
    role: 'staff_member',
    ...over,
  };
}

describe('shiftIsTooLong (over 8 h)', () => {
  it('exactly 8 h is ok', () => {
    expect(
      shiftIsTooLong({
        ...shift({}),
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T16:00:00Z',
      }),
    ).toBe(false);
  });

  it('8 h + 1 min warns', () => {
    expect(
      shiftIsTooLong({
        ...shift({}),
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T16:01:00Z',
      }),
    ).toBe(true);
  });

  it('a shorter shift is ok', () => {
    expect(
      shiftIsTooLong({
        ...shift({}),
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T12:00:00Z',
      }),
    ).toBe(false);
  });
});

describe('insufficientOverlapWarnings (overlap under 30 min)', () => {
  it('60 min overlap is ok (handbook 30–60 min)', () => {
    const warnings = insufficientOverlapWarnings([
      shift({ userId: 'a', start: '2026-11-12T08:00:00Z', end: '2026-11-12T16:00:00Z' }),
      shift({ userId: 'b', start: '2026-11-12T15:00:00Z', end: '2026-11-13T00:00:00Z' }),
    ]);
    expect(warnings).toEqual([]);
  });

  it('exactly 30 min overlap is ok', () => {
    const warnings = insufficientOverlapWarnings([
      shift({ userId: 'a', start: '2026-11-12T08:00:00Z', end: '2026-11-12T16:00:00Z' }),
      shift({ userId: 'b', start: '2026-11-12T15:30:00Z', end: '2026-11-13T00:00:00Z' }),
    ]);
    expect(warnings).toEqual([]);
  });

  it('15 min overlap warns', () => {
    const warnings = insufficientOverlapWarnings([
      shift({ userId: 'a', start: '2026-11-12T08:00:00Z', end: '2026-11-12T16:00:00Z' }),
      shift({ userId: 'b', start: '2026-11-12T15:45:00Z', end: '2026-11-13T00:00:00Z' }),
    ]);
    expect(warnings).toEqual([
      {
        kind: 'overlap_under_30min',
        functionId: 'fn-1',
        firstUserId: 'a',
        secondUserId: 'b',
        time: '2026-11-12T16:00:00Z',
        overlapMs: 15 * 60_000,
      },
    ]);
  });

  it('a gap warns with negative overlap', () => {
    const warnings = insufficientOverlapWarnings([
      shift({ userId: 'a', start: '2026-11-12T08:00:00Z', end: '2026-11-12T16:00:00Z' }),
      shift({ userId: 'b', start: '2026-11-12T17:00:00Z', end: '2026-11-13T01:00:00Z' }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].overlapMs).toBe(-1 * H);
  });

  it('shifts in different functions do not interact', () => {
    const warnings = insufficientOverlapWarnings([
      shift({ functionId: 'fn-1', start: '2026-11-12T08:00:00Z', end: '2026-11-12T16:00:00Z' }),
      shift({
        functionId: 'fn-2',
        userId: 'b',
        start: '2026-11-12T17:00:00Z',
        end: '2026-11-13T01:00:00Z',
      }),
    ]);
    expect(warnings).toEqual([]);
  });
});

describe('chiefDecisionMakerChangingAtOnce', () => {
  it('warns when the chief and the decision-maker end at the same time', () => {
    const warnings = chiefDecisionMakerChangingAtOnce([
      shift({
        userId: 'chief',
        role: 'chief_of_staff',
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T12:00:00Z',
      }),
      shift({
        userId: 'decision',
        role: 'decision_maker',
        start: '2026-11-12T10:00:00Z',
        end: '2026-11-12T12:00:00Z',
      }),
    ]);
    expect(warnings).toEqual([
      {
        kind: 'chief_and_decision_maker_changing_at_once',
        time: '2026-11-12T12:00:00.000Z',
      },
    ]);
  });

  it('warns when the chief leaves as the decision-maker arrives', () => {
    const warnings = chiefDecisionMakerChangingAtOnce([
      shift({
        userId: 'chief',
        role: 'chief_of_staff',
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T12:00:00Z',
      }),
      shift({
        userId: 'decision',
        role: 'decision_maker',
        start: '2026-11-12T12:00:00Z',
        end: '2026-11-13T00:00:00Z',
      }),
    ]);
    expect(warnings).toEqual([
      {
        kind: 'chief_and_decision_maker_changing_at_once',
        time: '2026-11-12T12:00:00.000Z',
      },
    ]);
  });

  it('no warning when the changes are apart', () => {
    const warnings = chiefDecisionMakerChangingAtOnce([
      shift({
        userId: 'chief',
        role: 'chief_of_staff',
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T12:00:00Z',
      }),
      shift({
        userId: 'decision',
        role: 'decision_maker',
        start: '2026-11-12T14:00:00Z',
        end: '2026-11-13T02:00:00Z',
      }),
    ]);
    expect(warnings).toEqual([]);
  });

  it('no warning for other roles alone', () => {
    const warnings = chiefDecisionMakerChangingAtOnce([
      shift({ userId: 'a', role: 'function_lead' }),
      shift({
        userId: 'b',
        role: 'staff_member',
        start: '2026-11-12T12:00:00Z',
        end: '2026-11-13T00:00:00Z',
      }),
    ]);
    expect(warnings).toEqual([]);
  });
});

describe('wholeFunctionChangingAtOnce', () => {
  it('warns when both members of a function end at the same time', () => {
    const warnings = wholeFunctionChangingAtOnce([
      shift({ userId: 'a', start: '2026-11-12T08:00:00Z', end: '2026-11-12T12:00:00Z' }),
      shift({ userId: 'b', start: '2026-11-12T08:00:00Z', end: '2026-11-12T12:00:00Z' }),
    ]);
    // Both start at 08:00 and both end at 12:00 — two times.
    expect(warnings).toEqual([
      {
        kind: 'whole_function_changing_at_once',
        functionId: 'fn-1',
        time: '2026-11-12T08:00:00.000Z',
      },
      {
        kind: 'whole_function_changing_at_once',
        functionId: 'fn-1',
        time: '2026-11-12T12:00:00.000Z',
      },
    ]);
  });

  it('no warning when the changes are staggered (b is already on when a goes)', () => {
    // a leaves at 12:00, but b started at 11:00 and keeps going — nobody
    // except a is changing at 12:00.
    const warnings = wholeFunctionChangingAtOnce([
      shift({ userId: 'a', start: '2026-11-12T08:00:00Z', end: '2026-11-12T12:00:00Z' }),
      shift({ userId: 'b', start: '2026-11-12T11:00:00Z', end: '2026-11-13T00:00:00Z' }),
    ]);
    expect(warnings).toEqual([]);
  });

  it('functions are evaluated independently', () => {
    const warnings = wholeFunctionChangingAtOnce([
      shift({ functionId: 'fn-1', userId: 'a' }),
      shift({
        functionId: 'fn-2',
        userId: 'b',
        start: '2026-11-12T12:00:00Z',
        end: '2026-11-13T00:00:00Z',
      }),
    ]);
    // fn-1 has a single member who changes at both 08:00 and 16:00 —
    // that is "all members" of fn-1; fn-2 the same at 12:00 and next 00:00.
    expect(warnings.map((w) => w.functionId).sort()).toEqual(['fn-1', 'fn-1', 'fn-2', 'fn-2']);
  });
});

describe('collectShiftWarnings', () => {
  it('collects every kind, sorted by time then kind', () => {
    const warnings = collectShiftWarnings([
      // Over 8 h.
      shift({
        userId: 'long',
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T17:00:00Z',
      }),
      // Chief and decision maker both change at 12:00.
      shift({
        userId: 'chief',
        role: 'chief_of_staff',
        start: '2026-11-12T06:00:00Z',
        end: '2026-11-12T12:00:00Z',
      }),
      shift({
        userId: 'decision',
        role: 'decision_maker',
        start: '2026-11-12T12:00:00Z',
        end: '2026-11-12T20:00:00Z',
      }),
    ]);
    expect(warnings.map((w) => w.kind)).toEqual([
      'shift_over_8h',
      'chief_and_decision_maker_changing_at_once',
    ]);
  });

  it('no warnings for a calm roster (8 h shifts, 30 min overlap)', () => {
    const warnings = collectShiftWarnings([
      shift({ userId: 'a', start: '2026-11-12T08:00:00Z', end: '2026-11-12T16:00:00Z' }),
      shift({
        userId: 'b',
        start: '2026-11-12T15:30:00Z',
        end: '2026-11-12T23:30:00Z',
      }),
    ]);
    expect(warnings).toEqual([]);
  });
});

describe('onDutyNow', () => {
  it('includes shifts covering now, inclusive of both boundaries', () => {
    const shifts = [
      shift({
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T16:00:00Z',
        userId: 'a',
      }),
      shift({
        start: '2026-11-12T17:00:00Z',
        end: '2026-11-13T01:00:00Z',
        userId: 'b',
      }),
    ];
    expect(onDutyNow(shifts, '2026-11-12T08:00:00Z').map((s) => s.userId)).toEqual([
      'a',
    ]);
    expect(onDutyNow(shifts, '2026-11-12T16:00:00Z').map((s) => s.userId)).toEqual([
      'a',
    ]);
    expect(onDutyNow(shifts, '2026-11-12T16:30:00Z')).toEqual([]);
    expect(onDutyNow(shifts, '2026-11-12T17:00:00Z').map((s) => s.userId)).toEqual([
      'b',
    ]);
  });

  it('sorts by function, then start, then user', () => {
    const shifts = [
      shift({
        functionId: 'fn-2',
        userId: 'b',
        start: '2026-11-12T06:00:00Z',
        end: '2026-11-12T22:00:00Z',
      }),
      shift({
        functionId: 'fn-1',
        userId: 'z',
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T16:00:00Z',
      }),
      shift({
        functionId: 'fn-1',
        userId: 'a',
        start: '2026-11-12T08:00:00Z',
        end: '2026-11-12T16:00:00Z',
      }),
    ];
    expect(
      onDutyNow(shifts, '2026-11-12T08:00:00Z').map((s) => s.userId),
    ).toEqual(['a', 'z', 'b']);
  });
});
