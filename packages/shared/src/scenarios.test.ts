// groupScenarios tests — M19

import { describe, expect, it } from 'vitest';
import { groupScenarios, HORIZON_ORDER } from './scenarios.js';
import type { ScenarioHorizon, ScenarioLikelihood } from './entityRegistry.js';

describe('groupScenarios', () => {
  it('groups into rows in fixed horizon order, split by likelihood', () => {
    const items: Array<{ title: string; horizon: ScenarioHorizon; likelihood: ScenarioLikelihood }> = [
      { title: 'x', horizon: 'two_weeks', likelihood: 'possible' },
      { title: 'x', horizon: 'hours', likelihood: 'probable' },
      { title: 'x', horizon: 'hours', likelihood: 'possible' },
      { title: 'x', horizon: 'two_days', likelihood: 'probable' },
    ];
    const groups = groupScenarios(items);
    expect(groups.map((g) => g.horizon)).toEqual(['hours', 'two_days', 'two_weeks']);
    expect(groups[0].probable.length).toBe(1);
    expect(groups[0].possible.length).toBe(1);
    expect(groups[1].probable.length).toBe(1);
    expect(groups[1].possible.length).toBe(0);
    expect(groups[2].possible.length).toBe(1);
  });

  it('omits empty horizons and keeps unknown-horizon-free output', () => {
    const groups = groupScenarios([
      { title: 'x', horizon: 'custom' as ScenarioHorizon, likelihood: 'possible' as ScenarioLikelihood },
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].horizon).toBe('custom');
    expect(HORIZON_ORDER).toContain('custom');
  });

  it('returns empty for no items', () => {
    expect(groupScenarios([])).toEqual([]);
  });

  it('keeps item reference and order within a cell', () => {
    const a = { title: 'x', horizon: 'two_days' as ScenarioHorizon, likelihood: 'probable' as ScenarioLikelihood };
    const b = { title: 'x', horizon: 'two_days' as ScenarioHorizon, likelihood: 'probable' as ScenarioLikelihood };
    const groups = groupScenarios([a, b]);
    expect(groups[0].probable[0]).toBe(a);
    expect(groups[0].probable[1]).toBe(b);
  });
});
