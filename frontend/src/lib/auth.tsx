import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from './api';
import type { Role, Session } from './types';

const RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, MANAGER: 2, ADMIN: 3 };

interface AuthState {
  session: Session | null;
  /** Atajo a session.user */
  user: Session['user'] | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  reload: () => Promise<void>;
  can: (minRole: Role) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const reload = useCallback(async () => {
    setSession((await api.get<Session>('/auth/me')).data);
  }, []);

  // Restaura la sesión desde la cookie httpOnly de refresh
  useEffect(() => {
    refreshSession()
      .then(async (token) => {
        if (token) await reload();
      })
      .finally(() => setLoading(false));
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setSession(null);
    });
  }, [reload]);

  const applyTokens = useCallback((data: Session & { accessToken: string }) => {
    setAccessToken(data.accessToken);
    const { user, company, role, branchIds, branches, companies } = data;
    setSession({ user, company, role, branchIds, branches, companies });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<Session & { accessToken: string }>('/auth/login', { email, password });
      applyTokens(data);
    },
    [applyTokens],
  );

  const switchCompany = useCallback(
    async (companyId: string) => {
      const { data } = await api.post<Session & { accessToken: string }>('/auth/switch-company', { companyId });
      // Los datos en caché pertenecen a la empresa anterior
      queryClient.clear();
      applyTokens(data);
    },
    [applyTokens, queryClient],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setSession(null);
    queryClient.clear();
  }, [queryClient]);

  const can = useCallback((minRole: Role) => !!session?.company && RANK[session.role] >= RANK[minRole], [session]);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading, login, logout, switchCompany, reload, can }),
    [session, loading, login, logout, switchCompany, reload, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
