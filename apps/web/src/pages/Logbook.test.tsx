import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n.ts';
import Logbook from './Logbook.tsx';

// Tests run against the default language (sv) — Swedish strings, like the other
// component tests.

describe('Logbook', () => {
  it('renders logbook title and subtitle in Swedish', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <Logbook />
      </I18nextProvider>,
    );

    expect(screen.getByText('Logg')).toBeInTheDocument();
    expect(screen.getByText('Incidentens logg över händelser och noteringar')).toBeInTheDocument();
  });

  it('shows coming soon placeholder', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <Logbook />
      </I18nextProvider>,
    );

    // Both tests render into the same document (no auto-cleanup), so the
    // first render's DOM is still present. Use getAllByText.
    expect(screen.getAllByText('Loggmodulen kommer snart').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Logginlägg och tidslinjehändelser visas här.').length).toBeGreaterThan(0);
  });
});
