// tasks tests — M22
//
// Overdue logic and kanban grouping are pure (plan.md §9: heavily unit
// tested in shared).

import { describe, expect, it } from 'vitest';
import { isTaskOverdue, groupTasksByStatus, TASK_STATUS_ORDER } from './tasks.js';

const NOW = new Date('2026-11-12T12:00:00Z');

describe('isTaskOverdue', () => {
  it('is overdue when due is in the past and status is active', () => {
    expect(isTaskOverdue({ status: 'todo', due: '2026-11-12T11:00:00Z' }, NOW)).toBe(true);
    expect(isTaskOverdue({ status: 'doing', due: '2026-11-11T12:00:00Z' }, NOW)).toBe(true);
    expect(isTaskOverdue({ status: 'blocked', due: '2026-11-12T00:00:00Z' }, NOW)).toBe(true);
    expect(isTaskOverdue({ status: 'proposed', due: '2026-11-12T11:59:59Z' }, NOW)).toBe(true);
  });

  it('is not overdue when due is in the future', () => {
    expect(isTaskOverdue({ status: 'todo', due: '2026-11-12T12:00:01Z' }, NOW)).toBe(false);
  });

  it('is not overdue exactly at the due time', () => {
    expect(isTaskOverdue({ status: 'doing', due: '2026-11-12T12:00:00Z' }, NOW)).toBe(false);
  });

  it('is never overdue without a due time', () => {
    expect(isTaskOverdue({ status: 'todo' }, NOW)).toBe(false);
  });

  it('is never overdue when done or cancelled', () => {
    expect(isTaskOverdue({ status: 'done', due: '2026-11-01T00:00:00Z' }, NOW)).toBe(false);
    expect(isTaskOverdue({ status: 'cancelled', due: '2026-11-01T00:00:00Z' }, NOW)).toBe(false);
  });

  it('accepts a string now', () => {
    expect(isTaskOverdue({ status: 'todo', due: '2026-11-12T11:00:00Z' }, '2026-11-12T12:00:00Z')).toBe(true);
  });
});

describe('groupTasksByStatus', () => {
  it('groups into every column in fixed order', () => {
    const groups = groupTasksByStatus([
      { status: 'todo' },
      { status: 'doing' },
      { status: 'todo' },
    ]);
    expect(Object.keys(groups)).toEqual([...TASK_STATUS_ORDER]);
    expect(groups.todo).toHaveLength(2);
    expect(groups.doing).toHaveLength(1);
    expect(groups.proposed).toHaveLength(0);
  });

  it('keeps unknown statuses visible under todo (never disappears)', () => {
    const groups = groupTasksByStatus([{ status: 'bogus' }, { status: undefined }]);
    expect(groups.todo).toHaveLength(2);
  });
});
