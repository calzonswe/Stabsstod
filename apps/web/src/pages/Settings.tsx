import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

type Settings = {
  timezone: string;
  map: { onlineTileUrl: string | null };
  maxUploadMB: number;
};

export default function Settings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');

  // Form state
  const [timezone, setTimezone] = useState('');
  const [onlineTileUrl, setOnlineTileUrl] = useState('');
  const [maxUploadMB, setMaxUploadMB] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setError('');
      const data = await api('/api/settings');
      setSettings(data);
      setTimezone(data.timezone);
      setOnlineTileUrl(data.map.onlineTileUrl ?? '');
      setMaxUploadMB(String(data.maxUploadMB));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaveError('');
    setSaving(true);
    try {
      await api('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: timezone || undefined,
          map: {
            onlineTileUrl: onlineTileUrl || null,
          },
          maxUploadMB: maxUploadMB ? parseInt(maxUploadMB, 10) : undefined,
        }),
      });
      await loadSettings();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-center py-10">{t('settings.loading')}</div>;
  }

  return (
    <div className="max-w-2xl mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('settings.title')}</h1>
        <p className="text-slate-600">{t('settings.subtitle')}</p>
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
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('settings.timezone')}
            </label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <p className="text-xs text-slate-500 mt-1">{t('settings.timezoneHint')}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('settings.onlineTileUrl')}
            </label>
            <input
              type="text"
              value={onlineTileUrl}
              onChange={(e) => setOnlineTileUrl(e.target.value)}
              placeholder="https://example.com/tiles/{z}/{x}/{y}.pbf"
              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <p className="text-xs text-slate-500 mt-1">{t('settings.onlineTileUrlHint')}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('settings.maxUploadMB')}
            </label>
            <input
              type="number"
              value={maxUploadMB}
              onChange={(e) => setMaxUploadMB(e.target.value)}
              min="1"
              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <p className="text-xs text-slate-500 mt-1">{t('settings.maxUploadMBHint')}</p>
          </div>

          {settings && (
            <div className="pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-500">
                {t('settings.currentValues')}:
                <br />
                {`timezone: ${settings.timezone}, map.onlineTileUrl: ${settings.map.onlineTileUrl ?? '(none)'}, maxUploadMB: ${settings.maxUploadMB}`}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white rounded disabled:bg-indigo-200 hover:bg-indigo-700 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </form>
      </div>
    </div>
  );
}
