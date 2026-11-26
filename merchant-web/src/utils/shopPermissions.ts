export const shopPermissions = ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE', 'RESERVATION_CONFIG', 'FINANCE_READ', 'SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'] as const;
export type ShopPermission = typeof shopPermissions[number];
export const staffPermissions = shopPermissions.filter(permission => !['SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'].includes(permission));
export const permissionLabels: Record<ShopPermission, string> = {
  BOOKINGS_READ: '查看预约', BOOKINGS_MANAGE: '接受、改期与完成预约',
  SETTLEMENT_RECORD: '登记已实际收到的收款', REFUNDS_MANAGE: '退款与收款冲正',
  RESERVATION_CONFIG: '预约资源与排班', FINANCE_READ: '门店财务报表与CSV',
  SHOP_SETTINGS_MANAGE: '门店资料', CATALOG_MANAGE: '服务与技师', COPY_CONFIG: '快捷复制营业时间/展示价目',
};
export function hasShopPermission(shop: { isOwner?: boolean; accessType?: string; permissions?: string[] } | null | undefined, permission: ShopPermission | 'OWNER_ONLY'): boolean {
  if (!shop) return false;
  if (permission === 'OWNER_ONLY') return shop.isOwner === true && (shop.accessType === 'OWN' || shop.accessType === 'ADMIN');
  return shop.permissions?.includes(permission) === true;
}
export function initialShopRoute(shop: { isOwner?: boolean; accessType?: string; permissions?: string[] } | null | undefined): string | null {
  if (hasShopPermission(shop, 'FINANCE_READ')) return '/dashboard';
  if (hasShopPermission(shop, 'BOOKINGS_READ')) return '/bookings';
  if (hasShopPermission(shop, 'RESERVATION_CONFIG')) return '/reservations';
  if (hasShopPermission(shop, 'CATALOG_MANAGE')) return '/price-menu';
  if (hasShopPermission(shop, 'SHOP_SETTINGS_MANAGE')) return '/settings';
  if (hasShopPermission(shop, 'COPY_CONFIG')) return '/copy-config';
  return null;
}
export function withBookingRead(permissions: ShopPermission[]): ShopPermission[] {
  const next = new Set(permissions);
  if (['BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE'].some(permission => next.has(permission as ShopPermission))) next.add('BOOKINGS_READ');
  return staffPermissions.filter(permission => next.has(permission));
}
