import { BadRequestException } from '@nestjs/common';
import { validateMediaUrl } from './managed-media';

export const ANNOUNCEMENT_TYPES = ['URGENT', 'IMPORTANT', 'INFO'] as const;
export const SERVICE_CATEGORIES = ['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'] as const;
export function contentText(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) throw new BadRequestException(`Invalid ${label}`);
  return value.trim();
}
export function contentChoice(value: unknown, options: readonly string[]) {
  if (typeof value !== 'string' || !options.includes(value)) throw new BadRequestException('Invalid content option');
  return value;
}
export function contentBoolean(value: unknown) {
  if (typeof value !== 'boolean') throw new BadRequestException('Content enabled state must be boolean');
  return value;
}
/** Require a real calendar date and explicit UTC/offset, never infer the admin's or server's timezone. */
export function contentInstant(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(+value)) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new BadRequestException('Publication times require ISO 8601 with a timezone');
  const calendar = value.slice(0,10), time = value.slice(11,16), date = new Date(value);
  const day = new Date(calendar + 'T00:00:00Z');
  if (!Number.isFinite(+date) || !Number.isFinite(+day) || day.toISOString().slice(0,10) !== calendar || Number(time.slice(0,2)) > 23 || Number(time.slice(3,5)) > 59 || /:\d\d(?=\.|Z|[+-])/.test(value.slice(16)) && Number(value.slice(17,19)) > 59) throw new BadRequestException('Invalid publication time');
  return date;
}
export function publicationWindow(body: Record<string, any>, previous?: any, now = new Date()) {
  const startAt = body.startAt === undefined ? previous?.startAt ?? now : contentInstant(body.startAt);
  const endAt = body.endAt === undefined ? previous?.endAt ?? null : body.endAt === null || body.endAt === '' ? null : contentInstant(body.endAt);
  if (endAt && +endAt <= +startAt) throw new BadRequestException('Publication end must follow its start');
  return { startAt, endAt };
}
export function publicationState(row: { isActive: boolean; startAt: Date; endAt?: Date | null }, now = new Date()) {
  return !row.isActive ? 'DRAFT' : row.startAt > now ? 'SCHEDULED' : row.endAt && row.endAt <= now ? 'EXPIRED' : 'LIVE';
}
export function announcementData(body: Record<string, any>, previous?: any) {
  return { title: contentText(body.title ?? previous?.title, 'title',500), content: contentText(body.content ?? previous?.content,'body',50000),
    type: contentChoice(body.type ?? previous?.type ?? 'INFO', ANNOUNCEMENT_TYPES), scope: contentChoice(body.scope ?? previous?.scope ?? 'ALL',['ALL','USERS','MERCHANTS']),
    isActive: contentBoolean(body.isActive ?? previous?.isActive ?? false), ...publicationWindow(body,previous) };
}
export function safeContentUrl(value: unknown, max = 500): string {
  const text = contentText(value,'HTTPS URL',max);
  try { const url = new URL(text); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch {}
  throw new BadRequestException('Only HTTPS URLs without credentials are accepted');
}
export function bannerData(body: Record<string, any>, previous?: any) {
  if (Object.keys(body).some(key => !['title','imageUrl','targetType','targetValue','sortOrder','isActive','startAt','endAt'].includes(key))) throw new BadRequestException('Unknown banner field');
  const type = contentChoice(body.targetType ?? previous?.targetType ?? 'NONE',['NONE','SHOP_DETAIL','CATEGORY','COUPON_CENTER','EXTERNAL_URL']);
  const value = body.targetValue === undefined ? previous?.targetValue ?? null : body.targetValue;
  let targetValue: string | null = null;
  if (type === 'SHOP_DETAIL') {
    if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new BadRequestException('Choose a valid shop ID');
    targetValue = value;
  } else if (type === 'CATEGORY') targetValue = contentChoice(value,SERVICE_CATEGORIES);
  else if (type === 'EXTERNAL_URL') targetValue = safeContentUrl(value,255);
  else if (body.targetValue !== undefined && value !== null && value !== '') throw new BadRequestException('This destination does not accept a value');
  const sortOrder = body.sortOrder ?? previous?.sortOrder ?? 0;
  if (typeof sortOrder !== 'number' || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 999999) throw new BadRequestException('Sort order must be an integer between 0 and 999999');
  return { title: contentText(body.title ?? previous?.title,'banner title',200), imageUrl: validateMediaUrl(contentText(body.imageUrl ?? previous?.imageUrl,'banner image',500)),
    targetType:type,targetValue,sortOrder,isActive:contentBoolean(body.isActive ?? previous?.isActive ?? false),...publicationWindow(body,previous) };
}
export function contentPage(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' && typeof value !== 'string' || !/^[1-9]\d*$/.test(String(value))) throw new BadRequestException('Invalid pagination');
  const n=Number(value);if(!Number.isSafeInteger(n)||n>max)throw new BadRequestException('Invalid pagination');return n;
}
