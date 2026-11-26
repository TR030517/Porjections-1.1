import client from './client';

export const caseStatuses = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'REJECTED', 'WITHDRAWN'] as const;
export const caseTypes = ['REFUND', 'RESCHEDULE', 'COMPLAINT', 'OTHER'] as const;
export type CaseAction = 'CLAIM' | 'NOTE' | 'ACCEPT' | 'WAIT_FOR_CUSTOMER' | 'RESUME' | 'REJECT' | 'RESOLVE' | 'WITHDRAW' | 'REFUND' | 'RECONCILE';
export interface CaseEvent { id: string; kind: string; visibility: string; content: string | null; fromStatus: string | null; toStatus: string | null; createdAt: string; actorRole: string; }
export interface CaseBooking { id: string; bookingNo: string; status: string; paymentStatus: string; paidCents: number; refundedCents: number; currency: string; startTime: string; endTime: string; timezone?: string | null; localDate?: string | null; localStartTime?: string | null; localEndTime?: string | null; shopName: string; serviceName: string; }
export interface AfterSalesCase { id: string; bookingId: string; shopId: string; customerId?: string; type: string; status: string; reason: string; requestedAmountCents: number | null; currency: string; assignedToId?: string | null; acceptedAt: string | null; version: number; refundState: string | null; refundMode?: 'PAY_AT_STORE' | 'ONLINE' | null; offlineRefundRecordedCents?: number | null; createdAt: string; updatedAt: string; closedAt: string | null; booking: CaseBooking; timeline: CaseEvent[]; timelineTotal: number; timelineHasMore: boolean; allowedActions: CaseAction[]; }
export interface CasePage { items: AfterSalesCase[]; total: number; page: number; pageSize: number; }
const base = '/after-sales';
function checked(data: AfterSalesCase, shopId: string) {
  if (!data?.id || String(data.shopId) !== shopId || !Number.isInteger(data.version)) throw new Error('售后响应与当前门店不符。');
  return data;
}
export async function listCases(shopId: string, filters: { page: number; pageSize: number; status?: string; type?: string; bookingId?: string; bookingNo?: string }, signal?: AbortSignal): Promise<CasePage> {
  const { data } = await client.get(base, { params: { ...filters, shopId }, signal });
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total)) throw new Error('售后列表响应无效。');
  data.items.forEach((row: AfterSalesCase) => checked(row, shopId)); return data;
}
export async function getCase(id: string, shopId: string, signal?: AbortSignal): Promise<AfterSalesCase> {
  const { data } = await client.get(`${base}/${encodeURIComponent(id)}`, { signal });
  if (String(data?.id) !== id) throw new Error('售后响应与所选工单不符。');
  return checked(data, shopId);
}
export async function caseOperation(id: string, shopId: string, operation: 'claim' | 'notes' | 'transition' | 'refund' | 'reconcile', payload: Record<string, unknown>): Promise<AfterSalesCase> {
  const { data } = await client.post(`${base}/${encodeURIComponent(id)}/${operation}`, payload);
  if (String(data?.id) !== id) throw new Error('结果尚未确认，请刷新工单后再尝试。');
  return checked(data, shopId);
}
export async function getCaseEvents(id: string, page: number, signal?: AbortSignal): Promise<{ items: CaseEvent[]; total: number; page: number; pageSize: number }> {
  const { data } = await client.get(`${base}/${encodeURIComponent(id)}/events`, { params: { page, pageSize: 25 }, signal });
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total)) throw new Error('工单处理记录响应无效。');
  return data;
}
