import { normalizeServiceDuration, normalizeBookingListDuration, assertServiceDurationWrite, type ServiceDurationKind, type BookingDurationKind } from '../../../src/utils/serviceDuration';
import client from './client';
import { checkBookingOperationReceipt } from './bookingOperations';
import { errorMessage } from '../utils/feedback';
import { shopPermissions } from '../utils/shopPermissions';
import type { PriceMenuGroup } from '../../../src/utils/priceMenu';
import { requireDashboardData } from '../utils/dashboardReceipt';
import { requireFinancialTimezone } from '../utils/financialTime';
import { bookingServiceSummary } from '../../../src/utils/bookingReception';
import { savedTherapistRequest, type TherapistSelection } from '../utils/therapistSelection';

// ─── My Shops ─────────────────────────────────────────────────
export interface MyShop {
  id: string;
  isOwner: boolean;
  accessType: 'OWN' | 'ASSOCIATED' | 'STAFF' | 'ADMIN';
  homeShopId?: string | null;
  loginAccount?: { id: string; name?: string | null; loginName?: string | null; email?: string | null; status?: string } | null;
  permissions: string[];
  ownerId: string;
  name: string;
  shortName?: string;
  canonicalPath?: string | null;
  nameEn?: string | null;
  phone: string;
  /** Explicitly returned contact list; absent on older APIs or restricted views. */
  emails?: string[];
  address: string;
  city: string;
  state: string;
  zipCode: string;
  status: string;
  timezone?: string | null;
  shopType: string;
  businessHours?: Record<string, unknown> | null;
  description?: string | null;
  features?: { onlineBooking: boolean; reviews?: boolean };
  priceMenu?: PriceMenuGroup[];
  priceMenuRevision?: string;
  studioProfile?: Record<string, unknown>;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  gallery?: string[];
  media?: {logoUrl:string|null;coverUrl:string|null;galleryUrls:string[];posterUrl:string|null};
  createdAt: string;
  updatedAt: string;
}

export async function getMyShops(): Promise<MyShop[]> {
  const { data } = await client.get('/merchant/shops');
  const shops = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(shops)) throw new Error('无法核对授权门店列表。');
  const idText = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return shops.map((s: any) => {
    const id = idText(s?.id);
    if (!id || !['OWN','ASSOCIATED','STAFF','ADMIN'].includes(s.accessType) || !Array.isArray(s.permissions) || s.permissions.some((permission: any) => !shopPermissions.includes(permission))) throw new Error('无法核对门店权限，请刷新授权门店。');
    return { ...s, id, homeShopId: idText(s.homeShopId), isOwner: s.isOwner === true && ['OWN','ADMIN'].includes(s.accessType) };
  });
}

// ─── Dashboard ───────────────────────────────────────────────
export interface DashboardOverview {
  totalRevenue: number | null;
  totalFees: number | null;
  netRevenue: number | null;
  totalBookings: number;
  avgRating: number;
  totalReviews: number;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  bookings: number;
}

export interface TransactionItem {
  id: string;
  bookingId: string | null;
  type: 'PAYMENT' | 'REFUND' | 'PAYOUT';
  amount: number;
  fee: number;
  net: number;
  status: string;
  createdAt: string;
  description: string;
}

interface DashboardOperations {
  shopId: string;
  timezone: string;
  bookingStatusDistribution: { status: string; count: number }[];
}
type DashboardOperatingOverview = Omit<DashboardOverview, 'totalRevenue' | 'totalFees' | 'netRevenue'>;
export type DashboardData = DashboardOperations & ({
  ledgerConfigured: true;
  financeUnavailableReason: null;
  overview: DashboardOperatingOverview & { totalRevenue: number; totalFees: number; netRevenue: number };
  balanceCents: number;
  pendingCents: number;
  totalEarnedCents: number;
  dailyRevenue: DailyRevenue[];
  recentTransactions: TransactionItem[];
} | {
  ledgerConfigured: false;
  financeUnavailableReason: 'LEDGER_NOT_CONFIGURED';
  overview: DashboardOperatingOverview & { totalRevenue: null; totalFees: null; netRevenue: null };
  balanceCents: null;
  pendingCents: null;
  totalEarnedCents: null;
  dailyRevenue: null;
  recentTransactions: null;
});

export async function getShopDashboard(
  shopId: string,
  startDate?: string,
  endDate?: string,
  signal?: AbortSignal,
): Promise<DashboardData> {
  if (!/^[1-9]\d{0,19}$/.test(shopId)) throw new Error('门店编号无效，请重新选择门店。');
  const { data } = await client.get(`/merchant/shops/${shopId}/dashboard`, {
    params: { startDate, endDate },
    signal,
  });
  return requireDashboardData(data, shopId);
}

// ─── Bookings ─────────────────────────────────────────────────
export interface Booking extends TherapistSelection {
  contact?: unknown;
  orderOnly?: boolean; onlinePaymentEnabled?: boolean; pricingPolicy?: 'PER_ORDER'; paymentMode?: 'ONLINE' | 'PAY_AT_STORE' | 'ZERO';
  id: string;
  shopId: string;
  bookingNo: string;
  customerName: string;
  customerPhone: string;
  service: string;
  therapist: string;
  therapistId?: string | null;
  reception?: import('../../../src/utils/bookingReception').BookingReception;
  bookingDate: string;
  startTime: string;
  endTime: string;
  timezone?: string | null;
  localDate?: string | null;
  localStartTime?: string | null;
  localEndTime?: string | null;
  holdExpiresAt?: string | null;
  durationMin: number;
  durationKind?: BookingDurationKind;
  reservedDurationMin?: number;
  priceCents: number;
  discountCents: number;
  platformFeeCents?: number;
  tipCents?: number;
  reservationKind?: string;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  currency: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
}

export function mapBooking(b: any): Booking {
  const duration = normalizeBookingListDuration(b);
  const contact = b.contact?.recorded === true && b.contact?.version === 1 ? b.contact : null;
  return {
    id: String(b.id),
    orderOnly: typeof b.orderOnly === 'boolean' ? b.orderOnly : undefined,
    onlinePaymentEnabled: typeof b.onlinePaymentEnabled === 'boolean' ? b.onlinePaymentEnabled : undefined,
    pricingPolicy: b.pricingPolicy === 'PER_ORDER' ? 'PER_ORDER' : undefined,
    paymentMode: ['ONLINE', 'PAY_AT_STORE', 'ZERO'].includes(b.paymentMode) ? b.paymentMode : undefined,
    shopId: String(b.shopId),
    bookingNo: b.bookingNo,
    contact: b.contact,
    customerName: contact?.name || b.reception?.customer?.name || b.user?.name || '—',
    customerPhone: contact?.phone || b.reception?.customer?.phone || b.user?.phone || '',
    service: bookingServiceSummary(b),
    therapist: b.therapist?.name || '—',
    therapistId: typeof b.therapistId === 'string' ? b.therapistId : null,
    ...savedTherapistRequest(b),
    reception: b.reception,
    bookingDate: b.bookingDate,
    startTime: b.startTime,
    endTime: b.endTime,
    timezone: b.timezone,
    localDate: b.localDate,
    localStartTime: b.localStartTime,
    localEndTime: b.localEndTime,
    holdExpiresAt: b.holdExpiresAt,
    durationMin: b.durationMin,
    durationKind: duration.durationKind,
    reservedDurationMin: duration.reservedDurationMin,
    priceCents: b.priceCents,
    discountCents: b.discountCents ?? 0,
    platformFeeCents: b.platformFeeCents,
    tipCents: b.tipCents,
    reservationKind: b.reservationKind,
    totalCents: b.totalCents,
    paidCents: b.paidCents,
    refundedCents: b.refundedCents,
    currency: b.currency,
    status: b.status,
    paymentStatus: b.paymentStatus,
    createdAt: b.createdAt,
  };
}

export async function getShopBookings(
  shopId: string,
  status?: string,
  signal?: AbortSignal,
): Promise<Booking[]> {
  const { data } = await client.get(`/merchant/shops/${shopId}/bookings`, {
    params: status ? { status } : {},
    signal,
  });
  const list = Array.isArray(data) ? data : data?.items || [];
  return list.map(mapBooking);
}

export async function confirmBooking(bookingId: string, operationKey?: string): Promise<void> {
  const { data } = await client.post(`/merchant/bookings/${bookingId}/confirm`, {}, operationKey ? { headers: { 'Idempotency-Key': operationKey } } : undefined);
  if (operationKey) checkBookingOperationReceipt(data, bookingId, { status: 'CONFIRMED' });
}

export interface BookingListFilters {
  status?: string; paymentStatus?: string; paymentMode?: string;
  search?: string; startDate?: string; endDate?: string;
}
export interface BookingPageQuery extends BookingListFilters { page: number; pageSize: number }
export interface BookingPage { shopId: string; items: Booking[]; total: number; page: number; pageSize: number; totalPages: number }

/** Explicitly opt into server pagination. Never turn an unpaged array into a fake page. */
export async function getShopBookingPage(shopId: string, query: BookingPageQuery, signal?: AbortSignal): Promise<BookingPage> {
  const { data } = await client.get(`/merchant/shops/${encodeURIComponent(shopId)}/bookings`, { params: query, signal });
  if (!data || Array.isArray(data) || String(data.shopId) !== shopId || !Array.isArray(data.items)
    || !Number.isSafeInteger(data.total) || data.total < 0 || data.page !== query.page || data.pageSize !== query.pageSize
    || data.totalPages !== Math.ceil(data.total / query.pageSize) || data.items.length > query.pageSize
    || data.items.some((item: any) => !item || String(item.shopId) !== shopId || !/^[1-9]\d*$/.test(String(item.id)))) {
    throw new Error('无法核对当前门店的预约列表，请刷新核对。');
  }
  return { ...data, shopId, items: data.items.map(mapBooking) };
}

export async function completeBooking(bookingId: string, operationKey?: string): Promise<void> {
  const { data } = await client.post(`/merchant/bookings/${bookingId}/complete`, {}, operationKey ? { headers: { 'Idempotency-Key': operationKey } } : undefined);
  if (operationKey) checkBookingOperationReceipt(data, bookingId, { status: 'COMPLETED' });
}

export interface AssistedCustomer { id: string; name: string; email: string; phone: string | null; }
export interface AssistedBookingService { id: string; name: string; durationMin: number; hasVariants: boolean; isActive: boolean; variants: { id: string; name: string; durationMin: number; priceCents: number; isActive: boolean }[]; }
export interface AssistedBookingInput {
  customerId: string; serviceId: string; variantId?: string; date: string; startTime: string;
  /** Required for a new order; absent only when replaying a legacy saved command. */
  contact?: { name: string; phone: string; email: string };
  durationMin?: number; notes?: string; preferredTherapistIds?: string[];
}
export interface AssistedBookingQuote extends Record<string, unknown> { quoteHash: string; quoteExpiresAt: string; totalCents: number; currency: string; }
export interface AssistedBookingSlots { timezone: string; durationMin: number; slots: { time: string; available: boolean }[]; }
export async function getAssistedBookingServices(shopId: string, signal?: AbortSignal): Promise<AssistedBookingService[]> {
  const { data } = await client.get(`/merchant/shops/${encodeURIComponent(shopId)}/booking-services`, { signal });
  if (!Array.isArray(data) || data.some((row: any) => !/^[1-9]\d*$/.test(String(row?.id)) || row.isActive !== true
    || !Array.isArray(row.variants) || typeof row.hasVariants !== 'boolean' || !Number.isInteger(row.durationMin))) throw new Error('无法核对本店可预约服务。');
  return data;
}
export async function getAssistedBookingSlots(shopId: string, serviceId: string, date: string, variantId?: string, signal?: AbortSignal): Promise<AssistedBookingSlots> {
  const { data } = await client.get(`/merchant/shops/${encodeURIComponent(shopId)}/assisted-slots`, { params: { serviceId, date, ...(variantId ? { variantId } : {}) }, signal });
  if (String(data?.date) !== date || typeof data?.timezone !== 'string' || !Array.isArray(data?.slots)
    || data.slots.some((slot: any) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot?.time) || typeof slot?.available !== 'boolean')) {
    throw new Error('无法核对门店可预约时段。');
  }
  return { timezone: data.timezone, durationMin: data.durationMin, slots: data.slots };
}
export async function searchAssistedCustomers(shopId: string, search: string, signal?: AbortSignal): Promise<AssistedCustomer[]> {
  const { data } = await client.get(`/merchant/shops/${encodeURIComponent(shopId)}/customers`, { params: { search }, signal });
  if (!Array.isArray(data)) throw new Error('无法核对本店历史客户。');
  return data.map((row: any) => ({ id: String(row.id), name: String(row.name ?? ''), email: String(row.email ?? ''), phone: row.phone ?? null }));
}
export async function quoteAssistedBooking(shopId: string, input: AssistedBookingInput): Promise<AssistedBookingQuote> {
  const { data } = await client.post(`/merchant/shops/${encodeURIComponent(shopId)}/assisted-quote`, input);
  if (!data || typeof data.quoteHash !== 'string' || typeof data.quoteExpiresAt !== 'string' || !Number.isSafeInteger(data.totalCents)) throw new Error('无法核对代客预约报价。');
  return data;
}
export async function createAssistedBooking(shopId: string, input: AssistedBookingInput & { requestKey: string; quoteHash: string; quoteExpiresAt: string }) {
  const { data } = await client.post(`/merchant/shops/${encodeURIComponent(shopId)}/assisted-bookings`, input);
  if (!/^[1-9]\d*$/.test(String(data?.id)) || String(data.shopId) !== shopId
    || typeof data.bookingNo !== 'string' || !data.bookingNo.trim() || data.bookingNo.length > 100 || /[\p{Cc}\p{Cs}]/u.test(data.bookingNo)) throw new Error('预约创建结果尚未确认，请使用原请求核对订单。');
  return data;
}

// ─── Services ─────────────────────────────────────────────────
export interface ServiceItem {
  hasVariants?: boolean;
  id: string;
  name: string;
  nameEn?: string | null;
  category: string;
  durationKind?: ServiceDurationKind;
  reservedDurationMin?: number;
  durationMin: number;
  priceCents: number;
  description: string | null;
  isActive: boolean;
}

export async function getShopServices(shopId: string, signal?: AbortSignal): Promise<ServiceItem[]> {
  const { data } = await client.get(`/merchant/shops/${shopId}/services`, { signal });
  const list = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(list)) throw new Error('无法核对服务列表，请刷新当前门店。');
  return list.map((s: ServiceItem) => normalizeServiceDuration(catalogResult<ServiceItem>(s, undefined, shopId)));
}

export interface CreateServiceDto {
  name: string;
  nameEn?: string;
  category?: string;
  durationKind?: ServiceDurationKind;
  durationMin: number;
  priceCents: number;
  description?: string;
  isActive?: boolean;
}

function catalogResult<T extends { id: string }>(data: T, expectedId?: string, shopId?: string): T {
  const value: unknown = data?.id;
  const id = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n || expectedId && id !== expectedId
    || shopId && (data as { shopId?: unknown }).shopId != null && String((data as { shopId?: unknown }).shopId) !== shopId) {
    throw new Error('无法核对保存结果，请保留草稿并刷新列表后再执行。');
  }
  return { ...data, id };
}

export async function createService(
  shopId: string,
  dto: CreateServiceDto,
): Promise<ServiceItem> {
  assertServiceDurationWrite(dto, true);
  const { data } = await client.post(`/merchant/shops/${shopId}/services`, dto);
  if (typeof data?.id !== 'string') throw new Error('无法核对保存结果，结果未知；请先核对列表，不要重复创建。');
  if (typeof data.durationKind !== 'string' || !['TIMED', 'PER_SESSION', 'VARIABLE'].includes(data.durationKind) || data.durationKind !== (dto.durationKind ?? 'TIMED')) throw new Error('无法核对保存结果中的服务类型，结果未知；请先核对列表，不要重复创建。');
  const saved = normalizeServiceDuration(catalogResult<ServiceItem>(data, undefined, shopId));
  if (saved.durationKind !== (dto.durationKind ?? 'TIMED') || saved.durationMin !== dto.durationMin) throw new Error('无法核对服务类型和预约预留时间，草稿已保留，请刷新核对，勿直接重复新增。');
  return saved;
}

export async function updateService(
  serviceId: string,
  dto: Partial<CreateServiceDto> & { isActive?: boolean },
): Promise<ServiceItem> {
  assertServiceDurationWrite(dto, false);
  const { data } = await client.patch(`/merchant/services/${serviceId}`, dto);
  const saved = normalizeServiceDuration(catalogResult<ServiceItem>(data, serviceId));
  if (dto.durationKind !== undefined && saved.durationKind !== dto.durationKind || dto.durationMin !== undefined && saved.durationMin !== dto.durationMin) throw new Error('无法核对服务类型和预约预留时间，请刷新核对。');
  return saved;
}

export async function deleteService(serviceId: string): Promise<void> {
  await client.delete(`/merchant/services/${serviceId}`);
}

// ─── Technicians (Therapists) ─────────────────────────────────
export interface Technician {
  id: string;
  name: string;
  avatarUrl: string | null;
  title: string | null;
  bio: string | null;
  yearsExp: number;
  gender: string | null;
  isActive: boolean;
  /** Legacy response metadata only; it does not limit this shop member's services. */
  serviceIds: string[];
}

export async function getShopTherapists(shopId: string, signal?: AbortSignal): Promise<Technician[]> {
  const { data } = await client.get(`/merchant/shops/${shopId}/therapists`, { signal });
  const list = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(list)) throw new Error('无法核对技师列表，请刷新当前门店。');
  return list.map((t: Technician) => ({ ...catalogResult<Technician>(t, undefined, shopId), serviceIds: (t.serviceIds || []).map(String) }));
}

export interface CreateTechnicianDto {
  name: string;
  avatarUrl?: string;
  title?: string;
  bio?: string;
  yearsExp?: number;
  gender?: string | null;
}

function technicianWritePayload(dto: object): Record<string, unknown> {
  const payload = { ...dto } as Record<string, unknown>;
  // Old callers may still carry response-only links. Store staff now serve the
  // whole shop, so neither create nor edit can write legacy per-service links.
  delete payload.serviceIds;
  return payload;
}

export async function createTechnician(
  shopId: string,
  dto: CreateTechnicianDto,
): Promise<Technician> {
  const { data } = await client.post(`/merchant/shops/${shopId}/therapists`, technicianWritePayload(dto));
  return catalogResult<Technician>(data, undefined, shopId);
}

export async function updateTechnician(
  therapistId: string,
  dto: Partial<CreateTechnicianDto> & { isActive?: boolean },
): Promise<Technician> {
  const { data } = await client.patch(`/merchant/therapists/${therapistId}`, technicianWritePayload(dto));
  return catalogResult<Technician>(data, therapistId);
}

export async function deleteTechnician(therapistId: string): Promise<void> {
  await client.delete(`/merchant/therapists/${therapistId}`);
}

// ─── Earnings / Payouts ───────────────────────────────────────
export interface PayoutRequestResult {
  success: boolean;
  amountCents: number;
  amountFormatted: string;
  status: string;
  message: string;
  remainingBalance: number;
}

export interface TransactionPage {
  shopId: string;
  timezone: string;
  items: TransactionItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AnnualLedger {
  shopId: string;
  timezone: string;
  year: number;
  total_gross: number;
  total_platform_fees: number;
  total_refunds: number;
  total_net: number;
  total_payouts: number;
  net_earnings: number;
}

export interface LedgerCsv {
  blob: Blob;
  filename: string;
}

export async function getTransactions(params: {
  shopId: string;
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}, signal?: AbortSignal): Promise<TransactionPage> {
  const { data } = await client.get('/merchant/transactions', { params, signal });
  if (String(data?.shopId) !== params.shopId) throw new Error('交易响应与当前门店不符。');
  return { ...data, timezone: requireFinancialTimezone(data?.timezone) };
}

export async function getAnnualLedger(shopId: string, year: number, signal?: AbortSignal): Promise<AnnualLedger> {
  const { data } = await client.get('/merchant/tax-report', { params: { shopId, year }, signal });
  if (String(data?.shopId) !== shopId) throw new Error('年度账本与当前门店不符。');
  const timezone = requireFinancialTimezone(data?.timezone);
  if (!Number.isInteger(data?.year) || data.year !== year) throw new Error('年度账本与所选门店年份不符，请重新加载。');
  return { ...data, timezone };
}

export async function getAnnualLedgerCsv(shopId: string, year: number, signal?: AbortSignal): Promise<LedgerCsv> {
  try {
    const response = await client.get('/merchant/tax-report/export', {
      params: { shopId, year }, signal, responseType: 'blob', headers: { Accept: 'text/csv' },
    });
    if (!String(response.headers['content-type'] || '').toLowerCase().startsWith('text/csv') || !(response.data instanceof Blob)) {
      throw new Error('服务器未返回账本CSV文件。');
    }
    return { blob: response.data, filename: `ledger-${shopId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${year}.csv` };
  } catch (error: any) {
    // Axios keeps JSON error responses as a Blob when responseType is blob.
    if (error?.response?.data instanceof Blob) {
      let body: any;
      try { body = JSON.parse(await error.response.data.text()); } catch { /* keep original failure */ }
      const message = body?.error?.message || body?.message;
      if (message) throw new Error(errorMessage({ response: { status: error.response.status, data: body } }, '无法导出账本，请稍后重试。'));
    }
    throw error;
  }
}

export async function requestPayout(amountCents: number): Promise<PayoutRequestResult> {
  const { data } = await client.post('/merchant/payout', { amountCents });
  return data;
}

export async function getStripeOnboardingStatus(): Promise<{
  isCompleted: boolean;
  stripeAccountId?: string | null;
  shopId?: string | null;
}> {
  const { data } = await client.get('/merchant/stripe/onboarding-status');
  return data;
}

// ─── Shop profile (Settings) ──────────────────────────────────
export async function updateShopProfile(
  shopId: string,
  dto: Partial<{
    name: string;
    nameEn: string;
    phone: string;
    emails: string[];
    address: string;
    city: string;
    state: string;
    zipCode: string;
    description: string;
    priceMenu: PriceMenuGroup[];
    expectedPriceMenuRevision: string;
    catalogSelectionPreconditions: import('../../../src/utils/catalogSelection').CatalogSelectionPrecondition[];
    logoUrl: string;
    bannerUrl: string;
    gallery: string[];
  }>,
): Promise<MyShop> {
  const { data } = await client.patch(`/merchant/shops/${shopId}`, dto);
  return data;
}
