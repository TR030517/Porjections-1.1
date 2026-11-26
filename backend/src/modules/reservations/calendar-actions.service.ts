import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { requireShopAccess } from '../../common/shop-access';
import { storedStudioProfile } from '../../common/shop-studio-profile';
import { isShopClosedOnDate, normalizeShopBookingSettings, readShopBookingSettings, ShopBookingSettings } from '../../common/shop-booking-settings';
import { isRetryableTransactionError } from '../../common/transaction-retry';
import { shopBookingSettingsHash } from '../../common/shop-booking-settings-revision';
import { localInstant } from '../booking/time';
import { calendarDayBoundary } from './booking-calendar.service';
import { addCalendarDays, calendarDate } from './booking-calendar.dto';
import { Actor, id, object } from './reservation-validation';
import { configurationAudit, ensureShopBookingSettings } from './configuration-guard';
import { CalendarActionResult, calendarActionKey, ParsedCalendarAction, parseCalendarAction } from './calendar-actions.dto';
import { ensureCalendarBlockAvailable } from './calendar-actions.conflicts';

export function calendarSettingsHash(shop: { timezone: string | null; studioProfile: unknown }): string {
  return shopBookingSettingsHash(shop);
}
export function closeCalendarDate(settings: ShopBookingSettings, date: string): ShopBookingSettings {
  const periods = [...settings.closedPeriods, { startDate: date, endDate: date }].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const merged: typeof periods = [];
  for (const period of periods) {
    const last = merged[merged.length - 1];
    // Adjacent whole dates can share one range; no UTC 24-hour arithmetic is
    // used to derive a shop-local day's actual duration.
    if (last && period.startDate <= addCalendarDays(last.endDate, 1)) last.endDate = last.endDate > period.endDate ? last.endDate : period.endDate;
    else merged.push({ ...period });
  }
  try { return normalizeShopBookingSettings({ minimumNoticeMinutes: settings.minimumNoticeMinutes, closedPeriods: merged }); }
  catch { throw new ConflictException('闭店日期已达到上限，请先整理已有闭店范围'); }
}
/** closedPeriods include both endpoints. Remove only one calendar label, never
 * subtract 24 UTC hours across a shop-local daylight-saving transition. */
export function reopenCalendarDate(settings: ShopBookingSettings, date: string): ShopBookingSettings {
  const periods = settings.closedPeriods.flatMap(period => {
    if (date < period.startDate || date > period.endDate) return [{ ...period }];
    return [
      ...(period.startDate < date ? [{ startDate: period.startDate, endDate: addCalendarDays(date, -1) }] : []),
      ...(date < period.endDate ? [{ startDate: addCalendarDays(date, 1), endDate: period.endDate }] : []),
    ];
  });
  try { return normalizeShopBookingSettings({ minimumNoticeMinutes: settings.minimumNoticeMinutes, closedPeriods: periods }); }
  catch { throw new ConflictException('恢复当天后闭店范围超过50段，请先在预约规则中整理其他范围'); }
}

@Injectable()
export class CalendarActionsService {
  constructor(private readonly prisma: PrismaService) {}
  private async authorize(db: any, shopId: bigint, actor: Actor, write = false) {
    if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException();
    id(actor.id, 'operatorId');
    return (await requireShopAccess(db, shopId, actor, 'RESERVATION_CONFIG', { write })).shop;
  }
  private async write<T>(shopId: bigint, actor: Actor, callback: (tx: any, shop: any) => Promise<T>): Promise<T> {
    if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException();
    id(actor.id, 'operatorId');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          // First DB operation is the shop mutex, shared by booking lifecycle.
          await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`;
          const shop = await this.authorize(tx, shopId, actor, true);
          return callback(tx, shop);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if (!isRetryableTransactionError(error)) throw error;
        if (attempt === 2) throw new ServiceUnavailableException('日历操作暂时冲突，请使用原操作编号查询结果');
      }
    }
    throw new ServiceUnavailableException('请查询原操作结果后再继续');
  }
  private receiptWhere(shopId: bigint, actor: Actor, requestKey: string) {
    return { shopId_operatorId_requestKey: { shopId, operatorId: id(actor.id), requestKey } };
  }
  private view(row: any): CalendarActionResult | { shopId: string; requestKey: string; outcome: 'NOT_EXECUTED' } {
    if (row.outcome === 'NOT_EXECUTED') return { shopId: String(row.shopId), requestKey: row.requestKey, outcome: 'NOT_EXECUTED' };
    return { shopId: String(row.shopId), requestKey: row.requestKey, action: row.action, outcome: 'COMMITTED',
      result: { blockId: row.blockId == null ? null : String(row.blockId), version: row.blockVersion ?? null, closedDate: row.closedDate ?? null } };
  }
  async options(shopId: string, actor: Actor, raw: unknown) {
    const query = object(raw, ['date']), date = calendarDate(query.date), sid = id(shopId, 'shopId');
    const shop = await this.authorize(this.prisma, sid, actor);
    this.timezone(shop);
    calendarDayBoundary(date, shop.timezone);
    const [therapists, rooms] = await Promise.all([
      this.prisma.therapist.findMany({ where: { shopId: sid, isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.shopRoom.findMany({ where: { shopId: sid, isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    ]);
    const settings = readShopBookingSettings(shop.studioProfile), temporaryClosure = settings.closedPeriods.find(period => date >= period.startDate && date <= period.endDate) ?? null;
    return { shopId, date, timezone: shop.timezone, settingsHash: calendarSettingsHash(shop), closed: temporaryClosure !== null, temporaryClosure,
      resources: [...therapists.map(row => ({ type: 'THERAPIST', id: String(row.id), name: row.name })), ...rooms.map(row => ({ type: 'ROOM', id: String(row.id), name: row.name }))] };
  }
  async block(shopId: string, actor: Actor, blockId: string) {
    const sid = id(shopId, 'shopId'), bid = id(blockId, 'blockId');
    await this.authorize(this.prisma, sid, actor);
    const row = await this.prisma.shopCalendarBlock.findFirst({ where: { id: bid, shopId: sid }, include: { operator: { select: { id: true, name: true } } } });
    if (!row) throw new NotFoundException('区间不存在或不属于当前门店');
    return { id: String(row.id), shopId, scope: row.scope, resourceId: row.resourceId == null ? null : String(row.resourceId), purpose: row.purpose,
      startAt: row.startAtUtc.toISOString(), endAt: row.endAtUtc.toISOString(), timezone: row.timezone, reason: row.reason, status: row.status,
      version: row.version, operator: { id: String(row.operator.id), name: row.operator.name } };
  }
  async receipt(shopId: string, actor: Actor, key: string) {
    const sid = id(shopId, 'shopId'), requestKey = calendarActionKey(key);
    await this.authorize(this.prisma, sid, actor);
    const row = await this.prisma.calendarActionReceipt.findUnique({ where: this.receiptWhere(sid, actor, requestKey) });
    return row ? this.view(row) : { shopId, requestKey, outcome: 'NOT_FOUND' as const };
  }
  reconcile(shopId: string, actor: Actor, key: string, raw: unknown = {}) {
    object(raw ?? {}, []);
    const sid = id(shopId, 'shopId'), requestKey = calendarActionKey(key);
    return this.write(sid, actor, async tx => {
      const previous = await tx.calendarActionReceipt.findUnique({ where: this.receiptWhere(sid, actor, requestKey) });
      if (previous) return this.view(previous);
      // A durable fence makes NOT_EXECUTED definitive even if the original
      // request was delayed before acquiring the same shop mutex.
      const row = await tx.calendarActionReceipt.create({ data: { shopId: sid, operatorId: id(actor.id), requestKey,
        requestHash: createHash('sha256').update('calendar-action-reconcile-fence').digest('hex'), action: 'RECONCILE', outcome: 'NOT_EXECUTED' } });
      return this.view(row);
    });
  }
  execute(shopId: string, actor: Actor, raw: unknown) {
    const sid = id(shopId, 'shopId'), command = parseCalendarAction(raw);
    return this.write(sid, actor, async (tx, shop) => {
      const previous = await tx.calendarActionReceipt.findUnique({ where: this.receiptWhere(sid, actor, command.requestKey) });
      if (previous) {
        if (previous.outcome === 'NOT_EXECUTED') throw new ConflictException('原操作已确认未执行，请使用新的操作编号');
        if (previous.requestHash !== command.requestHash) throw new ConflictException('操作编号已用于其他内容，请先查询原操作结果');
        return this.view(previous);
      }
      this.timezone(shop, command.expectedTimezone);
      let result: { blockId: bigint | null; blockVersion: number | null; closedDate: string | null };
      if (command.action === 'CLOSE_DAY') result = await this.closeDay(tx, shop, actor, command);
      else if (command.action === 'REOPEN_DAY') result = await this.reopenDay(tx, shop, actor, command);
      else result = await this.changeBlock(tx, shop, actor, command);
      const receipt = await tx.calendarActionReceipt.create({ data: { shopId: sid, operatorId: id(actor.id), requestKey: command.requestKey,
        requestHash: command.requestHash, action: command.action, outcome: 'COMMITTED', ...result } });
      return this.view(receipt);
    });
  }
  private timezone(shop: any, expected?: string) {
    if (!shop.timezone) throw new ConflictException('请先完善门店时区');
    try { new Intl.DateTimeFormat('en-US', { timeZone: shop.timezone }).format(); } catch { throw new ConflictException('请先完善门店时区'); }
    if (expected !== undefined && expected !== shop.timezone) throw new ConflictException('门店时区已变化，请重新加载后确认');
  }
  private async closeDay(tx: any, shop: any, actor: Actor, command: ParsedCalendarAction) {
    if (command.expectedSettingsHash !== calendarSettingsHash(shop)) throw new ConflictException('闭店设置已更新，请重新加载后确认');
    const date = command.date!, settings = readShopBookingSettings(shop.studioProfile), next = closeCalendarDate(settings, date);
    const startAtUtc = calendarDayBoundary(date, shop.timezone), endAtUtc = calendarDayBoundary(addCalendarDays(date, 1), shop.timezone);
    if (!isShopClosedOnDate(settings, date)) {
      await ensureShopBookingSettings(tx, shop, next);
      await ensureCalendarBlockAvailable(tx, shop, 'SHOP', null, { startAtUtc, endAtUtc }, undefined, true);
      await tx.shop.update({ where: { id: shop.id }, data: { studioProfile: { ...storedStudioProfile(shop.studioProfile), bookingSettings: next } } });
      await configurationAudit(tx, actor, 'SHOP_BOOKING_SETTINGS', shop.id, 'CALENDAR_CLOSE_DAY', ['closedPeriods']);
    }
    return { blockId: null, blockVersion: null, closedDate: date };
  }
  private async reopenDay(tx: any, shop: any, actor: Actor, command: ParsedCalendarAction) {
    if (command.expectedSettingsHash !== calendarSettingsHash(shop)) throw new ConflictException('闭店设置已更新，请重新加载后确认');
    const date = command.date!, settings = readShopBookingSettings(shop.studioProfile);
    if (isShopClosedOnDate(settings, date)) {
      const next = reopenCalendarDate(settings, date);
      await ensureShopBookingSettings(tx, shop, next);
      await tx.shop.update({ where: { id: shop.id }, data: { studioProfile: { ...storedStudioProfile(shop.studioProfile), bookingSettings: next } } });
      await configurationAudit(tx, actor, 'SHOP_BOOKING_SETTINGS', shop.id, 'CALENDAR_REOPEN_DAY', ['closedPeriods']);
    }
    // The existing receipt column records the processed date for either date
    // action. It is immutable operation evidence, not current availability.
    return { blockId: null, blockVersion: null, closedDate: date };
  }
  private async managedSource(tx: any, shop: any, row: any) {
    if (row.scope === 'THERAPIST') {
      if (row.resourceId == null || row.maintenanceId != null) throw new ConflictException('技师占用资料不一致，请先核对配置');
      const source = row.timeOffId && await tx.therapistTimeOff.findFirst({ where: { id: row.timeOffId, therapistId: row.resourceId, therapist: { shopId: shop.id } } });
      if (!source || source.startAtUtc.getTime() !== row.startAtUtc.getTime() || source.endAtUtc.getTime() !== row.endAtUtc.getTime() || source.reason !== row.reason) throw new ConflictException('技师占用资料不一致，请先核对配置');
    } else if (row.scope === 'ROOM') {
      if (row.resourceId == null || row.timeOffId != null) throw new ConflictException('场地占用资料不一致，请先核对配置');
      const source = row.maintenanceId && await tx.roomMaintenance.findFirst({ where: { id: row.maintenanceId, roomId: row.resourceId, room: { shopId: shop.id } } });
      if (!source || source.startAtUtc.getTime() !== row.startAtUtc.getTime() || source.endAtUtc.getTime() !== row.endAtUtc.getTime() || source.reason !== row.reason) throw new ConflictException('场地占用资料不一致，请先核对配置');
    } else if (row.scope !== 'SHOP' || row.resourceId != null || row.timeOffId != null || row.maintenanceId != null) throw new ConflictException('全店占用资料不一致，请先核对配置');
  }
  private async changeBlock(tx: any, shop: any, actor: Actor, command: ParsedCalendarAction) {
    const previous = command.blockId ? await tx.shopCalendarBlock.findFirst({ where: { id: id(command.blockId), shopId: shop.id } }) : null;
    if (command.blockId && !previous) throw new NotFoundException('区间不存在或不属于当前门店');
    if (previous && (previous.status !== 'ACTIVE' || previous.version !== command.expectedVersion)) throw new ConflictException('区间已修改或解除，请重新加载');
    if (previous) await this.managedSource(tx, shop, previous);
    if (command.action === 'RELEASE') {
      const updated = await tx.shopCalendarBlock.updateMany({ where: { id: previous.id, shopId: shop.id, version: command.expectedVersion, status: 'ACTIVE' },
        data: { status: 'RELEASED', version: { increment: 1 }, operatorId: id(actor.id), timeOffId: null, maintenanceId: null } });
      if (updated.count !== 1) throw new ConflictException('区间已更新，请重新加载');
      if (previous.timeOffId != null) await tx.therapistTimeOff.delete({ where: { id: previous.timeOffId } });
      if (previous.maintenanceId != null) await tx.roomMaintenance.delete({ where: { id: previous.maintenanceId } });
      await configurationAudit(tx, actor, 'SHOP_CALENDAR_BLOCK', previous.id, `CALENDAR_RELEASE_${previous.purpose}`, ['status', 'version']);
      return { blockId: previous.id, blockVersion: previous.version + 1, closedDate: null };
    }
    const scope = command.scope!, resourceId = command.resourceId ? id(command.resourceId) : null;
    if (previous && (previous.scope !== scope || String(previous.resourceId) !== String(resourceId))) throw new BadRequestException('修改时不能更换占用范围，请先解除再新建');
    if (scope !== 'SHOP') {
      const model = scope === 'THERAPIST' ? tx.therapist : tx.shopRoom;
      if (!await model.findFirst({ where: { id: resourceId, shopId: shop.id, isActive: true }, select: { id: true } })) throw new NotFoundException('资源不存在、已停用或不属于当前门店');
    }
    const startAtUtc = localInstant(command.startLocal!.slice(0, 10), command.startLocal!.slice(11), shop.timezone);
    const endAtUtc = localInstant(command.endLocal!.slice(0, 10), command.endLocal!.slice(11), shop.timezone);
    if (endAtUtc <= startAtUtc) throw new BadRequestException('结束时间必须晚于开始时间');
    await ensureCalendarBlockAvailable(tx, shop, scope, resourceId, { startAtUtc, endAtUtc }, previous);
    const sourceData = { startAtUtc, endAtUtc, reason: command.reason! };
    let timeOffId = previous?.timeOffId ?? null, maintenanceId = previous?.maintenanceId ?? null;
    if (scope === 'THERAPIST') timeOffId = (previous ? await tx.therapistTimeOff.update({ where: { id: timeOffId }, data: sourceData })
      : await tx.therapistTimeOff.create({ data: { therapistId: resourceId, ...sourceData } })).id;
    if (scope === 'ROOM') maintenanceId = (previous ? await tx.roomMaintenance.update({ where: { id: maintenanceId }, data: sourceData })
      : await tx.roomMaintenance.create({ data: { roomId: resourceId, ...sourceData } })).id;
    const data = { ...sourceData, scope, resourceId, purpose: command.purpose!, timezone: shop.timezone, operatorId: id(actor.id), timeOffId, maintenanceId };
    let block: any;
    if (previous) {
      const updated = await tx.shopCalendarBlock.updateMany({ where: { id: previous.id, shopId: shop.id, version: command.expectedVersion, status: 'ACTIVE' }, data: { ...data, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('区间已更新，请重新加载');
      block = { id: previous.id, version: previous.version + 1 };
    } else block = await tx.shopCalendarBlock.create({ data: { ...data, shopId: shop.id, status: 'ACTIVE', version: 1 } });
    await configurationAudit(tx, actor, 'SHOP_CALENDAR_BLOCK', block.id, `CALENDAR_${command.action}_${command.purpose}`, ['scope', 'purpose', 'startAtUtc', 'endAtUtc', 'reason', 'version']);
    return { blockId: block.id, blockVersion: block.version, closedDate: null };
  }
}
