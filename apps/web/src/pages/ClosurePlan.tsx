// Closure plan — plan.md §7 / M36.
//
// Wind-down plan: items say what to archive/discard/hand over, who owns
// each item, and (optionally) where it goes and how long it is retained.
// Writable by chief_of_staff / deputy_chief only (gated with can()).
//
// The core `ClosurePlan` component receives already-loaded data; the default
// export is the page wrapper that loads the incident context from the API.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { can, type Actor } from '@stabsstod/shared';
import { newRecord, type RecordEnvelope } from '@stabsstod/shared';
import { useAuth } from '../contexts/AuthContext.js';
import { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export interface ClosurePlanProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
}

export interface ClosurePlanItem {
  what: string;
  action: 'archive' | 'discard' | 'handover';
  owner: string;
  location?: string;
  retention?: string;
}

export interface ClosurePlanPayload {
  items: ClosurePlanItem[];
  status: string;
  announcedAt?: string;
}

export function ClosurePlan({
  store,
  incidentId,
  authorId,
  actor,
}: ClosurePlanProps) {
  const { t } = useTranslation();
  const canWrite = actor
    ? can(actor, 'write', { entityType: 'closure_plan', incidentId, functionId: null }, {})
    : false;

  const [records, setRecords] = useState<RecordEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [status, setStatus] = useState('draft');
  const [announcedAt, setAnnouncedAt] = useState('');
  const [items, setItems] = useState<ClosurePlanItem[]>([]);
  const [newWhat, setNewWhat] = useState('');
  const [newAction, setNewAction] = useState<'archive' | 'discard' | 'handover'>('archive');
  const [newOwner, setNewOwner] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newRetention, setNewRetention] = useState('');

  // Load closure plan records from the local store.
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!store) {
        setLoading(false);
        return;
      }
      try {
        const recs = await store.getRecordsByIncident(incidentId);
        const planRecs = recs.filter((r) => r.entityType === 'closure_plan');
        if (active) setRecords(planRecs);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'failed to load closure plan');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [store, incidentId]);

  const plan = useMemo(() => {
    if (records.length === 0) return null;
    // Latest version by hlc.
    const sorted = [...records].sort((a, b) => a.hlc.localeCompare(b.hlc));
    const latest = sorted[sorted.length - 1];
    return latest?.payload as ClosurePlanPayload | undefined;
  }, [records]);

  useEffect(() => {
    if (plan) {
      setStatus(plan.status ?? 'draft');
      setAnnouncedAt(plan.announcedAt ?? '');
      setItems(plan.items ?? []);
    } else {
      setStatus('draft');
      setAnnouncedAt('');
      setItems([]);
    }
  }, [plan]);

  const addItem = useCallback(() => {
    if (!newWhat.trim() || !newOwner.trim()) return;
    setItems((prev) => [
      ...prev,
      {
        what: newWhat.trim(),
        action: newAction,
        owner: newOwner.trim(),
        location: newLocation.trim() || undefined,
        retention: newRetention.trim() || undefined,
      },
    ]);
    setNewWhat('');
    setNewOwner('');
    setNewLocation('');
    setNewRetention('');
  }, [newWhat, newAction, newOwner, newLocation, newRetention]);

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    if (!store || !canWrite || saving) return;
    setSaving(true);
    try {
      const payload: ClosurePlanPayload = {
        items,
        status,
        ...(announcedAt ? { announcedAt } : {}),
      };
      const state = loadHlcState();
      const { record, state: nextState } = newRecord({
        entityId: `closure-plan-${incidentId}`,
        entityType: 'closure_plan',
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
      setError(err instanceof Error ? err.message : 'failed to save closure plan');
    } finally {
      setSaving(false);
    }
  }, [store, incidentId, authorId, items, status, announcedAt, canWrite, saving]);

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
    <div className="max-w-3xl mx-auto py-6 space-y-6">
      <div className="border-b border-slate-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t('closurePlan.title')}</h1>
          <p className="text-sm text-slate-500">{t('closurePlan.subtitle')}</p>
        </div>
        {!editing && canWrite && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50"
          >
            {t('closurePlan.edit')}
          </button>
        )}
      </div>

      {plan && !editing && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-700">{t('closurePlan.status')}:</span>
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                status === 'completed'
                  ? 'bg-green-100 text-green-700'
                  : status === 'active'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {status}
            </span>
            {announcedAt && (
              <span className="text-xs text-slate-500">
                {t('closurePlan.announcedAt', { date: announcedAt })}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            {t('closurePlan.items')}
          </h3>
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">{t('closurePlan.noItems')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {items.map((item, i) => (
                <li key={i} className="border border-slate-200 rounded p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-slate-700">{item.what}</span>
                    <span
                      className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
                        item.action === 'archive'
                          ? 'bg-blue-100 text-blue-700'
                          : item.action === 'discard'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                    }`}
                    >
                      {item.action}
                    </span>
                    <span className="text-xs text-slate-500">— {item.owner}</span>
                  </div>
                  {item.location && (
                    <p className="text-xs text-slate-500 mt-1">
                      {t('closurePlan.location')}: {item.location}
                    </p>
                  )}
                  {item.retention && (
                    <p className="text-xs text-slate-500 mt-1">
                      {t('closurePlan.retention')}: {item.retention}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!plan && !editing && (
        <div className="text-sm text-slate-500 text-center py-8">
          {t('closurePlan.noPlan')}
        </div>
      )}

      {editing && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">
                {t('closurePlan.status')}
              </label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'draft' | 'active' | 'completed')
                }
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="draft">{t('closurePlan.statusDraft')}</option>
                <option value="active">{t('closurePlan.statusActive')}</option>
                <option value="completed">{t('closurePlan.statusCompleted')}</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">
                {t('closurePlan.announcedAt')}
              </label>
              <input
                type="datetime-local"
                value={announcedAt}
                onChange={(e) => setAnnouncedAt(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                {t('closurePlan.items')}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setNewWhat('');
                  setNewOwner('');
                  setNewLocation('');
                  setNewRetention('');
                }}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                {t('closurePlan.reset')}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">
                  {t('closurePlan.what')}
                </label>
                <input
                  type="text"
                  value={newWhat}
                  onChange={(e) => setNewWhat(e.target.value)}
                  placeholder={t('closurePlan.whatPlaceholder')}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">
                  {t('closurePlan.action')}
                </label>
                <select
                  value={newAction}
                  onChange={(e) =>
                    setNewAction(
                      e.target.value as 'archive' | 'discard' | 'handover',
                    )
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                >
                  <option value="archive">{t('closurePlan.actionArchive')}</option>
                  <option value="discard">{t('closurePlan.actionDiscard')}</option>
                  <option value="handover">{t('closurePlan.actionHandover')}</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">
                  {t('closurePlan.owner')}
                </label>
                <input
                  type="text"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  placeholder={t('closurePlan.ownerPlaceholder')}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">
                  {t('closurePlan.location')}
                </label>
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder={t('closurePlan.locationPlaceholder')}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">
                {t('closurePlan.retention')}
              </label>
              <input
                type="text"
                value={newRetention}
                onChange={(e) => setNewRetention(e.target.value)}
                placeholder={t('closurePlan.retentionPlaceholder')}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              />
              <button
                type="button"
                onClick={() => void addItem()}
                disabled={!newWhat.trim() || !newOwner.trim()}
                className="w-full px-3 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {t('closurePlan.addItem')}
              </button>
            </div>
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-600 mb-2">
                {t('closurePlan.currentItems')}
              </h3>
              <ul className="space-y-1">
                {items.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 p-2 border border-slate-200 rounded text-sm">
                    <span className="font-medium text-slate-700">{item.what}</span>
                    <span className="text-xs text-slate-500 ml-auto">{item.action}</span>
                    <span className="text-xs text-slate-500">{item.owner}</span>
                    <button
                      type="button"
                      onClick={() => void removeItem(i)}
                      className="text-xs text-slate-400 hover:text-red-600"
                    >
                      {t('closurePlan.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
              disabled={saving || items.length === 0}
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

export default function ClosurePlanPage() {
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

  const myMember = incident && user ? { id: user.id, functionIds: [] as string[] } : undefined;
  // Build actor for can() permission checks.
  const actor: Actor | null = user && incident && id && myMember
    ? {
        userId: user.id,
        incidentId: id,
        role: incident.role as Actor['role'],
        functionIds: myMember.functionIds,
      }
    : null;

  return (
    <ClosurePlan
      store={localStore}
      incidentId={id}
      authorId={user?.id ?? ''}
      actor={actor}
    />
  );
}
