import { BadRequestException } from '@nestjs/common';
import { serviceAddOnInput } from '../reservations/service-addons';
import { readDurationKind, type ServiceDurationKind } from '../../common/service-duration';

export type AddOnCopyReason = 'NEW' | 'MAIN_NOT_FOUND' | 'AMBIGUOUS_MAIN' | 'DUPLICATE_SOURCE_NAME' | 'TARGET_NAME_EXISTS' | 'TARGET_LIMIT';
export interface AddOnCopyPlanRow {
  sourceId: string; sourceServiceId: string; sourceServiceName: string;
  targetServiceId: string | null; targetServiceName: string | null;
  name: string; description: string | null; priceCents: number; currency: 'usd'; sortOrder: number;
  sourceActive: boolean; action: 'CREATE' | 'SKIP'; reasonCode: AddOnCopyReason; reason: string;
  sourceDurationKind: ServiceDurationKind; targetDurationKind: ServiceDurationKind | null;
}
const reason: Record<AddOnCopyReason, string> = {
  NEW: '新增目标店停用附加项目，复核后手动启用', MAIN_NOT_FOUND: '目标店没有同类型、分类及人数口径的匹配主服务，请先复制或整理项目与价目',
  AMBIGUOUS_MAIN: '来源或目标有多个匹配主服务，未猜测父项', DUPLICATE_SOURCE_NAME: '来源同一主服务有重复名称，全部跳过',
  TARGET_NAME_EXISTS: '目标主服务已有同名附加项目，保留其价格与启停', TARGET_LIMIT: '目标主服务已达50项上限，包含先前计划新增',
};
const nameKey = (value: string) => value.normalize('NFKC').trim().toLowerCase();
const identity = (value: unknown): string => {
  const text = typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value : '';
  if (!/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) throw new BadRequestException('附加项目目录标识无效'); return text;
};
export function addOnParentKey(row: any): string {
  if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 || /[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(row.name)
    || !['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'].includes(row.category)
    || !['PER_PERSON', 'PER_BOOKING'].includes(row.priceBasis) || ![1, 2].includes(row.participantCount)) throw new BadRequestException('主服务匹配资料无效，请先整理目录');
  return JSON.stringify([nameKey(row.name), row.category, row.priceBasis, row.participantCount, readDurationKind(row.durationKind)]);
}
function indexedParents(rows: any[]) {
  const ids = new Map<string, any>(), keys = new Map<string, any[]>();
  for (const row of rows) { const id = identity(row.id), key = addOnParentKey(row); if (ids.has(id)) throw new BadRequestException('主服务目录标识重复'); ids.set(id, row); keys.set(key, [...keys.get(key) ?? [], row]); }
  return { ids, keys };
}
function validatedAddOns(rows: any[], parents: Map<string, any>) {
  const seen = new Set<string>();
  return rows.map(row => {
    const id = identity(row.id), serviceId = identity(row.serviceId);
    if (seen.has(id) || !parents.has(serviceId)) throw new BadRequestException('附加项目父服务无效或标识重复'); seen.add(id);
    const data = serviceAddOnInput(row);
    return { id, serviceId, ...data };
  }).sort((a, b) => BigInt(a.serviceId) < BigInt(b.serviceId) ? -1 : BigInt(a.serviceId) > BigInt(b.serviceId) ? 1 : a.sortOrder - b.sortOrder || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

/** Bounded deterministic plan. No model write and no client-provided target/price. */
export function planAddOnCopy(sourceServices: any[], targetServices: any[], sourceRows: any[], targetRows: any[]): AddOnCopyPlanRow[] {
  if (sourceServices.length > 500 || targetServices.length > 500 || sourceRows.length > 500 || targetRows.length > 2000) throw new BadRequestException('附加项目复制目录过大，请联系公司分批整理');
  const source = indexedParents(sourceServices), target = indexedParents(targetServices);
  const additions = validatedAddOns(sourceRows, source.ids), existing = validatedAddOns(targetRows, target.ids);
  const sourceNames = new Map<string, number>(), targetNames = new Map<string, Set<string>>(), capacity = new Map<string, number>();
  for (const row of additions) { const key = row.serviceId + ':' + nameKey(row.name); sourceNames.set(key, (sourceNames.get(key) ?? 0) + 1); }
  for (const row of existing) { targetNames.set(row.serviceId, new Set([...(targetNames.get(row.serviceId) ?? []), nameKey(row.name)])); capacity.set(row.serviceId, (capacity.get(row.serviceId) ?? 0) + 1); }
  const sourceCounts = new Map<string, number>();
  for (const row of additions) sourceCounts.set(row.serviceId, (sourceCounts.get(row.serviceId) ?? 0) + 1);
  if ([...sourceCounts.values(), ...capacity.values()].some(count => count > 50)) throw new BadRequestException('单一主服务超过50项，请先整理附加项目');
  return additions.map((row): AddOnCopyPlanRow => {
    const parent = source.ids.get(row.serviceId)!, key = addOnParentKey(parent), matches = target.keys.get(key) ?? [];
    let matched: any = matches.length === 1 ? matches[0] : null, reasonCode: AddOnCopyReason;
    if (source.keys.get(key)!.length > 1 || matches.length > 1) { reasonCode = 'AMBIGUOUS_MAIN'; matched = null; }
    else if (!matched) reasonCode = 'MAIN_NOT_FOUND';
    else if (sourceNames.get(row.serviceId + ':' + nameKey(row.name))! > 1) reasonCode = 'DUPLICATE_SOURCE_NAME';
    else {
      const targetId = identity(matched.id), names = targetNames.get(targetId) ?? new Set<string>(), used = capacity.get(targetId) ?? 0;
      if (names.has(nameKey(row.name))) reasonCode = 'TARGET_NAME_EXISTS';
      else if (used >= 50) reasonCode = 'TARGET_LIMIT';
      else { reasonCode = 'NEW'; names.add(nameKey(row.name)); targetNames.set(targetId, names); capacity.set(targetId, used + 1); }
    }
    return { sourceId: row.id, sourceServiceId: row.serviceId, sourceServiceName: parent.name,
      targetServiceId: matched ? identity(matched.id) : null, targetServiceName: matched ? matched.name : null,
      sourceDurationKind: readDurationKind(parent.durationKind), targetDurationKind: matched ? readDurationKind(matched.durationKind) : null,
      name: row.name, description: row.description, priceCents: row.priceCents, currency: 'usd', sortOrder: row.sortOrder,
      sourceActive: row.isActive, action: reasonCode === 'NEW' ? 'CREATE' : 'SKIP', reasonCode, reason: reason[reasonCode] };
  });
}

export async function loadAddOnCopyPlan(tx: any, sourceShopId: bigint, targetShopId: bigint) {
  const parentSelect = { id: true, shopId: true, name: true, category: true, priceBasis: true, participantCount: true, isActive: true, durationKind: true };
  const addOnSelect = { id: true, serviceId: true, name: true, description: true, priceCents: true, currency: true, isActive: true, sortOrder: true, createdAt: true, updatedAt: true };
  const parents = (shopId: bigint) => tx.shopService.findMany({ where: { shopId }, orderBy: { id: 'asc' }, take: 501, select: parentSelect });
  const configs = (shopId: bigint, cap: number) => tx.shopServiceAddOn.findMany({ where: { service: { shopId } }, orderBy: [{ serviceId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }], take: cap + 1, select: addOnSelect });
  const sourceServices = await parents(sourceShopId), targetServices = await parents(targetShopId), sourceAddOns = await configs(sourceShopId, 500), targetAddOns = await configs(targetShopId, 2000);
  return { sourceServices, targetServices, sourceAddOns, targetAddOns, rows: planAddOnCopy(sourceServices, targetServices, sourceAddOns, targetAddOns) };
}
