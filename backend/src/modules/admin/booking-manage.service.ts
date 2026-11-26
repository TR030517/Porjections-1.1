/**
 * MJAPP — BookingManage Service
 *
 * Admin-only service for global order management: multi-dimensional
 * booking search, full order detail, and dispute resolution.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';
import { BookingManageQueryDto, DisputeDto } from './dto/booking-manage.dto';
import { PaymentService } from '../payment/payment.service';
import { bookingAddOnsView } from '../../common/booking-addons-view';
import { bookingContactView } from '../../common/booking-contact';
import { itemDurationMeta, bookingDurationMeta } from '../../common/service-duration';
import { historicalBookingService } from '../../common/booking-service-snapshot';
import { bookingLocalFields } from '../booking/time';
function durationItems(booking: any) { return (booking.items ?? []).map((item: any) => ({ ...JSON.parse(JSON.stringify(item, (_key, value) => typeof value === 'bigint' ? value.toString() : value)), ...itemDurationMeta(item) })); }

@Injectable()
export class BookingManageService {
  private readonly logger = new Logger(BookingManageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * Multi-dimensional booking search with pagination.
   * Supports filtering by status, payment status, shop name, user phone,
   * booking number, and date range.
   */
  async findAll(dto: BookingManageQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    // Build Prisma where clause
    const where: any = { deletedAt: null };

    if (dto.status) {
      where.status = dto.status;
    }

    if (dto.paymentStatus) {
      where.paymentStatus = dto.paymentStatus;
    }

    if (dto.bookingNo) {
      where.bookingNo = dto.bookingNo;
    }

    if (dto.shopSearch) {
      where.shop = {
        name: { contains: dto.shopSearch },
      };
    }

    if (dto.phone) {
      const normalizedPhone = dto.phone.trim().replace(/[ ()-]/g, '');
      where.OR = [
        { user: { phone: { contains: dto.phone } } },
        { contactPhone: { contains: normalizedPhone || dto.phone } },
      ];
    }

    if (dto.startDate || dto.endDate) {
      where.bookingDate = {};
      if (dto.startDate) {
        where.bookingDate.gte = new Date(dto.startDate);
      }
      if (dto.endDate) {
        // Include the full end date by setting to end of day
        const end = new Date(dto.endDate);
        end.setHours(23, 59, 59, 999);
        where.bookingDate.lte = end;
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true, addOns: true,
          user: {
            select: { id: true, name: true, phone: true },
          },
          shop: {
            select: { id: true, name: true, address: true, city: true, state: true, timezone: true },
          },
          service: {
            select: { id: true, name: true, durationMin: true, priceCents: true },
          },
          therapist: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      items: items.map((b) => ({
        id: b.id.toString(),
        bookingNo: b.bookingNo,
        contact: bookingContactView(b),
        user: b.user
          ? { id: b.user.id.toString(), name: b.user.name, phone: b.user.phone }
          : null,
        shop: b.shop
          ? {
              id: b.shop.id.toString(),
              name: b.shop.name,
              address: b.shop.address,
              city: b.shop.city,
              state: b.shop.state,
            }
          : null,
        service: b.service
          ? {
              ...historicalBookingService(b), id: b.service.id.toString(),
            }
          : null,
        therapist: b.therapist
          ? { id: b.therapist.id.toString(), name: b.therapist.name }
          : null,
        ...bookingLocalFields(b, b.shop?.timezone), bookingDate: b.bookingDate,
        startTime: b.startTime,
        endTime: b.endTime,
        durationMin: b.durationMin,
        priceCents: b.priceCents, ...bookingAddOnsView(b), ...bookingDurationMeta(b), items: durationItems(b),
        platformFeeCents: b.platformFeeCents,
        discountCents: b.discountCents,
        totalCents: b.totalCents,
        paidCents: b.paidCents,
        refundedCents: b.refundedCents,
        netPaidCents: b.paidCents - b.refundedCents,
        currency: b.currency,
        status: b.status,
        paymentStatus: b.paymentStatus,
        paymentId: b.paymentId,
        cancelReason: b.cancelReason,
        notes: b.notes,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
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
   * Get full booking detail including all related entities and audit logs.
   */
  async findOne(id: string) {
    const bid = BigInt(id);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bid },
      include: {
        items: true, addOns: true,
        user: {
          select: { id: true, name: true, phone: true, email: true, role: true, createdAt: true },
        },
        shop: {
          select: { id: true, name: true, nameEn: true, phone: true, address: true, city: true, state: true, zipCode: true, timezone: true },
        },
        service: {
          select: { id: true, name: true, category: true, durationMin: true, priceCents: true },
        },
        therapist: {
          select: { id: true, name: true, gender: true, title: true },
        },
        review: {
          select: { id: true, rating: true, content: true, createdAt: true },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Get related audit logs
    const auditLogs = await this.auditLogService.findByTarget('BOOKING', id);

    return {
      id: booking.id.toString(),
      bookingNo: booking.bookingNo,
      contact: bookingContactView(booking),
      user: booking.user
        ? {
            id: booking.user.id.toString(),
            name: booking.user.name,
            phone: booking.user.phone,
            email: booking.user.email,
            role: booking.user.role,
            registeredAt: booking.user.createdAt,
          }
        : null,
      shop: booking.shop
        ? {
            id: booking.shop.id.toString(),
            name: booking.shop.name,
            nameEn: booking.shop.nameEn,
            phone: booking.shop.phone,
            address: booking.shop.address,
            city: booking.shop.city,
            state: booking.shop.state,
            zipCode: booking.shop.zipCode,
          }
        : null,
      service: booking.service
        ? {
            ...historicalBookingService(booking), id: booking.service.id.toString(),
          }
        : null,
      therapist: booking.therapist
        ? {
            id: booking.therapist.id.toString(),
            name: booking.therapist.name,
            gender: booking.therapist.gender,
            title: booking.therapist.title,
          }
        : null,
      review: booking.review
        ? {
            id: booking.review.id.toString(),
            rating: booking.review.rating,
            content: booking.review.content,
            createdAt: booking.review.createdAt,
          }
        : null,
      ...bookingLocalFields(booking, booking.shop?.timezone), bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      durationMin: booking.durationMin,
      priceCents: booking.priceCents, ...bookingAddOnsView(booking), ...bookingDurationMeta(booking), items: durationItems(booking),
      platformFeeCents: booking.platformFeeCents,
      discountCents: booking.discountCents,
      totalCents: booking.totalCents,
      paidCents: booking.paidCents,
      refundedCents: booking.refundedCents,
      netPaidCents: booking.paidCents - booking.refundedCents,
      currency: booking.currency,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      paymentId: booking.paymentId,
      cancelReason: booking.cancelReason,
      notes: booking.notes,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      auditLogs,
    };
  }

  /**
   * Handle a dispute for a booking.
   *
   * Actions:
   * - REFUND: Full refund via payment service
   * - PARTIAL_REFUND: Partial refund (requires amount)
   * - DISMISS: Mark dispute as dismissed with reason
   */
  async handleDispute(id: string, dto: DisputeDto, operatorId: string, key?: string) {
    const bid = BigInt(id);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bid },
      include: {
        shop: { select: { id: true, ownerId: true } },
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (dto.action === 'REFUND' || dto.action === 'PARTIAL_REFUND') {
      if (dto.action === 'PARTIAL_REFUND' && (!Number.isSafeInteger(dto.amount) || dto.amount! <= 0)) {
        throw new BadRequestException('Refund amount must be a positive integer in cents');
      }
      return this.paymentService.refundBooking(id, operatorId, 'ADMIN', dto.action === 'PARTIAL_REFUND' ? dto.amount : undefined, key);
    }
    if (dto.action !== 'DISMISS') throw new BadRequestException('Unsupported dispute action');
    await this.auditLogService.create({action: 'DISPUTE_DISMISS',targetType: 'BOOKING',targetId: id,operatorId,detail: {reason: dto.reason}});
    return {message: 'Dispute dismissed', bookingNo: booking.bookingNo, action: 'DISMISS'};
  }
}
