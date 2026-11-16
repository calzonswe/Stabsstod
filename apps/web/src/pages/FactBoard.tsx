// FactBoard — plan.md §5 / M17
//
// Board with three columns: Vet (verified) / Antar (assumption) / Vet ej
// (information need). Refuted items are shown struck through in their
// original column. Status transitions create a new version (history kept).
// Filters: owner (author) and function.

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { hlcParse } from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import {
  useFactItems,
  type FactItemView,
  type FactStatus,
} from '../hooks/useFactItems.js';
import { ConflictBanner } from '../components/ConflictBanner.js';

export interface FactBoardProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
}

const COLUMNS: { status: FactStatus; titleKey: string; accent: string }[] = [
  { status: 'verified', titleKey: 'facts.column.verified', accent: 'border-green-300' },
  { status: 'assumption', titleKey: 'facts.column.assumption', accent: 'border-amber-300' },
  { status: 'info_need', titleKey: 'facts.column.infoNeed', accent: 'border-sky-300' },
];

export default function FactBoard({ store, incidentId, authorId }: FactBoardProps) {
  const { t } = useTranslation();
  const { facts, loading, error, createFact, changeStatus, retractFact, mergeFact } =
    useFactItems(store, incidentId, authorId);

  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<FactStatus>('assumption');
  const [source, setSource] = useState('');
  const [logEntryId, setLogEntryId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [ownerFilter, setOwnerFilter] = useState('');
  const [functionFilter, setFunctionFilter] = useState('');
  const [retractFor, setRetractFor] = useState<string | null>(null);
  const [retractReason, setRetractReason] = useState('');
  const [conflictFor, setConflictFor] = useState<string | null>(null);

  const owners = useMemo(
    () => Array.from(new Set(facts.map((f) => f.lastPut?.authorId ?? ''))).filter(Boolean),
    [facts],
  );
  const functions = useMemo(
    () =>
      Array.from(new Set(facts.map((f) => f.lastPut?.functionId ?? ''))).filter(Boolean),
    [facts],
  );

  const visible = useMemo(
    () =>
      facts.filter((f) => {
        if (ownerFilter && f.lastPut?.authorId !== ownerFilter) return false;
        if (functionFilter && f.lastPut?.functionId !== functionFilter) return false;
        return true;
      }),
    [facts, ownerFilter, functionFilter],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createFact({
        text: text.trim(),
        status,
        source: source.trim() || undefined,
        logEntryId: logEntryId.trim() || undefined,
      });
      setText('');
      setSource('');
      setLogEntryId('');
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetract(entityId: string) {
    if (!retractReason.trim()) return;
    await retractFact(entityId, retractReason.trim());
    setRetractFor(null);
    setRetractReason('');
  }

  if (loading) {
    return <div className="text-center py-10">{t('facts.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-700 border border-red-100">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900">{t('facts.title')}</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors"
        >
          {showForm ? t('facts.closeForm') : t('facts.createFact')}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-lg p-4 space-y-3"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('facts.form.text')}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('facts.form.status')}
              </span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as FactStatus)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="verified">{t('facts.column.verified')}</option>
                <option value="assumption">{t('facts.column.assumption')}</option>
                <option value="info_need">{t('facts.column.infoNeed')}</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('facts.form.source')}
              </span>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('facts.form.logLink')}
              </span>
              <input
                type="text"
                value={logEntryId}
                onChange={(e) => setLogEntryId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? t('facts.form.saving') : t('facts.form.save')}
            </button>
          </div>
        </form>
      )}

      {/* Filters: owner and function */}
      <div className="flex flex-col md:flex-row gap-2">
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded text-sm bg-white"
        >
          <option value="">{t('facts.filter.allOwners')}</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          value={functionFilter}
          onChange={(e) => setFunctionFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded text-sm bg-white"
        >
          <option value="">{t('facts.filter.allFunctions')}</option>
          {functions.map((fn) => (
            <option key={fn} value={fn}>
              {fn}
            </option>
          ))}
        </select>
      </div>

      {/* Conflict banner for the selected entity (M39) */}
      {conflictFor &&
        (() => {
          const fact = facts.find((f) => f.entityId === conflictFor);
          if (!fact || !fact.conflict) return null;
          return (
            <ConflictBanner
              entityId={fact.entityId}
              heads={fact.heads}
              current={fact.current}
              onMerge={(selectedHead, allHeads) =>
                void mergeFact(selectedHead, allHeads)
              }
            />
          );
        })()}

      {/* Three-column board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const items = visible.filter((f) => f.displayStatus === col.status);
          return (
            <div key={col.status} className={`border-2 ${col.accent} rounded-lg bg-white/60`}>
              <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  {t(col.titleKey)}
                </h3>
                <span className="text-xs text-slate-500">{items.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[80px]">
                {items.length === 0 ? (
                  <div className="text-center text-xs text-slate-400 py-4">
                    {t('facts.column.empty')}
                  </div>
                ) : (
                  items.map((fact) => (
                    <FactCard
                      key={fact.entityId}
                      fact={fact}
                      columnStatus={col.status}
                      onChangeStatus={(s) => void changeStatus(fact.entityId, s)}
                      onRetract={() => {
                        setRetractFor(fact.entityId);
                        setRetractReason('');
                      }}
                      onConflict={() => setConflictFor(fact.entityId)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Retract dialog */}
      {retractFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setRetractFor(null)} />
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {t('facts.retract.title')}
            </h3>
            <p className="text-sm text-slate-600 mb-3">{t('facts.retract.hint')}</p>
            <input
              type="text"
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              placeholder={t('facts.retract.reason')}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRetractFor(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('facts.retract.cancel')}
              </button>
              <button
                onClick={() => void handleRetract(retractFor)}
                disabled={!retractReason.trim()}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {t('facts.retract.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FactCard({
  fact,
  columnStatus,
  onChangeStatus,
  onRetract,
  onConflict,
}: {
  fact: FactItemView;
  columnStatus: FactStatus;
  onChangeStatus: (status: FactStatus) => void;
  onRetract: () => void;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  const payload = fact.lastPut?.payload as
    | { text?: string; source?: string; status?: FactStatus; logEntryId?: string }
    | undefined;
  const isRefuted = payload?.status === 'refuted';
  const wall = fact.lastPut ? hlcParse(fact.lastPut.hlc).wall : null;

  return (
    <div
      className={`bg-white border rounded p-3 shadow-sm ${
        isRefuted || fact.retracted ? 'opacity-70' : ''
      }`}
    >
      <p
        className={`text-sm text-slate-900 ${
          isRefuted || fact.retracted ? 'line-through text-slate-400' : ''
        }`}
      >
        {payload?.text ?? ''}
      </p>
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
        {wall && <span>{new Date(wall).toLocaleString()}</span>}
        {fact.lastPut && <span>· {fact.lastPut.authorId}</span>}
        {payload?.source && <span>· {payload.source}</span>}
        {payload?.logEntryId && (
          <span>
            · <span className="underline">{t('facts.linkedLog')}</span>
          </span>
        )}
        {fact.conflict && (
          <button
            onClick={onConflict}
            className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200"
          >
            {t('conflict.title')}
          </button>
        )}
      </div>
      {/* Status transition actions */}
      <div className="mt-2 flex gap-1 flex-wrap">
        {columnStatus === 'assumption' && !fact.retracted && (
          <>
            <button
              onClick={() => onChangeStatus('verified')}
              className="px-2 py-0.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            >
              {t('facts.action.verify')}
            </button>
            <button
              onClick={() => onChangeStatus('refuted')}
              className="px-2 py-0.5 text-xs bg-slate-600 text-white rounded hover:bg-slate-700"
            >
              {t('facts.action.refute')}
            </button>
          </>
        )}
        {columnStatus === 'info_need' && !fact.retracted && (
          <button
            onClick={() => onChangeStatus('verified')}
            className="px-2 py-0.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
          >
            {t('facts.action.answered')}
          </button>
        )}
        {columnStatus === 'verified' && !fact.retracted && (
          <button
            onClick={onRetract}
            className="px-2 py-0.5 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50"
          >
            {t('history.retract')}
          </button>
        )}
      </div>
    </div>
  );
}
