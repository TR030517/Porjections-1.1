import { hasShopPermission } from './shopPermissions';
import type { CopyKind } from '../api/accountAccess';
import { projectWorkspaceHref } from './projectWorkspace';

export function canCopyKind(shop: { permissions?: string[] } | null | undefined, kind: CopyKind): boolean {
  return hasShopPermission(shop, 'COPY_CONFIG') && (kind === 'ADD_ONS' || kind === 'PRICE_MENU'
    ? hasShopPermission(shop, 'CATALOG_MANAGE') && hasShopPermission(shop, 'RESERVATION_CONFIG')
    : kind === 'CATALOG' ? hasShopPermission(shop, 'CATALOG_MANAGE') : true);
}
export function copyKindPermissionMessage(kind: CopyKind): string {
  if (kind === 'ADD_ONS' || kind === 'PRICE_MENU') return '来源与目标门店都须具备复制配置、目录管理和预约配置权限。项目与价目将统一复制并保留预约关联，新建配置停用待复核。';
  if (kind === 'HOURS') return '来源与目标门店只需具备快捷复制权限；不会开放门店资料编辑。';
  return '来源与目标门店都须具备复制配置和目录管理权限；不会复制地址、电话、人员或订单。';
}
/** A kind change preserves only still-authorized exact choices, never a fallback shop. */
export function copyKindSelection(shops: Array<{ id: string; permissions?: string[] }>, sourceId: string, targetId: string, kind: CopyKind) {
  const source = shops.find(shop => shop.id === sourceId && canCopyKind(shop, kind));
  const target = shops.find(shop => shop.id === targetId && canCopyKind(shop, kind) && shop.id !== source?.id);
  return { sourceId: source?.id ?? '', targetId: target?.id ?? '' };
}

export type ReservationTab = 'services' | 'therapists';
function validId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
/** null means no explicit selection; an empty string means an invalid explicit ID. */
export function requestedEntryId(search: string, key: 'serviceId' | 'therapistId' | 'sourceShopId') {
  const values = new URLSearchParams(search).getAll(key);
  if (!values.length) return null;
  return values.length === 1 && validId(values[0]) ? values[0] : '';
}
export function selectEntryResource<T extends { id: string }>(items: T[], id: string | null): T | undefined {
  return id === null ? items[0] : items.find(item => item.id === id);
}
export function reservationEntryHref(shopId: string, tab: ReservationTab, resourceId: string) {
  if (!validId(shopId) || !validId(resourceId)) throw new Error('预约入口无效，请刷新门店。');
  if (tab === 'services') return projectWorkspaceHref(shopId, resourceId, 'booking');
  const query = new URLSearchParams({ shopId, tab, therapistId: resourceId });
  return '/reservations?' + query;
}
export function resolveCopyEntry(
  shops: Array<{ id: string; permissions?: string[] }>, requested: string | null, currentShopId: string | null,
) {
  const id = requested === null ? currentShopId : requested;
  const source = shops.find(shop => shop.id === id && hasShopPermission(shop, 'COPY_CONFIG'));
  return {
    sourceId: source?.id ?? '',
    kind: source && !hasShopPermission(source, 'SHOP_SETTINGS_MANAGE') && canCopyKind(source, 'PRICE_MENU') ? 'PRICE_MENU' as const : 'HOURS' as const,
    error: requested !== null && !source ? '所请求来源门店无效、不可用或没有复制权限，请明确选择已授权来源门店。' : '',
  };
}
