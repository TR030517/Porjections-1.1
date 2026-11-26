/**
 * MJAPP — UserManage Service
 *
 * Service layer for admin user management:
 * - Paginated user listing with search and status filter
 * - User detail with recent bookings and reviews
 * - Status updates (ACTIVE / SUSPENDED / DELETED) with audit logging
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { UserManageQueryDto, UpdateUserStatusDto } from './dto/user-manage.dto';
import { lockAdministratorStatus, requireAnotherActiveAdministrator } from '../../common/administrator-status';

@Injectable()
export class UserManageService {
  private readonly logger = new Logger(UserManageService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Paginated user listing with optional search and status filter.
   *
   * - `search`: fuzzy match on phone or email
   * - `status`: filter by ACTIVE / SUSPENDED / DELETED
   * - `page` / `limit`: pagination
   */
  async findAll(query: UserManageQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Status filter
    if (query.status) {
      where.status = query.status;
    }

    // Search by phone or email (fuzzy)
    if (query.search) {
      where.OR = [
        { phone: { contains: query.search } },
      ];
      // Only add email search if the value looks like an email
      if (query.search.includes('@')) {
        where.OR.push({ email: { contains: query.search } });
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phone: true,
          email: true,
          name: true,
          avatarUrl: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((user) => ({
        id: user.id.toString(),
        phone: user.phone,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
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
   * User detail including:
   * - Basic profile information
   * - Recent 10 bookings (with shop name and service name)
   * - Recent reviews
   */
  async findOne(id: string) {
    const userId = this.parseId(id);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        merchantProfiles: {
          select: {
            id: true,
            shopId: true,
            stripeOnboarding: true,
            balanceCents: true,
            pendingCents: true,
            totalEarnedCents: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }

    // Fetch recent 10 bookings with shop name and service name
    const recentBookings = await this.prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        bookingNo: true,
        status: true,
        priceCents: true,
        totalCents: true,
        paidCents: true,
        refundedCents: true,
        currency: true,
        paymentStatus: true,
        bookingDate: true,
        createdAt: true,
        shop: {
          select: { id: true, name: true },
        },
        service: {
          select: { id: true, name: true },
        },
      },
    });

    // Fetch recent reviews
    const recentReviews = await this.prisma.review.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        rating: true,
        content: true,
        isPublic: true,
        isFlagged: true,
        createdAt: true,
        shop: {
          select: { id: true, name: true },
        },
        booking: {
          select: { bookingNo: true },
        },
      },
    });

    return {
      ...user,
      id: user.id.toString(),
      merchantProfiles: user.merchantProfiles.map(profile => ({ ...profile, id: profile.id.toString(), shopId: profile.shopId.toString() })),
      recentBookings: recentBookings.map((b) => ({
        id: b.id.toString(),
        bookingNo: b.bookingNo,
        status: b.status,
        priceCents: b.priceCents,
        totalCents: b.totalCents,
        paidCents: b.paidCents,
        refundedCents: b.refundedCents,
        netPaidCents: b.paidCents - b.refundedCents,
        currency: b.currency,
        paymentStatus: b.paymentStatus,
        bookingDate: b.bookingDate,
        createdAt: b.createdAt,
        shopName: b.shop.name,
        serviceName: b.service.name,
      })),
      recentReviews: recentReviews.map((r) => ({
        id: r.id.toString(),
        rating: r.rating,
        content: r.content,
        isPublic: r.isPublic,
        isFlagged: r.isFlagged,
        createdAt: r.createdAt,
        shopName: r.shop.name,
        bookingNo: r.booking.bookingNo,
      })),
    };
  }

  /**
   * Update user status (ACTIVE / SUSPENDED / DELETED).
   * Records the action in AuditLog.
   */
  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    operatorId: string,
  ) {
    const userId = this.parseId(id);

    const operator = this.parseId(operatorId);
    if (userId === operator && dto.status !== 'ACTIVE') {
      throw new BadRequestException('Administrators cannot disable their own account');
    }
    const updated = await this.prisma.$transaction(async tx => {
      const candidate = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!candidate) throw new NotFoundException(`User #${id} not found`);
      const activeAdministratorIds = candidate.role === 'ADMIN'
        ? await lockAdministratorStatus(tx, userId, operator)
        : null;
      // Share this lock order with authentication so no session is issued after revocation.
      if (!activeAdministratorIds) await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
      const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
      if (!user) throw new NotFoundException(`User #${id} not found`);
      if (user.status === 'DELETED') throw new BadRequestException('User is already deleted');
      if (user.role === 'ADMIN' && user.status === 'ACTIVE' && dto.status !== 'ACTIVE') {
        requireAnotherActiveAdministrator(activeAdministratorIds ?? [], userId);
      }
      const result = await tx.user.update({
        where: { id: userId },
        data: { status: dto.status as any, ...(dto.status === 'DELETED' ? { deletedAt: new Date() } : {}) },
        select: { id: true, phone: true, email: true, name: true, role: true, status: true, updatedAt: true },
      });
      const revoked = dto.status === 'ACTIVE' ? { count: 0 } : await tx.authSession.updateMany({
        where: { userId, revokedAt: null }, data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({ data: {
        action: `USER_${dto.status}`, targetType: 'USER', targetId: userId, operatorId: operator,
        detail: { previousStatus: user.status, newStatus: dto.status, reason: dto.reason || null, revokedSessions: revoked.count },
      } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    this.logger.log(`User #${id} status changed to ${dto.status} by admin #${operatorId}`);
    return { ...updated, id: updated.id.toString() };
  }
  /**
   * Parse string ID to BigInt with validation.
   */
  private parseId(id: string): bigint {
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) throw new BadRequestException('Invalid user ID');
    return BigInt(id);
  }
}
