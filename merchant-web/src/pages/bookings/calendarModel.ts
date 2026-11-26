import { getCalendarPage, type CalendarData, type CalendarEvent, type CalendarPage, type CalendarQuery, type CalendarResource, type CalendarResourceType } from '../../api/bookingCalendar';
import { shopLocal } from '../../utils/reservationTime';
import { errorMessage } from '../../utils/feedback';

export type CalendarView = 'month' | 'week' | 'day' | 'list';
export function validDate(date: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date; }
// UTC is used only as a date arithmetic grid, never to interpret a shop wall-clock instant.
export function addDays(date: string, days: number): string { if (!validDate(date)) throw new Error('请选择有效日期。'); return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
export function calendarRange(anchor: string, view: CalendarView): CalendarQuery {
  if (!validDate(anchor)) throw new Error('请选择有效日期。');
  const base = view === 'month' ? anchor.slice(0, 8) + '01' : anchor;
  const startDate = view === 'day' ? base : addDays(base, -new Date(base + 'T00:00:00Z').getUTCDay());
  return { startDate, endDate: addDays(startDate, view === 'month' ? 42 : view === 'day' ? 1 : 7) };
}
export function moveAnchor(anchor: string, view: CalendarView, direction: number): string {
  if (view !== 'month') return addDays(anchor, direction * (view === 'day' ? 1 : 7));
  const date = new Date(anchor + 'T00:00:00Z'); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + direction); return date.toISOString().slice(0, 10);
}
export function datesInRange(query: CalendarQuery): string[] {
  const dates: string[] = []; for (let date = query.startDate; date < query.endDate && dates.length < 42; date = addDays(date, 1)) dates.push(date); return dates;
}
export function eventsOnDate(events: CalendarEvent[], date: string, timezone: string): CalendarEvent[] {
  return events.filter(event => shopLocal(event.startAt, timezone).slice(0, 10) <= date && shopLocal(new Date(Date.parse(event.endAt) - 1).toISOString(), timezone).slice(0, 10) >= date)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
}
export function bookingCount(events: CalendarEvent[]): number { return new Set(events.filter(event => event.eventType === 'BOOKING' && event.bookingId).map(event => event.bookingId)).size; }
export function eventsForResourceColumn(events: CalendarEvent[], catalog: CalendarResource[], groupBy: CalendarResourceType, resource?: CalendarResource): CalendarEvent[] {
  if (!resource) {
    const known = new Set(catalog.filter(value => value.type === groupBy).map(value => value.id));
    return events.filter(event => {
      const assigned = event.resources.filter(value => value.type === groupBy);
      return assigned.length === 0 || assigned.some(value => !known.has(value.id));
    });
  }
  return events.flatMap(event => {
    const assigned = event.resources.find(value => value.type === resource.type && value.id === resource.id);
    return assigned ? [{ ...event, startAt: assigned.startAt ?? event.startAt, endAt: assigned.endAt ?? event.endAt }] : [];
  });
}
type PageLoader = (shopId: string, query: CalendarQuery, cursor: string | undefined, signal: AbortSignal) => Promise<CalendarPage>;
export async function loadCompleteCalendar(shopId: string, query: CalendarQuery, signal: AbortSignal, fetchPage: PageLoader = getCalendarPage): Promise<CalendarData> {
  let first: CalendarPage | null = null, cursor: string | undefined;
  const cursors = new Set<string>(), events = new Map<string, CalendarEvent>();
  for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
    if (signal.aborted) throw new Error('日历读取已取消。');
    const page = await fetchPage(shopId, query, cursor, signal);
    if (signal.aborted) throw new Error('日历读取已取消。');
    if (page.shopId !== shopId || page.range.startDate !== query.startDate || page.range.endDate !== query.endDate) throw new Error('日历范围不匹配，请重新加载。');
    if (first && (first.version !== page.version || first.timezone !== page.timezone || JSON.stringify(first.range) !== JSON.stringify(page.range) || JSON.stringify(first.resources) !== JSON.stringify(page.resources))) throw new Error('日历读取期间发生变化，数据未完整，请重新加载。');
    first ??= page;
    for (const event of page.events) {
      const duplicate = events.get(event.id);
      if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(event)) throw new Error('日历事件版本不一致，数据未完整，请重新加载。');
      events.set(event.id, event);
    }
    if (page.complete && page.nextCursor === null) return { ...first, events: [...events.values()], complete: true, nextCursor: null };
    if (page.complete || !page.nextCursor || cursors.has(page.nextCursor)) throw new Error('日历分页未完整，请重新加载。');
    cursors.add(page.nextCursor); cursor = page.nextCursor;
  }
  throw new Error('日历事件较多，数据未完整，请缩小日期范围。');
}
interface CalendarState { query: CalendarQuery; data: CalendarData | null; loading: boolean; error: string }
export function createCalendarModel(shopId: string, initial: CalendarQuery, isCurrent = () => true, fetchPage: PageLoader = getCalendarPage) {
  let state: CalendarState = { query: initial, data: null, loading: true, error: '' }, active = true, generation = 0;
  let request: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CalendarState>) => { if (!active || !isCurrent()) return; state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const load = async (query: CalendarQuery) => {
    const version = ++generation; request?.abort(); const controller = new AbortController(); request = controller;
    update({ query, data: null, loading: true, error: '' });
    try { const data = await loadCompleteCalendar(shopId, query, controller.signal, fetchPage); if (version === generation) update({ data, loading: false }); }
    catch (error) { if (version === generation) update({ data: null, loading: false, error: '数据未完整：' + errorMessage(error) }); }
  };
  return { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => state,
    load: (query?: CalendarQuery) => { active = true; return load(query ?? state.query); }, refresh: () => load(state.query), setQuery: (query: CalendarQuery) => load(query),
    dispose: () => { active = false; generation++; request?.abort(); } };
}
