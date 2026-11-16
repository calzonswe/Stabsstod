// SituationEditor — plan.md §5 / M18
//
// Editor with sections (Vad har hänt / Nuvarande / Konsekvenser), the five
// protected values as checkboxes, and FIS fields (Fakta → Innebörd →
// Slutsatser) as three steps. Saving creates a new version. The "current
// picture" is the latest version, rendered read-only. History lists all
// versions; picking two shows a simple line diff.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diffLines, renderSnapshotText, PROTECTED_VALUES } from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import {
  useSituationSnapshots,
  type SituationSnapshotPayloadShape,
} from '../hooks/useSituationSnapshots.js';
import { Dialog } from '../components/Dialog.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

export interface SituationEditorProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
}

export default function SituationEditor({
  store,
  incidentId,
  authorId,
}: SituationEditorProps) {
  const { t } = useTranslation();
  const { snapshot, loading, error, saveVersion, retractSnapshot, refresh } =
    useSituationSnapshots(store, incidentId, authorId);

  const [whatHappened, setWhatHappened] = useState('');
  const [current, setCurrent] = useState('');
  const [consequences, setConsequences] = useState('');
  const [fakta, setFakta] = useState('');
  const [innebord, setInnebord] = useState('');
  const [slutsats, setSlutsats] = useState('');
  const [protectedValues, setProtectedValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [diffFrom, setDiffFrom] = useState<string | null>(null);
  const [diffTo, setDiffTo] = useState<string | null>(null);
  const [retracting, setRetracting] = useState(false);
  const [retractReason, setRetractReason] = useState('');

  // Pre-fill the editor with the latest version.
  useEffect(() => {
    const latest = snapshot?.lastPut?.payload as
      | SituationSnapshotPayloadShape
      | undefined;
    if (latest) {
      setWhatHappened(latest.whatHappened ?? '');
      setCurrent(latest.current ?? '');
      setConsequences(latest.consequences ?? '');
      setFakta(latest.fis?.fakta ?? '');
      setInnebord(latest.fis?.innebord ?? '');
      setSlutsats(latest.fis?.slutsats ?? '');
      setProtectedValues(latest.protectedValues ?? []);
    }
  }, [snapshot?.lastPut?.id, snapshot]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await saveVersion({
        whatHappened: whatHappened.trim() || undefined,
        current: current.trim() || undefined,
        consequences: consequences.trim() || undefined,
        fis: {
          fakta: fakta.trim() || undefined,
          innebord: innebord.trim() || undefined,
          slutsats: slutsats.trim() || undefined,
        },
        protectedValues,
      });
    } finally {
      setSaving(false);
    }
  }

  function toggleProtected(value: string) {
    setProtectedValues((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  if (loading) {
    return <div className="text-center py-10">{t('situation.loading')}</div>;
  }

  const versions = snapshot?.versions ?? [];
  const isRetracted = snapshot?.retracted ?? false;
  const currentPayload = snapshot?.current?.payload as
    | (SituationSnapshotPayloadShape & { reason?: string })
    | undefined;
  const currentIsRetract = snapshot?.current?.kind === 'retract';
  const displayPayload = currentIsRetract
    ? (snapshot?.lastPut?.payload as SituationSnapshotPayloadShape | undefined)
    : currentPayload;

  const diffLinesView =
    diffFrom && diffTo
      ? diffLines(
          renderSnapshotText(
            (versions.find((v) => v.id === diffFrom)?.payload ??
              {}) as Parameters<typeof renderSnapshotText>[0],
          ),
          renderSnapshotText(
            (versions.find((v) => v.id === diffTo)?.payload ??
              {}) as Parameters<typeof renderSnapshotText>[0],
          ),
        )
      : null;

  return (
    <div className="space-y-4">
      {error && <ErrorNotice message={error} onRetry={() => void refresh()} />}

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900">{t('situation.title')}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
          >
            {t('situation.history')}
          </button>
          <button
            onClick={() => setRetracting(true)}
            disabled={!snapshot || isRetracted}
            className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
          >
            {t('history.retract')}
          </button>
        </div>
      </div>

      {isRetracted && (
        <div className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
          {t('situation.retractedNotice')}
          {currentIsRetract && (currentPayload?.reason ? ` — ${currentPayload.reason}` : '')}
        </div>
      )}

      {/* Current picture = latest version */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          {t('situation.currentPicture')}
        </h3>
        {displayPayload ? (
          <div
            className={`space-y-2 text-sm text-slate-800 ${
              isRetracted ? 'line-through opacity-60' : ''
            }`}
          >
            {displayPayload.whatHappened && (
              <p>
                <span className="font-medium">{t('situation.section.whatHappened')}:</span>{' '}
                {displayPayload.whatHappened}
              </p>
            )}
            {displayPayload.current && (
              <p>
                <span className="font-medium">{t('situation.section.current')}:</span>{' '}
                {displayPayload.current}
              </p>
            )}
            {displayPayload.consequences && (
              <p>
                <span className="font-medium">{t('situation.section.consequences')}:</span>{' '}
                {displayPayload.consequences}
              </p>
            )}
            {displayPayload.fis?.fakta && (
              <p>
                <span className="font-medium">{t('situation.fis.fakta')}:</span>{' '}
                {displayPayload.fis.fakta}
              </p>
            )}
            {displayPayload.fis?.innebord && (
              <p>
                <span className="font-medium">{t('situation.fis.innebord')}:</span>{' '}
                {displayPayload.fis.innebord}
              </p>
            )}
            {displayPayload.fis?.slutsats && (
              <p>
                <span className="font-medium">{t('situation.fis.slutsats')}:</span>{' '}
                {displayPayload.fis.slutsats}
              </p>
            )}
            {(displayPayload.protectedValues?.length ?? 0) > 0 && (
              <p>
                <span className="font-medium">{t('situation.protectedValues')}:</span>{' '}
                {displayPayload.protectedValues
                  .map((v) => t(`situation.protected.${v}`))
                  .join(', ')}
              </p>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-500">{t('situation.noSnapshot')}</div>
        )}
      </div>

      {/* Editor */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">
          {t('situation.editorTitle')}
        </h3>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            {t('situation.section.whatHappened')}
          </span>
          <textarea
            value={whatHappened}
            onChange={(e) => setWhatHappened(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            {t('situation.section.current')}
          </span>
          <textarea
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            {t('situation.section.consequences')}
          </span>
          <textarea
            value={consequences}
            onChange={(e) => setConsequences(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </label>

        {/* FIS: three steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              {t('situation.fis.step1')} — {t('situation.fis.fakta')}
            </span>
            <textarea
              value={fakta}
              onChange={(e) => setFakta(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              {t('situation.fis.step2')} — {t('situation.fis.innebord')}
            </span>
            <textarea
              value={innebord}
              onChange={(e) => setInnebord(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              {t('situation.fis.step3')} — {t('situation.fis.slutsats')}
            </span>
            <textarea
              value={slutsats}
              onChange={(e) => setSlutsats(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </label>
        </div>

        {/* Five protected values */}
        <fieldset>
          <legend className="text-xs font-medium text-slate-600 mb-1">
            {t('situation.protectedValues')}
          </legend>
          <div className="flex flex-wrap gap-3">
            {PROTECTED_VALUES.map((pv) => (
              <label key={pv} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={protectedValues.includes(pv)}
                  onChange={() => toggleProtected(pv)}
                  className="rounded border-slate-300"
                />
                {t(`situation.protected.${pv}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? t('situation.saving') : t('situation.saveVersion')}
          </button>
        </div>
      </div>

      {/* Version history + diff */}
      {showHistory && versions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            {t('history.title')} ({versions.length})
          </h3>
          <div className="space-y-1">
            {versions.map((v, idx) => (
              <div key={v.id} className="flex items-center gap-3 text-sm">
                <span className="text-xs text-slate-500">
                  v{idx + 1} · {new Date(
                    Number(v.hlc.split('-')[0]),
                  ).toLocaleString()}{' '}
                  · {v.authorId}
                </span>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name="diff-from"
                    checked={diffFrom === v.id}
                    onChange={() => setDiffFrom(v.id)}
                  />
                  {t('situation.diff.from')}
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name="diff-to"
                    checked={diffTo === v.id}
                    onChange={() => setDiffTo(v.id)}
                  />
                  {t('situation.diff.to')}
                </label>
              </div>
            ))}
          </div>

          {diffLinesView && (
            <div className="mt-3 border border-slate-200 rounded overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 text-xs text-slate-600 border-b border-slate-200">
                {t('situation.diff.title')}
              </div>
              <pre className="text-xs leading-5 px-3 py-2 overflow-x-auto">
                {diffLinesView.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.kind === 'added'
                        ? 'bg-green-50 text-green-800'
                        : line.kind === 'removed'
                          ? 'bg-red-50 text-red-700'
                          : 'text-slate-500'
                    }
                  >
                    {line.kind === 'added'
                      ? '+ '
                      : line.kind === 'removed'
                        ? '- '
                        : '  '}
                    {line.text || ' '}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Retract dialog */}
      {retracting && (
        <Dialog title={t('situation.retract.title')} onClose={() => setRetracting(false)}>
          <div className="space-y-3">
            <input
              type="text"
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              placeholder={t('situation.retract.reason')}
              aria-label={t('situation.retract.reason')}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRetracting(false)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('facts.retract.cancel')}
              </button>
              <button
                onClick={() => {
                  void retractSnapshot(retractReason.trim() || t('situation.retract.defaultReason'));
                  setRetracting(false);
                }}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('facts.retract.confirm')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
