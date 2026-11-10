import { createBrowserRouter, Outlet, RouterProvider, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';

function Layout() {
  const { t, i18n } = useTranslation();
  const switchLang = () => i18n.changeLanguage(i18n.language === 'sv' ? 'en' : 'sv');

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link to="/" className="font-semibold text-slate-900">
            {t('app.name')}
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={switchLang}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 transition-colors"
            >
              {t('lang.current')} → {t('lang.switch')}
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto py-6">
        <Outlet />
      </main>
    </div>
  );
}

function Home() {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold text-slate-900">{t('home.title')}</h1>
      <p className="mt-2 text-slate-600">{t('home.subtitle')}</p>
    </div>
  );
}

export default function App() {
  const router = useMemo(
    () =>
      createBrowserRouter([
        {
          path: '/',
          element: <Layout />,
          children: [{ index: true, element: <Home /> }],
        },
      ]),
    [],
  );

  return <RouterProvider router={router} />;
}
