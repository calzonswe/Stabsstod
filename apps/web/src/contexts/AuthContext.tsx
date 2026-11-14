import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, newPassword: string) => Promise<void>;
  isAuthenticated: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

// Offline-first session: the last server-verified user is persisted so the
// app stays signed in across reloads while the network is down (the M13
// smoke test depends on this).
const AUTH_STORAGE_KEY = 'stabsstod-auth-user';

function readStoredUser(): AuthUser | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null') as
      | Partial<AuthUser>
      | null;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.username !== 'string') {
      return null;
    }
    return {
      id: parsed.id,
      username: parsed.username,
      role: parsed.role === 'user' ? 'user' : 'admin',
      mustChangePassword: parsed.mustChangePassword === true,
    };
  } catch {
    return null;
  }
}

function persistUser(user: AuthUser | null): void {
  try {
    if (user) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (quota, private mode) — in-memory session only.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchMe();
  }, []);

  async function fetchMe() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        persistUser(data.user);
      } else {
        // The server says we are signed out (expired or invalid session).
        setUser(null);
        persistUser(null);
      }
    } catch {
      // Offline (or transient network error): keep the last known session so
      // the app remains usable after a reload while the network is down.
      setUser(readStoredUser());
    } finally {
      setLoading(false);
    }
  }

  async function login(username: string, password: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      throw new Error('login failed');
    }
    const data = await res.json();
    setUser(data.user);
    persistUser(data.user);
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Offline: server-side cleanup is best-effort; the local session is
      // cleared regardless.
    }
    setUser(null);
    persistUser(null);
  }

  async function changePassword(current: string, newPassword: string) {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword }),
    });
    if (!res.ok) {
      throw new Error('change password failed');
    }
    if (user) {
      const updated: AuthUser = { ...user, mustChangePassword: false };
      setUser(updated);
      persistUser(updated);
    }
  }

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    changePassword,
    isAuthenticated: () => !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return null;
  }
  if (!user || user.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">403 — Forbidden</h1>
        <p className="text-slate-600">Administrator access is required for this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
