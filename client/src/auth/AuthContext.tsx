import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, login as apiLogin, logout as apiLogout, refreshSession, setSessionEndHandler, setToken, type Me } from '../api/client';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    setSessionEndHandler(() => {
      setToken(null);
      setUser(null);
      qc.clear();
    });
    refreshSession()
      .then((r) => setUser(r?.user ?? null))
      .finally(() => setLoading(false));
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiLogin(email, password);
    qc.clear();
    setUser(r.user);
  }, [qc]);

  const logout = useCallback(async () => {
    await apiLogout();
    qc.clear();
    setUser(null);
  }, [qc]);

  const reload = useCallback(async () => setUser(await api.get<Me>('/me')), []);

  const value = useMemo<AuthState>(() => ({ user, loading, login, logout, reload, can: (p) => !!user?.permissions.includes(p) }), [user, loading, login, logout, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
