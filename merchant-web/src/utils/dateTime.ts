export function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toIsoDateTime(input: string, original?: string | null): string | null {
  if (!input) return null;
  // Preserve seconds and the instant when a minute-precision input is unchanged.
  if (original && input === toLocalDateTimeInput(original)) return original;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) throw new Error('请输入有效日期与时间。');
  return date.toISOString();
}

export function formatShopTime(value: string, timezone?: string | null): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  } catch { return '—'; }
}

export function formatBookingDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  return match ? `${match[1]}年${match[2]}月${match[3]}日` : '—';
}
