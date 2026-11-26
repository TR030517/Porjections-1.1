import { financialTimestamp, requireFinancialTimezone } from './financialTime';

export function giftTimestamp(value: string | null, timezone: string | null | undefined): string {
  try {
    const zone = requireFinancialTimezone(timezone);
    return value ? `${financialTimestamp(value, zone)} · ${zone}` : '—';
  } catch { return '门店时区未配置'; }
}
