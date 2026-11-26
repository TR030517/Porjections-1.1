import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readShopStaffing, setShopStaffing, staffingTarget, STAFFING_LIMITS } from './shop-staffing';

const now = new Date('2035-01-01T08:00:00Z');
const owner = { id: '2', role: 'MERCHANT' }, admin = { id: '1', role: 'ADMIN' }, staff = { id: '4', role: 'STAFF' };
const profile = (id: bigint, extra: any = {}) => ({ id, shopId: 10n, name: 'Therapist ' + (Number(id) - 7), avatarUrl: null, title: null,
  bio: null, yearsExp: 0, gender: null, isActive: true, scheduleMode: 'SHOP', sortOrder: Number(id), updatedAt: new Date('2034-01-01T00:00:00Z'), ...extra });
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (key === 'booking') return matches(row.booking, value);
    if (key === 'items') return row.items.length === 0;
    if (value === null || typeof value !== 'object' || value instanceof Date) return row[key] === value;
    return Object.entries(value).every(([operator, operand]: [string, any]) => operator === 'in' ? operand.includes(row[key])
      : operator === 'not' ? row[key] !== operand : operator === 'gt' ? row[key] != null && row[key] > operand : false);
  });
}

/** Staged state verifies composition and rollback, not physical MySQL locking.
 * A serialized transaction queue represents the shared shop mutex for CAS. */
function fixture(options: { grant?: readonly string[]; associated?: readonly string[]; auditFailure?: boolean; conflicts?: number; rows?: any[] } = {}) {
  let committed = { therapists: options.rows ?? [profile(8n), profile(9n)], audits: [] as any[], locks: [] as any[], bookings: [] as any[] };
  const events: string[] = [], writeAttempts: any[] = [], queries: any[] = [];
  let queued: Promise<unknown> = Promise.resolve(), conflicts = options.conflicts ?? 0;
  const db: any = { $transaction: jest.fn((work: any, settings: any) => {
    const operation = queued.then(async () => {
      if (conflicts-- > 0) throw Object.assign(new Error('Synthetic conflict before callback'), { code: 'P2034' });
      const staged = structuredClone(committed);
      const tx: any = {
        $queryRaw: jest.fn(async (sql: any) => { events.push(sql.sql.includes('shops') ? 'lock-shop' : 'lock-user'); return []; }),
        user: { findFirst: jest.fn(async ({ where }: any) => {
          events.push('user'); return [['1', 'ADMIN'], ['2', 'MERCHANT'], ['3', 'MERCHANT'], ['4', 'STAFF']]
            .some(([id, role]) => String(where.id) === id && where.role === role) ? { id: where.id } : null;
        }) },
        shop: { findFirst: jest.fn(async ({ where }: any) => { events.push('shop'); return where.id === 10n ? {
          id: 10n, deletedAt: null, status: 'APPROVED', loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } },
        } : null; }) },
        shopAccountGrant: { findFirst: jest.fn(async () => options.associated ? {
          status: 'ACTIVE', sourceShopId: 11n, permissions: options.associated,
        } : null) },
        shopStaffGrant: { findUnique: jest.fn(async ({ where }: any) => where.shopId_userId.shopId === 10n && where.shopId_userId.userId === 4n
          ? { status: 'ACTIVE', permissions: options.grant ?? [] } : null) },
        therapist: {
          findMany: jest.fn(async ({ where, take }: any) => { queries.push({ model: 'therapist', where, take });
            return staged.therapists.filter(row => row.shopId === where.shopId).sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1)).slice(0, take);
          }),
          create: jest.fn(async ({ data }: any) => { writeAttempts.push({ create: data }); events.push('write');
            const id = staged.therapists.reduce((max, row) => row.id > max ? row.id : max, 99n) + 1n;
            const row = { id, ...data, updatedAt: new Date() }; staged.therapists.push(row); return row;
          }),
          update: jest.fn(async ({ where, data }: any) => { writeAttempts.push({ update: where.id, data }); events.push('write');
            const row = staged.therapists.find(row => row.id === where.id); if (!row) throw Error('Missing synthetic therapist');
            Object.assign(row, data, { updatedAt: new Date() }); return row;
          }),
        },
        bookingResourceLock: { findMany: jest.fn(async ({ where }: any) => { queries.push({ model: 'locks', where }); return staged.locks.filter(row => matches(row, where)); }) },
        booking: { findMany: jest.fn(async ({ where }: any) => { queries.push({ model: 'legacy', where }); return staged.bookings.filter(row => matches(row, where)); }) },
        auditLog: { create: jest.fn(async ({ data }: any) => { events.push('audit'); if (options.auditFailure) throw Error('Synthetic audit failure'); staged.audits.push(data); return data; }) },
      };
      const result = await work(tx); committed = staged; events.push('commit'); return result;
    });
    queued = operation.catch(() => undefined);
    expect([Prisma.TransactionIsolationLevel.ReadCommitted, Prisma.TransactionIsolationLevel.RepeatableRead]).toContain(settings.isolationLevel);
    return operation;
  }) };
  const read = (actor = owner, shopId = '10') => readShopStaffing(db, shopId, actor);
  const set = (targetActiveCount: number, expectedRevision: string, actor = owner, shopId = '10') => setShopStaffing(db, shopId, actor, { targetActiveCount, expectedRevision });
  const booking = (extra: any = {}) => ({ shopId: 10n, deletedAt: null, status: 'CONFIRMED', paymentStatus: 'UNPAID', paidCents: 0,
    holdExpiresAt: null, therapistId: 9n, startTime: new Date('2035-01-01T09:00:00Z'), endTime: new Date('2035-01-01T10:00:00Z'), items: [], ...extra });
  const lock = (resourceId = 9n, extra: any = {}) => ({ shopId: 10n, resourceType: 'THERAPIST', resourceId, status: 'ACTIVE',
    endAtUtc: new Date('2035-01-01T10:15:00Z'), booking: booking(), ...extra });
  return { db, read, set, events, writeAttempts, queries, state: () => committed, booking, lock };
}

describe('atomic shop staffing target', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => { jest.useRealTimers(); });

  test('count increase creates actual SHOP calendars without mapping rows, preserving all existing profiles and CUSTOM exceptions', async () => {
    const custom = profile(8n, { name: 'Existing individual', title: 'Experienced', bio: 'Keep biography', yearsExp: 8, gender: 'FEMALE',
      avatarUrl: '/media/synthetic.jpg', scheduleMode: 'CUSTOM', shifts: [{ weekday: 1, startMin: 600, endMin: 900 }], timeOff: [{ id: 70n }] });
    const inactive = profile(9n, { isActive: false, name: 'Therapist 1', scheduleMode: 'CUSTOM' });
    const f = fixture({ rows: [custom, inactive] }), before = structuredClone(f.state().therapists), view = await f.read();
    const result = await f.set(3, view.revision);
    expect(result).toMatchObject({ shopId: '10', activeCount: 3, serviceAccessMode: 'SHOP_ALL', deactivatedIds: [] });
    expect(result.createdIds).toHaveLength(2); expect(result.revision).not.toBe(view.revision);
    expect(f.state().therapists.slice(0, 2)).toEqual(before);
    expect(f.state().therapists.slice(2)).toEqual(result.createdIds.map((id, i) => expect.objectContaining({ id: BigInt(id), shopId: 10n,
      name: 'Therapist ' + (i + 2), yearsExp: 0, gender: null, avatarUrl: null, title: null, bio: null, scheduleMode: 'SHOP', isActive: true })));
    expect(f.events.slice(f.events.indexOf('lock-shop'), f.events.indexOf('lock-shop') + 3)).toEqual(['lock-shop', 'user', 'shop']);
    expect(f.state().audits).toHaveLength(1); expect(f.state().audits[0].detail).toMatchObject({ previousActiveCount: 1, targetActiveCount: 3 });
    expect(f.queries.filter(query => query.model === 'therapist').every(query => query.where.shopId === 10n && Object.keys(query.where).length === 1)).toBe(true);
  });

  test('two simultaneous requests against the same collection revision increase only once; lost acknowledgement cannot silently choose another batch', async () => {
    const f = fixture(), initial = await f.read();
    const outcomes = await Promise.allSettled([f.set(3, initial.revision), f.set(3, initial.revision)]);
    expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes[1] as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException); expect(rejected.reason.getResponse()).toMatchObject({ code: 'STAFFING_CHANGED' });
    expect(f.state().therapists.filter(row => row.isActive)).toHaveLength(3); expect(f.writeAttempts).toHaveLength(1);
    await expect(f.set(3, initial.revision)).rejects.toThrow(ConflictException);
    const current = await f.read(); expect(await f.set(3, current.revision)).toMatchObject({ activeCount: 3, revision: current.revision, createdIds: [], deactivatedIds: [] });
    expect(f.writeAttempts).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
  });

  test('revision detects additions, activation and profile/schedule changes, is shop-bound, and never includes private relations', async () => {
    const f = fixture(), initial = await f.read();
    expect(initial.revision).toMatch(/^[a-f0-9]{64}$/); expect(await f.read()).toEqual(initial);
    f.state().therapists[0].name = 'Changed independently';
    await expect(f.set(1, initial.revision)).rejects.toThrow(ConflictException); expect(f.writeAttempts).toHaveLength(0);
    const changed = await f.read(); expect(changed.revision).not.toBe(initial.revision);
    f.state().therapists[0].scheduleMode = 'CUSTOM'; expect((await f.read()).revision).not.toBe(changed.revision);
    f.state().therapists[0].account = { syntheticPassword: 'not-public' };
    f.state().therapists[0].timeOff = [{ reason: 'not-public' }];
    const safe = await f.read(); expect(safe.therapists[0]).not.toHaveProperty('account'); expect(safe.therapists[0]).not.toHaveProperty('timeOff');
    await expect(f.read(owner, '11')).rejects.toThrow(NotFoundException);
  });

  test('decrease skips occupied staff, selects the complete deterministic safe batch, and retains history', async () => {
    const f = fixture({ rows: [profile(8n), profile(9n), profile(10n)] }); f.state().locks.push(f.lock(10n));
    const initial = await f.read(), result = await f.set(2, initial.revision);
    expect(result.deactivatedIds).toEqual(['9']); expect(result.createdIds).toEqual([]);
    expect(f.state().therapists).toHaveLength(3); expect(f.state().therapists.find(row => row.id === 10n)?.isActive).toBe(true);
    expect(f.writeAttempts).toEqual([{ update: 9n, data: { isActive: false } }]);
  });

  test('not enough safely removable staff returns specific busy people with zero partial writes', async () => {
    const f = fixture({ rows: [profile(8n), profile(9n), profile(10n)] }); f.state().locks.push(f.lock(10n));
    const initial = await f.read(), before = structuredClone(f.state());
    try { await f.set(0, initial.revision); throw Error('Expected busy conflict'); }
    catch (error) { expect(error).toBeInstanceOf(ConflictException); expect((error as ConflictException).getResponse()).toMatchObject({ code: 'STAFFING_BUSY', fields: { '10': expect.stringContaining('不能停用') } }); }
    expect(f.state()).toEqual(before); expect(f.writeAttempts).toHaveLength(0);
  });

  test.each([
    { status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, holdExpiresAt: now, ignored: true },
    { status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, holdExpiresAt: new Date(+now + 1), ignored: false },
    { status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 1, holdExpiresAt: new Date(+now - 1), ignored: false },
    { status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, holdExpiresAt: null, ignored: false },
    { status: 'COMPLETED', paymentStatus: 'PAID', paidCents: 6000, holdExpiresAt: null, ignored: false },
  ])('resource protection matches existing effective holds and terminal cleanup (%p)', async ({ ignored, ...patch }) => {
    const f = fixture(); f.state().locks.push(f.lock(9n, { booking: f.booking(patch) })); f.state().locks.push(f.lock(8n));
    const initial = await f.read();
    if (ignored) expect(await f.set(1, initial.revision)).toMatchObject({ deactivatedIds: ['9'] });
    else await expect(f.set(1, initial.revision)).rejects.toThrow(ConflictException);
  });

  test('legacy unassigned reservations fence the entire pool, while other-shop locks and room locks cannot claim its calendars', async () => {
    const f = fixture(); f.state().bookings.push(f.booking({ therapistId: null }));
    const initial = await f.read(); await expect(f.set(1, initial.revision)).rejects.toThrow(ConflictException); expect(f.writeAttempts).toHaveLength(0);
    f.state().bookings = []; f.state().locks.push(f.lock(9n, { shopId: 11n }), f.lock(8n, { resourceType: 'ROOM' }));
    expect(await f.set(0, initial.revision)).toMatchObject({ activeCount: 0, deactivatedIds: ['9', '8'] });
  });

  test('an audit failure rolls back every selected deactivation and new calendar', async () => {
    for (const target of [0, 4]) {
      const f = fixture({ auditFailure: true }), initial = await f.read(), before = structuredClone(f.state());
      await expect(f.set(target, initial.revision)).rejects.toThrow('Synthetic audit failure'); expect(f.state()).toEqual(before);
    }
  });

  test('ADMIN, own account and associated CAT keep the existing staff CRUD authority; RES-only reads exceptions without gaining count writes', async () => {
    for (const [actor, options] of [[admin, {}], [owner, {}], [{ id: '3', role: 'MERCHANT' }, { associated: ['CATALOG_MANAGE'] }]] as const) {
      const f = fixture(options), current = await f.read(actor); expect(current.canManageStaff).toBe(true);
      expect((await f.set(3, current.revision, actor)).activeCount).toBe(3);
    }
    for (const [actor, options] of [[staff, { grant: ['RESERVATION_CONFIG'] }], [{ id: '3', role: 'MERCHANT' }, { associated: ['RESERVATION_CONFIG'] }]] as const) {
      const f = fixture(options), current = await f.read(actor); expect(current).toMatchObject({ canManageStaff: false, canManageExceptions: true });
      await expect(f.set(3, current.revision, actor)).rejects.toThrow(ForbiddenException); expect(f.writeAttempts).toHaveLength(0);
    }
    for (const [actor, options] of [[staff, { grant: ['BOOKINGS_READ'] }], [{ id: '3', role: 'MERCHANT' }, {}]] as const) {
      const f = fixture(options), current = await f.read(); await expect(f.set(3, current.revision, actor)).rejects.toThrow(ForbiddenException); expect(f.writeAttempts).toHaveLength(0);
    }
    const f = fixture(); await expect(f.read({ id: '5', role: 'CUSTOMER' })).rejects.toThrow(ForbiddenException); expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  test('bounded collection never silently truncates revision and database conflicts retain the same requested target/CAS', async () => {
    const tooMany = fixture({ rows: Array.from({ length: STAFFING_LIMITS.records + 1 }, (_, i) => profile(BigInt(i + 8))) });
    await expect(tooMany.read()).rejects.toThrow(ServiceUnavailableException); expect(tooMany.writeAttempts).toHaveLength(0);
    const f = fixture(), current = await f.read();
    const retry = fixture({ conflicts: 1 }); expect(await retry.set(3, current.revision)).toMatchObject({ activeCount: 3 }); expect(retry.writeAttempts).toHaveLength(1);
  });

  test.each([{}, { targetActiveCount: '2', expectedRevision: 'a'.repeat(64) }, { targetActiveCount: 1.2, expectedRevision: 'a'.repeat(64) },
    { targetActiveCount: -1, expectedRevision: 'a'.repeat(64) }, { targetActiveCount: 101, expectedRevision: 'a'.repeat(64) },
    { targetActiveCount: 1, expectedRevision: 'A'.repeat(64) }, { targetActiveCount: 1, expectedRevision: 'a'.repeat(64), serviceIds: [] }])('rejects ambiguous or policy-bearing payload before writing (%p)', raw => {
    expect(() => staffingTarget(raw)).toThrow(BadRequestException);
  });
});
