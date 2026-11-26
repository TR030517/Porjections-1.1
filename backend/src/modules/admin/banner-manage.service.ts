import { contentWrite } from '../../common/content-write';
import { bannerData, contentPage, publicationState } from '../../common/content-policy';
import { numericId } from '../payment/money';
import { syncBannerMedia } from '../../common/managed-media';
/**
 * MJAPP — Admin Banner Management Service
 * CRUD for home page banners (ADMIN role only)
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateBannerDto {
  title: string;
  imageUrl: string;
  targetType?: string;   // NONE | SHOP_DETAIL | CATEGORY | COUPON_CENTER | EXTERNAL_URL
  targetValue?: string;
  sortOrder?: number;
  isActive?: boolean;
  startAt?: string;
  endAt?: string;
}

@Injectable()
export class BannerManageService {
  constructor(private readonly prisma: PrismaService) {}

  /** List banners (all, paginated) */
  async list(query: { page?: number; pageSize?: number; keyword?: string } = {}) {
    const page = contentPage(query.page,1,100000);
    const pageSize = contentPage(query.pageSize,20,100);
    const keyword = query.keyword?.trim();

    const where: any = {};
    if (keyword) {
      where.title = { contains: keyword };
    }

    const [total, items] = await Promise.all([
      this.prisma.homeBanner.count({ where }),
      this.prisma.homeBanner.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((b) => this.serialize(b)),
    };
  }

  /** Create a banner */
  async create(dto: CreateBannerDto, actor:string) {
    const data = bannerData({ ...dto });
    await this.validateShop(data);
    const banner = await contentWrite(this.prisma,'BANNER',undefined,actor,'BANNER_CREATE',async tx=>{
      const row=await tx.homeBanner.create({data});
      await syncBannerMedia(tx,{actor:{id:actor,role:'ADMIN'},nextUrl:data.imageUrl});return row;
    });
    return this.serialize(banner);
  }

  /** Update a banner */
  async update(id:string, dto:CreateBannerDto, actor:string) {
    const bid=numericId(id);
    const banner=await contentWrite(this.prisma,'BANNER',bid,actor,'BANNER_UPDATE',async tx=>{
      const previous=await tx.homeBanner.findUnique({where:{id:bid}});
      if(!previous)throw new NotFoundException('Banner not found');
      const data=bannerData({...dto},previous);await this.validateShop(data);
      const row=await tx.homeBanner.update({where:{id:bid},data});
      await syncBannerMedia(tx,{actor:{id:actor,role:'ADMIN'},previousUrl:previous.imageUrl,nextUrl:data.imageUrl});return row;
    });
    return this.serialize(banner);
  }
  async toggle(id:string,actor:string) {
    const bid=numericId(id);
    const banner=await contentWrite(this.prisma,'BANNER',bid,actor,'BANNER_TOGGLE',async tx=>{
      const previous=await tx.homeBanner.findUnique({where:{id:bid}});
      if(!previous)throw new NotFoundException('Banner not found');
      const data=bannerData({isActive:!previous.isActive},previous);await this.validateShop(data);
      const row=await tx.homeBanner.update({where:{id:bid},data});
      await syncBannerMedia(tx,{actor:{id:actor,role:'ADMIN'},previousUrl:previous.imageUrl,nextUrl:data.imageUrl});return row;
    });
    return this.serialize(banner);
  }

  /** Delete a banner */
  async remove(id:string,actor:string) {
    const bid=numericId(id);
    await contentWrite(this.prisma,'BANNER',bid,actor,'BANNER_DELETE',async tx=>{
      if(!await tx.homeBanner.findUnique({where:{id:bid}}))throw new NotFoundException('Banner not found');
      // Retain click history and an auditable record.
      return tx.homeBanner.update({where:{id:bid},data:{isActive:false}});
    });
    return {message:'Banner disabled',id};
  }

  private async validateShop(data: ReturnType<typeof bannerData>) {
    if (data.targetType === 'SHOP_DETAIL' && !await this.prisma.shop.findFirst({ where: { id: numericId(data.targetValue!), deletedAt: null }, select: { id: true } })) throw new BadRequestException('Banner target shop does not exist');
  }
  private serialize(b: any) {
    return {
      id: b.id.toString(),
      title: b.title,
      publicationState: publicationState(b),
      imageUrl: b.imageUrl,
      targetType: b.targetType,
      targetValue: b.targetValue,
      sortOrder: b.sortOrder,
      isActive: b.isActive,
      startAt: b.startAt,
      endAt: b.endAt,
      clickCount: b.clickCount,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }
}
