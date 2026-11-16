// EntityHistory — plan.md §5 / M14
//
// Drawer showing all versions of an entity ordered by HLC.

import { useTranslation } from 'react-i18next';
import { hlcParse, type RecordEnvelope } from '@stabsstod/shared';
import { Dialog } from './Dialog.js';

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
    <Dialog title={t('history.title')} onClose={onClose} widthClass="max-w-2xl max-h-[80vh] overflow-y-auto">
      <table className="w-full text-left text-sm divide-y divide-slate-100">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th scope="col" className="px-3 py-2 text-slate-600 font-medium">{t('history.kind')}</th>
            <th scope="col" className="px-3 py-2 text-slate-600 font-medium">{t('history.author')}</th>
            <th scope="col" className="px-3 py-2 text-slate-600 font-medium">{t('history.time')}</th>
            <th scope="col" className="px-3 py-2 text-slate-600 font-medium">{t('conflict.payload')}</th>
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
    </Dialog>
  );
}
