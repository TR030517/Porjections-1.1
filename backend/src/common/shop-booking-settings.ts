export interface ShopBookingClosedPeriod { startDate: string; endDate: string; }
export interface ShopBookingSettings { minimumNoticeMinutes: number; closedPeriods: ShopBookingClosedPeriod[]; }
export const DEFAULT_SHOP_BOOKING_SETTINGS: ShopBookingSettings = { minimumNoticeMinutes: 0, closedPeriods: [] };

function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function settingsObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeShopBookingSettings(value: unknown): ShopBookingSettings {
  const input = settingsObject(value);
  if (Object.keys(input).some(key => !['minimumNoticeMinutes', 'closedPeriods'].includes(key))) throw new Error('预约设置包含未知字段');
  const minimumNoticeMinutes = input.minimumNoticeMinutes ?? 0;
  if (!Number.isInteger(minimumNoticeMinutes) || (minimumNoticeMinutes as number) < 0 || (minimumNoticeMinutes as number) > 10080) {
    throw new Error('最短提前预约时间须为0至168小时');
  }
  const raw = input.closedPeriods ?? [];
  if (!Array.isArray(raw) || raw.length > 50) throw new Error('临时闭店日期最多设置50段');
  const periods = raw.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['startDate', 'endDate'].includes(key))) throw new Error('闭店日期格式不正确');
    const { startDate, endDate } = row as Record<string, unknown>;
    if (!date(startDate) || !date(endDate) || startDate > endDate) throw new Error('闭店起止日期无效');
    return { startDate, endDate };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  for (let index = 1; index < periods.length; index++) {
    if (periods[index].startDate <= periods[index - 1].endDate) throw new Error('闭店日期范围不能重叠，请合并为一段');
  }
  return { minimumNoticeMinutes: minimumNoticeMinutes as number, closedPeriods: periods };
}

export function readShopBookingSettings(profile: unknown): ShopBookingSettings {
  const value = settingsObject(profile).bookingSettings;
  return value === undefined ? DEFAULT_SHOP_BOOKING_SETTINGS : normalizeShopBookingSettings(value);
}

export function isShopClosedOnDate(settings: ShopBookingSettings, localDate: string): boolean {
  return settings.closedPeriods.some(period => localDate >= period.startDate && localDate <= period.endDate);
}

/** Temporary closures cover whole shop-local dates, including occupation after
 * service. The half-open end keeps exact midnight outside the following day. */
export function isShopClosedDuring(settings: ShopBookingSettings, start: Date, end: Date, timezone: string): boolean {
  if (!settings.closedPeriods.length || end <= start) return false;
  // This module also runs in the admin browser. Keep its date calculation
  // independent of server-only helpers and their Nest dependencies.
  if (!timezone) throw new Error('Shop timezone is not configured correctly');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const localDate = (instant: Date) => {
    const fields = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  };
  const firstDay = localDate(start);
  const lastDay = localDate(new Date(+end - 1));
  return settings.closedPeriods.some(period => firstDay <= period.endDate && lastDay >= period.startDate);
}

export function shopBookingNoticeCutoff(settings: ShopBookingSettings, now = new Date()): number {
  return now.getTime() + settings.minimumNoticeMinutes * 60_000;
}

/** Positive notice includes its exact future threshold. Zero notice still
 * requires a strictly future start; previews and writes use the same rule. */
export function meetsShopBookingNotice(settings: ShopBookingSettings, start: Date, now = new Date()): boolean {
  return Number.isFinite(+start) && +start > +now && +start >= shopBookingNoticeCutoff(settings, now);
}

/** Return only dates newly closed by an edit, so removing or shortening an old
 * closure never gets blocked by an existing inconsistent historical setting. */
export function introducedShopClosures(previous: ShopBookingSettings, next: ShopBookingSettings): ShopBookingClosedPeriod[] {
  const result: ShopBookingClosedPeriod[] = [];
  const offsetDate = (value: string, days: number) => {
    const instant = new Date(`${value}T00:00:00Z`); instant.setUTCDate(instant.getUTCDate() + days);
    return instant.toISOString().slice(0, 10);
  };
  for (const period of next.closedPeriods) {
    let cursor: string | null = period.startDate;
    for (const old of previous.closedPeriods) {
      if (old.endDate < cursor) continue;
      if (old.startDate > period.endDate) break;
      if (old.startDate > cursor) result.push({ startDate: cursor, endDate: offsetDate(old.startDate, -1) });
      if (old.endDate >= period.endDate) { cursor = null; break; }
      cursor = offsetDate(old.endDate, 1);
    }
    if (cursor !== null && cursor <= period.endDate) result.push({ startDate: cursor, endDate: period.endDate });
  }
  return result;
}

