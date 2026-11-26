import { useSyncExternalStore } from 'react';
import { SessionUser } from '../api/session';
import { Role } from '../utils/roleEnum';
class UserStore {
  private listeners = new Set<() => void>();
  private role = Role.USER;
  get currentRole() { return this.role; }
  get isSuperAdmin() { return this.role === Role.SUPER_ADMIN; }
  get isPlatformAdmin() { return false; }
  get isStoreManager() { return this.role === Role.STORE_MANAGER; }
  get label() { return this.isSuperAdmin ? '平台管理员' : this.isStoreManager ? '门店管理员' : '无管理权限'; }
  setProfile(user: SessionUser | null) {
    this.role = user?.role === 'ADMIN' ? Role.SUPER_ADMIN : user?.role === 'MERCHANT' ? Role.STORE_MANAGER : Role.USER;
    this.listeners.forEach(listener => listener());
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
}
export const userStore = new UserStore();
export function useUserStore() {
  const currentRole = useSyncExternalStore(userStore.subscribe, () => userStore.currentRole);
  return { currentRole, isSuperAdmin: userStore.isSuperAdmin, isPlatformAdmin: false, isStoreManager: userStore.isStoreManager, roleLabel: userStore.label };
}