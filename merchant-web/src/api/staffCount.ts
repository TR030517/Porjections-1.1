import client from './client';
import { buildStaffingPayload } from '../../../src/utils/shopStaffing';

const staffingPath = (shopId: string) => {
  if (!/^[1-9]\d{0,18}$/u.test(shopId) || BigInt(shopId) > 9223372036854775807n) throw new Error('当前门店不可用。');
  return `/reservation-admin/shops/${shopId}/staffing`;
};

export async function getStaffing(shopId: string, signal?: AbortSignal): Promise<unknown> {
  const { data } = await client.get(staffingPath(shopId), { signal, headers: { 'Cache-Control': 'no-cache' } });
  return data;
}

export async function setStaffing(shopId: string, payload: { targetActiveCount: number; expectedRevision: string }): Promise<unknown> {
  const body = buildStaffingPayload(payload.targetActiveCount, payload.expectedRevision);
  const { data } = await client.patch(staffingPath(shopId), body);
  return data;
}
