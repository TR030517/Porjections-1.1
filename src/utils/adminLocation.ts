import type { ResourceQuery } from '../api/resources';
import { auditQuery, type AuditFilters } from '../api/auditLogs';
import type { ViewId } from '../types';
import { SHOP_SEARCH_MAX_LENGTH } from '../../backend/src/common/shop-search';

export interface AdminLocation { view: ViewId; query: ResourceQuery; }
export const ADMIN_ALL_STORES_SCOPE = 'ALL';
const views = new Set<ViewId>(['dashboard', 'audit-logs', 'notification-operations', 'area-management', 'coupon-management', 'gift-card-management', 'user-list', 'post-sales', 'store-application', 'store-list', 'service-orders', 'gift-card-orders', 'withdrawal-list', 'platform-settings', 'help-list', 'banner-list', 'admin-list', 'merchant-list', 'role-management', 'package-management', 'services', 'technicians', 'reservation-settings', 'industries']);
const auditKeys = ['targetType', 'action', 'targetId', 'operatorId', 'startDate', 'endDate'] as const;
const idKeys = ['shopId', 'serviceId', 'therapistId'] as const;
export function locationPage(value: unknown, fallback = 1) {
  const text = String(value ?? '');
  return /^[1-9]\d{0,5}$/.test(text) && Number(text) <= 100000 ? Number(text) : fallback;
}
export function locationPageSize(value: unknown, choices: number[], fallback: number) {
  return choices.includes(Number(value)) ? Number(value) : fallback;
}
function date(value: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}
/** Only structural list state belongs in shareable URLs, never free text or editor drafts. */
export function safeAdminLocation(view: unknown, incoming: ResourceQuery = {}, allowed: (view: ViewId) => boolean = () => true): AdminLocation {
  if (!views.has(view as ViewId) || !allowed(view as ViewId)) return { view: 'dashboard', query: {} };
  const current = view as ViewId;
  const query: ResourceQuery = {};
  if (current === 'audit-logs') {
    const filters: AuditFilters = {};
    for (const key of auditKeys) if (typeof incoming[key] === 'string') filters[key] = incoming[key] as string;
    try {
      const params = auditQuery(filters, locationPage(incoming.page), locationPageSize(incoming.limit, [20, 50, 100], 20));
      for (const [key, value] of params) query[key] = value;
    } catch { return { view: current, query: { page: 1, limit: 20 } }; }
  } else {
    for (const key of idKeys) {
      const value = String(incoming[key] ?? '');
      if (/^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n) query[key] = value;
    }
    for (const key of ['status', 'paymentStatus', 'isActive', 'storeSection', 'tab']) {
      const value = String(incoming[key] ?? '');
      if (/^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(value)) query[key] = value;
    }
    for (const key of ['startDate', 'endDate']) if (typeof incoming[key] === 'string' && date(incoming[key] as string)) query[key] = incoming[key];
    if (query.startDate && query.endDate && String(query.startDate) > String(query.endDate)) { delete query.startDate; delete query.endDate; }
    for (const key of ['returnToStore', 'returnToReview']) if (incoming[key] === true || incoming[key] === 'true') query[key] = true;
    if (incoming.page !== undefined) query.page = locationPage(incoming.page);
    if (incoming.pageSize !== undefined) query.pageSize = locationPageSize(incoming.pageSize, [25, 50, 100], 25);
  }
  const shopId = String(incoming.shopId ?? '');
  if (/^[1-9]\d{0,18}$/.test(shopId) && BigInt(shopId) <= 9223372036854775807n) {
    query.shopId = shopId;
    const bookingId = String(incoming.bookingId ?? '');
    if (current === 'post-sales' && /^[1-9]\d{0,18}$/.test(bookingId) && BigInt(bookingId) <= 9223372036854775807n) query.bookingId = bookingId;
  }
  else if (incoming.shopScope === ADMIN_ALL_STORES_SCOPE) query.shopScope = ADMIN_ALL_STORES_SCOPE;
  return { view: current, query };
}
export function readAdminLocation(search: string, allowed?: (view: ViewId) => boolean) {
  const params = new URLSearchParams(search);
  return safeAdminLocation(params.get('module') ?? 'dashboard', Object.fromEntries(params), allowed);
}
export function adminLocationSearch(location: AdminLocation) {
  const safe = safeAdminLocation(location.view, location.query);
  const params = new URLSearchParams({ module: safe.view });
  for (const key of Object.keys(safe.query).sort()) params.set(key, String(safe.query[key]));
  return '?' + params.toString();
}

const identityKey = 'massajoy.admin.location.identity';
const privateQueryKey = 'massajoy.admin.location.private';
export function restoreAdminLocation(identity: string, browser: Pick<Window, 'location' | 'history' | 'sessionStorage'>, allowed: (view: ViewId) => boolean) {
  let previous: string | null = null;
  try { previous = browser.sessionStorage.getItem(identityKey); browser.sessionStorage.setItem(identityKey, identity); } catch { /* URL restoration still works without storage. */ }
  const foreignEntry = browser.history.state?.adminIdentity && browser.history.state.adminIdentity !== identity;
  const location = previous && previous !== identity || foreignEntry ? { view: 'dashboard' as const, query: {} } : readAdminLocation(browser.location.search, allowed);
  try {
    const saved = JSON.parse(browser.sessionStorage.getItem(privateQueryKey) ?? 'null');
    if (saved?.identity === identity && saved.route === adminLocationSearch(location) && typeof saved.search === 'string') {
      location.query.search = saved.search.slice(0, location.view === 'store-list' ? SHOP_SEARCH_MAX_LENGTH : 100);
    }
  } catch { /* Unavailable or malformed local state must not prevent navigation. */ }
  writeAdminLocation(location, identity, browser, true);
  return location;
}
export function writeAdminLocation(location: AdminLocation, identity: string, browser: Pick<Window, 'location' | 'history'> & Partial<Pick<Window, 'sessionStorage'>>, replace = false) {
  const search = adminLocationSearch(location);
  try {
    if (typeof location.query.search === 'string' && location.query.search) {
      const limit = location.view === 'store-list' ? SHOP_SEARCH_MAX_LENGTH : 100;
      browser.sessionStorage?.setItem(privateQueryKey, JSON.stringify({ identity, route: search, search: location.query.search.slice(0, limit) }));
    }
    else browser.sessionStorage?.removeItem(privateQueryKey);
  } catch { /* Shareable structural state still works without session storage. */ }
  const url = browser.location.pathname + search;
  const previousPosition = browser.history.state?.adminIdentity === identity && Number.isSafeInteger(browser.history.state?.adminPosition) ? browser.history.state.adminPosition : 0;
  const state = { adminIdentity: identity, adminPosition: replace || browser.location.search === search ? previousPosition : previousPosition + 1 };
  if (replace || browser.location.search === search) browser.history.replaceState(state, '', url);
  else browser.history.pushState(state, '', url);
}
export function clearAdminLocation(browser: Pick<Window, 'location' | 'history' | 'sessionStorage'>) {
  try { browser.sessionStorage.removeItem(identityKey); browser.sessionStorage.removeItem(privateQueryKey); } catch { /* Storage may be unavailable. */ }
  browser.history.replaceState(null, '', browser.location.pathname);
}
