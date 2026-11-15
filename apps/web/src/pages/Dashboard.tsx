// Dashboard — chief of staff dashboard — plan.md §10 / M32
//
// Route /incidents/:id/dashboard — default landing page for
// chief_of_staff / deputy_chief (redirect in IncidentDetail). Every widget
// is derived from the incident's local records via the pure selectors in
// @stabsstod/shared (dashboard.ts), so the page works fully offline.
//
// The core `Dashboard` component receives already-loaded data (no fetch),
// which keeps it testable from fixtures. The default export is the page
// wrapper that loads the incident context from the API.

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import {
  deserializeGeometry,
  formatHms,
  geometryBounds,
  selectConflictCount,
  selectDecisionsWaiting,
  selectDirection,
  selectElapsedTime,
  selectFactCounts,
  selectFunctionStatusBoard,
  selectMiniMapFeatures,
  selectMission,
  selectNextBriefing,
  selectOverdueTasks,
  selectRecentLogEntries,
  selectShiftChanges,
  selectSyncHealth,
  selectTimeScaleStrip,
  type FunctionStatus,
  type GeometryBounds,
  type HomeIdentity,
  type MapFeaturePayload,
  type RecordEnvelope,
  type ScenarioPayload,
} from '@stabsstod/shared';
import { NotificationBell } from '../components/NotificationBell.js';
import { LocalStore, type OutboxEntry } from '../localStore.js';

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

type IncidentDetail = {
  id: string;
  name: string;
  type: string | null;
  startedAt: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  role: string;
};
type FunctionRow = { id: string; name: string };
type MemberRow = {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  functionIds: string[];
};

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const STOCKHOLM = { timeZone: 'Europe/Stockholm', hour12: false } as const;

function formatStockholmTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, {
    ...STOCKHOLM,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStockholmDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    ...STOCKHOLM,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mini map — static SVG projection of the incident's map features.
// No MapLibre/WebGL: a tiny projection is enough for a dashboard glance and
// keeps the widget testable in jsdom.
// ---------------------------------------------------------------------------

const MINIMAP_SIZE = 320;
const MINIMAP_PAD = 16;

const SEVERITY_COLORS: Record<MapFeaturePayload['severity'], string> = {
  info: '#2563eb',
  warning: '#f59e0b',
  severe: '#dc2626',
};

type Projector = (lon: number, lat: number) => { x: number; y: number };

function unionBounds(features: MapFeaturePayload[]): GeometryBounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let found = false;
  for (const feature of features) {
    const b = geometryBounds(deserializeGeometry(feature.geometry));
    if (!b) continue;
    found = true;
    minLon = Math.min(minLon, b.minLon);
    minLat = Math.min(minLat, b.minLat);
    maxLon = Math.max(maxLon, b.maxLon);
    maxLat = Math.max(maxLat, b.maxLat);
  }
  return found ? { minLon, minLat, maxLon, maxLat } : null;
}

function projectPoint(lon: number, lat: number, bounds: GeometryBounds): { x: number; y: number } {
  const w = bounds.maxLon - bounds.minLon;
  const h = bounds.maxLat - bounds.minLat;
  const x =
    w > 0
      ? MINIMAP_PAD + ((lon - bounds.minLon) / w) * (MINIMAP_SIZE - 2 * MINIMAP_PAD)
      : MINIMAP_SIZE / 2;
  const y =
    h > 0
      ? MINIMAP_SIZE - MINIMAP_PAD - ((lat - bounds.minLat) / h) * (MINIMAP_SIZE - 2 * MINIMAP_PAD)
      : MINIMAP_SIZE / 2;
  return { x, y };
}

function featureElements(feature: MapFeaturePayload, project: Projector, index: number): ReactElement[] {
  const geometry = deserializeGeometry(feature.geometry);
  if (!geometry) return [];
  const color = SEVERITY_COLORS[feature.severity];
  const key = `feature-${index}`;
  const pts = (c: number[]) => project(c[0], c[1]);
  const pointsAttr = (ring: number[][]) => ring.map((c) => `${pts(c).x},${pts(c).y}`).join(' ');
  const labelAt = (c: number[], k: string) => {
    const p = pts(c);
    return (
      <text key={k} x={p.x + 8} y={p.y + 3} fontSize={10} fill="#334155">
        {feature.label}
      </text>
    );
  };
  const els: ReactElement[] = [];
  switch (geometry.type) {
    case 'Point': {
      const p = pts(geometry.coordinates);
      els.push(
        <circle key={`${key}-shape`} cx={p.x} cy={p.y} r={5} fill={color} stroke="#ffffff" strokeWidth={1}>
          <title>{feature.label}</title>
        </circle>,
        labelAt(geometry.coordinates, `${key}-label`),
      );
      break;
    }
    case 'MultiPoint': {
      geometry.coordinates.forEach((c, j) => {
        const p = pts(c);
        els.push(
          <circle key={`${key}-c${j}`} cx={p.x} cy={p.y} r={4} fill={color} stroke="#ffffff" strokeWidth={1}>
            <title>{feature.label}</title>
          </circle>,
        );
      });
      const first = geometry.coordinates[0];
      if (first) els.push(labelAt(first, `${key}-label`));
      break;
    }
    case 'LineString': {
      els.push(
        <polyline key={`${key}-shape`} points={pointsAttr(geometry.coordinates)} fill="none" stroke={color} strokeWidth={2}>
          <title>{feature.label}</title>
        </polyline>,
      );
      const first = geometry.coordinates[0];
      if (first) els.push(labelAt(first, `${key}-label`));
      break;
    }
    case 'MultiLineString': {
      geometry.coordinates.forEach((line, j) => {
        els.push(
          <polyline key={`${key}-line${j}`} points={pointsAttr(line)} fill="none" stroke={color} strokeWidth={2}>
            <title>{feature.label}</title>
          </polyline>,
        );
      });
      const first = geometry.coordinates[0]?.[0];
      if (first) els.push(labelAt(first, `${key}-label`));
      break;
    }
    case 'Polygon': {
      const ring = geometry.coordinates[0];
      if (ring) {
        els.push(
          <polygon key={`${key}-shape`} points={pointsAttr(ring)} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.5}>
            <title>{feature.label}</title>
          </polygon>,
          labelAt(ring[0] ?? [], `${key}-label`),
        );
      }
      break;
    }
    case 'MultiPolygon': {
      geometry.coordinates.forEach((poly, j) => {
        const ring = poly[0];
        if (!ring) return;
        els.push(
          <polygon key={`${key}-poly${j}`} points={pointsAttr(ring)} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.5}>
            <title>{feature.label}</title>
          </polygon>,
        );
      });
      const first = geometry.coordinates[0]?.[0]?.[0];
      if (first) els.push(labelAt(first, `${key}-label`));
      break;
    }
  }
  return els;
}

function MiniMap({ features }: { features: MapFeaturePayload[] }) {
  const { t } = useTranslation();
  const bounds = useMemo(() => unionBounds(features), [features]);
  if (features.length === 0 || !bounds) {
    return <p className="text-sm text-slate-500">{t('dashboard.minimap.none')}</p>;
  }
  const project: Projector = (lon, lat) => projectPoint(lon, lat, bounds);
  return (
    <svg
      viewBox={`0 0 ${MINIMAP_SIZE} ${MINIMAP_SIZE}`}
      className="w-full bg-slate-100 rounded border border-slate-200"
      role="img"
      aria-label={t('dashboard.minimap')}
    >
      {features.map((feature, i) => featureElements(feature, project, i))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Core dashboard (no fetching — everything comes from props + local store)
// ---------------------------------------------------------------------------

export interface DashboardIncident {
  id: string;
  name: string;
  startedAt: string | null;
  status: string;
}

export interface DashboardMember {
  userId: string;
  userName: string;
  functionIds: string[];
}

export interface DashboardProps {
  store: LocalStore;
  incidentId: string;
  functions: Array<{ id: string; name: string }>;
  members: DashboardMember[];
  incident: DashboardIncident;
  me: HomeIdentity;
}

const RAG_STYLES: Record<FunctionStatus['rag'], { dot: string; labelKey: 'dashboard.rag.red' | 'dashboard.rag.amber' | 'dashboard.rag.green' }> = {
  red: { dot: 'bg-red-500', labelKey: 'dashboard.rag.red' },
  amber: { dot: 'bg-amber-500', labelKey: 'dashboard.rag.amber' },
  green: { dot: 'bg-green-500', labelKey: 'dashboard.rag.green' },
};

export function Dashboard({ store, incidentId, functions, members, incident, me }: DashboardProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<RecordEnvelope[]>([]);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // 1 s tick for elapsed time and the briefing countdown.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Read the incident's records and outbox from the local store. The sync
  // engine only broadcasts sync status (no record-level live events), so
  // re-read on a short interval to pick up newly ingested records.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const [recs, box] = await Promise.all([
        store.getRecordsByIncident(incidentId),
        store.getOutbox(),
      ]);
      if (active) {
        setRecords(recs);
        setOutbox(box);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [store, incidentId]);

  // --- Widget selectors (pure, unit-tested in @stabsstod/shared) ----------
  const mission = useMemo(() => selectMission(records), [records]);
  const direction = useMemo(() => selectDirection(records), [records]);
  const elapsed = useMemo(() => selectElapsedTime(incident.startedAt, now), [incident.startedAt, now]);
  const briefing = useMemo(() => selectNextBriefing(records, now), [records, now]);
  const shiftChanges = useMemo(() => selectShiftChanges(records, now, 4 * 3_600_000), [records, now]);
  const functionBoard = useMemo(
    () =>
      selectFunctionStatusBoard({
        functions,
        members,
        taskRecords: records,
        shiftRecords: records,
        briefingReportRecords: records,
        now,
      }),
    [records, functions, members, now],
  );
  const logEntries = useMemo(() => selectRecentLogEntries(records, 10), [records]);
  const factCounts = useMemo(() => selectFactCounts(records), [records]);
  const decisions = useMemo(() => selectDecisionsWaiting(records), [records]);
  const overdueTasks = useMemo(() => selectOverdueTasks(records, now), [records, now]);
  const timeScale = useMemo(() => selectTimeScaleStrip(records), [records]);
  const miniMapFeatures = useMemo(() => selectMiniMapFeatures(records), [records]);
  const conflictCount = useMemo(() => selectConflictCount(records), [records]);
  const syncHealth = useMemo(() => selectSyncHealth(outbox, conflictCount), [outbox, conflictCount]);

  const functionName = (id: string) => functions.find((f) => f.id === id)?.name ?? id;
  const userName = (id: string) => members.find((m) => m.userId === id)?.userName ?? id;

  const statusClass =
    incident.status === 'active'
      ? 'bg-green-100 text-green-700'
      : incident.status === 'winding_down'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-700';

  return (
    <div className="space-y-4">
      {/* Header: incident name, status, elapsed time */}
      <header className="border-b border-slate-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900">{incident.name}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>{incident.status}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link to={`/incidents/${incidentId}`} className="text-indigo-600 hover:text-indigo-700">
            {t('dashboard.back')}
          </Link>
          <span title={t('dashboard.elapsed')} className="font-mono text-lg font-bold text-slate-900 tabular-nums">
            {elapsed ?? '--:--:--'}
          </span>
          <NotificationBell store={store} incidentId={incidentId} me={me} />
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        {/* 1. Mission & direction */}
        <Card title={t('dashboard.mission')}>
          {mission.hasMission ? (
            <div className="space-y-1 text-sm text-slate-700">
              <p className="font-medium text-slate-900">{mission.content}</p>
              {mission.staffShouldDo && <p>{t('dashboard.mission.shouldDo')}: {mission.staffShouldDo}</p>}
              {mission.staffShouldNotDo && <p>{t('dashboard.mission.shouldNotDo')}: {mission.staffShouldNotDo}</p>}
              <p className="text-slate-500">
                {t('dashboard.mission.issuedBy')}: {mission.issuedBy} · {t('dashboard.mission.deadline')}:{' '}
                {formatStockholmTime(mission.deadline)}
              </p>
              {mission.acknowledgedByChief && <p className="text-green-700">{t('dashboard.mission.acknowledged')}</p>}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('dashboard.mission.none')}</p>
          )}
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">{t('dashboard.direction')}</h3>
            {direction.hasDirection ? (
              <>
                <p className="text-sm text-slate-700">
                  {t('dashboard.direction.desired')}: {direction.desired}
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  {t('dashboard.direction.actual')}: {direction.actual ?? '—'}
                </p>
                {direction.diverged && (
                  <p className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-medium">
                    {t('dashboard.direction.diverged')}
                    {direction.divergenceNote && <span className="font-normal">— {direction.divergenceNote}</span>}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">{t('dashboard.direction.none')}</p>
            )}
          </div>
        </Card>

        {/* 3. Next briefing countdown */}
        <Card title={t('dashboard.briefing')}>
          {briefing.hasBriefing ? (
            <div className="text-sm text-slate-700">
              <p className="font-medium text-slate-900">{briefing.title}</p>
              <p className="mt-1">{formatStockholmDateTime(briefing.scheduledAt)}</p>
              <p className="mt-2 text-2xl font-mono font-bold text-slate-900 tabular-nums">
                {briefing.inMs !== null ? formatHms(briefing.inMs) : '—'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('dashboard.briefing.none')}</p>
          )}
        </Card>

        {/* 4. Shift changes next 4 h */}
        <Card title={t('dashboard.shifts')}>
          {shiftChanges.length === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.shifts.none')}</p>
          ) : (
            <ul className="text-sm text-slate-700 space-y-1">
              {shiftChanges.map((sc, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>
                    {t(sc.kind === 'start' ? 'dashboard.shifts.start' : 'dashboard.shifts.end')}{' '}
                    {functionName(sc.functionId)} — {userName(sc.userId)}
                  </span>
                  <span className="font-mono text-xs text-slate-500">{formatStockholmTime(sc.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 8. Decisions waiting */}
        <Card title={t('dashboard.decisions')}>
          {decisions.length === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.decisions.none')}</p>
          ) : (
            <ul className="text-sm text-slate-700 space-y-1">
              {decisions.map((d, i) => (
                <li key={i}>
                  {d.question}
                  {d.neededBy && <span className="text-slate-500"> · {functionName(d.neededBy)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 9. Overdue tasks */}
        <Card title={t('dashboard.overdue')}>
          {overdueTasks.length === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.overdue.none')}</p>
          ) : (
            <ul className="text-sm text-slate-700 space-y-1">
              {overdueTasks.map((task, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>{task.title}</span>
                  <span className="font-mono text-xs text-red-600">{formatStockholmTime(task.due)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 5. Function status board */}
        <div className="md:col-span-6">
          <Card title={t('dashboard.functions')}>
            {functionBoard.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.functions.none')}</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-2">{t('dashboard.functions.column')}</th>
                        <th className="py-2 pr-2">{t('dashboard.functions.lead')}</th>
                        <th className="py-2 pr-2">{t('dashboard.functions.open')}</th>
                        <th className="py-2 pr-2">{t('dashboard.functions.overdue')}</th>
                        <th className="py-2 pr-2">{t('dashboard.functions.lastUpdate')}</th>
                        <th className="py-2 pr-2">{t('dashboard.functions.challenge')}</th>
                        <th className="py-2">{t('dashboard.functions.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {functionBoard.map((fn) => (
                        <tr key={fn.functionId} className="border-b border-slate-100">
                          <td className="py-2 pr-2 font-medium text-slate-900">{fn.functionName}</td>
                          <td className="py-2 pr-2 text-slate-700">{fn.leadOnDuty?.userName ?? '—'}</td>
                          <td className="py-2 pr-2">{fn.openTasks}</td>
                          <td className="py-2 pr-2">{fn.overdueTasks}</td>
                          <td className="py-2 pr-2 text-slate-500">{formatStockholmDateTime(fn.lastUpdate)}</td>
                          <td className="py-2 pr-2 text-slate-600">{fn.latestChallenge || '—'}</td>
                          <td className="py-2">
                            <span
                              className={`inline-block w-3 h-3 rounded-full ${RAG_STYLES[fn.rag].dot}`}
                              title={t(RAG_STYLES[fn.rag].labelKey)}
                              aria-label={t(RAG_STYLES[fn.rag].labelKey)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-slate-500">
                  {(['red', 'amber', 'green'] as const).map((rag) => (
                    <span key={rag} className="inline-flex items-center gap-1">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${RAG_STYLES[rag].dot}`} />
                      {t(RAG_STYLES[rag].labelKey)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* 6. Latest log entries */}
        <div className="md:col-span-4">
          <Card title={t('dashboard.log')}>
            {logEntries.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.log.none')}</p>
            ) : (
              <ul className="text-sm text-slate-700 space-y-1 max-h-64 overflow-y-auto">
                {logEntries.map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-xs text-slate-500 shrink-0">{formatStockholmTime(e.eventTime)}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* 7. Fact / assumption / unknown counts */}
        <Card title={t('dashboard.facts')}>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{factCounts.verified}</p>
              <p className="text-xs text-slate-500">{t('dashboard.facts.verified')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{factCounts.assumption}</p>
              <p className="text-xs text-slate-500">{t('dashboard.facts.assumption')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{factCounts.infoNeed}</p>
              <p className="text-xs text-slate-500">{t('dashboard.facts.infoNeed')}</p>
            </div>
          </div>
          {factCounts.oldestUnverifiedAssumption && (
            <p className="mt-3 text-sm text-slate-700">
              <span className="text-slate-500">{t('dashboard.facts.oldest')}:</span>{' '}
              {factCounts.oldestUnverifiedAssumption.text}
            </p>
          )}
        </Card>

        {/* 10. Time-scale strip */}
        <div className="md:col-span-3">
          <Card title={t('dashboard.timescale')}>
            <div className="grid grid-cols-3 gap-3 text-sm">
              {(
                [
                  [t('dashboard.timescale.now'), timeScale.now],
                  [t('dashboard.timescale.48h'), timeScale.fortyEightHours],
                  [t('dashboard.timescale.twoWeeks'), timeScale.twoWeeks],
                ] as Array<[string, ScenarioPayload[]]>
              ).map(([label, scenarios]) => (
                <div key={label}>
                  <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{label}</p>
                  {scenarios.length === 0 ? (
                    <p className="text-slate-400 text-xs">{t('dashboard.timescale.none')}</p>
                  ) : (
                    <ul className="space-y-1 text-slate-700">
                      {scenarios.map((s, i) => (
                        <li key={i}>{s.title}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* 11. Mini map */}
        <div className="md:col-span-4">
          <Card title={t('dashboard.minimap')}>
            <MiniMap features={miniMapFeatures} />
          </Card>
        </div>

        {/* 12. Sync health */}
        <Card title={t('dashboard.sync')}>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{syncHealth.conflicts}</p>
              <p className="text-xs text-slate-500">{t('dashboard.sync.conflicts')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{syncHealth.rejected}</p>
              <p className="text-xs text-slate-500">{t('dashboard.sync.rejected')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{syncHealth.pending}</p>
              <p className="text-xs text-slate-500">{t('dashboard.sync.pending')}</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper — loads incident context from the API
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [functions, setFunctions] = useState<FunctionRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
      setIncident(data.incident);
      setFunctions(data.functions);
      setMembers(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load incident');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-center py-10">{t('dashboard.loading')}</div>;
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

  const boardMembers: DashboardMember[] = members.map((m) => ({
    userId: m.id,
    userName: m.displayName || m.username,
    functionIds: m.functionIds,
  }));

  const meMember = user ? members.find((m) => m.id === user.id) : undefined;

  return (
    <Dashboard
      store={localStore}
      incidentId={id}
      functions={functions}
      members={boardMembers}
      incident={{ id: incident.id, name: incident.name, startedAt: incident.startedAt, status: incident.status }}
      me={{ userId: user?.id ?? '', functionIds: meMember?.functionIds ?? [] }}
    />
  );
}
