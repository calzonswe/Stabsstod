// EntityHistory — plan.md §5 / M14
//
// Drawer showing all versions of an entity ordered by HLC.

import { useTranslation } from 'react-i18next';
import { hlcParse, type RecordEnvelope } from '@stabsstod/shared';

export interface EntityHistoryProps {
  entityId: string;
  history: RecordEnvelope[];
  isOpen: boolean;
  onClose: () => void;
}

export function EntityHistory({ history, isOpen, onClose }: EntityHistoryProps) {
  const { t } = useTranslation();

  const formatTime = (hlc: string) => {
    const { wall } = hlcParse(hlc);
    return new Date(wall).toLocaleString();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">{t('history.title')}</h2>
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-slate-900"
            aria-label="Close"
            data-testid="close-history"
          >
            ✕
          </button>
        </div>
        <table className="w-full text-left text-sm divide-y divide-slate-100">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-3 py-2 text-slate-600 font-medium">{t('history.kind')}</th>
              <th className="px-3 py-2 text-slate-600 font-medium">{t('history.author')}</th>
              <th className="px-3 py-2 text-slate-600 font-medium">{t('history.time')}</th>
              <th className="px-3 py-2 text-slate-600 font-medium">{t('conflict.payload')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((record) => (
              <tr key={record.id} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      record.kind === 'put' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {record.kind === 'put' ? t('history.put') : t('history.retract')}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600 truncate">{record.authorId}</td>
                <td className="px-3 py-2 text-slate-600">{formatTime(record.hlc)}</td>
                <td className="px-3 py-2 text-slate-600 overflow-x-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(record.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
