import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { enqueueNotification, enqueueBookingOrderEmail, syncBookingReminder, NotificationTopic } from '../../common/notification-outbox';
import { NotificationService } from '../notifications/notification.service';
import { CouponsService } from '../coupons/coupons.service';
import { cents, feeCents, numericId, quoteCents } from '../payment/money';
import { localInstant, localParts, bookingLocalFields } from './time';
import { coveredByOpeningHours, openingIntervals } from './hours';
import { requirePublicShop } from '../../common/shop-eligibility';
import { shopPaymentPolicy } from '../../common/shop-payment-policy';
import { fullySettled, settlementMode, offlineFulfilmentAllowed } from './settlement.rules';
import { normalizePlan, PlanInput, PlanSelection, allocatePlan, PlanAssignment, priceBasis, servicePrice, participantPrices, tipAmount } from './booking-plan';
import { publicShopProfile } from '../../common/shop-public-profile';
import { requireShopAccess, type ShopActor } from '../../common/shop-access';
import { BookingListQuery, BOOKING_LIST_ORDER, bookingListResult, bookingListWhere, parseBookingListQuery } from './booking-list.query';
import { allocate, AllocationContext, overlapsShopBlock, preferredIds, wallInterval } from './availability';
import { effectiveWeeklyShifts, workIntervals } from './work-schedule';
import { expireShopHolds, holdMinutes, lockShop, releaseReservation, reservationTransaction, restoreBookingCoupon } from './lifecycle';
import { AddOnSelection, normalizeAddOnSelections, resolveBookingAddOns, publicAddOnCandidates, persistBookingAddOns, signBookingAddOnQuote, requireBookingAddOnQuote } from './booking-addons';
import { bookingAddOnsView } from '../../common/booking-addons-view';
import { bookingItemRoomId, bookingReception } from '../../common/booking-reception';
import { readDurationKind, validReservedDurationMin, itemDurationMeta, bookingDurationMeta, type ServiceDurationKind } from '../../common/service-duration';
import { effectiveBookingWhere, resourceBookingWhere } from '../reservations/configuration-guard';
import { BOOKING_PRICE_BASIS, bookingOrderPolicy, bookingOnlinePaymentEnabled, newBookingPaymentMode } from '../../common/order-mode';
import { customerOrderEmail, requireCustomerOrderEmail } from '../../common/booking-order-email';
import { bookingCalendar } from '../../common/booking-calendar';
import { isShopClosedOnDate, isShopClosedDuring, readShopBookingSettings, meetsShopBookingNotice } from '../../common/shop-booking-settings';
import { activeReservationOptions, hasPublicReservationOptions, hasServiceVariants, serviceDisplaySource } from '../../common/service-reservation-options';
import { historicalBookingService } from '../../common/booking-service-snapshot';
import { completeStoredPlanItems, storedPlanPreparationMin } from '../../common/booking-service-windows';
import { bookingOperation, bookingOperationKey, reconcileBookingOperation } from './booking-operation';
import { BookingContactInput, normalizeBookingContact, normalizeGuestBookingContact, guestBookingContactSnapshot, requireVerifiedBookingContact, bookingContactView } from '../../common/booking-contact';
import { newTherapistSelection, savedTherapistSelection, rescheduleTherapistSelection, planTherapistSelection, requestedTherapistUnavailable } from './therapist-selection';

type Selection = { shopId: string; serviceId: string; variantId?: string; therapistId?: string; preferredTherapistIds?: string[]; date: string };
type AddOnInput = { addOnSelections?: AddOnSelection[]; quoteHash?: string; quoteExpiresAt?: string };
type CreateInput = Selection & AddOnInput & { contact?: BookingContactInput; userId: string; startTime: string; durationMin?: number; notes?: string; couponId?: string; requestKey?: string; paymentMode?: 'ONLINE' | 'PAY_AT_STORE'; tipCents?: number };
type CreatePlanInput = PlanInput & AddOnInput & { contact?: BookingContactInput; userId: string; startTime: string; requestKey: string; paymentMode?: 'ONLINE' | 'PAY_AT_STORE'; couponId?: string; notes?: string; tipCents?: number };
type AssistedSelection = Selection & AddOnInput & { contact?: BookingContactInput; customerId: string; startTime: string; durationMin?: number; notes?: string; requestKey?: string; quoteHash?: string; quoteExpiresAt?: string };
type GuestAssistedSelection = Selection & AddOnInput & { contact: { name: string; phone: string; email?: string | null }; guestSource: 'PHONE' | 'WALK_IN'; startTime: string; durationMin?: number; notes?: string; requestKey?: string };
type Snapshot = { durationKind?: ServiceDurationKind; duration: number; unitPrice: number; count: number; staffCount?: number; staffBuffer: number; roomBuffer: number; roomType: string | null; currency: string; priceBasis?: string };
const DETAIL = { shop: true, service: true, therapist: true, review: true, items: true, addOns: true, resourceLocks: true };
const orderInputRequired = (error: unknown): boolean => error instanceof BadRequestException
  && ['ORDER_EMAIL_REQUIRED', 'ORDER_EMAIL_VERIFICATION_REQUIRED', 'ORDER_TIP_NOT_SUPPORTED', 'BOOKING_CONTACT_INVALID'].includes((error.getResponse() as any)?.code);

@Injectable()
export class BookingService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private expiring = false;
  private readonly logger = new Logger(BookingService.name);
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentService,
    private readonly notifications: NotificationService, private readonly coupons: CouponsService) {}
  onModuleInit() {
    holdMinutes();
    this.timer = setInterval(() => { void this.expirePendingHolds().catch(() => this.logger.warn('Reservation expiry will retry on its next run')); }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async assistedBookingCustomers(actor: ShopActor, shopIdValue: string, searchValue: string) {
    const shopId = numericId(shopIdValue), search = typeof searchValue === 'string' ? searchValue.trim() : '';
    if (search.length < 2 || search.length > 100 || /[\u0000-\u001f\u007f]/.test(search)) throw new BadRequestException('请输入至少2个字符查找客户');
    return this.prisma.$transaction(async tx => {
      const access = await requireShopAccess(tx, shopId, actor, 'BOOKINGS_MANAGE');
      if (access.shop.status !== 'APPROVED') throw new BadRequestException('门店尚未发布，暂不能创建预约');
      const rows: any[] = await tx.user.findMany({ where: { role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null, emailVerifiedAt: { not: null }, email: { not: null },
        bookings: { some: { shopId, deletedAt: null } }, OR: [{ name: { contains: search } }, { email: { contains: search } }, { phone: { contains: search } }] },
        select: { id: true, name: true, email: true, phone: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 20 });
      return rows.filter(row => customerOrderEmail(row.email)).map(row => ({ id: row.id.toString(), name: row.name ?? '', email: customerOrderEmail(row.email)!, phone: row.phone ?? null }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async assistedBookingServices(actor: ShopActor, shopIdValue: string) {
    const shopId = numericId(shopIdValue);
    const access = await requireShopAccess(this.prisma, shopId, actor, 'BOOKINGS_MANAGE');
    if (access.shop.status !== 'APPROVED') throw new BadRequestException('门店尚未发布，暂不能创建预约');
    const rows = await this.prisma.shopService.findMany({ where: { shopId, isActive: true }, select: {
      id: true, shopId: true, name: true, isActive: true, durationKind: true, durationMin: true, priceCents: true,
      participantCount: true, requiredStaffCount: true, priceBasis: true,
      _count: { select: { variants: true } },
      variants: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, serviceId: true, name: true, durationMin: true, priceCents: true, priceBasis: true, currency: true, isActive: true, sortOrder: true } },
    }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return rows.filter(hasPublicReservationOptions).map(service => {
      const display = serviceDisplaySource(service);
      const hasVariants = hasServiceVariants(service);
      return { id: service.id.toString(), name: service.name, isActive: true,
        participantCount: service.participantCount, requiredStaffCount: service.requiredStaffCount,
        durationMin: display.reservedDurationMin ?? display.durationMin,
        hasVariants,
        variants: (hasVariants ? activeReservationOptions(service) : []).map(option => ({ id: option.id.toString(), name: option.name,
          durationMin: option.durationMin, priceCents: option.priceCents, isActive: true })),
      };
    });
  }
  async assistedBookingTherapists(actor: ShopActor, shopIdValue: string) {
    const shopId = numericId(shopIdValue);
    await requireShopAccess(this.prisma, shopId, actor, 'BOOKINGS_MANAGE');
    const rows = await this.prisma.therapist.findMany({ where: { shopId, isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return rows.map(row => ({ id: row.id.toString(), name: row.name }));
  }
  private async assertAssistedCustomer(tx: any, shopId: bigint, customerId: bigint) {
    const user = await tx.user.findUnique({ where: { id: customerId }, select: { id: true, role: true, status: true, deletedAt: true, email: true, emailVerifiedAt: true } });
    const email = customerOrderEmail(user?.email);
    if (!user || user.role !== 'CUSTOMER' || user.status !== 'ACTIVE' || user.deletedAt || !email || !user.emailVerifiedAt) throw new BadRequestException('该客户账号不可用于代客预约，请重新搜索已验证邮箱的客户');
    if (!await tx.booking.findFirst({ where: { userId: customerId, shopId, deletedAt: null }, select: { id: true } })) throw new ForbiddenException('仅可为有本店历史预约的客户代客预约');
    return { userId: user.id.toString(), email };
  }
  async quoteAssistedBooking(actor: ShopActor, input: AssistedSelection) {
    const customerId = numericId(input.customerId), shopId = numericId(input.shopId), userId = customerId.toString();
    const data = { ...input, userId, paymentMode: 'PAY_AT_STORE' as const, couponId: undefined, tipCents: undefined };
    const requestHash = this.request(data, false, true);
    return reservationTransaction(this.prisma, async tx => {
      await lockShop(tx, shopId);
      const access = await requireShopAccess(tx, shopId, actor, 'BOOKINGS_MANAGE');
      if (access.shop.status !== 'APPROVED') throw new BadRequestException('门店尚未发布，暂不能创建预约');
      await this.assertAssistedCustomer(tx, shopId, customerId);
      await this.verifiedContact(tx, customerId, data.contact);
      const c = await this.context(tx, data, undefined, undefined, true);
      if (data.durationMin !== undefined && data.durationMin !== c.duration) throw new BadRequestException('服务时长必须与所选规格一致');
      const start = this.selectedTime(c, data);
      if (!allocate(c.allocation, start, c.preferred)) throw new ConflictException('该时段技师或场地不可用');
      const priced = await this.pricedSelection(tx, data, c.shop, this.singleMainItems(c), c.duration, requestHash, false, true);
      this.assertCurrentNotice(c.bookingSettings, start);
      return { ...priced.view, ...signBookingAddOnQuote(priced.material) };
    });
  }
  async createAssistedBooking(actor: ShopActor, input: AssistedSelection) {
    if (!/^[A-Za-z0-9:_-]{8,100}$/.test(input.requestKey ?? '')) throw new BadRequestException('代客预约需要有效请求编号');
    const shopId = numericId(input.shopId), userId = numericId(input.customerId).toString();
    const data: CreateInput = { ...input, userId, paymentMode: 'PAY_AT_STORE', couponId: undefined, tipCents: undefined };
    const hash = this.request(data, false, true), originalHash = this.request(data, true, true);
    try {
      const booking = await reservationTransaction(this.prisma, async tx => {
        await lockShop(tx, shopId);
        const access = await requireShopAccess(tx, shopId, actor, 'BOOKINGS_MANAGE', { write: true });
        if (access.shop.status !== 'APPROVED') throw new BadRequestException('门店尚未发布，暂不能创建预约');
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${numericId(userId)} FOR SHARE`);
        const existing = await this.replay(tx, numericId(userId), data.requestKey, hash, originalHash);
        if (existing) return existing;
        // Only this exact expired command is proven unexecuted. Every delayed
        // copy takes the same shop lock and gate; a committed receipt wins first.
        const expiresAt = data.quoteExpiresAt;
        if (typeof expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt)
          && Number.isFinite(Date.parse(expiresAt)) && new Date(expiresAt).toISOString() === expiresAt && Date.parse(expiresAt) <= Date.now()) {
          throw new ConflictException({ code: 'ASSISTED_QUOTE_EXPIRED_NOT_EXECUTED', shopId: shopId.toString(), requestKey: data.requestKey, quoteExpiresAt: expiresAt,
            message: 'This expired assisted booking command was not executed; request a fresh quote before submitting' });
        }
        await expireShopHolds(tx, shopId);
        await this.assertAssistedCustomer(tx, shopId, numericId(userId));
        // Legacy commands without contact may replay their original result, but
        // every newly created assisted order needs a verified immutable snapshot.
        const contact = await this.verifiedContact(tx, numericId(userId), data.contact);
        const c = await this.context(tx, data, undefined, undefined, true);
        if (data.durationMin !== undefined && data.durationMin !== c.duration) throw new BadRequestException('服务时长必须与所选规格一致');
        const start = this.selectedTime(c, data), end = new Date(+start + c.duration * 60000), allocation = allocate(c.allocation, start, c.preferred);
        if (!allocation) throw new ConflictException('该时段技师或场地不可用');
        const priced = await this.pricedCreation(tx, data, c.shop, this.singleMainItems(c), c.duration, hash, true);
        this.assertCurrentNotice(c.bookingSettings, start);
        const quote = priced.view;
        if (quote.paymentMode !== 'PAY_AT_STORE' || quote.tipCents !== 0 || quote.platformFeeCents !== 0) throw new BadRequestException('代客预约仅支持无在线收款的到店付款订单');
        const created = await tx.booking.create({ data: { bookingNo: `MJ${randomUUID().replace(/-/g, '').slice(0, 25)}`, userId: numericId(userId), shopId, ...contact, bookingSource: 'ASSISTED_CUSTOMER', assistedById: numericId(actor.id),
          therapistId: numericId(allocation.therapistIds[0]), ...newTherapistSelection(c.preferred), serviceId: c.service.id, participantCountSnapshot: c.count, requiredStaffCountSnapshot: c.staffCount ?? c.count,
          bookingDate: new Date(`${data.date}T00:00:00Z`), bookingTimezone: c.shop.timezone, startTime: start, endTime: end, durationMin: c.duration,
          priceCents: quote.subtotalCents, discountCents: 0, platformFeeCents: 0, tipCents: 0, totalCents: quote.totalCents, currency: quote.currency, couponId: null, notes: data.notes,
          requestKey: data.requestKey, requestHash: hash, paymentMode: 'PAY_AT_STORE', status: 'PENDING', paymentStatus: 'UNPAID', holdExpiresAt: null } });
        const linePrices = participantPrices(quote.mainSubtotalCents, c.count), items: any[] = [];
        for (let index = 0; index < c.count; index++) items.push(await tx.bookingItem.create({ data: { bookingId: created.id, serviceId: c.service.id, variantId: c.variant?.id ?? null,
          participantIndex: index + 1, serviceNameSnapshot: c.service.name, variantNameSnapshot: c.variant?.name ?? null, durationKindSnapshot: c.durationKind,
          durationMin: c.duration, staffBufferMin: c.staffBuffer, roomBufferMin: c.roomBuffer, requiredStaffCountSnapshot: c.count === 1 ? (c.staffCount ?? c.count) : 1,
          priceCentsSnapshot: linePrices[index], quotedUnitPriceCents: c.unitPrice, priceBasisSnapshot: c.priceBasis, assignedTherapistId: numericId(allocation.therapistIds[index]),
          currency: c.currency, assignedRoomId: allocation.roomId ? numericId(allocation.roomId) : null, roomTypeSnapshot: c.roomType, startAtUtc: start, endAtUtc: end } }));
        await persistBookingAddOns(tx, created.id, items, priced.resolved);
        await this.writeLocks(tx, created, items, allocation);
        await this.notifyBooking(tx, created, 'BOOKING_CREATED', 'created');
        await tx.auditLog.create({ data: { operatorId: numericId(actor.id), action: 'ASSISTED_BOOKING_CREATE', targetType: 'BOOKING', targetId: created.id,
          detail: { shopId: shopId.toString(), customerId: userId, paymentMode: 'PAY_AT_STORE', priceCents: quote.totalCents } } });
        return tx.booking.findUniqueOrThrow({ where: { id: created.id }, include: DETAIL });
      });
      return this.serialize(booking);
    } catch (error) {
      if ((error as any)?.code !== 'P2002') throw error;
      const existing = await reservationTransaction(this.prisma, async tx => {
        await lockShop(tx, shopId);
        const access = await requireShopAccess(tx, shopId, actor, 'BOOKINGS_MANAGE');
        if (access.shop.status !== 'APPROVED') throw new BadRequestException('门店尚未发布，暂不能核对预约结果');
        const existing = await this.replay(tx, numericId(userId), data.requestKey, hash, originalHash);
        if (existing) return existing;
        await this.assertAssistedCustomer(tx, shopId, numericId(userId));
        return null;
      });
      if (!existing) throw error;
      return this.serialize(existing);
    }
  }
  private guestKey(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new BadRequestException('首次客预约需要有效 UUID 操作编号');
    return value.toLowerCase();
  }
  private guestCommand(actor: ShopActor, input: GuestAssistedSelection, creating: boolean) {
    if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException();
    numericId(actor.id);
    const allowed = ['shopId', 'serviceId', 'variantId', 'therapistId', 'preferredTherapistIds', 'date', 'startTime', 'durationMin', 'notes', 'contact', 'guestSource', 'addOnSelections',
      ...(creating ? ['requestKey', 'quoteHash', 'quoteExpiresAt'] : [])];
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !allowed.includes(key))) throw new BadRequestException('首次客代约包含不允许的字段');
    if (!['PHONE', 'WALK_IN'].includes(input.guestSource)) throw new BadRequestException('请选择电话或到店来源');
    if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 500)) throw new BadRequestException('预约备注最多500字');
    const contact = normalizeGuestBookingContact(input.contact);
    // A guest has no customer account. The existing price path receives no
    // userId; its signature subject is explicitly the assisting operator.
    const data = { ...input, contact, paymentMode: 'PAY_AT_STORE' as const };
    const selectionHash = this.request({ ...input, contact: undefined, requestKey: undefined, paymentMode: 'PAY_AT_STORE' });
    const requestHash = createHash('sha256').update(JSON.stringify({ kind: 'ASSISTED_GUEST', operatorId: numericId(actor.id).toString(), guestSource: input.guestSource, contact, selectionHash })).digest('hex');
    return { data, requestHash, contact };
  }
  private guestReceiptWhere(shopId: bigint, actor: ShopActor, requestKey: string) {
    return { shopId_operatorId_requestKey: { shopId, operatorId: numericId(actor.id), requestKey } };
  }
  private guestReceipt(row: any) {
    if (row.outcome === 'NOT_EXECUTED') return { shopId: row.shopId.toString(), requestKey: row.requestKey, outcome: 'NOT_EXECUTED' as const };
    return { shopId: row.shopId.toString(), requestKey: row.requestKey, outcome: 'COMMITTED' as const, result: { bookingId: row.bookingId.toString(), bookingNo: row.bookingNo } };
  }
  async quoteGuestAssistedBooking(actor: ShopActor, input: GuestAssistedSelection) {
    const { data, requestHash } = this.guestCommand(actor, input, false), shopId = numericId(data.shopId);
    return reservationTransaction(this.prisma, async tx => {
      await lockShop(tx, shopId);
      const access = await requireShopAccess(tx, shopId, actor, 'BOOKINGS_MANAGE', { write: true });
      if (access.shop.status !== 'APPROVED') throw new BadRequestException('门店尚未发布，暂不能创建预约');
      const c = await this.context(tx, data, undefined, undefined, true);
      if (data.durationMin !== undefined && data.durationMin !== c.duration) throw new BadRequestException('服务时长必须与所选规格一致');
      const start = this.selectedTime(c, data), allocation = allocate(c.allocation, start, c.preferred);
      if (!allocation) throw new ConflictException('所选技师或场地不可用');
      const priced = await this.pricedSelection(tx, data, c.shop, this.singleMainItems(c), c.duration, requestHash, false, true, numericId(actor.id));
      this.assertCurrentNotice(c.bookingSettings, start);
      return { ...priced.view, ...signBookingAddOnQuote({ ...priced.material, allocation }), timezone: c.shop.timezone, localDate: input.date, localStartTime: input.startTime,
        requestedTherapistIds: c.preferred, assignedTherapistIds: allocation.therapistIds };
    });
  }
  async createGuestAssistedBooking(actor: ShopActor, input: GuestAssistedSelection) {
    const requestKey = this.guestKey(input?.requestKey), { data, requestHash, contact } = this.guestCommand(actor, input, true), shopId = numericId(data.shopId);
    return reservationTransaction(this.prisma, async tx => {
      await lockShop(tx, shopId);
      const access = await requireShopAccess(tx, shopId, actor, 'BOOKINGS_MANAGE', { write: true });
      const previous = await tx.guestBookingOperation.findUnique({ where: this.guestReceiptWhere(shopId, actor, requestKey) });
      if (previous) {
        if (previous.outcome === 'NOT_EXECUTED') throw new ConflictException('原操作已确认未执行，请重新报价并使用新编号');
        if (previous.requestHash !== requestHash) throw new ConflictException('原操作编号已用于其他预约内容，请查询原结果');
        return this.guestReceipt(previous);
      }
      if (access.shop.status !== 'APPROVED') throw new BadRequestException('门店尚未发布，暂不能创建预约');
      await expireShopHolds(tx, shopId);
      const c = await this.context(tx, data, undefined, undefined, true);
      if (data.durationMin !== undefined && data.durationMin !== c.duration) throw new BadRequestException('服务时长必须与所选规格一致');
      const start = this.selectedTime(c, data), end = new Date(+start + c.duration * 60000), allocation = allocate(c.allocation, start, c.preferred);
      if (!allocation) throw new ConflictException('所选技师或场地不可用');
      const priced = await this.pricedSelection(tx, data, c.shop, this.singleMainItems(c), c.duration, requestHash, false, true, numericId(actor.id));
      // The shown assignment is part of the confirmed quote, including an
      // automatic assignment. A changed staff/room allocation needs consent.
      requireBookingAddOnQuote({ ...priced.material, allocation }, input.quoteHash, input.quoteExpiresAt);
      this.assertCurrentNotice(c.bookingSettings, start);
      const quote = priced.view;
      if (quote.paymentMode !== 'PAY_AT_STORE' || quote.tipCents !== 0 || quote.platformFeeCents !== 0 || quote.discountCents !== 0) throw new BadRequestException('首次客预约仅支持到店付款');
      const created = await tx.booking.create({ data: { bookingNo: `MJ${randomUUID().replace(/-/g, '').slice(0, 25)}`, userId: null, shopId,
        bookingSource: 'ASSISTED_GUEST', assistedById: numericId(actor.id), guestSource: input.guestSource, ...guestBookingContactSnapshot(contact),
        therapistId: numericId(allocation.therapistIds[0]), ...newTherapistSelection(c.preferred), serviceId: c.service.id,
        participantCountSnapshot: c.count, requiredStaffCountSnapshot: c.staffCount ?? c.count, bookingDate: new Date(`${input.date}T00:00:00Z`), bookingTimezone: c.shop.timezone,
        startTime: start, endTime: end, durationMin: c.duration, priceCents: quote.subtotalCents, discountCents: 0, platformFeeCents: 0, tipCents: 0,
        totalCents: quote.totalCents, currency: quote.currency, couponId: null, notes: input.notes,
        requestKey, requestHash, paymentMode: 'PAY_AT_STORE', status: 'PENDING', paymentStatus: 'UNPAID', holdExpiresAt: null } });
      const items: any[] = [], linePrices = participantPrices(quote.mainSubtotalCents, c.count);
      for (let index = 0; index < c.count; index++) items.push(await tx.bookingItem.create({ data: { bookingId: created.id, serviceId: c.service.id, variantId: c.variant?.id ?? null,
        participantIndex: index + 1, serviceNameSnapshot: c.service.name, variantNameSnapshot: c.variant?.name ?? null, durationKindSnapshot: c.durationKind,
        durationMin: c.duration, staffBufferMin: c.staffBuffer, roomBufferMin: c.roomBuffer, requiredStaffCountSnapshot: c.count === 1 ? (c.staffCount ?? c.count) : 1,
        priceCentsSnapshot: linePrices[index], quotedUnitPriceCents: c.unitPrice, priceBasisSnapshot: c.priceBasis, assignedTherapistId: numericId(allocation.therapistIds[index]),
        currency: c.currency, assignedRoomId: allocation.roomId ? numericId(allocation.roomId) : null, roomTypeSnapshot: c.roomType, startAtUtc: start, endAtUtc: end } }));
      await persistBookingAddOns(tx, created.id, items, priced.resolved);
      await this.writeLocks(tx, created, items, allocation);
      await this.notifyBooking(tx, created, 'BOOKING_CREATED', 'created');
      await tx.auditLog.create({ data: { operatorId: numericId(actor.id), action: 'GUEST_ASSISTED_BOOKING_CREATE', targetType: 'BOOKING', targetId: created.id,
        detail: { shopId: shopId.toString(), guestSource: input.guestSource, bookingSource: 'ASSISTED_GUEST', paymentMode: 'PAY_AT_STORE', priceCents: quote.totalCents } } });
      const receipt = await tx.guestBookingOperation.create({ data: { shopId, operatorId: numericId(actor.id), requestKey, requestHash, outcome: 'COMMITTED', bookingId: created.id, bookingNo: created.bookingNo } });
      return this.guestReceipt(receipt);
    });
  }
  async guestAssistedBookingOperation(actor: ShopActor, shopIdValue: string, key: string) {
    const shopId = numericId(shopIdValue), requestKey = this.guestKey(key);
    await requireShopAccess(this.prisma, shopId, actor, 'BOOKINGS_MANAGE');
    const receipt = await this.prisma.guestBookingOperation.findUnique({ where: this.guestReceiptWhere(shopId, actor, requestKey) });
    return receipt ? this.guestReceipt(receipt) : { shopId: shopId.toString(), requestKey, outcome: 'NOT_FOUND' as const };
  }
  async reconcileGuestAssistedBookingOperation(actor: ShopActor, shopIdValue: string, key: string, raw: unknown = {}) {
    const shopId = numericId(shopIdValue), requestKey = this.guestKey(key);
    if (raw != null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) throw new BadRequestException('核对请求不能包含预约资料');
    return reservationTransaction(this.prisma, async tx => {
      await lockShop(tx, shopId);
      await requireShopAccess(tx, shopId, actor, 'BOOKINGS_MANAGE', { write: true });
      const previous = await tx.guestBookingOperation.findUnique({ where: this.guestReceiptWhere(shopId, actor, requestKey) });
      if (previous) return this.guestReceipt(previous);
      return this.guestReceipt(await tx.guestBookingOperation.create({ data: { shopId, operatorId: numericId(actor.id), requestKey,
        requestHash: createHash('sha256').update('guest-booking-reconcile-fence').digest('hex'), outcome: 'NOT_EXECUTED' } }));
    });
  }
  async expirePendingHolds() {
    if (this.expiring) return 0;
    this.expiring = true;
    try {
      const rows = await this.prisma.booking.findMany({ where: { status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, holdExpiresAt: { lte: new Date() } }, select: { shopId: true }, distinct: ['shopId'], take: 100 });
      const finished = await this.prisma.bookingResourceLock.findMany({ where: { status: 'ACTIVE', endAtUtc: { lte: new Date() }, booking: { status: { in: ['COMPLETED', 'CANCELLED', 'REFUNDED'] } } }, select: { shopId: true }, distinct: ['shopId'], take: 100 });
      let count = 0;
      for (const shopId of new Set([...rows, ...finished].map(row => row.shopId))) count += await reservationTransaction(this.prisma, async tx => { await lockShop(tx, shopId); return expireShopHolds(tx, shopId); });
      return count;
    } finally { this.expiring = false; }
  }
  private async context(db: any, params: Selection, excludeBookingId?: bigint, snapshot?: Snapshot, existingManager = false) {
    const shop = existingManager ? await db.shop.findUnique({ where: { id: numericId(params.shopId) } })
      : await requirePublicShop(db, numericId(params.shopId), { forBooking: true });
    const service = await db.shopService.findUnique({ where: { id: numericId(params.serviceId) }, include: { variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } });
    if (!shop || shop.deletedAt) throw new BadRequestException('Shop is unavailable');
    if (!service?.isActive || service.shopId !== shop.id) throw new BadRequestException('Service is unavailable at this shop');
    const noon = localInstant(params.date, '12:00', shop.timezone);
    const variants = service.variants;
    const variant = params.variantId ? variants.find((v: any) => v.id === numericId(params.variantId!)) : null;
    if (!snapshot && (params.variantId && !variant?.isActive || !params.variantId && variants.length)) throw new BadRequestException('Select an active variant of this service');
    const durationKind = snapshot ? readDurationKind(snapshot.durationKind) : readDurationKind(service.durationKind);
    const duration = snapshot?.duration ?? variant?.durationMin ?? service.durationMin;
    const unitPrice = snapshot?.unitPrice ?? variant?.priceCents ?? service.priceCents;
    const count = snapshot?.count ?? service.participantCount;
    const staffCount = snapshot?.staffCount ?? (snapshot ? count : service.requiredStaffCount);
    const staffBuffer = snapshot?.staffBuffer ?? service.staffBufferMin;
    const roomBuffer = snapshot?.roomBuffer ?? service.roomBufferMin;
    const roomType = (snapshot ? snapshot.roomType : service.requiredRoomType) ?? null;
    const currency = snapshot?.currency ?? variant?.currency ?? 'usd';
    const storedBasis = priceBasis(snapshot?.priceBasis ?? variant?.priceBasis ?? service.priceBasis);
    const basis = snapshot ? storedBasis : BOOKING_PRICE_BASIS;
    if (![1, 2].includes(count) || ![1, 2].includes(staffCount) || staffCount < count || count === 2 && roomType !== null && roomType !== 'COUPLE'
      || roomType !== null && !['SINGLE', 'COUPLE', 'FOOT_SEAT'].includes(roomType)
      || !validReservedDurationMin(durationKind, duration) || !Number.isSafeInteger(unitPrice) || unitPrice < 1
      || !Number.isInteger(staffBuffer) || staffBuffer < 0 || staffBuffer > 120 || !Number.isInteger(roomBuffer) || roomBuffer < 0 || roomBuffer > 120 || currency !== 'usd') throw new BadRequestException('Service reservation policy needs configuration');
    const preferred = preferredIds(params, staffCount);
    preferred.forEach(id => numericId(id));
    const day = noon.getTime();
    const from = new Date(day - 36 * 3600000), until = new Date(day + 36 * 3600000);
    const weekday = new Date(`${params.date}T12:00:00Z`).getUTCDay();
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][weekday];
    const hours = shop.businessHours;
    const bookingSettings = readShopBookingSettings(shop.studioProfile);
    const windows = isShopClosedOnDate(bookingSettings, params.date) ? [] : openingIntervals(hours)[dayName];
    const therapists = await db.therapist.findMany({ where: { shopId: shop.id, isActive: true }, orderBy: { id: 'asc' }, include: { shifts: { where: { isActive: true } }, timeOff: { where: { startAtUtc: { lt: until }, endAtUtc: { gt: from } } } } });
    if (preferred.some(id => !therapists.some((t: any) => t.id.toString() === id))) {
      if (excludeBookingId) throw requestedTherapistUnavailable();
      throw new BadRequestException('Therapist is unavailable for this service');
    }
    const rooms = roomType ? await db.shopRoom.findMany({ where: { shopId: shop.id, isActive: true, roomType, capacity: { gte: count } }, orderBy: { id: 'asc' }, include: { maintenance: { where: { startAtUtc: { lt: until }, endAtUtc: { gt: from } } } } }) : [];
    const now = new Date();
    // Quote reads stay read-only. Expired wholly unpaid holds no longer reserve
    // calendars even before lazy cleanup; terminal ACTIVE cleanup still blocks.
    const locks = await db.bookingResourceLock.findMany({ where: { shopId: shop.id, status: 'ACTIVE', ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {}), startAtUtc: { lt: until }, endAtUtc: { gt: from }, booking: resourceBookingWhere(now) } });
    const legacy = await db.booking.findMany({ where: { shopId: shop.id, ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}), ...effectiveBookingWhere(now), items: { none: {} }, startTime: { lt: until }, endTime: { gt: from } } });
    const interval = (b: any) => ({ start: b.startAtUtc, end: b.endAtUtc });
    const shopBlocks = await db.shopCalendarBlock.findMany({ where: { shopId: shop.id, scope: 'SHOP', status: 'ACTIVE',
      startAtUtc: { lt: until }, endAtUtc: { gt: from } }, select: { startAtUtc: true, endAtUtc: true } });
    const allocation: AllocationContext = { count, staffCount, duration, staffBuffer, roomBuffer, needsRoom: !!roomType,
      shopBlocks: shopBlocks.map(interval),
      therapists: therapists.map((t: any) => ({ id: t.id.toString(), shifts: workIntervals(params.date, shop.timezone, effectiveWeeklyShifts(t.scheduleMode, hours, t.shifts)), timeOff: t.timeOff.map(interval) })),
      rooms: rooms.map((r: any) => ({ id: r.id.toString(), maintenance: r.maintenance.map(interval) })),
      locks: locks.map((l: any) => ({ ...interval(l), type: l.resourceType, id: l.resourceId.toString() })),
      legacy: legacy.map((b: any) => ({ start: b.startTime, end: b.endTime, therapistId: b.therapistId?.toString() ?? null })) };
    return { shop, service, variant, durationKind, duration, unitPrice, count, staffCount, staffBuffer, roomBuffer, roomType, currency, priceBasis: basis, preferred, windows, allocation, bookingSettings };
  }
  private assertCurrentNotice(settings: ReturnType<typeof readShopBookingSettings>, start: Date) {
    if (!meetsShopBookingNotice(settings, start)) throw new BadRequestException('This shop requires more advance notice for online appointments');
  }
  private overlapsTemporaryClosure(allocation: AllocationContext, start: Date, settings: ReturnType<typeof readShopBookingSettings>, timezone: string) {
    const buffer = Math.max(allocation.staffBuffer, allocation.needsRoom ? allocation.roomBuffer : 0);
    return isShopClosedDuring(settings, start, new Date(+start + (allocation.duration + buffer) * 60000), timezone);
  }
  private selectedTime(c: Awaited<ReturnType<BookingService['context']>>, p: { date: string; startTime: string }) {
    const start = localInstant(p.date, p.startTime, c.shop.timezone);
    this.assertCurrentNotice(c.bookingSettings, start);
    const [h, m] = p.startTime.split(':').map(Number), minute = h * 60 + m;
    const window = c.windows.find(w => minute >= w.open && minute < w.close && (minute - w.open) % 30 === 0);
    if (!window || !coveredByOpeningHours(c.windows, minute, minute + c.duration) || !wallInterval(p.date, minute, minute + c.duration, c.shop.timezone)) throw new BadRequestException('Selected time is outside available business hours');
    if (this.overlapsTemporaryClosure(c.allocation, start, c.bookingSettings, c.shop.timezone)) throw new BadRequestException('Selected time overlaps a temporary shop closure, including preparation time');
    if (overlapsShopBlock(c.allocation, { start, end: new Date(+start + (c.duration + c.staffBuffer) * 60000) },
      { start, end: new Date(+start + (c.duration + c.roomBuffer) * 60000) })) throw new ConflictException('Selected time overlaps a shop calendar block, including preparation time');
    return start;
  }
  getAvailableSlots(params: Selection) { return this.availableSlots(params); }
  async getAssistedBookingSlots(actor: ShopActor, params: Selection) {
    if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException();
    const allowed = ['shopId', 'serviceId', 'date', 'variantId', 'therapistId', 'preferredTherapistIds'];
    if (!params || typeof params !== 'object' || Object.keys(params).some(key => !allowed.includes(key))) throw new BadRequestException('代约时段包含不允许的字段');
    return this.availableSlots(params, actor);
  }
  private async availableSlots(params: Selection, actor?: ShopActor) {
    return reservationTransaction(this.prisma, async tx => {
      const shopId = numericId(params.shopId);
      await lockShop(tx, shopId);
      if (actor) {
        const access = await requireShopAccess(tx, shopId, actor, 'BOOKINGS_MANAGE', { write: true });
        if (access.shop.status !== 'APPROVED') throw new BadRequestException('门店尚未发布，暂不能创建预约');
      }
      await expireShopHolds(tx, shopId);
      const c = await this.context(tx, params, undefined, undefined, !!actor);
      const now = new Date();
      const slots: Array<{ time: string; available: boolean }> = [];
      for (const w of c.windows) for (let minute = w.open; minute < w.close; minute += 30) {
        if (!coveredByOpeningHours(c.windows, minute, minute + c.duration)) continue;
        const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
        const span = wallInterval(params.date, minute, minute + c.duration, c.shop.timezone);
        slots.push({ time, available: !!span && meetsShopBookingNotice(c.bookingSettings, span.start, now) && !this.overlapsTemporaryClosure(c.allocation, span.start, c.bookingSettings, c.shop.timezone) && !!allocate(c.allocation, span.start, c.preferred) });
      }
      return { ...bookingOrderPolicy(), bookingCalendar: bookingCalendar(c.shop.timezone), date: params.date, timezone: c.shop.timezone, durationMin: c.duration, reservedDurationMin: c.duration, durationKind: c.durationKind, priceCents: servicePrice(c.unitPrice, c.count, c.priceBasis), priceBasis: c.priceBasis, participantCount: c.count, requiredStaffCount: c.staffCount ?? c.count, variantId: c.variant?.id.toString() ?? null, slots };
    });
  }
  private request(data: Omit<CreateInput, 'userId'>, originalMode = false, withContact = false) {
    if (data.paymentMode !== undefined && !['ONLINE', 'PAY_AT_STORE'].includes(data.paymentMode)) throw new BadRequestException('Unsupported reservation payment mode');
    if (data.requestKey !== undefined && !/^[A-Za-z0-9:_-]{1,100}$/.test(data.requestKey)) throw new BadRequestException('Invalid reservation request key');
    const preferences = data.preferredTherapistIds ?? (data.therapistId ? [data.therapistId] : []), addOnSelections = normalizeAddOnSelections(data.addOnSelections);
    const normalized = { shopId: numericId(data.shopId).toString(), serviceId: numericId(data.serviceId).toString(), variantId: data.variantId ? numericId(data.variantId).toString() : null,
      preferredTherapistIds: [...preferences].sort(), date: data.date, startTime: data.startTime, durationMin: data.durationMin ?? null, notes: data.notes ?? null, couponId: data.couponId ?? null,
      ...((originalMode ? data.paymentMode : newBookingPaymentMode(data.paymentMode)) === 'PAY_AT_STORE' ? { paymentMode: 'PAY_AT_STORE' } : {}), ...(tipAmount(data.tipCents) ? { tipCents: data.tipCents } : {}),
      ...(addOnSelections.length ? { addOnSelections } : {}),
      ...(withContact && data.contact !== undefined ? { contactVersion: 1, contact: normalizeBookingContact(data.contact) } : {}) };
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }
  private async replay(db: any, userId: bigint, key: string | undefined, hash: string, originalHash?: string) {
    if (!key) return null;
    const existing = await db.booking.findUnique({ where: { userId_requestKey: { userId, requestKey: key } }, include: DETAIL });
    if (!existing) return null;
    if (existing.requestHash !== hash && existing.requestHash !== originalHash) throw new ConflictException('Reservation request key was reused with different parameters');
    return existing;
  }

  private singleMainItems(c: Awaited<ReturnType<BookingService['context']>>) {
    const prices = participantPrices(servicePrice(c.unitPrice, c.count, c.priceBasis), c.count);
    return prices.map((priceCents, index) => ({ participantIndex: index + 1, sequence: 1, serviceId: c.service.id.toString(), variantId: c.variant?.id.toString() ?? null,
      name: c.service.name, variantName: c.variant?.name ?? null, requiredStaffCount: c.count === 1 ? (c.staffCount ?? c.count) : 1, durationKind: readDurationKind(c.durationKind), durationMin: c.duration, priceCents, quotedUnitPriceCents: c.unitPrice,
      priceBasis: c.priceBasis, currency: c.currency, staffBufferMin: c.staffBuffer, roomBufferMin: c.roomBuffer, roomType: c.roomType }));
  }
  private planMainItems(plan: Awaited<ReturnType<BookingService['planContext']>>) {
    return plan.segments.map(({ participantIndex, sequence, c }) => ({ participantIndex, sequence, serviceId: c.service.id.toString(), variantId: c.variant?.id.toString() ?? null,
      name: c.service.name, variantName: c.variant?.name ?? null, requiredStaffCount: c.count === 1 ? (c.staffCount ?? c.count) : 1, durationKind: readDurationKind(c.durationKind), durationMin: c.duration, priceCents: c.unitPrice, quotedUnitPriceCents: c.unitPrice,
      priceBasis: c.priceBasis, currency: c.currency, staffBufferMin: c.staffBuffer, roomBufferMin: c.roomBuffer, roomType: c.roomType }));
  }
  private planRequest(input: Omit<CreatePlanInput, 'requestKey'>, items: PlanSelection[], originalMode = false, withContact = false) {
    const addOnSelections = normalizeAddOnSelections(input.addOnSelections);
    return createHash('sha256').update(JSON.stringify({ kind: 'PLAN', shopId: numericId(input.shopId).toString(), date: input.date, startTime: input.startTime, items,
      notes: input.notes ?? null, couponId: input.couponId ?? null, paymentMode: originalMode ? input.paymentMode ?? 'ONLINE' : newBookingPaymentMode(input.paymentMode), tipCents: tipAmount(input.tipCents),
      ...(addOnSelections.length ? { addOnSelections } : {}),
      ...(withContact && input.contact !== undefined ? { contactVersion: 1, contact: normalizeBookingContact(input.contact) } : {}) })).digest('hex');
  }
  private async verifiedContact(tx: any, userId: bigint, raw: unknown) {
    // Serialize with email verification/profile updates until the booking and
    // its notifications commit. Account ownership never comes from contact.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    await requireCustomerOrderEmail(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId }, select: {
      id: true, email: true, emailVerifiedAt: true, role: true, status: true, deletedAt: true,
    } });
    if (String(user?.id) !== String(userId)) throw new ForbiddenException('Customer account is unavailable');
    return requireVerifiedBookingContact(raw, user);
  }
  private async pricedSelection(tx: any, input: Partial<Pick<CreateInput, 'userId' | 'couponId' | 'paymentMode' | 'tipCents' | 'addOnSelections'>>,
    shop: any, mainItems: Array<{ participantIndex: number; sequence: number; serviceId: string; variantId: string | null; durationKind: ServiceDurationKind; durationMin: number; priceCents: number }>, durationMin: number, requestHash: string, lockCoupon = false, assistedOffline = false, guestOperatorId?: bigint) {
    if (input.paymentMode !== undefined && !['ONLINE', 'PAY_AT_STORE'].includes(input.paymentMode)) throw new BadRequestException('Unsupported reservation payment mode');
    const mode = assistedOffline ? 'PAY_AT_STORE' : newBookingPaymentMode(input.paymentMode);
    if (!assistedOffline && bookingOnlinePaymentEnabled() && mode === 'PAY_AT_STORE' && !shopPaymentPolicy(shop.studioProfile).payAtStoreEnabled) throw new BadRequestException('Pay at store is not enabled for this shop');
    if (!bookingOnlinePaymentEnabled() && tipAmount(input.tipCents) !== 0) throw new BadRequestException({ code: 'ORDER_TIP_NOT_SUPPORTED',
      message: 'Tips are handled directly with the shop; submit the order without an online tip', fields: { tipCents: 'Submit the order without an online tip' } });
    const mainSubtotalCents = cents(mainItems.reduce((sum, row) => sum + row.priceCents, 0));
    const resolved = await resolveBookingAddOns(tx, shop.id, mainItems, normalizeAddOnSelections(input.addOnSelections));
    const addOnSubtotalCents = cents(resolved.reduce((sum, row) => sum + row.lineTotalCents, 0));
    const subtotalCents = cents(mainSubtotalCents + addOnSubtotalCents);
    let discountCents = 0, userCoupon: any = null;
    if (input.couponId) {
      if (!input.userId || guestOperatorId !== undefined) throw new BadRequestException('Guest bookings cannot use account coupons');
      const where = { id: numericId(input.couponId), userId: numericId(input.userId), status: 'UNUSED', bookingId: null };
      let couponId: bigint | undefined;
      if (lockCoupon) {
        // Only discover the immutable parent ID before taking its mutex. All
        // redemption eligibility is reread after shop -> coupon, before wallet
        // CAS, matching claiming/management and cancellation's restore order.
        const reference = await tx.userCoupon.findFirst({ where, select: { couponId: true } });
        if (!reference) throw new BadRequestException('Coupon unavailable');
        couponId = reference.couponId;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM coupons WHERE id = ${couponId} FOR UPDATE`);
      }
      userCoupon = await tx.userCoupon.findFirst({ where: { ...where, ...(couponId !== undefined ? { couponId } : {}) }, include: { coupon: true } });
      if (!userCoupon) throw new BadRequestException('Coupon unavailable');
      const result = await this.coupons.evaluateCoupon(userCoupon.coupon, shop.id, mainSubtotalCents);
      if (!result.valid) throw new BadRequestException(result.reason || 'Coupon unavailable');
      discountCents = Math.min(result.discountCents, mainSubtotalCents);
    }
    const tipCents = tipAmount(input.tipCents), quote = quoteCents(subtotalCents, discountCents, mode === 'PAY_AT_STORE' ? 0 : feeCents(subtotalCents - discountCents), tipCents);
    const mainDurations = mainItems.map(row => ({ participantIndex: row.participantIndex, sequence: row.sequence, serviceId: row.serviceId, variantId: row.variantId, durationKind: row.durationKind, reservedDurationMin: row.durationMin }));
    const kinds = new Set(mainDurations.map(row => row.durationKind));
    const durationKind: ServiceDurationKind | 'MIXED' = kinds.size > 1 ? 'MIXED' : mainDurations[0].durationKind;
    const view = { ...bookingOrderPolicy(), paymentMode: mode, shopId: shop.id.toString(), currency: quote.currency, mainSubtotalCents, addOnSubtotalCents, subtotalCents, discountEligibleCents: mainSubtotalCents,
      discountCents, platformFeeCents: quote.platformFeeCents, tipCents, totalCents: quote.totalCents, durationMin, reservedDurationMin: durationMin, durationKind, mainDurations, addOns: publicAddOnCandidates(resolved) };
    return { view, resolved, userCoupon, material: { ...(guestOperatorId === undefined ? { userId: numericId(input.userId!).toString() } : { guestOperatorId: guestOperatorId.toString() }), requestHash, mainItems, quote: view } };
  }
  private async claimQuotedCoupon(tx: any, uc: any) {
    if (!uc) return;
    const claim = await tx.userCoupon.updateMany({ where: { id: uc.id, status: 'UNUSED', bookingId: null }, data: { status: 'USED', usedAt: new Date() } });
    if (claim.count !== 1) throw new ConflictException('Coupon already used');
    await tx.coupon.update({ where: { id: uc.couponId }, data: { usedCount: { increment: 1 } } });
  }
  private async pricedCreation(tx: any, input: CreateInput | CreatePlanInput, shop: any,
    mainItems: Array<{ participantIndex: number; sequence: number; serviceId: string; variantId: string | null; durationKind: ServiceDurationKind; durationMin: number; priceCents: number }>, durationMin: number, requestHash: string, assistedOffline = false) {
    if (!/^[A-Za-z0-9:_-]{8,100}$/.test(input.requestKey ?? '')) throw new BadRequestException('A stable reservation request key is required for this service');
    try {
      const priced = await this.pricedSelection(tx, input, shop, mainItems, durationMin, requestHash, true, assistedOffline);
      requireBookingAddOnQuote(priced.material, input.quoteHash, input.quoteExpiresAt);
      return priced;
    } catch (error) {
      // The request syntax was validated before entering the transaction. An
      // otherwise valid add-on/coupon configuration may have changed since quote.
      if (error instanceof BadRequestException && !orderInputRequired(error)) throw new ConflictException('The reservation quote changed; request a fresh quote before submitting');
      throw error;
    }
  }
  async quoteBooking(input: Omit<CreateInput, 'requestKey' | 'quoteHash' | 'quoteExpiresAt'>) {
    const shopId = numericId(input.shopId), requestHash = this.request(input);
    return reservationTransaction(this.prisma, async tx => {
      await lockShop(tx, shopId);
      const c = await this.context(tx, input);
      if (input.durationMin !== undefined && input.durationMin !== c.duration) throw new BadRequestException('Duration must match the selected service variant');
      const start = this.selectedTime(c, input);
      const priced = await this.pricedSelection(tx, input, c.shop, this.singleMainItems(c), c.duration, requestHash);
      this.assertCurrentNotice(c.bookingSettings, start);
      return { ...priced.view, ...signBookingAddOnQuote(priced.material) };
    });
  }
  async quotePlan(input: Omit<CreatePlanInput, 'requestKey' | 'quoteHash' | 'quoteExpiresAt'>) {
    const items = normalizePlan(input), shopId = numericId(input.shopId), requestHash = this.planRequest(input, items);
    return reservationTransaction(this.prisma, async tx => {
      await lockShop(tx, shopId);
      const plan = await this.planContext(tx, { ...input, items });
      const chosen = this.allocateItinerary(plan, input.date, input.startTime);
      if (!chosen) throw new ConflictException('The complete itinerary cannot be accommodated at this time');
      const priced = await this.pricedSelection(tx, input, plan.shop, this.planMainItems(plan), plan.duration, requestHash);
      this.assertCurrentNotice(plan.shopBookingSettings, chosen.start);
      return { ...priced.view, ...signBookingAddOnQuote(priced.material) };
    });
  }
  async createBooking(data: CreateInput) {
    if (normalizeAddOnSelections(data.addOnSelections).length && !/^[A-Za-z0-9:_-]{8,100}$/.test(data.requestKey ?? '')) throw new BadRequestException('A stable reservation request key is required for add-ons');
    const shopId = numericId(data.shopId), userId = numericId(data.userId), hash = this.request(data, false, true), originalHash = this.request(data, true, true);
    let booking: any;
    try {
      booking = await reservationTransaction(this.prisma, async tx => {
        await lockShop(tx, shopId); await expireShopHolds(tx, shopId);
        const existing = await this.replay(tx, userId, data.requestKey, hash, originalHash);
        if (existing) return existing;
        const contact = await this.verifiedContact(tx, userId, data.contact);
        const c = await this.context(tx, data);
        if (data.durationMin !== undefined && data.durationMin !== c.duration) throw new BadRequestException('Duration must match the selected service variant');
        const start = this.selectedTime(c, data), end = new Date(+start + c.duration * 60000);
        const allocation = allocate(c.allocation, start, c.preferred);
        if (!allocation) throw new ConflictException('The required staff or room is unavailable for this time');
        const priced = await this.pricedCreation(tx, data, c.shop, this.singleMainItems(c), c.duration, this.request(data));
        // Shop locks protect configuration, but cannot stop time during pricing
        // reads or a shared coupon wait. Accept only against the current clock.
        this.assertCurrentNotice(c.bookingSettings, start);
        await this.claimQuotedCoupon(tx, priced.userCoupon);
        this.assertCurrentNotice(c.bookingSettings, start);
        const price = priced.view.subtotalCents, discount = priced.view.discountCents, couponId = priced.userCoupon?.couponId ?? null;
        const requestedMode = newBookingPaymentMode(data.paymentMode), quote = priced.view;
        const zero = bookingOnlinePaymentEnabled() && quote.totalCents === 0;
        const created = await tx.booking.create({ data: { bookingNo: `MJ${randomUUID().replace(/-/g, '').slice(0, 25)}`, userId, shopId, ...contact, therapistId: numericId(allocation.therapistIds[0]), ...newTherapistSelection(c.preferred), serviceId: c.service.id,
          participantCountSnapshot: c.count, requiredStaffCountSnapshot: c.staffCount ?? c.count, bookingDate: new Date(`${data.date}T00:00:00Z`), bookingTimezone: c.shop.timezone, startTime: start, endTime: end, durationMin: c.duration, priceCents: price, discountCents: discount,
          platformFeeCents: quote.platformFeeCents, tipCents: tipAmount(data.tipCents), totalCents: quote.totalCents, currency: quote.currency, couponId, notes: data.notes,
          requestKey: data.requestKey, requestHash: data.requestKey ? hash : null, paymentMode: zero ? 'ZERO' : requestedMode,
          ...(zero ? { status: 'CONFIRMED', paymentStatus: 'PAID' } : { status: 'PENDING', paymentStatus: 'UNPAID' }),
          holdExpiresAt: zero || !bookingOnlinePaymentEnabled() ? null : new Date(Math.min(Date.now() + holdMinutes() * 60000, +start)) } });
        if (zero) {
          await tx.bookingSettlementEntry.create({ data: { bookingId: created.id, kind: 'ZERO', amountCents: 0, currency: created.currency,
            requestKey: 'zero:creation:v1', requestHash: createHash('sha256').update(`zero:${created.id}:${price}:${discount}`).digest('hex'),
            occurredAt: new Date(), reason: 'Fully discounted reservation; no money collected' } });
          await tx.auditLog.create({ data: { action: 'BOOKING_ZERO_SETTLEMENT', targetType: 'BOOKING', targetId: created.id, operatorId: userId,
            detail: { priceCents: price, discountCents: discount, amountCents: 0, currency: created.currency } } });
        }
        if (data.couponId) await tx.userCoupon.update({ where: { id: numericId(data.couponId) }, data: { bookingId: created.id } });
        const items = [];
        const linePrices = participantPrices(priced.view.mainSubtotalCents, c.count);
        for (let index = 0; index < c.count; index++) items.push(await tx.bookingItem.create({ data: { bookingId: created.id, serviceId: c.service.id, variantId: c.variant?.id ?? null, participantIndex: index + 1,
          serviceNameSnapshot: c.service.name, variantNameSnapshot: c.variant?.name ?? null, durationKindSnapshot: c.durationKind, durationMin: c.duration, staffBufferMin: c.staffBuffer, roomBufferMin: c.roomBuffer,
          requiredStaffCountSnapshot: c.count === 1 ? (c.staffCount ?? c.count) : 1, priceCentsSnapshot: linePrices[index], quotedUnitPriceCents: c.unitPrice, priceBasisSnapshot: c.priceBasis, assignedTherapistId: numericId(allocation.therapistIds[index]), currency: c.currency, assignedRoomId: allocation.roomId ? numericId(allocation.roomId) : null, roomTypeSnapshot: c.roomType, startAtUtc: start, endAtUtc: end } }));
        await persistBookingAddOns(tx, created.id, items, priced.resolved);
        await this.writeLocks(tx, created, items, allocation);
        await this.notifyBooking(tx, created, zero ? 'BOOKING_CONFIRMED' : 'BOOKING_CREATED', zero ? 'confirmed' : 'created');
        return tx.booking.findUniqueOrThrow({ where: { id: created.id }, include: DETAIL });
      });
    } catch (error) {
      if (!orderInputRequired(error) && (normalizeAddOnSelections(data.addOnSelections).length || data.quoteHash !== undefined || data.quoteExpiresAt !== undefined) && error instanceof BadRequestException) throw new ConflictException('The reservation quote changed; request a fresh quote before submitting');
      if ((error as any).code !== 'P2002' || !data.requestKey) throw error;
      booking = await this.replay(this.prisma, userId, data.requestKey, hash, originalHash);
      if (!booking) throw error;
    }
    return this.serialize(booking);
  }
  private async planContext(tx: any, input: PlanInput, booking?: any, manager = false) {
    const savedItems = booking ? completeStoredPlanItems(booking) : null;
    if (booking && !savedItems) throw new ConflictException('The saved reservation itinerary needs review');
    const selections = savedItems ? savedItems
      .map(item => ({ participantIndex: item.participantIndex, sequence: item.sequence, serviceId: item.serviceId.toString(), variantId: item.variantId?.toString(),
        therapistId: rescheduleTherapistSelection(item).requestedTherapistIds[0] })) : normalizePlan(input);
    if (!selections.length || selections.length > 12) throw new BadRequestException('Reservation itinerary needs review');
    const segments: Array<PlanSelection & { offsetMin: number; preparationMin: number; c: Awaited<ReturnType<BookingService['context']>> }> = [];
    const next = new Map<number, number>();
    for (let index = 0; index < selections.length; index++) {
      const selection = selections[index], original = booking?.items.find((item: any) => item.participantIndex === selection.participantIndex && item.sequence === selection.sequence);
      if (original && savedTherapistSelection(original).requestedTherapistIds.length > 1) throw new ConflictException('A saved itinerary segment must request at most one therapist');
      const snapshot: Snapshot | undefined = original ? { durationKind: readDurationKind(original.durationKindSnapshot), duration: original.durationMin, unitPrice: original.quotedUnitPriceCents ?? original.priceCentsSnapshot,
        count: 1, staffCount: original.requiredStaffCountSnapshot ?? 1, staffBuffer: original.staffBufferMin, roomBuffer: original.roomBufferMin, roomType: original.roomTypeSnapshot,
        currency: original.currency, priceBasis: original.priceBasisSnapshot } : undefined;
      const c = await this.context(tx, { ...selection, shopId: input.shopId, date: input.date }, booking?.id, snapshot, manager);
      if (c.count !== 1 || (c.staffCount ?? c.count) !== 1) throw new BadRequestException('Plans support only one guest and one therapist per segment; use the package reservation flow for couples or four hands');
      const offsetMin = original?.offsetMin ?? next.get(selection.participantIndex) ?? 0;
      const hasFollowing = selections.some(item => item.participantIndex === selection.participantIndex && item.sequence === selection.sequence + 1);
      const preparationMin = original ? storedPlanPreparationMin(original, booking.items)
        : hasFollowing ? Math.max(c.staffBuffer, c.roomType ? c.roomBuffer : 0) : 0;
      if (preparationMin === undefined || original && offsetMin !== (next.get(selection.participantIndex) ?? 0)) throw new ConflictException('The saved reservation itinerary needs review');
      segments.push({ ...selection, offsetMin, preparationMin, c });
      next.set(selection.participantIndex, offsetMin + c.duration + preparationMin);
    }
    const duration = Math.max(...segments.map(segment => segment.offsetMin + segment.c.duration));
    if (duration > 480 || duration <= 0) throw new BadRequestException('A reservation plan must fit within eight hours');
    return { segments, duration, shop: segments[0].c.shop, shopBookingSettings: segments[0].c.bookingSettings,
      price: cents(segments.reduce((sum, segment) => sum + servicePrice(segment.c.unitPrice, 1, segment.c.priceBasis), 0)),
      participantCount: new Set(segments.map(segment => segment.participantIndex)).size };
  }
  private allocateItinerary(plan: Awaited<ReturnType<BookingService['planContext']>>, date: string, time: string) {
    const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    // Preparation gaps belong to the same wall-clock itinerary. Reject a DST
    // change anywhere in the complete span, even when no individual service
    // crosses it; UTC offsets must never silently shift a later service.
    const span = wallInterval(date, minute, minute + plan.duration, plan.shop.timezone);
    if (!span) return null;
    const start = span.start;
    const opening = plan.segments[0].c.windows;
    if (!meetsShopBookingNotice(plan.shopBookingSettings, start) || !opening.some(w => minute >= w.open && minute < w.close && (minute - w.open) % 30 === 0)) return null;
    for (const segment of plan.segments) {
      const from = minute + segment.offsetMin, until = from + segment.c.duration;
      if (!coveredByOpeningHours(segment.c.windows, from, until) || !wallInterval(date, from, until, plan.shop.timezone)) return null;
      if (this.overlapsTemporaryClosure(segment.c.allocation, new Date(+start + segment.offsetMin * 60000), plan.shopBookingSettings, plan.shop.timezone)) return null;
    }
    const allocation = allocatePlan(plan.segments.map(segment => ({ ...segment, context: segment.c.allocation, preferred: segment.c.preferred })), start);
    return allocation ? { start, end: new Date(+start + plan.duration * 60000), allocation } : null;
  }
  private itinerarySlots(plan: Awaited<ReturnType<BookingService['planContext']>>, date: string) {
    const slots: Array<{ time: string; available: boolean }> = [];
    for (const window of plan.segments[0].c.windows) for (let minute = window.open; minute < window.close && minute + plan.duration <= 1440; minute += 30) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      slots.push({ time, available: !!this.allocateItinerary(plan, date, time) });
    }
    const kinds = new Set(plan.segments.map(segment => readDurationKind(segment.c.durationKind)));
    const durationKind: ServiceDurationKind | 'MIXED' = kinds.size > 1 ? 'MIXED' : [...kinds][0];
    return { ...bookingOrderPolicy(), bookingCalendar: bookingCalendar(plan.shop.timezone), date, timezone: plan.shop.timezone, durationMin: plan.duration, reservedDurationMin: plan.duration, durationKind, participantCount: plan.participantCount, requiredStaffCount: plan.participantCount, priceCents: plan.price,
      items: plan.segments.map(segment => ({ participantIndex: segment.participantIndex, sequence: segment.sequence, serviceId: segment.c.service.id.toString(),
        serviceName: segment.c.service.name, variantId: segment.c.variant?.id.toString() ?? null, variantName: segment.c.variant?.name ?? null,
        durationMin: segment.c.duration, reservedDurationMin: segment.c.duration, durationKind: readDurationKind(segment.c.durationKind), offsetMin: segment.offsetMin, preparationMin: segment.preparationMin,
        priceCents: servicePrice(segment.c.unitPrice, 1, segment.c.priceBasis), priceBasis: segment.c.priceBasis, currency: segment.c.currency })), slots };
  }
  async getPlanSlots(input: PlanInput) {
    normalizePlan(input);
    return reservationTransaction(this.prisma, async tx => {
      const shopId = numericId(input.shopId); await lockShop(tx, shopId); await expireShopHolds(tx, shopId);
      return this.itinerarySlots(await this.planContext(tx, input), input.date);
    });
  }
  async createPlan(input: CreatePlanInput) {
    const items = normalizePlan(input), tip = tipAmount(input.tipCents);
    if (!/^[A-Za-z0-9:_-]{8,100}$/.test(input.requestKey ?? '') || input.paymentMode && !['ONLINE', 'PAY_AT_STORE'].includes(input.paymentMode)) throw new BadRequestException('Use a stable plan request key and a supported payment mode');
    const shopId = numericId(input.shopId), userId = numericId(input.userId);
    const hash = this.planRequest(input, items, false, true), originalHash = this.planRequest(input, items, true, true);
    let booking: any;
    try {
      booking = await reservationTransaction(this.prisma, async tx => {
        await lockShop(tx, shopId); await expireShopHolds(tx, shopId);
        const existing = await this.replay(tx, userId, input.requestKey, hash, originalHash); if (existing) return existing;
        const contact = await this.verifiedContact(tx, userId, input.contact);
        const plan = await this.planContext(tx, { ...input, items });
        const chosen = this.allocateItinerary(plan, input.date, input.startTime);
        if (!chosen) throw new ConflictException('The complete itinerary cannot be accommodated at this time');
        const priced = await this.pricedCreation(tx, input, plan.shop, this.planMainItems(plan), plan.duration, this.planRequest(input, items));
        this.assertCurrentNotice(plan.shopBookingSettings, chosen.start);
        await this.claimQuotedCoupon(tx, priced.userCoupon);
        this.assertCurrentNotice(plan.shopBookingSettings, chosen.start);
        const mode = newBookingPaymentMode(input.paymentMode), discount = priced.view.discountCents, couponId = priced.userCoupon?.couponId ?? null;
        const quote = priced.view, zero = bookingOnlinePaymentEnabled() && quote.totalCents === 0;
        const first = plan.segments[0];
        const row = await tx.booking.create({ data: { bookingNo: `MJ${randomUUID().replace(/-/g, '').slice(0, 25)}`, userId, shopId, ...contact,
          serviceId: first.c.service.id, therapistId: numericId(chosen.allocation[0].therapistIds[0]), ...planTherapistSelection(plan.segments.map(segment => ({ preferred: segment.c.preferred }))), reservationKind: 'PLAN', participantCountSnapshot: plan.participantCount, requiredStaffCountSnapshot: plan.participantCount,
          bookingDate: new Date(`${input.date}T00:00:00Z`), bookingTimezone: plan.shop.timezone, startTime: chosen.start, endTime: chosen.end, durationMin: plan.duration,
          priceCents: quote.subtotalCents, discountCents: discount, platformFeeCents: quote.platformFeeCents, tipCents: tip, totalCents: quote.totalCents, currency: quote.currency,
          couponId, notes: input.notes, requestKey: input.requestKey, requestHash: hash, paymentMode: zero ? 'ZERO' : mode,
          ...(zero ? { status: 'CONFIRMED', paymentStatus: 'PAID' } : { status: 'PENDING', paymentStatus: 'UNPAID' }), holdExpiresAt: zero || !bookingOnlinePaymentEnabled() ? null : new Date(Math.min(Date.now() + holdMinutes() * 60000, +chosen.start)) } });
        if (zero) {
          await tx.bookingSettlementEntry.create({ data: { bookingId: row.id, kind: 'ZERO', amountCents: 0, currency: row.currency, requestKey: 'zero:creation:v1',
            requestHash: createHash('sha256').update(`zero:${row.id}:${plan.price}:${discount}`).digest('hex'), occurredAt: new Date(), reason: 'Fully discounted reservation plan; no money collected' } });
          await tx.auditLog.create({ data: { action: 'BOOKING_ZERO_SETTLEMENT', targetType: 'BOOKING', targetId: row.id, operatorId: userId,
            detail: { priceCents: quote.subtotalCents, discountCents: discount, amountCents: 0, currency: row.currency } } });
        }
        if (input.couponId) await tx.userCoupon.update({ where: { id: numericId(input.couponId) }, data: { bookingId: row.id } });
        const savedItems: any[] = [];
        for (let index = 0; index < plan.segments.length; index++) {
          const segment = plan.segments[index], a = chosen.allocation[index], c = segment.c;
          const item = await tx.bookingItem.create({ data: { bookingId: row.id, serviceId: c.service.id, variantId: c.variant?.id ?? null,
            participantIndex: segment.participantIndex, sequence: segment.sequence, offsetMin: segment.offsetMin, requiredStaffCountSnapshot: 1, ...newTherapistSelection(c.preferred),
            serviceNameSnapshot: c.service.name, variantNameSnapshot: c.variant?.name ?? null, durationKindSnapshot: c.durationKind, roomTypeSnapshot: c.roomType,
            durationMin: c.duration, staffBufferMin: c.staffBuffer, roomBufferMin: c.roomBuffer,
            priceCentsSnapshot: c.unitPrice, quotedUnitPriceCents: c.unitPrice, priceBasisSnapshot: c.priceBasis, currency: c.currency,
            assignedRoomId: a.roomId ? numericId(a.roomId) : null, assignedTherapistId: numericId(a.therapistIds[0]),
            startAtUtc: a.staffWindow.start, endAtUtc: new Date(+a.staffWindow.start + c.duration * 60000) } });
          savedItems.push(item);
          await this.writeLocks(tx, row, [item], a);
        }
        await persistBookingAddOns(tx, row.id, savedItems, priced.resolved);
        await this.notifyBooking(tx, row, zero ? 'BOOKING_CONFIRMED' : 'BOOKING_CREATED', zero ? 'confirmed' : 'created');
        return tx.booking.findUniqueOrThrow({ where: { id: row.id }, include: DETAIL });
      });
    } catch (error) {
      if (!orderInputRequired(error) && (normalizeAddOnSelections(input.addOnSelections).length || input.quoteHash !== undefined || input.quoteExpiresAt !== undefined) && error instanceof BadRequestException) throw new ConflictException('The reservation quote changed; request a fresh quote before submitting');
      if ((error as any).code !== 'P2002') throw error;
      booking = await this.replay(this.prisma, userId, input.requestKey, hash, originalHash); if (!booking) throw error;
    }
    return this.serialize(booking);
  }
  private async movePlan(tx: any, b: any, data: { date: string; startTime: string; therapistId?: string; preferredTherapistIds?: string[] }, manager: boolean, actor: string, role: string) {
    if (data.therapistId || data.preferredTherapistIds?.length) throw new BadRequestException('A multi-service itinerary cannot replace all segment preferences with one therapist');
    const plan = await this.planContext(tx, { shopId: b.shopId.toString(), date: data.date, items: [] }, b, manager);
    const chosen = this.allocateItinerary(plan, data.date, data.startTime);
    if (!chosen) {
      if (plan.segments.some(segment => segment.c.preferred.length)) throw requestedTherapistUnavailable();
      throw new ConflictException('The complete itinerary cannot be moved to this time');
    }
    if (b.startTime <= new Date()) throw new BadRequestException('This booking can no longer be rescheduled');
    await releaseReservation(tx, b.id);
    for (let index = 0; index < plan.segments.length; index++) {
      const segment = plan.segments[index], a = chosen.allocation[index];
      const original = b.items.find((item: any) => item.participantIndex === segment.participantIndex && item.sequence === segment.sequence);
      const item = await tx.bookingItem.update({ where: { id: original.id }, data: { startAtUtc: a.staffWindow.start,
        endAtUtc: new Date(+a.staffWindow.start + segment.c.duration * 60000), assignedRoomId: a.roomId ? numericId(a.roomId) : null, assignedTherapistId: numericId(a.therapistIds[0]) } });
      await this.writeLocks(tx, b, [item], a);
    }
    const result = await tx.booking.update({ where: { id: b.id }, data: { bookingDate: new Date(`${data.date}T00:00:00Z`), bookingTimezone: plan.shop.timezone,
      startTime: chosen.start, endTime: chosen.end, therapistId: numericId(chosen.allocation[0].therapistIds[0]),
      ...(b.holdExpiresAt ? { holdExpiresAt: new Date(Math.min(+b.holdExpiresAt, +chosen.start)) } : {}) }, include: DETAIL });
    if (role !== 'CUSTOMER') await tx.auditLog.create({ data: { action: 'BOOKING_RESCHEDULE', targetType: 'BOOKING', targetId: b.id, operatorId: numericId(actor),
      detail: { previousStart: b.startTime.toISOString(), start: chosen.start.toISOString(), reservationKind: 'PLAN' } } });
    await this.notifyBooking(tx, result, 'BOOKING_RESCHEDULED', `rescheduled:${randomUUID()}`);
    return result;
  }
  async getRescheduleSlots(id: string, actor: string, role: string, date: string) {
    return reservationTransaction(this.prisma, async tx => {
      const ref = await tx.booking.findUnique({ where: { id: numericId(id) }, select: { shopId: true } });
      if (!ref) throw new NotFoundException('Booking not found');
      await lockShop(tx, ref.shopId); await expireShopHolds(tx, ref.shopId);
      const b = await tx.booking.findUnique({ where: { id: numericId(id) }, include: DETAIL });
      if (!b || b.deletedAt || !await this.allowed(tx, b, actor, role, 'BOOKINGS_READ', true)) throw new NotFoundException('Booking not found');
      if (!(b.status === 'PENDING' && b.paymentStatus === 'UNPAID' || b.status === 'CONFIRMED' && (fullySettled(b) || settlementMode(b) === 'PAY_AT_STORE' && b.refundedCents === 0)) || b.startTime <= new Date() || await tx.refundRequest.findFirst({ where: { bookingId: b.id, status: { in: ['PENDING', 'RETRYABLE'] } } })) throw new BadRequestException('This booking cannot be rescheduled');
      const manager = ['ADMIN', 'MERCHANT', 'STAFF'].includes(role);
      if (b.reservationKind === 'PLAN') {
        const plan = await this.planContext(tx, { shopId: b.shopId.toString(), date, items: [] }, b, manager);
        if (b.startTime <= new Date()) throw new BadRequestException('This booking cannot be rescheduled');
        return { ...this.itinerarySlots(plan, date), ...savedTherapistSelection(b) };
      }
      const first = b.items[0];
      const selection = rescheduleTherapistSelection(b);
      const c = await this.context(tx, { shopId: b.shopId.toString(), serviceId: b.serviceId.toString(), date, variantId: first?.variantId?.toString(), preferredTherapistIds: selection.requestedTherapistIds }, b.id,
        { durationKind: readDurationKind(first?.durationKindSnapshot), duration: b.durationMin, unitPrice: first?.quotedUnitPriceCents ?? first?.priceCentsSnapshot ?? b.priceCents, count: b.participantCountSnapshot ?? (b.items.length || 1), staffCount: b.requiredStaffCountSnapshot ?? (b.items.length || 1),
          staffBuffer: first?.staffBufferMin ?? 0, roomBuffer: first?.roomBufferMin ?? 0, roomType: first?.roomTypeSnapshot ?? null, currency: b.currency, priceBasis: first?.priceBasisSnapshot }, manager);
      const slots: Array<{ time: string; available: boolean }> = [];
      const now = new Date();
      if (b.startTime <= now) throw new BadRequestException('This booking cannot be rescheduled');
      for (const window of c.windows) for (let minute = window.open; minute < window.close; minute += 30) {
        if (!coveredByOpeningHours(c.windows, minute, minute + c.duration)) continue;
        const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
        const span = wallInterval(date, minute, minute + c.duration, c.shop.timezone);
        slots.push({ time, available: !!span && meetsShopBookingNotice(c.bookingSettings, span.start, now) && !this.overlapsTemporaryClosure(c.allocation, span.start, c.bookingSettings, c.shop.timezone) && !!allocate(c.allocation, span.start, c.preferred) });
      }
      return { ...bookingOrderPolicy(), ...selection, bookingCalendar: bookingCalendar(c.shop.timezone), date, timezone: c.shop.timezone, durationMin: c.duration, reservedDurationMin: c.duration, durationKind: c.durationKind, participantCount: c.count, requiredStaffCount: c.staffCount ?? c.count, priceCents: b.priceCents, slots };
    });
  }
  private async notifyBooking(tx: any, row: any, topic: NotificationTopic, key: string) {
    await enqueueNotification(tx, { eventKey: `booking:${row.id}:${key}`, userId: row.userId, topic, resourceType: 'BOOKING', resourceId: String(row.id), bookingId: row.id });
    await enqueueBookingOrderEmail(tx, { eventKey: `booking:${row.id}:${key}`, userId: row.userId, bookingId: row.id, topic });
    await syncBookingReminder(tx, row);
  }
  private async writeLocks(tx: any, booking: any, items: any[], allocation: NonNullable<ReturnType<typeof allocate>>) {
    const staffItems = items.flatMap(item => Array.from({ length: item.requiredStaffCountSnapshot ?? 1 }, () => item));
    if (staffItems.length !== allocation.therapistIds.length) throw new BadRequestException('Reservation staff snapshot does not match its allocation');
    const rows: any[] = allocation.therapistIds.map((id, index) => ({ bookingId: booking.id, bookingItemId: staffItems[index].id, shopId: booking.shopId,
      resourceType: 'THERAPIST', resourceId: numericId(id), startAtUtc: allocation.staffWindow.start, endAtUtc: allocation.staffWindow.end, status: 'ACTIVE' }));
    if (allocation.roomId) rows.push({ bookingId: booking.id, bookingItemId: null, shopId: booking.shopId,
      resourceType: 'ROOM', resourceId: numericId(allocation.roomId), startAtUtc: allocation.roomWindow.start, endAtUtc: allocation.roomWindow.end, status: 'ACTIVE' });
    await tx.bookingResourceLock.createMany({ data: rows });
  }
  private async allowed(db: any, booking: any, userId: string, role: string, permission: 'BOOKINGS_READ' | 'BOOKINGS_MANAGE' = 'BOOKINGS_READ', write = false) {
    if (role === 'CUSTOMER') return booking.userId != null && booking.userId.toString() === userId;
    if (!['ADMIN','MERCHANT','STAFF'].includes(role)) return false;
    try { await requireShopAccess(db,booking.shopId,{id:userId,role},permission,{write}); return true; } catch { return false; }
  }
  private async lockOwned(tx: any, id: string, userId: string, role: string, permission: 'BOOKINGS_READ' | 'BOOKINGS_MANAGE' = 'BOOKINGS_MANAGE', expire = true) {
    const bid = numericId(id);
    const reference = await tx.booking.findUnique({ where: { id: bid }, select: { shopId: true } });
    if (!reference) throw new NotFoundException('Booking not found');
    await lockShop(tx, reference.shopId); if (expire) await expireShopHolds(tx, reference.shopId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${bid} FOR UPDATE`);
    const booking = await tx.booking.findUnique({ where: { id: bid }, include: DETAIL });
    if (!booking || booking.deletedAt || !await this.allowed(tx, booking, userId, role, permission, true)) throw new NotFoundException('Booking not found');
    return booking;
  }
  async reconcileOperation(id: string, userId: string, role: string, key: string) {
    if (!['ADMIN', 'MERCHANT', 'STAFF', 'CUSTOMER'].includes(role)) throw new ForbiddenException('Booking operation reconciliation is unavailable for this account');
    const requestKey = bookingOperationKey(key)!;
    return reservationTransaction(this.prisma, async tx => {
      const b = await this.lockOwned(tx, id, userId, role, 'BOOKINGS_READ', false);
      const result = await reconcileBookingOperation(tx, b, userId, requestKey);
      // Customers recover only their own reschedule command. The shared actor /
      // booking key and lockOwned checks remain the authority for every outcome.
      if (role === 'CUSTOMER' && result.outcome === 'COMMITTED' && result.action !== 'RESCHEDULE') {
        throw new ConflictException('This operation key does not identify a reschedule command');
      }
      return result;
    });
  }
  async updateBookingStatus(id: string, userId: string, status: string, role = 'CUSTOMER', operationKey?: string, cancelReason?: unknown) {
    const key = bookingOperationKey(operationKey);
    const isAdminCancellation = role === 'ADMIN' && status === 'CANCELLED';
    const reasonError = '请输入取消原因，去除首尾空格后须为 1 至 500 个字符。';
    if (isAdminCancellation && cancelReason !== undefined && typeof cancelReason !== 'string') {
      throw new BadRequestException(reasonError);
    }
    const reason = isAdminCancellation && typeof cancelReason === 'string' ? cancelReason.trim() : undefined;
    const booking = await reservationTransaction(this.prisma, async tx => {
      const b = await this.lockOwned(tx, id, userId, role);
      return bookingOperation(tx, b, userId, key, `STATUS:${status}`, { status, cancelReason: reason }, async () => {
      // Check inside the operation so an already committed reasonless command can still replay.
      if (isAdminCancellation && (!reason || reason.length > 500)) throw new BadRequestException(reasonError);
      const manager = ['ADMIN', 'MERCHANT', 'STAFF'].includes(role);
      if (status !== 'CANCELLED' && (!manager || !['CONFIRMED', 'COMPLETED'].includes(status))) {
        throw new ForbiddenException('Booking transition is not permitted');
      }
      const valid = status === 'CANCELLED'
        ? ['PENDING', 'CONFIRMED'].includes(b.status)
        : status === 'CONFIRMED' ? b.status === 'PENDING' : b.status === 'CONFIRMED';
      if (!valid) {
        if (!manager) throw new ForbiddenException('Booking transition is not permitted');
        throw new ConflictException({ code: 'BOOKING_STATUS_CHANGED', message: '预约状态已变化，请刷新订单后核对。' });
      }
      if (status === 'CANCELLED' && b.paidCents > b.refundedCents) throw new BadRequestException('Refund the payment before cancelling');
      if (status === 'CONFIRMED' && settlementMode(b) !== 'PAY_AT_STORE' && !fullySettled(b)) throw new BadRequestException('A settled booking is required');
      if (status === 'COMPLETED' && !fullySettled(b) && !offlineFulfilmentAllowed(b)) throw new BadRequestException('Collect the outstanding amount before completing the service');
      if (await tx.refundRequest.findFirst({ where: { bookingId: b.id, status: { in: ['PENDING', 'RETRYABLE'] } }, select: { id: true } })) throw new ConflictException('Resolve the pending refund before changing this reservation');
      if (status === 'COMPLETED' && b.endTime > new Date()) throw new BadRequestException('A booking cannot complete before the service ends');
      // Finishing the service does not skip the staff/room cleanup buffer.
      if (status === 'CANCELLED') await releaseReservation(tx, b.id);
      if (status === 'COMPLETED') await tx.bookingResourceLock.updateMany({ where: { bookingId: b.id, status: 'ACTIVE', endAtUtc: { lte: new Date() } }, data: { status: 'RELEASED' } });
      if (status === 'CANCELLED') await restoreBookingCoupon(tx, b);
      const result = await tx.booking.update({ where: { id: b.id }, data: {
        status: status as any,
        ...(status === 'CONFIRMED' ? { holdExpiresAt: null } : {}),
        ...(reason !== undefined ? { cancelReason: reason } : {}),
      }, include: DETAIL });
      await tx.auditLog.create({ data: { action: `BOOKING_${status}`, targetType: 'BOOKING', targetId: b.id, operatorId: numericId(userId), detail: { previousStatus: b.status, newStatus: status, paymentMode: settlementMode(b) } } });
      await this.notifyBooking(tx, result, `BOOKING_${status}` as NotificationTopic, status.toLowerCase());
      return result;
      }, async () => b);
    });
    return this.serialize(booking);
  }
  cancelBooking(id: string, userId: string, role = 'CUSTOMER', operationKey?: string, cancelReason?: unknown) {
    return this.updateBookingStatus(id, userId, 'CANCELLED', role, operationKey, cancelReason);
  }
  async rescheduleBooking(id: string, userId: string, data: { date: string; startTime: string; therapistId?: string; preferredTherapistIds?: string[] }, role = 'CUSTOMER', operationKey?: string) {
    const key = bookingOperationKey(operationKey);
    const booking = await reservationTransaction(this.prisma, async tx => {
      const b = await this.lockOwned(tx, id, userId, role);
      return bookingOperation(tx, b, userId, key, 'RESCHEDULE', data, async () => {
      if (!(b.status === 'PENDING' && b.paymentStatus === 'UNPAID' || b.status === 'CONFIRMED' && (fullySettled(b) || settlementMode(b) === 'PAY_AT_STORE' && b.refundedCents === 0)) || b.startTime <= new Date()) throw new BadRequestException('This booking can no longer be rescheduled');
      if (await tx.refundRequest.findFirst({ where: { bookingId: b.id, status: { in: ['PENDING', 'RETRYABLE'] } }, select: { id: true } })) throw new ConflictException('Resolve the pending refund before rescheduling');
      if (b.reservationKind === 'PLAN') return this.movePlan(tx, b, data, ['ADMIN', 'MERCHANT', 'STAFF'].includes(role), userId, role);
      const original = [...b.items].sort((a: any, z: any) => a.participantIndex - z.participantIndex);
      const item = original[0];
      const snapshot: Snapshot = { durationKind: readDurationKind(item?.durationKindSnapshot), duration: b.durationMin, unitPrice: item?.quotedUnitPriceCents ?? item?.priceCentsSnapshot ?? b.priceCents, count: b.participantCountSnapshot ?? (original.length || 1), staffCount: b.requiredStaffCountSnapshot ?? (original.length || 1),
        staffBuffer: item?.staffBufferMin ?? 0, roomBuffer: item?.roomBufferMin ?? 0, roomType: item?.roomTypeSnapshot ?? null, currency: b.currency, priceBasis: item?.priceBasisSnapshot };
      const manager = ['ADMIN', 'MERCHANT', 'STAFF'].includes(role);
      const selection = rescheduleTherapistSelection(b, data);
      const c = await this.context(tx, { date: data.date, preferredTherapistIds: selection.requestedTherapistIds, shopId: b.shopId.toString(), serviceId: b.serviceId.toString(), variantId: item?.variantId?.toString() }, b.id, snapshot, manager);
      const start = this.selectedTime(c, data), end = new Date(+start + b.durationMin * 60000);
      const allocation = allocate(c.allocation, start, c.preferred);
      if (!allocation) {
        if (selection.therapistSelectionMode === 'SPECIFIC') throw requestedTherapistUnavailable();
        throw new ConflictException('The new time cannot accommodate the required staff and room');
      }
      // Resolving the replacement calendars can cross the original start.
      // Recheck before the first mutation so an in-progress order stays intact.
      if (b.startTime <= new Date()) throw new BadRequestException('This booking can no longer be rescheduled');
      await releaseReservation(tx, b.id);
      if (!original.length) original.push(await tx.bookingItem.create({ data: { bookingId: b.id, serviceId: b.serviceId, participantIndex: 1, serviceNameSnapshot: b.service.name, durationKindSnapshot: 'TIMED',
        durationMin: b.durationMin, staffBufferMin: 0, roomBufferMin: 0, priceCentsSnapshot: b.priceCents, currency: b.currency, startAtUtc: start, endAtUtc: end } }));
      for (let index = 0; index < original.length; index++) await tx.bookingItem.update({ where: { id: original[index].id }, data: { startAtUtc: start, endAtUtc: end, assignedTherapistId: numericId(allocation.therapistIds[index]), assignedRoomId: allocation.roomId ? numericId(allocation.roomId) : null } });
      await this.writeLocks(tx, b, original, allocation);
      const result = await tx.booking.update({ where: { id: b.id }, data: { bookingDate: new Date(`${data.date}T00:00:00Z`), bookingTimezone: c.shop.timezone, startTime: start, endTime: end,
        therapistId: numericId(allocation.therapistIds[0]), ...(b.holdExpiresAt ? { holdExpiresAt: new Date(Math.min(+b.holdExpiresAt, +start)) } : {}) }, include: DETAIL });
      if (['ADMIN', 'MERCHANT', 'STAFF'].includes(role)) await tx.auditLog.create({ data: { action: 'BOOKING_RESCHEDULE', targetType: 'BOOKING', targetId: b.id, operatorId: numericId(userId), detail: { previousStart: b.startTime.toISOString(), start: start.toISOString() } } });
      await this.notifyBooking(tx, result, 'BOOKING_RESCHEDULED', `rescheduled:${randomUUID()}`);
      return result;
      }, async () => b);
    });
    return this.serialize(booking);
  }
  async deleteBooking(id: string, userId: string) {
    return reservationTransaction(this.prisma, async tx => {
      // A visibility preference must not expire holds, release cleanup buffers,
      // cancel reminders, or otherwise mutate the shop's reservation lifecycle.
      const b = await this.lockOwned(tx, id, userId, 'CUSTOMER', 'BOOKINGS_READ', false);
      if (b.userId == null || b.userId.toString() !== userId) throw new NotFoundException('Booking not found');
      if (b.customerHiddenAt) return { success: true };
      if (![b.totalCents, b.paidCents, b.refundedCents].every(value => Number.isSafeInteger(value) && value >= 0)) throw new BadRequestException('Booking amounts require reconciliation before hiding');
      if (b.paidCents > 0 || b.refundedCents > 0) throw new BadRequestException('Paid booking records must be retained for accounting');
      if (!['CANCELLED', 'COMPLETED', 'REFUNDED'].includes(b.status)) throw new BadRequestException('Only terminal bookings can be hidden');
      // A completed service retains its receivable even when no cash has yet
      // been recorded. Cancelled/refunded reservations have no new receivable.
      if (b.status === 'COMPLETED' && b.totalCents > b.paidCents - b.refundedCents) throw new BadRequestException('Outstanding booking amounts must be settled before hiding');
      await tx.booking.update({ where: { id: b.id }, data: { customerHiddenAt: new Date() } });
      await tx.auditLog.create({ data: { action: 'BOOKING_CUSTOMER_HIDDEN', targetType: 'BOOKING', targetId: b.id,
        operatorId: numericId(userId), detail: { audience: 'CUSTOMER', previousStatus: b.status } } });
      return { success: true };
    });
  }
  async getBooking(id: string, userId: string, role = 'CUSTOMER') {
    const b = await this.prisma.booking.findUnique({ where: { id: numericId(id) }, include: DETAIL });
    if (!b || b.deletedAt || (role === 'CUSTOMER' && b.customerHiddenAt) || !await this.allowed(this.prisma, b, userId, role)) throw new NotFoundException('Booking not found');
    const serialized = this.serialize(b);
    return ['ADMIN', 'MERCHANT', 'STAFF'].includes(role) ? { ...serialized, reception: await bookingReception(this.prisma, b, serialized) } : serialized;
  }
  async listUserBookings(id: string, input: BookingListQuery = {}) {
    const query = parseBookingListQuery(input), where = bookingListWhere(query, { userId: numericId(id) }, 'customer');
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include: DETAIL, orderBy: BOOKING_LIST_ORDER, ...(query.paged ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}) }),
      this.prisma.booking.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const items = rows.map(row => this.serialize(row));
    return query.paged ? bookingListResult(items, total, query) : items;
  }
  requestRefund(id: string, userId: string, role = 'CUSTOMER', key?: string) { return this.payments.refundBooking(id, userId, role, undefined, key); }
  requestPartialRefund(id: string, userId: string, amount: number, role = 'CUSTOMER', key?: string) { return this.payments.refundBooking(id, userId, role, amount, key); }
  private serialize(b: any) {
    const { requestHash, requestKey, resourceLocks, addOns: _rawAddOns,
      contactName, contactPhone, contactEmail, contactVersion, contactSource, contactEmailVerifiedAt, ...safe } = b;
    Object.assign(safe, { contact: bookingContactView(b) });
    Object.assign(safe, savedTherapistSelection(b));
    const timezone = bookingLocalFields(b, b.shop?.timezone).timezone;
    const assignedIds = (item: any): string[] => {
      const sameItem = (resourceLocks ?? []).filter((lock: any) => String(lock.bookingItemId) === String(item.id) && lock.resourceType === 'THERAPIST'
        && +new Date(lock.startAtUtc) === +new Date(item.startAtUtc) && +new Date(lock.endAtUtc) === +new Date(item.endAtUtc) + (item.staffBufferMin ?? 0) * 60000);
      const active = sameItem.filter((lock: any) => lock.status === 'ACTIVE');
      // Cancellation releases the current locks. Use the most recent assignment
      // when an earlier reschedule kept the same time but replaced an employee.
      const latest = [...(active.length ? active : sameItem)].sort((a: any, z: any) => {
        const timestamp = +new Date(z.createdAt ?? 0) - +new Date(a.createdAt ?? 0);
        if (timestamp) return timestamp;
        const left = BigInt(a.id ?? 0), right = BigInt(z.id ?? 0);
        return left === right ? 0 : left < right ? 1 : -1;
      });
      const primary = item.assignedTherapistId?.toString();
      return [...new Set<string>([...(primary ? [primary] : []), ...latest.map((lock: any) => lock.resourceId.toString())])].slice(0, item.requiredStaffCountSnapshot ?? 1);
    };
    const items = b.items?.map((item: any) => ({ ...item, ...savedTherapistSelection(b.reservationKind === 'PLAN' ? item : b), ...itemDurationMeta(item), id: item.id.toString(), bookingId: item.bookingId.toString(), serviceId: item.serviceId.toString(), variantId: item.variantId?.toString() ?? null,
      sequence: item.sequence ?? 1, offsetMin: item.offsetMin ?? 0, preparationMin: b.reservationKind === 'PLAN' ? storedPlanPreparationMin(item, b.items) ?? 0 : Math.max(item.staffBufferMin ?? 0, item.roomBufferMin ?? 0),
      timezone, localStartTime: timezone ? localParts(item.startAtUtc, timezone) : null, localEndTime: timezone ? localParts(item.endAtUtc, timezone) : null,
      assignedTherapistIds: assignedIds(item), requiredStaffCount: item.requiredStaffCountSnapshot ?? 1, assignedTherapistId: item.assignedTherapistId?.toString() ?? null, assignedRoomId: bookingItemRoomId(b, item), therapistId: item.assignedTherapistId?.toString() ?? resourceLocks?.find((lock: any) => lock.bookingItemId === item.id && lock.resourceType === 'THERAPIST' && lock.status === 'ACTIVE')?.resourceId.toString() ?? null }));
    return { ...safe, ...bookingOrderPolicy(), ...bookingAddOnsView(b), ...bookingDurationMeta(b), ...(b.service ? { service: historicalBookingService(b) } : {}), ...(b.shop ? { shop: { id: b.shop.id.toString(), name: b.shop.name, address: b.shop.address, city: b.shop.city, state: b.shop.state, phone: b.shop.phone, timezone: b.shop.timezone, shortName: b.shop.shortName, ...publicShopProfile(b.shop, [], { includePriceMenu: false, includeBookingCalendar: false }) } } : {}), paymentMode: settlementMode(b), amountDueCents: b.paymentStatus === 'REFUNDED' || ['CANCELLED', 'REFUNDED', 'REFUNDING'].includes(b.status) ? 0 : Math.max(0, b.totalCents - b.paidCents + b.refundedCents),
      ...(items ? { items } : {}), participantCount: b.participantCountSnapshot ?? Math.max(1, new Set((items ?? []).map((item: any) => item.participantIndex)).size), requiredStaffCount: b.requiredStaffCountSnapshot ?? Math.max(1, new Set((items ?? []).map((item: any) => item.participantIndex)).size), ...bookingLocalFields(b, b.shop?.timezone), id: b.id.toString(), userId: b.userId?.toString() ?? null, assistedById: b.assistedById?.toString() ?? null, shopId: b.shopId.toString(), serviceId: b.serviceId.toString(), therapistId: b.therapistId?.toString() ?? null, couponId: b.couponId?.toString() ?? null, payableCents: b.totalCents, hasReview: !!b.review };
  }
}
