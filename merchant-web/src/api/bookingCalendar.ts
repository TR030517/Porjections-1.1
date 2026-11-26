import client from './client';
import { shopLocal } from '../utils/reservationTime';

export type CalendarResourceType = 'THERAPIST' | 'ROOM';
export interface CalendarResource { type: CalendarResourceType; id: string; name: string; startAt?: string; endAt?: string }
export type CalendarEventType = 'BOOKING' | 'SHOP_CLOSURE' | 'THERAPIST_TIME_OFF' | 'ROOM_MAINTENANCE' | 'INTERNAL_OCCUPANCY' | 'TIME_BLOCK';
export interface CalendarEvent {
  id: string; eventType: CalendarEventType; bookingId: string | null; itemId: string | null; title: string; status: string;
  startAt: string; endAt: string; serviceStartAt: string | null; serviceEndAt: string | null;
  resources: CalendarResource[]; allDay: boolean; blockId?: string; expiredHold?: boolean; occupiesResources?: boolean; occupancySource?: 'ACTIVE_LOCKS' | 'LEGACY_SERVICE' | 'NONE';
}
export interface CalendarQuery { startDate: string; endDate: string; status?: string; resourceType?: CalendarResourceType; resourceId?: string }
export interface CalendarRange { startDate: string; endDate: string; startAt: string; endAt: string }
export interface CalendarPage {
  shopId: string; timezone: string; serverNow: string; range: CalendarRange; version: string;
  complete: boolean; nextCursor: string | null; events: CalendarEvent[]; resources: CalendarResource[];
}
export interface CalendarData extends Omit<CalendarPage, 'nextCursor'> { complete: true; nextCursor: null }
const eventTypes = ['BOOKING', 'SHOP_CLOSURE', 'THERAPIST_TIME_OFF', 'ROOM_MAINTENANCE', 'INTERNAL_OCCUPANCY', 'TIME_BLOCK'];
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const fail = (): never => { throw new Error('无法核对日历范围数据，请重新加载。'); };
function resource(value: any): CalendarResource {
  if (!value || !['THERAPIST', 'ROOM'].includes(value.type) || !id(value.id) || !text(value.name, 200)) return fail();
  if ((value.startAt !== undefined || value.endAt !== undefined) && (!instant(value.startAt) || !instant(value.endAt) || Date.parse(value.startAt) >= Date.parse(value.endAt))) return fail();
  return { type: value.type, id: value.id, name: value.name, ...(value.startAt === undefined ? {} : { startAt: value.startAt, endAt: value.endAt }) };
}
export function requireCalendarPage(value: any, shopId: string, query: CalendarQuery): CalendarPage {
  if (!value || value.shopId !== shopId || !text(value.timezone, 100) || !instant(value.serverNow) || !text(value.version, 200)
    || !value.range || value.range.startDate !== query.startDate || value.range.endDate !== query.endDate
    || !instant(value.range.startAt) || !instant(value.range.endAt) || Date.parse(value.range.startAt) >= Date.parse(value.range.endAt)
    || typeof value.complete !== 'boolean' || !(value.nextCursor === null || text(value.nextCursor, 8000))
    || value.complete !== (value.nextCursor === null) || !Array.isArray(value.events) || value.events.length > 100
    || !Array.isArray(value.resources)) return fail();
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(); } catch { return fail(); }
  // A local date may begin at 01:00 when DST skips midnight. Check the first
  // instant of that date, not a wall-clock 00:00 that need not exist.
  const boundary = (instant: string, date: string) => shopLocal(instant, value.timezone).slice(0, 10) === date
    && shopLocal(new Date(Date.parse(instant) - 1).toISOString(), value.timezone).slice(0, 10) < date;
  if (!boundary(value.range.startAt, query.startDate) || !boundary(value.range.endAt, query.endDate)) return fail();
  const events = value.events.map((event: any): CalendarEvent => {
    if (!event || !text(event.id, 200) || !eventTypes.includes(event.eventType) || !(event.bookingId === null || id(event.bookingId))
      || !(event.itemId === null || id(event.itemId)) || !text(event.title, 500) || !text(event.status, 60)
      || !instant(event.startAt) || !instant(event.endAt) || Date.parse(event.startAt) >= Date.parse(event.endAt)
      || Date.parse(event.startAt) >= Date.parse(value.range.endAt) || Date.parse(event.endAt) <= Date.parse(value.range.startAt)
      || !(event.serviceStartAt === null || instant(event.serviceStartAt)) || !(event.serviceEndAt === null || instant(event.serviceEndAt))
      || (event.serviceStartAt === null) !== (event.serviceEndAt === null)
      || (event.serviceStartAt !== null && Date.parse(event.serviceStartAt) >= Date.parse(event.serviceEndAt))
      || !Array.isArray(event.resources) || typeof event.allDay !== 'boolean'
      || (event.eventType === 'BOOKING' && event.bookingId === null)
      || (event.eventType !== 'BOOKING' && (event.bookingId !== null || event.itemId !== null))
      || (event.blockId !== undefined && (!id(event.blockId) || !['INTERNAL_OCCUPANCY', 'TIME_BLOCK'].includes(event.eventType)))
      || (event.expiredHold !== undefined && typeof event.expiredHold !== 'boolean')
      || (event.occupiesResources !== undefined && typeof event.occupiesResources !== 'boolean')
      || (event.occupancySource !== undefined && !['ACTIVE_LOCKS', 'LEGACY_SERVICE', 'NONE'].includes(event.occupancySource))) return fail();
    // Deliberate allowlist: summaries never carry account/contact fields into the calendar.
    return { id: event.id, eventType: event.eventType, bookingId: event.bookingId, itemId: event.itemId, title: event.title, status: event.status,
      startAt: event.startAt, endAt: event.endAt, serviceStartAt: event.serviceStartAt, serviceEndAt: event.serviceEndAt,
      resources: event.resources.map(resource), allDay: event.allDay,
      ...(event.blockId === undefined ? {} : { blockId: event.blockId }),
      ...(event.expiredHold === undefined ? {} : { expiredHold: event.expiredHold }), ...(event.occupiesResources === undefined ? {} : { occupiesResources: event.occupiesResources }),
      ...(event.occupancySource === undefined ? {} : { occupancySource: event.occupancySource }) };
  });
  return { shopId, timezone: value.timezone, serverNow: value.serverNow,
    range: { startDate: value.range.startDate, endDate: value.range.endDate, startAt: value.range.startAt, endAt: value.range.endAt },
    version: value.version, complete: value.complete, nextCursor: value.nextCursor, events, resources: value.resources.map(resource) };
}
export async function getCalendarPage(shopId: string, query: CalendarQuery, cursor: string | undefined, signal: AbortSignal): Promise<CalendarPage> {
  const { data } = await client.get(`/reservation-admin/shops/${encodeURIComponent(shopId)}/calendar-events`, { params: { ...query, pageSize: 100, ...(cursor ? { cursor } : {}) }, signal });
  return requireCalendarPage(data, shopId, query);
}
