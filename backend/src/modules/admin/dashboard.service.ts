import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(range: 'day' | 'week' | 'month' | 'year') {
    if (!['day', 'week', 'month', 'year'].includes(range)) throw new BadRequestException('Invalid range');
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = this.getRangeStart(now, range);
    const [userCount, newUsersToday, shopCount, bookingCount, todayBookingCount, totals, todayTotals, currencies, gmvTrend, statusDist, topShops] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: today } } }),
      this.prisma.shop.count({ where: { status: 'APPROVED', deletedAt: null } }),
      this.prisma.booking.count({ where: { deletedAt: null } }),
      this.prisma.booking.count({ where: { deletedAt: null, createdAt: { gte: today } } }),
      // Financial history is retained regardless of booking status or soft deletion.
      this.prisma.booking.aggregate({ _sum: { paidCents: true, refundedCents: true } }),
      this.prisma.booking.aggregate({ where: { createdAt: { gte: today } }, _sum: { paidCents: true, refundedCents: true } }),
      this.prisma.booking.groupBy({ by: ['currency'], where: { paidCents: { gt: 0 } }, _sum: { paidCents: true, refundedCents: true } }),
      this.getGmvTrend(start, now), this.getBookingStatusDistribution(), this.getTopShops(start, now),
    ]);
    const paidCents = totals._sum.paidCents ?? 0, refundedCents = totals._sum.refundedCents ?? 0;
    const todayPaidCents = todayTotals._sum.paidCents ?? 0, todayRefundedCents = todayTotals._sum.refundedCents ?? 0;
    // Legacy gmv fields are aliases for net collected cents, never the quoted price.
    // Daily series describe booking-created cohorts, not the cash settlement date.
    const mixed = currencies.length > 1;
    return { userCount, newUsersToday, shopCount, bookingCount, todayBookingCount,
      paidCents: mixed ? null : paidCents, refundedCents: mixed ? null : refundedCents,
      netPaidCents: mixed ? null : paidCents - refundedCents,
      gmv: mixed ? null : paidCents - refundedCents, todayGmv: mixed ? null : todayPaidCents - todayRefundedCents,
      todayPaidCents: mixed ? null : todayPaidCents, todayRefundedCents: mixed ? null : todayRefundedCents,
      currency: currencies.length === 1 ? currencies[0].currency : null,
      totalsByCurrency: currencies.map(c => ({ currency: c.currency, paidCents: c._sum.paidCents ?? 0, refundedCents: c._sum.refundedCents ?? 0, netPaidCents: (c._sum.paidCents ?? 0) - (c._sum.refundedCents ?? 0) })),
      amountBasis: 'paidCents-refundedCents', trendBasis: 'booking-created-utc',
      gmvTrend: mixed ? [] : gmvTrend, bookingStatusDist: statusDist, topShops: mixed ? [] : topShops };
  }
  private getRangeStart(now: Date, range: string): Date {
    const d = new Date(now);
    if (range === 'day') d.setUTCDate(d.getUTCDate() - 7);
    if (range === 'week') d.setUTCDate(d.getUTCDate() - 28);
    if (range === 'month') d.setUTCMonth(d.getUTCMonth() - 6);
    if (range === 'year') d.setUTCFullYear(d.getUTCFullYear() - 1);
    d.setUTCHours(0, 0, 0, 0); return d;
  }
  private async getGmvTrend(start: Date, end: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ dateStr: string | Date; total: bigint }>>(Prisma.sql`
      SELECT DATE(created_at) AS dateStr, COALESCE(SUM(paid_cents - refunded_cents), 0) AS total
      FROM bookings WHERE paid_cents > 0 AND created_at >= ${start} AND created_at <= ${end}
      GROUP BY DATE(created_at) ORDER BY dateStr ASC`);
    return rows.map(r => ({ date: typeof r.dateStr === 'string' ? r.dateStr : r.dateStr.toISOString().slice(0, 10), value: Number(r.total) }));
  }
  private async getBookingStatusDistribution() {
    return Promise.all(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'].map(async status => ({
      status, count: await this.prisma.booking.count({ where: { status: status as BookingStatus, deletedAt: null } }),
    })));
  }
  private async getTopShops(start: Date, end: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ shopId: bigint; total: bigint; count: bigint }>>(Prisma.sql`
      SELECT shop_id AS shopId, COALESCE(SUM(paid_cents - refunded_cents), 0) AS total, COUNT(id) AS count
      FROM bookings WHERE paid_cents > 0 AND created_at >= ${start} AND created_at <= ${end}
      GROUP BY shop_id ORDER BY total DESC LIMIT 10`);
    if (!rows.length) return [];
    const shops = await this.prisma.shop.findMany({ where: { id: { in: rows.map(r => r.shopId) } }, select: { id: true, name: true } });
    const names = new Map(shops.map(s => [s.id.toString(), s.name]));
    return rows.map(r => ({ id: r.shopId.toString(), name: names.get(r.shopId.toString()) ?? `Shop #${r.shopId}`, gmv: Number(r.total), orderCount: Number(r.count) }));
  }
}