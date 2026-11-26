import { getShopReadiness, readinessId, type ReadinessAction, type ReadinessCheck, type ReadinessSection, type ReadinessTab, type ShopReadiness } from '../../api/shopReadiness';
import type { BookingSetupIssue } from '../../utils/bookingSetup';

export type ReadinessDestination = { kind: 'section'; section: ReadinessSection }
  | { kind: 'page'; view: 'merchant-list' | 'services' | 'technicians' | 'reservation-settings'; query: { shopId: string; returnToReview: true; tab?: ReadinessTab; serviceId?: string; therapistId?: string } };
export function readinessDestination(shopId: string, action: ReadinessAction): ReadinessDestination {
  if (!readinessId(shopId)) throw new Error('门店检查的目标门店无效。');
  if (action.kind === 'store-section') return { kind: 'section', section: action.section };
  const query = { shopId, returnToReview: true as const };
  if (action.kind === 'accounts') return { kind: 'page', view: 'merchant-list', query };
  if (action.kind === 'services' || action.kind === 'technicians') return { kind: 'page', view: action.kind, query };
  return { kind: 'page', view: 'reservation-settings', query: { ...query, tab: action.tab, ...(action.serviceId ? { serviceId: action.serviceId } : {}), ...(action.therapistId ? { therapistId: action.therapistId } : {}) } };
}
export function readinessActionLabel(action: ReadinessAction) {
  if (action.kind === 'store-section') return ({ basic: '完善资料', brand: '完善展示', hours: '营业设置', review: '发布状态' })[action.section];
  if (action.kind === 'accounts') return '配置账号';
  if (action.kind === 'services') return '管理项目';
  if (action.kind === 'technicians') return '设置技师人数';
  return ({ services: '规格与策略', therapists: '技师排班', rooms: '空间配置' })[action.tab];
}
export function bookingSetupAction(issue: BookingSetupIssue): ReadinessAction {
  if (issue.kind === 'timezone') return { kind: 'store-section', section: 'basic' };
  if (issue.kind === 'hours') return { kind: 'store-section', section: 'hours' };
  if (issue.kind === 'staff') return { kind: 'technicians' };
  return { kind: 'reservation', tab: issue.kind === 'room' ? 'rooms' : issue.kind === 'schedule' ? 'therapists' : 'services', serviceId: issue.serviceId, therapistId: issue.therapistId };
}
/** Saved prerequisites only. A disabled merchant login never blocks the public booking setup. */
export function bookingConfigurationLinks(data: ShopReadiness): Array<ReadinessCheck & { action: ReadinessAction; actionLabel: string }> {
  const result: Array<ReadinessCheck & { action: ReadinessAction; actionLabel: string }> = [];
  const add = (checks: ReadinessCheck[], key: string, action: ReadinessAction, actionLabel: string) => {
    const check = checks.find(row => row.key === key && row.state === 'ATTENTION');
    if (check) result.push({ ...check, action, actionLabel });
  };
  add(data.publication.checks, 'publicStatus', { kind: 'store-section', section: 'review' }, '设置发布状态');
  add(data.publication.checks, 'timezone', { kind: 'store-section', section: 'basic' }, '设置门店时区');
  add(data.publication.checks, 'hours', { kind: 'store-section', section: 'hours' }, '设置营业时间');
  add(data.booking.checks, 'onlineBooking', { kind: 'store-section', section: 'hours' }, '设置预约开关');
  add(data.booking.checks, 'storeOrderEmail', { kind: 'store-section', section: 'basic' }, '设置收单邮箱');
  add(data.booking.checks, 'activeServices', { kind: 'services' }, '设置项目与价目');
  const understaffed = data.services.filter(service => service.isActive && service.checks.some(check => check.key === 'staff' && check.state === 'ATTENTION'));
  if (understaffed.length) result.push({ key: 'staff-count', label: '技师人数待补齐', state: 'ATTENTION', detail: `${understaffed.length} 个启用项目的技师人数不足。请按门店实际人数设置，启用技师默认承接本店全部项目。`, action: { kind: 'technicians' }, actionLabel: '设置技师人数' });
  return result;
}
/** An explicit missing selection must never silently open a different record. */
export function readinessSelection<T extends { id: string | number }>(items: T[] | undefined, requestedId: string) {
  return requestedId ? items?.find(item => String(item.id) === requestedId) : items?.[0];
}
export interface ReadinessLoadState { shopId: string; loading: boolean; data: ShopReadiness | null; error: string }
type FetchReadiness = (shopId: string, signal: AbortSignal) => Promise<ShopReadiness>;
export class ReadinessLoader {
  private version = 0;
  private controller: AbortController | null = null;
  constructor(private readonly fetch: FetchReadiness = getShopReadiness) {}
  cancel() { this.version++; this.controller?.abort(); this.controller = null; }
  async read(shopId: string, publish: (state: ReadinessLoadState) => void) {
    this.cancel(); const own = this.version, controller = new AbortController(); this.controller = controller;
    publish({ shopId, loading: true, data: null, error: '' });
    try {
      const data = await this.fetch(shopId, controller.signal);
      if (own === this.version && !controller.signal.aborted) publish({ shopId, loading: false, data, error: '' });
    } catch (error) {
      if (own === this.version && !controller.signal.aborted) publish({ shopId, loading: false, data: null, error: error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '门店检查暂未完成，请重新检查。' });
    }
  }
}
