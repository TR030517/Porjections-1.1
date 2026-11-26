import { create } from 'zustand';

export interface MerchantUser {
  id: string;
  name?: string;
  loginName?: string | null;
  email?: string;
  role?: string;
  roles?: string[];
}
export function isMerchant(user: MerchantUser | null): boolean {
  return !!user && (user.role === 'MERCHANT' || user.role === 'STAFF' || user.role === 'ADMIN');
}
interface AuthState {
  token: string | null;
  merchant: MerchantUser | null;
  initialized: boolean;
  // A temporary refresh failure may retain only an unverified copy marker.
  // Explicit sign-out and a rejected or mismatched identity must clear it.
  explicitLogout: boolean;
  setAuth: (token: string, user: MerchantUser) => void;
  logout: (options?: { preservePendingRecovery?: boolean }) => void;
}
// Remove credentials from the earlier persistent-token implementation.
try {
  localStorage.removeItem('merchant_token');
  localStorage.removeItem('merchant_info');
} catch { /* Sessions work when browser storage is disabled. */ }
export const useAuthStore = create<AuthState>((set) => ({
  token: null, merchant: null, initialized: false, explicitLogout: false,
  setAuth: (token, merchant) => {
    if (!token || !isMerchant(merchant)) throw new Error('当前账号没有商家后台权限。');
    set({ token, merchant: { ...merchant, id: String(merchant.id) }, initialized: true, explicitLogout: false });
  },
  logout: (options) => set({ token: null, merchant: null, initialized: true, explicitLogout: !options?.preservePendingRecovery }),
}));
