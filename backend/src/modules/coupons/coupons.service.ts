/**
 * MJAPP — Coupon Public Service
 * Claimable coupon list, claim (transactional anti-overclaim), my coupon wallet,
 * and coupon validation for booking.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { numericId } from '../payment/money';
import { publicShopIds, requirePublicShop } from '../../common/shop-eligibility';

export const COUPON_NOT_APPLICABLE = 'COUPON_NOT_APPLICABLE';
export const COUPON_BELOW_MIN_SPEND = 'COUPON_BELOW_MIN_SPEND';
export const COUPON_EXPIRED = 'COUPON_EXPIRED';
export const COUPON_LIMIT_REACHED = 'COUPON_LIMIT_REACHED';
export const COUPON_ALREADY_CLAIMED = 'COUPON_ALREADY_CLAIMED';

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /** List claimable coupons for the current user (platform-wide or shop coupons) */
  async listClaimable(userId: string, shopId?: string) {
    const now = new Date();
    const strictShopIds = await publicShopIds(this.prisma, shopId ? [numericId(shopId)] : undefined);
    if (shopId && !strictShopIds.length) throw new NotFoundException('Shop unavailable');
    const where: any = {
      status: 'ACTIVE',
      deletedAt: null,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      AND: [{ OR: [{ shopId: null }, { shopId: { in: strictShopIds } }] }],
    };
    if (shopId) {
      where.AND.push({ OR: [{ shopId: numericId(shopId) }, { shopId: null }] });
    }

    const [coupons, myClaims] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        include: {
          shop: { select: { id: true, name: true } },
        },
        orderBy: [{ id: 'desc' }],
        take: 50,
      }),
      this.prisma.userCoupon.findMany({
        where: { userId: BigInt(userId) },
        select: { couponId: true },
      }),
    ]);

    const claimedSet = new Set(myClaims.map((c) => c.couponId.toString()));

    const items = await Promise.all(
      coupons.map(async (c) => {
        // The unique userId/couponId wallet contract permits exactly one claim;
        // the batched lookup above also avoids one count query per coupon.
        const userClaimCount = claimedSet.has(c.id.toString()) ? 1 : 0;
        const exhausted = c.totalQuantity > 0 && c.claimedCount >= c.totalQuantity;
        return {
          ...this.serializeCoupon(c),
          claimedByMe: claimedSet.has(c.id.toString()),
          userClaimCount,
          exhausted,
        };
      }),
    );

    return items;
  }

  /**
   * Claim a coupon. Transactional checks:
   * - validity window
   * - total quantity (anti-overclaim via atomic increment)
   * - per-user limit (unique userId+couponId)
   */
  async claim(userId: string, couponId: string) {
    const uid = numericId(userId);
    const cid = numericId(couponId);
    const now = new Date();
    // Discover only the parent. The coupon and authorization are reread under
    // shop -> owner -> coupon locks in the final READ COMMITTED transaction.
    const discovery = await this.prisma.coupon.findUnique({ where: { id: cid }, select: { shopId: true } });
    if (!discovery) throw new NotFoundException('Coupon not found');

    return this.prisma.$transaction(async (tx) => {
      if (discovery.shopId !== null) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${discovery.shopId} FOR UPDATE`);
        await requirePublicShop(tx, discovery.shopId, { lockOwner: true });
      }
      await tx.$queryRaw(Prisma.sql`SELECT id FROM coupons WHERE id = ${cid} FOR UPDATE`);
      const coupon = await tx.coupon.findUnique({ where: { id: cid } });
      if (!coupon || coupon.deletedAt) throw new NotFoundException('Coupon not found');
      if (coupon.shopId !== discovery.shopId) throw new ConflictException('Coupon changed; reload before claiming');

      if (coupon.status !== 'ACTIVE') {
        throw new BadRequestException(COUPON_EXPIRED);
      }
      if (coupon.validFrom > now) {
        throw new BadRequestException('COUPON_NOT_STARTED');
      }
      if (coupon.validUntil && coupon.validUntil < now) {
        throw new BadRequestException(COUPON_EXPIRED);
      }

      // Enforce the real wallet contract even for historical >1 configuration.
      const userClaimCount = await tx.userCoupon.count({
        where: { userId: uid, couponId: cid },
      });
      if (userClaimCount >= 1) {
        throw new ConflictException(COUPON_ALREADY_CLAIMED);
      }

      // Total quantity — atomic compare-and-increment to prevent overclaim races
      if (coupon.totalQuantity > 0) {
        if (coupon.claimedCount >= coupon.totalQuantity) {
          throw new ConflictException(COUPON_LIMIT_REACHED);
        }
        const updated = await tx.coupon.updateMany({
          where: { id: cid, claimedCount: { lt: coupon.totalQuantity } },
          data: { claimedCount: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw new ConflictException(COUPON_LIMIT_REACHED);
        }
      } else {
        await tx.coupon.update({ where: { id: cid }, data: { claimedCount: { increment: 1 } } });
      }

      try {
        const userCoupon = await tx.userCoupon.create({
          data: {
            userId: uid,
            couponId: cid,
            status: 'UNUSED',
            expiredAt: coupon.validUntil,
          },
        });
        return {
          message: 'Coupon claimed successfully',
          id: userCoupon.id.toString(),
          couponId: cid.toString(),
        };
      } catch (err: any) {
        // Duplicate claim (unique userId+couponId) — roll back the counter
        if (err?.code === 'P2002') {
          // Throwing rolls back the whole transaction, including its counter increment.
          throw new ConflictException(COUPON_ALREADY_CLAIMED);
        }
        throw err;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** My coupon wallet, filtered by status (UNUSED | USED | EXPIRED) */
  async myCoupons(userId: string, status?: string) {
    const uid = BigInt(userId);
    const where: any = { userId: uid };
    if (status) {
      if (status === 'EXPIRED') {
        // EXPIRED = status field EXPIRED OR past validUntil while unused
        where.OR = [
          { status: 'EXPIRED' },
          { status: 'UNUSED', coupon: { validUntil: { lt: new Date() } } },
        ];
      } else {
        where.status = status;
      }
    }

    const items = await this.prisma.userCoupon.findMany({
      where,
      include: {
        coupon: {
          include: { shop: { select: { id: true, name: true, nameEn: true } } },
        },
      },
      orderBy: { claimedAt: 'desc' },
      take: 100,
    });

    return items.map((uc) => this.serializeUserCoupon(uc));
  }

  /**
   * Validate a coupon against a shop/service price (before booking).
   * Returns { valid, discountCents, reason }.
   */
  async validateCoupon(params: {
    userId: string;
    couponId: string;
    shopId: string;
    priceCents: number;
  }) {
    const { userId, couponId, shopId, priceCents } = params;
    if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new BadRequestException('Invalid price cents');
    if (!(await publicShopIds(this.prisma, [numericId(shopId)])).length) return { valid: false, discountCents: 0, reason: COUPON_NOT_APPLICABLE };
    const uc = await this.prisma.userCoupon.findFirst({
      where: {
        id: BigInt(couponId),
        userId: BigInt(userId),
        status: 'UNUSED',
      },
      include: { coupon: true },
    });
    if (!uc) {
      return { valid: false, discountCents: 0, reason: 'COUPON_NOT_FOUND' };
    }
    return this.evaluateCoupon(uc.coupon, BigInt(shopId), priceCents);
  }

  /**
   * Compute discount for a coupon against shop + price (shared by validate & booking).
   */
  async evaluateCoupon(coupon: any, shopId: bigint, priceCents: number) {
    const now = new Date();
    if (coupon.deletedAt || coupon.status !== 'ACTIVE') {
      return { valid: false, discountCents: 0, reason: COUPON_EXPIRED };
    }
    if (coupon.validFrom > now || (coupon.validUntil && coupon.validUntil < now)) {
      return { valid: false, discountCents: 0, reason: COUPON_EXPIRED };
    }
    // Shop scoped coupon must match booking shop
    if (coupon.shopId && coupon.shopId !== shopId) {
      return { valid: false, discountCents: 0, reason: COUPON_NOT_APPLICABLE };
    }
    if (priceCents < coupon.minSpendCents) {
      return { valid: false, discountCents: 0, reason: COUPON_BELOW_MIN_SPEND };
    }

    let discountCents: number;
    if (coupon.type === 'PERCENT') {
      discountCents = Math.round((priceCents * coupon.value) / 100);
    } else {
      discountCents = Math.min(coupon.value, priceCents);
    }

    return { valid: true, discountCents, reason: null };
  }

  /* ─── Serializers ─────────────────────────────────────────── */

  private serializeCoupon(c: any) {
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
    };
  }

  private serializeUserCoupon(uc: any) {
    const now = new Date();
    let status = uc.status;
    if (status === 'UNUSED' && uc.coupon.validUntil && uc.coupon.validUntil < now) {
      status = 'EXPIRED';
    }
    return {
      id: uc.id.toString(),
      claimedAt: uc.claimedAt,
      usedAt: uc.usedAt,
      status,
      bookingId: uc.bookingId ? uc.bookingId.toString() : null,
      coupon: this.serializeCoupon(uc.coupon),
    };
  }
}
