// Decisions — plan.md §5 / M21
//
// Third module of the "Inriktning" tab (plan.md §3: Inriktning = mission,
// desired vs actual direction, decision requests, decisions).
//
// Decision requests: question, background, options with pros/cons and a
// recommendation. Written by any writer of their own function (default rule
// in can()). Decisions: only the decision maker records an outcome — or the
// chief of staff with delegated mandate. Recording a decision creates a new
// version of the request (status → decided) plus a new decision record.
// List has status filters; links to the log and to tasks/staff work plan.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, type Actor } from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import {
  useDecisions,
  type DecisionDraft,
  type DecisionRequestDraft,
  type DecisionRequestStatus,
  type VersionedListEntry,
} from '../hooks/useDecisions.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

export interface DecisionsProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
  onNavigate?: (tab: 'log' | 'staff') => void;
}

type Filter = 'all' | DecisionRequestStatus;

function mandateFor(role: Actor['role']): 'decision_maker' | 'delegated_chief' | null {
  if (role === 'decision_maker') return 'decision_maker';
  if (role === 'chief_of_staff') return 'delegated_chief';
  return null;
}

export default function Decisions({
  store,
  incidentId,
  authorId,
  actor,
  onNavigate,
}: DecisionsProps) {
  const { t } = useTranslation();
  const {
    requests,
    decisions,
    loading,
    error,
    createRequest,
    withdrawRequest,
    recordDecision,
    refresh,
  } = useDecisions(store, incidentId, authorId);

  const [filter, setFilter] = useState<Filter>('all');
  const [showForm, setShowForm] = useState(false);

  // decision_request: any writer for own function (plan.md §7).
  const requestFunctionId = actor?.functionIds[0] ?? null;
  const canWriteRequest =
    !!actor &&
    can(
      actor,
      'write',
      { entityType: 'decision_request', incidentId, functionId: requestFunctionId },
      {},
    );

  const mandate = actor ? mandateFor(actor.role) : null;

  if (loading) {
    return <div className="text-center py-10">{t('decisions.loading')}</div>;
  }

  const visible = requests.filter((r) => {
    if (r.retracted) return false;
    const status = (r.current?.payload as DecisionRequestDraft | undefined)?.status;
    return filter === 'all' || status === filter;
  });

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      {error && <ErrorNotice message={error} onRetry={() => void refresh()} />}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{t('decisions.title')}</h2>
        {canWriteRequest && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
          >
            {showForm ? t('decisions.cancel') : t('decisions.newRequest')}
          </button>
        )}
      </div>

      {/* Status filters (plan.md §10 M21: list with status filters). */}
      <div className="flex gap-1 text-sm">
        {(['all', 'open', 'decided', 'withdrawn'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-1 rounded border ${
              filter === f
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t(`decisions.filter.${f}`)}
          </button>
        ))}
      </div>

      {showForm && canWriteRequest && (
        <RequestForm
          onCreate={createRequest}
          onDone={() => setShowForm(false)}
        />
      )}

      {visible.length === 0 ? (
        <div className="text-slate-500 text-sm">{t('decisions.empty')}</div>
      ) : (
        <ul className="space-y-3">
          {visible.map((view) => {
            const functionId = view.current?.functionId ?? null;
            // decision: decision_maker, or chief_of_staff with delegated
            // mandate (plan.md §7) — same can() the server enforces.
            const canDecide =
              !!actor &&
              !!mandate &&
              can(
                actor,
                'write',
                { entityType: 'decision', incidentId, functionId, mandate },
                {},
              );
            return (
              <RequestCard
                key={view.entityId}
                view={view}
                decisions={decisions.filter(
                  (d) =>
                    (d.current?.payload as DecisionDraft | undefined)
                      ?.requestId === view.entityId,
                )}
                canWriteRequest={canWriteRequest}
                canDecide={canDecide}
                mandate={mandate}
                actorUserId={actor?.userId ?? ''}
                onWithdraw={withdrawRequest}
                onDecide={recordDecision}
              />
            );
          })}
        </ul>
      )}

      {/* Links to tasks and log (plan.md §10 M21). */}
      <div className="border-t border-slate-200 pt-3 flex items-center gap-3 text-sm">
        <span className="text-slate-500">{t('decisions.links.title')}:</span>
        <button onClick={() => onNavigate?.('log')} className="text-indigo-600 hover:underline">
          {t('decisions.links.log')}
        </button>
        <button
          onClick={() => onNavigate?.('staff')}
          className="text-indigo-600 hover:underline"
        >
          {t('decisions.links.tasks')}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function RequestForm({
  onCreate,
  onDone,
}: {
  onCreate: (draft: DecisionRequestDraft) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [background, setBackground] = useState('');
  const [options, setOptions] = useState<{ title: string; pros: string; cons: string }[]>([
    { title: '', pros: '', cons: '' },
  ]);
  const [recommendation, setRecommendation] = useState('');
  const [saving, setSaving] = useState(false);

  function setOption(i: number, patch: Partial<{ title: string; pros: string; cons: string }>) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  async function handleSave() {
    if (saving) return;
    const parsedOptions = options
      .filter((o) => o.title.trim())
      .map((o) => ({
        title: o.title.trim(),
        pros: o.pros.split('\n').map((s) => s.trim()).filter(Boolean),
        cons: o.cons.split('\n').map((s) => s.trim()).filter(Boolean),
      }));
    if (!question.trim() || parsedOptions.length === 0) return;
    setSaving(true);
    try {
      await onCreate({
        question: question.trim(),
        background: background.trim() || undefined,
        options: parsedOptions,
        recommendation: recommendation.trim() || undefined,
        status: 'open',
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-300 rounded p-3 space-y-3">
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
        {t('decisions.publicRecordReminder')}
      </div>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={t('decisions.form.questionPlaceholder')}
        aria-label={t('decisions.form.questionPlaceholder')}
        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
      />
      <textarea
        value={background}
        onChange={(e) => setBackground(e.target.value)}
        placeholder={t('decisions.form.background')}
        aria-label={t('decisions.form.background')}
        rows={2}
        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
      />
      <div className="space-y-3">
        {options.map((o, i) => (
          <div key={i} className="border border-slate-200 rounded p-2 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={o.title}
                onChange={(e) => setOption(i, { title: e.target.value })}
                placeholder={`${t('decisions.form.options')} ${i + 1} — ${t('decisions.form.option.title')}`}
                aria-label={`${t('decisions.form.options')} ${i + 1} — ${t('decisions.form.option.title')}`}
                className="flex-1 px-2 py-1 border border-slate-300 rounded text-sm"
              />
              {options.length > 1 && (
                <button
                  onClick={() =>
                    setOptions((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="text-xs text-red-600 hover:underline"
                >
                  {t('decisions.form.removeOption')}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <textarea
                value={o.pros}
                onChange={(e) => setOption(i, { pros: e.target.value })}
                placeholder={t('decisions.form.option.pros')}
                aria-label={t('decisions.form.option.pros')}
                rows={2}
                className="px-2 py-1 border border-slate-300 rounded text-sm"
              />
              <textarea
                value={o.cons}
                onChange={(e) => setOption(i, { cons: e.target.value })}
                placeholder={t('decisions.form.option.cons')}
                aria-label={t('decisions.form.option.cons')}
                rows={2}
                className="px-2 py-1 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>
        ))}
        <button
          onClick={() => setOptions((prev) => [...prev, { title: '', pros: '', cons: '' }])}
          className="text-sm text-indigo-600 hover:underline"
        >
          {t('decisions.form.addOption')}
        </button>
      </div>
      <input
        value={recommendation}
        onChange={(e) => setRecommendation(e.target.value)}
        placeholder={t('decisions.form.recommendation')}
        aria-label={t('decisions.form.recommendation')}
        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
      />
      <div>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !question.trim()}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? t('decisions.form.saving') : t('decisions.form.save')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<DecisionRequestStatus, string> = {
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  decided: 'bg-green-50 text-green-700 border-green-200',
  withdrawn: 'bg-slate-100 text-slate-500 border-slate-200',
};

function RequestCard({
  view,
  decisions,
  canWriteRequest,
  canDecide,
  mandate,
  actorUserId,
  onWithdraw,
  onDecide,
}: {
  view: VersionedListEntry;
  decisions: VersionedListEntry[];
  canWriteRequest: boolean;
  canDecide: boolean;
  mandate: 'decision_maker' | 'delegated_chief' | null;
  actorUserId: string;
  onWithdraw: (entityId: string) => Promise<void>;
  onDecide: (requestEntityId: string, draft: DecisionDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [text, setText] = useState('');
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);

  const payload = (view.current?.payload ??
    (view.lastPut?.payload as Record<string, unknown> | undefined)) as
    | DecisionRequestDraft
    | undefined;
  const status: DecisionRequestStatus = payload?.status ?? 'open';

  async function handleSaveDecision() {
    if (saving || !mandate || !text.trim()) return;
    setSaving(true);
    try {
      await onDecide(view.entityId, {
        requestId: view.entityId,
        text: text.trim(),
        rationale: rationale.trim() || undefined,
        decidedByUserId: actorUserId,
        decidedAt: new Date().toISOString(),
        mandate,
      });
      setShowDecisionForm(false);
      setText('');
      setRationale('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="border border-slate-200 rounded p-3 space-y-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="text-slate-900 font-medium">{payload?.question}</div>
        <span
          className={`px-2 py-0.5 text-xs rounded border ${STATUS_STYLES[status]}`}
        >
          {t(`decisions.status.${status}`)}
        </span>
      </div>
      {payload?.background && <div className="text-slate-600">{payload.background}</div>}
      {payload?.options && (
        <ul className="space-y-2">
          {payload.options.map((o, i) => (
            <li key={i} className="border border-slate-100 rounded p-2">
              <div className="font-medium text-slate-800">{o.title}</div>
              {o.pros.length > 0 && (
                <ul className="list-disc list-inside text-slate-600">
                  {o.pros.map((p, j) => (
                    <li key={j}>{p}</li>
                  ))}
                </ul>
              )}
              {o.cons.length > 0 && (
                <ul className="list-disc list-inside text-slate-600">
                  {o.cons.map((c, j) => (
                    <li key={j}>{c}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {payload?.recommendation && (
        <div>
          <span className="font-medium text-slate-700">
            {t('decisions.form.recommendation')}:
          </span>{' '}
          {payload.recommendation}
        </div>
      )}
      {decisions.map((d) => {
        const dp = d.current?.payload as DecisionDraft | undefined;
        return (
          <div
            key={d.entityId}
            className="border border-green-200 bg-green-50 rounded p-2 text-green-900"
          >
            <div className="font-medium">{dp?.text}</div>
            {dp?.rationale && <div className="text-sm">{dp.rationale}</div>}
            {dp?.decidedAt && (
              <div className="text-xs text-green-700">
                {t(`decisions.decision.mandate.${dp.mandate}`)} ·{' '}
                {new Date(dp.decidedAt).toLocaleString()}
              </div>
            )}
          </div>
        );
      })}
      {status === 'open' && (
        <div className="flex gap-2 pt-1">
          {canDecide && (
            <button
              onClick={() => setShowDecisionForm((v) => !v)}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
            >
              {t('decisions.decide')}
            </button>
          )}
          {canWriteRequest && (
            <button
              onClick={() => void onWithdraw(view.entityId)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
            >
              {t('decisions.withdraw')}
            </button>
          )}
        </div>
      )}
      {showDecisionForm && canDecide && (
        <div className="border border-slate-300 rounded p-2 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('decisions.decision.form.text')}
            aria-label={t('decisions.decision.form.text')}
            rows={2}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
          />
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder={t('decisions.decision.form.rationale')}
            aria-label={t('decisions.decision.form.rationale')}
            rows={2}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
          />
          <button
            onClick={() => void handleSaveDecision()}
            disabled={saving || !text.trim()}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {t('decisions.decision.form.save')}
          </button>
        </div>
      )}
    </li>
  );
}
