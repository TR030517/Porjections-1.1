import type { BookingSetupIssue } from '../../../src/utils/bookingSetup';
import type { ShopPermission } from './shopPermissions';
import { reservationEntryHref } from './entryNavigation';
import { projectWorkspaceHref } from './projectWorkspace';

/** Saved-config actions stay in the explicit shop and use the permission of their destination. */
export function bookingSetupEntry(shopId: string, issue: BookingSetupIssue): { permission: ShopPermission; href?: string; message?: string } {
  const valid = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
  if (!valid(shopId)) throw Error('请重新选择有效的本店工作区。');
  const query = new URLSearchParams({ shopId });
  if (issue.kind === 'activation') {
    if (!valid(issue.serviceId)) return { permission: 'CATALOG_MANAGE', message: '未能定位关联主项目，请刷新本店摘要后再试。' };
    return { permission: 'CATALOG_MANAGE', href: projectWorkspaceHref(shopId, issue.serviceId, 'metadata') };
  }
  if (issue.kind === 'staff') return { permission: 'CATALOG_MANAGE', href: '/technicians?' + query };
  if (issue.kind === 'timezone' || issue.key === 'timezone') return { permission: 'RESERVATION_CONFIG', message: '门店时区须由公司管理员在门店基本资料中确认。当前价目草稿已保留。' };
  if (issue.kind === 'hours') {
    query.set('tab', 'hours'); return { permission: 'RESERVATION_CONFIG', href: '/reservations?' + query };
  }
  if (issue.kind === 'room') { query.set('tab', 'rooms'); return { permission: 'RESERVATION_CONFIG', href: '/reservations?' + query }; }
  if (issue.kind === 'schedule') return valid(issue.therapistId)
    ? { permission: 'RESERVATION_CONFIG', href: reservationEntryHref(shopId, 'therapists', issue.therapistId) }
    : { permission: 'RESERVATION_CONFIG', message: '未能定位相关技师，请刷新本店团队与排班摘要后核对；不会自动打开其他技师。' };
  return valid(issue.serviceId)
    ? { permission: 'RESERVATION_CONFIG', href: reservationEntryHref(shopId, 'services', issue.serviceId) }
    : { permission: 'RESERVATION_CONFIG', message: '未能定位关联主项目，请刷新本店摘要后再试。' };
}
