/**
 * MJAPP — ShopReview Service
 *
 * Admin service for reviewing shop registrations.
 * Handles querying pending shops, approving/rejecting/requesting info,
 * and recording every decision via AuditLog.
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';
import { ShopReviewQueryDto, ReviewShopDto } from './dto/shop-review.dto';
import { Prisma } from '@prisma/client';
import { requireShopPublication } from '../../common/shop-publication';
import * as v from '../studio/validation';

@Injectable()
export class ShopReviewService {
  private readonly logger = new Logger(ShopReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Query shops with optional review-status filter, search, and pagination.
   * Includes owner info, service/technician count, and certificate info.
   */
  async findAll(dto: ShopReviewQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (dto.reviewStatus) {
      where.status = dto.reviewStatus;
    }
    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search } },
        { phone: { contains: dto.search } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.shop.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: {
            select: { id: true, name: true, phone: true, email: true },
          },
          certificates: {
            select: { id: true, certificateType: true, fileUrl: true, isVerified: true },
          },
          _count: {
            select: {
              shopServices: true,
              therapists: true,
              shopImages: true,
            },
          },
        },
      }),
      this.prisma.shop.count({ where }),
    ]);

    return {
      items: items.map((shop) => ({
        id: shop.id.toString(),
        ownerId: shop.ownerId.toString(),
        name: shop.name,
        nameEn: shop.nameEn,
        phone: shop.phone,
        address: shop.address,
        city: shop.city,
        state: shop.state,
        category: shop.category,
        status: shop.status,
        shopType: shop.shopType,
        avgRating: Number(shop.avgRating),
        reviewCount: shop.reviewCount,
        reviewComment: shop.reviewComment,
        reviewedAt: shop.reviewedAt,
        reviewedBy: shop.reviewedBy?.toString() ?? null,
        createdAt: shop.createdAt,
        owner: shop.owner,
        certificates: shop.certificates,
        serviceCount: shop._count.shopServices,
        therapistCount: shop._count.therapists,
        imageCount: shop._count.shopImages,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get detailed shop info for review, including services and therapists.
   */
  async findOne(id: string) {
    const shopId = v.id(id);
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      include: {
        owner: {
          select: { id: true, name: true, phone: true, email: true, createdAt: true },
        },
        shopServices: {
          where: { isActive: true },
          select: { id: true, name: true, nameEn: true, category: true, durationMin: true, priceCents: true },
          orderBy: { sortOrder: 'asc' },
        },
        therapists: {
          where: { isActive: true },
          select: { id: true, name: true, title: true, yearsExp: true, gender: true },
          orderBy: { sortOrder: 'asc' },
        },
        shopImages: {
          select: { id: true, imageUrl: true, imageType: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        },
        certificates: {
          select: { id: true, certificateType: true, fileUrl: true, expiryDate: true, isVerified: true },
        },
        bookings: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, bookingNo: true, status: true, priceCents: true, createdAt: true },
        },
      },
    });

    if (!shop) {
      throw new NotFoundException(`Shop #${id} not found`);
    }

    // Attach audit history
    const auditLogs = await this.auditLogService.findByTarget('SHOP', id);

    return {
      id: shop.id.toString(),
      ownerId: shop.ownerId.toString(),
      name: shop.name,
      nameEn: shop.nameEn,
      description: shop.description,
      phone: shop.phone,
      address: shop.address,
      city: shop.city,
      state: shop.state,
      zipCode: shop.zipCode,
      latitude: Number(shop.latitude),
      longitude: Number(shop.longitude),
      category: shop.category,
      status: shop.status,
      shopType: shop.shopType,
      businessHours: shop.businessHours,
      avgRating: Number(shop.avgRating),
      reviewCount: shop.reviewCount,
      bookingCount: shop.bookingCount,
      reviewComment: shop.reviewComment,
      reviewedAt: shop.reviewedAt,
      reviewedBy: shop.reviewedBy?.toString() ?? null,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
      owner: shop.owner,
      services: shop.shopServices,
      therapists: shop.therapists,
      images: shop.shopImages,
      certificates: shop.certificates,
      recentBookings: shop.bookings.map((b) => ({
        id: b.id.toString(),
        bookingNo: b.bookingNo,
        status: b.status,
        priceCents: b.priceCents,
        createdAt: b.createdAt,
      })),
      auditLogs,
    };
  }

  /**
   * Review a shop — approve, reject, or request more info.
   *
   * @param id          Shop ID
   * @param dto         Review action + reason
   * @param operatorId  Admin user ID performing the review
   */
  async review(id: string, dto: ReviewShopDto, operatorId: string) {
    const shopId = v.id(id), operatorBigInt = v.id(operatorId);
    const action = v.choice(dto.action, ['APPROVE', 'REJECT', 'REQUEST_INFO']);
    const reason = v.text(dto.reason, 'review reason', 2000, action !== 'APPROVE');
    const status = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'PENDING';
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`);
      const shop = await tx.shop.findFirst({ where: { id: shopId, deletedAt: null } });
      if (!shop) throw new NotFoundException('Shop not found');
      if (action === 'APPROVE') {
        requireShopPublication(shop);
      }
      const updated = await tx.shop.update({ where: { id: shopId }, data: { status, reviewComment: reason || null, reviewedAt: new Date(), reviewedBy: operatorBigInt } });
      await tx.auditLog.create({ data: { action, targetType: 'SHOP', targetId: shopId, operatorId: operatorBigInt, detail: { reason: reason || null, previousStatus: shop.status, newStatus: status } } });
      return { id: updated.id.toString(), status: updated.status, reviewComment: updated.reviewComment, reviewedAt: updated.reviewedAt, reviewedBy: updated.reviewedBy?.toString() ?? null };
    });
  }
}
