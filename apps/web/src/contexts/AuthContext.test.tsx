import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n.ts';
import { AuthProvider, useAuth } from './AuthContext.js';

const STORAGE_KEY = 'stabsstod-auth-user';
const USER = { id: 'u1', username: 'admin', role: 'admin' as const, mustChangePassword: false };

function storedUser(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function Probe() {
  const { user, loading, login, logout, changePassword } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.username : 'none'}</span>
      <span data-testid="must-change">{user ? String(user.mustChangePassword) : 'n/a'}</span>
      <button onClick={() => void login('admin', 'pw')}>login</button>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => void changePassword('old', 'new')}>change-password</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </I18nextProvider>,
  );
}

async function waitForAuthSettled(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AuthProvider (offline-first session)', () => {
  it('stores the user when /api/auth/me succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      async () => ({ ok: true, json: async () => ({ user: USER }) }),
    );
    renderProbe();
    await screen.findByText('admin');
    expect(storedUser()).toEqual({ ...USER });
  });

  it('restores the stored user when /api/auth/me fails (offline)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(USER));
    vi.stubGlobal('fetch', () => Promise.reject(new Error('failed to fetch')));
    renderProbe();
    await screen.findByText('admin');
  });

  it('stays signed out when offline with no stored user', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('failed to fetch')));
    renderProbe();
    await waitForAuthSettled();
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(storedUser()).toBeNull();
  });

  it('signs out and clears storage when /api/auth/me reports 401', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(USER));
    vi.stubGlobal(
      'fetch',
      async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'not authenticated' }),
      }),
    );
    renderProbe();
    await waitForAuthSettled();
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(storedUser()).toBeNull();
  });

  it('login stores the returned user', async () => {
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/login')) {
          return { ok: true, status: 200, json: async () => ({ user: USER }) };
        }
        if (url.includes('/api/auth/me')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'not authenticated' }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    );
    renderProbe();
    await waitForAuthSettled();
    await screen.getByText('login').click();
    await screen.findByText('admin');
    expect(storedUser()).toEqual({ ...USER });
  });

  it('changePassword clears mustChangePassword and persists it', async () => {
    const pending = { ...USER, mustChangePassword: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return { ok: true, status: 200, json: async () => ({ user: pending }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    );
    renderProbe();
    await waitForAuthSettled();
    expect(screen.getByTestId('must-change')).toHaveTextContent('true');
    await screen.getByText('change-password').click();
    await waitFor(() => expect(screen.getByTestId('must-change')).toHaveTextContent('false'));
    expect(storedUser()).toMatchObject({ mustChangePassword: false });
  });

  it('logout clears state and storage even when offline', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(USER));
    vi.stubGlobal('fetch', () => Promise.reject(new Error('failed to fetch')));
    renderProbe();
    await waitForAuthSettled();
    expect(screen.getByTestId('user')).toHaveTextContent('admin');
    await screen.getByText('logout').click();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    expect(storedUser()).toBeNull();
  });
});
