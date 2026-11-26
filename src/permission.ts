import { Role } from './utils/roleEnum';
import { userStore } from './stores/user';
import { ViewId } from './types';
export const PLATFORM_ONLY_VIEWS: ViewId[] = ['banner-list', 'notification-operations', 'audit-logs', 'admin-list', 'merchant-list', 'role-management', 'package-management', 'platform-settings', 'user-list', 'area-management', 'industries', 'help-list', 'store-application'];
export function canAccessView(role: Role, view: ViewId): boolean {
  if (role === Role.SUPER_ADMIN) return true;
  return false;
}
export function checkRoutePermission(view: ViewId, redirect: (fallback: ViewId) => void) {
  const allowed = canAccessView(userStore.currentRole, view);
  if (!allowed) redirect('dashboard');
  return allowed;
}
