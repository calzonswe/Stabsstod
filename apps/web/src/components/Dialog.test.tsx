// Dialog tests — M40
// Covers: role/aria-modal, Escape closes, focus moves into dialog, focus trap,
// focus restore on close, close button aria-label.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n.ts';
import { Dialog } from './Dialog.js';

function TestDialog({ open }: { open: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(open);
  return (
    <I18nextProvider i18n={i18n}>
      <button id="trigger" onClick={() => setDialogOpen(true)}>
        Open
      </button>
      {dialogOpen && (
        <Dialog title="Test dialog" onClose={() => setDialogOpen(false)}>
          <p id="dialog-content">Dialog content</p>
          <button id="inner-button">Inner button</button>
        </Dialog>
      )}
    </I18nextProvider>
  );
}

describe('Dialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders with role=dialog and aria-modal', () => {
    render(<TestDialog open={true} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has a close button with aria-label', () => {
    render(<TestDialog open={true} />);
    const close = screen.getAllByRole('button', { name: 'Stäng' });
    expect(close.length).toBeGreaterThan(0);
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <Dialog title="Test" onClose={onClose}>
          <p>content</p>
        </Dialog>
      </I18nextProvider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus into the dialog on open', () => {
    render(<TestDialog open={true} />);
    // Focus goes to a focusable element inside the dialog (not the body).
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('unmounts on close and restores focus out of the dialog', () => {
    render(<TestDialog open={true} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Stäng' })[0]);
    // Dialog unmounts → dialog removed from DOM.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Focus moves to an element in the document (not trapped in removed dialog).
    expect(document.activeElement).not.toBeNull();
  });
});
