jest.mock('../auth/security', () => ({ jwtSecret: () => 'Synthetic-legacy-hours-copy-key-2035-0123456789abcdef' }));
import { BadRequestException, ConflictException } from '@nestjs/common';
import { openingIntervals, normalizeHours } from './hours';
import { effectiveWeeklyShifts } from './work-schedule';
import { allocate } from './availability';
import { BookingService } from './booking.service';
import { displayHours, hours as studioHours } from '../studio/validation';
import { shopPublication } from '../../common/shop-publication';
import { AccountCopyService } from '../account-copy/account-copy.service';

const hours = { monday: [{ open: '09:00', close: '12:00' }, { open: '13:00', close: '18:00' }], tuesday: { closed: true } };
const at = (time: string) => new Date('2035-01-01T' + time + ':00Z');
const shop = (id: bigint, businessHours: any) => ({ id, name: 'Synthetic store ' + id, shortName: 'synthetic-hours-' + id, timezone: 'UTC', businessHours,
  status: 'APPROVED', deletedAt: null, phone: '+12025550100', address: 'Synthetic address', city: 'Test City', state: 'NY',
  loginBinding: { userId: id + 10n, user: { id:id+10n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName:'synthetic-merchant', email:null, phone:null, passwordHash:'$2b$12$'+'A'.repeat(53) } } });
function copyFixture(sourceHours: any) {
  let saved: any = { shops: [shop(10n, sourceHours), shop(11n, { monday: { open: '09:00', close: '20:00' } })], operations: [], audits: [] };
  const writes: bigint[] = [], locks: bigint[] = [];
  const db: any = { $transaction: async (work: any) => {
    const stage = structuredClone(saved), tx: any = {
      $queryRaw: async (sql: any) => { if (sql.sql.includes('FROM shops')) locks.push(sql.values[0]); return []; },
      user: { findFirst: async ({ where }: any) => where.id === 1n && where.role === 'ADMIN' ? { id: 1n } : null },
      shop: {
        findFirst: async ({ where }: any) => stage.shops.find((row: any) => row.id === where.id) ?? null,
        update: async ({ where, data }: any) => { writes.push(where.id); const row = stage.shops.find((row: any) => row.id === where.id); Object.assign(row, data); return row; },
      },
      booking: { findMany: async ({ where }: any) => where.shopId === 11n ? [{ id: 100n, reservationKind: 'SINGLE', startTime: at('13:00'), endTime: at('14:00') }] : [] },
      shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: { findMany: async ({ where }: any) => where.shopId === 11n ? [{ resourceType: 'THERAPIST', resourceId: 30n, startAtUtc: at('13:00'), endAtUtc: at('14:15') }] : [] },
      therapist: { findMany: async ({ where }: any) => where.shopId === 11n ? [{ id: 30n, scheduleMode: 'SHOP' }] : [] },
      copyConfigOperation: {
        findUnique: async () => null,
        create: async ({ data }: any) => { stage.operations.push(data); return data; },
      },
      auditLog: { create: async ({ data }: any) => { stage.audits.push(data); return data; } },
    };
    const result = await work(tx); saved = stage; return result;
  } };
  return { service: new AccountCopyService(db), state: () => saved, writes, locks };
}

describe('one canonical reader for stored object or legacy JSON-string shop hours', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(at('08:00')); });
  afterEach(() => { jest.useRealTimers(); });
  test('booking context, SHOP inheritance, Studio display and publication read a serialized object identically without changing its storage', async () => {
    const serialized = JSON.stringify(hours), source = shop(10n, serialized), before = structuredClone(source);
    expect(openingIntervals(serialized)).toEqual(openingIntervals(hours)); expect(normalizeHours(serialized)).toEqual(normalizeHours(hours));
    expect(effectiveWeeklyShifts('SHOP', serialized, [])).toEqual(effectiveWeeklyShifts('SHOP', hours, []));
    expect(displayHours(serialized)).toEqual(displayHours(hours));
    expect(studioHours(displayHours(serialized))).toEqual(normalizeHours(hours));
    expect(displayHours(serialized)['周一']).toEqual({ open: true, start: '09:00', end: '12:00', periods: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] });
    expect(shopPublication(source).publicationReady).toBe(true);
    const db: any = { shop: { findUnique: async () => source },
      shopService: { findUnique: async () => ({ id: 20n, shopId: 10n, name: 'Synthetic service', isActive: true, durationKind: 'TIMED', durationMin: 60,
        priceCents: 6000, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, staffBufferMin: 15, roomBufferMin: 0, requiredRoomType: null, variants: [] }) },
      therapist: { findMany: async () => [{ id: 30n, scheduleMode: 'SHOP', shifts: [], timeOff: [] }] },
      shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: { findMany: async () => [] }, booking: { findMany: async () => [] } };
    const booking = Object.create(BookingService.prototype) as any;
    const context = await booking.context(db, { shopId: '10', serviceId: '20', date: '2035-01-01' }, undefined, undefined, true);
    expect(context.windows).toEqual([{ open: 540, close: 720 }, { open: 780, close: 1080 }]);
    expect(allocate(context.allocation, at('09:00'), [])?.therapistIds).toEqual(['30']); expect(source).toEqual(before);
  });
  test('real HOURS copy preview/apply accepts legacy source hours but protects the target future service and SHOP buffer under its own scope', async () => {
    const f = copyFixture(JSON.stringify(hours)), actor = { id: '1', role: 'ADMIN' }, body = { sourceShopId: '10', targetShopId: '11', kind: 'HOURS' as const };
    const preview = await f.service.preview(actor, body);
    expect(preview.changes.hours.to).toEqual(normalizeHours(hours)); expect(f.writes).toEqual([]);
    await f.service.apply(actor, { ...body, previewHash: preview.previewHash, idempotencyKey: 'synthetic-legacy-hours-copy' });
    expect(f.writes).toEqual([11n]); expect(f.state().shops[0].businessHours).toBe(JSON.stringify(hours)); expect(f.state().shops[1].businessHours).toEqual(normalizeHours(hours));
    expect(f.locks.slice(0, 2)).toEqual([10n, 11n]); expect(f.state().operations).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
    const narrowed = copyFixture(JSON.stringify({ monday: { open: '09:00', close: '14:00' } })), next = await narrowed.service.preview(actor, body), before = structuredClone(narrowed.state());
    await expect(narrowed.service.apply(actor, { ...body, previewHash: next.previewHash, idempotencyKey: 'synthetic-blocked-hours-copy' })).rejects.toThrow(ConflictException);
    expect(narrowed.writes).toEqual([]); expect(narrowed.state()).toEqual(before);
  });
  test.each(['{broken', 'null', '[]', JSON.stringify(JSON.stringify(hours)), JSON.stringify({ monday: { open: '18:00', close: '09:00' } }),
    JSON.stringify({ monday: [{ open: '09:00', close: '12:00' }, { open: '11:00', close: '13:00' }] }), JSON.stringify({ unknown: { closed: true } })])('invalid legacy %p stays unavailable and incomplete without crashing read-only Studio/publication projections', raw => {
    expect(() => openingIntervals(raw)).toThrow(BadRequestException); expect(() => normalizeHours(raw)).toThrow(BadRequestException);
    expect(Object.values(displayHours(raw)).every(day => day.open === false)).toBe(true);
    expect(shopPublication(shop(10n, raw)).publicationChecklist.find(check => check.key === 'hours')?.complete).toBe(false);
  });
});
