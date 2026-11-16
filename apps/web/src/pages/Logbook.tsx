// Logbook — plan.md §5 / M16
//
// Incident log of events: create form (text, category, event time, source),
// list with filters (category, text search), retract with reason (shown
// struck through), conflict banner and entity history drawer.
// Offline-first: writes go to local Dexie first and sync in the background.

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { hlcParse, type RecordEnvelope } from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { useLogbook, type LogEntryView } from '../hooks/useLogbook.js';
import { ConflictBanner } from '../components/ConflictBanner.js';
import { Dialog } from '../components/Dialog.js';
import { EntityHistory } from '../components/EntityHistory.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

export interface LogbookProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
}

export default function Logbook({ store, incidentId, authorId }: LogbookProps) {
  const { t } = useTranslation();
  const { entries, loading, error, createEntry, retractEntry, mergeEntry, refresh } =
    useLogbook(store, incidentId, authorId);

  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('event');
  const [eventTime, setEventTime] = useState(() => toLocalInputValue(new Date()));
  const [source, setSource] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [conflictFor, setConflictFor] = useState<string | null>(null);
  const [retractFor, setRetractFor] = useState<string | null>(null);
  const [retractReason, setRetractReason] = useState('');

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return entries.filter((entry) => {
      const payload = entry.current?.payload as
        | { text?: string; category?: string }
        | undefined;
      if (filterCategory && payload?.category !== filterCategory) return false;
      if (q && !(payload?.text ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, searchText, filterCategory]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createEntry({
        text: text.trim(),
        category: category as 'event' | 'info' | 'decision' | 'contact' | 'other',
        eventTime: new Date(eventTime).toISOString(),
        source: source.trim() || undefined,
      });
      setText('');
      setSource('');
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetract(entityId: string) {
    if (!retractReason.trim()) return;
    await retractEntry(entityId, retractReason.trim());
    setRetractFor(null);
    setRetractReason('');
  }

  async function handleMerge(selectedHead: RecordEnvelope, allHeads: RecordEnvelope[]) {
    await mergeEntry(selectedHead, allHeads);
    setConflictFor(null);
  }

  if (loading) {
    return <div className="text-center py-10">{t('logbook.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      {error && <ErrorNotice message={error} onRetry={() => void refresh()} />}

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900">{t('logbook.title')}</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors"
        >
          {showForm ? t('logbook.closeForm') : t('logbook.createEntry')}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-lg p-4 space-y-3"
        >
          <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            {t('logbook.publicRecordReminder')}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('logbook.form.text')}
            aria-label={t('logbook.form.text')}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('logbook.form.category')}
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="event">{t('logbook.category.event')}</option>
                <option value="info">{t('logbook.category.info')}</option>
                <option value="decision">{t('logbook.category.decision')}</option>
                <option value="contact">{t('logbook.category.contact')}</option>
                <option value="other">{t('logbook.category.other')}</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('logbook.form.eventTime')}
              </span>
              <input
                type="datetime-local"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('logbook.form.source')}
              </span>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
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
              {submitting ? t('logbook.form.saving') : t('logbook.form.save')}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={t('logbook.filter.search')}
          aria-label={t('logbook.filter.search')}
          className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm bg-white"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          aria-label={t('logbook.filter.allCategories')}
          className="px-3 py-2 border border-slate-300 rounded text-sm bg-white"
        >
          <option value="">{t('logbook.filter.allCategories')}</option>
          <option value="event">{t('logbook.category.event')}</option>
          <option value="info">{t('logbook.category.info')}</option>
          <option value="decision">{t('logbook.category.decision')}</option>
          <option value="contact">{t('logbook.category.contact')}</option>
          <option value="other">{t('logbook.category.other')}</option>
        </select>
      </div>

      {/* Conflict banner for the selected entity */}
      {conflictFor &&
        (() => {
          const entry = entries.find((e) => e.entityId === conflictFor);
          if (!entry || !entry.conflict) return null;
          return (
            <ConflictBanner
              entityId={entry.entityId}
              heads={entry.heads}
              current={entry.current}
              onMerge={handleMerge}
            />
          );
        })()}

      {/* Entries */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-slate-500 border border-dashed border-slate-200 rounded">
            {t('logbook.empty')}
          </div>
        ) : (
          filtered.map((entry) => (
            <LogEntryRow
              key={entry.entityId}
              entry={entry}
              onRetract={() => {
                setRetractFor(entry.entityId);
                setRetractReason('');
              }}
              onHistory={() => setHistoryFor(entry.entityId)}
              onConflict={() => setConflictFor(entry.entityId)}
            />
          ))
        )}
      </div>

      {/* Retract dialog */}
      {retractFor && (
        <Dialog title={t('logbook.retract.title')} onClose={() => setRetractFor(null)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{t('logbook.retract.hint')}</p>
            <input
              type="text"
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              placeholder={t('logbook.retract.reason')}
              aria-label={t('logbook.retract.reason')}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRetractFor(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('logbook.retract.cancel')}
              </button>
              <button
                onClick={() => void handleRetract(retractFor)}
                disabled={!retractReason.trim()}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {t('logbook.retract.confirm')}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* History drawer */}
      {historyFor &&
        (() => {
          const entry = entries.find((e) => e.entityId === historyFor);
          if (!entry) return null;
          return (
            <EntityHistory
              entityId={entry.entityId}
              history={entry.history}
              isOpen={true}
              onClose={() => setHistoryFor(null)}
            />
          );
        })()}
    </div>
  );
}

function LogEntryRow({
  entry,
  onRetract,
  onHistory,
  onConflict,
}: {
  entry: LogEntryView;
  onRetract: () => void;
  onHistory: () => void;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  // Display the last put payload — after a retract, `current` is the retract
  // record (payload = {reason}) and the original text lives in history.
  const display = entry.lastPut ?? entry.current;
  const payload = display?.payload as
    | { text?: string; category?: string; source?: string }
    | undefined;
  const wall = display ? hlcParse(display.hlc).wall : null;

  return (
    <div
      className={`bg-white border rounded-lg p-4 ${
        entry.retracted ? 'border-slate-200 opacity-70' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {payload?.category && (
              <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                {t(`logbook.category.${payload.category}`)}
              </span>
            )}
            {entry.retracted && (
              <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">
                {t('logbook.retracted')}
              </span>
            )}
            {entry.conflict && (
              <button
                onClick={onConflict}
                className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700 hover:bg-amber-200"
              >
                {t('conflict.title')}
              </button>
            )}
          </div>
          <p
            className={`text-sm text-slate-900 ${
              entry.retracted ? 'line-through text-slate-400' : ''
            }`}
          >
            {payload?.text ?? ''}
          </p>
          <div className="mt-1 text-xs text-slate-500">
            {wall ? new Date(wall).toLocaleString() : ''}
            {payload?.source ? ` · ${t('logbook.form.source')}: ${payload.source}` : ''}
            {display ? ` · ${display.authorId}` : ''}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onHistory}
            className="px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50"
          >
            {t('history.title')}
          </button>
          {!entry.retracted && (
            <button
              onClick={onRetract}
              className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50"
            >
              {t('history.retract')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
