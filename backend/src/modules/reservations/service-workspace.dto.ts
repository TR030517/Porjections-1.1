import { BadRequestException } from '@nestjs/common';
import { Allow } from 'class-validator';
import { catalogMutationKey } from './catalog-actions.dto';
import { id } from './reservation-validation';
import type { WorkspaceCommand, WorkspaceGroupRef } from './service-workspace.contract';

export class ServiceWorkspaceCommandDto {
  @Allow() action?: unknown; @Allow() idempotencyKey?: unknown; @Allow() expectedPriceMenuRevision?: unknown;
  @Allow() serviceId?: unknown; @Allow() expectedSelectionRevision?: unknown; @Allow() service?: unknown;
  @Allow() policy?: unknown; @Allow() variants?: unknown; @Allow() addOns?: unknown; @Allow() newGroups?: unknown;
  @Allow() displays?: unknown; @Allow() groups?: unknown; @Allow() groupOrder?: unknown; @Allow() moves?: unknown;
  @Allow() removeGroups?: unknown; @Allow() itemId?: unknown; @Allow() changes?: unknown; @Allow() confirm?: unknown;
}
export function workspaceRecord(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null, ServiceWorkspaceCommandDto.prototype].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !keys.includes(key))) throw new BadRequestException('服务草稿包含无效或不允许的字段');
  return value as Record<string, any>;
}
export function workspaceText(value: unknown, max: number, empty = false, multiline = false): string {
  if (typeof value !== 'string' || value.length > max || !empty && !value.trim()
    || /<\/?[a-z][^>]*>/iu.test(value)
    || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)) throw new BadRequestException('请核对文字长度与纯文本内容');
  return value.replace(/\r\n?/g, '\n').trim();
}
export function workspaceInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new BadRequestException(`数值须为${min}至${max}的整数`);
  return value;
}
export function workspaceTempKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) throw new BadRequestException('临时编号无效');
  return value;
}
export function workspaceItemId(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[a-zA-Z0-9_-]{1,64}|legacy:\d{1,3}:\d{1,4}:[a-f0-9]{16})$/.test(value)) throw new BadRequestException('展示位置编号无效，请重新加载');
  return value;
}
export function workspaceRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new BadRequestException('缺少完整编辑版本，请保留草稿并重新加载');
  return value;
}
function array(value: unknown, limit: number): any[] {
  if (!Array.isArray(value) || value.length > limit) throw new BadRequestException('草稿项目数量超出安全上限');
  return value;
}
export function workspaceGroup(value: unknown): WorkspaceGroupRef {
  const row = workspaceRecord(value, ['index', 'tempKey']);
  if (Object.keys(row).length !== 1) throw new BadRequestException('请选择一个明确分组');
  return row.index !== undefined ? { index: workspaceInteger(row.index, 0, 99) } : { tempKey: workspaceTempKey(row.tempKey) };
}
function identity(row: Record<string, any>, display = false) {
  if ((row.id === undefined) === (row.tempKey === undefined)) throw new BadRequestException('请提供原编号或唯一临时编号');
  if (row.id !== undefined) display ? workspaceItemId(row.id) : id(row.id);
  else workspaceTempKey(row.tempKey);
}
const SERVICE = ['name', 'description', 'category', 'durationKind', 'isActive', 'durationMin', 'priceCents', 'sortOrder'];
const POLICY = ['participantCount', 'requiredStaffCount', 'requiredRoomType', 'staffBufferMin', 'roomBufferMin'];
const VARIANT = ['name', 'durationMin', 'priceCents', 'isActive', 'sortOrder'];
const EXTRA = ['name', 'description', 'priceCents', 'isActive', 'sortOrder'];
const DISPLAY = ['name', 'description', 'imageUrl', 'isVisible', 'titleMode'];
const BASE = ['action', 'idempotencyKey', 'expectedPriceMenuRevision'];
export function parseWorkspaceCommand(raw: unknown): WorkspaceCommand {
  const initial = workspaceRecord(raw, [...BASE, 'serviceId', 'expectedSelectionRevision', 'service', 'policy', 'variants', 'addOns', 'newGroups', 'displays', 'groups', 'groupOrder', 'moves', 'removeGroups', 'itemId', 'changes', 'confirm']);
  const allowed = initial.action === 'SAVE_SERVICE_WORKSPACE' ? ['serviceId', 'expectedSelectionRevision', 'service', 'policy', 'variants', 'addOns', 'newGroups', 'displays']
    : initial.action === 'SAVE_MENU_LAYOUT' ? ['groups', 'groupOrder', 'moves', 'removeGroups']
      : initial.action === 'SAVE_LEGACY_DISPLAY' ? ['itemId', 'changes'] : initial.action === 'REMOVE_MENU_DISPLAY' ? ['itemId', 'confirm'] : null;
  if (!allowed) throw new BadRequestException('未知的服务草稿操作');
  const body = workspaceRecord(raw, [...BASE, ...allowed]);
  catalogMutationKey(body.idempotencyKey); workspaceRevision(body.expectedPriceMenuRevision);
  if (body.action === 'SAVE_SERVICE_WORKSPACE') {
    if (body.serviceId !== undefined) { id(body.serviceId); workspaceRevision(body.expectedSelectionRevision); }
    else if (body.expectedSelectionRevision !== undefined) throw new BadRequestException('新服务不能引用既有服务版本');
    for (const [field, keys] of [['service', SERVICE], ['policy', POLICY]] as const) if (body[field] !== undefined) workspaceRecord(body[field], keys);
    for (const [field, keys, limit] of [['variants', VARIANT, 200], ['addOns', EXTRA, 50]] as const) if (body[field] !== undefined) {
      const seen = new Set<string>();
      for (const input of array(body[field], limit)) {
        const row = workspaceRecord(input, ['id', 'tempKey', 'changes']); identity(row); workspaceRecord(row.changes, keys);
        const key = row.id ? 'id:' + row.id : 'new:' + row.tempKey;
        if (seen.has(key)) throw new BadRequestException('同一规格或附加项不能重复修改'); seen.add(key);
      }
    }
    if (body.newGroups !== undefined) for (const input of array(body.newGroups, 100)) { const row = workspaceRecord(input, ['tempKey', 'category']); workspaceTempKey(row.tempKey); workspaceText(row.category, 200, true); }
    if (body.displays !== undefined) {
      const seen = new Set<string>();
      for (const input of array(body.displays, 1000)) {
        const row = workspaceRecord(input, ['id', 'tempKey', 'target', 'group', 'position', 'changes']); identity(row, true); workspaceRecord(row.changes, DISPLAY);
        if (row.group !== undefined) workspaceGroup(row.group);
        if (row.position !== undefined) workspaceInteger(row.position, 0, 1000);
        if (row.target !== undefined) {
          const target = workspaceRecord(row.target, ['kind', 'id', 'tempKey']);
          if (target.kind === 'SERVICE') { if (Object.keys(target).length !== 1) throw new BadRequestException('基础服务关联无效'); }
          else { if (!['VARIANT', 'ADD_ON'].includes(target.kind)) throw new BadRequestException('展示来源类型无效'); identity(target); }
        }
        if (row.tempKey !== undefined && (!row.target || !row.group)) throw new BadRequestException('新展示位置须明确来源及分组');
        const key = row.id ? 'id:' + row.id : 'new:' + row.tempKey;
        if (seen.has(key)) throw new BadRequestException('同一展示位置不能重复修改'); seen.add(key);
      }
    }
  } else if (body.action === 'SAVE_MENU_LAYOUT') {
    if (body.groups !== undefined) for (const input of array(body.groups, 100)) {
      const row = workspaceRecord(input, ['index', 'tempKey', 'category']); workspaceGroup(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'category'))); workspaceText(row.category, 200, true);
    }
    if (body.groupOrder !== undefined) for (const value of array(body.groupOrder, 100)) workspaceGroup(value);
    if (body.moves !== undefined) for (const input of array(body.moves, 1000)) { const row = workspaceRecord(input, ['itemId', 'group', 'position']); workspaceItemId(row.itemId); workspaceGroup(row.group); workspaceInteger(row.position, 0, 1000); }
    if (body.removeGroups !== undefined) for (const input of array(body.removeGroups, 100)) { const row = workspaceRecord(input, ['index', 'moveTo']); workspaceInteger(row.index, 0, 99); workspaceGroup(row.moveTo); }
  } else if (body.action === 'SAVE_LEGACY_DISPLAY') {
    workspaceItemId(body.itemId); workspaceRecord(body.changes, ['name', 'priceText', 'description', 'imageUrl', 'isVisible']);
  } else {
    workspaceItemId(body.itemId); if (body.confirm !== true) throw new BadRequestException('永久移除须明确确认；隐藏请使用显示开关');
  }
  return body as WorkspaceCommand;
}
