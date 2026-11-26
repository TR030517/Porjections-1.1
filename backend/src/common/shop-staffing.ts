import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { requireShopAccess, shopAccessId, type ShopActor, type ShopPermission } from './shop-access';
import { SHOP_SERVICE_ACCESS_MODE } from './shop-staff-policy';
import { readScheduleMode } from '../modules/booking/work-schedule';
import { effectiveBookingWhere, resourceBookingWhere } from '../modules/reservations/configuration-guard';

export const STAFFING_LIMITS = { target: 100, records: 1000 } as const;
const STAFF_SELECT = { id: true, shopId: true, name: true, avatarUrl: true, title: true, bio: true, yearsExp: true,
  gender: true, isActive: true, scheduleMode: true, sortOrder: true, updatedAt: true };
export interface StaffingTherapist {
  id: string; shopId: string; name: string; avatarUrl: string | null; title: string | null; bio: string | null;
  yearsExp: number; gender: string | null; isActive: boolean; scheduleMode: 'SHOP' | 'CUSTOM'; sortOrder: number;
}
export interface ShopStaffing {
  shopId: string; activeCount: number; revision: string; serviceAccessMode: typeof SHOP_SERVICE_ACCESS_MODE;
  canManageStaff: boolean; canManageExceptions: boolean; therapists: StaffingTherapist[];
}
export interface StaffingTarget { targetActiveCount: number; expectedRevision: string; }

export function staffingTarget(raw: unknown): StaffingTarget {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2
    || Object.keys(raw).some(key => !['targetActiveCount', 'expectedRevision'].includes(key))) throw new BadRequestException('请提供目标在岗人数和当前人员版本');
  const value = raw as Record<string, unknown>;
  if (typeof value.targetActiveCount !== 'number' || !Number.isSafeInteger(value.targetActiveCount)
    || value.targetActiveCount < 0 || value.targetActiveCount > STAFFING_LIMITS.target) throw new BadRequestException('目标在岗人数须为0至100的整数');
  if (typeof value.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedRevision)) throw new BadRequestException('请重新读取当前人员版本');
  return { targetActiveCount: value.targetActiveCount, expectedRevision: value.expectedRevision };
}

function actorId(actor: ShopActor) {
  if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException('当前账号不可管理本店技师');
  return shopAccessId(actor.id);
}
async function staffRows(tx: any, shopId: bigint): Promise<any[]> {
  const rows = await tx.therapist.findMany({ where: { shopId }, select: STAFF_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: STAFFING_LIMITS.records + 1 });
  if (rows.length > STAFFING_LIMITS.records) throw new ServiceUnavailableException('本店人员记录超过人数快捷配置上限，请使用单人管理');
  return rows;
}
function snapshot(shopId: bigint, rows: any[], permissions: ShopPermission[]): ShopStaffing {
  const therapists: StaffingTherapist[] = rows.map(row => ({ id: String(row.id), shopId: String(row.shopId), name: row.name,
    avatarUrl: row.avatarUrl ?? null, title: row.title ?? null, bio: row.bio ?? null, yearsExp: row.yearsExp,
    gender: row.gender ?? null, isActive: row.isActive === true, scheduleMode: readScheduleMode(row.scheduleMode), sortOrder: row.sortOrder }));
  const revision = createHash('sha256').update(JSON.stringify({ shopId: String(shopId),
    therapists: therapists.map((row, index) => ({ ...row, updatedAt: rows[index].updatedAt?.toISOString() ?? null })) })).digest('hex');
  return { shopId: String(shopId), activeCount: therapists.filter(row => row.isActive).length, revision,
    serviceAccessMode: SHOP_SERVICE_ACCESS_MODE, canManageStaff: permissions.includes('CATALOG_MANAGE'),
    canManageExceptions: permissions.includes('RESERVATION_CONFIG'), therapists };
}

async function readAccess(tx: any, shopId: bigint, actor: ShopActor) {
  try { return await requireShopAccess(tx, shopId, actor, 'CATALOG_MANAGE'); }
  catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
  return requireShopAccess(tx, shopId, actor, 'RESERVATION_CONFIG');
}

/** Same safe profile fields as single-person management, without account or booking data. */
export async function readShopStaffing(db: any, shopId: string, actor: ShopActor): Promise<ShopStaffing> {
  actorId(actor); const sid = shopAccessId(shopId);
  return db.$transaction(async (tx: any) => {
    const access = await readAccess(tx, sid, actor);
    return snapshot(sid, await staffRows(tx, sid), access.permissions);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Only clearly expired wholly unpaid holds can be ignored. Terminal ACTIVE
 * cleanup and legacy unassigned reservations retain the existing pool fence. */
async function occupiedStaff(tx: any, shopId: bigint, active: any[], now: Date): Promise<Set<string>> {
  const ids = active.map(row => row.id);
  if (!ids.length) return new Set();
  const locks = await tx.bookingResourceLock.findMany({ where: { shopId, resourceType: 'THERAPIST', resourceId: { in: ids },
    status: 'ACTIVE', endAtUtc: { gt: now }, booking: resourceBookingWhere(now) }, select: { resourceId: true } });
  const legacy = await tx.booking.findMany({ where: { shopId, ...effectiveBookingWhere(now), endTime: { gt: now }, items: { none: {} },
    AND: [{ OR: [{ therapistId: { in: ids } }, { therapistId: null }] }] }, select: { therapistId: true } });
  if (legacy.some((row: any) => row.therapistId === null)) return new Set(ids.map(String));
  return new Set([...locks.map((row: any) => String(row.resourceId)), ...legacy.map((row: any) => String(row.therapistId))]);
}

/** Target + collection CAS is deliberate: a lost acknowledgement must be read
 * back, not retried against a fresh version with another personnel selection. */
export async function setShopStaffing(db: any, shopId: string, actor: ShopActor, raw: unknown): Promise<ShopStaffing & { createdIds: string[]; deactivatedIds: string[] }> {
  const operatorId = actorId(actor), sid = shopAccessId(shopId), input = staffingTarget(raw);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx: any) => {
        // Shared with all reservation/configuration writers; always lock shop first.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${sid} FOR UPDATE`);
        const access = await requireShopAccess(tx, sid, actor, 'CATALOG_MANAGE', { write: true });
        const rows = await staffRows(tx, sid), before = snapshot(sid, rows, access.permissions);
        if (before.revision !== input.expectedRevision) throw new ConflictException({ code: 'STAFFING_CHANGED',
          message: '本店人员已变更，请保留目标人数，重新读取并核对后再保存', fields: { expectedRevision: '人员版本已变更，请重新核对' } });
        const active = rows.filter(row => row.isActive === true), difference = input.targetActiveCount - active.length;
        const createdIds: string[] = [], deactivatedIds: string[] = [];
        if (difference < 0) {
          const busy = await occupiedStaff(tx, sid, active, new Date());
          const candidates = [...active].reverse().filter(row => !busy.has(String(row.id))).slice(0, -difference);
          if (candidates.length < -difference) {
            const occupied = active.filter(row => busy.has(String(row.id)));
            throw new ConflictException({ code: 'STAFFING_BUSY', message: '可安全停用的人数不足，请先处理这些技师的有效预约或收尾占用：'
              + occupied.slice(0, 10).map(row => row.name).join('、') + (occupied.length > 10 ? '等' : ''),
              fields: Object.fromEntries(occupied.map(row => [String(row.id), '该技师仍有有效预约或收尾占用，不能停用'])) });
          }
          // Select the entire safe batch before the first write.
          for (const row of candidates) {
            await tx.therapist.update({ where: { id: row.id }, data: { isActive: false } }); deactivatedIds.push(String(row.id));
          }
        } else if (difference > 0) {
          if (rows.length + difference > STAFFING_LIMITS.records) throw new ConflictException('本店人员历史记录已达快捷配置上限，请使用单人管理');
          // Deactivated personnel may have deliberate CUSTOM schedules or leave;
          // never resurrect or overwrite them as an implicit count adjustment.
          const names = new Set(rows.map(row => row.name)); let number = 1;
          let order = Math.min(10000, Math.max(0, ...rows.map(row => row.sortOrder)) + 1);
          for (let index = 0; index < difference; index++) {
            while (names.has('Therapist ' + number)) number++;
            const name = 'Therapist ' + number++; names.add(name);
            const row = await tx.therapist.create({ data: { shopId: sid, name, avatarUrl: null, title: null, bio: null,
              yearsExp: 0, gender: null, scheduleMode: 'SHOP', isActive: true, sortOrder: order } });
            order = Math.min(10000, order + 1); createdIds.push(String(row.id));
          }
        }
        if (difference !== 0) await tx.auditLog.create({ data: { operatorId, action: 'SET_ACTIVE_COUNT', targetType: 'SHOP_STAFFING', targetId: sid,
          detail: { previousActiveCount: active.length, targetActiveCount: input.targetActiveCount, createdIds, deactivatedIds } } });
        return { ...snapshot(sid, difference === 0 ? rows : await staffRows(tx, sid), access.permissions), createdIds, deactivatedIds };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if ((error as any)?.code !== 'P2034') throw error;
      if (attempt === 2) throw new ServiceUnavailableException('人员配置写入冲突，请重新读取并核对');
    }
  }
  throw new ServiceUnavailableException('请稍后重试');
}
