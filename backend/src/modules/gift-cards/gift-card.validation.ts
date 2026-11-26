import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

export type GiftActor = { id: string; role: string };
export const CUSTOMER_ENTITLEMENT_STATUSES = ['ACTIVE', 'EXHAUSTED', 'EXPIRED', 'VOIDED'] as const;
const MAX_ID = 9223372036854775807n;

export function giftId(value: unknown, label = 'id'): bigint {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > MAX_ID) {
    throw new BadRequestException(`${label}必须是有效的正整数ID`);
  }
  return BigInt(value);
}
export function entitlementId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException('无效的权益ID');
  }
  return value.toLowerCase();
}
export function giftObject(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) {
    throw new BadRequestException('请求包含不允许的字段');
  }
  return value as Record<string, unknown>;
}
export function giftInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new BadRequestException(`${label}必须为${min}至${max}的整数`);
  }
  return value;
}
export function giftReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) throw new BadRequestException('请填写赠送或作废原因，最多500字');
  return value.trim();
}
export function requestKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(value)) throw new BadRequestException('请提供1至100位有效幂等请求键');
  return value;
}
export function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
export function scopedKey(kind: string, ...parts: string[]): string { return hash(JSON.stringify([kind, ...parts])); }
export function newVoucher(): string { return `gc1_${randomBytes(32).toString('base64url')}`; }
export function voucherHash(value: unknown): string {
  if (typeof value !== 'string' || !/^gc1_[A-Za-z0-9_-]{43}$/.test(value)) throw new BadRequestException('无效的核销凭证');
  return hash(value);
}
export function unusableVoucherHash(): string { return hash(randomBytes(32).toString('hex')); }
export function giftPage(value: Record<string, unknown>) {
  function bound(v: unknown, fallback: number, max: number, label: string) {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^[1-9]\d*$/.test(v)) throw new BadRequestException(`无效的${label}`);
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n > max) throw new BadRequestException(`无效的${label}`);
    return n;
  }
  const page = bound(value.page, 1, 100000, '页码');
  const pageSize = bound(value.pageSize, 20, 100, '每页条数');
  return { page, pageSize, skip: (page - 1) * pageSize };
}
export function giftExpiry(now: Date, days: number): Date {
  giftInteger(days, 1, 3650, '有效天数');
  return new Date(now.getTime() + days * 86400000);
}
