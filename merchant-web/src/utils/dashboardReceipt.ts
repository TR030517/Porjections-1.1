import type { DashboardData, DailyRevenue, TransactionItem } from '../api/merchant';
import { requireFinancialTimezone } from './financialTime';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const count = (value: unknown): value is number => integer(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const bookingStatuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'];
const need = (value: unknown): void => { if (!value) throw new Error('无法核对当前门店经营概览，请重试。'); };

/** Missing finance is distinct from a configured, empty ledger. Never fill null
 * with zero, coerce strings, or accept another shop's dashboard receipt. */
export function requireDashboardData(raw: unknown, expectedShopId: string): DashboardData {
  if (!record(raw) || !id(raw.shopId) || raw.shopId !== expectedShopId) throw new Error('经营概览与当前门店不符，请重新加载。');
  const value = raw, overview = value.overview;
  if (!record(overview)) throw new Error('无法核对当前门店经营概览，请重试。');
  need(count(overview.totalBookings) && count(overview.totalReviews)
    && typeof overview.avgRating === 'number' && Number.isFinite(overview.avgRating) && overview.avgRating >= 0 && overview.avgRating <= 5);
  const distribution = value.bookingStatusDistribution;
  need(Array.isArray(distribution) && distribution.every(row => record(row) && typeof row.status === 'string' && bookingStatuses.includes(row.status) && count(row.count)));
  const rows = distribution as { status: string; count: number }[];
  need(new Set(rows.map(row => row.status)).size === rows.length);
  const operating = {
    shopId: expectedShopId,
    timezone: requireFinancialTimezone(value.timezone),
    bookingStatusDistribution: rows.map(row => ({ status: row.status, count: row.count })),
  };
  const ratings = { totalBookings: overview.totalBookings as number, avgRating: overview.avgRating as number, totalReviews: overview.totalReviews as number };
  if (value.ledgerConfigured === false) {
    need(value.financeUnavailableReason === 'LEDGER_NOT_CONFIGURED'
      && ['totalRevenue', 'totalFees', 'netRevenue'].every(key => overview[key] === null)
      && ['balanceCents', 'pendingCents', 'totalEarnedCents', 'dailyRevenue', 'recentTransactions'].every(key => value[key] === null));
    return { ...operating, ledgerConfigured: false, financeUnavailableReason: 'LEDGER_NOT_CONFIGURED',
      overview: { ...ratings, totalRevenue: null, totalFees: null, netRevenue: null },
      balanceCents: null, pendingCents: null, totalEarnedCents: null, dailyRevenue: null, recentTransactions: null };
  }
  need(value.ledgerConfigured === true && value.financeUnavailableReason === null
    && ['totalRevenue', 'totalFees', 'netRevenue'].every(key => integer(overview[key]))
    && ['balanceCents', 'pendingCents', 'totalEarnedCents'].every(key => integer(value[key])));
  need(Array.isArray(value.dailyRevenue) && value.dailyRevenue.every(row => record(row)
    && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
    && Number.isFinite(Date.parse(row.date)) && new Date(row.date).toISOString().slice(0, 10) === row.date
    && integer(row.revenue) && count(row.bookings)));
  need(Array.isArray(value.recentTransactions) && value.recentTransactions.every(row => record(row)
    && id(row.id) && (row.bookingId === null || id(row.bookingId))
    && ['PAYMENT', 'REFUND', 'PAYOUT'].includes(row.type as string)
    && ['amount', 'fee', 'net'].every(key => integer(row[key]))
    && typeof row.status === 'string' && !!row.status.trim()
    && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)) && typeof row.description === 'string'));
  return { ...operating, ledgerConfigured: true, financeUnavailableReason: null,
    overview: { ...ratings, totalRevenue: overview.totalRevenue as number, totalFees: overview.totalFees as number, netRevenue: overview.netRevenue as number },
    balanceCents: value.balanceCents as number, pendingCents: value.pendingCents as number, totalEarnedCents: value.totalEarnedCents as number,
    dailyRevenue: (value.dailyRevenue as DailyRevenue[]).map(row => ({ date: row.date, revenue: row.revenue, bookings: row.bookings })),
    recentTransactions: (value.recentTransactions as TransactionItem[]).map(row => ({ id: row.id, bookingId: row.bookingId, type: row.type, amount: row.amount, fee: row.fee, net: row.net, status: row.status, createdAt: row.createdAt, description: row.description })) };
}
