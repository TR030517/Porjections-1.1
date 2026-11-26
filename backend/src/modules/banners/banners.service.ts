import { bannerData } from '../../common/content-policy';
import { publicShopIds } from '../../common/shop-eligibility';
import { numericId } from '../payment/money';
import { publicBannerImageAvailable } from '../../common/managed-media';
/**
 * MJAPP — Home Banner Public Service
 * Returns active banners for the home page carousel.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get active banners within validity window, ordered by sortOrder */
  async getActiveBanners() {
    const now = new Date();
    const banners = await this.prisma.homeBanner.findMany({
      where: {
        isActive: true,
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gt: now } }],
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
      take: 100,
    });
    const valid: any[] = [];
    for (const row of banners) {
      try { bannerData({}, row); } catch { continue; } // Legacy unsafe links are hidden, never silently rewritten.
      if(!await publicBannerImageAvailable(this.prisma,row.imageUrl))continue;
      if (row.targetType === 'SHOP_DETAIL' && !(await publicShopIds(this.prisma, [numericId(row.targetValue!)])).length) continue;
      valid.push(this.serialize(row)); if (valid.length === 10) break;
    }
    return valid;
  }

  /** Record a banner click (used for analytics) */
  async recordClick(id: string) {
    const bid = numericId(id), now = new Date();
    const banner = await this.prisma.homeBanner.findFirst({ where: { id:bid,isActive:true,startAt:{lte:now},OR:[{endAt:null},{endAt:{gt:now}}] } });
    if (!banner) throw new NotFoundException('Banner not found');
    try { bannerData({},banner); } catch { throw new NotFoundException('Banner not found'); }
    if(!await publicBannerImageAvailable(this.prisma,banner.imageUrl))throw new NotFoundException('Banner not found');
    if (banner.targetType === 'SHOP_DETAIL' && !(await publicShopIds(this.prisma, [numericId(banner.targetValue!)])).length) throw new NotFoundException('Banner not found');
    await this.prisma.homeBanner.updateMany({where:{id:bid,isActive:true,clickCount:{lt:2147483647}},data:{clickCount:{increment:1}}});
    return { ok:true,id };
  }

  private serialize(b: any) {
    return {
      id: b.id.toString(),
      title: b.title,
      imageUrl: b.imageUrl,
      targetType: b.targetType,
      targetValue: b.targetValue,
      sortOrder: b.sortOrder,
      clickCount: b.clickCount,
    };
  }
}
