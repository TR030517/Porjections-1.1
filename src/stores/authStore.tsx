import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { loginWithAdminPassword, logoutSession, restoreSession, SessionUser, subscribeSession } from '../api/session';
import { userStore } from './user';
import { shopStore } from './shop';
import { Role } from '../utils/roleEnum';
import { syncAdminCopySession } from './adminCopyStore';
export { Role };
interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  error: string;
  currentRole: Role;
  roleLabel: string;
  isSuperAdmin: boolean;
  isPlatformAdmin: boolean;
  isStoreManager: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(false), operation = useRef(0);
  const current = (version: number) => mounted.current && version === operation.current;
  const acceptProfile = (next: SessionUser | null, reason?: string) => {
    if (!mounted.current) return;
    syncAdminCopySession(next); setUser(next); userStore.setProfile(next);
    if (!next) shopStore.currentStoreId = null;
    setError(reason || '');
  };
  const restore = async () => {
    if (!mounted.current) return;
    const version = ++operation.current;
    setLoading(true); setError('');
    try { const next = await restoreSession('ADMIN'); if (current(version)) acceptProfile(next); }
    catch (err) { if (current(version) && !(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : '会话恢复失败，请重试。'); }
    finally { if (current(version)) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeSession(acceptProfile);
    void restore();
    return () => { mounted.current = false; ++operation.current; unsubscribe(); };
  }, []);
  const currentRole = userStore.currentRole;
  return <AuthContext.Provider value={{
    user, loading, error, currentRole, roleLabel: userStore.label,
    isSuperAdmin: currentRole === Role.SUPER_ADMIN, isPlatformAdmin: false,
    isStoreManager: currentRole === Role.STORE_MANAGER,
    login: async (identifier, password) => {
      if (!mounted.current) return;
      const version = ++operation.current; setError('');
      try { await loginWithAdminPassword(identifier, password); }
      finally { if (current(version)) setLoading(false); }
    },
    logout: async () => {
      if (!mounted.current) return;
      const version = ++operation.current;
      setLoading(true);
      try { await logoutSession(); }
      catch (err) { if (current(version)) setError(err instanceof Error ? '已退出当前页面；服务器注销失败：' + err.message : '服务器注销失败，请重试。'); }
      finally { if (current(version)) setLoading(false); }
    },
    restore,
  }}>{children}</AuthContext.Provider>;
}
export function useAuthStore() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthStore must be used within AuthProvider');
  return context;
}
