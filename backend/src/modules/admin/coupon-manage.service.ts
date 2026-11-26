/**
 * MJAPP — Admin Coupon Management Service
 * Platform-wide coupon CRUD + claim/redemption stats (ADMIN role)
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { couponData, updateCouponInTransaction } from '../coupons/coupon-policy';
import { MerchantCouponDto } from '../merchant/merchant-coupon.service';
import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateCouponDto extends MerchantCouponDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) shopId?: string;
}
@Injectable()
export class CouponManageService {
  constructor(private readonly prisma: PrismaService) {}

  /** List coupons with stats */
  async list(query: { page?: number; pageSize?: number; keyword?: string; status?: string } = {}) {
    const page = Number(query.page || 1);
    const pageSize = Math.min(Number(query.pageSize || 20), 100);
    const where: any = { deletedAt: null };
    if (query.keyword?.trim()) {
      where.title = { contains: query.keyword.trim() };
    }
    if (query.status) {
      where.status = query.status;
    }

    const [total, items] = await Promise.all([
      this.prisma.coupon.count({ where }),
      this.prisma.coupon.findMany({
        where,
        include: { shop: { select: { id: true, name: true } } },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((c) => this.serialize(c)),
    };
  }

  /** Create a coupon (platform-wide unless shopId provided) */
  async create(dto: CreateCouponDto) {
    if (dto.shopId && BigInt(dto.shopId) > 9223372036854775807n) throw new BadRequestException('Invalid shop ID');
    const coupon = await this.prisma.coupon.create({
      data: { ...couponData(dto), shopId: dto.shopId ? BigInt(dto.shopId) : null },
      include: { shop: { select: { id: true, name: true } } },
    });
    return this.serialize(coupon);
  }

  /** Update a coupon */
  async update(id: string, dto: CreateCouponDto) {
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) throw new BadRequestException('Invalid coupon ID');
    const coupon = await this.prisma.$transaction(tx => updateCouponInTransaction(tx, BigInt(id), dto), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.serialize(coupon);
  }
  /** Change coupon status (ACTIVE / PAUSED / DRAFT) */
  async updateStatus(id: string, status: string) {
    const cid = BigInt(id);
    if (![ 'DRAFT', 'ACTIVE', 'PAUSED' ].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    const existing = await this.prisma.coupon.findUnique({ where: { id: cid } });
    if (!existing || existing.deletedAt) throw new NotFoundException('Coupon not found');
    const coupon = await this.prisma.coupon.update({
      where: { id: cid },
      data: { status: status as any },
      include: { shop: { select: { id: true, name: true } } },
    });
    return this.serialize(coupon);
  }

  /** Soft delete a coupon */
  async remove(id: string) {
    const cid = BigInt(id);
    const existing = await this.prisma.coupon.findUnique({ where: { id: cid } });
    if (!existing || existing.deletedAt) throw new NotFoundException('Coupon not found');
    await this.prisma.coupon.update({
      where: { id: cid },
      data: { deletedAt: new Date(), status: 'PAUSED' },
    });
    return { message: 'Coupon deleted', id };
  }

  /** Claim/redemption stats */
  async stats() {
    const [totalCoupons, totalClaimed, totalUsed, activeCoupons, recentClaims] = await Promise.all([
      this.prisma.coupon.count({ where: { deletedAt: null } }),
      this.prisma.coupon.aggregate({ _sum: { claimedCount: true } }),
      this.prisma.coupon.aggregate({ _sum: { usedCount: true } }),
      this.prisma.coupon.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.userCoupon.count({ where: { claimedAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
    ]);
    return {
      totalCoupons,
      activeCoupons,
      totalClaimed: totalClaimed._sum.claimedCount || 0,
      totalUsed: totalUsed._sum.usedCount || 0,
      recentClaims7d: recentClaims,
    };
  }

  private serialize(c: any) {
    return {
      id: c.id.toString(),
      shopId: c.shopId ? c.shopId.toString() : null,
      shop: c.shop ? { id: c.shop.id.toString(), name: c.shop.name } : null,
      title: c.title,
      description: c.description,
      type: c.type,
      value: c.value,
      minSpendCents: c.minSpendCents,
      totalQuantity: c.totalQuantity,
      claimedCount: c.claimedCount,
      usedCount: c.usedCount,
      perUserLimit: 1,
      configuredPerUserLimit: c.perUserLimit,
      validFrom: c.validFrom,
      validUntil: c.validUntil,
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}
