import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requireShopAccess } from '../../common/shop-access';
import { readShopBookingSettings } from '../../common/shop-booking-settings';
import { localParts } from '../booking/time';
import { resourceBookingWhere } from './configuration-guard';
import { Actor, id } from './reservation-validation';
import { addCalendarDays, BookingCalendarQuery, CalendarResourceType, parseBookingCalendarQuery } from './booking-calendar.dto';

export interface CalendarResource { type: CalendarResourceType; id: string; name: string; startAt?: string; endAt?: string; }
export interface CalendarEvent {
  id: string; eventType: 'BOOKING' | 'SHOP_CLOSURE' | 'THERAPIST_TIME_OFF' | 'ROOM_MAINTENANCE' | 'INTERNAL_OCCUPANCY' | 'TIME_BLOCK';
  blockId?: string;
  bookingId: string | null; itemId: string | null; title: string; status: string;
  startAt: string; endAt: string; serviceStartAt: string | null; serviceEndAt: string | null;
  resources: CalendarResource[]; allDay: boolean; expiredHold?: boolean; occupiesResources?: boolean;
  occupancySource?: 'ACTIVE_LOCKS' | 'LEGACY_SERVICE' | 'NONE';
}
export interface CalendarPage {
  shopId: string; timezone: string; serverNow: string;
  range: { startDate: string; endDate: string; startAt: string; endAt: string };
  version: string; complete: boolean; nextCursor: string | null; events: CalendarEvent[]; resources: CalendarResource[];
}
/** A complete range is bounded independently of page size. Never report a
 * successful empty/free calendar after silently truncating busy data. */
export const MAX_CALENDAR_EVENTS = 10000;
const MAX_ROWS = MAX_CALENDAR_EVENTS + 1;
const overlap = (start: Date, end: Date, rangeStart: Date, rangeEnd: Date) => +start < +rangeEnd && +end > +rangeStart;
function instant(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(+value)) throw new ServiceUnavailableException('日历存在无效时间，数据未完整');
  return value.toISOString();
}
function ensureWindow(start: Date, end: Date) { instant(start); instant(end); if (+end <= +start) throw new ServiceUnavailableException('日历存在无效时间段，数据未完整'); }
function bounded<T>(rows: T[]): T[] { if (rows.length >= MAX_ROWS) throw new ServiceUnavailableException('日历范围数据过多，请缩小日期范围；数据未完整'); return rows; }

/** First instant belonging to a local date, including skipped/repeated midnight.
 * Local dates, not elapsed 24-hour periods, define calendar day boundaries. */
export function calendarDayBoundary(date: string, timezone: string): Date {
  const nominal = Date.parse(`${date}T00:00:00Z`);
  const day = (time: number) => localParts(new Date(time), timezone).slice(0, 10);
  let lower = nominal - 48 * 3600000, upper = nominal + 48 * 3600000;
  if (!timezone || !Number.isFinite(nominal) || day(lower) >= date || day(upper) < date) throw new BadRequestException('门店时区或日历日期无效');
  while (upper - lower > 1) { const middle = Math.floor((lower + upper) / 2); if (day(middle) < date) lower = middle; else upper = middle; }
  if (day(upper) !== date) throw new BadRequestException('该日期在门店时区不存在，请选择其他范围');
  return new Date(upper);
}
function rangeChanged(): never { throw new ConflictException({ code: 'CALENDAR_RANGE_CHANGED', message: '日历范围已变化，请重新加载完整范围' }); }
function readCursor(cursor: string | undefined, scope: string, version: string, count: number): number {
  if (!cursor) return 0;
  let value: any;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== cursor) throw Error();
    value = JSON.parse(decoded);
  } catch { throw new BadRequestException('日历分页游标无效'); }
  if (!value || Object.keys(value).sort().join(',') !== 'offset,scope,version' || typeof value.scope !== 'string' || typeof value.version !== 'string'
    || !Number.isSafeInteger(value.offset) || value.offset < 1) throw new BadRequestException('日历分页游标无效');
  if (value.scope !== scope || value.version !== version) rangeChanged();
  if (value.offset >= count) throw new BadRequestException('日历分页游标无效');
  return value.offset;
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function expiredHold(row: any, now: Date): boolean {
  return row.status === 'PENDING' && row.paymentStatus === 'UNPAID' && row.paidCents <= 0 && row.holdExpiresAt instanceof Date && +row.holdExpiresAt <= +now;
}

@Injectable()
export class BookingCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async events(shopId: string, actor: Actor, raw: unknown): Promise<CalendarPage> {
    const sid = id(shopId, 'shopId'), query = parseBookingCalendarQuery(raw);
    return this.prisma.$transaction(async tx => {
      // Every page rechecks the current account and current shop grant. The
      // snapshot makes this page internally consistent without write locks.
      const { shop } = await requireShopAccess(tx, sid, actor, 'BOOKINGS_READ');
      const timezone = shop.timezone;
      if (typeof timezone !== 'string' || !timezone || timezone.length > 100) throw new BadRequestException('请先完善门店时区');
      const start = calendarDayBoundary(query.startDate, timezone), end = calendarDayBoundary(query.endDate, timezone), now = new Date();
      const window = { startAtUtc: { lt: end }, endAtUtc: { gt: start } };
      const activeWindow = { status: 'ACTIVE', ...window };
      const bookings = bounded(await tx.booking.findMany({
        where: { shopId: sid, ...(query.status ? { status: query.status as any } : {}), OR: [
          { deletedAt: null, startTime: { lt: end }, endTime: { gt: start } },
          { deletedAt: null, items: { some: window } },
          { resourceLocks: { some: { ...activeWindow, booking: resourceBookingWhere(now) } } },
        ] }, orderBy: { id: 'asc' }, take: MAX_ROWS,
        select: { id: true, status: true, deletedAt: true, startTime: true, endTime: true, paymentStatus: true, paidCents: true, holdExpiresAt: true,
          therapistId: true, service: { select: { name: true } }, _count: { select: { items: true } },
        },
      }));
      // Child limits apply to the entire request, not once per parent. Nested
      // per-booking limits could hydrate millions of rows before discovering
      // that the final event projection exceeds the range ceiling.
      const bookingIds = bookings.map(row => row.id);
      const items = bounded(bookingIds.length ? await tx.bookingItem.findMany({
        where: { bookingId: { in: bookingIds }, OR: [window, { resourceLocks: { some: activeWindow } }] }, orderBy: { id: 'asc' }, take: MAX_ROWS,
        select: { id: true, bookingId: true, serviceNameSnapshot: true, startAtUtc: true, endAtUtc: true, assignedTherapistId: true, assignedRoomId: true },
      }) : []);
      const resourceLocks = bounded(bookingIds.length ? await tx.bookingResourceLock.findMany({
        where: { bookingId: { in: bookingIds }, ...activeWindow }, orderBy: { id: 'asc' }, take: MAX_ROWS,
        select: { id: true, shopId: true, bookingId: true, bookingItemId: true, resourceType: true, resourceId: true, startAtUtc: true, endAtUtc: true },
      }) : []);
      const itemGroups = new Map<string, typeof items>(), lockGroups = new Map<string, typeof resourceLocks>();
      for (const item of items) { const key = String(item.bookingId); const group = itemGroups.get(key) ?? []; group.push(item); itemGroups.set(key, group); }
      for (const lock of resourceLocks) {
        if (lock.shopId !== sid) throw new ServiceUnavailableException('日历存在门店资源归属异常，数据未完整');
        const key = String(lock.bookingId); const group = lockGroups.get(key) ?? []; group.push(lock); lockGroups.set(key, group);
      }
      const therapists = bounded(await tx.therapist.findMany({ where: { shopId: sid }, orderBy: { id: 'asc' }, take: MAX_ROWS, select: { id: true, name: true } }));
      const rooms = bounded(await tx.shopRoom.findMany({ where: { shopId: sid }, orderBy: { id: 'asc' }, take: MAX_ROWS, select: { id: true, name: true } }));
      const resources: CalendarResource[] = [...therapists.map(row => ({ type: 'THERAPIST' as const, id: String(row.id), name: row.name })),
        ...rooms.map(row => ({ type: 'ROOM' as const, id: String(row.id), name: row.name }))];
      if (query.resourceId && !resources.some(row => row.type === query.resourceType && row.id === query.resourceId)) throw new BadRequestException('日历资源不属于当前门店');
      const resourceMap = new Map(resources.map(resource => [`${resource.type}:${resource.id}`, resource]));
      const resource = (type: CalendarResourceType, value: bigint): CalendarResource => {
        const target = resourceMap.get(`${type}:${value}`);
        if (!target) throw new ServiceUnavailableException('日历存在未知门店资源，数据未完整');
        return target;
      };
      const events: CalendarEvent[] = [];
      for (const booking of bookings) {
        const bookingItems = itemGroups.get(String(booking.id)) ?? [];
        const expired = expiredHold(booking, now), locks = expired ? [] : lockGroups.get(String(booking.id)) ?? [];
        const append = (item: typeof items[number] | null, itemLocks: typeof locks) => {
          const serviceStart = item?.startAtUtc ?? booking.startTime, serviceEnd = item?.endAtUtc ?? booking.endTime;
          ensureWindow(serviceStart, serviceEnd);
          const mayShowService = !booking.deletedAt;
          if ((!mayShowService || !overlap(serviceStart, serviceEnd, start, end)) && !itemLocks.length) return;
          const active: CalendarResource[] = itemLocks.map(lock => {
            if (lock.resourceType !== 'THERAPIST' && lock.resourceType !== 'ROOM') throw new ServiceUnavailableException('日历存在未知资源，数据未完整');
            ensureWindow(lock.startAtUtc, lock.endAtUtc);
            return { ...resource(lock.resourceType, lock.resourceId), startAt: instant(lock.startAtUtc), endAt: instant(lock.endAtUtc) };
          });
          const legacyOccupation = booking._count.items === 0 && !booking.deletedAt && !expired
            && ['PENDING', 'CONFIRMED'].includes(booking.status) && !itemLocks.length;
          // Actual locks define the resources for an occupied event. Another
          // resource's cross-midnight cleanup must not revive an ended identity.
          // With no locks, retain historical identities (and legacy occupation)
          // without representing them as current ACTIVE locks.
          for (const [type, resourceId] of [['THERAPIST', item?.assignedTherapistId ?? (!item ? booking.therapistId : null)], ['ROOM', item?.assignedRoomId]] as const) {
            if (resourceId && !active.some(row => row.type === type && row.id === String(resourceId))) {
              const assigned = resource(type, resourceId); // Still reject unknown/foreign snapshot identities.
              if (!itemLocks.length) active.push({ ...assigned,
                ...(legacyOccupation ? { startAt: instant(serviceStart), endAt: instant(serviceEnd) } : {}) });
            }
          }
          active.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id) || (a.startAt ?? '').localeCompare(b.startAt ?? ''));
          const startAt = new Date(Math.min(+serviceStart, ...itemLocks.map(lock => +lock.startAtUtc))), endAt = new Date(Math.max(+serviceEnd, ...itemLocks.map(lock => +lock.endAtUtc)));
          events.push({ id: item ? `booking:${booking.id}:item:${item.id}` : `booking:${booking.id}:legacy`, eventType: 'BOOKING',
            bookingId: String(booking.id), itemId: item ? String(item.id) : null, title: item?.serviceNameSnapshot || booking.service.name || '预约',
            status: booking.status, startAt: instant(startAt), endAt: instant(endAt), serviceStartAt: instant(serviceStart), serviceEndAt: instant(serviceEnd),
            resources: active, allDay: false, expiredHold: expired, occupiesResources: itemLocks.length > 0 || legacyOccupation,
            occupancySource: itemLocks.length ? 'ACTIVE_LOCKS' : legacyOccupation ? 'LEGACY_SERVICE' : 'NONE' });
          bounded(events);
        };
        if (booking._count.items === 0) append(null, locks);
        else {
          for (const item of bookingItems) append(item, locks.filter(lock => lock.bookingItemId === item.id));
          // Defensive legacy/unassigned ACTIVE rows must not disappear merely
          // because the booking also has item snapshots.
          const orphanLocks = locks.filter(lock => lock.bookingItemId === null || !bookingItems.some(item => item.id === lock.bookingItemId));
          if (orphanLocks.length) append(null, orphanLocks);
        }
      }
      const timeOff = bounded(await tx.therapistTimeOff.findMany({ where: { therapist: { shopId: sid }, ...window }, orderBy: { id: 'asc' }, take: MAX_ROWS,
        select: { id: true, therapistId: true, startAtUtc: true, endAtUtc: true } }));
      const maintenance = bounded(await tx.roomMaintenance.findMany({ where: { room: { shopId: sid }, ...window }, orderBy: { id: 'asc' }, take: MAX_ROWS,
        select: { id: true, roomId: true, startAtUtc: true, endAtUtc: true } }));
      const blocks = bounded(await tx.shopCalendarBlock.findMany({ where: { shopId: sid, status: 'ACTIVE', ...window }, orderBy: { id: 'asc' }, take: MAX_ROWS,
        select: { id: true, scope: true, resourceId: true, purpose: true, startAtUtc: true, endAtUtc: true, timeOffId: true, maintenanceId: true } }));
      const managedTimeOff = new Set<string>(), managedMaintenance = new Set<string>();
      const timeOffMap = new Map(timeOff.map(row => [String(row.id), row])), maintenanceMap = new Map(maintenance.map(row => [String(row.id), row]));
      for (const block of blocks) {
        ensureWindow(block.startAtUtc, block.endAtUtc);
        if (!['SHOP', 'THERAPIST', 'ROOM'].includes(block.scope) || !['INTERNAL_OCCUPANCY', 'TIME_BLOCK'].includes(block.purpose))
          throw new ServiceUnavailableException('日历占用类型无效，数据未完整');
        const targets: CalendarResource[] = [];
        if (block.scope === 'SHOP') {
          if (block.resourceId !== null || block.timeOffId !== null || block.maintenanceId !== null) throw new ServiceUnavailableException('全店占用归属无效，数据未完整');
        } else {
          if (block.resourceId === null) throw new ServiceUnavailableException('日历占用缺少资源，数据未完整');
          const therapist = block.scope === 'THERAPIST';
          const backing = therapist ? timeOffMap.get(String(block.timeOffId)) : maintenanceMap.get(String(block.maintenanceId));
          if (!backing || therapist && block.maintenanceId !== null || !therapist && block.timeOffId !== null
            || (therapist ? (backing as typeof timeOff[number]).therapistId : (backing as typeof maintenance[number]).roomId) !== block.resourceId
            || +backing.startAtUtc !== +block.startAtUtc || +backing.endAtUtc !== +block.endAtUtc)
            throw new ServiceUnavailableException('日历占用与资源来源不一致，数据未完整');
          targets.push({ ...resource(therapist ? 'THERAPIST' : 'ROOM', block.resourceId), startAt: instant(block.startAtUtc), endAt: instant(block.endAtUtc) });
          (therapist ? managedTimeOff : managedMaintenance).add(String(backing.id));
        }
        events.push({ id: `calendar-block:${block.id}`, blockId: String(block.id), eventType: block.purpose as 'INTERNAL_OCCUPANCY' | 'TIME_BLOCK',
          bookingId: null, itemId: null, title: block.purpose === 'INTERNAL_OCCUPANCY' ? '内部占用' : '暂停预约', status: 'ACTIVE',
          startAt: instant(block.startAtUtc), endAt: instant(block.endAtUtc), serviceStartAt: null, serviceEndAt: null, resources: targets, allDay: false });
      }
      for (const [kind, rows] of [['THERAPIST_TIME_OFF', timeOff], ['ROOM_MAINTENANCE', maintenance]] as const) {
        for (const row of rows) {
          if ((kind === 'THERAPIST_TIME_OFF' ? managedTimeOff : managedMaintenance).has(String(row.id))) continue;
          ensureWindow(row.startAtUtc, row.endAtUtc);
          const isTimeOff = kind === 'THERAPIST_TIME_OFF';
          const target = isTimeOff ? resource('THERAPIST', (row as typeof timeOff[number]).therapistId) : resource('ROOM', (row as typeof maintenance[number]).roomId);
          events.push({ id: `${isTimeOff ? 'time-off' : 'maintenance'}:${row.id}`, eventType: kind, bookingId: null, itemId: null,
            title: isTimeOff ? '技师请假' : '房间维护', status: isTimeOff ? 'TIME_OFF' : 'MAINTENANCE',
            startAt: instant(row.startAtUtc), endAt: instant(row.endAtUtc), serviceStartAt: null, serviceEndAt: null,
            resources: [{ ...target, startAt: instant(row.startAtUtc), endAt: instant(row.endAtUtc) }], allDay: false });
        }
      }
      let settings;
      try { settings = readShopBookingSettings(shop.studioProfile); } catch { throw new ServiceUnavailableException('门店闭店设置无效，日历数据未完整'); }
      for (const period of settings.closedPeriods) {
        const exclusiveEnd = addCalendarDays(period.endDate, 1);
        if (period.startDate >= query.endDate || exclusiveEnd <= query.startDate) continue;
        const closedStart = calendarDayBoundary(period.startDate < query.startDate ? query.startDate : period.startDate, timezone);
        const closedEnd = calendarDayBoundary(exclusiveEnd > query.endDate ? query.endDate : exclusiveEnd, timezone);
        events.push({ id: `closure:${period.startDate}:${period.endDate}`, eventType: 'SHOP_CLOSURE', bookingId: null, itemId: null,
          title: '门店闭店', status: 'CLOSED', startAt: instant(closedStart), endAt: instant(closedEnd), serviceStartAt: null, serviceEndAt: null, resources: [], allDay: true });
      }
      bounded(events);
      const filtered = events.filter(event => !query.resourceId || event.eventType === 'SHOP_CLOSURE'
        || (event.eventType === 'INTERNAL_OCCUPANCY' || event.eventType === 'TIME_BLOCK') && event.resources.length === 0
        // Availability conservatively protects every room from legacy orders;
        // unknown legacy therapist assignment protects every therapist too.
        // Retain these events without inventing an actual resource assignment.
        || event.occupancySource === 'LEGACY_SERVICE' && (query.resourceType === 'ROOM' || !event.resources.some(row => row.type === 'THERAPIST'))
        || event.resources.some(row => row.type === query.resourceType && row.id === query.resourceId))
        .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
      const range = { startDate: query.startDate, endDate: query.endDate, startAt: instant(start), endAt: instant(end) };
      const scope = digest({ shopId, actorId: actor.id, role: actor.role, range, status: query.status ?? null, resourceType: query.resourceType ?? null, resourceId: query.resourceId ?? null });
      const version = digest({ scope, resources, events: filtered });
      const offset = readCursor(query.cursor, scope, version, filtered.length), page = filtered.slice(offset, offset + query.pageSize);
      const complete = offset + page.length === filtered.length;
      return { shopId, timezone, serverNow: now.toISOString(), range, version, complete, events: page, resources,
        nextCursor: complete ? null : Buffer.from(JSON.stringify({ scope, version, offset: offset + page.length })).toString('base64url') };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  }
}
