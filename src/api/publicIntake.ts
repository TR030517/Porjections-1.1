import { apiRequest } from './session';

export const PUBLIC_INTAKE_MAX_BYTES = 60 * 1024;
export type IntakeFieldName = 'description' | 'businessHours';
export interface IntakeField { field: IntakeFieldName; state: 'FILL' | 'UNCHANGED' | 'KEEP_EXISTING'; current: unknown; incoming: unknown }
export interface IntakeIssue { code: string; field?: string; message: string }
export interface IntakeShopPreview {
  sourceId: string; targetShopId: string; name: string; shortName: string;
  sourceUrls?: string[];
  currentTarget?: { name: string; shortName: string | null; address: string } | null;
  status: 'READY' | 'UNCHANGED' | 'INVALID'; issues: IntakeIssue[]; fields: IntakeField[];
  missing: Array<{ key: string; label: string }>; rawCatalogItems: number;
}
export interface IntakePreview {
  packageDigest: string; previewToken: string | null; expiresAt: string | null; canApply: boolean;
  summary: { shops: number; readyShops: number; fillFields: number; unchangedFields: number; keptFields: number; invalidShops: number; rawCatalogItems: number };
  shops: IntakeShopPreview[];
}
export interface IntakeReceipt {
  operationId: string; appliedAt: string; requestKey: string; packageDigest: string;
  summary: { shops: number; changedShops: number; changedFields: number; unchangedShops: number };
  shops: Array<{ sourceId: string; targetShopId: string; changedFields: IntakeFieldName[] }>;
  replayed?: boolean;
}
export type IntakePackage = Record<string, unknown>;
export type IntakeResult = { found: false }
  | { found: true; state: 'APPLIED'; receipt: IntakeReceipt }
  | { found: true; state: 'NOT_APPLIED'; requestKey: string; packageDigest: string; resolvedAt: string };
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const key = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{8,100}$/.test(value);
const field = (value: unknown): value is IntakeFieldName => value === 'description' || value === 'businessHours';
const invalid = () => new Error('导入结果格式无效，请保留请求标识并核对，不要重复提交。');
function isSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://app.asianmassagebook.com' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseIntakeFile(text: string): IntakePackage {
  if (new TextEncoder().encode(text).length > PUBLIC_INTAKE_MAX_BYTES) throw new Error('文件超过60 KiB，请分成不超过20家门店的小批次。');
  let data: unknown;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('文件不是有效JSON，请检查引号、逗号和括号。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('导入文件的顶层须为JSON对象。');
  return data as IntakePackage;
}
export async function previewPublicIntake(input: IntakePackage, signal?: AbortSignal): Promise<IntakePreview> {
  const data = await apiRequest<IntakePreview>('/admin/public-intake/preview', { method: 'POST', body: JSON.stringify({ package: input }), signal });
  if (!data || !digest(data.packageDigest) || typeof data.canApply !== 'boolean'
    || (data.canApply ? typeof data.previewToken !== 'string' || !data.previewToken || typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) : data.previewToken !== null || data.expiresAt !== null)
    || !data.summary || !['shops', 'readyShops', 'fillFields', 'unchangedFields', 'keptFields', 'invalidShops', 'rawCatalogItems'].every(name => count(data.summary[name as keyof IntakePreview['summary']]))
    || !Array.isArray(data.shops) || data.shops.length < 1 || data.shops.length > 20 || data.shops.length !== data.summary.shops
    || data.shops.some(shop => !shop || typeof shop.sourceId !== 'string' || typeof shop.targetShopId !== 'string' || typeof shop.name !== 'string' || typeof shop.shortName !== 'string'
      || (shop.sourceUrls !== undefined && (!Array.isArray(shop.sourceUrls) || shop.sourceUrls.length > 5 || !shop.sourceUrls.every(isSourceUrl)))
      || (shop.currentTarget != null && (typeof shop.currentTarget.name !== 'string' || (shop.currentTarget.shortName !== null && typeof shop.currentTarget.shortName !== 'string') || typeof shop.currentTarget.address !== 'string'))
      || !['READY', 'UNCHANGED', 'INVALID'].includes(shop.status) || !count(shop.rawCatalogItems)
      || !Array.isArray(shop.fields) || shop.fields.some(item => !item || !field(item.field) || !['FILL', 'UNCHANGED', 'KEEP_EXISTING'].includes(item.state))
      || !Array.isArray(shop.issues) || shop.issues.some(issue => !issue || typeof issue.code !== 'string' || typeof issue.message !== 'string')
      || !Array.isArray(shop.missing) || shop.missing.some(item => !item || typeof item.key !== 'string' || typeof item.label !== 'string'))) throw invalid();
  return data;
}
export function checkedIntakeReceipt(data: IntakeReceipt, expected: { requestKey: string; packageDigest: string }): IntakeReceipt {
  if (!data || typeof data.operationId !== 'string' || !data.operationId || !Number.isFinite(Date.parse(data.appliedAt))
    || !key(data.requestKey) || data.requestKey !== expected.requestKey || !digest(data.packageDigest) || data.packageDigest !== expected.packageDigest
    || !data.summary || !['shops', 'changedShops', 'changedFields', 'unchangedShops'].every(name => count(data.summary[name as keyof IntakeReceipt['summary']]))
    || !Array.isArray(data.shops) || data.shops.length < 1 || data.shops.length !== data.summary.shops || data.shops.length > 20
    || data.shops.some(shop => !shop || !id(shop.sourceId) || !id(shop.targetShopId) || !Array.isArray(shop.changedFields) || new Set(shop.changedFields).size !== shop.changedFields.length || shop.changedFields.some(name => !field(name)))
    || new Set(data.shops.map(shop => shop.targetShopId)).size !== data.shops.length
    || data.summary.changedShops !== data.shops.filter(shop => shop.changedFields.length).length
    || data.summary.changedShops + data.summary.unchangedShops !== data.summary.shops
    || data.summary.changedFields !== data.shops.reduce((sum, shop) => sum + shop.changedFields.length, 0)) throw invalid();
  return data;
}
export async function applyPublicIntake(input: IntakePackage, preview: IntakePreview, requestKey: string): Promise<IntakeReceipt> {
  if (!key(requestKey) || !preview.canApply || !digest(preview.packageDigest)) throw new Error('请先生成可提交的预览。');
  const result = await apiRequest<IntakeReceipt>('/admin/public-intake/apply', { method: 'POST', body: JSON.stringify({ package: input, previewToken: preview.previewToken, requestKey }) });
  return checkedIntakeReceipt(result, { requestKey, packageDigest: preview.packageDigest });
}
function checkedResult(data: IntakeResult, pending: { requestKey: string; packageDigest: string }, terminal = false): IntakeResult {
  if (data?.found === false && !terminal) return data;
  if (data?.found !== true) throw invalid();
  if (data.state === 'APPLIED') return { found: true, state: 'APPLIED', receipt: checkedIntakeReceipt(data.receipt, pending) };
  if (data.state === 'NOT_APPLIED' && data.requestKey === pending.requestKey && data.packageDigest === pending.packageDigest && typeof data.resolvedAt === 'string' && Number.isFinite(Date.parse(data.resolvedAt))) return data;
  throw invalid();
}
export async function publicIntakeResult(pending: { requestKey: string; packageDigest: string }): Promise<IntakeResult> {
  if (!key(pending.requestKey) || !digest(pending.packageDigest)) throw new Error('导入核对标识无效。');
  const data = await apiRequest<IntakeResult>(`/admin/public-intake/result/${encodeURIComponent(pending.requestKey)}`);
  return checkedResult(data, pending);
}
export async function resolvePublicIntake(pending: { requestKey: string; packageDigest: string }): Promise<Exclude<IntakeResult, { found: false }>> {
  if (!key(pending.requestKey) || !digest(pending.packageDigest)) throw new Error('导入核对标识无效。');
  const data = await apiRequest<IntakeResult>('/admin/public-intake/resolve', { method: 'POST', body: JSON.stringify({ requestKey: pending.requestKey, packageDigest: pending.packageDigest }) });
  return checkedResult(data, pending, true) as Exclude<IntakeResult, { found: false }>;
}
