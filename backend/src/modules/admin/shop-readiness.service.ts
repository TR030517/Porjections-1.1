import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { merchantRoutedLoginReady } from '../../common/merchant-account';
import { id } from '../reservations/reservation-validation';
import { buildShopReadiness } from './shop-readiness.rules';
import type { ReadinessActor, ShopReadiness } from './shop-readiness.contract';
import { SHOP_ORDER_EMAIL_DESTINATION_SELECT } from '../../common/shop-order-email-destination';
import { orderEmailConfig } from '../notifications/order-email-delivery';

export const READINESS_LIMITS = { services: 500, variants: 2000, therapists: 500, shifts: 5000, rooms: 500, images: 100 } as const;
function bounded<T>(rows: T[], key: keyof typeof READINESS_LIMITS): T[] {
  if (rows.length > READINESS_LIMITS[key]) throw new BadRequestException({ message: '门店配置数量超过本检查的安全上限，请先整理资料；本次未生成部分通过结果。', shopReadinessCode: 'CONFIGURATION_TOO_LARGE', resource: key });
  return rows;
}

@Injectable()
export class ShopReadinessService {
  constructor(private readonly prisma: PrismaService) {}
  async get(actor: ReadinessActor, shopId: string): Promise<ShopReadiness> {
    if (!actor || actor.role !== 'ADMIN') throw new ForbiddenException('仅公司管理员可查看门店经营检查');
    const operatorId = id(actor.id, 'operatorId'), sid = id(shopId, 'shopId');
    // Read-only-use transaction: no raw SQL, lock, mutation, audit side effect,
    // booking slots, expiry cleanup, provider calls or environment mutation.
    return this.prisma.$transaction(async tx => {
      const operator = await tx.user.findFirst({ where: { id: operatorId, role: 'ADMIN', status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!operator) throw new ForbiddenException('管理员账户不可用');
      const shop = await tx.shop.findFirst({ where: { id: sid, deletedAt: null }, select: {
        id: true, name: true, shortName: true, status: true, deletedAt: true, timezone: true, phone: true, address: true, city: true, state: true,
        latitude: true, longitude: true, businessHours: true, studioProfile: true, description: true,
        orderEmailSetting: { select: SHOP_ORDER_EMAIL_DESTINATION_SELECT },
        loginBinding: { select: { user: { select: { id: true, role: true, status: true, deletedAt: true, loginName: true, email: true, phone: true, passwordHash: true } } } },
      } });
      if (!shop) throw new NotFoundException('门店不存在或已删除');
      const services = bounded(await tx.shopService.findMany({ where: { shopId: sid }, orderBy: { id: 'asc' }, take: READINESS_LIMITS.services + 1, select: {
        id: true, shopId: true, name: true, isActive: true, durationMin: true, durationKind: true, priceCents: true, priceBasis: true, participantCount: true,
        requiredStaffCount: true, requiredRoomType: true, staffBufferMin: true, roomBufferMin: true,
      } }), 'services');
      const variants = bounded(await tx.shopServiceVariant.findMany({ where: { service: { shopId: sid } }, orderBy: { id: 'asc' }, take: READINESS_LIMITS.variants + 1,
        select: { id: true, serviceId: true, isActive: true, durationMin: true, priceCents: true, priceBasis: true, currency: true } }), 'variants');
      // Readiness describes currently usable calendars, not historical people.
      // Inactive records remain intact and do not consume the active bound.
      const therapists = bounded(await tx.therapist.findMany({ where: { shopId: sid, isActive: true }, orderBy: { id: 'asc' }, take: READINESS_LIMITS.therapists + 1,
        select: { id: true, shopId: true, isActive: true, scheduleMode: true } }), 'therapists');
      // Legacy null mode means CUSTOM. SHOP calendars use business hours and
      // must not be blocked by unused old shifts; invalid modes still fail the
      // rules check rather than gaining a default schedule.
      const personalIds = therapists.filter(row => row.scheduleMode !== 'SHOP').map(row => row.id);
      const shifts = bounded(await tx.therapistShift.findMany({ where: { therapistId: { in: personalIds }, isActive: true, therapist: { shopId: sid, isActive: true } }, orderBy: { id: 'asc' }, take: READINESS_LIMITS.shifts + 1,
        select: { id: true, therapistId: true, isActive: true, weekday: true, startMin: true, endMin: true } }), 'shifts');
      const rooms = bounded(await tx.shopRoom.findMany({ where: { shopId: sid }, orderBy: { id: 'asc' }, take: READINESS_LIMITS.rooms + 1,
        select: { id: true, shopId: true, isActive: true, roomType: true, capacity: true } }), 'rooms');
      const images = bounded(await tx.shopImage.findMany({ where: { shopId: sid }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: READINESS_LIMITS.images + 1,
        select: { id: true, imageType: true, imageUrl: true, sortOrder: true } }), 'images');
      const loginReady = await merchantRoutedLoginReady(tx, shop.loginBinding?.user);
      const config = orderEmailConfig();
      return buildShopReadiness({ shop, services, variants, therapists, shifts, rooms, images,
        orderEmailDelivery: { configured: config.enabled, mode: config.deliveryMode === 'LOCAL_CAPTURE' || config.deliveryMode === 'PROVIDER' ? config.deliveryMode : null,
          workerEnabled: process.env.NOTIFICATION_WORKER_ENABLED !== 'false' } }, loginReady);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }
}
