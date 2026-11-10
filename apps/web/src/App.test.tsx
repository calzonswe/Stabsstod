import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n.ts';
import App from './App.js';

describe('language switch', () => {
  it('shows Swedish by default', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>,
    );
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
