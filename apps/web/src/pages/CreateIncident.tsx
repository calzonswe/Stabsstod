import { useEffect, useState } from 'react';
import type { FormEvent as ReactFormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext.js';
import { useNavigate } from 'react-router-dom';

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

type Preset = {
  id: string;
  name: string;
  functionCount: number;
};

export default function CreateIncident() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('small');
  const [name, setName] = useState('');
  const [type, setType] = useState('storm');
  const [startedAt, setStartedAt] = useState('');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadPresets();
    // Default startedAt to now in ISO format (local datetime input).
    setStartedAt(new Date().toISOString().slice(0, 16));
  }, []);

  async function loadPresets() {
    try {
      const data = await api('/api/presets');
      setPresets(data.presets);
      if (data.presets.length > 0) {
        setSelectedPreset(data.presets[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load presets');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: ReactFormEvent) {
    event.preventDefault();
    setError('');
    setCreating(true);
    try {
      await api('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          startedAt: startedAt + ':00Z',
          status,
          presetId: selectedPreset,
          members: [],
        }),
      });
      navigate('/incidents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setCreating(false);
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

  const isAdmin = user?.role === 'admin';
  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">403 — Forbidden</h1>
        <p className="text-slate-600">Administrator access is required to create incidents.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('incidents.createTitle')}</h1>
        <p className="text-slate-600">{t('incidents.createSubtitle')}</p>
      </div>

      {error && (
        <div className="rounded bg-red-50 p-4 text-sm text-red-700 border border-red-100">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('incidents.form.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('incidents.form.type')}
              </label>
              <input
                type="text"
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="storm, fire, …"
                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('incidents.form.status')}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
              >
                <option value="active">{t('incidents.status.active')}</option>
                <option value="winding_down">{t('incidents.status.winding_down')}</option>
                <option value="closed">{t('incidents.status.closed')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('incidents.form.startedAt')}
              </label>
              <input
                type="datetime-local"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('incidents.form.preset')}
            </label>
            <div className="border border-slate-200 rounded p-3 space-y-3">
              {presets.map((p) => (
                <label key={p.id} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={selectedPreset === p.id}
                    onChange={() => setSelectedPreset(p.id)}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {p.name} ({p.functionCount} {t('incidents.form.functions')})
                    </div>
                    <div className="text-xs text-slate-500">
                      {t('incidents.form.copiedIntoStaffFunctions')}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={creating || !name}
            className="px-4 py-2 bg-indigo-600 text-white rounded disabled:bg-indigo-200 hover:bg-indigo-700 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? t('incidents.form.creating') : t('incidents.form.create')}
          </button>
        </form>
      </div>
    </div>
  );
}
