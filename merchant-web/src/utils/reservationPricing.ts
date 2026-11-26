import type { PriceBasis } from '../api/reservations';
import { servicePriceCents } from './serviceMenuDraft';

export function variantPriceCents(value: unknown): number {
  const cents = servicePriceCents(value);
  if (cents < 1 || cents > 10000000) throw Error('整次订单固定价格须为0.01–100000.00美元，最多两位小数。');
  return cents;
}
export const variantPriceDraft = (cents: number) => cents / 100;

export const priceBasisLabels = { PER_PERSON: '按人计价', PER_BOOKING: '按单计价' };
export function pricingBasis(value: unknown): PriceBasis {
  if (value === undefined) return 'PER_BOOKING';
  if (value !== 'PER_PERSON' && value !== 'PER_BOOKING') throw new Error('请选择按人或按单计价。');
  return 'PER_BOOKING';
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}须为整数，范围为${min}至${max}.`);
  return value;
}
export function serviceTotal(cents: number, count: number, basis: unknown) {
  pricingBasis(basis);
  const total = cents;
  if (!Number.isSafeInteger(cents) || cents < 1 || ![1, 2].includes(count) || !Number.isSafeInteger(total)) throw new Error('服务金额或顾客人数无效。');
  return total;
}
export function variantPayload(values: Record<string, unknown>, serviceId?: string) {
  if (typeof values.name !== 'string' || !values.name.trim() || values.name.trim().length > 100) throw new Error('请输入不超过100字的规格名称。');
  if (typeof values.isActive !== 'boolean') throw new Error('请选择规格是否启用。');
  return { ...(serviceId === undefined ? {} : { serviceId }), name: values.name.trim(),
    durationMin: integer(values.durationMin, 5, 240, '服务时长／预约预留'), priceCents: variantPriceCents(values.priceUsd),
    priceBasis: pricingBasis(values.priceBasis === undefined ? 'PER_BOOKING' : values.priceBasis), currency: 'usd', sortOrder: integer(values.sortOrder, 0, 10000, '排序'), isActive: values.isActive };
}
export function policyPayload(values: Record<string, unknown>) {
  const participantCount = integer(values.participantCount, 1, 2, '顾客人数');
  const requiredStaffCount = integer(values.requiredStaffCount ?? participantCount, 1, 2, '所需技师人数');
  if (participantCount === 2 && requiredStaffCount !== 2) throw new Error('情侣服务需要两位不同技师。');
  const room = values.requiredRoomType || null;
  if (room !== null && !['SINGLE', 'COUPLE', 'FOOT_SEAT'].includes(String(room))) throw new Error('请选择有效场地类型。');
  if (participantCount === 2 && room !== null && room !== 'COUPLE') throw new Error('情侣服务如绑定场地，必须选择双人房间。');
  return { participantCount, requiredStaffCount, requiredRoomType: room,
    staffBufferMin: integer(values.staffBufferMin, 0, 120, '员工清理缓冲'), roomBufferMin: integer(values.roomBufferMin, 0, 120, '场地清理缓冲') };
}
