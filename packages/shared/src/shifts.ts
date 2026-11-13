// shifts — plan.md §5 / M25
//
// Pure derivation for shifts and handovers (plan.md §10 M25 "pure functions
// for each warning with tests"). All warnings are advisory (non-blocking):
//   - a shift longer than the handbook's 8 h cap,
//   - consecutive shifts in a function with under 30 min overlap (the
//     handbook wants a 30–60 min overlap for handover; a gap counts as
//     negative overlap),
//   - chief of staff and decision maker changing at the same time,
//   - all members of a function changing at once.
// Plus the "on duty now" derivation. No framework dependencies.

export const MAX_SHIFT_HOURS = 8;
export const MIN_HANDOVER_OVERLAP_MS = 30 * 60_000;

export interface ShiftInfo {
  functionId: string;
  userId: string;
  start: string; // ISO datetime (UTC)
  end: string; // ISO datetime (UTC)
  role: string;
}

export interface Over8hWarning {
  kind: 'shift_over_8h';
  functionId: string;
  userId: string;
  start: string;
  end: string;
  /** The warning's "when" — when the shift starts. */
  time: string;
}

export interface OverlapWarning {
  kind: 'overlap_under_30min';
  functionId: string;
  firstUserId: string;
  secondUserId: string;
  /** The moment the first (outgoing) shift ends. */
  time: string;
  /** Negative when the shifts leave a gap. */
  overlapMs: number;
}

export interface ChiefDecisionWarning {
  kind: 'chief_and_decision_maker_changing_at_once';
  time: string;
}

export interface WholeFunctionWarning {
  kind: 'whole_function_changing_at_once';
  functionId: string;
  time: string;
}

export type ShiftWarning =
  | Over8hWarning
  | OverlapWarning
  | ChiefDecisionWarning
  | WholeFunctionWarning;

/** A shift is too long when it exceeds the handbook's 8 h cap. */
export function shiftIsTooLong(shift: ShiftInfo): boolean {
  return Date.parse(shift.end) - Date.parse(shift.start) > MAX_SHIFT_HOURS * 3_600_000;
}

/**
 * Consecutive shifts in the same function (ordered by start time) that leave
 * less than 30 min of overlap between them — a gap between the shifts counts
 * as negative overlap and warns too.
 */
export function insufficientOverlapWarnings(
  shifts: ShiftInfo[],
): OverlapWarning[] {
  const warnings: OverlapWarning[] = [];
  const byFunction = new Map<string, ShiftInfo[]>();
  for (const s of shifts) {
    const list = byFunction.get(s.functionId) ?? [];
    list.push(s);
    byFunction.set(s.functionId, list);
  }
  for (const [functionId, list] of byFunction) {
    const sorted = [...list].sort(
      (a, b) =>
        Date.parse(a.start) - Date.parse(b.start) ||
        a.userId.localeCompare(b.userId),
    );
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const overlapMs =
        Math.min(Date.parse(a.end), Date.parse(b.end)) -
        Math.max(Date.parse(a.start), Date.parse(b.start));
      if (overlapMs < MIN_HANDOVER_OVERLAP_MS) {
        warnings.push({
          kind: 'overlap_under_30min',
          functionId,
          firstUserId: a.userId,
          secondUserId: b.userId,
          time: a.end,
          overlapMs,
        });
      }
    }
  }
  return warnings;
}

/**
 * A role "changes" at every start and end of its shifts. Warns for each
 * time at which chief_of_staff and decision_maker change at once — the
 * moment both key positions are being handed over simultaneously.
 */
export function chiefDecisionMakerChangingAtOnce(
  shifts: ShiftInfo[],
): ChiefDecisionWarning[] {
  const changeTimes = (role: string): Set<number> => {
    const times = new Set<number>();
    for (const s of shifts) {
      if (s.role !== role) continue;
      times.add(Date.parse(s.start));
      times.add(Date.parse(s.end));
    }
    return times;
  };
  const chief = changeTimes('chief_of_staff');
  const decision = changeTimes('decision_maker');
  const warnings: ChiefDecisionWarning[] = [];
  for (const t of chief) {
    if (decision.has(t)) {
      warnings.push({
        kind: 'chief_and_decision_maker_changing_at_once',
        time: new Date(t).toISOString(),
      });
    }
  }
  return warnings;
}

/**
 * Warns for every time at which every member of a function (everyone who
 * has a shift in it) is changing at once — i.e. has a shift in that
 * function starting or ending at that time.
 */
export function wholeFunctionChangingAtOnce(
  shifts: ShiftInfo[],
): WholeFunctionWarning[] {
  const warnings: WholeFunctionWarning[] = [];
  const byFunction = new Map<string, ShiftInfo[]>();
  for (const s of shifts) {
    const list = byFunction.get(s.functionId) ?? [];
    list.push(s);
    byFunction.set(s.functionId, list);
  }
  for (const [functionId, list] of byFunction) {
    const changeTimesByUser = new Map<string, Set<number>>();
    for (const s of list) {
      const times = changeTimesByUser.get(s.userId) ?? new Set<number>();
      times.add(Date.parse(s.start));
      times.add(Date.parse(s.end));
      changeTimesByUser.set(s.userId, times);
    }
    const candidates = new Set<number>();
    for (const times of changeTimesByUser.values()) {
      for (const t of times) candidates.add(t);
    }
    for (const t of candidates) {
      const all = [...changeTimesByUser.values()].every((times) => times.has(t));
      if (all) {
        warnings.push({
          kind: 'whole_function_changing_at_once',
          functionId,
          time: new Date(t).toISOString(),
        });
      }
    }
  }
  return warnings;
}

/**
 * Collect every warning, sorted by (time, kind) for stable display.
 */
export function collectShiftWarnings(shifts: ShiftInfo[]): ShiftWarning[] {
  const warnings: ShiftWarning[] = [
    ...shifts
      .filter(shiftIsTooLong)
      .map<Over8hWarning>((s) => ({
        kind: 'shift_over_8h',
        functionId: s.functionId,
        userId: s.userId,
        start: s.start,
        end: s.end,
        time: s.start,
      })),
    ...insufficientOverlapWarnings(shifts),
    ...chiefDecisionMakerChangingAtOnce(shifts),
    ...wholeFunctionChangingAtOnce(shifts),
  ];
  return warnings.sort(
    (a, b) =>
      Date.parse(a.time) - Date.parse(b.time) || a.kind.localeCompare(b.kind),
  );
}

/**
 * The shifts covering `now` (inclusive of both boundaries, so at the exact
 * handover moment both the outgoing and the incoming person are "on duty").
 * Sorted by function, then start, then user — for stable display.
 */
export function onDutyNow(shifts: ShiftInfo[], nowIso: string): ShiftInfo[] {
  const now = Date.parse(nowIso);
  return shifts
    .filter((s) => Date.parse(s.start) <= now && now <= Date.parse(s.end))
    .sort(
      (a, b) =>
        a.functionId.localeCompare(b.functionId) ||
        Date.parse(a.start) - Date.parse(b.start) ||
        a.userId.localeCompare(b.userId),
    );
}
