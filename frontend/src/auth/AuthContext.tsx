import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import {
  clearApiSession,
  getApiSession,
  logoutApiSession,
  refreshApiSession,
  setApiSession,
  subscribeApiSession,
  type SessionSubject,
} from '../api/client';
import type { AuthIdentity } from '../types';

const SUBJECT_KEY = 'medsoft_session_subject';

interface InitialSession {
  identity: AuthIdentity;
  accessToken: string;
  accessTokenExpiresIn: number;
}

interface AuthContextValue {
  identity: AuthIdentity | null;
  isRestoring: boolean;
  loginUser: (username: string, password: string) => Promise<void>;
  loginAdmin: (password: string, totpCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function subjectPreference(): SessionSubject[] {
  const preferred = sessionStorage.getItem(SUBJECT_KEY);
  return preferred === 'user' ? ['user', 'admin'] : ['admin', 'user'];
}

export function AuthProvider({ children, initialSession, restoreSession = true }: { children: ReactNode; initialSession?: InitialSession; restoreSession?: boolean }) {
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<AuthIdentity | null>(initialSession?.identity ?? null);
  const [isRestoring, setIsRestoring] = useState(!initialSession && restoreSession);
  const [sessionRevision, setSessionRevision] = useState(0);

  useEffect(() => subscribeApiSession((session) => {
    setSessionRevision((value) => value + 1);
    if (!session) {
      setIdentity(null);
      sessionStorage.removeItem(SUBJECT_KEY);
      queryClient.clear();
    }
  }), [queryClient]);

  useEffect(() => {
    if (initialSession) {
      setApiSession(
        initialSession.identity.subjectType,
        initialSession.accessToken,
        initialSession.accessTokenExpiresIn,
      );
      sessionStorage.setItem(SUBJECT_KEY, initialSession.identity.subjectType);
      setIsRestoring(false);
      return;
    }
    if (!restoreSession) {
      clearApiSession();
      setIsRestoring(false);
      return;
    }

    let cancelled = false;
    const restore = async () => {
      for (const subjectType of subjectPreference()) {
        try {
          await refreshApiSession(subjectType);
          const principal = subjectType === 'admin'
            ? { ...(await authApi.currentAdmin()), subjectType: 'admin' as const }
            : { ...(await authApi.currentUser()), subjectType: 'user' as const };
          if (!cancelled) {
            setIdentity(principal);
            sessionStorage.setItem(SUBJECT_KEY, subjectType);
            setIsRestoring(false);
          }
          return;
        } catch {
          clearApiSession();
        }
      }
      if (!cancelled) setIsRestoring(false);
    };
    void restore();
    return () => { cancelled = true; };
  }, [initialSession, restoreSession]);

  useEffect(() => {
    if (!identity) return;
    const session = getApiSession();
    if (!session) return;
    const delay = Math.max(1_000, session.expiresAt - Date.now() - 30_000);
    const timer = window.setTimeout(() => {
      void refreshApiSession(identity.subjectType).catch(() => setIdentity(null));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [identity, sessionRevision]);

  const loginUser = useCallback(async (username: string, password: string) => {
    const principal = await authApi.loginUser(username, password);
    setIdentity(principal);
    sessionStorage.setItem(SUBJECT_KEY, 'user');
    queryClient.clear();
  }, [queryClient]);

  const loginAdmin = useCallback(async (password: string, totpCode: string) => {
    const principal = await authApi.loginAdmin(password, totpCode);
    setIdentity(principal);
    sessionStorage.setItem(SUBJECT_KEY, 'admin');
    queryClient.clear();
  }, [queryClient]);

  const logout = useCallback(async () => {
    const subjectType = identity?.subjectType ?? getApiSession()?.subjectType;
    if (subjectType) await logoutApiSession(subjectType);
    else clearApiSession();
    setIdentity(null);
    queryClient.clear();
  }, [identity, queryClient]);

  const value = useMemo<AuthContextValue>(() => ({
    identity,
    isRestoring,
    loginUser,
    loginAdmin,
    logout,
  }), [identity, isRestoring, loginUser, loginAdmin, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
