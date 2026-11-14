// Incident workspace shell — plan.md §5 / M15
//
// Route /incidents/:id with navigation tabs:
//   Läge (Situation), Inriktning (Direction), Samordning (Coordination),
//   Logg (Logbook), Karta (Map), Stab (Staff), Rapporter (Reports).
//
// Role-aware: write actions are hidden using can() from @stabs/shared.
// Header shows incident name, status, elapsed time, my function,
// sync chip, language switch, bell placeholder.

import { useEffect, useState } from 'react';
import type { FormEvent as ReactFormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext.js';
import { useNavigate, useParams } from 'react-router-dom';
import { can, type Actor } from '@stabsstod/shared';
import Logbook from './Logbook.js';
import FactBoard from './FactBoard.js';
import SituationEditor from './SituationEditor.js';
import ScenarioBoard from './ScenarioBoard.js';
import MissionDirection from './MissionDirection.js';
import Decisions from './Decisions.js';
import Tasks from './Tasks.js';
import Timeline from './Timeline.js';
import Actors from './Actors.js';
import Attachments from './Attachments.js';
import Briefings from './Briefings.js';
import Map from './Map.js';
import Resources from './Resources.js';
import Shifts from './Shifts.js';
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

type TabId =
  | 'situation'
  | 'direction'
  | 'coordination'
  | 'log'
  | 'timeline'
  | 'map'
  | 'staff'
  | 'reports';

const TABS: { id: TabId; labelKey: string }[] = [
  { id: 'situation', labelKey: 'incidents.workspace.situation' },
  { id: 'direction', labelKey: 'incidents.workspace.direction' },
  { id: 'coordination', labelKey: 'incidents.workspace.coordination' },
  { id: 'log', labelKey: 'incidents.workspace.log' },
  { id: 'timeline', labelKey: 'incidents.workspace.timeline' },
  { id: 'map', labelKey: 'incidents.workspace.map' },
  { id: 'staff', labelKey: 'incidents.workspace.staff' },
  { id: 'reports', labelKey: 'incidents.workspace.reports' },
];

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '--:--:--';
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;
  const totalSeconds = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function IncidentWorkspace() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [functions, setFunctions] = useState<FunctionRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('situation');
  const [localStore] = useState<LocalStore | null>(() =>
    user ? new LocalStore({ userId: user.id }) : null,
  );

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

  async function renameFunction(functionId: string, newName: string) {
    try {
      setSaveError('');
      await api(`/api/incidents/${id}/functions/${functionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      await loadIncident();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'rename failed');
    }
  }

  async function addMember(event: ReactFormEvent, functionIds: string[]) {
    event.preventDefault();
    setSaveError('');
    const form = event.currentTarget as HTMLFormElement;
    const userId = (form.elements.namedItem('userId') as HTMLSelectElement).value;
    const role = (form.elements.namedItem('role') as HTMLSelectElement).value;
    try {
      await api(`/api/incidents/${id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role, functionIds }),
      });
      await loadIncident();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'add member failed');
    }
  }

  // Build actor for can() permission checks
  const myMember = user && incident && id ? members.find((m) => m.id === user.id) : undefined;
  const actor: Actor | null = user && incident && id && myMember
    ? {
        userId: user.id,
        incidentId: id,
        role: incident.role as Actor['role'],
        functionIds: myMember.functionIds,
      }
    : null;

  // Permission checks using can()
  const canWriteMission = actor
    ? can(actor, 'write', { entityType: 'mission', incidentId: id!, functionId: null }, {})
    : false;


  const isChiefOrDeputy = incident?.role === 'chief_of_staff' || incident?.role === 'deputy_chief';
  const isAdmin = user?.role === 'admin';

  // M32: the chief of staff / deputy lands on the dashboard by default —
  // once per browser session per incident, so the workspace (tabs, map)
  // stays reachable via the dashboard's "Tillbaka" link. The flag is read
  // synchronously (not in an effect) so the workspace never flashes first.
  let redirectToDashboard = false;
  if (isChiefOrDeputy && incident) {
    const key = `dashboard-visited-${incident.id}`;
    try {
      redirectToDashboard = sessionStorage.getItem(key) === null;
    } catch {
      // sessionStorage unavailable — still redirect.
      redirectToDashboard = true;
    }
  }

  useEffect(() => {
    if (!redirectToDashboard || !incident) return;
    try {
      sessionStorage.setItem(`dashboard-visited-${incident.id}`, '1');
    } catch {
      // Ignore: the redirect itself still happens.
    }
    navigate(`/incidents/${incident.id}/dashboard`, { replace: true });
  }, [redirectToDashboard, incident, navigate]);

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

  if (!incident) {
    return <div className="text-center py-10">{t('incidents.detail.notFound')}</div>;
  }

  const elapsed = formatElapsed(incident.startedAt);

  return (
    <div className="max-w-7xl mx-auto py-6 space-y-6">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white px-4 py-3 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{incident.name}</h1>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                incident.status === 'active'
                  ? 'bg-green-100 text-green-700'
                  : incident.status === 'winding_down'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {incident.status}
            </span>
          </div>
          <div className="flex flex-col lg:flex-row items-center gap-3 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <span className="font-medium">{t('incidents.header.myFunction')}</span>
              <span>{myMember?.functionIds.join(', ') || '—'}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <span className="font-medium">{t('incidents.header.elapsed')}</span>
              <span>{elapsed}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
              <span>{t('incidents.header.sync')}</span>
            </div>
            <button
              className="text-slate-600 hover:text-slate-900"
              aria-label={t('incidents.header.bell')}
            >
              🔔
            </button>
          </div>
        </div>
      </header>

      {/* Navigation tabs */}
      <nav className="border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600 bg-indigo-50'
                    : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
      </nav>

      {error && (
        <div className="max-w-7xl mx-auto px-4">
          <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100 inline-block">
            {error}
          </div>
        </div>
      )}
      {saveError && (
        <div className="max-w-7xl mx-auto px-4">
          <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100 inline-block">
            {saveError}
          </div>
        </div>
      )}

      {/* Tab content */}
      <main className="max-w-7xl mx-auto px-4 py-4 min-h-[400px]">
        {activeTab === 'situation' && (
          <>
            <FactBoard store={localStore} incidentId={id!} authorId={user?.id ?? ''} />
            <SituationEditor store={localStore} incidentId={id!} authorId={user?.id ?? ''} />
            <ScenarioBoard
              store={localStore}
              incidentId={id!}
              authorId={user?.id ?? ''}
              onTaskClick={() => setActiveTab('coordination')}
            />
          </>
        )}
        {activeTab === 'direction' && (
          <>
            <MissionDirection
              store={localStore}
              incidentId={id!}
              authorId={user?.id ?? ''}
              actor={actor}
            />
            <Decisions
              store={localStore}
              incidentId={id!}
              authorId={user?.id ?? ''}
              actor={actor}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          </>
        )}
        {activeTab === 'coordination' && (
          <Tasks
            store={localStore}
            incidentId={id!}
            authorId={user?.id ?? ''}
            actor={actor}
            functions={functions}
          />
        )}
        {activeTab === 'log' && (
          <Logbook
            store={localStore}
            incidentId={id!}
            authorId={user?.id ?? ''}
          />
        )}
        {activeTab === 'timeline' && (
          <Timeline
            store={localStore}
            incidentId={id!}
            authorId={user?.id ?? ''}
            actor={actor}
          />
        )}
        {activeTab === 'map' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {t('incidents.workspace.map')}
            </h2>
            <div className="h-96 w-full">
              <Map
                store={localStore}
                incidentId={id!}
                authorId={user?.id ?? ''}
                functionId={myMember?.functionIds[0] ?? null}
              />
            </div>
          </div>
        )}
        {activeTab === 'staff' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {t('incidents.workspace.staff')}
            </h2>
            <Briefings
              store={localStore}
              incidentId={id!}
              authorId={user?.id ?? ''}
              actor={actor}
              functions={functions}
            />
            <Shifts
              store={localStore}
              incidentId={id!}
              authorId={user?.id ?? ''}
              actor={actor}
              functions={functions}
              members={members}
            />
            <Actors
              store={localStore}
              incidentId={id!}
              authorId={user?.id ?? ''}
              actor={actor}
            />
            <Resources
              store={localStore}
              incidentId={id!}
              authorId={user?.id ?? ''}
              actor={actor}
              functions={functions}
              members={members}
            />
            <Attachments
              store={localStore}
              incidentId={id!}
              authorId={user?.id ?? ''}
              actor={actor}
            />
          </div>
        )}
        {activeTab === 'reports' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {t('incidents.workspace.reports')}
            </h2>
            <div className="text-slate-500">{t('incidents.placeholder.comingSoon')}</div>
          </div>
        )}
      </main>

      {/* Functions and members sections (kept from original) */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          {t('incidents.detail.functions')}
        </h2>
        <div className="space-y-3">
          {functions.map((f) => (
            <div key={f.id} className="flex items-center gap-4">
              <span className="w-20 text-sm text-slate-600 font-medium">{f.name}</span>
              {isChiefOrDeputy || isAdmin || canWriteMission ? (
                <input
                  type="text"
                  defaultValue={f.name}
                  onBlur={(e) => e.target.value !== f.name && renameFunction(f.id, e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                />
              ) : (
                <span className="text-sm text-slate-500">{t('incidents.detail.viewOnly')}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          {t('incidents.detail.members')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                  {t('incidents.col.username')}
                </th>
                <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                  {t('incidents.col.displayName')}
                </th>
                <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                  {t('incidents.col.role')}
                </th>
                <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                  {t('incidents.col.functions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-900 font-medium">{m.username}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {m.displayName || t('incidents.col.noDisplayName')}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{m.role}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {m.functionIds.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      m.functionIds.join(', ')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(isChiefOrDeputy || isAdmin || canWriteMission) && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {t('incidents.detail.addMember')}
          </h2>
          <form
            onSubmit={(e) => addMember(e, [])}
            className="grid grid-cols-1 md:grid-cols-4 gap-4"
          >
            <div className="col-span-1 md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('incidents.form.user')}
              </label>
              <select
                name="userId"
                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
              >
                <option value="user-m7-regular-1">Regular user</option>
              </select>
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('incidents.form.role')}
              </label>
              <select
                name="role"
                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
              >
                <option value="staff_member">{t('users.create.roleUser')}</option>
                <option value="chief_of_staff">{t('incidents.form.roleChief')}</option>
                <option value="deputy_chief">{t('incidents.form.roleDeputy')}</option>
                <option value="function_lead">{t('incidents.form.roleLead')}</option>
                <option value="observer">{t('incidents.form.roleObserver')}</option>
              </select>
            </div>
            <div className="col-span-1 md:col-span-4">
              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
              >
                {t('incidents.form.addMember')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
