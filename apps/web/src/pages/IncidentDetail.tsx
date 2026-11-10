import { useEffect, useState } from 'react';
import type { FormEvent as ReactFormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext.js';
import { useParams, Link } from 'react-router-dom';

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

export default function IncidentDetail() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [functions, setFunctions] = useState<FunctionRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');

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

  const isChiefOrDeputy = incident.role === 'chief_of_staff' || incident.role === 'deputy_chief';
  const isAdmin = user?.role === 'admin';

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{incident.name}</h1>
          <p className="text-slate-600">
            {incident.type} · {incident.status} ·{' '}
            {t('incidents.detail.yourRole', { role: incident.role })}
          </p>
        </div>
        <Link to="/incidents" className="px-4 py-2 text-sm text-indigo-600 hover:text-indigo-700">
          {t('incidents.detail.back')}
        </Link>
      </div>

      {error && (
        <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100">
          {error}
        </div>
      )}
      {saveError && (
        <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100">
          {saveError}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          {t('incidents.detail.functions')}
        </h2>
        <div className="space-y-3">
          {functions.map((f) => (
            <div key={f.id} className="flex items-center gap-4">
              <span className="w-20 text-sm text-slate-600 font-medium">{f.name}</span>
              {isChiefOrDeputy || isAdmin ? (
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

      {(isChiefOrDeputy || isAdmin) && (
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
