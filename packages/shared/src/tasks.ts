// tasks — plan.md §5 / M22
//
// Pure helpers over task payloads: overdue logic and kanban grouping.
// No framework dependencies; shared by the web UI (and future server
// notifications).

import type { TaskPayload } from './entityRegistry.js';

/** Statuses in which a task is no longer worked (not overdue). */
export const TERMINAL_TASK_STATUSES: readonly string[] = ['done', 'cancelled'];

/** Kanban column order (plan.md §10 M22: columns by status). */
export const TASK_STATUS_ORDER: readonly string[] = [
  'proposed',
  'todo',
  'doing',
  'blocked',
  'done',
  'cancelled',
];

export type TaskLike = Pick<TaskPayload, 'status' | 'due'>;

/**
 * A task is overdue when it has a due time in the past and is not in a
 * terminal status (done/cancelled). `now` is injected so the function is
 * pure and testable.
 */
export function isTaskOverdue(task: TaskLike, now: Date | string): boolean {
  if (!task.due) return false;
  if (TERMINAL_TASK_STATUSES.includes(task.status)) return false;
  const due = new Date(task.due).getTime();
  const at = typeof now === 'string' ? new Date(now).getTime() : now.getTime();
  return due < at;
}

/**
 * Tasks grouped into kanban columns in TASK_STATUS_ORDER. Unknown statuses
 * (should not happen — schema-validated) are grouped under 'todo' so they
 * never disappear from the board.
 */
export function groupTasksByStatus(
  tasks: { status?: string }[],
): Record<string, typeof tasks> {
  const order = [...TASK_STATUS_ORDER];
  const columns: Record<string, typeof tasks> = {};
  for (const s of order) columns[s] = [];
  for (const task of tasks) {
    const status = order.includes(task.status ?? '') ? (task.status as string) : 'todo';
    columns[status].push(task);
  }
  return columns;
}
