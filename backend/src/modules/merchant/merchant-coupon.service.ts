import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { couponData, updateCouponInTransaction } from '../coupons/coupon-policy';
import { requireShopAccess } from '../../common/shop-access';
import { configurationAudit, withShopConfiguration } from '../reservations/configuration-guard';

export class MerchantCouponDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsIn(['FIXED_AMOUNT', 'PERCENT']) type?: 'FIXED_AMOUNT' | 'PERCENT';
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) value?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) minSpendCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) totalQuantity?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1) perUserLimit?: number;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validUntil?: string | null;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'PAUSED']) status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
}
export class MerchantCouponStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'PAUSED']) status!: 'DRAFT' | 'ACTIVE' | 'PAUSED';
}

@Injectable()
export class MerchantCouponService {
  constructor(private readonly prisma: PrismaService) {}

  private id(value: string) {
    if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new BadRequestException('Invalid ID');
    return BigInt(value);
  }
  async list(userId: string, shopId: string, actorRole = 'MERCHANT') {
    await requireShopAccess(this.prisma, this.id(shopId), { id: userId, role: actorRole }, 'OWNER_ONLY');
    return (await this.prisma.coupon.findMany({ where: { shopId: this.id(shopId), deletedAt: null }, orderBy: { id: 'desc' }, take: 100 })).map(c => this.serialize(c));
  }
  async create(userId: string, shopId: string, dto: MerchantCouponDto, actorRole = 'MERCHANT') {
    const sid = this.id(shopId), actor = { id: userId, role: actorRole };
    return withShopConfiguration(this.prisma, sid, actor, async tx => {
      const row = await tx.coupon.create({ data: { ...couponData(dto), shopId: sid } });
      await configurationAudit(tx, actor, 'COUPON', row.id, 'CREATE', Object.keys(dto));
      return this.serialize(row);
    }, 'OWNER_ONLY');
  }
  async update(userId: string, shopId: string, couponId: string, dto: MerchantCouponDto, actorRole = 'MERCHANT') {
    const sid = this.id(shopId), cid = this.id(couponId), actor = { id: userId, role: actorRole };
    return withShopConfiguration(this.prisma, sid, actor, async tx => {
      // Shared claim/update policy keeps the shop -> coupon lock order and
      // protects already-claimed monetary/validity terms.
      const row = await updateCouponInTransaction(tx, cid, dto, sid);
      await configurationAudit(tx, actor, 'COUPON', cid, 'UPDATE', Object.keys(dto));
      return this.serialize(row);
    }, 'OWNER_ONLY');
  }
  async updateStatus(userId: string, shopId: string, couponId: string, status: string, actorRole = 'MERCHANT') {
    if (!['DRAFT', 'ACTIVE', 'PAUSED'].includes(status)) throw new BadRequestException('Invalid status');
    return this.update(userId, shopId, couponId, { status: status as MerchantCouponDto['status'] }, actorRole);
  }
  async remove(userId: string, shopId: string, couponId: string, actorRole = 'MERCHANT') {
    const sid = this.id(shopId), cid = this.id(couponId), actor = { id: userId, role: actorRole };
    return withShopConfiguration(this.prisma, sid, actor, async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM coupons WHERE id = ${cid} FOR UPDATE`);
      const existing = await tx.coupon.findFirst({ where: { id: cid, shopId: sid, deletedAt: null } });
      if (!existing) throw new NotFoundException('Coupon not found');
      await tx.coupon.update({ where: { id: cid }, data: { deletedAt: new Date(), status: 'PAUSED' } });
      await configurationAudit(tx, actor, 'COUPON', cid, 'DELETE', ['deletedAt', 'status']);
      return { message: 'Coupon deleted', id: couponId };
    }, 'OWNER_ONLY');
  }
  private serialize(c: any) {
    return { id: c.id.toString(), shopId: c.shopId?.toString() ?? null, title: c.title, description: c.description,
      type: c.type, value: c.value, minSpendCents: c.minSpendCents, totalQuantity: c.totalQuantity,
      claimedCount: c.claimedCount, usedCount: c.usedCount, perUserLimit: 1, configuredPerUserLimit: c.perUserLimit,
      validFrom: c.validFrom, validUntil: c.validUntil, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt };
  }
}
