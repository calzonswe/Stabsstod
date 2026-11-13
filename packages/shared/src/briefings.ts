// briefings — plan.md §5 / M24
//
// Pure derivation for staff briefings (stabsorientering): expand a recurring
// briefing into concrete occurrence times, and find the next upcoming
// briefing (for the countdown). No framework dependencies; unit-tested here.

import type { BriefingRecurrence } from './entityRegistry.js';

const HOUR_MS = 3_600_000;
// Defensive cap so an unbounded recurrence (no maxCount/endsAt) can never
// loop forever. Callers should pass a horizonEnd in practice.
const MAX_OCCURRENCES = 10_000;

export interface OccurrenceOptions {
  // Only include occurrences at or after this time (ISO).
  from?: string;
  // Stop generating after this time (ISO). An occurrence exactly at this time
  // is included.
  horizonEnd?: string;
  // Max number of occurrences to return.
  limit?: number;
}

/**
 * Expand a (possibly recurring) briefing into concrete occurrence times
 * (ISO strings, ascending). Without `recurrence` there is a single occurrence
 * at `scheduledAt`. With it, the briefing repeats every `intervalHours`; the
 * total number of occurrences is bounded by `maxCount` and by the earliest of
 * `endsAt` / `horizonEnd` (an occurrence exactly at the bound is included).
 * Options filter the returned list (`from`, `horizonEnd`, `limit`).
 */
export function briefingOccurrences(
  scheduledAt: string,
  recurrence: BriefingRecurrence | undefined,
  options: OccurrenceOptions = {},
): string[] {
  const { from, horizonEnd, limit } = options;
  const start = new Date(scheduledAt).getTime();
  const fromMs = from !== undefined ? new Date(from).getTime() : undefined;
  const stopCandidates = [recurrence?.endsAt, horizonEnd].filter(
    (v): v is string => typeof v === 'string',
  );
  const stop = stopCandidates.length
    ? Math.min(...stopCandidates.map((v) => new Date(v).getTime()))
    : undefined;
  const cap = limit ?? MAX_OCCURRENCES;
  const maxCount = recurrence?.maxCount;

  const inWindow = (ms: number): boolean => {
    if (fromMs !== undefined && ms < fromMs) return false;
    if (stop !== undefined && ms > stop) return false;
    return true;
  };

  const out: string[] = [];
  if (!recurrence) {
    if (inWindow(start)) out.push(new Date(start).toISOString());
    return out.slice(0, cap);
  }

  // Walk occurrences counting from the start: maxCount bounds the TOTAL
  // number of occurrences (even those outside the window), so a recurrence
  // that has already run out has nothing left. `cap` only bounds how many
  // in-window occurrences we return.
  let t = start;
  let count = 0;
  const totalCap = maxCount ?? MAX_OCCURRENCES;
  while (count < totalCap && out.length < cap) {
    if (stop !== undefined && t > stop) break;
    if (inWindow(t)) out.push(new Date(t).toISOString());
    count++;
    t += recurrence.intervalHours * HOUR_MS;
  }
  return out;
}

export interface NextBriefing {
  time: string;
  briefingId: string;
}

/**
 * The soonest occurrence (at or after `now`) across all briefings that are
 * still `planned`. Returns the occurrence time and the source briefing id,
 * or null when nothing is upcoming. Cancelled/held briefings are ignored.
 */
export function nextBriefingTime(
  briefings: {
    id: string;
    scheduledAt: string;
    status: string;
    recurrence?: BriefingRecurrence;
  }[],
  now: string,
): NextBriefing | null {
  let best: NextBriefing | null = null;
  for (const b of briefings) {
    if (b.status !== 'planned') continue;
    // Only the first occurrence at/after `now` matters for the countdown.
    const [next] = briefingOccurrences(b.scheduledAt, b.recurrence, {
      from: now,
      limit: 1,
    });
    if (!next) continue;
    if (!best || new Date(next).getTime() < new Date(best.time).getTime()) {
      best = { time: next, briefingId: b.id };
    }
  }
  return best;
}
