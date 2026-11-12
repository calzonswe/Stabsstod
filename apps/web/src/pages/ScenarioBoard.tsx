// ScenarioBoard — plan.md §5 / M19
//
// Scenarios grouped by horizon (hours / 2 days / 2 weeks / custom) ×
// likelihood (probable / possible). Create/edit forms share one dialog;
// retract with mandatory reason. Retracted scenarios are hidden from the
// grid (they remain in history).

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { groupScenarios, LIKELIHOOD_ORDER } from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import {
  useScenarios,
  type ScenarioDraft,
  type ScenarioHorizon,
  type ScenarioView,
} from '../hooks/useScenarios.js';

export interface ScenarioBoardProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
}

export default function ScenarioBoard({ store, incidentId, authorId }: ScenarioBoardProps) {
  const { t } = useTranslation();
  const { scenarios, loading, error, createScenario, editScenario, retractScenario } =
    useScenarios(store, incidentId, authorId);

  // editing = entityId of an existing scenario, null = closed, 'new' = create.
  const [dialog, setDialog] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [implications, setImplications] = useState('');
  const [horizon, setHorizon] = useState<ScenarioHorizon>('two_days');
  const [customHorizon, setCustomHorizon] = useState('');
  const [likelihood, setLikelihood] = useState<'probable' | 'possible'>('probable');
  const [contingencyPlan, setContingencyPlan] = useState('');
  const [taskId, setTaskId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [retractFor, setRetractFor] = useState<string | null>(null);
  const [retractReason, setRetractReason] = useState('');

  const active = useMemo(() => scenarios.filter((s) => !s.retracted), [scenarios]);
  const groups = useMemo(
    () =>
      groupScenarios(
        active.map((view) => {
          const p = view.lastPut?.payload as
            | { horizon?: ScenarioHorizon; likelihood?: 'probable' | 'possible' }
            | undefined;
          return {
            view,
            horizon: p?.horizon ?? 'custom',
            likelihood: p?.likelihood ?? 'probable',
          };
        }),
      ),
    [active],
  );

  function openCreate() {
    setTitle('');
    setDescription('');
    setImplications('');
    setHorizon('two_days');
    setCustomHorizon('');
    setLikelihood('probable');
    setContingencyPlan('');
    setTaskId('');
    setDialog('new');
  }

  function openEdit(view: ScenarioView) {
    const p = view.lastPut?.payload as
      | (ScenarioDraft & { text?: never })
      | undefined;
    setTitle(p?.title ?? '');
    setDescription(p?.description ?? '');
    setImplications(p?.implications ?? '');
    setHorizon(p?.horizon ?? 'two_days');
    setCustomHorizon(p?.customHorizon ?? '');
    setLikelihood(p?.likelihood ?? 'probable');
    setContingencyPlan(p?.contingencyPlan ?? '');
    setTaskId(p?.taskId ?? '');
    setDialog(view.entityId);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting || !dialog) return;
    setSubmitting(true);
    try {
      const draft: ScenarioDraft = {
        title: title.trim(),
        description: description.trim(),
        implications: implications.trim() || undefined,
        horizon,
        customHorizon: horizon === 'custom' ? customHorizon.trim() || undefined : undefined,
        likelihood,
        contingencyPlan: contingencyPlan.trim() || undefined,
        taskId: taskId.trim() || undefined,
      };
      if (dialog === 'new') {
        await createScenario(draft);
      } else {
        await editScenario(dialog, draft);
      }
      setDialog(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetract(entityId: string) {
    if (!retractReason.trim()) return;
    await retractScenario(entityId, retractReason.trim());
    setRetractFor(null);
    setRetractReason('');
  }

  if (loading) {
    return <div className="text-center py-10">{t('scenarios.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-700 border border-red-100">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900">{t('scenarios.title')}</h2>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors"
        >
          {t('scenarios.createScenario')}
        </button>
      </div>

      {/* Grid: one row per horizon, two likelihood columns */}
      {groups.length === 0 ? (
        <div className="text-center py-8 text-slate-500 border border-dashed border-slate-200 rounded">
          {t('scenarios.empty')}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.horizon} className="bg-white border border-slate-200 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                {t(`scenarios.horizon.${group.horizon}`)}
                {group.horizon === 'custom' && (
                  <span className="text-xs font-normal text-slate-500">
                    {' '}
                    — {customHorizonLabel(active, group.horizon)}
                  </span>
                )}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {LIKELIHOOD_ORDER.map((lik) => {
                  const items =
                    lik === 'probable' ? group.probable : group.possible;
                  return (
                    <div key={lik} className="border border-slate-100 rounded p-2 bg-slate-50/50">
                      <div className="text-xs font-medium text-slate-500 mb-1">
                        {t(`scenarios.likelihood.${lik}`)}
                      </div>
                      <div className="space-y-2">
                        {items.length === 0 ? (
                          <div className="text-xs text-slate-400 py-2 text-center">
                            {t('scenarios.columnEmpty')}
                          </div>
                        ) : (
                          items.map(({ view }) => (
                            <ScenarioCard
                              key={view.entityId}
                              view={view}
                              onEdit={() => openEdit(view)}
                              onRetract={() => {
                                setRetractFor(view.entityId);
                                setRetractReason('');
                              }}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/edit dialog */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setDialog(null)} />
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl space-y-3 relative"
          >
            <h3 className="text-lg font-semibold text-slate-900">
              {dialog === 'new'
                ? t('scenarios.createScenario')
                : t('scenarios.editScenario')}
            </h3>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('scenarios.form.title')}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('scenarios.form.description')}
              rows={2}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            <textarea
              value={implications}
              onChange={(e) => setImplications(e.target.value)}
              placeholder={t('scenarios.form.implications')}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">
                  {t('scenarios.form.horizon')}
                </span>
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(e.target.value as ScenarioHorizon)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                >
                  <option value="hours">{t('scenarios.horizon.hours')}</option>
                  <option value="two_days">{t('scenarios.horizon.two_days')}</option>
                  <option value="two_weeks">{t('scenarios.horizon.two_weeks')}</option>
                  <option value="custom">{t('scenarios.horizon.custom')}</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">
                  {t('scenarios.form.likelihood')}
                </span>
                <select
                  value={likelihood}
                  onChange={(e) =>
                    setLikelihood(e.target.value as 'probable' | 'possible')
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                >
                  <option value="probable">{t('scenarios.likelihood.probable')}</option>
                  <option value="possible">{t('scenarios.likelihood.possible')}</option>
                </select>
              </label>
            </div>
            {horizon === 'custom' && (
              <input
                type="text"
                value={customHorizon}
                onChange={(e) => setCustomHorizon(e.target.value)}
                placeholder={t('scenarios.form.customHorizon')}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            )}
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('scenarios.form.contingencyPlan')}
              </span>
              <textarea
                value={contingencyPlan}
                onChange={(e) => setContingencyPlan(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('scenarios.form.taskLink')}
              </span>
              <input
                type="text"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('scenarios.form.cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? t('scenarios.form.saving') : t('scenarios.form.save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Retract dialog */}
      {retractFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setRetractFor(null)} />
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {t('scenarios.retract.title')}
            </h3>
            <p className="text-sm text-slate-600 mb-3">{t('scenarios.retract.hint')}</p>
            <input
              type="text"
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              placeholder={t('scenarios.retract.reason')}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRetractFor(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('scenarios.retract.cancel')}
              </button>
              <button
                onClick={() => void handleRetract(retractFor)}
                disabled={!retractReason.trim()}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {t('scenarios.retract.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScenarioCard({
  view,
  onEdit,
  onRetract,
}: {
  view: ScenarioView;
  onEdit: () => void;
  onRetract: () => void;
}) {
  const { t } = useTranslation();
  const p = view.lastPut?.payload as
    | (ScenarioDraft & { conflict?: never })
    | undefined;

  return (
    <div className="bg-white border border-slate-200 rounded p-2 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{p?.title ?? ''}</p>
      </div>
      {p?.description && (
        <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{p.description}</p>
      )}
      {p?.implications && (
        <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">
          <span className="font-medium">{t('scenarios.form.implications')}:</span>{' '}
          {p.implications}
        </p>
      )}
      {p?.contingencyPlan && (
        <p className="text-xs text-emerald-700 mt-1 whitespace-pre-wrap">
          <span className="font-medium">{t('scenarios.form.contingencyPlan')}:</span>{' '}
          {p.contingencyPlan}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
        {p?.taskId && (
          <span className="underline">{t('scenarios.linkedTask')}</span>
        )}
        {view.conflict && (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
            {t('conflict.title')}
          </span>
        )}
      </div>
      <div className="mt-2 flex gap-1">
        <button
          onClick={onEdit}
          className="px-2 py-0.5 text-xs border border-slate-300 rounded hover:bg-slate-50"
        >
          {t('scenarios.edit')}
        </button>
        <button
          onClick={onRetract}
          className="px-2 py-0.5 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50"
        >
          {t('history.retract')}
        </button>
      </div>
    </div>
  );
}

/** First non-empty customHorizon text among scenarios of that horizon. */
function customHorizonLabel(
  scenarios: ScenarioView[],
  horizon: ScenarioHorizon,
): string {
  for (const s of scenarios) {
    if (s.retracted) continue;
    const p = s.lastPut?.payload as
      | { horizon?: ScenarioHorizon; customHorizon?: string }
      | undefined;
    if (p?.horizon === horizon && p.customHorizon) return p.customHorizon;
  }
  return '';
}
