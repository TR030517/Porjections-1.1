import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { isMerchant, useAuthStore } from '../stores/authStore';
import { restoreSession } from '../api/client';
import { merchantLoginHref } from '../utils/loginNavigation';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { initialized, token, merchant } = useAuthStore();
  const location = useLocation();
  useEffect(() => { if (!initialized) void restoreSession(); }, [initialized]);
  if (!initialized) return <div style={{ padding: 48, textAlign: 'center' }}><Spin tip="正在恢复登录…" /></div>;
  if (!token || !isMerchant(merchant)) return <Navigate to={merchantLoginHref(location.pathname, location.search, location.hash)} replace />;
  return <>{children}</>;
}
