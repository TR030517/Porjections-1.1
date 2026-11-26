import client from './client';
import { shopLocal, shopUtc } from '../utils/reservationTime';

export type BlockScope = 'SHOP' | 'THERAPIST' | 'ROOM';
export type BlockPurpose = 'INTERNAL_OCCUPANCY' | 'TIME_BLOCK';
export type CalendarAction = 'CREATE' | 'UPDATE' | 'RELEASE' | 'CLOSE_DAY' | 'REOPEN_DAY';
export interface ActionResource { type: 'THERAPIST' | 'ROOM'; id: string; name: string }
export interface CalendarActionOptions { shopId: string; timezone: string; date: string; settingsHash: string; closed: boolean; temporaryClosure: { startDate: string; endDate: string } | null; resources: ActionResource[] }
export interface CalendarBlock {
  id: string; shopId: string; scope: BlockScope; resourceId: string | null; purpose: BlockPurpose;
  startAt: string; endAt: string; timezone: string; reason: string; status: 'ACTIVE' | 'RELEASED'; version: number;
  operator: { id: string; name: string };
}
export interface CalendarCommand {
  requestKey: string; action: CalendarAction; expectedTimezone: string;
  blockId?: string; expectedVersion?: number; purpose?: BlockPurpose; scope?: BlockScope; resourceId?: string;
  startLocal?: string; endLocal?: string; reason?: string; date?: string; expectedSettingsHash?: string;
}
export interface CalendarReceipt { shopId: string; requestKey: string; action: CalendarAction; outcome: 'COMMITTED'; result: { blockId: string | null; version: number | null; closedDate: string | null } }
export type CalendarOperation = CalendarReceipt | { shopId: string; requestKey: string; outcome: 'NOT_FOUND' | 'NOT_EXECUTED' };
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const instant = (value: unknown): value is string => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const validDate = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00Z')) && new Date(date + 'T00:00Z').toISOString().slice(0, 10) === date;
const fail = (): never => { throw new Error('无法核对日历操作结果，原请求标记已保留，请查询确定结果。'); };
export function validateCalendarCommand(command: CalendarCommand): CalendarCommand {
  if (!command || !uuid(command.requestKey) || !['CREATE', 'UPDATE', 'RELEASE', 'CLOSE_DAY', 'REOPEN_DAY'].includes(command.action) || !text(command.expectedTimezone, 100)) throw new Error('日历操作参数无效。');
  shopLocal(new Date().toISOString(), command.expectedTimezone);
  if (command.action === 'UPDATE' || command.action === 'RELEASE') { if (!id(command.blockId) || !version(command.expectedVersion)) throw new Error('请重新读取区间的当前版本。'); }
  if (command.action === 'CREATE' || command.action === 'UPDATE') {
    if (!['INTERNAL_OCCUPANCY', 'TIME_BLOCK'].includes(command.purpose!) || !['SHOP', 'THERAPIST', 'ROOM'].includes(command.scope!) || !text(command.reason)) throw new Error('请选择用途、作用范围并填写原因（最多500字）。');
    if (command.scope === 'SHOP' ? command.resourceId !== undefined : !id(command.resourceId)) throw new Error('请选择本店对应资源。');
    const start = shopUtc(command.startLocal ?? '', command.expectedTimezone), end = shopUtc(command.endLocal ?? '', command.expectedTimezone);
    if (Date.parse(start) >= Date.parse(end)) throw new Error('结束时间必须晚于开始时间。');
  }
  if (['CLOSE_DAY', 'REOPEN_DAY'].includes(command.action) && (!validDate(command.date) || !text(command.expectedSettingsHash, 200))) throw new Error('请重新读取当天营业设置。');
  return command;
}
export function requireActionOptions(value: any, shopId: string, date: string): CalendarActionOptions {
  if (!value || value.shopId !== shopId || value.date !== date || !text(value.timezone, 100) || !text(value.settingsHash, 200) || typeof value.closed !== 'boolean' || !Array.isArray(value.resources)) return fail();
  shopLocal(new Date().toISOString(), value.timezone);
  const closure = value.temporaryClosure ?? null;
  if (closure !== null && (!validDate(closure.startDate) || !validDate(closure.endDate) || closure.startDate > date || closure.endDate < date)
    || value.closed !== (closure !== null)) return fail();
  const resources = value.resources.map((resource: any) => { if (!resource || !['THERAPIST', 'ROOM'].includes(resource.type) || !id(resource.id) || !text(resource.name, 200)) return fail(); return { type: resource.type, id: resource.id, name: resource.name }; });
  return { shopId, date, timezone: value.timezone, settingsHash: value.settingsHash, closed: value.closed, temporaryClosure: closure === null ? null : { startDate: closure.startDate, endDate: closure.endDate }, resources };
}
export function requireCalendarBlock(value: any, shopId: string, blockId: string): CalendarBlock {
  if (!value || value.shopId !== shopId || value.id !== blockId || !id(blockId) || !['SHOP', 'THERAPIST', 'ROOM'].includes(value.scope)
    || (value.scope === 'SHOP' ? value.resourceId !== null : !id(value.resourceId)) || !['INTERNAL_OCCUPANCY', 'TIME_BLOCK'].includes(value.purpose)
    || !instant(value.startAt) || !instant(value.endAt) || Date.parse(value.startAt) >= Date.parse(value.endAt) || !text(value.timezone, 100)
    || !text(value.reason) || !['ACTIVE', 'RELEASED'].includes(value.status) || !version(value.version) || !id(value.operator?.id) || !(value.operator.name === null || text(value.operator.name, 200))) return fail();
  shopLocal(value.startAt, value.timezone);
  return { id: blockId, shopId, scope: value.scope, resourceId: value.resourceId, purpose: value.purpose, startAt: value.startAt, endAt: value.endAt, timezone: value.timezone, reason: value.reason, status: value.status, version: value.version, operator: { id: value.operator.id, name: value.operator.name ?? '工作人员' } };
}
export function requireCalendarOperation(value: any, shopId: string, command: CalendarCommand, settled: boolean): CalendarOperation {
  if (!value || value.shopId !== shopId || value.requestKey !== command.requestKey) return fail();
  if (value.outcome === 'NOT_EXECUTED' || !settled && value.outcome === 'NOT_FOUND') return { shopId, requestKey: command.requestKey, outcome: value.outcome };
  if (value.outcome !== 'COMMITTED' || value.action !== command.action || !value.result) return fail();
  const result = value.result;
  if (command.action === 'CLOSE_DAY' || command.action === 'REOPEN_DAY') { if (result.blockId !== null || result.version !== null || result.closedDate !== command.date) return fail(); }
  else if (!id(result.blockId) || !version(result.version) || result.closedDate !== null || (command.action !== 'CREATE' && (result.blockId !== command.blockId || result.version !== command.expectedVersion! + 1))) return fail();
  return { shopId, requestKey: command.requestKey, action: command.action, outcome: 'COMMITTED', result: { blockId: result.blockId, version: result.version, closedDate: result.closedDate } };
}
const base = (shopId: string) => `/reservation-admin/shops/${encodeURIComponent(shopId)}/calendar-actions`;
export async function getCalendarActionOptions(shopId: string, date: string, signal?: AbortSignal) { const { data } = await client.get(base(shopId) + '/options', { params: { date }, signal }); return requireActionOptions(data, shopId, date); }
export async function getCalendarBlock(shopId: string, blockId: string, signal?: AbortSignal) { const { data } = await client.get(base(shopId) + '/blocks/' + encodeURIComponent(blockId), { signal }); return requireCalendarBlock(data, shopId, blockId); }
export async function submitCalendarAction(shopId: string, command: CalendarCommand): Promise<CalendarReceipt> { validateCalendarCommand(command); const { data } = await client.post(base(shopId), command); const receipt = requireCalendarOperation(data, shopId, command, true); if (receipt.outcome !== 'COMMITTED') return fail(); return receipt; }
export async function reconcileCalendarAction(shopId: string, command: CalendarCommand): Promise<CalendarOperation> { const { data } = await client.post(base(shopId) + '/operations/' + encodeURIComponent(command.requestKey) + '/reconcile', {}); return requireCalendarOperation(data, shopId, command, true); }
export async function queryCalendarAction(shopId: string, command: CalendarCommand): Promise<CalendarOperation> { const { data } = await client.get(base(shopId) + '/operations/' + encodeURIComponent(command.requestKey)); return requireCalendarOperation(data, shopId, command, false); }
