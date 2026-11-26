import { publicEmail } from './publicContacts';

export interface OrderEmailSettingsView {
  shopId: string; revision: number;
  state: 'VERIFIED' | 'LEGACY_UNVERIFIED' | 'MISSING' | 'DISABLED' | 'INVALID';
  recipient: string | null; verifiedAt: string | null; legacyCandidate: string | null;
  pending: null | { challengeId: string; email: string; expiresAt: string; deliveryState: 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN'; attemptsRemaining: number };
  delivery: { configured: boolean; mode: 'LOCAL_CAPTURE' | 'PROVIDER' | null; workerEnabled: boolean; reasonCode: string | null };
}
export interface OrderEmailSettingsApi {
  read(signal?: AbortSignal): Promise<OrderEmailSettingsView>;
  request(input: { email: string; expectedRevision: number; requestId: string }): Promise<OrderEmailSettingsView>;
  verify(input: { challengeId: string; code: string; expectedRevision: number }): Promise<OrderEmailSettingsView>;
  disable(input: { expectedRevision: number }): Promise<OrderEmailSettingsView>;
}
export const validOrderEmailRequestId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableEmail = (value: unknown) => value === null || typeof value === 'string' && publicEmail(value)?.label === value;
/** Never display a partial/old response as verified receipt ownership. */
export function readOrderEmailSettings(value: unknown, shopId: string): OrderEmailSettingsView {
  const row = value as OrderEmailSettingsView | null;
  const invalid = () => new Error('无法核对预约通知邮箱的完整状态，请重新读取，不要重复提交。');
  if (!row || row.shopId !== shopId || !Number.isSafeInteger(row.revision) || row.revision < 0
    || !['VERIFIED', 'LEGACY_UNVERIFIED', 'MISSING', 'DISABLED', 'INVALID'].includes(row.state)
    || !nullableEmail(row.recipient) || !nullableEmail(row.legacyCandidate)
    || !(row.verifiedAt === null || date(row.verifiedAt))
    || (row.state === 'VERIFIED' ? !row.recipient || !date(row.verifiedAt) : row.recipient !== null || row.verifiedAt !== null)) throw invalid();
  const pending = row.pending, delivery = row.delivery;
  if (pending !== null && (!pending || !validOrderEmailRequestId(pending.challengeId) || !pending.email || !nullableEmail(pending.email)
    || !date(pending.expiresAt) || !['SENDING', 'SENT', 'FAILED', 'UNKNOWN'].includes(pending.deliveryState)
    || !Number.isInteger(pending.attemptsRemaining) || pending.attemptsRemaining < 1 || pending.attemptsRemaining > 5)) throw invalid();
  if (!delivery || typeof delivery.configured !== 'boolean' || typeof delivery.workerEnabled !== 'boolean'
    || !['LOCAL_CAPTURE', 'PROVIDER', null].includes(delivery.mode) || !(delivery.reasonCode === null || typeof delivery.reasonCode === 'string')
    || delivery.configured && delivery.mode === null) throw invalid();
  return row;
}
export function orderEmailSettingsSummary(view: OrderEmailSettingsView | null) {
  if (!view) return { level: 'unknown' as const, title: '预约通知邮箱状态尚未核对', detail: '当前无法确认收件配置。订单仍保存在后台；请有门店资料权限的账号核对预约通知设置。' };
  if (view.state !== 'VERIFIED') return { level: 'warning' as const,
    title: view.state === 'LEGACY_UNVERIFIED' ? '预约通知邮箱尚未验证' : view.state === 'DISABLED' ? '预约通知邮箱已停用' : view.state === 'INVALID' ? '预约通知邮箱资料需修正' : '预约通知邮箱尚未设置',
    detail: '订单仍保存在后台，但门店收单邮件无法发送。公开联系邮箱与登录邮箱不会自动成为已验证的通知收件人。' };
  if (!view.delivery.configured || !view.delivery.workerEnabled) return { level: 'warning' as const, title: '收件地址已验证，邮件发送尚不可用', detail: '订单仍保存在后台，但门店收单邮件无法发送。请核对发送服务和通知任务状态；收件验证不代表订单邮件已送达。' };
  if (view.delivery.mode === 'LOCAL_CAPTURE') return { level: 'warning' as const, title: '当前仅为本地邮件捕获', detail: '通知不会发送到真实邮箱。此环境可验证本地流程，不能据此认定商家已实际收信；订单仍保存在后台。' };
  return { level: 'ready' as const, title: '预约通知收件地址已验证', detail: '新事件使用此专用地址。每封邮件的发送结果仍需查看订单详情；服务商接受不等于商家实际收到。' };
}
export type PendingOrderEmailOperation =
  | { kind: 'request'; revision: number; requestId: string; email: string }
  | { kind: 'verify'; revision: number; email: string; challengeId: string }
  | { kind: 'disable'; revision: number };
export function orderEmailOperationMatches(view: OrderEmailSettingsView, operation: PendingOrderEmailOperation): boolean {
  if (view.revision !== operation.revision + 1) return false;
  return operation.kind === 'request' ? view.pending?.challengeId === operation.requestId && view.pending.email === operation.email
    : operation.kind === 'verify' ? view.state === 'VERIFIED' && view.recipient === operation.email
      : view.state === 'DISABLED';
}
/** A read at the old revision cannot prove a timed-out write will never commit. */
export function orderEmailRecovery(view: OrderEmailSettingsView, operation: PendingOrderEmailOperation): 'MATCHED' | 'CHANGED' | 'UNRESOLVED' {
  return orderEmailOperationMatches(view, operation) ? 'MATCHED' : view.revision > operation.revision ? 'CHANGED' : 'UNRESOLVED';
}
export function uncertainOrderEmailWrite(error: unknown) {
  const row = error as { status?: number; response?: { status?: number } } | null;
  const status = row?.status ?? row?.response?.status;
  return !status || status === 408 || status >= 500;
}
