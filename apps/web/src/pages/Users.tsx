import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

type UserRow = {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  disabled: boolean;
  preferred_language: string;
  must_change_password: boolean;
  created_at: string;
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

export default function Users() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create user form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState(false);
  const [tempResult, setTempResult] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    void loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setError('');
      const data = await api('/api/admin/users');
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load users');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      await api('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          displayName: newDisplayName || undefined,
          role: newRole,
        }),
      });
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('user');
      await loadUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setCreating(false);
    }
  }

  async function toggleDisabled(id: string, disabled: boolean) {
    try {
      await api(`/api/admin/users/${id}/disable`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !disabled }),
      });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'toggle failed');
    }
  }

  async function doResetPassword(user: UserRow) {
    setResetting(true);
    try {
      const data = await api(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
      });
      setTempResult({ username: user.username, password: data.tempPassword });
      setResetFor(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reset failed');
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return <div className="text-center py-10">{t('users.loading')}</div>;
  }

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('users.title')}</h1>
          <p className="text-slate-600">{t('users.subtitle')}</p>
        </div>
      </div>

      {error && <ErrorNotice message={error} onRetry={() => void loadUsers()} />}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('users.col.username')}
              </th>
              <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('users.col.displayName')}
              </th>
              <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('users.col.role')}
              </th>
              <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('users.col.status')}
              </th>
              <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-600">
                {t('users.col.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {t('users.empty')}
                </td>
              </tr>
            ) : (
              users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-900 font-medium">{u.username}</td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {u.display_name || t('users.col.noDisplayName')}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      u.role === 'admin'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <button
                    onClick={() => toggleDisabled(u.id, u.disabled)}
                    className={`px-3 py-1 rounded text-sm border ${
                      u.disabled
                        ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                        : 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'
                    }`}
                  >
                    {u.disabled ? t('users.col.enable') : t('users.col.disable')}
                  </button>
                </td>
                <td className="px-4 py-3 text-sm">
                  {u.disabled ? (
                    <span className="text-red-600">{t('users.col.disabled')}</span>
                  ) : (
                    <button
                      onClick={() => setResetFor(u)}
                      className="text-xs border border-slate-300 px-2 py-1 rounded hover:bg-slate-100 text-slate-700"
                    >
                      {t('users.col.resetPassword')}
                    </button>
                  )}
                </td>
              </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">{t('users.create.title')}</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="col-span-1 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('users.create.username')}
            </label>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('users.create.password')}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('users.create.displayName')}
            </label>
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('users.create.role')}
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
            >
              <option value="user">{t('users.create.roleUser')}</option>
              <option value="admin">{t('users.create.roleAdmin')}</option>
            </select>
          </div>
          <div className="col-span-1 md:col-span-4">
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-indigo-600 text-white rounded disabled:bg-indigo-200 hover:bg-indigo-700 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? t('users.create.creating') : t('users.create.create')}
            </button>
          </div>
        </form>
      </div>

      {/* Reset password confirm dialog */}
      {resetFor && (
        <Dialog title={t('users.reset.confirmTitle')} onClose={() => setResetFor(null)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {t('users.reset.confirm', { username: resetFor.username })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setResetFor(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('users.reset.cancel')}
              </button>
              <button
                onClick={() => void doResetPassword(resetFor)}
                disabled={resetting}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {t('users.reset.reset')}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Temporary password result dialog */}
      {tempResult && (
        <Dialog title={t('users.reset.tempTitle')} onClose={() => setTempResult(null)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {t('users.reset.temp', { password: tempResult.password })}
            </p>
            <code className="block rounded bg-slate-50 border border-slate-200 px-3 py-2 text-sm font-mono break-all">
              {tempResult.password}
            </code>
            <div className="flex justify-end">
              <button
                onClick={() => setTempResult(null)}
                className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
