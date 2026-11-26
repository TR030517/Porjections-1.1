export interface ShopClosedPeriod { startDate: string; endDate: string; }
export interface ShopBookingSettings { minimumNoticeMinutes: number; closedPeriods: ShopClosedPeriod[]; }
export const EMPTY_SHOP_BOOKING_SETTINGS: ShopBookingSettings = { minimumNoticeMinutes: 0, closedPeriods: [] };
export function checkedBookingSettingsHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('预约规则版本缺失，请重新读取后再保存。');
  return value;
}
export type NoticeUnit = 60 | 1440;

export function validBookingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Match the server's calendar-date contract without converting dates to device time. */
export function checkedShopBookingSettings(value: unknown): ShopBookingSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('预约规则返回格式无效，请重新读取。');
  const input = value as Record<string, unknown>;
  if (!Number.isInteger(input.minimumNoticeMinutes) || (input.minimumNoticeMinutes as number) < 0 || (input.minimumNoticeMinutes as number) > 10080) throw Error('最短提前预约时间须为 0 至 168 小时。');
  if (!Array.isArray(input.closedPeriods) || input.closedPeriods.length > 50) throw Error('临时闭店日期最多设置 50 段。');
  const closedPeriods = input.closedPeriods.map(period => {
    if (!period || typeof period !== 'object' || Array.isArray(period) || !validBookingDate(period.startDate) || !validBookingDate(period.endDate) || period.startDate > period.endDate) throw Error('请填写有效的闭店起止日期，结束日期不能早于开始日期。');
    return { startDate: period.startDate, endDate: period.endDate };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  if (closedPeriods.some((period, index) => index > 0 && period.startDate <= closedPeriods[index - 1].endDate)) throw Error('闭店日期范围不能重叠，请合并为一段。');
  return { minimumNoticeMinutes: input.minimumNoticeMinutes as number, closedPeriods };
}

export function noticeInputMinutes(value: string | number | null, unit: NoticeUnit): number {
  if (value === null || typeof value === 'string' && !value.trim()) throw Error('请填写最短提前预约时间；不限制时请填 0。');
  const amount = Number(value), minutes = Math.round(amount * unit);
  if (!Number.isFinite(amount) || amount < 0 || amount * unit > 10080 || Math.abs(amount * unit - minutes) > 1e-6) throw Error('最短提前预约时间须为 0 至 168 小时，精确到分钟。');
  return minutes;
}

export function bookingTimezoneValid(timezone: string | null): boolean {
  if (!timezone) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); return true; } catch { return false; }
}

export function shopBookingDate(timezone: string | null, now = new Date()): string {
  if (!bookingTimezoneValid(timezone)) throw Error('请先在门店基本资料中设置有效时区，再添加闭店日期。');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone!, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayAfter(value: string): string {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function nextClosurePeriod(periods: ShopClosedPeriod[], timezone: string | null, now = new Date()): ShopClosedPeriod {
  // Check partial rows first, so adding another cannot obscure an unfinished range.
  const sorted = checkedShopBookingSettings({ minimumNoticeMinutes: 0, closedPeriods: periods }).closedPeriods;
  let day = dayAfter(shopBookingDate(timezone, now));
  for (const period of sorted) if (day >= period.startDate && day <= period.endDate) day = dayAfter(period.endDate);
  return { startDate: day, endDate: day };
}

export function closureAnnouncement(period: ShopClosedPeriod, phone?: string | null): string | null {
  if (!validBookingDate(period.startDate) || !validBookingDate(period.endDate) || period.startDate > period.endDate) return null;
  const format = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${day}T00:00:00Z`));
  const range = period.startDate === period.endDate ? `on ${format(period.startDate)}` : `from ${format(period.startDate)} to ${format(period.endDate)}`;
  return `Closed ${range}. For questions, contact the shop${phone?.trim() ? `: ${phone.trim()}` : '.'}`;
}
