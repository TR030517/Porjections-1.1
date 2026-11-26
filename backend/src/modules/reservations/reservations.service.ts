import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { coveredByShifts, effectiveWeeklyShifts, readScheduleMode } from '../booking/work-schedule';
export { coveredByShifts } from '../booking/work-schedule';
import { normalizeHours } from '../booking/hours';
import { shopPaymentPolicy } from '../../common/shop-payment-policy';
import { requireShopAccess, type ShopPermission } from '../../common/shop-access';
import { storedStudioProfile } from '../../common/shop-studio-profile';
import { normalizeShopBookingSettings, readShopBookingSettings } from '../../common/shop-booking-settings';
import { shopBookingSettingsHash } from '../../common/shop-booking-settings-revision';
import { effectiveBookingWhere, resourceBookingWhere, ensureShopConfiguration, ensureShopBookingSettings } from './configuration-guard';
import { Actor, id, object, POLICY_FIELDS, ROOM_FIELDS, SHIFT_FIELDS, VARIANT_FIELDS, WINDOW_FIELDS, policyInput, roomInput, serialize, shiftInput, variantInput, windowInput } from './reservation-validation';
import { SERVICE_ADDON_FIELDS, serviceAddOnInput } from './service-addons';
import { hasServiceVariants, serviceDisplaySource } from '../../common/service-reservation-options';
import { readDurationKind, serviceDurationMeta } from '../../common/service-duration';
import { readMenuCatalog } from '../../common/menu-catalog-reader';
import { readProjectCatalog } from '../../common/project-catalog-reader';
import { SHOP_SERVICE_ACCESS_MODE } from '../../common/shop-staff-policy';
import { readShopStaffing, setShopStaffing } from '../../common/shop-staffing';
import { bookingOrderPolicy } from '../../common/order-mode';
import { isRetryableTransactionError } from '../../common/transaction-retry';

type Kind = 'variants' | 'shifts' | 'time-off' | 'rooms' | 'maintenance';
type Window = { startAtUtc: Date; endAtUtc: Date };
const RESOURCES = {
  variants: { model: 'shopServiceVariant', fields: VARIANT_FIELDS, parent: 'serviceId', target: 'SERVICE_VARIANT' },
  shifts: { model: 'therapistShift', fields: SHIFT_FIELDS, parent: 'therapistId', target: 'THERAPIST_SHIFT' },
  'time-off': { model: 'therapistTimeOff', fields: WINDOW_FIELDS, parent: 'therapistId', target: 'THERAPIST_TIME_OFF' },
  rooms: { model: 'shopRoom', fields: ROOM_FIELDS, parent: '', target: 'SHOP_ROOM' },
  maintenance: { model: 'roomMaintenance', fields: WINDOW_FIELDS, parent: 'roomId', target: 'ROOM_MAINTENANCE' },
} as const;

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  menuCatalog(shopId: string, actor: Actor, query: unknown) {
    return readMenuCatalog(this.prisma, shopId, actor, query);
  }

  projectCatalog(shopId: string, actor: Actor, query: unknown) {
    return readProjectCatalog(this.prisma, shopId, actor, query);
  }

  staffing(shopId: string, actor: Actor) {
    return readShopStaffing(this.prisma, shopId, actor);
  }

  setStaffing(shopId: string, actor: Actor, input: unknown) {
    return setShopStaffing(this.prisma, shopId, actor, input);
  }

  private async authorize(db: any, shopId: bigint, actor: Actor, write = false, permission: ShopPermission = 'RESERVATION_CONFIG') {
    return (await requireShopAccess(db, shopId, actor, permission, {write})).shop;
  }

  private async write<T>(shopId: string, actor: Actor, callback: (tx: any, shop: any) => Promise<T>, permission: ShopPermission = 'RESERVATION_CONFIG'): Promise<T> {
    const sid = id(shopId, 'shopId');
    if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException();
    id(actor.id, 'operatorId');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          // First database read: stable shop mutex, shared with reservation lifecycle.
          await tx.$queryRaw`SELECT id FROM shops WHERE id = ${sid} FOR UPDATE`;
          const shop = await this.authorize(tx, sid, actor, true, permission);
          return callback(tx, shop);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if (!isRetryableTransactionError(error)) throw error;
        if (attempt === 2) throw new ServiceUnavailableException('配置写入冲突，请稍后重试');
      }
    }
    throw new ServiceUnavailableException('请稍后重试');
  }

  async config(shopId: string, actor: Actor) {
    const sid = id(shopId, 'shopId');
    const shop = await this.authorize(this.prisma, sid, actor);
    const [services, therapists, rooms] = await Promise.all([
      this.prisma.shopService.findMany({ where: { shopId: sid }, select: {
        id: true, shopId: true, name: true, isActive: true, durationKind: true, durationMin: true, priceCents: true, priceBasis: true,
        participantCount: true, requiredStaffCount: true, requiredRoomType: true, staffBufferMin: true, roomBufferMin: true,
        variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        addOns: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.therapist.findMany({ where: { shopId: sid }, select: {
        id: true, shopId: true, name: true, isActive: true, scheduleMode: true,
        therapistServices: { select: { serviceId: true } },
        shifts: { orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }, { id: 'asc' }] },
        timeOff: { orderBy: [{ startAtUtc: 'asc' }, { id: 'asc' }] },
      }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.shopRoom.findMany({ where: { shopId: sid }, include: { maintenance: { orderBy: [{ startAtUtc: 'asc' }, { id: 'asc' }] } }, orderBy: { id: 'asc' } }),
    ]);
    return serialize({ ...bookingOrderPolicy(), shopId: sid, serviceAccessMode: SHOP_SERVICE_ACCESS_MODE, timezone: shop.timezone, businessHours: shop.businessHours, bookingSettings: readShopBookingSettings(shop.studioProfile), bookingSettingsHash: shopBookingSettingsHash(shop), paymentPolicy: shopPaymentPolicy(shop.studioProfile), services: services.map(service => { const display = serviceDisplaySource(service); return { ...service, durationMin: display.durationMin, hasVariants: hasServiceVariants(service), ...serviceDurationMeta(display), variants: service.variants.map(variant => ({ ...variant, ...serviceDurationMeta({ ...variant, durationKind: readDurationKind(service.durationKind) }) })) }; }),
      therapists: therapists.map(({ therapistServices, ...therapist }) => ({ ...therapist, serviceAccessMode: SHOP_SERVICE_ACCESS_MODE, serviceIds: therapistServices.map(link => link.serviceId) })), rooms });
  }

  async bookingSettingsView(shopId: string, actor: Actor) {
    const sid = id(shopId, 'shopId');
    const shop = await this.authorize(this.prisma, sid, actor);
    return serialize({ shopId: sid, bookingSettings: readShopBookingSettings(shop.studioProfile), bookingSettingsHash: shopBookingSettingsHash(shop) });
  }

  bookingSettings(shopId: string, actor: Actor, raw: unknown) {
    const input = object(raw, ['minimumNoticeMinutes', 'closedPeriods', 'expectedSettingsHash']);
    if (typeof input.expectedSettingsHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedSettingsHash)) throw new BadRequestException('请重新加载预约设置版本');
    let settings: ReturnType<typeof normalizeShopBookingSettings>;
    try { settings = normalizeShopBookingSettings({ minimumNoticeMinutes: input.minimumNoticeMinutes, closedPeriods: input.closedPeriods }); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '预约设置无效'); }
    return this.write(shopId, actor, async (tx, shop) => {
      if (input.expectedSettingsHash !== shopBookingSettingsHash(shop)) throw new ConflictException('预约设置已更新，请重新加载后确认，避免覆盖其他修改');
      const profile = storedStudioProfile(shop.studioProfile);
      await ensureShopBookingSettings(tx, shop, settings);
      await tx.shop.update({ where: { id: shop.id }, data: { studioProfile: { ...profile, bookingSettings: settings } } });
      await this.audit(tx, actor, 'UPDATE', 'SHOP_BOOKING_SETTINGS', shop.id, ['minimumNoticeMinutes', 'closedPeriods']);
      return { item: { shopId: shop.id.toString(), bookingSettings: settings, bookingSettingsHash: shopBookingSettingsHash({ ...shop, studioProfile: { ...profile, bookingSettings: settings } }) } };
    });
  }

  private async audit(tx: any, actor: Actor, action: string, targetType: string, targetId: bigint, fields: string[], reason?: string | null) {
    await tx.auditLog.create({ data: { operatorId: id(actor.id), action, targetType, targetId,
      // Only field names and a fixed reason marker; never persist raw DTO or a personal leave reason.
      detail: { fields, ...(reason ? { reason: 'recorded' } : {}) } } });
  }

  /** Separate, zero-time extras. Existing bookings keep their own saved prices. */
  async mutateAddOn(shopId: string, actor: Actor, raw: unknown, addOnId?: string, remove = false) {
    const rid=addOnId===undefined?undefined:id(addOnId,'addOnId');
    const input=object(raw,remove?[]:[...SERVICE_ADDON_FIELDS,...(!rid?['serviceId']:[])]);
    if(rid&&!remove&&!Object.keys(input).length)throw new BadRequestException('请提供要修改的附加项目字段');
    return this.write(shopId,actor,async(tx,shop)=>{
      const previous=rid?await tx.shopServiceAddOn.findFirst({where:{id:rid,service:{shopId:shop.id}}}):null;
      if(rid&&!previous)throw new NotFoundException('附加项目不存在或不属于当前门店');
      const serviceId=previous?.serviceId??id(input.serviceId,'serviceId');
      const service=await tx.shopService.findFirst({where:{id:serviceId,shopId:shop.id}});
      if(!service)throw new NotFoundException('主服务不存在或不属于当前门店');
      if(!rid&&await tx.shopServiceAddOn.count({where:{serviceId}})>=50)throw new ConflictException('每个主服务最多50个附加项目，请编辑已有配置');
      const data=serviceAddOnInput({description:null,isActive:false,currency:'usd',sortOrder:0,...previous,...input,...(remove?{isActive:false}:{})});
      const row=rid?await tx.shopServiceAddOn.update({where:{id:rid},data}):await tx.shopServiceAddOn.create({data:{...data,serviceId}});
      await this.audit(tx,actor,remove?'DISABLE':rid?'UPDATE':'CREATE','SERVICE_ADDON',row.id,remove?['isActive']:Object.keys(input).filter(field=>field!=='serviceId'));
      return remove?{success:true}:{item:serialize(row)};
    }, 'CATALOG_MANAGE');
  }

  async paymentPolicy(shopId: string, actor: Actor, input: { payAtStoreEnabled: boolean }) {
    if (typeof input.payAtStoreEnabled !== 'boolean') throw new BadRequestException('payAtStoreEnabled must be boolean');
    return this.write(shopId, actor, async (tx, shop) => {
      await requireShopAccess(tx, shop.id, actor, 'OWNER_ONLY', { write: true });
      let profile: Record<string, any>;
      try { profile = storedStudioProfile(shop.studioProfile); }
      catch { throw new ConflictException('Stored shop profile is malformed; repair it before editing'); }
      const policy = profile.paymentPolicy && typeof profile.paymentPolicy === 'object' && !Array.isArray(profile.paymentPolicy) ? profile.paymentPolicy : {};
      await tx.shop.update({ where: { id: shop.id }, data: { studioProfile: { ...profile, paymentPolicy: { ...policy, payAtStoreEnabled: input.payAtStoreEnabled } } } });
      await this.audit(tx, actor, 'SHOP_PAYMENT_POLICY', 'SHOP', shop.id, ['payAtStoreEnabled']);
      return { paymentPolicy: { payAtStoreEnabled: input.payAtStoreEnabled } };
    });
  }

  private async parent(tx: any, kind: Kind, parentId: bigint, shopId: bigint) {
    const model = kind === 'variants' ? tx.shopService : kind === 'maintenance' ? tx.shopRoom : tx.therapist;
    const parent = await model.findFirst({ where: { id: parentId, shopId } });
    if (!parent) throw new NotFoundException('关联资源不存在或不属于当前门店');
    return parent;
  }

  private async current(tx: any, kind: Kind, resourceId: bigint, shopId: bigint) {
    const scope = kind === 'rooms' ? { shopId } : kind === 'variants' ? { service: { shopId } } : kind === 'maintenance' ? { room: { shopId } } : { therapist: { shopId } };
    const result = await tx[RESOURCES[kind].model].findFirst({ where: { id: resourceId, ...scope } });
    if (!result) throw new NotFoundException('配置不存在或不属于当前门店');
    return result;
  }

  /** Legacy bookings without item/resource assignments remain conservative blockers.
   * Never fabricate an assignment to make a configuration update pass. */
  private async occupied(tx: any, shopId: bigint, resourceType: 'THERAPIST' | 'ROOM', resourceId: bigint, window?: Window): Promise<Window[]> {
    const now = new Date();
    const overlap = window ? { startAtUtc: { lt: window.endAtUtc }, endAtUtc: { gt: window.startAtUtc, ...(window.startAtUtc < now ? { gt: now } : {}) } } : { endAtUtc: { gt: now } };
    const locks = await tx.bookingResourceLock.findMany({ where: { shopId, resourceType, resourceId, status: 'ACTIVE', ...overlap,
      booking: resourceBookingWhere(now) }, select: { startAtUtc: true, endAtUtc: true } });
    const legacy = await tx.booking.findMany({ where: { shopId, ...effectiveBookingWhere(), items: { none: {} }, endTime: { gt: now },
      ...(window ? { startTime: { lt: window.endAtUtc }, endTime: { gt: new Date(Math.max(window.startAtUtc.getTime(), now.getTime())) } } : {}),
      ...(resourceType === 'THERAPIST' ? { AND: [{ OR: [{ therapistId: resourceId }, { therapistId: null }] }] } : {}),
    }, select: { startTime: true, endTime: true } });
    return [...locks, ...legacy.map((row: any) => ({ startAtUtc: row.startTime, endAtUtc: row.endTime }))];
  }

  private async validateChange(tx: any, shop: any, kind: Kind, previous: any, data: any, resourceId?: bigint, parentResource?: any) {
    if (kind === 'variants') {
      if (previous && (previous.durationMin !== data.durationMin || previous.currency !== data.currency || previous.isActive === true && data.isActive === false)) {
        const used = await tx.bookingItem.findFirst({ where: { variantId: previous.id, booking: { shopId: shop.id, ...effectiveBookingWhere(), endTime: { gt: new Date() } } }, select: { id: true } });
        if (used) throw new ConflictException('规格仍有未来预约；请新建规格，保留原规格供已有订单使用');
      }
      return;
    }
    if (kind === 'shifts') {
      const therapistId = previous?.therapistId ?? data.therapistId;
      const shifts = await tx.therapistShift.findMany({ where: { therapistId, ...(resourceId ? { id: { not: resourceId } } : {}) } });
      if (data.isActive && shifts.some((s: any) => s.isActive && s.weekday === data.weekday && s.startMin < data.endMin && s.endMin > data.startMin)) throw new ConflictException('同一技师的有效班次不能重叠');
      if (readScheduleMode(parentResource?.scheduleMode) === 'CUSTOM' && previous?.isActive && (previous.weekday !== data.weekday || previous.startMin !== data.startMin || previous.endMin !== data.endMin || !data.isActive)) {
        const windows = await this.occupied(tx, shop.id, 'THERAPIST', therapistId);
        if (windows.some(window => !coveredByShifts(window, shop.timezone, [...shifts, data]))) throw new ConflictException('班次调整会影响已有预约（含技师缓冲），请先处理预约');
      }
      return;
    }
    if (kind === 'rooms') {
      if (previous && (previous.roomType !== data.roomType || previous.capacity !== data.capacity || (previous.isActive && !data.isActive))) {
        if ((await this.occupied(tx, shop.id, 'ROOM', previous.id)).length) throw new ConflictException('房间或座位仍有未来占用，不能改变类型、容量或停用');
      }
      return;
    }
    const resourceType = kind === 'maintenance' ? 'ROOM' : 'THERAPIST';
    const parentId = kind === 'maintenance' ? (previous?.roomId ?? data.roomId) : (previous?.therapistId ?? data.therapistId);
    if ((await this.occupied(tx, shop.id, resourceType, parentId, data)).length) throw new ConflictException(kind === 'maintenance' ? '维护时段与已有预约占用冲突' : '休假时段与已有预约占用冲突');
  }

  async mutate(shopId: string, actor: Actor, kind: Kind, raw: unknown, resourceId?: string, remove = false) {
    if (!Object.prototype.hasOwnProperty.call(RESOURCES, kind)) throw new BadRequestException('未知预约配置');
    const specification = RESOURCES[kind];
    const rid = resourceId === undefined ? undefined : id(resourceId);
    const input = object(raw, remove ? [] : [...specification.fields, ...(!rid && specification.parent ? [specification.parent] : [])]);
    if (rid && !remove && Object.keys(input).length === 0) throw new BadRequestException('请提供要更新的字段');
    return this.write(shopId, actor, async (tx, shop) => {
      const model = tx[specification.model];
      const previous = rid ? await this.current(tx, kind, rid, shop.id) : null;
      if (rid && (kind === 'time-off' || kind === 'maintenance')) {
        const managed = await tx.shopCalendarBlock.findFirst({ where: { shopId: shop.id, status: 'ACTIVE',
          ...(kind === 'time-off' ? { timeOffId: rid } : { maintenanceId: rid }) }, select: { id: true } });
        if (managed) throw new ConflictException('此区间由预约日历管理，请在日历详情中修改或解除');
      }
      if (remove && (kind === 'time-off' || kind === 'maintenance')) {
        await model.delete({ where: { id: rid } });
        await this.audit(tx, actor, 'DELETE', specification.target, rid!, []);
        return { success: true };
      }
      let parentId: bigint | undefined, parentResource: any;
      if (specification.parent) {
        parentId = previous?.[specification.parent] ?? id(input[specification.parent], specification.parent);
        parentResource = await this.parent(tx, kind, parentId!, shop.id);
      }
      const merged: Record<string, unknown> = { isActive: true, sortOrder: 0, currency: 'usd', reason: null, ...previous, ...input,
        ...(remove ? { isActive: false } : {}) };
      let data: any;
      if (kind === 'variants') {
        if (Object.prototype.hasOwnProperty.call(input, 'priceBasis') && input.priceBasis !== 'PER_BOOKING') throw new BadRequestException('当前项目统一按整次订单总价计价');
        data = variantInput({ ...merged, priceBasis: 'PER_BOOKING' });
      }
      else if (kind === 'shifts') data = shiftInput(merged);
      else if (kind === 'rooms') data = roomInput(merged);
      else data = windowInput(merged);
      if (parentId && !rid) data[specification.parent] = parentId;
      if (kind === 'rooms' && !rid) data.shopId = shop.id;
      await this.validateChange(tx, shop, kind, previous, data, rid, parentResource);
      const item = rid ? await model.update({ where: { id: rid }, data }) : await model.create({ data });
      await this.audit(tx, actor, remove ? 'DISABLE' : rid ? 'UPDATE' : 'CREATE', specification.target, item.id,
        remove ? ['isActive'] : Object.keys(input).filter(field => field !== specification.parent), data.reason);
      return remove ? { success: true } : { item: serialize(kind === 'variants' ? { ...item, ...serviceDurationMeta({ ...item, durationKind: readDurationKind(parentResource.durationKind) }) } : item) };
    }, kind === 'variants' ? 'CATALOG_MANAGE' : 'RESERVATION_CONFIG');
  }

  /** Switch modes explicitly; saved personal shifts are retained while SHOP is active. */
  async schedule(shopId: string, therapistId: string, actor: Actor, raw: unknown) {
    const tid = id(therapistId, 'therapistId'), input = object(raw, ['scheduleMode']);
    if (input.scheduleMode !== 'SHOP' && input.scheduleMode !== 'CUSTOM') throw new BadRequestException('请选择跟随门店或个人排班');
    const scheduleMode = readScheduleMode(input.scheduleMode);
    return this.write(shopId, actor, async (tx, shop) => {
      const therapist = await tx.therapist.findFirst({ where: { id: tid, shopId: shop.id } });
      if (!therapist) throw new NotFoundException('技师不存在或不属于当前门店');
      const shifts = await tx.therapistShift.findMany({ where: { therapistId: tid } });
      const effective = effectiveWeeklyShifts(scheduleMode, shop.businessHours, shifts);
      const windows = await this.occupied(tx, shop.id, 'THERAPIST', tid);
      if (windows.some(window => !coveredByShifts(window, shop.timezone, effective))) throw new ConflictException('排班模式调整会影响已有预约（含技师缓冲），请先处理预约');
      const item = await tx.therapist.update({ where: { id: tid }, data: { scheduleMode } });
      await this.audit(tx, actor, 'UPDATE', 'THERAPIST_SCHEDULE', tid, ['scheduleMode']);
      return { item: serialize({ id: item.id, scheduleMode: item.scheduleMode }) };
    });
  }

  async hours(shopId: string, actor: Actor, raw: unknown) {
    const input = object(raw, ['businessHours']);
    const businessHours = normalizeHours(input.businessHours);
    return this.write(shopId, actor, async (tx, shop) => {
      await ensureShopConfiguration(tx, shop, { businessHours });
      const item = await tx.shop.update({ where: { id: shop.id }, data: { businessHours } });
      await this.audit(tx, actor, 'UPDATE', 'SHOP_HOURS', shop.id, ['businessHours']);
      return { item: serialize({ shopId: shop.id, timezone: shop.timezone, businessHours: item.businessHours }) };
    });
  }

  async policy(shopId: string, serviceId: string, actor: Actor, raw: unknown) {
    const sid = id(serviceId, 'serviceId'); const input = object(raw, POLICY_FIELDS);
    if (!Object.keys(input).length) throw new BadRequestException('请提供要更新的服务策略');
    return this.write(shopId, actor, async (tx, shop) => {
      const service = await tx.shopService.findFirst({ where: { id: sid, shopId: shop.id } });
      if (!service) throw new NotFoundException('服务不存在或不属于当前门店');
      const data = policyInput({ ...service, ...input });
      const resources = ['participantCount', 'requiredStaffCount', 'requiredRoomType', 'staffBufferMin', 'roomBufferMin'] as const;
      if (resources.some(field => service[field] !== data[field])) {
        const existing = await tx.booking.findFirst({ where: { shopId: shop.id, ...effectiveBookingWhere(), endTime: { gt: new Date() },
          AND: [{ OR: [{ serviceId: sid }, { items: { some: { serviceId: sid } } }] }] }, select: { id: true } });
        if (existing) throw new ConflictException('服务仍有未来预约，不能变更人数、房型或缓冲策略');
      }
      const item = await tx.shopService.update({ where: { id: sid }, data });
      await this.audit(tx, actor, 'UPDATE', 'SERVICE_POLICY', sid, Object.keys(input));
      return { item: serialize(item) };
    });
  }
}
