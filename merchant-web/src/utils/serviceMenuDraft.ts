import { readServiceDurationKind, normalizeServiceDuration, type ServiceDurationKind } from '../../../src/utils/serviceDuration';
import type { PriceMenuGroup } from '../../../src/utils/priceMenu';
import type { CreateServiceDto } from '../api/merchant';
import { matchesPriceMenuAutoTitle, normalizePriceMenuPricing } from '../../../src/utils/priceMenuPricing';

export const SERVICE_MENU_PAGE_SIZE = 20;
export const SERVICE_NAME_LIMIT = 200;
export const SERVICE_DESCRIPTION_BYTES = 65_535;
const categories = ['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'];
export interface ServiceMenuSource { groupIndex: number; itemIndex: number; category: string; name: string; description: string; priceText: string; }
export interface ServiceMenuReview { structured: boolean; durationKind: ServiceDurationKind; sourcePriceCents: number | null; sourceDurationMin: number | null; reusedPrice: boolean; reusedDuration: boolean; notices: string[]; }

/** Coordinates always refer to the complete saved menu, never a filtered list. */
export function serviceMenuPage(menu: PriceMenuGroup[], groupIndex: number | null, query: string, page: number) {
  const term = query.trim().toLocaleLowerCase();
  const matches: ServiceMenuSource[] = [];
  menu.forEach((group, groupAt) => {
    if (groupIndex !== null && groupIndex !== groupAt) return;
    group.items.forEach((item, itemAt) => {
      if (term && ![group.category, item.name, item.priceText, item.description ?? ''].some(value => value.toLocaleLowerCase().includes(term))) return;
      matches.push({ groupIndex: groupAt, itemIndex: itemAt, category: group.category, name: item.name, description: item.description ?? '', priceText: item.priceText });
    });
  });
  const pages = Math.max(1, Math.ceil(matches.length / SERVICE_MENU_PAGE_SIZE));
  const current = Math.max(0, Math.min(Number.isInteger(page) ? page : 0, pages - 1));
  return { items: matches.slice(current * SERVICE_MENU_PAGE_SIZE, (current + 1) * SERVICE_MENU_PAGE_SIZE), total: matches.length, pages, page: current };
}

/** Only explicit saved metadata is reusable; legacy text is never parsed. */
export function planServiceDraftFromMenu(menu: PriceMenuGroup[], groupIndex: number, itemIndex: number) {
  if (!Number.isInteger(groupIndex) || !Number.isInteger(itemIndex) || groupIndex < 0 || itemIndex < 0) throw new Error('所选价目已不可用，请重新选择本店已保存的项目。');
  const group = menu[groupIndex], item = group?.items[itemIndex];
  if (!group || !item || typeof item.name !== 'string' || typeof item.priceText !== 'string' || item.description !== undefined && typeof item.description !== 'string') throw new Error('所选价目已不可用，请重新选择本店已保存的项目。');
  let durationKind: ServiceDurationKind = 'TIMED';
  let price: number | null = null, durationMin: number | null = null;
  const review: ServiceMenuReview = { structured: false, durationKind, sourcePriceCents: null, sourceDurationMin: null, reusedPrice: false, reusedDuration: false, notices: [] };
  if (item.pricing !== undefined) {
    let pricing: ReturnType<typeof normalizePriceMenuPricing>;
    try {
      pricing = normalizePriceMenuPricing(item.pricing);
      if (pricing.priceCents === null || item.priceText !== '' || pricing.titleMode === 'AUTO' && !matchesPriceMenuAutoTitle(item.name, pricing)) throw new Error();
    } catch { throw new Error('所选价目的结构化类型或完整标题无效，未替换当前草稿，请先核对展示价目。'); }
    if (pricing.kind === 'ADD_ON') throw new Error('附加项目不能独立带入主服务；当前草稿已保留。请到对应主服务的预约设置中配置。');
    durationKind = pricing.kind;
    price = pricing.priceCents! / 100;
    if (servicePriceCents(price) !== pricing.priceCents) throw new Error('来源金额无法精确复用，未替换当前草稿。');
    review.structured = true; review.durationKind = durationKind; review.sourcePriceCents = pricing.priceCents; review.reusedPrice = true; review.sourceDurationMin = pricing.durationMin;
    if (pricing.priceCents === 0) review.notices.push('基础零价目前不能直接预约，请核对预约计价。');
    if (pricing.kind === 'TIMED') {
      if (pricing.durationMin! >= 5 && pricing.durationMin! <= 240) { durationMin = pricing.durationMin; review.reusedDuration = true; }
      else review.notices.push(`来源固定时长为 ${pricing.durationMin} 分钟，超出预约的 5–240 分钟范围；已留空，请明确核对，不会截断。`);
    } else review.notices.push('按次或非固定时长须人工填写预约预留分钟，未从展示价目推算。');
  }
  if (!review.structured) review.notices.push('旧价目只带原文，金额与分钟留空，不解析标题或原价文字。');
  return { draft: { name: item.name, description: item.description ?? '', durationKind, category: undefined, price, durationMin, isActive: false as const }, review };
}
export function serviceDraftFromMenu(menu: PriceMenuGroup[], groupIndex: number, itemIndex: number) { return planServiceDraftFromMenu(menu, groupIndex, itemIndex).draft; }
export async function prepareServiceMenuCarry(menu: PriceMenuGroup[], groupIndex: number, itemIndex: number, options: { dirty: boolean; confirmReplace: () => Promise<boolean>; currentMenu: () => PriceMenuGroup[]; current: () => boolean }) {
  const baseline = JSON.stringify(menu), plan = planServiceDraftFromMenu(menu, groupIndex, itemIndex);
  if (options.dirty && !await options.confirmReplace()) return null;
  if (!options.current()) return null;
  if (JSON.stringify(options.currentMenu()) !== baseline) throw new Error('本店已保存价目在选择期间变化，请重新选择；当前草稿保留。');
  return plan;
}
export function serviceMenuReuseSummary(review: ServiceMenuReview, values: Record<string, unknown>): string[] {
  const sameKind = values.durationKind === review.durationKind;
  return [
    review.reusedPrice ? sameKind && typeof values.price === 'number' && values.price === review.sourcePriceCents! / 100 ? `金额已复用：USD ${(review.sourcePriceCents! / 100).toFixed(2)}。` : '金额或类型已人工修改／清空，请按当前表单核对。' : '金额待人工填写。',
    review.reusedDuration ? sameKind && values.durationMin === review.sourceDurationMin ? `固定分钟已复用：${review.sourceDurationMin} 分钟。` : '分钟或类型已人工修改／清空，请按当前表单核对。' : '预约分钟待人工填写。',
    values.category ? '分类由你手动选择，请核对。' : '分类待人工选择，不按展示分组推断。',
  ];
}

function plainText(value: unknown, label: string, multiline = false): string {
  if (typeof value !== 'string' || /<\/?[a-z][^>]*>/iu.test(value) || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)) throw new Error(`${label}须为纯文本。`);
  return value.replace(/\r\n?/g, '\n').trim();
}
export function serviceName(value: unknown): string {
  const name = plainText(value, '服务名称');
  if (!name) throw new Error('请输入服务名称。');
  if ((value as string).length > SERVICE_NAME_LIMIT) throw new Error('服务名称最多 200 字。来源名称已完整保留，请手动修改，系统不会截断。');
  return name;
}
export function serviceDescription(value: unknown): string {
  const description = plainText(value === undefined ? '' : value, '服务说明', true);
  if (new TextEncoder().encode(value === undefined ? '' : value as string).byteLength > SERVICE_DESCRIPTION_BYTES) throw new Error('服务说明最多 65535 个 UTF-8 字节，请手动精简，系统不会截断。');
  return description;
}
export function servicePriceCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 999999.99 || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error('请手动填写 0 至 999999.99 美元的价格，最多两位小数。');
  const [whole, fraction = ''] = String(value).split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function serviceSavePayload(values: Record<string, unknown>, mode: 'NEW' | 'MENU' | 'EDIT'): CreateServiceDto & { isActive: boolean } {
  if (typeof values.category !== 'string' || !categories.includes(values.category)) throw new Error('请手动选择服务分类。');
  if (typeof values.durationMin !== 'number' || !Number.isInteger(values.durationMin) || values.durationMin < 5 || values.durationMin > 240) throw new Error('请手动填写 5 至 240 的整数分钟时长／预约预留时间。');
  if (mode === 'EDIT' && typeof values.isActive !== 'boolean') throw new Error('请选择服务是否启用。');
  return { name: serviceName(values.name), description: serviceDescription(values.description), durationKind: readServiceDurationKind(values.durationKind), category: values.category, durationMin: values.durationMin,
    priceCents: servicePriceCents(values.price), isActive: mode === 'MENU' ? false : mode === 'NEW' ? true : values.isActive as boolean };
}

/** Editing a service with variants must not resubmit its unused base values. */
export function serviceMetadataPayload(values: Record<string, unknown>): Partial<CreateServiceDto> & { isActive: boolean } {
  if (typeof values.category !== 'string' || !categories.includes(values.category)) throw new Error('请选择服务分类。');
  if (typeof values.isActive !== 'boolean') throw new Error('请选择服务是否启用。');
  return { name: serviceName(values.name), category: values.category, description: serviceDescription(values.description), isActive: values.isActive };
}

/** A malformed receipt remains uncertain; it must never be presented as a successful disabled create. */
export function assertMenuServiceReceipt(value: { shopId?: unknown; isActive?: unknown; durationKind?: unknown; durationMin?: unknown; reservedDurationMin?: unknown }, shopId: string, expectedKind: ServiceDurationKind = 'TIMED'): void {
  if (!value || String(value.shopId) !== shopId || value.isActive !== false || readServiceDurationKind(value.durationKind) !== expectedKind) throw new Error('无法核对本店停用服务的保存结果。草稿已保留，请刷新列表核对，勿直接重复创建。');
  normalizeServiceDuration(value);
}
/** Compare the immutable submitted request. Empty/null description alone are equivalent. */
export function assertServiceCreateReceipt(value: unknown, shopId: string, payload: CreateServiceDto): asserts value is { id: string } {
  const row = value as Record<string, unknown>;
  const id = row?.id;
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n
    || typeof row.shopId !== 'string' || row.shopId !== shopId || row.name !== payload.name.trim() || row.category !== payload.category
    || (row.description ?? '') !== (payload.description ?? '') || row.priceCents !== payload.priceCents || row.isActive !== (payload.isActive ?? true)
    || typeof row.durationKind !== 'string' || !['TIMED', 'PER_SESSION', 'VARIABLE'].includes(row.durationKind)
    || readServiceDurationKind(row.durationKind) !== readServiceDurationKind(payload.durationKind) || row.durationMin !== payload.durationMin) throw new Error('无法核对服务保存回执，结果未知；请只读核对列表，不要重复创建。');
  normalizeServiceDuration(row);
}

/** Only submitted fields are compared: variant services do not write their unused base price/time. */
export function assertServiceUpdateReceipt(value: unknown, serviceId: string, shopId: string, payload: Partial<CreateServiceDto>): void {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.id !== serviceId || row.shopId !== shopId
    || Object.entries(payload).some(([key, expected]) => key === 'description' ? (row[key] ?? '') !== (expected ?? '') : row[key] !== expected)) {
    throw new Error('本店项目与本次提交内容尚未一致，保存结果未知；草稿已保留，请只读核对，不要重复保存。');
  }
}
