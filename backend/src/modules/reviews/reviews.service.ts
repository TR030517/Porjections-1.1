/**
 * MJAPP — Reviews Service
 * Review CRUD with shop avgRating auto-update
 */

import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { numericId } from '../payment/money';
import { shopFeatures } from '../../common/shop-features';
import { publicShopIds, requirePublicShop } from '../../common/shop-eligibility';
import { safePublicMediaUrl } from '../../common/shop-public-profile';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto, UpdateReviewDto } from './dto/reviews.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  private async writableShop(tx: Prisma.TransactionClient, shopId: bigint) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`);
    const shop = await requirePublicShop(tx, shopId, { lockOwner: true });
    if (!shopFeatures(shop.studioProfile).reviews) throw new BadRequestException({
      code: 'REVIEWS_DISABLED',
      message: 'Reviews are disabled for this shop',
    });
  }

  async create(userId: string, dto: CreateReviewDto) {
    return this.prisma.$transaction(async tx => {
      const booking = await tx.booking.findFirst({ where: { id: numericId(dto.bookingId), userId: numericId(userId), deletedAt: null } });
      if (!booking || booking.userId !== numericId(userId)) throw new NotFoundException('Booking not found');
      if (booking.status !== 'COMPLETED') throw new BadRequestException('Can only review completed bookings');
      await this.writableShop(tx, booking.shopId);
      if (await tx.review.findUnique({ where: { bookingId: booking.id } })) throw new ConflictException('You have already reviewed this booking');
      const review = await tx.review.create({ data: { bookingId: booking.id, userId: booking.userId, shopId: booking.shopId, rating: dto.rating, content: dto.content ?? null, images: dto.images ?? undefined } });
      await this._updateShopRating(booking.shopId, tx);
      return review;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async update(userId: string, reviewId: string, dto: UpdateReviewDto) {
    return this.prisma.$transaction(async tx => {
      const initial = await tx.review.findFirst({ where: { id: numericId(reviewId), userId: numericId(userId) } });
      if (!initial) throw new NotFoundException('Review not found');
      await this.writableShop(tx, initial.shopId);
      if (!await tx.review.findFirst({ where: { id: initial.id, userId: initial.userId } })) throw new NotFoundException('Review not found');
      const updated = await tx.review.update({ where: { id: initial.id }, data: {
        ...(dto.rating !== undefined && { rating: dto.rating }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.images !== undefined && { images: dto.images }),
      } });
      await this._updateShopRating(initial.shopId, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async delete(userId: string, reviewId: string) {
    return this.prisma.$transaction(async tx => {
      const initial = await tx.review.findFirst({ where: { id: numericId(reviewId), userId: numericId(userId) } });
      if (!initial) throw new NotFoundException('Review not found');
      // Authors can remove their own review even after the shop becomes hidden.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${initial.shopId} FOR UPDATE`);
      const deleted = await tx.review.deleteMany({ where: { id: initial.id, userId: initial.userId } });
      if (!deleted.count) throw new NotFoundException('Review not found');
      await this._updateShopRating(initial.shopId, tx);
      return { message: 'Review deleted successfully' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * Paginated public reviews for a shop, newest first.
   * Includes reviewer name and avatar.
   */
  async listByShop(shopId: string, page: number, limit: number) {
    const shopIdBig = numericId(shopId);
    const skip = (page - 1) * limit;

    // Verify shop exists
    if (!(await publicShopIds(this.prisma, [shopIdBig])).length) throw new NotFoundException('Shop not found');
    const shop = await this.prisma.shop.findFirst({ where: { id: shopIdBig }, select: { id: true, studioProfile: true } });
    if (!shop) throw new NotFoundException('Shop not found');
    // Closing new/updated reviews does not hide already-public history.

    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where: { shopId: shopIdBig, isPublic: true },
        include: {
          user: {
            select: { name: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.review.count({
        where: { shopId: shopIdBig, isPublic: true },
      }),
    ]);

    return {
      items: items.map((r) => ({
        id: r.id,
        rating: r.rating,
        content: r.content,
        images: Array.isArray(r.images) ? r.images.map(safePublicMediaUrl).filter(Boolean).slice(0, 10) : [],
        createdAt: r.createdAt,
        user: {
          name: r.user.name,
          avatarUrl: safePublicMediaUrl(r.user.avatarUrl),
        },
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * All reviews by the current user, with shop name.
   */
  async listMyReviews(userId: string) {
    const userIdBig = BigInt(userId);

    const reviews = await this.prisma.review.findMany({
      where: { userId: userIdBig },
      include: {
        shop: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reviews.map((r) => ({
      id: r.id,
      bookingId: r.bookingId,
      rating: r.rating,
      content: r.content,
      images: r.images,
      createdAt: r.createdAt,
      shop: {
        name: r.shop.name,
        id: r.shop.id,
      },
    }));
  }

  /**
   * Recalculate avgRating and reviewCount for a shop.
   */
  private async _updateShopRating(shopId: bigint, tx: Prisma.TransactionClient) {
    const aggregate = await tx.review.aggregate({
      where: { shopId, isPublic: true },
      _avg: { rating: true },
      _count: { id: true },
    });

    await tx.shop.update({
      where: { id: shopId },
      data: {
        avgRating: aggregate._avg.rating ?? 0,
        reviewCount: aggregate._count.id,
      },
    });
  }
}
