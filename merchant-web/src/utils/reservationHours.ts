import type { BusinessHours } from '../api/reservations';
import { dayKeys, timeMinute, weekdays } from './reservationTime';

export interface HoursPeriod { open: string; close: string }
export type HoursDraft = Record<string, HoursPeriod[]>;
/** Existing JSON columns may contain one serialized canonical hours object. */
export function checkedBusinessHours(value: unknown): BusinessHours {
  try {
    if (typeof value === 'string') value = JSON.parse(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('须为星期与时段组成的对象。');
    const hours = value as Record<string, unknown>;
    if (Object.keys(hours).some(day => !dayKeys.includes(day))) throw new Error('包含无法识别的星期。');
    return Object.fromEntries(Object.entries(hours).map(([day, raw]) => {
      const rows = Array.isArray(raw) ? raw : [raw];
      if (rows.length > 4) throw new Error('每日最多四个时段。');
      const periods = rows.map(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)
          || row.closed !== undefined && typeof row.closed !== 'boolean') throw new Error('时段格式无效。');
        if (row.closed === true) return { closed: true as const };
        if (typeof row.open !== 'string' || typeof row.close !== 'string') throw new Error('时段须填写开始与结束时间。');
        return { open: row.open, close: row.close, ...(row.closed === false ? { closed: false as const } : {}) };
      });
      checkedPeriods(day, periods.filter((row): row is HoursPeriod & { closed?: false } => !row.closed));
      return [day, Array.isArray(raw) ? periods : periods[0]];
    }));
  } catch (cause) {
    throw new Error('营业时间无法核对：' + (cause instanceof Error ? cause.message : '格式无效。'));
  }
}
export function hoursDraft(value: unknown): HoursDraft {
  const hours = checkedBusinessHours(value);
  return Object.fromEntries(dayKeys.map(day => {
    const input = hours[day];
    return [day, (Array.isArray(input) ? input : input ? [input] : []).filter((row): row is HoursPeriod & { closed?: false } => !row.closed)
      .map(row => ({ open: row.open, close: row.close }))];
  }));
}
function checkedPeriods(day: string, periods: HoursPeriod[]) {
  if (!dayKeys.includes(day) || !Array.isArray(periods) || periods.length > 4) throw new Error('请选择有效星期，每日最多四个时段。');
  const checked = periods.map(row => {
    const start = timeMinute(row.open), end = timeMinute(row.close);
    if (end <= start) throw new Error(`${weekdays[dayKeys.indexOf(day)]}：结束时间须晚于开始时间。`);
    return { open: row.open, close: row.close, start, end };
  }).sort((a, b) => a.start - b.start);
  if (checked.some((row, index) => index > 0 && row.start < checked[index - 1].end)) throw new Error(`${weekdays[dayKeys.indexOf(day)]}：时段不可重叠。`);
  return checked.map(({ open, close }) => ({ open, close }));
}
/** Local draft only: never copies any shop fields or submits an HTTP request. */
export function copyHoursDays(value: HoursDraft, source: string, targets: string[]): HoursDraft {
  if (!targets.length || new Set(targets).size !== targets.length || targets.includes(source)
    || targets.some(day => !dayKeys.includes(day))) throw new Error('请明确选择不同的目标日期。');
  const periods = checkedPeriods(source, value[source]);
  return Object.fromEntries(dayKeys.map(day => [day, (targets.includes(day) ? periods : value[day]).map(row => ({ ...row }))]));
}
export function hoursPayload(value: HoursDraft): BusinessHours {
  return Object.fromEntries(dayKeys.map(day => {
    const rows = checkedPeriods(day, value[day]);
    return [day, rows.length ? rows : { closed: true }];
  }));
}

/** Chinese read-only labels; business-hour keys and values remain unchanged. */
export function formatBusinessHours(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '尚未设置营业时间';
  const hours = value as Record<string, unknown>;
  return dayKeys.map((day, index) => {
    const raw = hours[day];
    if (raw === undefined || raw === null) return weekdays[index] + '：未设置';
    const periods = (Array.isArray(raw) ? raw : [raw]).filter(row => row && typeof row === 'object');
    const open = periods.filter(row => row.closed !== true && typeof row.open === 'string' && typeof row.close === 'string');
    return weekdays[index] + '：' + (open.length ? open.map(row => row.open + '–' + row.close).join('、') : periods.some(row => row.closed === true) || Array.isArray(raw) && raw.length === 0 ? '休息' : '格式待核对');
  }).join('\n');
}
