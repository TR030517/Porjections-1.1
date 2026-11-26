import { BadRequestException } from '@nestjs/common';
import { Allow } from 'class-validator';
import { id, variantInput } from './reservation-validation';

export type CatalogMutationAction = 'CREATE_SERVICE' | 'CREATE_VARIANT' | 'LINK_EXISTING_VARIANT';
export interface CatalogMutationReceipt {
  operationId: string; action: CatalogMutationAction; shopId: string; serviceId: string; variantId: string;
  created: { service: boolean; variant: boolean; display: boolean };
  displayStatus: 'NOT_REQUESTED' | 'ADDED' | 'ALREADY_LINKED'; displayItemId: string | null;
  priceMenuRevision: string; selectionRevision: string;
}
// Unknown metadata types deliberately prevent global implicit conversion (e.g.
// "false" -> true or a numeric ID losing precision). The parser validates deeply.
export class CatalogMutationDto {
  @Allow() action?: unknown;
  @Allow() idempotencyKey?: unknown;
  @Allow() expectedPriceMenuRevision?: unknown;
  @Allow() expectedSelectionRevision?: unknown;
  @Allow() serviceId?: unknown;
  @Allow() variantId?: unknown;
  @Allow() service?: unknown;
  @Allow() variant?: unknown;
  @Allow() display?: unknown;
}
export interface ParsedCatalogMutation {
  action: CatalogMutationAction; idempotencyKey: string; expectedPriceMenuRevision: string;
  expectedSelectionRevision?: string; serviceId?: string; variantId?: string;
  service?: { name: string; description: string | null; category: string; durationKind: string; isActive: boolean };
  variant?: ReturnType<typeof variantInput>;
  display?: { groupIndex: number } | { newGroupCategory: string };
}
function record(value: unknown, allowed: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null, CatalogMutationDto.prototype].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !allowed.includes(key))) throw new BadRequestException('请求包含无效或不允许的字段');
  return value as Record<string, any>;
}
function text(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || !empty && !value.trim()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || /<\/?[a-z][^>]*>/iu.test(value)) throw new BadRequestException(`${name}无效`);
  return value.trim();
}
function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new BadRequestException('缺少有效的目录编辑版本，请重新加载');
  return value;
}
export function catalogMutationKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{8,100}$/.test(value)) throw new BadRequestException('操作请求编号无效');
  return value;
}
export function parseCatalogMutation(value: unknown): ParsedCatalogMutation {
  const body = record(value, ['action', 'idempotencyKey', 'expectedPriceMenuRevision', 'expectedSelectionRevision', 'serviceId', 'variantId', 'service', 'variant', 'display']);
  if (!['CREATE_SERVICE', 'CREATE_VARIANT', 'LINK_EXISTING_VARIANT'].includes(body.action)) throw new BadRequestException('未知的目录操作');
  const action = body.action as CatalogMutationAction;
  const result: ParsedCatalogMutation = { action, idempotencyKey: catalogMutationKey(body.idempotencyKey), expectedPriceMenuRevision: revision(body.expectedPriceMenuRevision) };
  const forbidden = action === 'CREATE_SERVICE' ? ['serviceId', 'variantId', 'expectedSelectionRevision']
    : action === 'CREATE_VARIANT' ? ['service', 'variantId'] : ['service', 'variant'];
  if (forbidden.some(key => Object.prototype.hasOwnProperty.call(body, key))) throw new BadRequestException('操作混用了其他目录命令的字段');
  if (action !== 'CREATE_SERVICE') {
    result.serviceId = id(body.serviceId, 'serviceId').toString();
    result.expectedSelectionRevision = revision(body.expectedSelectionRevision);
  } else {
    const service = record(body.service, ['name', 'description', 'category', 'durationKind', 'isActive']);
    const category = service.category ?? 'OTHER', durationKind = service.durationKind ?? 'TIMED', active = service.isActive ?? true;
    if (!['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'].includes(category)
      || !['TIMED', 'PER_SESSION', 'VARIABLE'].includes(durationKind) || typeof active !== 'boolean'
      || service.isActive === null || service.category === null || service.durationKind === null) throw new BadRequestException('服务类型或启用状态无效');
    result.service = { name: text(service.name, '服务名称', 200), description: service.description === undefined ? null : text(service.description, '服务说明', 10000, true), category, durationKind, isActive: active };
  }
  if (action === 'LINK_EXISTING_VARIANT') result.variantId = id(body.variantId, 'variantId').toString();
  else {
    const variant = record(body.variant, ['name', 'durationMin', 'priceCents', 'isActive', 'sortOrder']);
    // Name and booleans retain their original types before the existing strict validator.
    text(variant.name, '规格名称', 100);
    result.variant = variantInput({ ...variant, isActive: variant.isActive === undefined ? true : variant.isActive,
      sortOrder: variant.sortOrder === undefined ? 0 : variant.sortOrder, currency: 'usd', priceBasis: 'PER_BOOKING' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'display')) {
    const display = record(body.display, ['groupIndex', 'newGroupCategory']);
    if (Object.keys(display).length !== 1) throw new BadRequestException('请选择一个已有分组或新建分组');
    if (Object.prototype.hasOwnProperty.call(display, 'groupIndex')) {
      if (!Number.isInteger(display.groupIndex) || display.groupIndex < 0 || display.groupIndex >= 100) throw new BadRequestException('价目分组编号无效');
      result.display = { groupIndex: display.groupIndex };
    } else result.display = { newGroupCategory: text(display.newGroupCategory, '新分组名称', 200) };
  } else if (action === 'LINK_EXISTING_VARIANT') throw new BadRequestException('关联已有规格必须指定展示分组');
  return result;
}
