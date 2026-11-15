// Evaluation — plan.md §7 / M36.
//
// After-action review (AAR) form with the five questions:
//   why (Varför ska vi utvärdera?)
//   what (Vad ska utvärderas?)
//   whoAffected (Vilka är berörda?)
//   how (Hur ska utvärderingen gå till?)
//   useOfResult (Hur ska vi använda resultatet?)
// Plus free-form learnings.
//
// Writable even on a closed incident (the only record type allowed after
// closure). Gated with can() like any other write.
//
// The core `Evaluation` component receives already-loaded data; the default
// export is the page wrapper that loads the incident context from the API.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { can, type Actor } from '@stabsstod/shared';
import { newRecord, type RecordEnvelope } from '@stabsstod/shared';
import { useAuth } from '../contexts/AuthContext.js';
import { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export interface EvaluationProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
}

export interface EvaluationPayload {
  why: string;
  what: string;
  whoAffected: string;
  how: string;
  useOfResult: string;
  learnings: string[];
}

export function Evaluation({
  store,
  incidentId,
  authorId,
  actor,
}: EvaluationProps) {
  const { t } = useTranslation();
  const canWrite = actor
    ? can(actor, 'write', { entityType: 'evaluation', incidentId, functionId: null }, {})
    : false;

  const [records, setRecords] = useState<RecordEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [why, setWhy] = useState('');
  const [what, setWhat] = useState('');
  const [whoAffected, setWhoAffected] = useState('');
  const [how, setHow] = useState('');
  const [useOfResult, setUseOfResult] = useState('');
  const [learnings, setLearnings] = useState<string[]>([]);
  const [newLearning, setNewLearning] = useState('');

  // Load evaluation records from the local store.
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!store) {
        setLoading(false);
        return;
      }
      try {
        const recs = await store.getRecordsByIncident(incidentId);
        const evalRecs = recs.filter((r) => r.entityType === 'evaluation');
        if (active) setRecords(evalRecs);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'failed to load evaluation');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [store, incidentId]);

  const evaluation = useMemo(() => {
    if (records.length === 0) return null;
    const sorted = [...records].sort((a, b) => a.hlc.localeCompare(b.hlc));
    const latest = sorted[sorted.length - 1];
    return latest?.payload as EvaluationPayload | undefined;
  }, [records]);

  useEffect(() => {
    if (evaluation) {
      setWhy(evaluation.why);
      setWhat(evaluation.what);
      setWhoAffected(evaluation.whoAffected);
      setHow(evaluation.how);
      setUseOfResult(evaluation.useOfResult);
      setLearnings(evaluation.learnings ?? []);
    } else {
      setWhy('');
      setWhat('');
      setWhoAffected('');
      setHow('');
      setUseOfResult('');
      setLearnings([]);
    }
  }, [evaluation]);

  const addLearning = useCallback(() => {
    if (!newLearning.trim()) return;
    setLearnings((prev) => [...prev, newLearning.trim()]);
    setNewLearning('');
  }, [newLearning]);

  const removeLearning = useCallback((index: number) => {
    setLearnings((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    if (!store || !canWrite || saving) return;
    if (!why.trim() || !what.trim() || !whoAffected.trim() || !how.trim() || !useOfResult.trim()) {
      return;
    }
    setSaving(true);
    try {
      const payload: EvaluationPayload = {
        why: why.trim(),
        what: what.trim(),
        whoAffected: whoAffected.trim(),
        how: how.trim(),
        useOfResult: useOfResult.trim(),
        learnings: learnings,
      };
      const state = loadHlcState();
      const { record, state: nextState } = newRecord({
        entityId: `evaluation-${incidentId}`,
        entityType: 'evaluation',
        incidentId,
        parentIds: [],
        functionId: null,
        authorId,
        deviceId: getDeviceId(),
        schemaVersion: 1,
        payload,
        createdAtClient: new Date().toISOString(),
        kind: 'put',
        state,
      });
      saveHlcState(nextState, getDeviceId());
      await store.addLocalRecord(record);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save evaluation');
    } finally {
      setSaving(false);
    }
  }, [store, incidentId, authorId, canWrite, saving, why, what, whoAffected, how, useOfResult, learnings]);

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
    <div className="max-w-2xl mx-auto py-6 space-y-6">
      <div className="border-b border-slate-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t('evaluation.title')}</h1>
          <p className="text-sm text-slate-500">{t('evaluation.subtitle')}</p>
        </div>
        {!editing && canWrite && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50"
          >
            {t('evaluation.edit')}
          </button>
        )}
      </div>

      {evaluation && !editing && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                {t('evaluation.qWhy')}
              </h3>
              <p className="text-sm text-slate-700">{evaluation.why}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                {t('evaluation.qWhat')}
              </h3>
              <p className="text-sm text-slate-700">{evaluation.what}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                {t('evaluation.qWhoAffected')}
              </h3>
              <p className="text-sm text-slate-700">{evaluation.whoAffected}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                {t('evaluation.qHow')}
              </h3>
              <p className="text-sm text-slate-700">{evaluation.how}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                {t('evaluation.qUseOfResult')}
              </h3>
              <p className="text-sm text-slate-700">{evaluation.useOfResult}</p>
            </div>
          </div>
          {evaluation.learnings.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                {t('evaluation.learnings')}
              </h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-slate-700">
                {evaluation.learnings.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!evaluation && !editing && (
        <div className="text-sm text-slate-500 text-center py-8">
          {t('evaluation.noEvaluation')}
        </div>
      )}

      {editing && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600 block">
                {t('evaluation.qWhy')}
              </label>
              <textarea
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600 block">
                {t('evaluation.qWhat')}
              </label>
              <textarea
                value={what}
                onChange={(e) => setWhat(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600 block">
                {t('evaluation.qWhoAffected')}
              </label>
              <textarea
                value={whoAffected}
                onChange={(e) => setWhoAffected(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600 block">
                {t('evaluation.qHow')}
              </label>
              <textarea
                value={how}
                onChange={(e) => setHow(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600 block">
                {t('evaluation.qUseOfResult')}
              </label>
              <textarea
                value={useOfResult}
                onChange={(e) => setUseOfResult(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-600 block">
              {t('evaluation.learnings')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newLearning}
                onChange={(e) => setNewLearning(e.target.value)}
                placeholder={t('evaluation.learningPlaceholder')}
                className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
              <button
                type="button"
                onClick={() => void addLearning()}
                disabled={!newLearning.trim()}
                className="px-3 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {t('evaluation.addLearning')}
              </button>
            </div>
            {learnings.length > 0 && (
              <ul className="space-y-1 mt-2">
                {learnings.map((l, i) => (
                  <li key={i} className="flex items-center gap-2 p-2 border border-slate-200 rounded text-sm">
                    <span className="flex-1">{l}</span>
                    <button
                      type="button"
                      onClick={() => void removeLearning(i)}
                      className="text-xs text-slate-400 hover:text-red-600"
                    >
                      {t('closurePlan.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2 text-slate-600 border border-slate-300 rounded hover:bg-slate-50 text-sm"
            >
              {t('closurePlan.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !why.trim() || !what.trim() || !whoAffected.trim() || !how.trim() || !useOfResult.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('closurePlan.saving') : t('closurePlan.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper — loads incident context from the API
// ---------------------------------------------------------------------------

export default function EvaluationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<{
    id: string;
    name: string;
    status: string;
    role: string;
  } | null>(null);
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
        role: data.incident.role,
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

  const actor: Actor | null = user && incident && id
    ? {
        userId: user.id,
        incidentId: id,
        role: incident.role as Actor['role'],
        functionIds: [],
      }
    : null;

  return (
    <Evaluation
      store={localStore}
      incidentId={id}
      authorId={user?.id ?? ''}
      actor={actor}
    />
  );
}
