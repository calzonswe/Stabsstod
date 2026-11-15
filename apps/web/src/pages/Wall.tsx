// Wall — plan.md §10 / M37.
//
// Read-only fullscreen wall display for a projector/screen: large type,
// auto-refresh, live clock, and rotation between mission/direction,
// situation, timeline, task board, and map every N seconds (admin setting).
// No write controls. Requires login; viewable by any incident member
// including observers (membership is enforced by the API with 403).
//
// The core `Wall` component receives already-loaded data; the default export
// is the page wrapper that loads the incident context and settings from the
// API.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  selectSitrepSections,
  type Actor,
  type RecordEnvelope,
  type SitrepSectionData,
} from '@stabsstod/shared';
import { useAuth } from '../contexts/AuthContext.js';
import { LocalStore } from '../localStore.js';
import Map from './Map.js';

export const DEFAULT_ROTATE_EVERY_SECONDS = 30;
export const DEFAULT_TIMEZONE = 'Europe/Stockholm';
const REFRESH_INTERVAL_MS = 30_000;

type WallSectionId = 'missionDirection' | 'situation' | 'timeline' | 'tasks' | 'map';

const WALL_SECTIONS: Array<{ id: WallSectionId; labelKey: string }> = [
  { id: 'missionDirection', labelKey: 'wall.section.missionDirection' },
  { id: 'situation', labelKey: 'wall.section.situation' },
  { id: 'timeline', labelKey: 'wall.section.timeline' },
  { id: 'tasks', labelKey: 'wall.section.tasks' },
  { id: 'map', labelKey: 'wall.section.map' },
] as const;

/** ISO-style date, 24h clock, in the configured display timezone. */
function formatDateTime(iso: string, timezone: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleString('sv-SE', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    // Invalid IANA zone in the admin setting — fall back to local time.
    return d.toLocaleString('sv-SE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
}

export interface WallProps {
  store: LocalStore | null;
  incidentId: string;
  incidentName: string;
  actor: Actor | null;
  /** userId → display name, for task assignees. */
  assigneeNames: Record<string, string>;
  /** Rotation interval in seconds (admin setting). Default 30. */
  rotateEverySeconds?: number;
  /** Display timezone (admin setting). Default Europe/Stockholm. */
  timezone?: string;
}

export function Wall({
  store,
  incidentId,
  incidentName,
  actor,
  assigneeNames,
  rotateEverySeconds = DEFAULT_ROTATE_EVERY_SECONDS,
  timezone = DEFAULT_TIMEZONE,
}: WallProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<RecordEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [sectionIndex, setSectionIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // Load the incident's records from the local store and re-read on a short
  // interval so newly synced records appear on the wall (works offline).
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
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [store, incidentId]);

  const data: SitrepSectionData = useMemo(() => selectSitrepSections(records), [records]);

  // Rotate between the sections (what the wall shows).
  useEffect(() => {
    if (rotateEverySeconds <= 0) return;
    const timer = setInterval(
      () => setSectionIndex((i) => (i + 1) % WALL_SECTIONS.length),
      rotateEverySeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [rotateEverySeconds]);

  // Live clock in the footer.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentSectionId = WALL_SECTIONS[sectionIndex]?.id ?? 'missionDirection';

  // Any incident member (observer included). The API already 403s for
  // non-members; this is the client-side view of the same rule.
  const canView =
    actor !== null &&
    [
      'observer',
      'chief_of_staff',
      'deputy_chief',
      'function_lead',
      'staff_member',
      'decision_maker',
    ].includes(actor.role);

  if (!canView) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-900 text-slate-300">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">{t('wall.accessDenied')}</h1>
          <p className="text-lg">{t('wall.accessDeniedDetail')}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
          <span className="text-xl font-medium">{t('wall.loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-900 text-red-400 p-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">{t('wall.error')}</h1>
          <p className="text-lg">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900 text-white overflow-hidden">
      {/* Section indicator (top right, subtle) */}
      <div className="absolute top-6 right-6 flex flex-col items-center gap-2 z-10">
        <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">
          {t('wall.section')}
        </span>
        {WALL_SECTIONS.map((s, i) => (
          <div
            key={s.id}
            className={`w-3 h-3 rounded-full transition-colors duration-300 ${
              i === sectionIndex
                ? 'bg-indigo-500 ring-2 ring-indigo-300'
                : 'bg-slate-700'
            }`}
            title={t(s.labelKey)}
          />
        ))}
      </div>

      {/* Main content area */}
      <div className="flex flex-col h-full items-center justify-center p-8">
        <div className="max-w-4xl w-full">
          {currentSectionId === 'missionDirection' && (
            <MissionDirectionView data={data} timezone={timezone} />
          )}
          {currentSectionId === 'situation' && (
            <SituationView data={data} />
          )}
          {currentSectionId === 'timeline' && (
            <TimelineView data={data} timezone={timezone} />
          )}
          {currentSectionId === 'tasks' && (
            <TasksView data={data} timezone={timezone} assigneeNames={assigneeNames} />
          )}
          {currentSectionId === 'map' && <MapView data={data} />}
        </div>
      </div>

      {/* Footer: incident name and live clock */}
      <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between px-4 z-10">
        <div className="text-lg font-medium text-slate-300">
          {t('wall.incident')}: {incidentName}
        </div>
        <div className="text-xl font-mono text-slate-300 tabular-nums">
          {now.toLocaleTimeString('sv-SE', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section views (read-only, large type)
// ---------------------------------------------------------------------------

function MissionDirectionView({
  data,
  timezone,
}: {
  data: SitrepSectionData;
  timezone: string;
}) {
  const { t } = useTranslation();
  const mission = data.mission;
  const direction = data.direction;

  return (
    <div className="space-y-8">
      {mission?.hasMission && (
        <div className="space-y-4">
          <h2 className="text-3xl font-bold text-indigo-400 uppercase tracking-tight">
            {t('wall.mission')}
          </h2>
          <p className="text-2xl text-white leading-relaxed">{mission.content}</p>
          {mission.staffShouldDo && (
            <div className="border-l-4 border-emerald-500 pl-4 py-2 bg-emerald-900/20 rounded">
              <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-1 block">
                {t('wall.staffShouldDo')}
              </span>
              <p className="text-xl text-emerald-100">{mission.staffShouldDo}</p>
            </div>
          )}
          {mission.staffShouldNotDo && (
            <div className="border-l-4 border-rose-500 pl-4 py-2 bg-rose-900/20 rounded">
              <span className="text-xs font-bold text-rose-300 uppercase tracking-wider mb-1 block">
                {t('wall.staffShouldNotDo')}
              </span>
              <p className="text-xl text-rose-100">{mission.staffShouldNotDo}</p>
            </div>
          )}
          {mission.deadline && (
            <div className="text-lg font-mono text-amber-400">
              {t('wall.deadline')}: {formatDateTime(mission.deadline, timezone)}
            </div>
          )}
        </div>
      )}
      {direction?.hasDirection && (
        <div className="space-y-4 border-t border-slate-700 pt-8">
          <h2 className="text-3xl font-bold text-indigo-400 uppercase tracking-tight">
            {t('wall.direction')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                {t('wall.desired')}
              </span>
              <p className="text-2xl text-emerald-100">
                {direction.desired ?? t('wall.none')}
              </p>
            </div>
            <div className="space-y-2">
              <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">
                {t('wall.actual')}
              </span>
              <p className="text-2xl text-sky-100">{direction.actual ?? t('wall.none')}</p>
            </div>
          </div>
          {direction.divergenceNote && (
            <div className="border-l-4 border-amber-500 pl-4 py-2 bg-amber-900/20 rounded">
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-1 block">
                {t('wall.divergence')}
              </span>
              <p className="text-xl text-amber-100">{direction.divergenceNote}</p>
            </div>
          )}
        </div>
      )}
      {!mission?.hasMission && !direction?.hasDirection && (
        <div className="text-center py-20">
          <p className="text-slate-500 text-xl">{t('wall.noMissionOrDirection')}</p>
        </div>
      )}
    </div>
  );
}

function SituationView({ data }: { data: SitrepSectionData }) {
  const { t } = useTranslation();
  const situation = data.situation;
  const facts = data.facts;

  return (
    <div className="space-y-8">
      {situation && (
        <div className="space-y-6">
          <h2 className="text-3xl font-bold text-indigo-400 uppercase tracking-tight">
            {t('wall.situation')}
          </h2>
          {situation.whatHappened && (
            <div className="space-y-2">
              <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                {t('wall.whatHappened')}
              </span>
              <p className="text-2xl text-white leading-relaxed">{situation.whatHappened}</p>
            </div>
          )}
          {situation.current && (
            <div className="space-y-2 border-t border-slate-700 pt-6">
              <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                {t('wall.currentSituation')}
              </span>
              <p className="text-2xl text-emerald-100 leading-relaxed">{situation.current}</p>
            </div>
          )}
          {situation.consequences && (
            <div className="space-y-2 border-t border-slate-700 pt-6">
              <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                {t('wall.consequences')}
              </span>
              <p className="text-2xl text-emerald-100 leading-relaxed">
                {situation.consequences}
              </p>
            </div>
          )}
          {situation.protectedValues.length > 0 && (
            <div className="space-y-2 border-t border-slate-700 pt-6">
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wider block mb-2">
                {t('wall.protectedValues')}
              </span>
              <div className="flex flex-wrap gap-2">
                {situation.protectedValues.map((v) => (
                  <span
                    key={v}
                    className="px-3 py-1 rounded bg-amber-900/30 border border-amber-700 text-amber-200 text-lg font-medium"
                  >
                    {t(`situation.protected.${v}`)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {facts.length > 0 && (
        <div className="space-y-4 border-t border-slate-700 pt-8">
          <h2 className="text-3xl font-bold text-indigo-400 uppercase tracking-tight">
            {t('wall.facts')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {facts.map((f, i) => (
              <div
                key={i}
                className={`p-4 rounded ${
                  f.status === 'verified'
                    ? 'bg-emerald-900/30 border border-emerald-700'
                    : f.status === 'assumption'
                      ? 'bg-amber-900/30 border border-amber-700'
                      : f.status === 'refuted'
                        ? 'bg-slate-800/50 border border-slate-700'
                        : 'bg-slate-800/30 border border-slate-700'
                }`}
              >
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    f.status === 'verified'
                      ? 'text-emerald-300'
                      : f.status === 'assumption'
                        ? 'text-amber-300'
                        : 'text-slate-400'
                  }`}
                >
                  [{f.status}]
                </span>
                <p className="text-xl text-white mt-2 leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!situation && facts.length === 0 && (
        <div className="text-center py-20">
          <p className="text-slate-500 text-xl">{t('wall.noSituation')}</p>
        </div>
      )}
    </div>
  );
}

function TimelineView({
  data,
  timezone,
}: {
  data: SitrepSectionData;
  timezone: string;
}) {
  const { t } = useTranslation();
  const timeline = data.timeline;

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-indigo-400 uppercase tracking-tight">
        {t('wall.timeline')}
      </h2>
      {timeline.length > 0 ? (
        <div className="space-y-4">
          {timeline.map((e, i) => (
            <div
              key={i}
              className="flex items-start gap-4 border-b border-slate-800 pb-4 last:border-0"
            >
              <span className="text-lg font-mono text-slate-400 w-48 flex-shrink-0">
                {formatDateTime(e.time, timezone)}
              </span>
              <div className="flex-1">
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    e.type === 'decision'
                      ? 'text-indigo-300'
                      : e.type === 'deadline'
                        ? 'text-amber-300'
                        : e.type === 'milestone'
                          ? 'text-emerald-300'
                          : 'text-slate-400'
                  }`}
                >
                  {t(`timeline.type.${e.type}`)}
                </span>
                <p className="text-xl text-white mt-1">{e.title}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-slate-500 text-xl">{t('wall.noTimeline')}</p>
        </div>
      )}
    </div>
  );
}

function TasksView({
  data,
  timezone,
  assigneeNames,
}: {
  data: SitrepSectionData;
  timezone: string;
  assigneeNames: Record<string, string>;
}) {
  const { t } = useTranslation();
  const tasks = data.tasks;

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-indigo-400 uppercase tracking-tight">
        {t('wall.tasks')}
      </h2>
      {tasks.length > 0 ? (
        <div className="space-y-4">
          {tasks.map((task, i) => (
            <div
              key={i}
              className={`p-4 rounded border ${
                task.status === 'blocked'
                  ? 'bg-rose-900/30 border-rose-700'
                  : task.priority === 'critical'
                    ? 'bg-red-900/30 border-red-700'
                    : task.priority === 'high'
                      ? 'bg-amber-900/30 border-amber-700'
                      : 'bg-slate-800/30 border border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-2xl text-white font-bold leading-relaxed">{task.title}</p>
                  {task.description && (
                    <p className="text-lg text-slate-400 mt-1">{task.description}</p>
                  )}
                  {task.assigneeUserId && (
                    <p className="text-lg text-slate-500 mt-2">
                      {t('wall.assignee')}: {assigneeNames[task.assigneeUserId] ?? task.assigneeUserId}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded ${
                      task.status === 'blocked'
                        ? 'bg-rose-700 text-rose-100'
                        : task.priority === 'critical'
                          ? 'bg-red-700 text-white'
                          : task.priority === 'high'
                            ? 'bg-amber-700 text-white'
                            : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {task.status}
                  </span>
                  {task.due && (
                    <span className="text-lg font-mono text-slate-400">
                      {t('wall.due', { date: formatDateTime(task.due, timezone) })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-slate-500 text-xl">{t('wall.noTasks')}</p>
        </div>
      )}
    </div>
  );
}

function MapView({ data }: { data: SitrepSectionData }) {
  return (
    <div className="w-full h-[80vh] rounded-lg border border-slate-700 overflow-hidden">
      <Map readonlyFeatures={data.map} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper — loads incident context and settings from the API
// ---------------------------------------------------------------------------

export default function WallPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<{ id: string; name: string; role: string } | null>(
    null,
  );
  const [assigneeNames, setAssigneeNames] = useState<Record<string, string>>({});
  const [rotateEvery, setRotateEvery] = useState(DEFAULT_ROTATE_EVERY_SECONDS);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [localStore] = useState<LocalStore | null>(() =>
    user ? new LocalStore({ userId: user.id }) : null,
  );

  useEffect(() => {
    if (id) {
      void loadIncident();
    }
    // Admin settings (rotation interval, display timezone). Non-fatal: fall
    // back to defaults when offline.
    api('/api/settings')
      .then((data) => {
        const n = data.wallRotateEverySeconds;
        if (typeof n === 'number' && n > 0) setRotateEvery(n);
        if (typeof data.timezone === 'string' && data.timezone.length > 0) {
          setTimezone(data.timezone);
        }
      })
      .catch(() => {
        /* keep defaults */
      });
  }, [id]);

  async function loadIncident() {
    try {
      setError('');
      const data = await api(`/api/incidents/${id}`);
      setIncident({
        id: data.incident.id,
        name: data.incident.name,
        role: data.incident.role,
      });
      setAssigneeNames(
        Object.fromEntries(
          (data.members ?? []).map((m: { id: string; username: string; displayName: string | null }) => [
            m.id,
            m.displayName ?? m.username,
          ]),
        ),
      );
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
    <Wall
      store={localStore}
      incidentId={id}
      incidentName={incident.name}
      actor={actor}
      assigneeNames={assigneeNames}
      rotateEverySeconds={rotateEvery}
      timezone={timezone}
    />
  );
}
