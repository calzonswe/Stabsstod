import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

type IncidentRow = {
  id: string;
  name: string;
  type: string | null;
  startedAt: string | null;
  status: string;
  createdAt: string;
  role: string;
};

export default function Incidents() {
  const { t } = useTranslation();
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadIncidents();
  }, []);

  async function loadIncidents() {
    try {
      setError('');
      const data = await api('/api/incidents');
      setIncidents(data.incidents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load incidents');
    } finally {
      setLoading(false);
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

  const statusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-700';
      case 'winding_down':
        return 'bg-amber-100 text-amber-700';
      case 'closed':
        return 'bg-slate-100 text-slate-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('incidents.title')}</h1>
          <p className="text-slate-600">{t('incidents.subtitle')}</p>
        </div>
        <Link
          to="/incidents/create"
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
        >
          {t('incidents.create')}
        </Link>
      </div>

      {error && (
        <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('incidents.col.name')}
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('incidents.col.type')}
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('incidents.col.status')}
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('incidents.col.started')}
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('incidents.col.role')}
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('incidents.col.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {incidents.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {t('incidents.empty')}
                </td>
              </tr>
            ) : (
              incidents.map((inc) => (
                <tr key={inc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">{inc.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {inc.type || t('incidents.col.unspecified')}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${statusBadge(inc.status)}`}
                    >
                      {inc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {inc.startedAt
                      ? new Date(inc.startedAt).toLocaleString()
                      : t('incidents.col.unspecified')}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{inc.role}</td>
                  <td className="px-4 py-3 text-sm">
                    <Link
                      to={`/incidents/${inc.id}`}
                      className="text-sm text-indigo-600 hover:text-indigo-700"
                    >
                      {t('incidents.col.open')}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
