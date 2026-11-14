// Incident workspace redirect tests — M33 (role-specific landing)
//
// /incidents/:id sends the signed-in user to a role-specific landing page:
//   chief_of_staff / deputy_chief → /incidents/:id/dashboard (M32)
//   every other role              → /incidents/:id/home (M33)
// Once per browser session per incident (sessionStorage flag), so the
// workspace itself stays reachable via the landing page's "Tillbaka" link
// without a redirect loop.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '../testMockDexie.js';
import i18n from '../i18n.ts';
import IncidentWorkspace from './IncidentDetail.tsx';
import { AuthProvider } from '../contexts/AuthContext.js';

const INCIDENT_ID = 'inc-redirect';

// The incident role of the signed-in user (the API reports it in the
// incident payload).
let incidentRole = 'staff_member';

function incidentResponse() {
  return {
    incident: {
      id: INCIDENT_ID,
      name: 'Incident M33',
      type: null,
      startedAt: new Date().toISOString(),
      status: 'active',
      createdBy: 'user-staff',
      createdAt: new Date().toISOString(),
      role: incidentRole,
    },
    functions: [{ id: 'fn-1', name: 'Ledning' }],
    members: [
      {
        id: 'user-staff',
        username: 'staffan',
        displayName: null,
        role: incidentRole,
        functionIds: ['fn-1'],
      },
    ],
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function renderWorkspace() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/incidents/${INCIDENT_ID}`]}>
          <Routes>
            <Route path="/incidents/:id" element={<IncidentWorkspace />} />
            <Route path="/incidents/:id/dashboard" element={<div>DASHBOARD-LANDING</div>} />
            <Route path="/incidents/:id/home" element={<div>HOME-LANDING</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nextProvider>,
  );
}

describe('Incident workspace role-specific landing (M33)', () => {
  beforeEach(() => {
    incidentRole = 'staff_member';
    sessionStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/auth/me') {
          return jsonResponse({
            user: { id: 'user-staff', username: 'staffan', role: 'user', mustChangePassword: false },
          });
        }
        if (url.startsWith(`/api/incidents/${INCIDENT_ID}`)) {
          return jsonResponse(incidentResponse());
        }
        return jsonResponse({ error: `unexpected ${url}` });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sends a non-chief role to the function home once per session', async () => {
    incidentRole = 'function_lead';
    renderWorkspace();

    expect(await screen.findByText('HOME-LANDING')).toBeInTheDocument();
    expect(sessionStorage.getItem(`home-visited-${INCIDENT_ID}`)).toBe('1');
    expect(screen.queryByText('DASHBOARD-LANDING')).toBeNull();
  });

  it('sends the chief of staff to the dashboard', async () => {
    incidentRole = 'chief_of_staff';
    renderWorkspace();

    expect(await screen.findByText('DASHBOARD-LANDING')).toBeInTheDocument();
    expect(sessionStorage.getItem(`dashboard-visited-${INCIDENT_ID}`)).toBe('1');
    expect(screen.queryByText('HOME-LANDING')).toBeNull();
  });

  it('does not redirect again once the home flag is set (no loop)', async () => {
    incidentRole = 'staff_member';
    sessionStorage.setItem(`home-visited-${INCIDENT_ID}`, '1');
    renderWorkspace();

    // The workspace itself renders (the "Tillbaka" landing target).
    expect(await screen.findByText('Incident M33')).toBeInTheDocument();
    expect(screen.queryByText('HOME-LANDING')).toBeNull();
  });
});
