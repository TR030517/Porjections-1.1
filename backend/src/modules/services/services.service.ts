/**
 * MJAPP — Services Service
 * Independent CRUD for shop services
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { publicShopIds, publicShopWhere } from '../../common/shop-eligibility';
import { publicServiceView } from '../../common/shop-public-profile';
import { numericId } from '../payment/money';
import { hasPublicReservationOptions, publicReservationSource } from '../../common/service-reservation-options';
import { SHOP_SERVICE_ACCESS_MODE } from '../../common/shop-staff-policy';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async listServices(params: { shopId?: string; category?: string }) {
    const { shopId, category } = params;
    const shopIds = await publicShopIds(this.prisma, shopId ? [numericId(shopId)] : undefined);
    if (!shopIds.length) return [];
    const where: any = { isActive: true, shopId: { in: shopIds }, shop: publicShopWhere() };

    if (category) where.category = category;

    const services = await this.prisma.shopService.findMany({
      where,
      include: {
        shop: { select: { id: true, name: true } },
        variants: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        addOns: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        _count: { select: { variants: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return services.filter(hasPublicReservationOptions).map((s) => ({
      ...publicServiceView(publicReservationSource(s)),
      shop: { id: String(s.shop.id), name: s.shop.name },
    }));
  }

  async getService(id: string) {
    const sid = numericId(id);
    const service = await this.prisma.shopService.findFirst({
      where: { id: sid, isActive: true, shop: publicShopWhere() },
      include: {
        shop: { select: { id: true, name: true } },
        variants: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        addOns: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        _count: { select: { variants: true } },
      },
    });

    if (!service || !(await publicShopIds(this.prisma, [service.shopId])).length || !hasPublicReservationOptions(service)) throw new NotFoundException('Service not found');
    const therapists = await this.prisma.therapist.findMany({ where: { shopId: service.shopId, isActive: true },
      select: { id: true, name: true, title: true, yearsExp: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });

    return {
      ...publicServiceView(publicReservationSource(service)),
      shop: { id: String(service.shop.id), name: service.shop.name },
      serviceAccessMode: SHOP_SERVICE_ACCESS_MODE,
      therapists: therapists.map(therapist => ({
        id: therapist.id.toString(),
        name: therapist.name,
        title: therapist.title,
        yearsExp: therapist.yearsExp,
      })),
    };
  }
}
