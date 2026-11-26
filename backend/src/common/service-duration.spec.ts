import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { readDurationKind, validReservedDurationMin, serviceDurationMeta, itemDurationMeta, bookingDurationMeta } from './service-duration';
import { CreateShopServiceDto, UpdateShopServiceDto } from '../modules/merchant/dto/merchant.dto';
import { CreateVariantDto } from '../modules/reservations/reservation.dto';
import { MerchantService } from '../modules/merchant/merchant.service';
import { StudioService } from '../modules/studio/studio.service';
import { BookingService } from '../modules/booking/booking.service';
import { ReservationsService } from '../modules/reservations/reservations.service';
import { BookingManageService } from '../modules/admin/booking-manage.service';
import { CreateBookingDto } from '../modules/booking/dto/booking.dto';

describe('service duration kind and frozen reservation metadata', () => {
  test('only missing kind is legacy TIMED, all explicit null/unknown/coerced kinds reject', () => {
    expect(readDurationKind(undefined)).toBe('TIMED');
    for (const kind of ['TIMED', 'PER_SESSION', 'VARIABLE']) expect(readDurationKind(kind)).toBe(kind);
    for (const kind of [null, '', 'timed', 'MIXED', 'ADD_ON', 0, {}, []]) expect(() => readDurationKind(kind)).toThrow(BadRequestException);
  });
  test('every new primary/variant allocation kind accepts short 5–240 minute services', () => {
    for (const kind of ['TIMED', 'PER_SESSION', 'VARIABLE']) {
      for (const minutes of [5, 10, 15, 20, 29, 30, 45, 120, 180, 240]) expect(validReservedDurationMin(kind, minutes)).toBe(true);
      for (const minutes of [undefined, null, 0, 4, 241, 30.5, '60', NaN, Infinity]) expect(validReservedDurationMin(kind, minutes)).toBe(false);
    }
    expect(validReservedDurationMin(null, 60)).toBe(false); expect(validReservedDurationMin('UNKNOWN', 60)).toBe(false);
  });
  test('read aliases preserve stored duration exactly and reject explicit contradictory aliases', () => {
    expect(serviceDurationMeta({ durationKind: 'PER_SESSION', durationMin: 60 })).toEqual({ durationKind: 'PER_SESSION', reservedDurationMin: 60 });
    expect(serviceDurationMeta({ durationMin: 60 })).toEqual({ durationKind: 'TIMED', reservedDurationMin: 60 });
    expect(itemDurationMeta({ durationKindSnapshot: 'VARIABLE', durationMin: 90 })).toEqual({ durationKind: 'VARIABLE', reservedDurationMin: 90 });
    expect(() => itemDurationMeta({ durationKindSnapshot: null, durationMin: 90 })).toThrow();
    expect(() => itemDurationMeta({ durationKindSnapshot: 'TIMED', durationKind: 'VARIABLE', durationMin: 60 })).toThrow();
    expect(() => serviceDurationMeta({ durationMin: 60, reservedDurationMin: 90 })).toThrow();
    expect(() => itemDurationMeta({ durationMin: 60, reservedDurationMin: null })).toThrow();
    expect(itemDurationMeta({ durationMin: 15 })).toEqual({ durationKind: 'TIMED', reservedDurationMin: 15 });
  });
  test('item snapshots never borrow live catalog kind and PLAN mixed summary retains original span rather than summing items', () => {
    const item: any = { durationKindSnapshot: 'PER_SESSION', durationMin: 60, service: { durationKind: 'TIMED' } };
    expect(itemDurationMeta(item).durationKind).toBe('PER_SESSION');
    expect(bookingDurationMeta({ durationMin: 105, items: [item, { durationKindSnapshot: 'VARIABLE', durationMin: 30 }] })).toEqual({ durationKind: 'MIXED', reservedDurationMin: 105 });
    expect(bookingDurationMeta({ durationMin: 60, items: [] })).toEqual({ durationKind: 'TIMED', reservedDurationMin: 60 });
    expect(bookingDurationMeta({ durationMin: 480, items: [{ durationMin: 240 }, { durationMin: 240 }] })).toEqual({ durationKind: 'TIMED', reservedDurationMin: 480 });
    expect(() => bookingDurationMeta({ durationMin: 60, items: null })).toThrow();
    expect(() => bookingDurationMeta({ durationMin: 60, items: [{ durationKindSnapshot: 'UNKNOWN', durationMin: 60 }] })).toThrow();
  });
  test('actual implicit-conversion DTO keeps raw kind/block types, extends240 and rejects null/unknown or writable read aliases', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
    const input = { name: 'Body Massage', category: 'MASSAGE', durationMin: 240, priceCents: 8000, durationKind: 'VARIABLE' };
    expect((await pipe.transform(input, { type: 'body', metatype: CreateShopServiceDto })).durationMin).toBe(240);
    expect((await pipe.transform({ durationKind: 'PER_SESSION', durationMin: 180 }, { type: 'body', metatype: UpdateShopServiceDto })).durationKind).toBe('PER_SESSION');
    for (const patch of [{ durationKind: null }, { durationKind: 'MIXED' }, { durationMin: null }, { durationMin: '60' }, { durationMin: 241 }, { reservedDurationMin: 60 }]) await expect(pipe.transform({ ...input, ...patch }, { type: 'body', metatype: CreateShopServiceDto })).rejects.toThrow();
    await expect(pipe.transform({ durationKind: null }, { type: 'body', metatype: UpdateShopServiceDto })).rejects.toThrow();
    expect((await pipe.transform({ serviceId: '1', name: 'Reservation block', durationMin: 240, priceCents: 8000 }, { type: 'body', metatype: CreateVariantDto })).durationMin).toBe(240);
    await expect(pipe.transform({ serviceId: '1', name: 'Variant', durationKind: 'VARIABLE', durationMin: 60, priceCents: 8000 }, { type: 'body', metatype: CreateVariantDto })).rejects.toThrow();
  });
  test('booking DTO accepts optional short-treatment blocks from five through240 without expanding the configured upper limit', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const input = { shopId: '10', serviceId: '20', date: '2035-01-01', startTime: '09:00', contact: { name: 'Synthetic guest', phone: '+12025550100', email: 'synthetic@example.test' } };
    for (const durationMin of [5,15,29,240]) expect((await pipe.transform({ ...input, durationMin }, { type: 'body', metatype: CreateBookingDto })).durationMin).toBe(durationMin);
    for (const durationMin of [0,4,241,15.5]) await expect(pipe.transform({ ...input, durationMin }, { type: 'body', metatype: CreateBookingDto })).rejects.toThrow();
  });
  test('merchant create persists explicit kind under existing catalog authorization with no inferred block', async () => {
    const creates: any[] = [], db: any = { $transaction: async (work: any) => work({
      $queryRaw: async () => [], user: { findFirst: async () => ({ id: 1n }) },
      shop: { findFirst: async () => ({ id: 10n, ownerId: 9n }) },
      shopService: { create: async ({ data }: any) => { creates.push(data); return { id: 20n, ...data }; } }, auditLog: { create: async () => undefined },
    }) };
    const service = new MerchantService(db, {} as any), input = { name: 'Explicit Session', category: 'MASSAGE', durationKind: 'PER_SESSION' as const, durationMin: 180, priceCents: 8000, isActive: false };
    const row = await service.createShopService('1', '10', input, 'ADMIN'); expect(row.durationKind).toBe('PER_SESSION'); expect(row.durationMin).toBe(180);
    for (const durationMin of [null, 0, 4, 241]) await expect(service.createShopService('1', '10', { ...input, durationMin } as any, 'ADMIN')).rejects.toThrow(BadRequestException);
    expect(creates).toHaveLength(1);
  });
  test('company service input preserves omitted existing kind and accepts explicit240 without altering old records implicitly', async () => {
    const studio: any = new StudioService({} as any), db = { $queryRaw: async () => [], user: { findFirst: async () => ({ id: 1n }) }, shop: { findFirst: async () => ({ id: 10n, ownerId: 9n }) } };
    const previous = { id: 20n, shopId: 10n, name: 'Session', category: 'MASSAGE', durationKind: 'PER_SESSION', durationMin: 60, priceCents: 8000, isActive: false };
    const data = await studio.data(db, 'services', { durationMinutes: 240 }, previous, { id: '1', role: 'ADMIN' });
    expect(data.durationKind).toBe('PER_SESSION'); expect(data.durationMin).toBe(240);
    await expect(studio.data(db, 'services', { durationKind: null }, previous, { id: '1', role: 'ADMIN' })).rejects.toThrow(BadRequestException);
    for (const patch of [{ durationMinutes: null }, { durationMinutes: 0 }, { reservedDurationMin: 60 }, { durationKindSnapshot: 'VARIABLE' }]) await expect(studio.data(db, 'services', patch, previous, { id: '1', role: 'ADMIN' })).rejects.toThrow(BadRequestException);
  });
  test('actual booking context validates catalog kind/block and gives frozen snapshot precedence for moves', async () => {
    const row: any = { id: 20n, shopId: 10n, isActive: true, name: 'Session', durationKind: 'PER_SESSION', durationMin: 240, priceCents: 8000, participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, priceBasis: 'PER_PERSON', variants: [] };
    const shop = { id: 10n, deletedAt: null, timezone: 'UTC', businessHours: { monday: { open: '09:00', close: '18:00' } } };
    const db: any = { shop: { findUnique: async () => shop }, shopService: { findUnique: async () => row }, therapist: { findMany: async () => [] }, shopCalendarBlock: { findMany: async () => [], findFirst: async () => null }, bookingResourceLock: { findMany: async () => [] }, booking: { findMany: async () => [] } };
    const service: any = new BookingService(db, {} as any, {} as any, {} as any), input = { shopId: '10', serviceId: '20', date: '2035-01-01' };
    expect(await service.context(db, input, undefined, undefined, true)).toMatchObject({ durationKind: 'PER_SESSION', duration: 240 });
    for (const [kind, duration] of [[null, 60], ['UNKNOWN', 60], ['TIMED', 4], ['VARIABLE', 241], ['PER_SESSION', '60']]) {
      row.durationKind = kind; row.durationMin = duration;
      await expect(service.context(db, input, undefined, undefined, true)).rejects.toThrow(BadRequestException);
    }
    row.durationKind = 'VARIABLE'; row.durationMin = 180;
    const snapshot = { durationKind: 'PER_SESSION', duration: 60, unitPrice: 5000, count: 1, staffBuffer: 0, roomBuffer: 0, roomType: null, currency: 'usd', priceBasis: 'PER_PERSON' };
    expect(await service.context(db, input, 100n, snapshot, true)).toMatchObject({ durationKind: 'PER_SESSION', duration: 60, unitPrice: 5000 });
    const { durationKind: _kind, ...legacy } = snapshot;
    expect(await service.context(db, input, 100n, legacy, true)).toMatchObject({ durationKind: 'TIMED', duration: 60 });
  });
  test('reservation config variants inherit their parent kind and preserve each independent reserved block', async () => {
    const db: any = { user: { findFirst: async () => ({ id: 1n }) }, shop: { findFirst: async () => ({ id: 10n, ownerId: 9n, timezone: 'UTC', businessHours: {}, studioProfile: {} }) },
      shopService: { findMany: async () => [{ id: 20n, shopId: 10n, name: 'Per session', durationKind: 'PER_SESSION', durationMin: 60, variants: [{ id: 30n, durationMin: 180 }] }] },
      therapist: { findMany: async () => [] }, shopRoom: { findMany: async () => [] } };
    const data = await new ReservationsService(db).config('10', { id: '1', role: 'ADMIN' });
    expect(data.services[0]).toMatchObject({ durationKind: 'PER_SESSION', reservedDurationMin: 60 });
    expect(data.services[0].variants[0]).toMatchObject({ durationKind: 'PER_SESSION', durationMin: 180, reservedDurationMin: 180 });
  });
  test('customer, merchant, company and admin historical views project frozen item kinds, including mixed PLAN and live-catalog drift', async () => {
    const original: any = { id: 100n, bookingNo: 'SYNTHETIC', shopId: 10n, serviceId: 20n, userId: 5n, therapistId: null, couponId: null,
      reservationKind: 'PLAN', durationMin: 105, priceCents: 8000, discountCents: 0, platformFeeCents: 0, totalCents: 8000, tipCents: 0, paidCents: 0, refundedCents: 0,
      paymentStatus: 'UNPAID', status: 'PENDING', paymentMode: 'PAY_AT_STORE', bookingDate: new Date('2035-01-01T00:00:00Z'), bookingTimezone: 'UTC',
      startTime: new Date('2035-01-01T09:00:00Z'), endTime: new Date('2035-01-01T10:45:00Z'), createdAt: new Date(), updatedAt: new Date(),
      shop: { id: 10n, name: 'Synthetic', address: '', city: '', state: '', phone: '', timezone: 'UTC', shortName: 'synthetic' },
      service: { id: 20n, name: 'Live catalog changed', durationKind: 'TIMED', durationMin: 240, priceCents: 9900 }, addOns: [], resourceLocks: [],
      items: [{ id: 1000n, bookingId: 100n, serviceId: 20n, participantIndex: 1, sequence: 1, durationKindSnapshot: 'PER_SESSION', durationMin: 60, priceCentsSnapshot: 5000,
        startAtUtc: new Date('2035-01-01T09:00:00Z'), endAtUtc: new Date('2035-01-01T10:00:00Z') },
      { id: 1001n, bookingId: 100n, serviceId: 21n, participantIndex: 1, sequence: 2, durationKindSnapshot: 'VARIABLE', durationMin: 30, priceCentsSnapshot: 3000,
        startAtUtc: new Date('2035-01-01T10:15:00Z'), endAtUtc: new Date('2035-01-01T10:45:00Z') }] };
    const studio: any = new StudioService({} as any), customer = new BookingService({} as any, {} as any, {} as any, {} as any) as any;
    const a = customer.serialize(original), b = studio.map('service-orders', original);
    const authorizationDb: any = { user: { findFirst: async () => ({ id: 1n }) }, shop: { findUnique: async () => ({ id: 10n, timezone: 'UTC' }), findFirst: async () => ({ id: 10n, ownerId: 9n }) },
      $transaction: async (jobs: any[]) => Promise.all(jobs), booking: { findMany: async () => [original], count: async () => 1 } };
    const merchant = await new MerchantService(authorizationDb, {} as any).getShopBookings('1', '10', {}, 'ADMIN');
    const adminDb: any = { booking: { findUnique: async () => original } };
    const admin = await new BookingManageService(adminDb, { findByTarget: async () => [] } as any, {} as any).findOne('100');
    for (const data of [a, b, (merchant as any[])[0], admin]) {
      expect(data).toMatchObject({ durationKind: 'MIXED', durationMin: 105, reservedDurationMin: 105 });
      expect(data.items.map((item: any) => [item.durationKind, item.reservedDurationMin])).toEqual([['PER_SESSION', 60], ['VARIABLE', 30]]);
      expect(data.service).toMatchObject({ durationKind: 'PER_SESSION', durationMin: 60, reservedDurationMin: 60 });
    }
    expect(original.service.durationKind).toBe('TIMED'); expect(original.service.durationMin).toBe(240);
  });
});
