// Scenario grouping — plan.md §5 / M19
//
// Scenarios are grouped by time horizon (hours / 2 days / 2 weeks / custom)
// and likelihood (probable / possible) into a horizon × likelihood grid.
// Pure and deterministic; used by the ScenarioBoard UI and tested directly.

import type { ScenarioHorizon, ScenarioLikelihood } from './entityRegistry.js';

/** Fixed display order of horizons. */
export const HORIZON_ORDER: ScenarioHorizon[] = ['hours', 'two_days', 'two_weeks', 'custom'];

export const LIKELIHOOD_ORDER: ScenarioLikelihood[] = ['probable', 'possible'];

export interface ScenarioGroupItem {
  horizon: ScenarioHorizon;
  likelihood: ScenarioLikelihood;
}

export interface ScenarioGroup<T extends ScenarioGroupItem> {
  horizon: ScenarioHorizon;
  probable: T[];
  possible: T[];
}

/**
 * Group scenarios into rows per horizon (in fixed display order), each row
 * split into probable/possible columns. Horizons with no scenarios are
 * omitted. Within a cell, items keep their input order (newest first is the
 * caller's concern).
 */
export function groupScenarios<T extends ScenarioGroupItem>(
  items: readonly T[],
): Array<ScenarioGroup<T>> {
  const byHorizon = new Map<ScenarioHorizon, T[]>();
  for (const item of items) {
    const list = byHorizon.get(item.horizon) ?? [];
    list.push(item);
    byHorizon.set(item.horizon, list);
  }
  const groups: Array<ScenarioGroup<T>> = [];
  for (const horizon of HORIZON_ORDER) {
    const list = byHorizon.get(horizon);
    if (!list || list.length === 0) continue;
    groups.push({
      horizon,
      probable: list.filter((s) => s.likelihood === 'probable'),
      possible: list.filter((s) => s.likelihood === 'possible'),
    });
  }
  return groups;
}
