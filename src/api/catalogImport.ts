import { apiRequest, ApiError } from './session';

export const CATALOG_MAX_BYTES = 60 * 1024;
export const CATALOG_CATEGORIES: Record<string, string> = { MASSAGE: '按摩', REFLEXOLOGY: '足疗', CUPPING: '拔罐', SCRAPING: '刮痧', HEAD_THERAPY: '头疗', OTHER: '其他' };
export interface CatalogVariant { name: string; durationMin: number; priceCents: number; sourceRows: number[] }
export interface CatalogGroup {
  key: string; name: string; category: string; description: string | null; action: 'CREATE' | 'SKIP';
  reason: string; sourceRows: number[]; existingIds: string[]; variants: CatalogVariant[];
}
export interface CatalogPreview {
  shop: { id: string; name: string }; currency: 'USD'; packageDigest: string; canApply: boolean;
  previewToken: string | null; expiresAt: string | null;
  summary: { inputRows: number; groups: number; newServices: number; newVariants: number; skippedServices: number; duplicateRows: number };
  groups: CatalogGroup[];
}
export interface CatalogIdentity { shopId: string; requestKey: string; packageDigest: string }
export interface CatalogReceipt extends CatalogIdentity {
  operationId: string; appliedAt: string; replayed?: boolean;
  summary: { createdServices: number; createdVariants: number; skippedServices: number };
  created: Array<{ serviceId: string; name: string; variantIds: string[] }>;
  skipped: Array<{ name: string; existingIds: string[] }>;
}
export type CatalogResult = { found: false }
  | { found: true; state: 'APPLIED'; receipt: CatalogReceipt }
  | ({ found: true; state: 'NOT_APPLIED'; resolvedAt: string } & CatalogIdentity);

export const catalogId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
export const catalogDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const catalogRequestKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{8,100}$/.test(value);
const text = (value: unknown, max: number, required = true): value is string => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
const count = (value: unknown, max: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const unique = (values: unknown[]) => new Set(values).size === values.length;
const sameEntries = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const idList = (value: unknown, max: number, required = true): value is string[] => Array.isArray(value) && value.length <= max && (!required || value.length > 0) && value.every(catalogId) && unique(value);
const rows = (value: unknown): value is number[] => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(row => Number.isSafeInteger(row) && row >= 2 && row <= 1000000) && unique(value);
const invalid = () => new ApiError('价目导入结果格式无效，请保留核对标识，不要重复提交。');
function identity(value: CatalogIdentity) {
  if (!value || !catalogId(value.shopId) || !catalogRequestKey(value.requestKey) || !catalogDigest(value.packageDigest)) throw new ApiError('价目导入核对标识无效。');
}
export function checkCatalogText(value: string) {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError('请先粘贴价目表，或选择 CSV / TSV 文件。');
  if (new TextEncoder().encode(value).length > CATALOG_MAX_BYTES) throw new ApiError('价目表超过 60 KiB，请分成最多 100 行的小批次。');
  return value;
}
export function checkedCatalogPreview(data: CatalogPreview, shopId: string): CatalogPreview {
  if (!data || !data.shop || data.shop.id !== shopId || !catalogId(data.shop.id) || !text(data.shop.name, 200)
    || data.currency !== 'USD' || !catalogDigest(data.packageDigest) || typeof data.canApply !== 'boolean'
    || (data.canApply ? !text(data.previewToken, 16384) || !timestamp(data.expiresAt) : data.previewToken !== null || data.expiresAt !== null)
    || !data.summary || !count(data.summary.inputRows, 100) || data.summary.inputRows < 1 || !count(data.summary.groups, 50)
    || !count(data.summary.newServices, 50) || !count(data.summary.newVariants, 500) || !count(data.summary.skippedServices, 50) || !count(data.summary.duplicateRows, 99)
    || !Array.isArray(data.groups) || !data.groups.length || data.groups.length > 50) throw invalid();
  for (const group of data.groups) {
    if (!group || !text(group.key, 1000) || !text(group.name, 200) || !Object.hasOwn(CATALOG_CATEGORIES, group.category)
      || group.description !== null && !text(group.description, 2000, false) || !['CREATE', 'SKIP'].includes(group.action)
      || !text(group.reason, 2000, false) || !rows(group.sourceRows) || !idList(group.existingIds, 500, false)
      || group.action === 'CREATE' && group.existingIds.length !== 0 || group.action === 'SKIP' && !group.existingIds.length
      || !Array.isArray(group.variants) || !group.variants.length || group.variants.length > 10) throw invalid();
    for (const variant of group.variants) {
      if (!variant || !Number.isSafeInteger(variant.durationMin) || variant.durationMin < 5 || variant.durationMin > 240
        || variant.name !== `${variant.durationMin} min` || !Number.isSafeInteger(variant.priceCents) || variant.priceCents < 1 || variant.priceCents > 10000000
        || !rows(variant.sourceRows) || variant.sourceRows.some(row => !group.sourceRows.includes(row))) throw invalid();
    }
    if (!unique(group.variants.map(variant => variant.durationMin))
      || !unique(group.variants.flatMap(variant => variant.sourceRows))
      || group.variants.reduce((sum, variant) => sum + variant.sourceRows.length, 0) !== group.sourceRows.length) throw invalid();
  }
  const created = data.groups.filter(group => group.action === 'CREATE'), skipped = data.groups.filter(group => group.action === 'SKIP');
  if (!unique(data.groups.map(group => group.key)) || !unique(data.groups.flatMap(group => group.sourceRows))
    || data.groups.reduce((sum, group) => sum + group.sourceRows.length, 0) !== data.summary.inputRows
    || data.summary.groups !== data.groups.length || data.summary.newServices !== created.length || data.summary.skippedServices !== skipped.length
    || data.summary.newVariants !== created.reduce((sum, group) => sum + group.variants.length, 0)
    || data.summary.duplicateRows !== data.summary.inputRows - data.groups.reduce((sum, group) => sum + group.variants.length, 0)
    || data.canApply !== (created.length > 0)) throw invalid();
  return data;
}
export function checkedCatalogReceipt(data: CatalogReceipt, expected: CatalogIdentity): CatalogReceipt {
  identity(expected);
  if (!data || data.shopId !== expected.shopId || data.requestKey !== expected.requestKey || data.packageDigest !== expected.packageDigest
    || !text(data.operationId, 100) || !timestamp(data.appliedAt) || data.replayed !== undefined && typeof data.replayed !== 'boolean'
    || !data.summary || !count(data.summary.createdServices, 50) || data.summary.createdServices < 1 || !count(data.summary.createdVariants, 500) || !count(data.summary.skippedServices, 50)
    || !Array.isArray(data.created) || data.created.length !== data.summary.createdServices || !Array.isArray(data.skipped) || data.skipped.length !== data.summary.skippedServices
    || data.created.length + data.skipped.length > 50
    || data.created.some(item => !item || !catalogId(item.serviceId) || !text(item.name, 200) || !idList(item.variantIds, 10))
    || data.skipped.some(item => !item || !text(item.name, 200) || !idList(item.existingIds, 500))) throw invalid();
  if (!unique(data.created.map(item => item.serviceId)) || !unique(data.created.flatMap(item => item.variantIds))
    || data.created.reduce((sum, item) => sum + item.variantIds.length, 0) !== data.summary.createdVariants) throw invalid();
  return data;
}
function checkedResult(data: CatalogResult, expected: CatalogIdentity, terminal = false): CatalogResult {
  if (data?.found === false && !terminal) return data;
  if (data?.found !== true) throw invalid();
  if (data.state === 'APPLIED') return { found: true, state: 'APPLIED', receipt: checkedCatalogReceipt(data.receipt, expected) };
  if (data.state === 'NOT_APPLIED' && data.shopId === expected.shopId && data.requestKey === expected.requestKey && data.packageDigest === expected.packageDigest && timestamp(data.resolvedAt)) return data;
  throw invalid();
}
const base = '/admin/catalog-import';
export async function previewCatalogImport(shopId: string, value: string, signal?: AbortSignal) {
  if (!catalogId(shopId)) throw new ApiError('请先选择有效门店。');
  const text = checkCatalogText(value);
  return checkedCatalogPreview(await apiRequest<CatalogPreview>(base + '/preview', { method: 'POST', body: JSON.stringify({ shopId, text }), signal }), shopId);
}
export async function applyCatalogImport(shopId: string, text: string, preview: CatalogPreview, requestKey: string) {
  checkCatalogText(text); checkedCatalogPreview(preview, shopId);
  if (!catalogRequestKey(requestKey) || !preview.canApply || !preview.expiresAt || Date.parse(preview.expiresAt) <= Date.now()) throw new ApiError('请重新生成有效的导入预览。');
  const data = checkedCatalogReceipt(await apiRequest<CatalogReceipt>(base + '/apply', { method: 'POST', body: JSON.stringify({ shopId, text, previewToken: preview.previewToken, requestKey }) }), { shopId, requestKey, packageDigest: preview.packageDigest });
  if (data.summary.createdServices !== preview.summary.newServices || data.summary.createdVariants !== preview.summary.newVariants || data.summary.skippedServices !== preview.summary.skippedServices
    || !sameEntries(data.created.map(item => JSON.stringify([item.name, item.variantIds.length])), preview.groups.filter(group => group.action === 'CREATE').map(group => JSON.stringify([group.name, group.variants.length])))
    || !sameEntries(data.skipped.map(item => JSON.stringify([item.name, [...item.existingIds].sort()])), preview.groups.filter(group => group.action === 'SKIP').map(group => JSON.stringify([group.name, [...group.existingIds].sort()])))) throw invalid();
  return data;
}
export async function catalogImportResult(expected: CatalogIdentity) {
  identity(expected);
  return checkedResult(await apiRequest<CatalogResult>(base + '/result/' + encodeURIComponent(expected.requestKey)), expected);
}
export async function resolveCatalogImport(expected: CatalogIdentity): Promise<Exclude<CatalogResult, { found: false }>> {
  identity(expected);
  return checkedResult(await apiRequest<CatalogResult>(base + '/resolve', { method: 'POST', body: JSON.stringify({ shopId: expected.shopId, requestKey: expected.requestKey, packageDigest: expected.packageDigest }) }), expected, true) as Exclude<CatalogResult, { found: false }>;
}
