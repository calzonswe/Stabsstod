// Sitrep — plan.md §10 / M35.
//
// Printable situation report. Section selection (mission, direction,
// situation picture, key facts/assumptions, decisions, open tasks, resources,
// map snapshot, timeline) → print stylesheet → user prints to PDF in the
// browser (works offline). Saving creates a `sitrep` record with a frozen
// copy of the selected sections' data, so it can be re-printed later exactly
// as it was at save time.
//
// The core `Sitrep` component receives already-loaded data (no fetch), which
// keeps it testable from fixtures. The default export is the page wrapper
// that loads the incident context from the API.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext.js';
import { useParams } from 'react-router-dom';
import {
  selectSitrepSections,
  type SitrepSectionData,
  newRecord,
  type RecordEnvelope,
} from '@stabsstod/shared';
import { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

const SECTIONS: Array<{ id: keyof SitrepSectionData; labelKey: string }> = [
  { id: 'mission', labelKey: 'sitrep.section.mission' },
  { id: 'direction', labelKey: 'sitrep.section.direction' },
  { id: 'situation', labelKey: 'sitrep.section.situation' },
  { id: 'facts', labelKey: 'sitrep.section.facts' },
  { id: 'decisions', labelKey: 'sitrep.section.decisions' },
  { id: 'tasks', labelKey: 'sitrep.section.tasks' },
  { id: 'resources', labelKey: 'sitrep.section.resources' },
  { id: 'timeline', labelKey: 'sitrep.section.timeline' },
  { id: 'map', labelKey: 'sitrep.section.map' },
] as const;

export interface SitrepProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
}

export function Sitrep({ store, incidentId, authorId }: SitrepProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<RecordEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(SECTIONS.map((s) => s.id)),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load the incident's records from the local store and re-read on a short
  // interval so newly synced records are picked up (works offline).
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!store) {
        setLoading(false);
        return;
      }
      try {
        const recs = await store.getRecordsByIncident(incidentId);
        if (active) setRecords(recs);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'failed to load records');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [store, incidentId]);

  const data: SitrepSectionData = useMemo(() => selectSitrepSections(records), [records]);

  const toggleSection = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const saveSitrep = useCallback(async () => {
    if (!store) return;
    setSaving(true);
    try {
      const sitrepRecords = await store.getRecordsByEntity(
        `sitrep-${incidentId}`,
      );
      const state = loadHlcState();
      const snapshot: Record<string, unknown> = {};
      for (const sectionId of selected) {
        snapshot[sectionId] = (data as unknown as Record<string, unknown>)[sectionId];
      }
      const { record, state: nextState } = newRecord({
        entityId: `sitrep-${incidentId}`,
        entityType: 'sitrep',
        incidentId,
        parentIds: sitrepRecords.map((r) => r.id),
        functionId: null,
        authorId,
        deviceId: getDeviceId(),
        schemaVersion: 1,
        payload: {
          title: t('sitrep.defaultTitle'),
          sections: Array.from(selected).sort(),
          generatedAt: new Date().toISOString(),
          snapshot,
        },
        createdAtClient: new Date().toISOString(),
        kind: 'put',
        state,
      });
      saveHlcState(nextState, getDeviceId());
      await store.addLocalRecord(record);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save sitrep');
    } finally {
      setSaving(false);
    }
  }, [store, incidentId, authorId, records, selected, data, t]);

  if (loading) {
    return <div className="text-center py-10">{t('incidents.loading')}</div>;
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100 inline-block">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      <div className="border-b border-slate-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t('sitrep.title')}</h1>
          <p className="text-sm text-slate-500">{t('sitrep.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs text-indigo-600 hover:text-indigo-700 no-print"
            onClick={() => window.print()}
          >
            🖨️ {t('sitrep.print')}
          </button>
          <button
            type="button"
            disabled={saving}
            className={`text-xs font-medium rounded border px-2 py-1 no-print ${
              saving
                ? 'bg-slate-200 text-slate-500 border-slate-300'
                : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
            }`}
            onClick={() => void saveSitrep()}
          >
            {saving ? t('sitrep.saving') : t('sitrep.save')}
          </button>
          {saved && (
            <span className="text-xs text-green-600 no-print">{t('sitrep.saved')}</span>
          )}
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg p-4 no-print">
        <h2 className="text-sm font-medium text-slate-700 mb-3">
          {t('sitrep.sections')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {SECTIONS.map((section) => (
            <label key={section.id} className="flex items-center gap-2 p-2 rounded border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(section.id)}
                onChange={() => toggleSection(section.id)}
                className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-slate-700">
                {t(section.labelKey)}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Printable report view */}
      <div className="sitrep-report">
        <header className="mb-6 border-b border-slate-200 pb-2">
          <h2 className="text-2xl font-bold text-slate-900">{t('sitrep.title')}</h2>
          <p className="text-sm text-slate-500">
            {t('sitrep.generated', { date: new Date().toLocaleString('sv-SE') })}
          </p>
        </header>

        {selected.has('mission') && data.mission?.hasMission && (
          <section className="mb-6" id="sitrep-mission">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.mission')}
            </h2>
            <p className="text-slate-700">{data.mission.content}</p>
            {data.mission.staffShouldDo && (
              <p className="mt-1"><strong>{t('sitrep.staffShouldDo')}:</strong> {data.mission.staffShouldDo}</p>
            )}
            {data.mission.staffShouldNotDo && (
              <p className="mt-1"><strong>{t('sitrep.staffShouldNotDo')}:</strong> {data.mission.staffShouldNotDo}</p>
            )}
            {data.mission.deadline && (
              <p className="mt-1"><strong>{t('sitrep.deadline')}:</strong> {data.mission.deadline}</p>
            )}
          </section>
        )}

        {selected.has('direction') && data.direction?.hasDirection && (
          <section className="mb-6" id="sitrep-direction">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.direction')}
            </h2>
            <p className="text-slate-700"><strong>{t('sitrep.desired')}:</strong> {data.direction.desired}</p>
            {data.direction.actual && (
              <p className="mt-1"><strong>{t('sitrep.actual')}:</strong> {data.direction.actual}</p>
            )}
            {data.direction.divergenceNote && (
              <p className="mt-1"><strong>{t('sitrep.divergenceNote')}:</strong> {data.direction.divergenceNote}</p>
            )}
          </section>
        )}

        {selected.has('situation') && data.situation && (
          <section className="mb-6" id="sitrep-situation">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.situation')}
            </h2>
            {data.situation.whatHappened && (
              <p className="text-slate-700"><strong>{t('sitrep.whatHappened')}:</strong> {data.situation.whatHappened}</p>
            )}
            {data.situation.current && (
              <p className="mt-1"><strong>{t('sitrep.currentSituation')}:</strong> {data.situation.current}</p>
            )}
            {data.situation.consequences && (
              <p className="mt-1"><strong>{t('sitrep.consequences')}:</strong> {data.situation.consequences}</p>
            )}
          </section>
        )}

        {selected.has('facts') && data.facts.length > 0 && (
          <section className="mb-6" id="sitrep-facts">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.facts')}
            </h2>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              {data.facts.map((f) => (
                <li key={f.text}>
                  <span className={`font-bold ${f.status === 'verified' ? 'text-green-700' : f.status === 'assumption' ? 'text-amber-700' : 'text-slate-700'}`}>
                    [{f.status}]
                  </span>{' '}{f.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {selected.has('decisions') && (
          <section className="mb-6" id="sitrep-decisions">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.decisions')}
            </h2>
            {data.decisions.requests.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-slate-700 mt-3 mb-1">
                  {t('sitrep.decisionsWaiting')}
                </h3>
                <ul className="list-disc list-inside space-y-1 text-slate-700">
                  {data.decisions.requests.map((r, i) => (
                    <li key={i}>
                      <strong>{r.question}</strong>{r.neededBy && (
                        <span className="text-xs text-slate-500"> — {t('sitrep.neededBy', { date: r.neededBy })}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {data.decisions.decisions.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-slate-700 mt-3 mb-1">
                  {t('sitrep.decisionsMade')}
                </h3>
                <ul className="list-disc list-inside space-y-1 text-slate-700">
                  {data.decisions.decisions.map((d, i) => (
                    <li key={i}>
                      <strong>{d.text}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {data.decisions.requests.length === 0 && data.decisions.decisions.length === 0 && (
              <p className="text-sm text-slate-500">{t('sitrep.noDecisions')}</p>
            )}
          </section>
        )}

        {selected.has('tasks') && data.tasks.length > 0 && (
          <section className="mb-6" id="sitrep-tasks">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.tasks')}
            </h2>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              {data.tasks.map((task, i) => (
                <li key={i}>
                  <strong>{task.title}</strong>
                  {task.due && (
                    <span className="text-xs text-slate-500 ml-2">({t('sitrep.due', { date: task.due })})</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {selected.has('resources') && data.resources.length > 0 && (
          <section className="mb-6" id="sitrep-resources">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.resources')}
            </h2>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              {data.resources.map((r, i) => (
                <li key={i}>
                  <strong>{r.name}</strong>
                  {r.quantity != null && (
                    <span className="text-xs text-slate-500 ml-2">({r.quantity} {r.unit || ''})</span>
                  )}
                  <span className="text-xs text-slate-500 ml-2">[{r.status}]</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {selected.has('timeline') && data.timeline.length > 0 && (
          <section className="mb-6" id="sitrep-timeline">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.timeline')}
            </h2>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              {data.timeline.map((e, i) => (
                <li key={i}>
                  <strong>{e.time}</strong> — {e.title}
                </li>
              ))}
            </ul>
          </section>
        )}

        {selected.has('map') && data.map.length > 0 && (
          <section className="mb-6" id="sitrep-map">
            <h2 className="text-lg font-bold text-slate-900 mb-2 border-b border-slate-200 pb-1">
              {t('sitrep.section.map')}
            </h2>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              {data.map.map((m, i) => (
                <li key={i}>
                  <strong>{m.label}</strong>
                  <span className="text-xs text-slate-500 ml-2">[{m.layer} · {m.severity}]</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Print stylesheet — hides UI controls when printing */}
      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: white !important;
          }
          .sitrep-report {
            max-width: 100%;
            padding: 0;
          }
          section {
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper — loads incident context from the API
// ---------------------------------------------------------------------------

export default function SitrepPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<{ id: string; name: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [localStore] = useState<LocalStore | null>(() => (user ? new LocalStore({ userId: user.id }) : null));

  useEffect(() => {
    if (id) {
      void loadIncident();
    }
  }, [id]);

  async function loadIncident() {
    try {
      setError('');
      const data = await api(`/api/incidents/${id}`);
      setIncident({
        id: data.incident.id,
        name: data.incident.name,
        status: data.incident.status,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load incident');
    } finally {
      setLoading(false);
    }
  }

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(path, { credentials: 'include', ...init });
    if (!res.ok) {
      throw new Error(`API ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  if (loading) {
    return <div className="text-center py-10">{t('incidents.loading')}</div>;
  }

  if (error || !incident || !localStore || !id) {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100 inline-block">
          {error || t('incidents.detail.notFound')}
        </div>
      </div>
    );
  }

  return (
    <Sitrep
      store={localStore}
      incidentId={id}
      authorId={user?.id ?? ''}
    />
  );
}
