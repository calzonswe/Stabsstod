import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext.js';
import { Dialog } from '../components/Dialog.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

const DEFAULT_TIMEZONE = 'Europe/Stockholm';

interface SessionInfo {
  createdAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  expiresAt: string;
  current: boolean;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

/** ISO-style date, 24h clock, in the display timezone (plan.md §2). */
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

export default function Account() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

  useEffect(() => {
    // Display timezone (admin setting); fall back to Europe/Stockholm.
    void (async () => {
      try {
        const s = await api('/api/settings');
        if (s && typeof s.timezone === 'string' && s.timezone.length > 0) {
          setTimezone(s.timezone);
        }
      } catch {
        // Keep the default.
      }
    })();
  }, []);

  useEffect(() => {
    void loadSessions();
  }, []);

  async function loadSessions() {
    try {
      setError('');
      const data = (await api('/api/auth/sessions')) as { sessions: SessionInfo[] };
      setSessions(data.sessions);
    } catch {
      setError(t('account.error'));
    } finally {
      setLoading(false);
    }
  }

  async function logoutAll() {
    setActing(true);
    try {
      // Ends every session of this user, including this one.
      await api('/api/auth/sessions', { method: 'DELETE' });
    } catch {
      setActing(false);
      setError(t('account.logoutAll.error'));
      return;
    }
    // Clear the local session; RequireAuth then redirects to /login.
    await logout();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">{t('account.title')}</h1>
      <p className="mt-1 text-slate-600">{t('account.subtitle')}</p>

      <section className="mt-6 border border-slate-200 rounded-lg p-4">
        <h2 className="font-semibold text-slate-900">{t('account.sessions.title')}</h2>

        {loading && <p className="mt-3 text-slate-600">{t('account.loading')}</p>}

        {!loading && error && (
          <div className="mt-3">
            <ErrorNotice message={error} onRetry={() => void loadSessions()} />
          </div>
        )}

        {!loading && !error && sessions && sessions.length === 0 && (
          <p className="mt-3 text-slate-600">{t('account.sessions.empty')}</p>
        )}

        {!loading && !error && sessions && sessions.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th scope="col" className="py-2 pr-4 font-medium">{t('account.sessions.col.device')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('account.sessions.col.lastSeen')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('account.sessions.col.expires')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4">
                    <span className="text-slate-800 break-all">
                      {s.userAgent ?? t('account.sessions.unknownDevice')}
                    </span>
                    {s.current && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded">
                        {t('account.sessions.current')}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">
                    {s.lastSeenAt ? formatDateTime(s.lastSeenAt, timezone) : '—'}
                  </td>
                  <td className="py-2 text-slate-600 whitespace-nowrap">
                    {formatDateTime(s.expiresAt, timezone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6 border border-red-200 rounded-lg p-4">
        <h2 className="font-semibold text-red-700">{t('account.logoutAll')}</h2>
        <button
          onClick={() => setConfirmLogoutAll(true)}
          disabled={acting || loading}
          className="mt-3 px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {acting ? t('account.logoutAll.acting') : t('account.logoutAll.button')}
        </button>
      </section>

      {confirmLogoutAll && (
        <Dialog title={t('account.logoutAll')} onClose={() => setConfirmLogoutAll(false)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{t('account.logoutAll.confirm')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmLogoutAll(false)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('account.logoutAll.cancel')}
              </button>
              <button
                onClick={() => {
                  setConfirmLogoutAll(false);
                  void logoutAll();
                }}
                disabled={acting}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {t('account.logoutAll.do')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
