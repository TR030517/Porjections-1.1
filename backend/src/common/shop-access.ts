import { Prisma } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

export const STAFF_PERMISSIONS = ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE', 'RESERVATION_CONFIG', 'FINANCE_READ'] as const;
export const SHOP_PERMISSIONS = [...STAFF_PERMISSIONS, 'SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'] as const;
export type ShopPermission = typeof SHOP_PERMISSIONS[number];
export type ShopActor = { id: string; role: string };
export function shopAccessId(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new BadRequestException('无效的账户或门店ID');
  return BigInt(value);
}
function permissions(value: unknown, allowed: readonly string[]): ShopPermission[] {
  if (!Array.isArray(value) || value.length > allowed.length || value.some(item => !allowed.includes(item)) || new Set(value).size !== value.length) throw new BadRequestException('权限包含无效或重复项目');
  if (['BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE'].some(permission => value.includes(permission)) && !value.includes('BOOKINGS_READ')) throw new BadRequestException('预约处理、收款或退款权限必须同时授予查看预约权限');
  // COPY_CONFIG is deliberately independent. It permits only the explicit
  // copy workflows; those workflows never copy or edit address, phone, owner,
  // staff, bookings, ledger or payment data. Catalog/add-on copies add their
  // own content permissions in the copy service.
  return SHOP_PERMISSIONS.filter(permission => value.includes(permission));
}
export function staffPermissions(value: unknown): ShopPermission[] { return permissions(value, STAFF_PERMISSIONS); }
export function accountPermissions(value: unknown): ShopPermission[] { return permissions(value, SHOP_PERMISSIONS); }
export function activeShopAccount(user: any): boolean { return user?.role === 'MERCHANT' && user.status === 'ACTIVE' && !user.deletedAt; }
const activeUser = { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null };
const accountInclude = { user: { select: { role: true, status: true, deletedAt: true } } };

/** Write callers hold the target shop mutex. Binding/grant changes use the same
 * mutex. Historical ownerId is never a login authorization. */
export async function requireShopAccess(db: any, shopId: bigint, actor: ShopActor, permission: ShopPermission | 'OWNER_ONLY', options: { write?: boolean } = {}) {
  if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException('没有此门店操作权限');
  const userId = shopAccessId(actor.id);
  let operator = await db.user.findFirst({ where: { id: userId, role: actor.role, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
  if (!operator) throw new ForbiddenException('操作账户不可用');
  let shop = await db.shop.findFirst({ where: { id: shopId, deletedAt: null }, include: { owner: { select: { role: true, status: true, deletedAt: true } }, loginBinding: { include: accountInclude } } });
  if (!shop) throw new NotFoundException('门店不存在');
  if (options.write) {
    // The caller already holds target shop FOR UPDATE. Associated writes also
    // keep the source shop current while its status is checked. Transactions
    // retry database deadlocks; reads deliberately do not acquire these locks.
    const hint = actor.role === 'MERCHANT' && shop.loginBinding?.userId !== userId
      ? await db.shopAccountGrant.findFirst({where:{targetShopId:shopId,status:'ACTIVE',sourceShop:{loginBinding:{is:{userId}}}},select:{sourceShopId:true}}) : null;
    if (hint) await db.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${hint.sourceShopId} FOR SHARE`);
    const accounts = [...new Set<bigint>([userId,...(shop.loginBinding ? [shop.loginBinding.userId] : [])])].sort((a,b)=>a<b?-1:1);
    for (const id of accounts) await db.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${id} FOR UPDATE`);
    operator = await db.user.findFirst({where:{id:userId,role:actor.role,status:'ACTIVE',deletedAt:null},select:{id:true}});
    if (!operator) throw new ForbiddenException('操作账户不可用');
    shop = await db.shop.findFirst({where:{id:shopId,deletedAt:null},include:{owner:{select:{role:true,status:true,deletedAt:true}},loginBinding:{include:accountInclude}}});
    if (!shop) throw new NotFoundException('门店不存在');
  }
  if (actor.role === 'ADMIN') return { shop, isOwner: true, accessType: 'ADMIN', homeShopId: null, permissions: [...SHOP_PERMISSIONS] };
  if (!activeShopAccount(shop.loginBinding?.user)) throw new ForbiddenException('门店独立经营账户未绑定或不可用');
  if (actor.role === 'MERCHANT' && shop.loginBinding.userId === userId) return { shop, isOwner: true, accessType: 'OWN', homeShopId: shop.id.toString(), permissions: [...SHOP_PERMISSIONS] };
  if (permission === 'OWNER_ONLY') throw new ForbiddenException('仅本店经营账号或公司管理员可执行此操作');
  if (actor.role === 'MERCHANT') {
    const grant = await db.shopAccountGrant.findFirst({ where: { targetShopId: shopId, status: 'ACTIVE', sourceShop: { deletedAt: null, status: { not: 'SUSPENDED' }, loginBinding: { is: { userId, user: activeUser } } } }, include: { sourceShop: { include: { loginBinding: { include: accountInclude } } } } });
    let granted: ShopPermission[] = [];
    try { if (grant && shop.status !== 'SUSPENDED') granted = accountPermissions(grant.permissions); } catch { /* Corrupt grants fail closed. */ }
    if (!granted.includes(permission)) throw new ForbiddenException('未获公司授权执行关联门店的此项操作');
    return { shop, isOwner: false, accessType: 'ASSOCIATED', homeShopId: grant.sourceShopId.toString(), permissions: granted };
  }
  const grant = await db.shopStaffGrant.findUnique({ where: { shopId_userId: { shopId, userId } } });
  let granted: ShopPermission[] = [];
  try { if (grant?.status === 'ACTIVE') granted = staffPermissions(grant.permissions); } catch { /* Corrupt grants fail closed. */ }
  if (!granted.includes(permission)) throw new ForbiddenException('未获授权执行此门店职能');
  return { shop, isOwner: false, accessType: 'STAFF', homeShopId: null, permissions: granted };
}

/** Read predicates mirror direct checks; no transitive or employee inheritance. */
export function shopAccessWhere(actor: ShopActor, permission: ShopPermission): any {
  const userId = shopAccessId(actor?.id);
  if (actor.role === 'ADMIN') return { deletedAt: null };
  const base = { deletedAt: null, loginBinding: { is: { user: activeUser } } };
  if (actor.role === 'MERCHANT') return { ...base, OR: [
    { loginBinding: { is: { userId, user: activeUser } } },
    { status: { not: 'SUSPENDED' }, incomingAccountGrants: { some: { status: 'ACTIVE', permissions: { array_contains: permission }, sourceShop: { deletedAt: null, status: { not: 'SUSPENDED' }, loginBinding: { is: { userId, user: activeUser } } } } } },
  ] };
  if (actor.role === 'STAFF' && STAFF_PERMISSIONS.includes(permission as any)) return { ...base, staffGrants: { some: { userId, status: 'ACTIVE', permissions: { array_contains: permission }, user: { role: 'STAFF', status: 'ACTIVE', deletedAt: null } } } };
  throw new ForbiddenException('没有门店访问权限');
}
