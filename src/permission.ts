import { Role } from './utils/roleEnum';
import { userStore } from './stores/user';
import { ViewId } from './types';

// Platform-level system management views that are restricted.
export const PLATFORM_ONLY_VIEWS: ViewId[] = [
  'admin-list',
  'merchant-list',
  'role-management',
  'package-management',
  'platform-settings',
  'user-list',
  'withdrawal-list'
];

/**
 * Checks if a given role is allowed to access a specific view.
 * - admin-list (系统管理员) is ONLY visible to SUPER_ADMIN.
 * - merchant-list (商家账号管理) is visible to SUPER_ADMIN and PLATFORM_ADMIN.
 * - STORE_MANAGER absolutely cannot access platform level system administration / platform config.
 * - USER is a customer and cannot view any admin dashboard panel.
 */
export function canAccessView(role: Role, view: ViewId): boolean {
  // USER has zero access
  if (role === Role.USER) {
    return false;
  }

  // admin-list is restricted STRICTLY to SUPER_ADMIN
  if (view === 'admin-list') {
    return role === Role.SUPER_ADMIN;
  }

  // STORE_MANAGER is strictly forbidden from platform/system administration
  if (role === Role.STORE_MANAGER) {
    if (PLATFORM_ONLY_VIEWS.includes(view)) {
      return false;
    }
  }

  // SUPER_ADMIN and PLATFORM_ADMIN have complete access to the rest
  return true;
}

/**
 * Emulated route-guard watcher for view switching in our React layout
 */
export function checkRoutePermission(toView: ViewId, onRedirect: (fallbackView: ViewId) => void): boolean {
  const role = userStore.currentRole;
  if (!canAccessView(role, toView)) {
    console.warn(`[Permission Guard] Role ${role} is NOT allowed to access view: ${toView}. Redirecting fallback.`);
    onRedirect('dashboard');
    return false;
  }
  return true;
}
