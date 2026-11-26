import { apiRequest } from './session';
export const caseStatuses: Record<string, string> = { OPEN: '待受理', IN_PROGRESS: '处理中', WAITING_CUSTOMER: '待顾客回复', RESOLVED: '已解决', REJECTED: '已驳回', WITHDRAWN: '已撤回' };
export const caseTypes: Record<string, string> = { REFUND: '退款申请', RESCHEDULE: '改期协助', COMPLAINT: '服务投诉', OTHER: '其他问题' };
export const caseActions: Record<string, string> = { CLAIM: '接手工单', ACCEPT: '受理', WAIT_FOR_CUSTOMER: '请顾客补充', RESUME: '继续处理', REJECT: '驳回申请', RESOLVE: '确认解决', WITHDRAW: '撤回申请', REFUND: '执行 / 同步退款', RECONCILE: '重新核实原退款' };
export interface CaseEvent { id: string; kind: string; visibility: string; content: string | null; fromStatus: string | null; toStatus: string | null; createdAt: string; actorRole: string; actorId?: string; }
export interface AfterSalesCase {
  id: string; bookingId: string; shopId: string; customerId?: string; assignedToId?: string | null;
  type: string; status: string; reason: string; requestedAmountCents: number | null; currency: string; version: number;
  refundMode?: 'PAY_AT_STORE' | 'ONLINE' | null;
  offlineRefundRecordedCents?: number | null;
  refundState: string; createdAt: string; updatedAt: string; closedAt: string | null; allowedActions: string[];
  booking: { id: string; bookingNo: string; status: string; paymentStatus: string; paidCents: number; refundedCents: number; currency: string; shopName: string; serviceName: string; timezone: string | null; localDate: string | null; localStartTime: string | null };
  timeline?: CaseEvent[]; timelineTotal?: number; timelineHasMore?: boolean;
}
export interface BusinessPage<T> { items: T[]; total: number; page: number; pageSize: number; totalPages?: number; }
export function queryString(values: Record<string, unknown>) { const params = new URLSearchParams(); for (const [k, v] of Object.entries(values)) if (v !== '' && v != null) params.set(k, String(v)); return params.toString(); }
export const afterSalesApi = {
  list: (query: Record<string, unknown>, signal?: AbortSignal) => apiRequest<BusinessPage<AfterSalesCase>>('/after-sales?' + queryString(query), { signal }),
  detail: (id: string, signal?: AbortSignal) => apiRequest<AfterSalesCase>('/after-sales/' + encodeURIComponent(id), { signal }),
  events: (id: string, page: number, signal?: AbortSignal) => apiRequest<BusinessPage<CaseEvent>>(`/after-sales/${encodeURIComponent(id)}/events?page=${page}&pageSize=30`, { signal }),
  write: (item: AfterSalesCase, action: string, body: Record<string, unknown> = {}) => apiRequest<AfterSalesCase>(`/after-sales/${encodeURIComponent(item.id)}/${action}`, { method: 'POST', body: JSON.stringify({ ...body, version: item.version }) }),
};
