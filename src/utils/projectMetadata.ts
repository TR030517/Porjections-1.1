import type { ProjectCatalogItem } from './projectCatalog';
import { readServiceDurationKind, type ServiceDurationKind } from './serviceDuration';

export const PROJECT_METADATA_CATEGORIES = [
  { value: 'MASSAGE', label: '按摩' }, { value: 'REFLEXOLOGY', label: '足疗' }, { value: 'CUPPING', label: '拔罐' },
  { value: 'SCRAPING', label: '刮痧' }, { value: 'HEAD_THERAPY', label: '头疗' }, { value: 'OTHER', label: '其他' },
] as const;
export interface ProjectMetadataDraft { name: string; category: string; description: string; isActive: boolean; durationKind: string; durationMin: string; price: string; }
export interface ProjectMetadataPayload {
  name: string; category: string; description: string; isActive: boolean;
  durationKind?: ServiceDurationKind; durationMin?: number; priceCents?: number;
}
export type ProjectMetadataPatch = Partial<ProjectMetadataPayload>;
export type ProjectMetadataSource = Pick<ProjectCatalogItem, 'id' | 'shopId' | 'name' | 'category' | 'description' | 'isActive' | 'durationKind' | 'durationMin' | 'priceCents' | 'hasVariants' | 'variantCount'>;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactId = (value: unknown): string | null => {
  const result = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  return /^[1-9]\d{0,18}$/.test(result) && BigInt(result) <= 9223372036854775807n ? result : null;
};
// Retain the legacy upper-edge amount for correction; it is not a valid new price.
const moneyDraft = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100000000 ? `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}` : '';
function plain(value: unknown, label: string, max: number, required: boolean, multiline = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()) || /<\/?[a-z][^>]*>/iu.test(value)
    || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)) throw Error(`${label}须为${required ? '非空' : ''}纯文本，最多${max}字。`);
  return value.replace(/\r\n?/g, '\n').trim();
}
export function projectMetadataIdentity(source: ProjectMetadataSource): string {
  const projectId = exactId(source.id), shopId = exactId(source.shopId);
  if (!projectId || !shopId) throw Error('本店项目编号无法核对，请重新打开项目。');
  return shopId + ':' + projectId;
}
export function projectMetadataDraft(source: ProjectMetadataSource): ProjectMetadataDraft {
  return { name: source.name, category: typeof source.category === 'string' ? source.category : '', description: typeof source.description === 'string' ? source.description : '', isActive: source.isActive,
    durationKind: typeof source.durationKind === 'string' ? source.durationKind : '', durationMin: Number.isSafeInteger(source.durationMin) ? String(source.durationMin) : '', price: moneyDraft(source.priceCents) };
}
/** A metadata refresh compares only editable fields, never an unused base price of a variant family. */
export function projectMetadataSourceKey(source: ProjectMetadataSource): string {
  const draft = projectMetadataDraft(source);
  return JSON.stringify([projectMetadataIdentity(source), source.hasVariants, source.variantCount, draft.name, draft.category, draft.description, draft.isActive,
    ...(source.hasVariants ? [] : [draft.durationKind, draft.durationMin, draft.price])]);
}
export function projectMetadataFingerprint(draft: ProjectMetadataDraft, hasVariants: boolean): string {
  return JSON.stringify([draft.name, draft.category, draft.description, draft.isActive, ...(hasVariants ? [] : [draft.durationKind, draft.durationMin, draft.price])]);
}
/** Strict decimal parsing: an explicit amount, without signs, exponent, comma or rounded fractions. */
export function projectMetadataPriceCents(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) throw Error('请填写有效美元价格，最多两位小数。');
  const [whole, fraction = ''] = value.trim().split('.'), result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result < 1 || result > 99999999) throw Error('整次服务总价须为0.01–999999.99美元。');
  return result;
}
/** Only existing-project metadata is writable here. Store, resource policy and child options never enter this PATCH. */
export function buildProjectMetadataPayload(source: ProjectMetadataSource, draft: ProjectMetadataDraft): ProjectMetadataPayload {
  projectMetadataIdentity(source);
  if (typeof source.hasVariants !== 'boolean' || !Number.isSafeInteger(source.variantCount) || source.variantCount < 0 || source.hasVariants !== (source.variantCount > 0)) throw Error('项目规格信息无法核对，请刷新本店目录。');
  if (!PROJECT_METADATA_CATEGORIES.some(option => option.value === draft.category)) throw Error('请选择有效的项目类别。');
  if (typeof draft.isActive !== 'boolean') throw Error('请明确项目启用状态。');
  const payload: ProjectMetadataPayload = { name: plain(draft.name, '项目名称', 200, true), category: draft.category, description: plain(draft.description, '项目说明', 10000, false, true), isActive: draft.isActive };
  if (!source.hasVariants) {
    const durationKind = readServiceDurationKind(draft.durationKind);
    if (typeof draft.durationMin !== 'string' || !/^\d+$/.test(draft.durationMin) || !Number.isSafeInteger(Number(draft.durationMin)) || Number(draft.durationMin) < 5 || Number(draft.durationMin) > 240) throw Error('服务时长／预约预留须为5–240整数分钟。');
    Object.assign(payload, { durationKind, durationMin: Number(draft.durationMin), priceCents: projectMetadataPriceCents(draft.price) });
  }
  return payload;
}
/** Do not resend untouched fields from an older catalog snapshot. */
export function buildProjectMetadataPatch(source: ProjectMetadataSource, draft: ProjectMetadataDraft): ProjectMetadataPatch {
  const payload = buildProjectMetadataPayload(source, draft), original = projectMetadataDraft(source);
  const fields = { name: 'name', category: 'category', description: 'description', isActive: 'isActive', durationKind: 'durationKind', durationMin: 'durationMin', priceCents: 'price' } as const;
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => {
    const field = key as keyof ProjectMetadataPayload;
    return draft[fields[field]] !== original[fields[field]] && value !== source[field];
  })) as ProjectMetadataPatch;
}
/** The receipt must identify this exact shop and project and acknowledge every requested editable field. */
export function verifyProjectMetadataReceipt(value: unknown, source: ProjectMetadataSource, payload: ProjectMetadataPatch): ProjectMetadataSource {
  projectMetadataIdentity(source);
  if (!record(value) || exactId(value.id) !== exactId(source.id) || exactId(value.shopId) !== exactId(source.shopId)) throw Error('保存回执不是当前门店的这个项目，请保留草稿并刷新核对。');
  for (const [key, expected] of Object.entries(payload)) if (value[key] !== expected) throw Error('项目保存回执与提交内容不一致，请保留草稿并刷新核对。');
  if (typeof value.hasVariants === 'boolean' && value.hasVariants !== source.hasVariants) throw Error('项目规格状态已变化，请保留草稿并刷新核对。');
  if (typeof value.name !== 'string' || typeof value.category !== 'string' || typeof value.description !== 'string' || typeof value.isActive !== 'boolean'
    || !source.hasVariants && (typeof value.durationKind !== 'string' || typeof value.durationMin !== 'number' || typeof value.priceCents !== 'number')) throw Error('项目保存回执资料不完整，请保留草稿并刷新核对。');
  const snapshot: ProjectMetadataSource = { ...source, name: value.name, category: value.category, description: value.description, isActive: value.isActive,
    ...(!source.hasVariants ? { durationKind: value.durationKind as string, durationMin: value.durationMin as number, priceCents: value.priceCents as number } : {}) };
  // Existing variants may expose normalized display minutes rather than unused legacy base values.
  const saved = buildProjectMetadataPayload(snapshot, projectMetadataDraft(snapshot));
  return { ...snapshot, ...saved };
}
