import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { CreateTimeOffDto, UpdateVariantDto } from './reservation.dto';
import { coveredByShifts, ReservationsService } from './reservations.service';
import { id, object, policyInput, roomInput, variantInput, windowInput } from './reservation-validation';

const actor = { id: '2', role: 'MERCHANT' };
const variant = { id: 11n, serviceId: 7n, name: '60 minutes', durationMin: 60, priceCents: 5735, currency: 'usd', isActive: true, sortOrder: 0 };
const policy = { participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0 };
const shift = { id: 21n, therapistId: 8n, weekday: 3, startMin: 540, endMin: 1080, isActive: true };
const room = { id: 31n, shopId: 1n, name: 'Room A', roomType: 'SINGLE', capacity: 1, isActive: true };
const occupation = { startAtUtc: new Date('2040-10-24T13:00:00Z'), endAtUtc: new Date('2040-10-24T14:10:00Z') };

/** Atomicity substitute: staged data is committed only on callback success.
 * This asserts transaction composition, not actual MySQL locking/rollback behavior. */
function fixture(options: { ownerId?: bigint; bindingUserId?: bigint | null; grantPermissions?: string[]; legacyVariant?: boolean; occupied?: boolean; usedVariant?: boolean; usedService?: boolean; auditFailure?: boolean; shifts?: any[]; legacy?: boolean; retry?: boolean; scheduleMode?: string; businessHours?: any; servicePolicy?: Record<string, unknown> } = {}) {
  let committed = { variants: [structuredClone({ ...variant, ...(options.legacyVariant ? { priceBasis: 'PER_PERSON' } : {}) })], audits: [] as any[] };
  const events: string[] = [];
  let tx: any;
  const prisma: any = {
    $transaction: jest.fn(async (callback: any, isolation: any) => {
      expect(isolation.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted);
      if (options.retry) throw Object.assign(new Error('Synthetic write conflict'), { code: 'P2034' });
      const staged = structuredClone(committed);
      const delegate = (existing: any) => ({
        findFirst: jest.fn(async () => existing),
        create: jest.fn(async ({ data }: any) => { events.push('write'); const row = { id: 90n, ...data }; staged.variants.push(row); return row; }),
        update: jest.fn(async ({ data }: any) => { events.push('write'); const row = { ...existing, ...data }; staged.variants[0] = row; return row; }),
        delete: jest.fn(async () => { events.push('delete'); return existing; }),
      });
      tx = {
        user: { findFirst: jest.fn(async ({ where }: any) => where.id === 2n && where.role === 'MERCHANT' && where.status === 'ACTIVE' && where.deletedAt === null ? { id: 2n } : null) },
        $queryRaw: jest.fn(async (query: any) => { const sql = query.sql ?? query.join(''); events.push(sql.includes('users') ? 'lock-user' : 'lock-shop'); return [{ id: 1n }]; }),
        shop: { findFirst: jest.fn(async () => { events.push('read-shop'); return { id: 1n, ownerId: options.ownerId ?? 2n, owner: { role: 'MERCHANT', status: 'SUSPENDED', deletedAt: null }, loginBinding: options.bindingUserId === null ? null : { userId: options.bindingUserId ?? 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } }, timezone: 'America/New_York', businessHours: options.businessHours }; }) },
        shopAccountGrant: { findFirst: jest.fn(async ({ select }: any) => options.grantPermissions ? select ? { sourceShopId: 20n } : { sourceShopId: 20n, permissions: options.grantPermissions, status: 'ACTIVE' } : null) },
        shopService: { ...delegate({ id: 7n, shopId: 1n, ...policy, ...options.servicePolicy }), findFirst: jest.fn(async ({ where }: any) => where.id === 7n && where.shopId === 1n ? { id: 7n, shopId: 1n, ...policy, ...options.servicePolicy } : null) },
        therapist: { findFirst: jest.fn(async ({ where }: any) => where.id === 8n && where.shopId === 1n ? { id: 8n, shopId: 1n, scheduleMode: options.scheduleMode ?? 'CUSTOM' } : null), update: jest.fn(async ({ data }: any) => { events.push('write'); return { id: 8n, ...data }; }) },
        shopServiceVariant: delegate(staged.variants[0]),
        therapistShift: { ...delegate(shift), findMany: jest.fn(async () => options.shifts ?? []) },
        therapistTimeOff: delegate({ id: 41n, therapistId: 8n, ...occupation, reason: null }),
        shopCalendarBlock: { findFirst: jest.fn(async () => null) },
        shopRoom: { ...delegate(room), findFirst: jest.fn(async ({ where }: any) => where.id === 31n && where.shopId === 1n ? room : null) },
        roomMaintenance: delegate({ id: 51n, roomId: 31n, ...occupation, reason: null }),
        bookingResourceLock: { findMany: jest.fn(async () => options.occupied ? [occupation] : []) },
        booking: {
          findMany: jest.fn(async () => options.legacy ? [{ startTime: occupation.startAtUtc, endTime: occupation.endAtUtc }] : []),
          findFirst: jest.fn(async () => options.usedService ? { id: 101n } : null),
        },
        bookingItem: { findFirst: jest.fn(async () => options.usedVariant ? { id: 101n } : null) },
        auditLog: { create: jest.fn(async ({ data }: any) => { events.push('audit'); if (options.auditFailure) throw new Error('Synthetic audit unavailable'); staged.audits.push(data); return { id: 1n, ...data }; }) },
      };
      const result = await callback(tx);
      committed = staged; events.push('commit'); return result;
    }),
  };
  return { service: new ReservationsService(prisma), prisma, events, tx: () => tx, state: () => structuredClone(committed) };
}

describe('reservation configuration validation', () => {
  test.each(['0', '-1', '1.2', '01', '9223372036854775808', 1, null])('rejects invalid or unsafe resource ID %p', value => {
    expect(() => id(value)).toThrow(BadRequestException);
  });
  test('retains exact maximum signed BigInt without Number conversion', () => {
    expect(id('9223372036854775807')).toBe(9223372036854775807n);
  });
  test('supports two staff for couples or four hands, with optional explicitly compatible rooms', () => {
    expect(() => policyInput({ ...policy, participantCount: 2 })).toThrow(BadRequestException);
    expect(policyInput({ ...policy, requiredStaffCount: 2, requiredRoomType: 'SINGLE' })).toMatchObject({ participantCount: 1, requiredStaffCount: 2 });
    expect(policyInput({ ...policy, participantCount: 2, requiredStaffCount: 2 })).toMatchObject({ requiredStaffCount: 2, requiredRoomType: null });
    expect(policyInput({ ...policy, participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' }).requiredStaffCount).toBe(2);
    for (const requiredRoomType of ['SINGLE', 'FOOT_SEAT']) expect(() => policyInput({ ...policy, participantCount: 2, requiredStaffCount: 2, requiredRoomType })).toThrow(BadRequestException);
  });
  test('independent foot seats and single rooms cannot declare shared capacity', () => {
    expect(() => roomInput({ ...room, capacity: 2 })).toThrow(BadRequestException);
    expect(() => roomInput({ ...room, roomType: 'FOOT_SEAT', capacity: 2 })).toThrow(BadRequestException);
    expect(() => roomInput({ ...room, roomType: 'COUPLE', capacity: 1 })).toThrow(BadRequestException);
  });
  test('validates per-person integer cents and does not reinterpret currencies', () => {
    expect(variantInput(variant).priceCents).toBe(5735);
    for (const priceCents of [0, 57.35, 10000001]) expect(() => variantInput({ ...variant, priceCents })).toThrow(BadRequestException);
    expect(() => variantInput({ ...variant, currency: 'eur' })).toThrow(BadRequestException);
    expect(() => variantInput({ ...variant, durationMin: 241 })).toThrow(BadRequestException);
  });
  test('rejects nested writes and patch parent reassignment in real DTO validation', async () => {
    expect(() => object({ service: { connect: { id: '9' } } }, ['name'])).toThrow(BadRequestException);
    const errors = await validate(plainToInstance(UpdateVariantDto, { serviceId: '9', priceCents: 100 }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some(error => error.property === 'serviceId')).toBe(true);
  });
  test('requires unambiguous real UTC instants and ordered intervals', async () => {
    for (const startAtUtc of ['2040-02-30T09:00:00Z', '2040-10-24T09:00:00-04:00']) {
      expect(() => windowInput({ startAtUtc, endAtUtc: '2040-10-24T10:00:00Z' })).toThrow(BadRequestException);
    }
    expect(() => windowInput({ startAtUtc: '2040-10-24T10:00:00Z', endAtUtc: '2040-10-24T09:00:00Z' })).toThrow(BadRequestException);
    const errors = await validate(plainToInstance(CreateTimeOffDto, { therapistId: '8', startAtUtc: '2040-10-24T09:00:00Z', endAtUtc: '2040-10-24T10:00:00Z', account: { password: 'synthetic' } }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some(error => error.property === 'account')).toBe(true);
  });
  test('staff buffer requires shift coverage; adjacent shifts can cover a whole occupation', () => {
    const weekday = new Date('2040-10-24T12:00:00Z').getUTCDay();
    const s = { ...shift, weekday, startMin: 540, endMin: 600 };
    expect(coveredByShifts(occupation, 'America/New_York', [s])).toBe(false);
    expect(coveredByShifts(occupation, 'America/New_York', [s, { ...s, startMin: 600, endMin: 610 }])).toBe(true);
    expect(coveredByShifts(occupation, null, [s])).toBe(false);
  });
});

describe('reservation configuration transactions (substitute, no database)', () => {
  test('shop mutex is first, ownership is reread, and create plus audit use the same RC transaction', async () => {
    const f = fixture();
    const result: any = await f.service.mutate('1', actor, 'variants', { serviceId: '7', name: 'Fixed price', durationMin: 60, priceCents: 5735 });
    expect(f.events[0]).toBe('lock-shop');
    expect(f.events.indexOf('lock-user')).toBeGreaterThan(f.events.indexOf('read-shop'));
    expect(f.events.lastIndexOf('read-shop')).toBeLessThan(f.events.indexOf('write'));
    expect(f.events.slice(-3)).toEqual(['write', 'audit', 'commit']);
    expect(result.item).toMatchObject({ id: '90', serviceId: '7', priceCents: 5735, currency: 'usd' });
    expect(f.state().audits[0].detail).toEqual({ fields: ['name', 'durationMin', 'priceCents'] });
    expect(f.tx().$queryRaw.mock.calls[0][1]).toBe(1n);
  });
  test('customer is denied without a transaction and another merchant cannot write a locked shop', async () => {
    const f = fixture();
    await expect(f.service.mutate('1', { id: '2', role: 'CUSTOMER' }, 'rooms', room)).rejects.toThrow(BadRequestException);
    // Known valid scalar body reaches the role guard rather than input rejection.
    await expect(f.service.mutate('1', { id: '2', role: 'CUSTOMER' }, 'rooms', { name: 'Room A', roomType: 'SINGLE', capacity: 1 })).rejects.toThrow(ForbiddenException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    const foreign = fixture({ bindingUserId: 99n });
    await expect(foreign.service.mutate('1', actor, 'rooms', { name: 'Room A', roomType: 'SINGLE', capacity: 1 })).rejects.toThrow(ForbiddenException);
    expect(foreign.events[0]).toBe('lock-shop'); expect(foreign.events).toContain('read-shop');
    expect(foreign.events).not.toContain('write'); expect(foreign.state().audits).toEqual([]);
  });
  test('catalog-only controls service variants while reservation-only controls rooms and schedules', async () => {
    const reservationOnly = fixture({ ownerId: 99n, bindingUserId: 99n, grantPermissions: ['RESERVATION_CONFIG'] });
    await expect(reservationOnly.service.mutate('1', actor, 'variants', { serviceId: '7', name: 'New option', durationMin: 60, priceCents: 5735 })).rejects.toThrow(ForbiddenException);
    expect(reservationOnly.events).not.toContain('write'); expect(reservationOnly.state().audits).toEqual([]);
    await expect(reservationOnly.service.mutate('1', actor, 'rooms', { name: 'Room A', roomType: 'SINGLE', capacity: 1 })).resolves.toHaveProperty('item');

    const catalogOnly = fixture({ ownerId: 99n, bindingUserId: 99n, grantPermissions: ['CATALOG_MANAGE'] });
    await expect(catalogOnly.service.mutate('1', actor, 'variants', { serviceId: '7', name: 'New option', durationMin: 60, priceCents: 5735 })).resolves.toHaveProperty('item');
    const before = catalogOnly.state();
    await expect(catalogOnly.service.mutate('1', actor, 'rooms', { name: 'Room A', roomType: 'SINGLE', capacity: 1 })).rejects.toThrow(ForbiddenException);
    expect(catalogOnly.state()).toEqual(before);
  });
  test('a disabled historical owner does not block a separate bound login, but an unbound shop has no owner fallback', async () => {
    const independent = fixture({ ownerId: 99n });
    await expect(independent.service.mutate('1', actor, 'variants', { serviceId: '7', name: 'Synthetic', durationMin: 60, priceCents: 5735 })).resolves.toHaveProperty('item');
    const unbound = fixture({ bindingUserId: null });
    await expect(unbound.service.mutate('1', actor, 'variants', { serviceId: '7', name: 'Synthetic', durationMin: 60, priceCents: 5735 })).rejects.toThrow(ForbiddenException);
    expect(unbound.state().audits).toHaveLength(0);
  });
  test('cross-shop variant parent is rejected before write or audit', async () => {
    const f = fixture();
    await expect(f.service.mutate('1', actor, 'variants', { serviceId: '999', name: 'Invalid', durationMin: 60, priceCents: 100 })).rejects.toThrow(NotFoundException);
    expect(f.events[0]).toBe('lock-shop'); expect(f.events).toContain('read-shop'); expect(f.events).not.toContain('write');
    expect(f.state().audits).toHaveLength(0);
  });
  test('audit failure rolls back the staged configuration (transaction simulator only)', async () => {
    const f = fixture({ auditFailure: true });
    await expect(f.service.mutate('1', actor, 'variants', { serviceId: '7', name: 'Synthetic', durationMin: 60, priceCents: 5735 })).rejects.toThrow('Synthetic audit unavailable');
    expect(f.state().variants).toEqual([variant]); expect(f.state().audits).toHaveLength(0);
    expect(f.events).not.toContain('commit');
  });
  test('price-only updates leave booked snapshots alone; occupied duration changes conflict', async () => {
    const f = fixture({ usedVariant: true });
    const result: any = await f.service.mutate('1', actor, 'variants', { priceCents: 6000 }, '11');
    expect(result.item.priceCents).toBe(6000);
    expect(f.tx().bookingItem.findFirst).not.toHaveBeenCalled();
    const conflict = fixture({ usedVariant: true });
    await expect(conflict.service.mutate('1', actor, 'variants', { durationMin: 90 }, '11')).rejects.toThrow(ConflictException);
    expect(conflict.tx().shopServiceVariant.update).not.toHaveBeenCalled();
  });
  test.each(['patch', 'delete'])('direct variant %s cannot bypass the existing future-booking disable protection', async mode => {
    const f = fixture({ usedVariant: true }), before = f.state();
    await expect(f.service.mutate('1', actor, 'variants', mode === 'patch' ? { isActive: false } : {}, '11', mode === 'delete')).rejects.toThrow(ConflictException);
    expect(f.tx().bookingItem.findFirst.mock.calls[0][0].where).toMatchObject({ variantId: 11n, booking: { shopId: 1n, deletedAt: null, status: { in: ['PENDING', 'CONFIRMED'] },
      OR: expect.arrayContaining([{ status: 'CONFIRMED' }, { paidCents: { gt: 0 } }, { holdExpiresAt: null }]), endTime: { gt: expect.any(Date) } } });
    expect(f.state()).toEqual(before); expect(f.events).not.toContain('write'); expect(f.events).not.toContain('audit'); expect(f.events).not.toContain('commit');
    expect(f.tx().shopServiceVariant.update).not.toHaveBeenCalled();
  });
  test('unoccupied variant disabling remains possible and booked name/price/sort edits never acquire the new guard', async () => {
    const unused = fixture(); await expect(unused.service.mutate('1', actor, 'variants', {}, '11', true)).resolves.toEqual({ success: true });
    expect(unused.state().variants[0].isActive).toBe(false);
    const booked = fixture({ usedVariant: true });
    await expect(booked.service.mutate('1', actor, 'variants', { name: 'Updated label', priceCents: 6101, sortOrder: 4 }, '11')).resolves.toMatchObject({ item: { name: 'Updated label', priceCents: 6101, sortOrder: 4 } });
    expect(booked.tx().bookingItem.findFirst).not.toHaveBeenCalled();
  });
  test('time off checks same-resource half-open conflict including active booking scope', async () => {
    const f = fixture({ occupied: true });
    await expect(f.service.mutate('1', actor, 'time-off', { therapistId: '8', startAtUtc: '2040-10-24T14:00:00Z', endAtUtc: '2040-10-24T15:00:00Z', reason: 'Synthetic leave' })).rejects.toThrow(ConflictException);
    expect(f.tx().bookingResourceLock.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ shopId: 1n, resourceType: 'THERAPIST', resourceId: 8n, status: 'ACTIVE', startAtUtc: { lt: new Date('2040-10-24T15:00:00Z') }, endAtUtc: { gt: new Date('2040-10-24T14:00:00Z') }, booking: expect.objectContaining({ OR: expect.arrayContaining([{ status: { not: 'PENDING' } }]) }) }) }));
    expect(f.tx().therapistTimeOff.create).not.toHaveBeenCalled();
  });
  test('staff buffer prevents shortening a shift and disabling an occupied room is rejected', async () => {
    const f = fixture({ occupied: true });
    await expect(f.service.mutate('1', actor, 'shifts', { weekday: new Date('2040-10-24T12:00:00Z').getUTCDay(), endMin: 600 }, '21')).rejects.toThrow(ConflictException);
    const roomFixture = fixture({ occupied: true });
    await expect(roomFixture.service.mutate('1', actor, 'rooms', {}, '31', true)).rejects.toThrow(ConflictException);
    expect(roomFixture.tx().shopRoom.update).not.toHaveBeenCalled();
  });
  test('maintenance and service policy also protect conservative legacy reservations', async () => {
    const f = fixture({ legacy: true });
    await expect(f.service.mutate('1', actor, 'maintenance', { roomId: '31', startAtUtc: '2040-10-24T14:00:00Z', endAtUtc: '2040-10-24T15:00:00Z' })).rejects.toThrow(ConflictException);
    expect(f.tx().booking.findMany.mock.calls[0][0].where.items).toEqual({ none: {} });
    const used = fixture({ usedService: true });
    await expect(used.service.policy('1', '7', actor, { staffBufferMin: 10 })).rejects.toThrow(ConflictException);
    expect(used.tx().shopService.update).not.toHaveBeenCalled();
  });
  test('resource policy preserves existing catalog price fields without writing them', async () => {
    const f = fixture({ usedService: true, servicePolicy: { priceBasis: 'PER_PERSON' } });
    const result = await f.service.policy('1', '7', actor, policy);
    expect(result.item).toMatchObject({ id: '7', shopId: '1', priceBasis: 'PER_PERSON', ...policy });
    expect(f.tx().booking.findFirst).not.toHaveBeenCalled();
    expect(f.tx().shopService.update).toHaveBeenCalledWith({ where: { id: 7n }, data: policy });
    expect(f.state().audits).toHaveLength(1); expect(f.events.slice(-3)).toEqual(['write', 'audit', 'commit']);
  });
  test.each([{ participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' }, { requiredStaffCount: 2 },
    { requiredRoomType: 'SINGLE' }, { staffBufferMin: 10 }, { roomBufferMin: 10 }])('future reservations protect real resource policy change %p', async changes => {
    const f = fixture({ usedService: true, servicePolicy: { priceBasis: 'PER_PERSON' } }), before = f.state();
    await expect(f.service.policy('1', '7', actor, changes)).rejects.toThrow(ConflictException);
    expect(f.tx().booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ shopId: 1n, endTime: { gt: expect.any(Date) } }) }));
    expect(f.tx().shopService.update).not.toHaveBeenCalled(); expect(f.state()).toEqual(before); expect(f.events).not.toContain('audit');
  });
  test('resource policy requires shop access and rejects catalog price fields', async () => {
    const foreign = fixture({ usedService: true, bindingUserId: 99n, servicePolicy: { priceBasis: 'PER_PERSON' } });
    await expect(foreign.service.policy('1', '7', actor, { staffBufferMin: 0 })).rejects.toThrow(ForbiddenException);
    expect(foreign.tx().shopService.update).not.toHaveBeenCalled();
    const f = fixture({ usedService: true, servicePolicy: { priceBasis: 'PER_PERSON' } });
    await expect(f.service.policy('1', '999', actor, { staffBufferMin: 0 })).rejects.toThrow(NotFoundException);
    await expect(f.service.policy('1', '7', actor, { priceBasis: 'PER_PERSON' } as any)).rejects.toThrow(BadRequestException);
    expect(f.tx().shopService.update).not.toHaveBeenCalled();
  });
  test('new variant writes reject per-person pricing and normalize legacy edits to order-total pricing', async () => {
    const invalid = fixture();
    await expect(invalid.service.mutate('1', actor, 'variants', { serviceId: '7', name: 'New option', durationMin: 60, priceCents: 5735, priceBasis: 'PER_PERSON' })).rejects.toThrow(BadRequestException);
    expect(invalid.tx().shopServiceVariant.create).not.toHaveBeenCalled();
    const legacy = fixture({ legacyVariant: true });
    const result: any = await legacy.service.mutate('1', actor, 'variants', { priceCents: 6000 }, '11');
    expect(result.item.priceBasis).toBe('PER_BOOKING');
  });
  test('schedule mode changes retain saved shifts and reject future buffer coverage loss', async () => {
    const weekday = new Date('2040-10-24T12:00:00Z').getUTCDay();
    const day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][weekday];
    const inherited = fixture({ occupied: true, shifts: [{ ...shift, isActive: false }], businessHours: { [day]: { open: '09:00', close: '18:00' } } });
    await expect(inherited.service.schedule('1', '8', actor, { scheduleMode: 'SHOP' })).resolves.toEqual({ item: { id: '8', scheduleMode: 'SHOP' } });
    expect(inherited.tx().therapistShift.update).not.toHaveBeenCalled(); expect(inherited.tx().therapistShift.delete).not.toHaveBeenCalled();
    expect(inherited.events[0]).toBe('lock-shop'); expect(inherited.events.slice(-3)).toEqual(['write','audit','commit']);
    const tooShort = fixture({ occupied: true, businessHours: { [day]: { open: '09:00', close: '10:00' } } });
    await expect(tooShort.service.schedule('1', '8', actor, { scheduleMode: 'SHOP' })).rejects.toThrow(ConflictException);
    expect(tooShort.tx().therapist.update).not.toHaveBeenCalled();
    const custom = fixture({ occupied: true, scheduleMode: 'SHOP', shifts: [{ ...shift, weekday, endMin: 600 }] });
    await expect(custom.service.schedule('1', '8', actor, { scheduleMode: 'CUSTOM' })).rejects.toThrow(ConflictException);
    expect(custom.tx().therapist.update).not.toHaveBeenCalled();
  });
  test('personal shifts can be prepared without changing inherited availability, while CUSTOM edits retain coverage protection', async () => {
    const inherited = fixture({ occupied: true, scheduleMode: 'SHOP' });
    await expect(inherited.service.mutate('1', actor, 'shifts', { endMin: 600 }, '21')).resolves.toHaveProperty('item');
    expect(inherited.tx().bookingResourceLock.findMany).not.toHaveBeenCalled();
    const custom = fixture({ occupied: true, scheduleMode: 'CUSTOM' });
    await expect(custom.service.mutate('1', actor, 'shifts', { endMin: 600 }, '21')).rejects.toThrow(ConflictException);
  });
  test('schedule switching rejects foreign resources, invalid modes and unexpected fields before writing', async () => {
    const f = fixture();
    await expect(f.service.schedule('1','999',actor,{scheduleMode:'SHOP'})).rejects.toThrow(NotFoundException);
    expect(f.tx().therapist.update).not.toHaveBeenCalled();
    await expect(f.service.schedule('1','8',actor,{scheduleMode:'AUTO'})).rejects.toThrow(BadRequestException);
    await expect(f.service.schedule('1','8',actor,{scheduleMode:'SHOP',shopId:'2'})).rejects.toThrow(BadRequestException);
    await expect(f.service.schedule('1','8',{id:'2',role:'CUSTOMER'},{scheduleMode:'SHOP'})).rejects.toThrow(ForbiddenException);
  });
  test('no raw leave reason is copied to audit, and deleting time off is an audited physical deletion', async () => {
    const f = fixture();
    await f.service.mutate('1', actor, 'time-off', { therapistId: '8', startAtUtc: '2040-10-24T14:00:00Z', endAtUtc: '2040-10-24T15:00:00Z', reason: 'Synthetic personal content' });
    expect(f.state().audits[0].detail.reason).toBe('recorded');
    expect(JSON.stringify(f.state().audits[0].detail)).not.toContain('Synthetic personal content');
    const deleting = fixture();
    await expect(deleting.service.mutate('1', actor, 'time-off', {}, '41', true)).resolves.toEqual({ success: true });
    expect(deleting.tx().therapistTimeOff.delete).toHaveBeenCalledWith({ where: { id: 41n } });
    expect(deleting.tx().auditLog.create.mock.calls[0][0].data.action).toBe('DELETE');
  });
  test('deadlock retry is bounded and exhaustion is retryable rather than sold-out', async () => {
    const f = fixture({ retry: true });
    await expect(f.service.policy('1', '7', actor, { staffBufferMin: 10 })).rejects.toThrow(ServiceUnavailableException);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
