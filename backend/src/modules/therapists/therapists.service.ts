/**
 * MJAPP — Therapists Service
 * Independent CRUD for shop therapists
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { publicShopIds, publicShopWhere } from '../../common/shop-eligibility';
import { publicServiceView } from '../../common/shop-public-profile';
import { hasPublicReservationOptions, publicReservationSource } from '../../common/service-reservation-options';
import { SHOP_SERVICE_ACCESS_MODE } from '../../common/shop-staff-policy';
import { numericId } from '../payment/money';

const SERVICE_INCLUDE = { variants: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] },
  addOns: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] }, _count: { select: { variants: true } } };

@Injectable()
export class TherapistsService {
  constructor(private readonly prisma: PrismaService) {}

  async listTherapists(params: { shopId?: string }) {
    const { shopId } = params;
    const publicIds = await publicShopIds(this.prisma, shopId ? [numericId(shopId)] : undefined);
    if (!publicIds.length) return [];
    const where: any = { isActive: true, shopId: { in: publicIds }, shop: publicShopWhere() };

    const therapists = await this.prisma.therapist.findMany({
      where,
      include: {
        shop: { select: { id: true, name: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const shopIds = [...new Set(therapists.map(therapist => therapist.shopId))];
    const services = shopIds.length ? await this.prisma.shopService.findMany({ where: { shopId: { in: shopIds }, isActive: true, shop: publicShopWhere() }, include: SERVICE_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }) : [];
    const catalogs = new Map<string, ReturnType<typeof publicServiceView>[]>();
    for (const service of services.filter(hasPublicReservationOptions)) {
      const key = String(service.shopId), rows = catalogs.get(key) ?? [];
      rows.push(publicServiceView(publicReservationSource(service))); catalogs.set(key, rows);
    }
    return therapists.map((t) => ({
      id: t.id.toString(),
      shopId: t.shopId.toString(),
      name: t.name,
      avatarUrl: t.avatarUrl,
      title: t.title,
      bio: t.bio,
      yearsExp: t.yearsExp,
      gender: t.gender,
      shopName: t.shop.name,
      serviceAccessMode: SHOP_SERVICE_ACCESS_MODE,
      services: catalogs.get(String(t.shopId)) ?? [],
    }));
  }

  async getTherapist(id: string) {
    const tid = numericId(id);
    const therapist = await this.prisma.therapist.findFirst({
      where: { id: tid, isActive: true, shop: publicShopWhere() },
      include: {
        shop: { select: { id: true, name: true, address: true, phone: true } },
      },
    });

    if (!therapist || !(await publicShopIds(this.prisma, [therapist.shopId])).length) throw new NotFoundException('Therapist not found');
    const services = await this.prisma.shopService.findMany({ where: { shopId: therapist.shopId, isActive: true, shop: publicShopWhere() }, include: SERVICE_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });

    return {
      id: therapist.id.toString(),
      shopId: therapist.shopId.toString(),
      name: therapist.name,
      avatarUrl: therapist.avatarUrl,
      title: therapist.title,
      bio: therapist.bio,
      yearsExp: therapist.yearsExp,
      gender: therapist.gender,
      shop: therapist.shop,
      serviceAccessMode: SHOP_SERVICE_ACCESS_MODE,
      services: services.filter(hasPublicReservationOptions).map(service => publicServiceView(publicReservationSource(service))),
    };
  }
}
