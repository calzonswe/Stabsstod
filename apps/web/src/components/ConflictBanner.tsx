// ConflictBanner — plan.md §5 / M14
//
// Shows both heads of a conflict side by side with author, time, and payload.
// "Use this version" action writes a merge record with all heads as parents.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hlcCompare, hlcParse, type RecordEnvelope } from '@stabsstod/shared';

export interface ConflictBannerProps {
  entityId: string;
  heads: RecordEnvelope[];
  current: RecordEnvelope | null;
  onMerge: (selectedHead: RecordEnvelope, allHeads: RecordEnvelope[]) => void | Promise<void>;
}

export function ConflictBanner({ heads, current: currentProp, onMerge }: ConflictBannerProps) {
  const { t } = useTranslation();
  const [merging, setMerging] = useState<string | null>(null);

  // Compute current from heads if not provided (uses highest HLC, tie-break deviceId)
  const current = currentProp ?? heads.reduce((best, h) => {
    const c = hlcCompare(h.hlc, best.hlc);
    if (c > 0) return h;
    if (c < 0) return best;
    return h.deviceId > best.deviceId ? h : best;
  }, heads[0]);

  const formatTime = (hlc: string) => {
    const { wall } = hlcParse(hlc);
    return new Date(wall).toLocaleString();
  };

  const handleMerge = async (selectedHead: RecordEnvelope) => {
    setMerging(selectedHead.id);
    try {
      await onMerge(selectedHead, heads);
    } finally {
      setMerging(null);
    }
  };

  return (
    <section className="border border-amber-200 bg-amber-50 rounded-lg p-4 mb-4">
      <h2 className="text-sm font-bold text-amber-800 mb-2">{t('conflict.title')}</h2>
      <p className="text-xs text-amber-700 mb-3">{t('conflict.subtitle')}</p>
      <div className="grid grid-cols-2 gap-4">
        {heads.map((head) => {
          const isCurrent = head.id === current.id;
          const isMerging = merging === head.id;
          const buttonClass = isCurrent
            ? 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-600'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:bg-slate-100';
          return (
            <div
              key={head.id}
              className={`rounded p-3 border ${
                isCurrent ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">{t('conflict.author')}</span>
                <span className="text-xs text-slate-500 truncate">{head.authorId}</span>
              </div>
              <div className="mb-2">
                <span className="text-xs font-medium text-slate-600 block">{t('conflict.time')}</span>
                <span className="text-xs text-slate-500">{formatTime(head.hlc)}</span>
              </div>
              <div className="mb-3">
                <span className="text-xs font-medium text-slate-600 block">{t('conflict.payload')}</span>
                <pre className="text-[10px] text-slate-600 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(head.payload, null, 2)}</pre>
              </div>
              <button
                onClick={() => void handleMerge(head)}
                disabled={isMerging}
                className={`w-full py-1.5 rounded text-sm transition-colors disabled:opacity-50 ${buttonClass}`}
              >
                {isCurrent
                  ? t('conflict.current')
                  : isMerging
                    ? t('conflict.merging')
                    : t('conflict.useThis')}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
