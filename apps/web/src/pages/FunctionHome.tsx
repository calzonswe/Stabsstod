// Function home — workspace home for non-chief roles — plan.md §10 / M33
//
// Route /incidents/:id/home — default landing page for every incident role
// other than chief_of_staff / deputy_chief (redirect in IncidentDetail).
// Every widget is derived from the incident's local records via the pure
// selectors in @stabsstod/shared (functionHome.ts), so the page works fully
// offline.
//
// The core `FunctionHome` component receives already-loaded data (no fetch),
// which keeps it testable from fixtures. The default export is the page
// wrapper that loads the incident context from the API.
//
// Widgets (plan.md M33): my tasks · my function's board and latest log ·
// upcoming briefing with "prepare my report" shortcut · my next shift and
// handover note · items needing my attention.

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import {
  formatHms,
  selectFunctionStatusBoard,
  selectMyShift,
  selectMyTasks,
  selectNeedsAttention,
  selectRecentLogEntries,
  selectUpcomingBriefing,
  type AttentionItem,
  type FunctionStatus,
  type HomeIdentity,
  type RecordEnvelope,
} from '@stabsstod/shared';
import { LocalStore } from '../localStore.js';

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
// Small presentational helpers (same conventions as Dashboard.tsx)
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

const RAG_STYLES: Record<FunctionStatus['rag'], { dot: string; labelKey: 'dashboard.rag.red' | 'dashboard.rag.amber' | 'dashboard.rag.green' }> = {
  red: { dot: 'bg-red-500', labelKey: 'dashboard.rag.red' },
  amber: { dot: 'bg-amber-500', labelKey: 'dashboard.rag.amber' },
  green: { dot: 'bg-green-500', labelKey: 'dashboard.rag.green' },
};

// ---------------------------------------------------------------------------
// Core function home (no fetching — everything comes from props + local store)
// ---------------------------------------------------------------------------

export interface FunctionHomeMember {
  userId: string;
  userName: string;
  functionIds: string[];
}

export interface FunctionHomeIncident {
  id: string;
  name: string;
  startedAt: string | null;
  status: string;
}

export interface FunctionHomeProps {
  store: LocalStore;
  incidentId: string;
  functions: Array<{ id: string; name: string }>;
  members: FunctionHomeMember[];
  incident: FunctionHomeIncident;
  me: HomeIdentity;
}

export function FunctionHome({ store, incidentId, functions, members, incident, me }: FunctionHomeProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<RecordEnvelope[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // 1 s tick for countdowns and overdue flags.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Read the incident's records from the local store. The sync engine only
  // broadcasts sync status (no record-level live events), so re-read on a
  // short interval to pick up newly ingested records.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const recs = await store.getRecordsByIncident(incidentId);
      if (active) setRecords(recs);
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [store, incidentId]);

  // --- Widget selectors (pure, unit-tested in @stabsstod/shared) ----------
  const myFunctions = useMemo(
    () => functions.filter((f) => me.functionIds.includes(f.id)),
    [functions, me],
  );
  const myTasks = useMemo(() => selectMyTasks(records, me, now), [records, me, now]);
  const board = useMemo(
    () =>
      selectFunctionStatusBoard({
        functions: myFunctions,
        members,
        taskRecords: records,
        shiftRecords: records,
        briefingReportRecords: records,
        now,
      }),
    [records, myFunctions, members, now],
  );
  const logEntries = useMemo(() => selectRecentLogEntries(records, 10), [records]);
  const briefing = useMemo(() => selectUpcomingBriefing(records, me, now), [records, me, now]);
  const myShift = useMemo(() => selectMyShift(records, me, now), [records, me, now]);
  const attention = useMemo(() => selectNeedsAttention(records, me, now), [records, me, now]);

  const functionName = (id: string | null) =>
    functions.find((f) => f.id === id)?.name ?? (id ?? '—');
  const userName = (id: string) => members.find((m) => m.userId === id)?.userName ?? id;

  const statusClass =
    incident.status === 'active'
      ? 'bg-green-100 text-green-700'
      : incident.status === 'winding_down'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-700';

  const attentionLine = (item: AttentionItem, key: string) => {
    switch (item.kind) {
      case 'task_overdue':
        return (
          <li key={key} className="flex items-center justify-between gap-2">
            <span>
              <span className="font-medium text-red-700">{t('functionHome.attention.taskOverdue')}</span>{' '}
              {item.title}
            </span>
            <span className="font-mono text-xs text-red-600">{formatStockholmTime(item.due)}</span>
          </li>
        );
      case 'task_blocked':
        return (
          <li key={key} className="flex items-center justify-between gap-2">
            <span>
              <span className="font-medium text-amber-700">{t('functionHome.attention.taskBlocked')}</span>{' '}
              {item.title}
            </span>
          </li>
        );
      case 'decision_needed':
        return (
          <li key={key} className="flex items-center justify-between gap-2">
            <span>
              <span className="font-medium text-slate-900">{t('functionHome.attention.decision')}</span>{' '}
              {item.question}
            </span>
            <span className="text-slate-500 text-xs">{functionName(item.neededBy)}</span>
          </li>
        );
      case 'briefing_report_pending':
        return (
          <li key={key} className="flex items-center justify-between gap-2">
            <span>
              <span className="font-medium text-slate-900">{t('functionHome.attention.briefing')}</span>{' '}
              {item.title}
            </span>
            <span className="font-mono text-xs text-slate-500">{formatStockholmDateTime(item.at)}</span>
          </li>
        );
      case 'shift_soon':
        return (
          <li key={key} className="flex items-center justify-between gap-2">
            <span>
              <span className="font-medium text-slate-900">{t('functionHome.attention.shiftSoon')}</span>
            </span>
            <span className="font-mono text-xs text-slate-500">{formatStockholmTime(item.start)}</span>
          </li>
        );
    }
  };

  const hasShift = Boolean(myShift.current || myShift.next);

  return (
    <div className="space-y-4">
      {/* Header: incident name, status, back to workspace */}
      <header className="border-b border-slate-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900">{incident.name}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>{incident.status}</span>
        </div>
        <Link to={`/incidents/${incidentId}`} className="text-indigo-600 hover:text-indigo-700 text-sm">
          {t('functionHome.back')}
        </Link>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        {/* 1. My tasks */}
        <Card title={t('functionHome.tasks')}>
          {myTasks.length === 0 ? (
            <p className="text-sm text-slate-500">{t('functionHome.tasks.none')}</p>
          ) : (
            <ul className="text-sm text-slate-700 space-y-1 max-h-64 overflow-y-auto">
              {myTasks.map((task) => (
                <li key={task.entityId} className="flex items-center justify-between gap-2">
                  <span>
                    {task.title}
                    {task.overdue && (
                      <span className="text-red-600 text-xs font-medium"> ({t('tasks.overdue')})</span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500">
                    {t(`tasks.kanban.${task.status}`)}
                    {task.due ? ` · ${formatStockholmTime(task.due)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 2. Upcoming briefing + "prepare my report" shortcut */}
        <Card title={t('functionHome.briefing')}>
          {briefing.hasBriefing ? (
            <div className="text-sm text-slate-700">
              <p className="font-medium text-slate-900">{briefing.title}</p>
              <p className="mt-1">{formatStockholmDateTime(briefing.at)}</p>
              <p className="mt-2 text-2xl font-mono font-bold text-slate-900 tabular-nums">
                {briefing.inMs !== null ? formatHms(briefing.inMs) : '—'}
              </p>
              {briefing.missingReports.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-2">
                  <Link
                    to={`/incidents/${incidentId}?tab=staff`}
                    className="text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    {t('functionHome.briefing.prepare')}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('functionHome.briefing.reportMissing')}{' '}
                    {briefing.missingReports.map(functionName).join(', ')}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t('functionHome.briefing.none')}</p>
          )}
        </Card>

        {/* 3. My function's board */}
        <div className="md:col-span-6">
          <Card title={t('functionHome.board')}>
            {board.length === 0 ? (
              <p className="text-sm text-slate-500">{t('dashboard.functions.none')}</p>
            ) : (
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
                    {board.map((fn) => (
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
            )}
          </Card>
        </div>

        {/* 4. Latest log */}
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

        {/* 5. My shift + handover notes */}
        <Card title={t('functionHome.shift')}>
          {!hasShift && myShift.handoverNotes.length === 0 ? (
            <p className="text-sm text-slate-500">{t('functionHome.shift.none')}</p>
          ) : (
            <div className="text-sm text-slate-700 space-y-1">
              {myShift.current && (
                <p>
                  {t('functionHome.shift.current')} · {functionName(myShift.current.functionId)} ·{' '}
                  {formatStockholmTime(myShift.current.start)}–{formatStockholmTime(myShift.current.end)}
                </p>
              )}
              {myShift.next && (
                <p>
                  {t('functionHome.shift.next')} · {functionName(myShift.next.functionId)} ·{' '}
                  {formatStockholmTime(myShift.next.start)}–{formatStockholmTime(myShift.next.end)}
                </p>
              )}
              <h3 className="text-xs font-semibold uppercase text-slate-500 pt-2">
                {t('functionHome.handover')}
              </h3>
              {myShift.handoverNotes.length === 0 ? (
                <p className="text-sm text-slate-500">{t('functionHome.handover.none')}</p>
              ) : (
                <ul className="text-sm text-slate-700 space-y-1">
                  {myShift.handoverNotes.map((n, i) => (
                    <li key={i}>
                      <span className="text-xs text-slate-500">
                        {userName(n.fromUserId)} · {formatStockholmDateTime(n.at)}
                      </span>
                      <div>{n.text}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        {/* 6. Items needing my attention */}
        <div className="md:col-span-6">
          <Card title={t('functionHome.attention')}>
            {attention.length === 0 ? (
              <p className="text-sm text-slate-500">{t('functionHome.attention.none')}</p>
            ) : (
              <ul className="text-sm text-slate-700 space-y-1">
                {attention.map((item) => attentionLine(item, `${item.kind}-${item.id}`))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper — loads incident context from the API
// ---------------------------------------------------------------------------

export default function FunctionHomePage() {
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
    return <div className="text-center py-10">{t('functionHome.loading')}</div>;
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

  const myMember = members.find((m) => m.id === user?.id);
  if (!myMember) {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100 inline-block">
          {t('incidents.detail.notFound')}
        </div>
      </div>
    );
  }

  return (
    <FunctionHome
      store={localStore}
      incidentId={id}
      functions={functions}
      members={members.map((m) => ({
        userId: m.id,
        userName: m.displayName || m.username,
        functionIds: m.functionIds,
      }))}
      incident={{ id: incident.id, name: incident.name, startedAt: incident.startedAt, status: incident.status }}
      me={{ userId: myMember.id, functionIds: myMember.functionIds }}
    />
  );
}
