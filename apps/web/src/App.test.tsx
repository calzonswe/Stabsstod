import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n.ts';
import App from './App.js';

// Stub the auth fetch so the app renders as an authenticated user.
vi.stubGlobal(
  'fetch',
  async (): Promise<{
    ok: boolean;
    json: () => Promise<{
      user: {
        id: string;
        username: string;
        role: string;
        mustChangePassword: boolean;
      };
    }>;
  }> => ({
    ok: true,
    json: async () => ({
      user: {
        id: 'u1',
        username: 'testuser',
        role: 'user',
        mustChangePassword: false,
      },
    }),
  }),
);

describe('language switch', () => {
  it('shows Swedish by default', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>,
    );
    // Wait for the async auth fetch to resolve before asserting content.
    await screen.findByText('Stabsstöd');
    await screen.findByText('Välkommen');
    expect(screen.getByText('Stabsstöd')).toBeInTheDocument();
    expect(screen.getByText('Välkommen')).toBeInTheDocument();
  });

  it('switches to English when the language is changed', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>,
    );

    const switchButtons = screen.getAllByText(/Svenska →/);
    expect(switchButtons.length).toBeGreaterThan(0);
    await switchButtons[0].click();

    const welcomes = screen.getAllByText('Welcome');
    expect(welcomes.length).toBeGreaterThan(0);
    expect(welcomes[0]).toBeInTheDocument();
  });
});
