import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { shopFeatures } from './shop-features';

/** Visibility is a trading eligibility boundary, separate from management access.
 * Existing authorized refunds/support/history deliberately do not use this filter. */
export function publicShopWhere(): Prisma.ShopWhereInput {
  return { status: 'APPROVED', deletedAt: null };
}

/** Fixed SQL fragment for the public listing's `s` alias. Never interpolate input. */
export const PUBLIC_SHOP_SQL = "s.status = 'APPROVED' AND s.deleted_at IS NULL";

/** IDs eligible for public display, independent of whether a store login is enabled. */
export async function publicShopIds(db: any, shopIds?: readonly (bigint | string)[]): Promise<bigint[]> {
  if (shopIds && shopIds.length === 0) return [];
  const scope = shopIds ? Prisma.sql`AND s.id IN (${Prisma.join(shopIds.map(id => BigInt(id)))})` : Prisma.empty;
  const rows = await db.$queryRaw(Prisma.sql`SELECT s.id FROM shops s WHERE ${Prisma.raw(PUBLIC_SHOP_SQL)} ${scope}`);
  return rows.map((row: { id: bigint | string }) => typeof row.id === 'bigint' ? row.id : BigInt(row.id));
}

export function shopEligibility(shop: any, _loginReady = true) {
  const publicVisible = !!shop && shop.status === 'APPROVED' && !shop.deletedAt;
  const newBookingAllowed = publicVisible && shopFeatures(shop?.studioProfile).onlineBooking;
  return { publicVisible, newBookingAllowed, reason: !publicVisible ? 'SHOP_UNAVAILABLE' : !newBookingAllowed ? 'ONLINE_BOOKING_DISABLED' : null };
}

export function assertPublicShop(shop: any, options: { forBooking?: boolean } = {}) {
  const eligibility = shopEligibility(shop);
  // Do not reveal whether the owner, review, deletion or account status failed.
  if (!eligibility.publicVisible) throw new NotFoundException('Shop unavailable');
  if (options.forBooking && !eligibility.newBookingAllowed) throw new BadRequestException('Online booking is unavailable for this shop');
  return shop;
}

/** For a new booking call inside the existing shop-first READ COMMITTED write
 * transaction, after locking shops. Owner lock + reread serializes disabling an
 * owner with final acceptance. forBooking is intentionally not a history gate.
 * Other new-value transactions (coupon claims/gift orders) pass lockOwner:true. */
export async function requirePublicShop(db: any, shopId: bigint | string, options: { forBooking?: boolean; lockOwner?: boolean } = {}) {
  const id = typeof shopId === 'bigint' ? shopId : BigInt(shopId);
  const account = { id: true, role: true, status: true, deletedAt: true, loginName: true, email: true, phone: true, passwordHash: true };
  const include = { owner: { select: { role: true, status: true, deletedAt: true } }, loginBinding: { include: { user: { select: account } } } };
  let shop = await db.shop.findUnique({ where: { id }, include });
  if (shop && (options.forBooking || options.lockOwner)) {
    for (const userId of [...new Set<bigint>([...(shop.loginBinding ? [shop.loginBinding.userId] : [])])].sort((a,b)=>a<b?-1:1)) await db.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    shop = await db.shop.findUnique({ where: { id }, include });
  }
  const eligible = assertPublicShop(shop, options);
  return eligible;
}
