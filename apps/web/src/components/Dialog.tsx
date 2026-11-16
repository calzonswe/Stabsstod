// Dialog — shared modal dialog with focus management (M40).
//
// - role="dialog" + aria-modal + aria-label from the title
// - Escape closes; backdrop click closes
// - focus moves into the dialog on open (first focusable element)
// - Tab/Shift+Tab cycle within the dialog (focus trap)
// - focus is returned to the previously focused element on close
//
// Pages render the action buttons (cancel/confirm) as children, matching
// the existing dialog layouts.

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Width class for the dialog box (default max-w-md). */
  widthClass?: string;
}

export function Dialog({ title, onClose, children, widthClass = 'max-w-md' }: DialogProps) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest onClose in a ref so the effect below does not re-run on
  // every render (re-running would steal focus back to the first element).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    if (!box) return;

    const focusables = () => Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusables()[0] ?? box).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === box) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || active === box) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`bg-white rounded-lg p-6 ${widthClass} w-full shadow-xl outline-none`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="text-slate-600 hover:text-slate-900"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
