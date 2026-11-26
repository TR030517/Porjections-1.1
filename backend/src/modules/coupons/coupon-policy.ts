import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
export function couponData(dto: any, existing?: any) {
    // One wallet row per user/coupon is the current schema contract. Multiple
    // vouchers require a separate migration, not a misleading numeric setting.
    if (dto.perUserLimit !== undefined && dto.perUserLimit !== 1) throw new BadRequestException('当前每位顾客每张优惠券限领1次');
    const value = {
      title: dto.title !== undefined ? dto.title : existing?.title,
      description: dto.description !== undefined ? dto.description || null : existing?.description || null,
      type: dto.type !== undefined ? dto.type : existing?.type,
      value: dto.value !== undefined ? dto.value : existing?.value,
      minSpendCents: dto.minSpendCents !== undefined ? dto.minSpendCents : existing?.minSpendCents ?? 0,
      totalQuantity: dto.totalQuantity !== undefined ? dto.totalQuantity : existing?.totalQuantity ?? 0,
      perUserLimit: 1,
      validFrom: dto.validFrom !== undefined ? new Date(dto.validFrom) : existing?.validFrom ?? new Date(),
      validUntil: dto.validUntil !== undefined ? dto.validUntil ? new Date(dto.validUntil) : null : existing?.validUntil ?? null,
      status: dto.status !== undefined ? dto.status : existing?.status ?? 'ACTIVE',
    };
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) throw new BadRequestException('Title is required (maximum 200 characters)');
    value.title = value.title.trim();
    if (!['FIXED_AMOUNT', 'PERCENT'].includes(value.type)) throw new BadRequestException('Invalid coupon type');
    for (const [name, minimum] of [['value', 1], ['minSpendCents', 0], ['totalQuantity', 0], ['perUserLimit', 1]] as const) {
      if (!Number.isInteger(value[name]) || value[name] < minimum || value[name] > 2147483647) throw new BadRequestException(`Invalid ${name}`);
    }
    if (value.type === 'PERCENT' && value.value > 100) throw new BadRequestException('Percent cannot exceed 100');
    if (!['DRAFT', 'ACTIVE', 'PAUSED'].includes(value.status)) throw new BadRequestException('Invalid status');
    if (!Number.isFinite(value.validFrom.getTime()) || (value.validUntil && (!Number.isFinite(value.validUntil.getTime()) || value.validUntil <= value.validFrom))) throw new BadRequestException('Invalid validity window');
    return value;
  }

/** All management endpoints and claiming lock the coupon before inspecting its mutable terms. */
export async function updateCouponInTransaction(tx: Prisma.TransactionClient, id: bigint, dto: any, shopId?: bigint) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM coupons WHERE id = ${id} FOR UPDATE`);
  const existing = await tx.coupon.findFirst({ where: { id, ...(shopId !== undefined ? { shopId } : {}), deletedAt: null } });
  if (!existing) throw new NotFoundException('Coupon not found');
  if (dto.shopId !== undefined && dto.shopId !== null && (typeof dto.shopId !== 'string' || !/^[1-9]\d{0,18}$/.test(dto.shopId) || BigInt(dto.shopId) > 9223372036854775807n)) throw new BadRequestException('Invalid shop ID');
  const data = couponData(dto, existing);
  const claimed = Math.max(existing.claimedCount, await tx.userCoupon.count({ where: { couponId: id } }));
  if (claimed > 0) {
    // Preserve an issued legacy rule verbatim when callers omit it. Its actual
    // claim limit is separately enforced as one; a pause/title edit must not
    // silently rewrite historical terms or wallet records.
    if (existing.perUserLimit !== 1) {
      if (dto.perUserLimit !== undefined) throw new ConflictException('Claimed coupon terms cannot be changed; create a new coupon');
      data.perUserLimit = existing.perUserLimit;
    }
    const changed = data.type !== existing.type || data.value !== existing.value || data.minSpendCents !== existing.minSpendCents ||
      data.validFrom.getTime() !== existing.validFrom.getTime() ||
      (data.validUntil?.getTime() ?? null) !== (existing.validUntil?.getTime() ?? null) ||
      (dto.shopId !== undefined && (dto.shopId === null ? null : BigInt(dto.shopId)) !== existing.shopId);
    if (changed) throw new ConflictException('Claimed coupon terms cannot be changed; create a new coupon');
  }
  // Zero explicitly means unlimited, not an allocation of zero vouchers.
  if (data.totalQuantity > 0 && data.totalQuantity < claimed) throw new ConflictException('Quantity cannot be below the number already claimed');
  if (dto.shopId !== undefined && (dto.shopId === null ? null : BigInt(dto.shopId)) !== existing.shopId) throw new BadRequestException('Coupon shop cannot be reassigned; create a new coupon');
  return tx.coupon.update({ where: { id }, data: { ...data, claimedCount: claimed }, include: { shop: { select: { id: true, name: true } } } });
}
