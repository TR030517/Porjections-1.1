import { ConflictException } from '@nestjs/common';
import { ensureShopBookingSettings } from './configuration-guard';
import { ReservationsService } from './reservations.service';
import { introducedShopClosures, isShopClosedDuring, normalizeShopBookingSettings } from '../../common/shop-booking-settings';
import { shopBookingSettingsHash } from '../../common/shop-booking-settings-revision';

const settings = (closedPeriods: Array<{ startDate: string; endDate: string }> = [], minimumNoticeMinutes = 0) => ({ minimumNoticeMinutes, closedPeriods });
const period = (startDate = '2035-01-11', endDate = '2035-01-20') => ({ startDate, endDate });
function fixture(extra: any = {}) {
  const shop = { id: 10n, timezone: 'America/Los_Angeles', studioProfile: { bookingSettings: settings(), manualData: 'retained' }, ...extra };
  const booking: any = { id: 100n, reservationKind: 'SINGLE', startTime: new Date('2035-01-12T01:00:00Z'), endTime: new Date('2035-01-12T02:00:00Z') }; // local Jan 11 17–18
  const events: string[] = [];
  const db: any = { $queryRaw: jest.fn(async () => { events.push('lock'); return []; }),
    booking: { findMany: jest.fn(async () => { events.push('read-bookings'); return [booking]; }) },
    bookingResourceLock: { findMany: jest.fn(async () => []) },
    shop: { update: jest.fn(async ({ data }: any) => { events.push('save'); return { ...shop, ...data }; }) },
    auditLog: { create: jest.fn(async () => ({})) } };
  db.$transaction = async (callback: any) => callback(db);
  const service = new ReservationsService(db);
  jest.spyOn(service as any, 'authorize').mockImplementation(async () => { events.push('authorize'); return shop; });
  return { shop, booking, db, events, service };
}

describe('shop-local closure edits protect existing bookings under the booking mutex', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T00:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  test.each(['2035-01-11', '2035-01-20'])('saving a newly closed boundary date %s conflicts before persistence or audit', async date => {
    const f = fixture();
    f.booking.startTime = new Date(date + 'T20:00:00Z'); f.booking.endTime = new Date(date + 'T21:00:00Z');
    await expect(f.service.bookingSettings('10', { id: '2', role: 'ADMIN' }, { ...settings([period()]), expectedSettingsHash: shopBookingSettingsHash(f.shop) })).rejects.toThrow(ConflictException);
    expect(f.events).toEqual(['lock', 'authorize', 'read-bookings']);
    expect(f.db.shop.update).not.toHaveBeenCalled(); expect(f.db.auditLog.create).not.toHaveBeenCalled();
    const where = f.db.booking.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ shopId: 10n, status: { in: ['PENDING', 'CONFIRMED'] }, deletedAt: null, endTime: { gt: new Date() } });
    expect(where.OR).toContainEqual({ holdExpiresAt: null }); // offline orders stay live.
    expect(where.OR).toContainEqual({ holdExpiresAt: { gt: new Date() } }); // expired unpaid holds do not block.
  });
  test('UTC dates do not shift an appointment into a local closure', async () => {
    const f = fixture(); f.booking.startTime = new Date('2035-01-11T01:00:00Z'); f.booking.endTime = new Date('2035-01-11T02:00:00Z'); // Jan 10 in shop.
    await expect(f.service.bookingSettings('10', { id: '2', role: 'ADMIN' }, { ...settings([period()]), expectedSettingsHash: shopBookingSettingsHash(f.shop) })).resolves.toBeDefined();
    expect(f.events).toEqual(['lock', 'authorize', 'read-bookings', 'save']);
    expect(f.db.shop.update.mock.calls[0][0].data.studioProfile.manualData).toBe('retained');
  });
  test('a half-open historical appointment ending at closure midnight does not occupy that date', async () => {
    const f = fixture(); f.booking.startTime = new Date('2035-01-11T07:00:00Z'); f.booking.endTime = new Date('2035-01-11T08:00:00Z');
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period()]))).resolves.toBeUndefined();
    f.booking.endTime = new Date('2035-01-11T08:00:00.001Z');
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period()]))).rejects.toThrow('闭店日期');
  });
  test('a historical overnight appointment spanning a closed date is protected', async () => {
    const f = fixture(); f.booking.startTime = new Date('2035-01-11T07:00:00Z'); f.booking.endTime = new Date('2035-01-12T09:00:00Z');
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period('2035-01-11', '2035-01-11')]))).rejects.toThrow('闭店日期');
  });
  test.each([false, true])('a PLAN segment on the next shop-local date is protected (incomplete historical snapshot: %s)', async incomplete => {
    const f = fixture();
    Object.assign(f.booking, { reservationKind: 'PLAN', participantCountSnapshot: 1, durationMin: 150,
      startTime: new Date('2035-01-11T07:00:00Z'), endTime: new Date('2035-01-11T09:30:00Z'), items: [
        { id: 1000n, bookingId: 100n, participantIndex: 1, sequence: 1, offsetMin: 0, requiredStaffCountSnapshot: 1,
          durationMin: 30, staffBufferMin: 0, roomBufferMin: 60, startAtUtc: new Date('2035-01-11T07:00:00Z'), endAtUtc: new Date('2035-01-11T07:30:00Z') },
        { id: 1001n, bookingId: 100n, participantIndex: 1, sequence: 2, offsetMin: 90, requiredStaffCountSnapshot: 1,
          durationMin: 60, staffBufferMin: 0, roomBufferMin: 0, startAtUtc: new Date('2035-01-11T08:30:00Z'), endAtUtc: new Date('2035-01-11T09:30:00Z') },
      ] });
    if (incomplete) f.booking.items.pop();
    await expect(f.service.bookingSettings('10', { id: '2', role: 'ADMIN' }, { ...settings([period('2035-01-11', '2035-01-11')]), expectedSettingsHash: shopBookingSettingsHash(f.shop) })).rejects.toThrow('先联系顾客并处理预约');
    expect(f.events).toEqual(['lock', 'authorize', 'read-bookings']);
    expect(f.db.shop.update).not.toHaveBeenCalled();
    expect(f.db.booking.findMany.mock.calls[0][0].select.items.select).toHaveProperty('offsetMin', true);
  });
  test('raising notice does not invalidate bookings and shortening/removing closures remains possible', async () => {
    const f = fixture({ studioProfile: { bookingSettings: settings([period()]) } });
    for (const next of [settings([period()], 720), settings([period('2035-01-12', '2035-01-18')]), settings()]) {
      await expect(ensureShopBookingSettings(f.db, f.shop, next)).resolves.toBeUndefined();
    }
    expect(f.db.booking.findMany).not.toHaveBeenCalled();
    expect(f.db.bookingResourceLock.findMany).not.toHaveBeenCalled();
  });
  test('extending an old closure checks only newly closed dates and keeps manual existing appointments untouched', async () => {
    const f = fixture({ studioProfile: { bookingSettings: settings([period('2035-01-12', '2035-01-18')]) } });
    f.booking.startTime = new Date('2035-01-15T20:00:00Z'); f.booking.endTime = new Date('2035-01-15T21:00:00Z');
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period()]))).resolves.toBeUndefined();
    f.booking.startTime = new Date('2035-01-19T20:00:00Z'); f.booking.endTime = new Date('2035-01-19T21:00:00Z');
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period()]))).rejects.toThrow('闭店日期');
  });
  test('missing timezone blocks only when newly closed dates intersect potential future reservations', async () => {
    const f = fixture({ timezone: null });
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period()]))).rejects.toThrow('时区');
    f.db.booking.findMany.mockResolvedValue([]);
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period()]))).resolves.toBeUndefined();
  });

  test.each(['ROOM', 'THERAPIST'])('an active %s buffer crossing local midnight blocks a new closure even after its service ends', async resourceType => {
    const f = fixture();
    // There is no future service body left, but its cleanup is still active.
    jest.setSystemTime(new Date('2035-01-11T07:45:00Z'));
    f.db.booking.findMany.mockResolvedValue([]);
    const lock = { resourceType, startAtUtc: new Date('2035-01-11T07:00:00Z'), endAtUtc: new Date('2035-01-11T08:15:00Z') };
    f.db.bookingResourceLock.findMany.mockResolvedValue([lock]);
    const before = structuredClone(lock);
    await expect(f.service.bookingSettings('10', { id: '2', role: 'ADMIN' }, { ...settings([period()]), expectedSettingsHash: shopBookingSettingsHash(f.shop) })).rejects.toThrow('闭店日期');
    expect(f.db.shop.update).not.toHaveBeenCalled();
    expect(f.db.auditLog.create).not.toHaveBeenCalled();
    expect(lock).toEqual(before);
    const query = f.db.bookingResourceLock.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ shopId: 10n, status: 'ACTIVE', endAtUtc: { gt: new Date() }, booking: { OR: [
      { status: { not: 'PENDING' } }, { paymentStatus: { not: 'UNPAID' } }, { paidCents: { gt: 0 } },
      { holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } },
    ] } });
    // The same existing resource eligibility excludes expired, wholly unpaid
    // PENDING holds, but protects not-yet-released cleanup on terminal orders.
  });

  test('resource buffers obey a half-open midnight boundary down to one millisecond', async () => {
    const f = fixture(); f.db.booking.findMany.mockResolvedValue([]);
    const lock = { startAtUtc: new Date('2035-01-11T07:00:00Z'), endAtUtc: new Date('2035-01-11T08:00:00Z') };
    f.db.bookingResourceLock.findMany.mockResolvedValue([lock]);
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period()]))).resolves.toBeUndefined();
    lock.endAtUtc = new Date('2035-01-11T08:00:00.001Z');
    await expect(ensureShopBookingSettings(f.db, f.shop, settings([period()]))).rejects.toThrow('闭店日期');
  });

  test('no eligible future service or resource lock permits the closure without mutating orders', async () => {
    const f = fixture(); f.db.booking.findMany.mockResolvedValue([]);
    await expect(f.service.bookingSettings('10', { id: '2', role: 'ADMIN' }, { ...settings([period()]), expectedSettingsHash: shopBookingSettingsHash(f.shop) })).resolves.toBeDefined();
    expect(f.db.shop.update).toHaveBeenCalledTimes(1);
    expect(f.db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(f.db.bookingResourceLock.findMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(f.db.booking)).toEqual(['findMany']);
    expect(Object.keys(f.db.bookingResourceLock)).toEqual(['findMany']);
  });
});

describe('whole shop-local closure dates across daylight-saving transitions', () => {
  test('the shared settings module loads and computes local dates when server framework modules are unavailable', () => {
    try {
      jest.isolateModules(() => {
        jest.doMock('@nestjs/common', () => { throw new Error('Server framework is unavailable in the browser'); });
        const shared = require('../../common/shop-booking-settings') as typeof import('../../common/shop-booking-settings');
        const closed = shared.normalizeShopBookingSettings(settings([period('2035-01-11', '2035-01-11')]));
        const start = new Date('2035-01-11T07:30:00Z'), midnight = new Date('2035-01-11T08:00:00Z');
        expect(shared.isShopClosedDuring(closed, start, midnight, 'America/Los_Angeles')).toBe(false);
        expect(shared.isShopClosedDuring(closed, start, new Date(+midnight + 1), 'America/Los_Angeles')).toBe(true);
      });
    } finally { jest.dontMock('@nestjs/common'); }
  });

  test.each([
    ['2035-03-11', '2035-03-11T05:00:00Z', '2035-03-12T04:00:00Z', 23],
    ['2035-11-04', '2035-11-04T04:00:00Z', '2035-11-05T05:00:00Z', 25],
  ])('%s covers its complete local day with an exclusive following midnight', (date, start, end, hours) => {
    const closed = settings([period(String(date), String(date))]), from = new Date(String(start)), until = new Date(String(end));
    expect(+until - +from).toBe(Number(hours) * 3600000);
    expect(isShopClosedDuring(closed, from, until, 'America/New_York')).toBe(true);
    expect(isShopClosedDuring(closed, new Date(+from - 60000), from, 'America/New_York')).toBe(false);
    expect(isShopClosedDuring(closed, new Date(+from - 60000), new Date(+from + 1), 'America/New_York')).toBe(true);
    expect(isShopClosedDuring(closed, until, new Date(+until + 60000), 'America/New_York')).toBe(false);
  });
});

describe('introduced closure date subtraction', () => {
  test('splits added dates around every prior closed block and preserves inclusive endpoints', () => {
    expect(introducedShopClosures(settings([period('2035-01-12', '2035-01-13'), period('2035-01-16', '2035-01-18')]), settings([period()]))).toEqual([
      period('2035-01-11', '2035-01-11'), period('2035-01-14', '2035-01-15'), period('2035-01-19', '2035-01-20'),
    ]);
  });
  test('handles leap days and year boundaries without elapsed-hour or timezone arithmetic', () => {
    expect(introducedShopClosures(settings([period('2036-02-29', '2036-02-29')]), settings([period('2036-02-28', '2036-03-01')]))).toEqual([
      period('2036-02-28', '2036-02-28'), period('2036-03-01', '2036-03-01'),
    ]);
    expect(introducedShopClosures(settings([period('2034-12-31', '2035-01-01')]), settings([period('2034-12-30', '2035-01-02')]))).toEqual([
      period('2034-12-30', '2034-12-30'), period('2035-01-02', '2035-01-02'),
    ]);
  });
  test('normalization rejects invalid Gregorian dates, reversed and overlapping periods', () => {
    for (const raw of [[period('2035-02-29', '2035-03-01')], [period('2035-01-20', '2035-01-11')], [period(), period('2035-01-20', '2035-01-21')]]) {
      expect(() => normalizeShopBookingSettings(settings(raw))).toThrow();
    }
  });
});
