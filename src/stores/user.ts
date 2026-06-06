import { useState, useEffect } from 'react';
import { Role } from '../utils/roleEnum';

class UserStore {
  private listeners = new Set<() => void>();
  private _currentRole: Role = Role.SUPER_ADMIN; // Defaults to SUPER_ADMIN so user starts with full view

  get state() {
    return {
      currentRole: this._currentRole
    };
  }

  get currentRole(): Role {
    return this._currentRole;
  }

  set currentRole(role: Role) {
    this._currentRole = role;
    this.notify();
  }

  // Getters
  get isSuperAdmin(): boolean {
    return this._currentRole === Role.SUPER_ADMIN;
  }

  get isPlatformAdmin(): boolean {
    return this._currentRole === Role.PLATFORM_ADMIN;
  }

  get isStoreManager(): boolean {
    return this._currentRole === Role.STORE_MANAGER;
  }

  get label(): string {
    switch (this._currentRole) {
      case Role.SUPER_ADMIN:
        return '最高系统管理员';
      case Role.PLATFORM_ADMIN:
        return '主要后台管理员';
      case Role.STORE_MANAGER:
        return '商家管理员';
      case Role.USER:
        return '普通C端用户(不可登入)';
      default:
        return '未知角色';
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach(listener => listener());
  }
}

export const userStore = new UserStore();

// React Hook to seamlessly tap into the store with live updates
export function useUserStore() {
  const [role, setRole] = useState(userStore.currentRole);

  useEffect(() => {
    return userStore.subscribe(() => {
      setRole(userStore.currentRole);
    });
  }, []);

  return {
    currentRole: role,
    setCurrentRole: (r: Role) => {
      userStore.currentRole = r;
    },
    isSuperAdmin: userStore.isSuperAdmin,
    isPlatformAdmin: userStore.isPlatformAdmin,
    isStoreManager: userStore.isStoreManager,
    roleLabel: userStore.label
  };
}
