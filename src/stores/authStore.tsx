import React, { createContext, useContext, useState, useEffect } from 'react';
import { Role } from '../utils/roleEnum';
import { userStore } from './user';

export { Role };

interface AuthContextType {
  currentRole: Role;
  setCurrentRole: (role: Role) => void;
  isSuperAdmin: boolean;
  isPlatformAdmin: boolean;
  isStoreManager: boolean;
  roleLabel: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>(userStore.currentRole);

  useEffect(() => {
    // Listen to changes in userStore to ensure synchronized auth state across context
    const unsubscribe = userStore.subscribe(() => {
      setRole(userStore.currentRole);
    });
    return unsubscribe;
  }, []);

  const handleSetRole = (newRole: Role) => {
    userStore.currentRole = newRole;
    setRole(newRole);
  };

  const getLabel = (r: Role) => {
    switch (r) {
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
  };

  return (
    <AuthContext.Provider
      value={{
        currentRole: role,
        setCurrentRole: handleSetRole,
        isSuperAdmin: role === Role.SUPER_ADMIN,
        isPlatformAdmin: role === Role.PLATFORM_ADMIN,
        isStoreManager: role === Role.STORE_MANAGER,
        roleLabel: getLabel(role),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthStore() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthStore must be used within an AuthProvider');
  }
  return context;
}
