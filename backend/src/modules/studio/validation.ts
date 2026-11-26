import { BadRequestException } from '@nestjs/common';
import { normalizeHours } from '../booking/hours';
export function text(value: unknown, label: string, max = 200, required = false): string {
  if (value === undefined || value === null) { if (required) throw new BadRequestException(`${label} is required`); return ''; }
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new BadRequestException(`Invalid ${label}`);
  return value.trim();
}
export function id(value: unknown): bigint {
  const s = String(value ?? '');
  if (!/^[1-9]\d{0,18}$/.test(s) || BigInt(s) > 9223372036854775807n) throw new BadRequestException('Invalid resource ID');
  return BigInt(s);
}
export function integer(value: unknown, label: string, min = 0, max = 100000000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new BadRequestException(`Invalid ${label}`);
  return value;
}
export function cents(value: unknown): number {
  const s = String(value ?? '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) throw new BadRequestException('Amount must have at most two decimal places');
  const [whole, fraction = ''] = s.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function choice(value: unknown, values: string[], fallback?: string): string {
  const s = value === undefined && fallback ? fallback : value;
  if (typeof s !== 'string' || !values.includes(s)) throw new BadRequestException('Invalid status or category');
  return s;
}
export function date(value: unknown, label: string): Date {
  const s = text(value, label, 40, true);
  if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s) || !Number.isFinite(Date.parse(s))) throw new BadRequestException(`Invalid ${label}`);
  const d = new Date(s);
  if (d.toISOString().slice(0, 10) !== s.slice(0, 10)) throw new BadRequestException(`Invalid ${label}`);
  return d;
}
export function bool(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new BadRequestException('Expected boolean');
  return value;
}
export function url(value: unknown): string {
  const s = text(value, 'URL', 500);
  if (!s) return '';
  try { const u = new URL(s); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch {}
  throw new BadRequestException('Only HTTPS URLs are accepted');
}
export function strings(value: unknown, maxItems = 10, maxLength = 100): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new BadRequestException('Invalid list');
  return value.map(v => text(v, 'list item', maxLength, true));
}
const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const LABELS = ['周一','周二','周三','周四','周五','周六','周日'];
function time(value: unknown) {
  const s = text(value, 'time', 12, true);
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return s;
  const match = /^(0?[1-9]|1[0-2]):([0-5]\d) (AM|PM)$/.exec(s);
  if (!match) throw new BadRequestException('Invalid opening time');
  return String(Number(match[1]) % 12 + (match[3] === 'PM' ? 12 : 0)).padStart(2,'0') + ':' + match[2];
}
export function hours(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Business hours are required');
  const input = value as Record<string, any>; const out: Record<string, any> = {};
  DAYS.forEach((day, i) => {
    const h = input[day] ?? input[LABELS[i]];
    if (!h || typeof h !== 'object') { out[day] = { closed: true }; return; }
    if (Array.isArray(h)) { out[day] = h; return; }
    const closed = 'closed' in h ? bool(h.closed) : !bool(h.open);
    if (closed) { out[day] = { closed: true }; return; }
    if (h.periods !== undefined) {
      if (!Array.isArray(h.periods)) throw new BadRequestException('Invalid opening periods');
      out[day] = h.periods.map((period: any) => ({ open: time(period.start), close: time(period.end), closed: false }));
      return;
    }
    const open = time(h.start ?? h.open); const close = time(h.end ?? h.close);
    if (open >= close) throw new BadRequestException('Closing time must be later than opening time');
    out[day] = { open, close, closed: false };
  });
  return normalizeHours(out);
}
export function displayHours(value: any) {
  let saved: Record<string, any>;
  try { saved = normalizeHours(value ?? {}); }
  catch { saved = {}; } // Legacy invalid reads remain incomplete, never a page failure or invented opening.
  return Object.fromEntries(DAYS.map((day, i) => {
    const raw = saved[day];
    const entries = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(h => !h.closed);
    return [LABELS[i], { open: entries.length > 0, start: entries[0]?.open ?? '09:00', end: entries[0]?.close ?? '18:00',
      ...(entries.length > 1 ? { periods: entries.map(h => ({ start: h.open, end: h.close })) } : {}) }];
  }));
}
