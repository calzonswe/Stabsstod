import { createBrowserRouter, Navigate, Outlet, RouterProvider, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { AuthProvider, useAuth, RequireAdmin } from './contexts/AuthContext.js';
import Login from './pages/Login.js';
import ChangePassword from './pages/ChangePassword.js';
import Incidents from './pages/Incidents.js';
import CreateIncident from './pages/CreateIncident.js';
import IncidentDetail from './pages/IncidentDetail.js';
import Users from './pages/Users.js';
import Settings from './pages/Settings.js';

function Layout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const switchLang = () => i18n.changeLanguage(i18n.language === 'sv' ? 'en' : 'sv');

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link to="/" className="font-semibold text-slate-900">
            {t('app.name')}
          </Link>
          <div className="flex items-center gap-2">
            <nav className="hidden md:flex items-center gap-4">
              <Link
                to="/"
                className={`text-sm ${
                  window.location.pathname === '/'
                    ? 'text-indigo-600 font-medium'
                    : 'text-slate-600 hover:text-indigo-600'
                }`}
              >
                {t('nav.home')}
              </Link>
              {user?.role === 'admin' && (
                <>
                  <Link
                    to="/users"
                    className={`text-sm ${
                      window.location.pathname === '/users'
                        ? 'text-indigo-600 font-medium'
                        : 'text-slate-600 hover:text-indigo-600'
                    }`}
                  >
                    {t('nav.users')}
                  </Link>
                  <Link
                    to="/settings"
                    className={`text-sm ${
                      window.location.pathname === '/settings'
                        ? 'text-indigo-600 font-medium'
                        : 'text-slate-600 hover:text-indigo-600'
                    }`}
                  >
                    {t('nav.settings')}
                  </Link>
                  <Link
                    to="/incidents"
                    className={`text-sm ${
                      window.location.pathname === '/incidents'
                        ? 'text-indigo-600 font-medium'
                        : 'text-slate-600 hover:text-indigo-600'
                    }`}
                  >
                    {t('nav.incidents')}
                  </Link>
                </>
              )}
            </nav>
            {user ? (
              <>
                <span className="hidden md:block text-sm text-slate-600">{user.username}</span>
                <button
                  onClick={() => {
                    void logout();
                  }}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 transition-colors"
                >
                  {t('auth.nav.logout')}
                </button>
              </>
            ) : null}
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return null;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const router = useMemo(
    () =>
      createBrowserRouter([
        {
          path: '/login',
          element: <Login />,
        },
        {
          path: '/change-password',
          element: (
            <RequireAuth>
              <ChangePassword />
            </RequireAuth>
          ),
        },
        {
          path: '/',
          element: (
            <RequireAuth>
              <Layout />
            </RequireAuth>
          ),
          children: [
            { index: true, element: <Home /> },
            {
              path: 'users',
              element: (
                <RequireAdmin>
                  <Users />
                </RequireAdmin>
              ),
            },
            {
              path: 'settings',
              element: (
                <RequireAdmin>
                  <Settings />
                </RequireAdmin>
              ),
            },
            {
              path: 'incidents',
              element: (
                <RequireAuth>
                  <Incidents />
                </RequireAuth>
              ),
            },
            {
              path: 'incidents/create',
              element: (
                <RequireAdmin>
                  <CreateIncident />
                </RequireAdmin>
              ),
            },
            {
              path: 'incidents/:id',
              element: (
                <RequireAuth>
                  <IncidentDetail />
                </RequireAuth>
              ),
            },
          ],
        },
      ]),
    [],
  );

  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
