import { readServiceDurationKind, type ServiceDurationKind } from '../../../src/utils/serviceDuration';
import client from './client';
import { validatePriceMenu, type PriceMenuGroup } from '../../../src/utils/priceMenu';
import { matchesPriceMenuAutoTitle, normalizePriceMenuPricing, type PriceMenuPricing } from '../../../src/utils/priceMenuPricing';
import { checkedMenuCopyLinks, type MenuCopyLink } from '../../../src/utils/menuCopyLinks';

export type CopyKind = 'HOURS' | 'CATALOG' | 'PRICE_MENU' | 'ADD_ONS';
export type AddOnCopyReason = 'NEW' | 'MAIN_NOT_FOUND' | 'AMBIGUOUS_MAIN' | 'DUPLICATE_SOURCE_NAME' | 'TARGET_NAME_EXISTS' | 'TARGET_LIMIT';
export interface AddOnCopyChange {
  sourceId: string; sourceServiceId: string; sourceServiceName: string; sourceDurationKind?: ServiceDurationKind;
  targetServiceId: string | null; targetServiceName: string | null; targetDurationKind?: ServiceDurationKind | null;
  name: string; description: string | null; priceCents: number; currency: 'usd'; sortOrder: number;
  sourceActive: boolean; action: 'CREATE' | 'SKIP'; reasonCode: AddOnCopyReason; reason: string;
}
export interface CopyInput { sourceShopId: string; targetShopId: string; kind: CopyKind }
export interface CopyPreview {
  previewHash: string; expiresAt: string; summary: string;
  changes: {
    hours?: { from: unknown; to: unknown };
    services?: { sourceId: string; name: string; durationKind?: ServiceDurationKind; action: 'CREATE' | 'SKIP'; reason?: string }[];
    priceMenu?: { from: PriceMenuGroup[]; to: PriceMenuGroup[]; omittedManagedImages: number; catalogLinks?: MenuCopyLink[] };
    addOns?: AddOnCopyChange[];
  };
}
export interface CopyResult {
  operationId: string; status: 'APPLIED'; kind: CopyKind; created: number; skipped: number;
  sourceShopId: string; targetShopId: string; groups?: number; omittedManagedImages?: number;
}
export type CopyResolution = CopyResult | (CopyInput & {
  status: 'UNKNOWN' | 'NOT_APPLIED'; idempotencyKey: string;
  reason: 'COPY_REQUEST_STILL_UNCONFIRMED' | 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION';
});
export interface CopyHistoryItem extends CopyResult { createdAt: string; sourceShopName: string; targetShopName: string }
export interface CopyHistory { items: CopyHistoryItem[]; total: number; page: number; limit: number }

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HASH = /^[A-Za-z0-9_.-]{1,2048}$/;
const KEY = /^[A-Za-z0-9:_-]{8,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new Error('无法核对复制数据格式，请保留原请求并重新核对。');
function copyDurationKind(value: unknown): ServiceDurationKind { try { return readServiceDurationKind(value); } catch { throw invalid(); } }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || (required && !value.trim())) throw invalid();
  return value;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw invalid();
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value, 64, true);
  if (!Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
export function checkedCopyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw invalid();
  return value;
}
export function checkedCopyInput(value: unknown): CopyInput {
  const data = record(value), sourceShopId = checkedCopyId(data.sourceShopId), targetShopId = checkedCopyId(data.targetShopId);
  if (sourceShopId === targetShopId || typeof data.kind !== 'string' || !['HOURS', 'CATALOG', 'PRICE_MENU', 'ADD_ONS'].includes(data.kind)) throw invalid();
  return { sourceShopId, targetShopId, kind: data.kind as CopyKind };
}
export function checkedCopyRequest(previewHash: unknown, idempotencyKey: unknown): { previewHash: string; idempotencyKey: string } {
  if (typeof previewHash !== 'string' || !HASH.test(previewHash) || typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey)) throw invalid();
  return { previewHash, idempotencyKey };
}

// Only known public opening-period fields survive a raw legacy target-hours preview.
function hours(value: unknown, nullable: boolean): unknown {
  if (value === null && nullable) return null;
  const source = record(value), result: Record<string, unknown> = {};
  for (const day of DAYS) {
    if (!Object.hasOwn(source, day)) continue;
    if (source[day] === null) { result[day] = null; continue; }
    const many = Array.isArray(source[day]), entries = many ? source[day] as unknown[] : [source[day]];
    if (entries.length > 4) throw invalid();
    const periods = entries.map(entry => {
      const row = record(entry);
      if (row.closed !== undefined && typeof row.closed !== 'boolean') throw invalid();
      if (row.closed === true) return { closed: true };
      if (typeof row.open !== 'string' || typeof row.close !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.close) || row.open >= row.close) throw invalid();
      return { open: row.open, close: row.close, ...(row.closed === false ? { closed: false } : {}) };
    });
    result[day] = many ? periods : periods[0];
  }
  return result;
}
function menuPricing(value: unknown): PriceMenuPricing {
  try {
    const pricing = normalizePriceMenuPricing(value);
    // These are saved previews, never incomplete editor drafts. Project each
    // approved field explicitly instead of spreading transport metadata.
    if (pricing.priceCents === null) throw invalid();
    return { kind: pricing.kind, baseName: pricing.baseName, durationMin: pricing.durationMin,
      priceCents: pricing.priceCents, titleMode: pricing.titleMode,
      ...(pricing.legacySource ? { legacySource: { name: pricing.legacySource.name, priceText: pricing.legacySource.priceText } } : {}) };
  } catch { throw invalid(); }
}
function menu(value: unknown): PriceMenuGroup[] {
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  // Project before validating: transport extras must never become application state.
  let items = 0;
  const projected = value.map(raw => {
    const group = record(raw);
    if (!Array.isArray(group.items) || (items += group.items.length) > 1000) throw invalid();
    return { category: group.category, items: group.items.map(rawItem => {
      const item = record(rawItem);
      const pricing = item.pricing === undefined ? undefined : menuPricing(item.pricing);
      if (pricing && (item.priceText !== '' || pricing.titleMode === 'AUTO' && !matchesPriceMenuAutoTitle(item.name, pricing))) throw invalid();
      return { name: item.name, priceText: item.priceText, ...(item.description !== undefined ? { description: item.description } : {}), ...(item.imageUrl !== undefined ? { imageUrl: item.imageUrl } : {}), ...(pricing ? { pricing } : {}) };
    }) };
  });
  try { return validatePriceMenu(projected as PriceMenuGroup[]); } catch { throw invalid(); }
}

function addOnText(value: unknown, max: number, required = false, multiline = false): string {
  const result = text(value, max, required);
  if ((!multiline && /[\u0000-\u001f\u007f]/u.test(result)) || /<\/?[a-z][^>]*>/iu.test(result)) throw invalid();
  return result;
}
function addOnPlan(value: unknown): AddOnCopyChange[] {
  if (!Array.isArray(value) || value.length > 500) throw invalid();
  const seen = new Set<string>(), sourceNames = new Map<string, string>(), targetNames = new Map<string, string>();
  const reasons: AddOnCopyReason[] = ['NEW', 'MAIN_NOT_FOUND', 'AMBIGUOUS_MAIN', 'DUPLICATE_SOURCE_NAME', 'TARGET_NAME_EXISTS', 'TARGET_LIMIT'];
  const result = value.map(raw => {
    const row = record(raw), sourceId = checkedCopyId(row.sourceId), sourceServiceId = checkedCopyId(row.sourceServiceId);
    if (seen.has(sourceId) || row.currency !== 'usd' || typeof row.sourceActive !== 'boolean'
      || !['CREATE', 'SKIP'].includes(row.action as string) || !reasons.includes(row.reasonCode as AddOnCopyReason)) throw invalid();
    seen.add(sourceId);
    const sourceServiceName = addOnText(row.sourceServiceName, 200, true);
    const targetServiceId = row.targetServiceId === null ? null : checkedCopyId(row.targetServiceId);
    const targetServiceName = row.targetServiceName === null ? null : addOnText(row.targetServiceName, 200, true);
    const sourceDurationKind = copyDurationKind(row.sourceDurationKind);
    const targetDurationKind = targetServiceId === null ? null : copyDurationKind(row.targetDurationKind);
    if (targetServiceId === null ? row.targetDurationKind !== undefined && row.targetDurationKind !== null : targetDurationKind !== sourceDurationKind) throw invalid();
    const reasonCode = row.reasonCode as AddOnCopyReason;
    const noTarget = reasonCode === 'MAIN_NOT_FOUND' || reasonCode === 'AMBIGUOUS_MAIN';
    if ((row.action === 'CREATE') !== (reasonCode === 'NEW')
      || (noTarget ? targetServiceId !== null || targetServiceName !== null : targetServiceId === null || targetServiceName === null)
      || targetServiceId === sourceServiceId) throw invalid();
    const sourceBinding = JSON.stringify([sourceServiceName, sourceDurationKind, targetServiceId, targetServiceName, targetDurationKind]);
    if (sourceNames.has(sourceServiceId) && sourceNames.get(sourceServiceId) !== sourceBinding) throw invalid();
    sourceNames.set(sourceServiceId, sourceBinding);
    if (targetServiceId !== null && targetServiceName !== null) {
      const targetBinding = JSON.stringify([targetServiceName, sourceServiceId, targetDurationKind]);
      if (targetNames.has(targetServiceId) && targetNames.get(targetServiceId) !== targetBinding) throw invalid();
      targetNames.set(targetServiceId, targetBinding);
    }
    return { sourceId, sourceServiceId, sourceServiceName, sourceDurationKind, targetServiceId, targetServiceName, targetDurationKind,
      name: addOnText(row.name, 100, true), description: row.description === null ? null : addOnText(row.description, 1000, false, true),
      priceCents: integer(row.priceCents, 10000000), currency: 'usd' as const, sortOrder: integer(row.sortOrder, 10000),
      sourceActive: row.sourceActive, action: row.action as 'CREATE' | 'SKIP', reasonCode, reason: addOnText(row.reason, 2000, true) };
  });
  const sourceGroups = new Map<string, AddOnCopyChange[]>(), targetCreates = new Set<string>();
  for (const row of result) {
    const name = row.name.normalize('NFKC').trim().toLowerCase(), key = `${row.sourceServiceId}:${name}`;
    sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), row]);
    if (row.action === 'CREATE') {
      const targetKey = `${row.targetServiceId}:${name}`;
      if (targetCreates.has(targetKey)) throw invalid();
      targetCreates.add(targetKey);
    }
  }
  if ([...sourceGroups.values()].some(rows => rows.length > 1 && rows.some(row => row.action === 'CREATE'))) throw invalid();
  return result;
}
export function checkedCopyPreview(value: unknown, input: CopyInput): CopyPreview {
  const expected = checkedCopyInput(input), data = record(value), changes = record(data.changes);
  if (typeof data.previewHash !== 'string' || !HASH.test(data.previewHash)) throw invalid();
  const result: CopyPreview = { previewHash: data.previewHash, expiresAt: timestamp(data.expiresAt), summary: text(data.summary, 2000), changes: {} };
  if (expected.kind === 'HOURS') {
    const change = record(changes.hours);
    result.changes.hours = { from: hours(change.from, true), to: hours(change.to, false) };
  } else if (expected.kind === 'CATALOG') {
    if (!Array.isArray(changes.services) || changes.services.length > 500) throw invalid();
    const seen = new Set<string>();
    result.changes.services = changes.services.map(raw => {
      const row = record(raw), sourceId = checkedCopyId(row.sourceId);
      if (seen.has(sourceId) || (row.action !== 'CREATE' && row.action !== 'SKIP')) throw invalid();
      seen.add(sourceId);
      return { sourceId, name: text(row.name, 300, true), durationKind: copyDurationKind(row.durationKind), action: row.action, ...(row.reason === undefined ? {} : { reason: text(row.reason, 2000) }) };
    });
  } else if (expected.kind === 'ADD_ONS') {
    result.changes.addOns = addOnPlan(changes.addOns);
  } else {
    const change = record(changes.priceMenu), from = menu(change.from), to = menu(change.to);
    const omittedManagedImages = integer(change.omittedManagedImages, to.reduce((count, group) => count + group.items.length, 0));
    result.changes.priceMenu = { from, to, omittedManagedImages, ...(change.catalogLinks === undefined ? {} : { catalogLinks: checkedMenuCopyLinks(change.catalogLinks) }) };
  }
  return result;
}
export function checkedCopyResult(value: unknown, input: CopyInput): CopyResult {
  const expected = checkedCopyInput(input), data = record(value);
  const actual = checkedCopyInput(data);
  if (actual.sourceShopId !== expected.sourceShopId || actual.targetShopId !== expected.targetShopId || actual.kind !== expected.kind || data.status !== 'APPLIED' || typeof data.operationId !== 'string' || !UUID.test(data.operationId)) throw invalid();
  const created = integer(data.created, actual.kind === 'PRICE_MENU' ? 1000 : 500), skipped = integer(data.skipped, 500);
  const result: CopyResult = { operationId: data.operationId, status: 'APPLIED', ...actual, created, skipped };
  if (actual.kind === 'HOURS' && (created !== 0 || skipped !== 0)) throw invalid();
  if ((actual.kind === 'CATALOG' || actual.kind === 'ADD_ONS') && created + skipped > 500) throw invalid();
  if (actual.kind === 'PRICE_MENU') {
    if (skipped !== 0) throw invalid();
    result.groups = integer(data.groups, 100);
    result.omittedManagedImages = integer(data.omittedManagedImages, created);
  }
  return result;
}
export function checkedCopyResolution(value: unknown, input: CopyInput, idempotencyKey: string): CopyResolution {
  const expected = checkedCopyInput(input), data = record(value);
  if (data.status === 'APPLIED') return checkedCopyResult(data, expected);
  const actual = checkedCopyInput(data);
  if (actual.sourceShopId !== expected.sourceShopId || actual.targetShopId !== expected.targetShopId || actual.kind !== expected.kind || data.idempotencyKey !== idempotencyKey) throw invalid();
  if (data.status === 'UNKNOWN' && data.reason === 'COPY_REQUEST_STILL_UNCONFIRMED') return { ...actual, status: 'UNKNOWN', idempotencyKey, reason: 'COPY_REQUEST_STILL_UNCONFIRMED' };
  if (data.status === 'NOT_APPLIED' && data.reason === 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION') return { ...actual, status: 'NOT_APPLIED', idempotencyKey, reason: 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' };
  throw invalid();
}


export async function previewCopy(input: CopyInput, signal?: AbortSignal): Promise<CopyPreview> {
  const safe = checkedCopyInput(input);
  const { data } = await client.post<unknown>('/account-access/copy/preview', safe, { signal });
  return checkedCopyPreview(data, safe);
}
export async function applyCopy(input: CopyInput, previewHash: string, idempotencyKey: string, signal?: AbortSignal): Promise<CopyResult> {
  const safe = checkedCopyInput(input), request = checkedCopyRequest(previewHash, idempotencyKey);
  const { data } = await client.post<unknown>('/account-access/copy/apply', { ...safe, ...request }, { signal });
  return checkedCopyResult(data, safe);
}
export async function resolveCopy(input: CopyInput, previewHash: string, idempotencyKey: string, signal?: AbortSignal): Promise<CopyResolution> {
  const safe = checkedCopyInput(input), request = checkedCopyRequest(previewHash, idempotencyKey);
  const { data } = await client.post<unknown>('/account-access/copy/resolve', { ...safe, ...request }, { signal });
  return checkedCopyResolution(data, safe, request.idempotencyKey);
}
export async function getCopyHistory(page = 1, limit = 20, signal?: AbortSignal): Promise<CopyHistory> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 9999 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('复制历史分页无效。');
  const { data: raw } = await client.get<unknown>('/account-access/copy/history', { params: { page, limit }, signal });
  const data = record(raw);
  if (!Array.isArray(data.items) || data.items.length > limit || data.page !== page || data.limit !== limit) throw invalid();
  const total = integer(data.total), seen = new Set<string>();
  const items = data.items.map(rawItem => {
    const row = record(rawItem), result = checkedCopyResult(row, checkedCopyInput(row));
    if (seen.has(result.operationId)) throw invalid();
    seen.add(result.operationId);
    return { ...result, createdAt: timestamp(row.createdAt), sourceShopName: text(row.sourceShopName, 200), targetShopName: text(row.targetShopName, 200) };
  });
  if (total < items.length) throw invalid();
  return { items, total, page, limit };
}
