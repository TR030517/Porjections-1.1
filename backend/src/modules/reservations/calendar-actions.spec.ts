import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { requireShopAccess } from '../../common/shop-access';
import { CalendarActionDto, parseCalendarAction } from './calendar-actions.dto';
import { CalendarActionsService, calendarSettingsHash, closeCalendarDate } from './calendar-actions.service';
import { calendarBookingConflicts, ensureCalendarBlockAvailable } from './calendar-actions.conflicts';
import { ReservationsService } from './reservations.service';
import { ensureShopConfiguration } from './configuration-guard';

jest.mock('../../common/shop-access', () => ({ requireShopAccess: jest.fn() }));
const access = requireShopAccess as jest.Mock;
const actor = { id: '2', role: 'STAFF' };
const key = '01234567-1234-4123-8123-123456789abc';
const shop = () => ({ id: 1n, timezone: 'America/Los_Angeles', studioProfile: { custom: 'keep', bookingSettings: { minimumNoticeMinutes: 720, closedPeriods: [] } } });
const command = (extra: any = {}) => ({ requestKey: key, action: 'CREATE', expectedTimezone: 'America/Los_Angeles', purpose: 'TIME_BLOCK', scope: 'SHOP', startLocal: '2040-06-01T14:00', endLocal: '2040-06-01T15:00', reason: 'Maintenance', ...extra });
function fixture() {
  const events: string[] = [], receipts = new Map<string, any>(), blocks = new Map<string, any>(), sources = new Map<string, any>();
  const currentShop = shop();
  access.mockImplementation(async (_db, _id, _actor, permission, options) => { events.push('authorize'); expect(permission).toBe('RESERVATION_CONFIG'); return { shop: currentShop }; });
  let next = 10n;
  const tx: any = {
    $queryRaw: jest.fn(async () => { events.push('shop-lock'); return []; }),
    calendarActionReceipt: { findUnique: jest.fn(async ({ where }: any) => receipts.get(where.shopId_operatorId_requestKey.requestKey) ?? null),
      create: jest.fn(async ({ data }: any) => { const row = { ...data }; receipts.set(data.requestKey, row); return row; }) },
    shopCalendarBlock: {
      findFirst: jest.fn(async ({ where }: any) => where.id && typeof where.id === 'bigint' ? blocks.get(String(where.id)) ?? null : null),
      create: jest.fn(async ({ data }: any) => { const row = { id: next++, ...data }; blocks.set(String(row.id), row); return row; }),
      updateMany: jest.fn(async ({ where, data }: any) => { const row = blocks.get(String(where.id));
        if (!row || row.version !== where.version || row.status !== where.status) return { count: 0 };
        blocks.set(String(row.id), { ...row, ...data, version: row.version + 1 }); return { count: 1 }; }),
    },
    therapistTimeOff: { findFirst: jest.fn(async ({ where }: any) => where.id && typeof where.id === 'bigint' ? sources.get(String(where.id)) ?? null : null),
      create: jest.fn(async ({ data }: any) => { const row = { id: next++, ...data }; sources.set(String(row.id), row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...sources.get(String(where.id)), ...data }; sources.set(String(where.id), row); return row; }),
      delete: jest.fn(async ({ where }: any) => { sources.delete(String(where.id)); return {}; }) },
    roomMaintenance: { findFirst: jest.fn(async () => null), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    therapist: { findFirst: jest.fn(async () => ({ id: 3n })), findMany: jest.fn(async () => [{ id: 3n, name: 'Therapist' }]) },
    shopRoom: { findFirst: jest.fn(async () => ({ id: 4n })), findMany: jest.fn(async () => [{ id: 4n, name: 'Room' }]) },
    bookingResourceLock: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    booking: { findMany: jest.fn(async () => []), create: jest.fn(), update: jest.fn() },
    shop: { update: jest.fn(async ({ data }: any) => Object.assign(currentShop, data)) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { tx, prisma, service: new CalendarActionsService(prisma), receipts, blocks, sources, events, shop: currentShop };
}
beforeEach(() => jest.clearAllMocks());

describe('calendar command input and local time contract', () => {
  test('global DTO validation retains exact scalar types and rejects unknown fields', async () => {
    const dto = plainToInstance(CalendarActionDto, command({ expectedVersion: '1' }), { enableImplicitConversion: true });
    expect(dto.expectedVersion).toBe('1');
    const errors = await validate(plainToInstance(CalendarActionDto, { ...command(), customerEmail: 'private@example.test' }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some(error => error.property === 'customerEmail')).toBe(true);
  });
  test.each([
    { requestKey: 'no' }, { resourceId: '3' }, { scope: 'THERAPIST' }, { reason: '' }, { reason: 'x'.repeat(501) },
    { startLocal: '2040-02-30T09:00' }, { endLocal: '2040-06-01T14:00' }, { endLocal: '2040-08-01T14:00' }, { expectedTimezone: 'invalid' },
    { action: 'RELEASE', blockId: '3', expectedVersion: 1 },
  ])('rejects malformed or action-incompatible input %j', extra => expect(() => parseCalendarAction(command(extra))).toThrow(BadRequestException));
  test('same object field order has stable hash but altered whitespace cannot replay another draft', () => {
    const original = command();
    expect(parseCalendarAction(Object.fromEntries(Object.entries(original).reverse())).requestHash).toBe(parseCalendarAction(original).requestHash);
    expect(parseCalendarAction(command({ reason: ' Maintenance ' })).requestHash).not.toBe(parseCalendarAction(original).requestHash);
  });
  test.each([['2040-03-11T02:30', '2040-03-11T04:00'], ['2040-11-04T01:30', '2040-11-04T03:00']])('rejects skipped/ambiguous shop-local start %s before writes', async (startLocal, endLocal) => {
    const f = fixture();
    await expect(f.service.execute('1', actor, command({ startLocal, endLocal }))).rejects.toThrow(BadRequestException);
    expect(f.tx.shopCalendarBlock.create).not.toHaveBeenCalled();
  });
});

describe('calendar command atomicity, ownership and recovery', () => {
  test('shop-first STAFF config auth, immutable same-key replay, no orders or raw reason in receipts/audit', async () => {
    const f = fixture(), result: any = await f.service.execute('1', actor, command());
    expect(f.events.slice(0, 2)).toEqual(['shop-lock', 'authorize']);
    expect(f.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'ReadCommitted' });
    expect(result).toEqual({ shopId: '1', requestKey: key, action: 'CREATE', outcome: 'COMMITTED', result: { blockId: '10', version: 1, closedDate: null } });
    f.blocks.get('10').version = 9;
    await expect(f.service.execute('1', actor, command())).resolves.toEqual(result);
    expect(f.tx.shopCalendarBlock.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.tx.calendarActionReceipt.create.mock.calls, (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain('Maintenance');
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls, (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain('Maintenance');
    expect(f.tx.booking.create).not.toHaveBeenCalled(); expect(f.tx.booking.update).not.toHaveBeenCalled();
  });
  test('same-key changed command and revoked current authorization cannot replay', async () => {
    const f = fixture(); await f.service.execute('1', actor, command());
    await expect(f.service.execute('1', actor, command({ reason: 'Changed' }))).rejects.toThrow(ConflictException);
    access.mockRejectedValueOnce(new ForbiddenException());
    await expect(f.service.execute('1', actor, command())).rejects.toThrow(ForbiddenException);
  });
  test('GET absence stays unknown; reconcile fences the key before any late original POST', async () => {
    const f = fixture();
    await expect(f.service.receipt('1', actor, key)).resolves.toMatchObject({ outcome: 'NOT_FOUND' });
    expect(f.tx.calendarActionReceipt.create).not.toHaveBeenCalled();
    await expect(f.service.reconcile('1', actor, key)).resolves.toMatchObject({ outcome: 'NOT_EXECUTED' });
    await expect(f.service.receipt('1', actor, key)).resolves.toMatchObject({ outcome: 'NOT_EXECUTED' });
    await expect(f.service.execute('1', actor, command())).rejects.toThrow(ConflictException);
    expect(f.tx.shopCalendarBlock.create).not.toHaveBeenCalled();
  });
  test('resource rows are reused, versioned updates reject stale drafts, release removes only exact backing source', async () => {
    const f = fixture(), first: any = await f.service.execute('1', actor, command({ scope: 'THERAPIST', resourceId: '3' }));
    const blockId = first.result.blockId, original = f.blocks.get(blockId);
    expect(original.timeOffId).toBe(10n); expect(f.sources.size).toBe(1);
    const update = command({ requestKey: '11234567-1234-4123-8123-123456789abc', action: 'UPDATE', blockId, expectedVersion: 1, scope: 'THERAPIST', resourceId: '3', reason: 'New' });
    await expect(f.service.execute('1', actor, update)).resolves.toMatchObject({ result: { version: 2 } });
    expect(f.tx.therapistTimeOff.create).toHaveBeenCalledTimes(1); expect(f.sources.get('10').reason).toBe('New');
    await expect(f.service.execute('1', actor, { ...update, requestKey: '21234567-1234-4123-8123-123456789abc' })).rejects.toThrow(ConflictException);
    await expect(f.service.execute('1', actor, { requestKey: '31234567-1234-4123-8123-123456789abc', action: 'RELEASE', expectedTimezone: shop().timezone, blockId, expectedVersion: 2 })).resolves.toMatchObject({ result: { version: 3 } });
    expect(f.sources.size).toBe(0); expect(f.blocks.get(blockId)).toMatchObject({ status: 'RELEASED', version: 3, timeOffId: null });
    expect(f.tx.therapistTimeOff.delete).toHaveBeenCalledWith({ where: { id: 10n } });
  });
  test('CLOSE_DAY uses latest CAS and preserves advance notice, other ranges and unknown profile', async () => {
    const f = fixture(); f.shop.studioProfile.bookingSettings.closedPeriods = [{ startDate: '2040-06-03', endDate: '2040-06-04' }] as any;
    const raw = { requestKey: key, action: 'CLOSE_DAY', expectedTimezone: f.shop.timezone, date: '2040-06-02', expectedSettingsHash: calendarSettingsHash(f.shop) };
    await expect(f.service.execute('1', actor, raw)).resolves.toMatchObject({ result: { blockId: null, closedDate: '2040-06-02' } });
    expect(f.shop.studioProfile).toMatchObject({ custom: 'keep', bookingSettings: { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2040-06-02', endDate: '2040-06-04' }] } });
    await expect(f.service.execute('1', actor, { ...raw, requestKey: '11234567-1234-4123-8123-123456789abc', date: '2040-06-05' })).rejects.toThrow(ConflictException);
  });
  test('legacy full settings PATCH cannot overwrite a date added through the calendar after its form was loaded', async () => {
    const f = fixture(), settingsService = new ReservationsService(f.prisma);
    const before: any = await settingsService.bookingSettingsView('1', actor);
    await f.service.execute('1', actor, { requestKey: key, action: 'CLOSE_DAY', expectedTimezone: f.shop.timezone, date: '2040-06-02', expectedSettingsHash: before.bookingSettingsHash });
    f.tx.shop.update.mockClear();
    await expect(settingsService.bookingSettings('1', actor, { ...before.bookingSettings, minimumNoticeMinutes: 60, expectedSettingsHash: before.bookingSettingsHash })).rejects.toThrow(ConflictException);
    expect(f.tx.shop.update).not.toHaveBeenCalled();
    const current: any = await settingsService.bookingSettingsView('1', actor);
    const updated: any = await settingsService.bookingSettings('1', actor, { ...current.bookingSettings, minimumNoticeMinutes: 60, expectedSettingsHash: current.bookingSettingsHash });
    expect(updated.item.bookingSettings.closedPeriods).toEqual([{ startDate: '2040-06-02', endDate: '2040-06-02' }]);
    expect(updated.item.bookingSettingsHash).not.toBe(current.bookingSettingsHash);
    expect(() => settingsService.bookingSettings('1', actor, current.bookingSettings)).toThrow(BadRequestException);
  });
  test('resource-managed time-off cannot be edited or deleted through legacy CRUD', async () => {
    const f = fixture(); f.tx.therapistTimeOff.findFirst.mockResolvedValue({ id: 3n, therapistId: 8n });
    f.tx.shopCalendarBlock.findFirst.mockResolvedValue({ id: 9n });
    const service = new ReservationsService(f.prisma);
    await expect(service.mutate('1', actor, 'time-off', {}, '3', true)).rejects.toThrow(ConflictException);
    await expect(service.mutate('1', actor, 'time-off', { reason: 'x' }, '3')).rejects.toThrow(ConflictException);
    expect(f.tx.therapistTimeOff.delete).not.toHaveBeenCalled(); expect(f.tx.therapistTimeOff.update).not.toHaveBeenCalled();
  });
  test('active blocks prevent shop timezone changes even without orders, but do not prevent unchanged timezone', async () => {
    const f = fixture(); f.tx.shopCalendarBlock.findFirst.mockResolvedValue({ id: 10n });
    await expect(ensureShopConfiguration(f.tx, f.shop, { timezone: 'America/New_York' })).rejects.toThrow(ConflictException);
    await expect(ensureShopConfiguration(f.tx, f.shop, { timezone: f.shop.timezone })).resolves.toBeUndefined();
    expect(f.tx.booking.findMany).not.toHaveBeenCalled();
  });
});

describe('selected date reopening', () => {
  const reopen = (f: ReturnType<typeof fixture>, date = '2040-06-02', extra: any = {}) => ({
    requestKey: key, action: 'REOPEN_DAY', expectedTimezone: f.shop.timezone, date, expectedSettingsHash: calendarSettingsHash(f.shop), ...extra,
  });
  function closedFixture(periods = [{ startDate: '2040-06-01', endDate: '2040-06-03' }]) {
    const f = fixture(); f.shop.studioProfile.bookingSettings.closedPeriods = periods as any; return f;
  }
  function serialized(f: ReturnType<typeof fixture>) {
    let tail: Promise<unknown> = Promise.resolve();
    f.prisma.$transaction.mockImplementation((fn: any) => {
      const turn = tail.then(() => fn(f.tx)); tail = turn.catch(() => undefined); return turn;
    });
  }
  test('options identifies the exact temporary source range, never a generic business-hours promise', async () => {
    const f = closedFixture();
    await expect(f.service.options('1', actor, { date: '2040-06-02' })).resolves.toMatchObject({ closed: true, temporaryClosure: { startDate: '2040-06-01', endDate: '2040-06-03' } });
    await expect(f.service.options('1', actor, { date: '2040-06-04' })).resolves.toMatchObject({ closed: false, temporaryClosure: null });
  });
  test.each([
    ['single day', [{ startDate: '2040-06-02', endDate: '2040-06-02' }], '2040-06-02', []],
    ['inclusive first day', [{ startDate: '2040-06-01', endDate: '2040-06-03' }], '2040-06-01', [{ startDate: '2040-06-02', endDate: '2040-06-03' }]],
    ['inclusive last day', [{ startDate: '2040-06-01', endDate: '2040-06-03' }], '2040-06-03', [{ startDate: '2040-06-01', endDate: '2040-06-02' }]],
    ['middle day split', [{ startDate: '2040-06-01', endDate: '2040-06-03' }], '2040-06-02', [{ startDate: '2040-06-01', endDate: '2040-06-01' }, { startDate: '2040-06-03', endDate: '2040-06-03' }]],
    ['leap day', [{ startDate: '2040-02-28', endDate: '2040-03-01' }], '2040-02-29', [{ startDate: '2040-02-28', endDate: '2040-02-28' }, { startDate: '2040-03-01', endDate: '2040-03-01' }]],
    ['DST spring date', [{ startDate: '2040-03-10', endDate: '2040-03-12' }], '2040-03-11', [{ startDate: '2040-03-10', endDate: '2040-03-10' }, { startDate: '2040-03-12', endDate: '2040-03-12' }]],
    ['DST autumn date', [{ startDate: '2040-11-03', endDate: '2040-11-05' }], '2040-11-04', [{ startDate: '2040-11-03', endDate: '2040-11-03' }, { startDate: '2040-11-05', endDate: '2040-11-05' }]],
  ])('%s removes only the selected local date', async (_label, periods, date, expected) => {
    const f = closedFixture(periods as any), before = structuredClone(f.shop.studioProfile);
    await expect(f.service.execute('1', actor, reopen(f, date as string))).resolves.toEqual({ shopId: '1', requestKey: key, action: 'REOPEN_DAY', outcome: 'COMMITTED', result: { blockId: null, version: null, closedDate: date } });
    expect(f.shop.studioProfile.bookingSettings).toEqual({ minimumNoticeMinutes: 720, closedPeriods: expected });
    expect(f.shop.studioProfile.custom).toBe(before.custom);
    expect(f.events.slice(0, 2)).toEqual(['shop-lock', 'authorize']);
    expect(f.tx.booking.create).not.toHaveBeenCalled(); expect(f.tx.booking.update).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'CALENDAR_REOPEN_DAY', detail: { fields: ['closedPeriods'] } }) }));
  });
  test('leaves every unrelated range, current notice and independent shop/resource restrictions untouched', async () => {
    const f = closedFixture([{ startDate: '2040-06-01', endDate: '2040-06-03' }, { startDate: '2040-07-01', endDate: '2040-07-10' }]);
    Object.assign(f.shop, { businessHours: { sunday: { closed: true } } });
    Object.assign(f.shop.studioProfile, { paymentPolicy: { payAtStoreEnabled: false }, features: { onlineBooking: false }, weeklyPolicy: { keep: true } });
    const prior = structuredClone(f.shop.studioProfile), hours = structuredClone((f.shop as any).businessHours);
    f.tx.shopCalendarBlock.findFirst.mockResolvedValue({ id: 77n, scope: 'SHOP', status: 'ACTIVE' });
    f.tx.therapistTimeOff.findFirst.mockResolvedValue({ id: 78n }); f.tx.roomMaintenance.findFirst.mockResolvedValue({ id: 79n });
    f.tx.booking.findMany.mockResolvedValue([{ id: 80n, status: 'CONFIRMED' }]);
    await f.service.execute('1', actor, reopen(f));
    expect(f.shop.studioProfile).toEqual({ ...prior, bookingSettings: { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2040-06-01', endDate: '2040-06-01' }, { startDate: '2040-06-03', endDate: '2040-06-03' }, { startDate: '2040-07-01', endDate: '2040-07-10' }] } });
    expect((f.shop as any).businessHours).toEqual(hours);
    for (const method of [f.tx.booking.create, f.tx.booking.update, f.tx.shopCalendarBlock.create, f.tx.shopCalendarBlock.updateMany, f.tx.therapistTimeOff.delete, f.tx.roomMaintenance.delete]) expect(method).not.toHaveBeenCalled();
  });
  test('two windows serialize through the shop mutex; stale whole-settings and reopening drafts cannot overwrite the winner', async () => {
    const f = closedFixture(), settings = new ReservationsService(f.prisma); serialized(f);
    const stale: any = await settings.bookingSettingsView('1', actor), first = reopen(f), second = reopen(f, '2040-06-03', { requestKey: '11234567-1234-4123-8123-123456789abc' });
    const outcomes = await Promise.allSettled([f.service.execute('1', actor, first), f.service.execute('1', actor, second)]);
    expect(outcomes[0].status).toBe('fulfilled'); expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: expect.any(ConflictException) });
    expect(f.tx.shop.update).toHaveBeenCalledTimes(1); expect(f.tx.calendarActionReceipt.create).toHaveBeenCalledTimes(1);
    await expect(settings.bookingSettings('1', actor, { ...stale.bookingSettings, minimumNoticeMinutes: 10, expectedSettingsHash: stale.bookingSettingsHash })).rejects.toThrow(ConflictException);
    const latest = await f.service.options('1', actor, { date: '2040-06-03' });
    await expect(f.service.execute('1', actor, { ...second, expectedSettingsHash: latest.settingsHash })).resolves.toMatchObject({ action: 'REOPEN_DAY' });
    expect(f.shop.studioProfile.bookingSettings.closedPeriods).toEqual([{ startDate: '2040-06-01', endDate: '2040-06-01' }]);
  });
  test('concurrent duplicate delivery and lost-response recovery return one immutable receipt even after a later close', async () => {
    const f = closedFixture(); serialized(f); const raw = reopen(f);
    const [one, two] = await Promise.all([f.service.execute('1', actor, raw), f.service.execute('1', actor, raw)]);
    expect(two).toEqual(one); expect(f.tx.shop.update).toHaveBeenCalledTimes(1); expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1); expect(f.tx.calendarActionReceipt.create).toHaveBeenCalledTimes(1);
    await f.service.execute('1', actor, { action: 'CLOSE_DAY', requestKey: '11234567-1234-4123-8123-123456789abc', expectedTimezone: f.shop.timezone, date: raw.date, expectedSettingsHash: calendarSettingsHash(f.shop) });
    const current = structuredClone(f.shop.studioProfile);
    await expect(f.service.receipt('1', actor, key)).resolves.toEqual(one);
    await expect(f.service.reconcile('1', actor, key)).resolves.toEqual(one);
    await expect(f.service.execute('1', actor, raw)).resolves.toEqual(one);
    expect(f.shop.studioProfile).toEqual(current); expect(f.tx.shop.update).toHaveBeenCalledTimes(2);
    await expect(f.service.execute('1', actor, { ...raw, date: '2040-06-03' })).rejects.toThrow(ConflictException);
  });
  test('NOT_FOUND is non-definitive and reconcile-first persistently fences a delayed reopen', async () => {
    const f = closedFixture(); serialized(f); const raw = reopen(f), before = structuredClone(f.shop.studioProfile);
    await expect(f.service.receipt('1', actor, key)).resolves.toMatchObject({ outcome: 'NOT_FOUND' });
    const outcomes = await Promise.allSettled([f.service.reconcile('1', actor, key), f.service.execute('1', actor, raw)]);
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: { outcome: 'NOT_EXECUTED' } });
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: expect.any(ConflictException) });
    expect(f.shop.studioProfile).toEqual(before); expect(f.tx.shop.update).not.toHaveBeenCalled();
    await expect(f.service.receipt('1', actor, key)).resolves.toMatchObject({ outcome: 'NOT_EXECUTED' });
  });
  test('already open date commits an auditable operation receipt without changing settings or any orders', async () => {
    const f = fixture();
    await expect(f.service.execute('1', actor, reopen(f))).resolves.toMatchObject({ outcome: 'COMMITTED', action: 'REOPEN_DAY' });
    expect(f.tx.shop.update).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled(); expect(f.tx.calendarActionReceipt.create).toHaveBeenCalledTimes(1);
  });
  test('current configuration permission and timezone are checked before any mutation or even receipt replay', async () => {
    const f = closedFixture(), raw = reopen(f), before = structuredClone(f.shop.studioProfile);
    access.mockRejectedValueOnce(new ForbiddenException());
    await expect(f.service.execute('1', actor, raw)).rejects.toThrow(ForbiddenException);
    await expect(f.service.execute('1', actor, { ...raw, expectedTimezone: 'America/New_York' })).rejects.toThrow(ConflictException);
    expect(f.shop.studioProfile).toEqual(before); expect(f.tx.shop.update).not.toHaveBeenCalled();
    await f.service.execute('1', actor, raw);
    access.mockRejectedValueOnce(new ForbiddenException()); await expect(f.service.execute('1', actor, raw)).rejects.toThrow(ForbiddenException);
  });
  test('an interior split exceeding the supported 50 ranges rejects atomically instead of deleting extra dates', async () => {
    const periods = [{ startDate: '2040-01-01', endDate: '2040-01-03' }, ...Array.from({ length: 49 }, (_v, i) => {
      const day = new Date(Date.UTC(2040, 1, 1 + i * 2)).toISOString().slice(0, 10); return { startDate: day, endDate: day };
    })], f = closedFixture(periods), before = structuredClone(f.shop.studioProfile);
    await expect(f.service.execute('1', actor, reopen(f, '2040-01-02'))).rejects.toThrow(ConflictException);
    expect(f.shop.studioProfile).toEqual(before); expect(f.tx.shop.update).not.toHaveBeenCalled(); expect(f.tx.calendarActionReceipt.create).not.toHaveBeenCalled();
  });
  test.each([{ date: '2040-02-30' }, { expectedSettingsHash: 'old' }, { reason: 'do not accept unrelated fields' }, { blockId: '10' }])('rejects invalid or incompatible reopen input %j', extra => {
    const f = closedFixture(); expect(() => parseCalendarAction(reopen(f, '2040-06-02', extra))).toThrow(BadRequestException);
  });
});

describe('calendar interval conflicts and DST dates', () => {
  const at = (value: string) => new Date(`2040-06-01T${value}:00Z`);
  const window = { startAtUtc: at('15:00'), endAtUtc: at('16:00') };
  const item = { id: 10n, assignedTherapistId: 1n, assignedRoomId: 4n, roomTypeSnapshot: 'SINGLE', startAtUtc: at('14:00'), endAtUtc: at('15:00'), staffBufferMin: 10, roomBufferMin: 20, requiredStaffCountSnapshot: 2 };
  test('half-open buffer windows block only relevant resources; exact cleanup end allows new interval', () => {
    const booking = { startTime: at('14:00'), endTime: at('15:00'), items: [item], resourceLocks: [{ bookingItemId: 10n, resourceType: 'THERAPIST', resourceId: 1n }, { bookingItemId: 10n, resourceType: 'THERAPIST', resourceId: 2n }] };
    expect(calendarBookingConflicts(booking, 'THERAPIST', 1n, window)).toBe(true);
    expect(calendarBookingConflicts(booking, 'THERAPIST', 3n, window)).toBe(false);
    expect(calendarBookingConflicts(booking, 'ROOM', 4n, window)).toBe(true);
    expect(calendarBookingConflicts(booking, 'ROOM', 5n, window)).toBe(false);
    expect(calendarBookingConflicts(booking, 'SHOP', null, window)).toBe(true);
    expect(calendarBookingConflicts(booking, 'SHOP', null, { ...window, startAtUtc: at('15:20') })).toBe(false);
  });
  test('unassigned legacy items stay conservative', () => {
    expect(calendarBookingConflicts({ startTime: at('14:00'), endTime: at('15:00'), items: [{ ...item, assignedTherapistId: null }] }, 'THERAPIST', 3n, window)).toBe(true);
  });
  test.each(['block', 'leave', 'maintenance', 'lock'])('rejects existing %s before any command mutation', async kind => {
    const f = fixture();
    const model = kind === 'block' ? f.tx.shopCalendarBlock : kind === 'leave' ? f.tx.therapistTimeOff : kind === 'maintenance' ? f.tx.roomMaintenance : f.tx.bookingResourceLock;
    model.findFirst.mockResolvedValue({ id: 99n });
    await expect(ensureCalendarBlockAvailable(f.tx, f.shop, 'SHOP', null, window)).rejects.toThrow(ConflictException);
    expect(f.tx.shopCalendarBlock.create).not.toHaveBeenCalled();
  });
  test('closing a date merges inclusively while preserving latest notice and all other closures', () => {
    expect(closeCalendarDate({ minimumNoticeMinutes: 100, closedPeriods: [{ startDate: '2040-03-10', endDate: '2040-03-10' }, { startDate: '2040-03-12', endDate: '2040-03-13' }] }, '2040-03-11')).toEqual({ minimumNoticeMinutes: 100, closedPeriods: [{ startDate: '2040-03-10', endDate: '2040-03-13' }] });
  });
});
