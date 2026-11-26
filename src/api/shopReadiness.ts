import { apiRequest, ApiError } from './session';

export type ReadinessSection = 'basic' | 'brand' | 'hours' | 'review';
export type ReadinessTab = 'services' | 'therapists' | 'rooms';
export type ReadinessAction = { kind: 'store-section'; section: ReadinessSection }
  | { kind: 'accounts' } | { kind: 'services' } | { kind: 'technicians' }
  | { kind: 'reservation'; tab: ReadinessTab; serviceId?: string; therapistId?: string };
export interface ReadinessCheck { key: string; label: string; state: 'PASS' | 'ATTENTION' | 'INFO'; detail: string; action?: ReadinessAction }
export interface ShopReadiness {
  schemaVersion: 1; checkedAt: string; shop: { id: string; name: string; status: string };
  publication: { ready: boolean; publicVisible: boolean; checks: ReadinessCheck[] };
  access: { loginReady: boolean; checks: ReadinessCheck[] };
  booking: { enabled: boolean; payAtStoreEnabled: boolean; checks: ReadinessCheck[] };
  presentation: { checks: ReadinessCheck[] };
  services: Array<{ id: string; name: string; isActive: boolean; mode: 'LEGACY' | 'VARIANTS'; checks: ReadinessCheck[] }>;
  summary: { activeServices: number; disabledServices: number; activeServicesWithFindings: number };
  limitations: string[];
}
export const readinessId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const invalid = () => new ApiError('门店检查结果格式无效，请重新检查，暂勿据此判断配置已就绪。');
function timestamp(value: unknown): value is string {
  if (!text(value, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const normalized = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_match, digits: string) => '.' + digits.padEnd(3, '0') + 'Z') : value.replace('Z', '.000Z');
  return new Date(value).toISOString() === normalized;
}
function action(value: unknown): ReadinessAction {
  if (!record(value)) throw invalid();
  if (value.kind === 'store-section' && ['basic', 'brand', 'hours', 'review'].includes(String(value.section))) return { kind: 'store-section', section: value.section as ReadinessSection };
  if (value.kind === 'accounts' || value.kind === 'services' || value.kind === 'technicians') return { kind: value.kind };
  if (value.kind === 'reservation' && ['services', 'therapists', 'rooms'].includes(String(value.tab))
    && (value.serviceId === undefined || readinessId(value.serviceId)) && (value.therapistId === undefined || readinessId(value.therapistId))) {
    return { kind: 'reservation', tab: value.tab as ReadinessTab, ...(readinessId(value.serviceId) ? { serviceId: value.serviceId } : {}), ...(readinessId(value.therapistId) ? { therapistId: value.therapistId } : {}) };
  }
  throw invalid();
}
function checks(value: unknown, max = 32): ReadinessCheck[] {
  if (!Array.isArray(value) || !value.length || value.length > max) throw invalid();
  const result = value.map(item => {
    if (!record(item) || !text(item.key, 100) || !text(item.label, 200) || !['PASS', 'ATTENTION', 'INFO'].includes(String(item.state)) || !text(item.detail, 2000)) throw invalid();
    return { key: item.key, label: item.label, state: item.state as ReadinessCheck['state'], detail: item.detail, ...(item.action === undefined ? {} : { action: action(item.action) }) };
  });
  if (new Set(result.map(item => item.key)).size !== result.length) throw invalid();
  return result;
}
export function checkedShopReadiness(value: unknown, expectedShopId: string): ShopReadiness {
  if (!readinessId(expectedShopId) || !record(value) || value.schemaVersion !== 1 || !timestamp(value.checkedAt)
    || !record(value.shop) || value.shop.id !== expectedShopId || !text(value.shop.name, 200) || !['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].includes(String(value.shop.status))
    || !record(value.publication) || typeof value.publication.ready !== 'boolean' || typeof value.publication.publicVisible !== 'boolean'
    || !record(value.access) || typeof value.access.loginReady !== 'boolean' || !record(value.booking) || typeof value.booking.enabled !== 'boolean' || typeof value.booking.payAtStoreEnabled !== 'boolean'
    || !record(value.presentation) || !Array.isArray(value.services) || value.services.length > 500 || !record(value.summary)
    || !Array.isArray(value.limitations) || !value.limitations.length || value.limitations.length > 20 || !value.limitations.every(item => text(item, 2000))) throw invalid();
  const publication = { ready: value.publication.ready, publicVisible: value.publication.publicVisible, checks: checks(value.publication.checks) };
  // Merchant login availability is reported in access, independently of public
  // store details. Imported accounts can intentionally remain suspended.
  const publicationKeys = ['name', 'timezone', 'contact', 'address', 'hours'];
  if (!publicationKeys.every(key => publication.checks.some(item => item.key === key)) || publication.ready !== publicationKeys.every(key => publication.checks.find(item => item.key === key)?.state === 'PASS')) throw invalid();
  const services = value.services.map(item => {
    if (!record(item) || !readinessId(item.id) || !text(item.name, 200) || typeof item.isActive !== 'boolean' || !['LEGACY', 'VARIANTS'].includes(String(item.mode))) throw invalid();
    return { id: item.id, name: item.name, isActive: item.isActive, mode: item.mode as 'LEGACY' | 'VARIANTS', checks: checks(item.checks, 16) };
  });
  const active = services.filter(item => item.isActive), findings = active.filter(item => item.checks.some(check => check.state === 'ATTENTION'));
  if (new Set(services.map(item => item.id)).size !== services.length || value.summary.activeServices !== active.length || value.summary.disabledServices !== services.length - active.length || value.summary.activeServicesWithFindings !== findings.length) throw invalid();
  const result: ShopReadiness = {
    schemaVersion: 1, checkedAt: value.checkedAt, shop: { id: expectedShopId, name: value.shop.name, status: String(value.shop.status) }, publication,
    access: { loginReady: value.access.loginReady, checks: checks(value.access.checks) },
    booking: { enabled: value.booking.enabled, payAtStoreEnabled: value.booking.payAtStoreEnabled, checks: checks(value.booking.checks) },
    presentation: { checks: checks(value.presentation.checks) }, services,
    summary: { activeServices: active.length, disabledServices: services.length - active.length, activeServicesWithFindings: findings.length }, limitations: [...value.limitations] as string[],
  };
  const serviceIds = new Set(services.map(item => item.id));
  for (const check of [...result.publication.checks, ...result.access.checks, ...result.booking.checks, ...result.presentation.checks, ...services.flatMap(item => item.checks)]) {
    if (check.action?.kind === 'reservation' && check.action.serviceId && !serviceIds.has(check.action.serviceId)) throw invalid();
  }
  return result;
}
export async function getShopReadiness(shopId: string, signal?: AbortSignal): Promise<ShopReadiness> {
  if (!readinessId(shopId)) throw new ApiError('请选择有效的门店进行检查。');
  return checkedShopReadiness(await apiRequest<unknown>('/admin/shop-readiness/' + encodeURIComponent(shopId), { method: 'GET', signal, cache: 'no-store' }), shopId);
}
