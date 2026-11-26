import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { coveredByShifts, effectiveWeeklyShifts } from '../booking/work-schedule';
import { coveredByOpeningHours, openingIntervals } from '../booking/hours';
import { readDurationKind } from '../../common/service-duration';
import { hasServiceVariants } from '../../common/service-reservation-options';
import { localParts } from '../booking/time';
import { Actor, id } from './reservation-validation';
import { requireShopAccess, ShopPermission } from '../../common/shop-access';
import { storedBookingServiceWindows } from '../../common/booking-service-windows';
import { isRetryableTransactionError } from '../../common/transaction-retry';
import { introducedShopClosures, isShopClosedDuring, readShopBookingSettings, ShopBookingSettings } from '../../common/shop-booking-settings';

/** Expired unpaid holds are never live reservations, even before lazy cleanup runs. */
export function effectiveBookingWhere(now = new Date()): any {
  return { deletedAt: null, status: { in: ['PENDING', 'CONFIRMED'] }, OR: [
    { status: 'CONFIRMED' }, { paymentStatus: { not: 'UNPAID' } }, { paidCents: { gt: 0 } }, { holdExpiresAt: null }, { holdExpiresAt: { gt: now } },
  ] };
}

/** Active future resource windows outlive the service status/end during cleanup.
 * A terminal/deleted booking that still has ACTIVE locks is an inconsistency:
 * protect it until lifecycle cleanup/reconciliation releases those rows.
 * The only deliberate exception is an expired, wholly unpaid PENDING hold. */
export function resourceBookingWhere(now = new Date()): any {
  return { OR: [
    { status: { not: 'PENDING' } }, { paymentStatus: { not: 'UNPAID' } }, { paidCents: { gt: 0 } },
    { holdExpiresAt: null }, { holdExpiresAt: { gt: now } },
  ] };
}

/** No DI dependency: all configuration entry points share this shop-first RC protocol.
 * A preliminary ID-only lookup may discover a parent; authorization/data are reread here. */
export async function withShopConfiguration<T>(prisma: any, shopId: bigint, actor: Actor, callback: (tx: any, shop: any) => Promise<T>, permission: ShopPermission | 'OWNER_ONLY' = 'CATALOG_MANAGE'): Promise<T> {
  if (!actor || !['ADMIN', 'MERCHANT'].includes(actor.role)) throw new ForbiddenException();
  const operatorId = id(actor.id);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`;
        const { shop } = await requireShopAccess(tx, shopId, actor, permission, { write: true });
        return callback(tx, shop);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (!isRetryableTransactionError(error)) throw error;
      if (attempt === 2) throw new ServiceUnavailableException('配置写入冲突，请稍后重试');
    }
  }
  throw new ServiceUnavailableException('请稍后重试');
}

export async function configurationAudit(tx: any, actor: Actor, targetType: string, targetId: bigint, action: string, fields: string[]) {
  await tx.auditLog.create({ data: { operatorId: id(actor.id), targetType, targetId, action,
    detail: { fields: fields.filter(field => !/password|token|secret/i.test(field)) } } });
}

export async function ensureServiceConfiguration(tx: any, previous: any, changes: any) {
  if (!previous) return;
  const disabling = previous.isActive !== false && changes.isActive === false;
  let typeChanged = false;
  if (changes.durationKind !== undefined) {
    const nextKind = readDurationKind(changes.durationKind);
    try { typeChanged = nextKind !== readDurationKind(previous.durationKind); } catch { typeChanged = true; }
  }
  if (!disabling && !typeChanged) return;
  const future = await tx.booking.findFirst({ where: { shopId: previous.shopId, ...effectiveBookingWhere(), endTime: { gt: new Date() },
    AND: [{ OR: [{ serviceId: previous.id }, { items: { some: { serviceId: previous.id } } }] }] }, select: { id: true } });
  if (future) throw new ConflictException(typeChanged ? '服务仍有有效未来预约，不能转换服务类型；请先处理已有预约' : '服务仍有有效未来预约，不能停用；请先处理已有预约');
}

/** Only legacy service CRUD uses this guard; menu/variant writes edit their real option. */
export function ensureBaseServiceEdit(previous: any, changes: any) {
  if (!hasServiceVariants(previous)) return;
  if (['priceCents', 'durationMin'].some(field => Object.prototype.hasOwnProperty.call(changes, field) && changes[field] !== previous[field])) {
    throw new ConflictException('该服务已有独立规格，基础价格和时长不生效；请到预约设置修改规格价格与占用时间');
  }
}

export async function ensureTherapistConfiguration(tx: any, previous: any, changes: any, _legacyServiceIds?: bigint[]) {
  if (!previous) return;
  const disabling = previous.isActive && changes.isActive === false;
  // Legacy mapping edits do not reduce the shop-wide pool. Only deactivation
  // can invalidate existing occupation; callers still validate legacy IDs' shop.
  if (!disabling) return;
  const now = new Date();
  const locks = await tx.bookingResourceLock.findMany({ where: { shopId: previous.shopId, resourceType: 'THERAPIST', resourceId: previous.id, status: 'ACTIVE', endAtUtc: { gt: now }, booking: resourceBookingWhere(now) },
    select: { bookingItem: { select: { serviceId: true } }, booking: { select: { serviceId: true } } } });
  const legacy = await tx.booking.findMany({ where: { shopId: previous.shopId, ...effectiveBookingWhere(now), endTime: { gt: now }, items: { none: {} },
    AND: [{ OR: [{ therapistId: previous.id }, { therapistId: null }] }] }, select: { serviceId: true } });
  if (locks.length || legacy.length) {
    throw new ConflictException('技师仍有有效预约，不能停用；请先处理已有预约');
  }
}

export async function ensureShopConfiguration(tx: any, previous: any, changes: any) {
  const timezoneChanged = changes.timezone !== undefined && changes.timezone !== previous.timezone;
  const hoursChanged = changes.businessHours !== undefined && JSON.stringify(changes.businessHours) !== JSON.stringify(previous.businessHours);
  if (!timezoneChanged && !hoursChanged) return;
  if (timezoneChanged && await tx.shopCalendarBlock.findFirst({ where: { shopId: previous.id, status: 'ACTIVE' }, select: { id: true } })) {
    throw new ConflictException('门店仍有日历占用，请先解除占用再修改预约时区');
  }
  const bookings = await tx.booking.findMany({ where: { shopId: previous.id, ...effectiveBookingWhere(), endTime: { gt: new Date() } }, select: {
    id: true, reservationKind: true, participantCountSnapshot: true, durationMin: true, startTime: true, endTime: true,
    items: { select: { id: true, bookingId: true, participantIndex: true, sequence: true, offsetMin: true, requiredStaffCountSnapshot: true,
      durationMin: true, staffBufferMin: true, roomBufferMin: true, roomTypeSnapshot: true, startAtUtc: true, endAtUtc: true } },
  } });
  const locks = await tx.bookingResourceLock.findMany({ where: { shopId: previous.id, status: 'ACTIVE', endAtUtc: { gt: new Date() }, booking: resourceBookingWhere() }, select: { startAtUtc: true, endAtUtc: true, resourceType: true, resourceId: true } });
  if (!bookings.length && !locks.length) return;
  if (timezoneChanged) throw new ConflictException('门店仍有有效未来预约，不能修改预约时区');
  const hours = openingIntervals(changes.businessHours);
  const work = effectiveWeeklyShifts('SHOP', changes.businessHours, []);
  const staffIds = [...new Set<bigint>(locks.filter((lock: any) => lock.resourceType === 'THERAPIST').map((lock: any) => lock.resourceId))];
  const therapists = staffIds.length ? await tx.therapist.findMany({ where: { shopId: previous.id, id: { in: staffIds } }, select: { id: true, scheduleMode: true } }) : [];
  const modes = new Map<string, unknown>(therapists.map((therapist: any) => [String(therapist.id), therapist.scheduleMode]));
  // Personal schedules and room cleanup are independent of the public opening
  // window. Their resource locks remain intact. Unknown staff modes fail closed.
  const inheritedLocks = locks.filter((lock: any) => lock.resourceType === 'THERAPIST' ? modes.get(String(lock.resourceId)) !== 'CUSTOM' : lock.resourceType !== 'ROOM');
  if (inheritedLocks.some((window: any) => !coveredByShifts(window, previous.timezone, work))) throw new ConflictException('营业时间调整会影响跟随门店的技师占用（含收尾缓冲），请先处理预约');
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const booking of bookings.flatMap((row: any) => storedBookingServiceWindows(row))) {
    if (!previous.timezone) throw new ConflictException('已有预约缺有效时区，请先核对预约');
    const start = localParts(booking.startTime, previous.timezone); const end = localParts(booking.endTime, previous.timezone);
    const day = days[new Date(`${start.slice(0, 10)}T12:00:00Z`).getUTCDay()];
    const a = Number(start.slice(11, 13)) * 60 + Number(start.slice(14));
    const b = Number(end.slice(11, 13)) * 60 + Number(end.slice(14));
    if (start.slice(0, 10) !== end.slice(0, 10) || !coveredByOpeningHours(hours[day], a, b)) {
      throw new ConflictException('营业时间调整会影响已有预约，请先处理预约');
    }
  }
}

/** The caller holds the shop mutex shared with booking creation/rescheduling.
 * A closure cannot silently strand a live appointment. Notice changes do not
 * invalidate an existing booking, and removing old closures remains allowed. */
export async function ensureShopBookingSettings(tx: any, shop: any, next: ShopBookingSettings) {
  const introduced = introducedShopClosures(readShopBookingSettings(shop.studioProfile), next);
  if (!introduced.length) return;
  const now = new Date();
  const bookings = await tx.booking.findMany({ where: { shopId: shop.id, ...effectiveBookingWhere(now), endTime: { gt: now } },
    select: { id: true, reservationKind: true, participantCountSnapshot: true, durationMin: true, startTime: true, endTime: true,
      items: { select: { id: true, bookingId: true, participantIndex: true, sequence: true, offsetMin: true, requiredStaffCountSnapshot: true,
        durationMin: true, staffBufferMin: true, roomBufferMin: true, roomTypeSnapshot: true, startAtUtc: true, endAtUtc: true } } } });
  const locks = await tx.bookingResourceLock.findMany({ where: { shopId: shop.id, status: 'ACTIVE', endAtUtc: { gt: now }, booking: resourceBookingWhere(now) },
    select: { startAtUtc: true, endAtUtc: true } });
  if (!bookings.length && !locks.length) return;
  if (!shop.timezone) throw new ConflictException('已有预约缺有效时区，请先核对预约');
  const occupied = [...bookings.flatMap((row: any) => storedBookingServiceWindows(row)),
    ...locks.map((lock: any) => ({ startTime: lock.startAtUtc, endTime: lock.endAtUtc }))];
  for (const window of occupied) {
    if (isShopClosedDuring({ ...next, closedPeriods: introduced }, window.startTime, window.endTime, shop.timezone)) {
      throw new ConflictException('闭店日期范围内已有有效预约，请先联系顾客并处理预约');
    }
  }
}
