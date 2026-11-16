// ErrorNotice — shared error display with an optional retry action (M40).
//
// Replaces the inline red error boxes across the app. Pass onRetry when the
// error is recoverable without a full page reload.

import { useTranslation } from 'react-i18next';

export interface ErrorNoticeProps {
  message: string;
  onRetry?: () => void;
  /** Compact styling for small side panels (e.g. the map feature panel). */
  compact?: boolean;
}

export function ErrorNotice({ message, onRetry, compact = false }: ErrorNoticeProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={`${
        compact ? 'mt-2 p-1.5 text-xs' : 'p-3 text-sm'
      } rounded bg-red-50 text-red-700 border border-red-100 flex items-center justify-between gap-3`}
    >
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-xs font-medium border border-red-200 rounded px-2 py-1 hover:bg-red-100"
        >
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
