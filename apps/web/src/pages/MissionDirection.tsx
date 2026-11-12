// MissionDirection — plan.md §5 / M20
//
// Two modules in the "Inriktning" tab:
//   Mission — editor (content, staff should do / should not do, deadline),
//             writable by decision_maker / chief_of_staff / deputy_chief
//             (gated with can()); "Acknowledge — same understanding" by the
//             chief of staff (creates a new version).
//   Direction — desired vs actual side by side with divergence note,
//             writable by chief_of_staff / deputy_chief (gated with can()).
// Observers and other roles see read-only content.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, type Actor } from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import {
  useMission,
  useDirection,
  type MissionPayloadShape,
} from '../hooks/useMissionDirection.js';

export interface MissionDirectionProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function MissionDirection({
  store,
  incidentId,
  authorId,
  actor,
}: MissionDirectionProps) {
  const canWriteMission = actor
    ? can(actor, 'write', { entityType: 'mission', incidentId, functionId: null }, {})
    : false;
  const canWriteDirection = actor
    ? can(actor, 'write', { entityType: 'direction', incidentId, functionId: null }, {})
    : false;
  // Acknowledge is specifically the chief of staff's action (plan.md §7).
  const canAcknowledge = actor?.role === 'chief_of_staff';

  return (
    <div className="space-y-6">
      <MissionSection
        store={store}
        incidentId={incidentId}
        authorId={authorId}
        canWrite={canWriteMission}
        canAcknowledge={canAcknowledge}
      />
      <DirectionSection
        store={store}
        incidentId={incidentId}
        authorId={authorId}
        canWrite={canWriteDirection}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function MissionSection({
  store,
  incidentId,
  authorId,
  canWrite,
  canAcknowledge,
}: {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  canWrite: boolean;
  canAcknowledge: boolean;
}) {
  const { t } = useTranslation();
  const { mission, loading, error, saveMission, acknowledge } = useMission(
    store,
    incidentId,
    authorId,
  );

  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [shouldDo, setShouldDo] = useState('');
  const [shouldNotDo, setShouldNotDo] = useState('');
  const [deadline, setDeadline] = useState('');
  const [saving, setSaving] = useState(false);

  const payload = mission?.current?.payload as MissionPayloadShape | undefined;
  const acknowledged = payload?.acknowledgedByChief;

  useEffect(() => {
    const p = mission?.lastPut?.payload as MissionPayloadShape | undefined;
    if (p) {
      setContent(p.content ?? '');
      setShouldDo(p.staffShouldDo ?? '');
      setShouldNotDo(p.staffShouldNotDo ?? '');
      setDeadline(
        p.deadline ? toLocalInputValue(new Date(p.deadline)) : '',
      );
    }
  }, [mission?.lastPut?.id, mission]);

  async function handleSave() {
    if (saving || !content.trim()) return;
    setSaving(true);
    try {
      await saveMission({
        content: content.trim(),
        staffShouldDo: shouldDo.trim() || undefined,
        staffShouldNotDo: shouldNotDo.trim() || undefined,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
        issuedBy: authorId,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-center py-10">{t('mission.loading')}</div>;
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      {error && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-700 border border-red-100">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{t('mission.title')}</h2>
        <div className="flex gap-2">
          {canWrite && (
            <button
              onClick={() => setEditing((v) => !v)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
            >
              {editing ? t('mission.closeEditor') : t('mission.edit')}
            </button>
          )}
          {canAcknowledge && !editing && (
            <button
              onClick={() => void acknowledge()}
              disabled={!!mission?.retracted || !payload || !!acknowledged}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {t('mission.acknowledge')}
            </button>
          )}
        </div>
      </div>

      {mission?.retracted && (
        <div className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
          {t('mission.retractedNotice')}
        </div>
      )}

      {acknowledged && (
        <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
          {t('mission.acknowledgedNotice')}
        </div>
      )}

      {!editing && (payload || !canWrite) && (
        <div className={`space-y-2 text-sm ${mission?.retracted ? 'opacity-60' : ''}`}>
          {payload ? (
            <>
              <div className={`text-slate-900 ${mission?.retracted ? 'line-through' : ''}`}>
                {payload.content}
              </div>
              {payload.staffShouldDo && (
                <p>
                  <span className="font-medium text-slate-700">
                    {t('mission.staffShouldDo')}:
                  </span>{' '}
                  {payload.staffShouldDo}
                </p>
              )}
              {payload.staffShouldNotDo && (
                <p>
                  <span className="font-medium text-slate-700">
                    {t('mission.staffShouldNotDo')}:
                  </span>{' '}
                  {payload.staffShouldNotDo}
                </p>
              )}
              {payload.deadline && (
                <p className="text-xs text-red-700">
                  {t('mission.deadline')}: {new Date(payload.deadline).toLocaleString()}
                </p>
              )}
            </>
          ) : (
            <div className="text-slate-500">{t('mission.noMission')}</div>
          )}
        </div>
      )}

      {!editing && !payload && canWrite && (
        <div className="text-slate-500 text-sm">{t('mission.noMission')}</div>
      )}

      {editing && (
        <div className="space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('mission.form.content')}
            rows={2}
            required
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('mission.staffShouldDo')}
              </span>
              <textarea
                value={shouldDo}
                onChange={(e) => setShouldDo(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('mission.staffShouldNotDo')}
              </span>
              <textarea
                value={shouldNotDo}
                onChange={(e) => setShouldNotDo(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              {t('mission.deadline')}
            </span>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded text-sm bg-white"
            />
          </label>
          <div className="flex justify-end">
            <button
              onClick={() => void handleSave()}
              disabled={saving || !content.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('mission.form.saving') : t('mission.form.save')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function DirectionSection({
  store,
  incidentId,
  authorId,
  canWrite,
}: {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const { direction, loading, error, saveDirection } = useDirection(
    store,
    incidentId,
    authorId,
  );

  const [editing, setEditing] = useState(false);
  const [desired, setDesired] = useState('');
  const [actual, setActual] = useState('');
  const [divergenceNote, setDivergenceNote] = useState('');
  const [saving, setSaving] = useState(false);

  const payload = direction?.lastPut?.payload as
    | { desired?: string; actual?: string; divergenceNote?: string }
    | undefined;

  useEffect(() => {
    if (payload) {
      setDesired(payload.desired ?? '');
      setActual(payload.actual ?? '');
      setDivergenceNote(payload.divergenceNote ?? '');
    }
  }, [direction?.lastPut?.id, direction]);

  async function handleSave() {
    if (saving || !desired.trim()) return;
    setSaving(true);
    try {
      await saveDirection({
        desired: desired.trim(),
        actual: actual.trim() || undefined,
        divergenceNote: divergenceNote.trim() || undefined,
        validFrom: new Date().toISOString(),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-center py-10">{t('direction.loading')}</div>;
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      {error && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-700 border border-red-100">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{t('direction.title')}</h2>
        {canWrite && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
          >
            {editing ? t('direction.closeEditor') : t('direction.edit')}
          </button>
        )}
      </div>

      {!editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="border border-emerald-200 bg-emerald-50/50 rounded p-3">
            <h3 className="text-xs font-semibold text-emerald-700 mb-1">
              {t('direction.desired')}
            </h3>
            <p className={`text-sm text-slate-900 ${direction?.retracted ? 'line-through opacity-60' : ''}`}>
              {payload?.desired ?? t('direction.noDirection')}
            </p>
          </div>
          <div className="border border-sky-200 bg-sky-50/50 rounded p-3">
            <h3 className="text-xs font-semibold text-sky-700 mb-1">
              {t('direction.actual')}
            </h3>
            <p className="text-sm text-slate-900">{payload?.actual || t('direction.noActual')}</p>
          </div>
        </div>
      )}

      {payload?.divergenceNote && !editing && (
        <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <span className="font-medium">{t('direction.divergence')}:</span>{' '}
          {payload.divergenceNote}
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('direction.desired')}
              </span>
              <textarea
                value={desired}
                onChange={(e) => setDesired(e.target.value)}
                rows={3}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                {t('direction.actual')}
              </span>
              <textarea
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              {t('direction.divergenceNote')}
            </span>
            <textarea
              value={divergenceNote}
              onChange={(e) => setDivergenceNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </label>
          <div className="flex justify-end">
            <button
              onClick={() => void handleSave()}
              disabled={saving || !desired.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('direction.form.saving') : t('direction.form.save')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
