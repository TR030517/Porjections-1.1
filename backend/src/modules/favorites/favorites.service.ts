import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { numericId } from '../payment/money';
import { publicShopIds, requirePublicShop } from '../../common/shop-eligibility';
import { publicShopProfile } from '../../common/shop-public-profile';
import { canonicalShopLink } from '../../common/shop-alias';
import { shopFeatures } from '../../common/shop-features';
import { shopPaymentPolicy } from '../../common/shop-payment-policy';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Toggle favorite — add if not exists, remove if exists. Returns new state. */
  async toggle(userId: string, shopId: string) {
    const uid = numericId(userId), sid = numericId(shopId);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${sid} FOR UPDATE`);
      const existing = await tx.userFavorite.findUnique({ where: { userId_shopId: { userId: uid, shopId: sid } } });
      // Removing one's saved relationship remains possible for hidden shops.
      if (existing) { await tx.userFavorite.delete({ where: { id: existing.id } }); return { favorited: false }; }
      await requirePublicShop(tx, sid, { lockOwner: true });
      await tx.userFavorite.create({ data: { userId: uid, shopId: sid } });
      return { favorited: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** List user's favorite shop IDs */
  async listIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.userFavorite.findMany({
      where: { userId: numericId(userId) },
      select: { shopId: true },
    });
    const ids = await publicShopIds(this.prisma, [...new Set(rows.map(row => row.shopId))]);
    return ids.map(id => id.toString());
  }

  /** Check if a shop is favorited by user */
  async isFavorited(userId: string, shopId: string): Promise<boolean> {
    const sid = numericId(shopId);
    const row = await this.prisma.userFavorite.findFirst({ where: { userId: numericId(userId), shopId: sid } });
    return !!row && (await publicShopIds(this.prisma, [sid])).length > 0;
  }

  /** List user's favorite shops (full detail) */
  async listShops(userId: string) {
    const favorites = await this.prisma.userFavorite.findMany({ where: { userId: numericId(userId) }, select: { shopId: true } });
    const shopIds = await publicShopIds(this.prisma, [...new Set(favorites.map(row => row.shopId))]);
    if (!shopIds.length) return [];
    const rows = await this.prisma.userFavorite.findMany({
      where: { userId: numericId(userId), shopId: { in: shopIds } },
      include: {
        shop: {
          include: {
            shopImages: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.shop.id.toString(),
      name: r.shop.name,
      nameEn: r.shop.nameEn,
      description: r.shop.description,
      phone: r.shop.phone,
      address: r.shop.address,
      city: r.shop.city,
      state: r.shop.state,
      zipCode: r.shop.zipCode,
      latitude: Number(r.shop.latitude),
      longitude: Number(r.shop.longitude),
      category: r.shop.category,
      shopType: r.shop.shopType,
      timezone: r.shop.timezone,
      avgRating: Number(r.shop.avgRating),
      reviewCount: r.shop.reviewCount,
      bookingCount: r.shop.bookingCount,
      distanceKm: null,
      features: shopFeatures(r.shop.studioProfile),
      paymentPolicy: shopPaymentPolicy(r.shop.studioProfile),
      ...canonicalShopLink(r.shop.shortName),
      ...publicShopProfile(r.shop, r.shop.shopImages, { includePriceMenu: false }),
      imageUrl: publicShopProfile(r.shop, r.shop.shopImages, { includePriceMenu: false }).thumbnail,
      favoritedAt: r.createdAt,
    }));
  }
}
