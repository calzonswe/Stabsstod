// Account page tests — M38 (session management: list sessions, log out all)

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import Account from './Account.tsx';
import { AuthProvider } from '../contexts/AuthContext.js';

let sessionsPayload: { sessions: unknown[] };

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function renderAccount() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/account']}>
          <Account />
        </MemoryRouter>
      </AuthProvider>
    </I18nextProvider>,
  );
}

describe('Account (M38)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionsPayload = {
      sessions: [
        {
          createdAt: '2026-11-15T08:00:00.000Z',
          lastSeenAt: '2026-11-15T09:30:00.000Z',
          userAgent: 'TestBrowser/1.0 (Linux)',
          expiresAt: '2026-12-15T08:00:00.000Z',
          current: true,
        },
        {
          createdAt: '2026-11-10T08:00:00.000Z',
          lastSeenAt: null,
          userAgent: 'OtherBrowser/2.0 (Windows)',
          expiresAt: '2026-12-10T08:00:00.000Z',
          current: false,
        },
      ],
    };
    fetchMock = vi.fn(
      async (input: RequestInfo | URL | Request): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/auth/me') {
          return jsonResponse({
            user: {
              id: 'user-1',
              username: 'staffan',
              role: 'user',
              mustChangePassword: false,
            },
          });
        }
        if (url === '/api/settings') {
          return jsonResponse({ timezone: 'Europe/Stockholm' });
        }
        if (url === '/api/auth/sessions') {
          return jsonResponse(sessionsPayload);
        }
        return jsonResponse({ error: `unexpected ${url}` });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('lists the active sessions and marks the current one', async () => {
    renderAccount();

    expect(await screen.findByText('TestBrowser/1.0 (Linux)')).toBeInTheDocument();
    expect(screen.getByText('OtherBrowser/2.0 (Windows)')).toBeInTheDocument();
    // The session of the device the user is on is labelled as such.
    expect(screen.getByText('den här enheten')).toBeInTheDocument();
  });

  it('logs out of all devices when confirmed', async () => {
    renderAccount();
    const button = await screen.findByRole('button', { name: 'Logga ut alla enheter' });

    // Wait for AuthProvider to have persisted the user from /api/auth/me.
    await waitFor(() => {
      expect(localStorage.getItem('stabsstod-auth-user')).not.toBeNull();
    });

    fireEvent.click(button);

    // Confirm in the dialog.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Logga ut alla' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Logga ut alla' }));

    // The DELETE (all sessions) was sent, and the local session was cleared.
    await waitFor(() => {
      expect(localStorage.getItem('stabsstod-auth-user')).toBeNull();
    });
    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url) === '/api/auth/sessions' && (init as RequestInit)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(1);
  });

  it('does not log out when the confirmation is dismissed', async () => {
    renderAccount();
    const button = await screen.findByRole('button', { name: 'Logga ut alla enheter' });

    await waitFor(() => {
      expect(localStorage.getItem('stabsstod-auth-user')).not.toBeNull();
    });

    fireEvent.click(button);

    // Dismiss the dialog.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stäng' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stäng' }));

    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url) === '/api/auth/sessions' && (init as RequestInit)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
    // The local session is untouched.
    expect(localStorage.getItem('stabsstod-auth-user')).not.toBeNull();
  });
});
