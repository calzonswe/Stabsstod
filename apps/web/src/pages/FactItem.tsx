import { useTranslation } from 'react-i18next';

export default function FactItem() {
  const { t } = useTranslation();
  
  return (
    <div className="max-w-7xl mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('factItem.title')}</h1>
          <p className="text-slate-600">{t('factItem.subtitle')}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          {t('factItem.comingSoon')}
        </h2>
        <div className="text-slate-500">{t('factItem.placeholder')}</div>
      </div>
    </div>
  );
}