// ErrorNotice tests — M40

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n.ts';
import { ErrorNotice } from './ErrorNotice.js';

describe('ErrorNotice', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders the message with role=alert', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ErrorNotice message="Något gick fel" />
      </I18nextProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Något gick fel');
  });

  it('shows a retry button when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ErrorNotice message="Fel" onRetry={onRetry} />
      </I18nextProvider>,
    );
    const retry = screen.getByRole('button', { name: 'Försök igen' });
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalled();
  });

  it('does not show a retry button when onRetry is omitted', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ErrorNotice message="Fel" />
      </I18nextProvider>,
    );
    expect(
      screen.queryByRole('button', { name: 'Försök igen' }),
    ).not.toBeInTheDocument();
  });

  it('supports compact variant', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ErrorNotice message="Fel" compact />
      </I18nextProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('text-xs');
  });
});
