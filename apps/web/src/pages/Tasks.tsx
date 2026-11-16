// Tasks — plan.md §5 / M22
//
// "Samordning" tab: tasks / staff work plan (plan.md §3: Samordning =
// tasks, resources, shifts).
//
// - Kanban board with one column per status; moving a card = new version.
// - Per-function view = the stabsarbetsplan (who does what, deadline,
//   report form).
// - Overdue highlighting (shared isTaskOverdue), subtasks (parentTaskId),
//   priority, and the colour conventions shown as legend only (meeting blue,
//   task black, deadline red).
// - Permissions (can()): chief/deputy/function_lead manage tasks; others may
//   create only 'proposed' tasks for their own function.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  can,
  isTaskOverdue,
  groupTasksByStatus,
  TASK_STATUS_ORDER,
  type Actor,
  type TaskPayload,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { useTasks, type TaskDraft, type TaskView } from '../hooks/useTasks.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

export interface TasksProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
  functions: { id: string; name: string }[];
}

const PRIORITY_STYLES: Record<TaskDraft['priority'], string> = {
  low: 'text-slate-400 border-slate-300',
  normal: 'text-slate-600 border-slate-300',
  high: 'text-orange-600 border-orange-300',
  critical: 'text-red-600 border-red-300',
};

function functionById(
  functions: { id: string; name: string }[],
  id: string,
): string {
  return functions.find((f) => f.id === id)?.name ?? id;
}

export default function Tasks({
  store,
  incidentId,
  authorId,
  actor,
  functions,
}: TasksProps) {
  const { t } = useTranslation();
  const { tasks, loading, error, createTask, moveTask, refresh } = useTasks(
    store,
    incidentId,
    authorId,
  );

  const [functionFilter, setFunctionFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);

  const activeTasks = useMemo(
    () => tasks.filter((v) => !v.retracted && v.current),
    [tasks],
  );

  const visible = useMemo(
    () =>
      activeTasks.filter(
        (v) =>
          functionFilter === 'all' ||
          (v.current?.payload as TaskPayload | undefined)
            ?.assigneeFunctionId === functionFilter,
      ),
    [activeTasks, functionFilter],
  );

  const canManage = !!actor &&
    ['chief_of_staff', 'deputy_chief', 'function_lead'].includes(actor.role);

  // New tasks: chief/deputy/function_lead for any function; others only
  // 'proposed' for their own function (plan.md §7).
  const ownFunctionId = actor?.functionIds[0] ?? null;
  const formFunctionId =
    functionFilter !== 'all'
      ? functionFilter
      : ownFunctionId ?? functions[0]?.id ?? '';
  const canCreate =
    !!actor &&
    !!formFunctionId &&
    can(
      actor,
      'write',
      {
        entityType: 'task',
        incidentId,
        functionId: formFunctionId,
        status: 'proposed',
      },
      {},
    );

  if (loading) {
    return <div className="text-center py-10">{t('tasks.loading')}</div>;
  }

  const byEntity = new Map(activeTasks.map((v) => [v.entityId, v]));

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      {error && <ErrorNotice message={error} onRetry={() => void refresh()} />}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{t('tasks.title')}</h2>
        <div className="flex gap-2">
          <select
            value={functionFilter}
            onChange={(e) => setFunctionFilter(e.target.value)}
            aria-label={t('tasks.filter.allFunctions')}
            className="px-2 py-1.5 text-sm border border-slate-300 rounded"
          >
            <option value="all">{t('tasks.filter.allFunctions')}</option>
            {functions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {canCreate && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
            >
              {showForm ? t('tasks.cancel') : t('tasks.newTask')}
            </button>
          )}
        </div>
      </div>

      {/* Colour conventions — shown as legend only (plan.md §10 M22). */}
      <div className="text-xs text-slate-500">{t('tasks.legend')}</div>

      {showForm && canCreate && (
        <TaskForm
          functions={canManage ? functions : functions.filter((f) => f.id === formFunctionId)}
          defaultFunctionId={formFunctionId}
          tasks={activeTasks}
          canManage={canManage}
          onCreate={createTask}
          onDone={() => setShowForm(false)}
        />
      )}

      {visible.length === 0 ? (
        <div className="text-slate-500 text-sm">{t('tasks.empty')}</div>
      ) : functionFilter === 'all' ? (
        <KanbanBoard
          tasks={visible}
          actor={actor}
          incidentId={incidentId}
          functions={functions}
          onMove={moveTask}
        />
      ) : (
        <Stabsarbetsplan
          tasks={visible}
          functions={functions}
          byEntity={byEntity}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function TaskCard({
  task,
  functions,
  actor,
  incidentId,
  parentTitle,
  onMove,
}: {
  task: TaskView;
  functions: { id: string; name: string }[];
  actor: Actor | null;
  incidentId: string;
  parentTitle: string | null;
  onMove: (entityId: string, status: TaskDraft['status']) => Promise<void>;
}) {
  const { t } = useTranslation();
  const payload = task.current?.payload as TaskPayload;
  const overdue = isTaskOverdue(payload, new Date());

  return (
    <div
      className={`border rounded p-2 space-y-1 text-sm ${
        overdue ? 'border-red-400 bg-red-50' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`text-slate-900 font-medium ${overdue ? 'text-red-700' : ''}`}>
          {parentTitle ? `↳ ${parentTitle} · ` : ''}
          {payload.title}
        </span>
        <span
          className={`px-1.5 py-0.5 text-xs rounded border ${PRIORITY_STYLES[payload.priority]}`}
        >
          {t(`tasks.form.priority.${payload.priority}`)}
        </span>
      </div>
      <div className="text-xs text-slate-500">
        {functionById(functions, payload.assigneeFunctionId)}
        {payload.assigneeUserId ? ` · ${payload.assigneeUserId}` : ''}
      </div>
      {payload.due && (
        <div className={`text-xs ${overdue ? 'text-red-700 font-medium' : 'text-red-600'}`}>
          {t('tasks.due')}: {new Date(payload.due).toLocaleString()}
          {overdue && <span className="ml-1">({t('tasks.overdue')})</span>}
        </div>
      )}
      {actor && (
        <select
          value={payload.status}
          onChange={(e) =>
            void onMove(task.entityId, e.target.value as TaskDraft['status'])
          }
          // Moving a task writes a record with the target status; only
          // chief/deputy/function_lead ever may (others: proposed only).
          disabled={!can(
            actor,
            'write',
            {
              entityType: 'task',
              incidentId,
              functionId: payload.assigneeFunctionId,
              status: 'todo',
            },
            {},
          )}
          className="w-full px-1 py-1 text-xs border border-slate-300 rounded disabled:opacity-50"
        >
          {TASK_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.kanban.${s}`)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function KanbanBoard({
  tasks,
  actor,
  incidentId,
  functions,
  onMove,
}: {
  tasks: TaskView[];
  actor: Actor | null;
  incidentId: string;
  functions: { id: string; name: string }[];
  onMove: (entityId: string, status: TaskDraft['status']) => Promise<void>;
}) {
  const { t } = useTranslation();
  const payloads = tasks.map(
    (v) => ({ view: v, payload: v.current?.payload as TaskPayload }),
  );
  const groups = groupTasksByStatus(
    payloads.map((p) => ({ status: p.payload.status })),
  );
  const byEntity = new Map(tasks.map((v) => [v.entityId, v]));

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
      {TASK_STATUS_ORDER.map((status) => (
        <div key={status} className="border border-slate-200 rounded p-2 space-y-2">
          <div className="text-xs font-semibold text-slate-600 uppercase">
            {t(`tasks.kanban.${status}`)} ({groups[status].length})
          </div>
          {groups[status].length === 0 ? (
            <div className="text-[10px] text-slate-400 italic">
              {t('tasks.kanbanEmpty')}
            </div>
          ) : (
            payloads
              .filter((p) => p.payload.status === status)
              .map(({ view, payload }) => (
                <TaskCard
                  key={view.entityId}
                  task={view}
                  functions={functions}
                  actor={actor}
                  incidentId={incidentId}
                  parentTitle={
                    payload.parentTaskId
                      ? ((byEntity.get(payload.parentTaskId)?.current?.payload as TaskPayload | undefined)?.title ?? null)
                      : null
                  }
                  onMove={onMove}
                />
              ))
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Stabsarbetsplan({
  tasks,
  functions,
  byEntity,
}: {
  tasks: TaskView[];
  functions: { id: string; name: string }[];
  byEntity: Map<string, TaskView>;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700">
        {t('tasks.stabsarbetsplan')}
      </h3>
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr className="text-xs text-slate-500 uppercase border-b border-slate-200">
            <th scope="col" className="py-1 pr-2">{t('tasks.plan.task')}</th>
            <th scope="col" className="py-1 pr-2">{t('tasks.plan.assignee')}</th>
            <th scope="col" className="py-1 pr-2">{t('tasks.form.priority')}</th>
            <th scope="col" className="py-1 pr-2">{t('tasks.plan.deadline')}</th>
            <th scope="col" className="py-1">{t('tasks.plan.reportForm')}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((v) => {
            const p = v.current?.payload as TaskPayload;
            const overdue = isTaskOverdue(p, new Date());
            const isSub = !!p.parentTaskId && byEntity.has(p.parentTaskId);
            return (
              <tr
                key={v.entityId}
                className={`border-b border-slate-100 ${overdue ? 'bg-red-50' : ''}`}
              >
                <td className="py-1 pr-2">
                  <span className={isSub ? 'pl-4 text-slate-500' : ''}>
                    {isSub ? '↳ ' : ''}
                    {p.title}
                  </span>
                </td>
                <td className="py-1 pr-2 text-slate-600">
                  {functionById(functions, p.assigneeFunctionId)}
                  {p.assigneeUserId ? ` · ${p.assigneeUserId}` : ''}
                </td>
                <td className="py-1 pr-2 text-slate-600">
                  {t(`tasks.form.priority.${p.priority}`)}
                </td>
                <td className={`py-1 pr-2 ${overdue ? 'text-red-700 font-medium' : 'text-red-600'}`}>
                  {p.due ? (
                    <>
                      {new Date(p.due).toLocaleString()}
                      {overdue && <span className="ml-1">({t('tasks.overdue')})</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-1 text-slate-600">
                  {t(`tasks.form.reportForm.${p.reportForm}`)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TaskForm({
  functions,
  defaultFunctionId,
  tasks,
  canManage,
  onCreate,
  onDone,
}: {
  functions: { id: string; name: string }[];
  defaultFunctionId: string;
  tasks: TaskView[];
  canManage: boolean;
  onCreate: (draft: TaskDraft) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeFunctionId, setAssigneeFunctionId] = useState(defaultFunctionId);
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<TaskDraft['priority']>('normal');
  const [status, setStatus] = useState<TaskDraft['status']>('proposed');
  const [reportForm, setReportForm] = useState<TaskDraft['reportForm']>('none');
  const [parentTaskId, setParentTaskId] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving || !title.trim()) return;
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        assigneeFunctionId,
        assigneeUserId: assigneeUserId.trim() || undefined,
        due: due ? new Date(due).toISOString() : undefined,
        priority,
        // Non-managers may only create proposed tasks (plan.md §7).
        status: canManage ? status : 'proposed',
        reportForm,
        parentTaskId: parentTaskId || undefined,
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-300 rounded p-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('tasks.form.titlePlaceholder')}
          aria-label={t('tasks.form.titlePlaceholder')}
          className="px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('tasks.form.description')}
          aria-label={t('tasks.form.description')}
          className="px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <select
          value={assigneeFunctionId}
          onChange={(e) => setAssigneeFunctionId(e.target.value)}
          aria-label={t('tasks.form.assigneeFunction')}
          className="px-2 py-2 border border-slate-300 rounded text-sm"
        >
          {functions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <input
          value={assigneeUserId}
          onChange={(e) => setAssigneeUserId(e.target.value)}
          placeholder={t('tasks.form.assignee')}
          aria-label={t('tasks.form.assignee')}
          className="px-3 py-2 border border-slate-300 rounded text-sm"
        />
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label={t('tasks.form.dueDate')}
          className="px-2 py-2 border border-slate-300 rounded text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskDraft['priority'])}
            aria-label={t('tasks.form.priority')}
            className="px-2 py-2 border border-slate-300 rounded text-sm"
          >
            {(['low', 'normal', 'high', 'critical'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`tasks.form.priority.${p}`)}
              </option>
            ))}
          </select>
          <select
            value={reportForm}
            onChange={(e) =>
              setReportForm(e.target.value as TaskDraft['reportForm'])
            }
            aria-label={t('tasks.form.reportForm')}
            className="px-2 py-2 border border-slate-300 rounded text-sm"
          >
            {(['oral', 'written', 'none'] as const).map((r) => (
              <option key={r} value={r}>
                {t(`tasks.form.reportForm.${r}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {canManage && (
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskDraft['status'])}
          aria-label={t('tasks.form.status')}
          className="w-full md:w-56 px-2 py-2 border border-slate-300 rounded text-sm"
        >
          {TASK_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.kanban.${s}`)}
            </option>
          ))}
        </select>
      )}
      <select
        value={parentTaskId}
        onChange={(e) => setParentTaskId(e.target.value)}
        aria-label={t('tasks.form.parent')}
        className="w-full md:w-72 px-2 py-2 border border-slate-300 rounded text-sm"
      >
        <option value="">
          {t('tasks.form.parent')}
        </option>
        {tasks.map((v) => (
          <option key={v.entityId} value={v.entityId}>
            {(v.current?.payload as TaskPayload | undefined)?.title ?? v.entityId}
          </option>
        ))}
      </select>
      <button
        onClick={() => void handleSave()}
        disabled={saving || !title.trim() || !assigneeFunctionId}
        className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving ? t('tasks.form.saving') : t('tasks.form.save')}
      </button>
    </div>
  );
}
