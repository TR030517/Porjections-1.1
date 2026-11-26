import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readMenuCatalog, parseMenuCatalogQuery } from './menu-catalog-reader';
import { MENU_CATALOG_LIMITS } from './menu-catalog-snapshot';
import { ReservationsService } from '../modules/reservations/reservations.service';

const catalogActor = { id: '3', role: 'MERCHANT' };
function service(id = 20n, patch: any = {}) {
  return { id, shopId: 10n, name: 'Synthetic massage', nameEn: 'Massage', category: 'MASSAGE', description: 'Synthetic',
    durationKind: 'TIMED', durationMin: 15, priceCents: 0, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 2,
    requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, isActive: true, sortOrder: 0,
    variants: [{ id: 30n, serviceId: id, name: '60 minutes', durationMin: 60, priceCents: 13057, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true, sortOrder: 0 },
      { id: 31n, serviceId: id, name: '90 minutes', durationMin: 90, priceCents: 16057, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: false, sortOrder: 1 }],
    addOns: [{ id: 40n, serviceId: id, name: 'Oil', description: 'Synthetic', priceCents: 1001, currency: 'usd', isActive: true, sortOrder: 0 }],
    studioProfile: { privateContact: 'private@example.test' }, owner: { passwordHash: 'Synthetic-never-serialize' }, ...patch };
}
function fixture() {
  const rows: any[] = [service(), service(21n, { name: 'Foot care', nameEn: null, isActive: false, durationMin: 60, priceCents: 5000, variants: [], addOns: [] })];
  const state = { operatorActive: true, grant: ['CATALOG_MANAGE'] };
  const order: string[] = [];
  const shop: any = { id: 10n, ownerId: 99n, status: 'PENDING', deletedAt: null, loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } } };
  const matches = (row: any, where: any) => row.shopId === where.shopId
    && (!where.id || (typeof where.id === 'object' ? where.id.in.includes(row.id) : row.id === where.id))
    && (!where.OR || where.OR.some((part: any) => Object.entries(part).some(([field, filter]: [string, any]) => String(row[field] ?? '').includes(filter.contains))));
  const rejectRead = () => jest.fn(() => { throw Error('Unrelated resource must not be read'); });
  const tx: any = {
    user: { findFirst: jest.fn(async ({ where }: any) => { order.push('operator'); return state.operatorActive && [1n, 2n, 3n, 4n].includes(where.id) ? { id: where.id } : null; }) },
    shop: { findFirst: jest.fn(async ({ where }: any) => { order.push('shop'); return where.id === 10n && !shop.deletedAt ? shop : null; }) },
    shopAccountGrant: { findFirst: jest.fn(async ({ where }: any) => {
      order.push('grant');
      return where.sourceShop.loginBinding.is.userId === 3n ? { sourceShopId: 11n, permissions: state.grant, sourceShop: { status: 'APPROVED' } } : null;
    }) },
    shopService: {
      findMany: jest.fn(async ({ where, select, skip = 0, take }: any) => {
        order.push('catalog');
        return rows.filter(row => matches(row, where)).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)).slice(skip, skip + take).map(row => ({
          ...row, _count: { variants: row.variants.length, addOns: row.addOns.length },
          variants: row.variants.slice(0, select.variants.take), addOns: row.addOns.slice(0, select.addOns.take),
        }));
      }),
      count: jest.fn(async ({ where }: any) => { order.push('count'); return rows.filter(row => matches(row, where)).length; }),
      create: jest.fn(() => { throw Error('Read must never create'); }), update: jest.fn(() => { throw Error('Read must never update'); }),
    },
    therapist: { findMany: rejectRead() }, shopRoom: { findMany: rejectRead() }, booking: { findMany: rejectRead() }, paymentRecord: { findMany: rejectRead() },
    $queryRaw: jest.fn(() => { throw Error('Read must never acquire raw locks'); }), $executeRaw: jest.fn(() => { throw Error('Read must never write'); }),
  };
  const db: any = { $transaction: jest.fn(async (work: any, options: any) => {
    expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
    return work(tx);
  }), ...tx };
  return { rows, shop, state, tx, db, order, read: (query: any, actor = catalogActor, shopId = '10') => readMenuCatalog(db, shopId, actor, query) };
}

describe('current-shop read-only menu catalog', () => {
  test('catalog-only associated editors can read inactive parents without acquiring reservation policy rights', async () => {
    const f = fixture(), result = await f.read({ kind: 'service', page: '1', pageSize: '1' });
    expect(result).toMatchObject({ shopId: '10', kind: 'service', q: '', page: 1, pageSize: 1, total: 2, hasMore: true, canConfigurePolicy: false });
    expect(result.items[0]).toMatchObject({ serviceId: '21', isActive: false, parentIsActive: false, hasVariants: false });
    expect(result.items[0].preview).toMatchObject({ bookingEnabled: false, bookingAvailable: false });
    expect(f.order.slice(0, 3)).toEqual(['operator', 'shop', 'grant']);
    expect(f.tx.shopService.findMany.mock.calls[0][0].where).toEqual({ shopId: 10n });
    expect(f.tx.$queryRaw).not.toHaveBeenCalled(); expect(f.tx.$executeRaw).not.toHaveBeenCalled(); expect(f.tx.shopService.update).not.toHaveBeenCalled();
    for (const model of ['therapist', 'shopRoom', 'booking', 'paymentRecord']) expect(f.tx[model].findMany).not.toHaveBeenCalled();
    await expect(new ReservationsService(f.db).config('10', catalogActor)).rejects.toThrow(ForbiddenException);
  });
  test('service query supports an exact same-shop parent ID without exposing its unusable base as a binding', async () => {
    const f = fixture(), result = await f.read({ kind: 'service', serviceId: '20', q: 'massage' });
    expect(result).toMatchObject({ serviceId: '20', q: 'massage', total: 1, hasMore: false });
    expect(result.items[0]).toMatchObject({ serviceId: '20', hasVariants: true, variantCount: 2, addOnCount: 1, preview: null });
    expect(f.tx.shopService.findMany.mock.calls[0][0].where).toEqual({ id: { in: [20n] }, shopId: 10n });
    expect(await f.read({ kind: 'service', serviceId: '20', q: 'no matching name' })).toMatchObject({ serviceId: '20', total: 0, items: [] });
    await expect(f.read({ kind: 'service', serviceId: '99' })).rejects.toThrow(NotFoundException);
  });
  test('child pages include inactive options and canonical whole-visit price while hashing every sibling', async () => {
    const f = fixture(), first = await f.read({ kind: 'variant', serviceId: '20', pageSize: '1' });
    expect(first).toMatchObject({ kind: 'variant', serviceId: '20', total: 2, hasMore: true });
    expect(first.items[0]).toMatchObject({ serviceId: '20', variantId: '30', isActive: true, parentIsActive: true, variantCount: 2,
      preview: { booking: { serviceId: '20', variantId: '30' }, pricing: { priceCents: 13057, durationMin: 60 }, bookingEnabled: true } });
    const second = await f.read({ kind: 'variant', serviceId: '20', page: '2', pageSize: '1' });
    expect(second.items[0]).toMatchObject({ variantId: '31', isActive: false, preview: { pricing: { priceCents: 16057 }, bookingEnabled: false, bookingAvailable: false } });
    expect(first.items[0].selectionRevision).toBe(second.items[0].selectionRevision);
    f.rows[0].variants[1].priceCents++;
    const changed = await f.read({ kind: 'variant', serviceId: '20', pageSize: '1' });
    expect(changed.items[0].selectionRevision).not.toBe(first.items[0].selectionRevision);
  });
  test('paused parents retain a child checkbox state while their preview reports effective unavailability', async () => {
    const f = fixture(); f.rows[0].isActive = false;
    const result = await f.read({ kind: 'addOn', serviceId: '20', q: 'Oil' });
    expect(result).toMatchObject({ total: 1, items: [{ addOnId: '40', name: 'Oil', isActive: true, parentIsActive: false,
      preview: { pricing: { kind: 'ADD_ON', durationMin: null, priceCents: 1001 }, bookingEnabled: true, bookingAvailable: false, bookingUnavailableReason: 'PARENT_PAUSED' } }] });
  });
  test('child searches and pages cannot expand past their rechecked current-shop parent', async () => {
    const f = fixture(); f.rows.push(service(99n, { shopId: 11n, name: 'Foreign parent' }));
    await expect(f.read({ kind: 'variant', serviceId: '99' })).rejects.toThrow(NotFoundException);
    expect(f.tx.shopService.findMany.mock.calls[0][0].where).toEqual({ shopId: 10n, id: { in: [99n] } });
    const own = await f.read({ kind: 'variant', serviceId: '20', q: '90', pageSize: '25' });
    expect(own).toMatchObject({ total: 1, items: [{ variantId: '31' }] });
  });
  test('no credentials, personal scheduling data or raw model properties leave the reader', async () => {
    const f = fixture(), result = await f.read({ kind: 'service' }), json = JSON.stringify(result);
    for (const hidden of ['private@example.test', 'passwordHash', 'Synthetic-never-serialize', 'studioProfile', 'ownerId', 'timeOff', 'maintenance']) expect(json).not.toContain(hidden);
    expect(result.items.every(row => typeof row.serviceId === 'string' && /^[a-f0-9]{64}$/.test(row.selectionRevision))).toBe(true);
  });
  test('ADMIN, bound owner and an explicit existing policy grant report policy capability without new grants', async () => {
    const f = fixture();
    for (const actor of [{ id: '1', role: 'ADMIN' }, { id: '2', role: 'MERCHANT' }]) expect((await f.read({ kind: 'service' }, actor)).canConfigurePolicy).toBe(true);
    f.state.grant.push('RESERVATION_CONFIG'); expect((await f.read({ kind: 'service' })).canConfigurePolicy).toBe(true);
  });
  test.each(['STAFF', 'CUSTOMER'])('%s cannot reach catalog queries through reservation roles', async role => {
    const f = fixture(); await expect(f.read({ kind: 'service' }, { id: '4', role })).rejects.toThrow(ForbiddenException);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  test('foreign users, revoked operators and missing parents fail before catalog reads', async () => {
    const foreign = fixture(); await expect(foreign.read({ kind: 'service' }, { id: '4', role: 'MERCHANT' })).rejects.toThrow(ForbiddenException);
    expect(foreign.tx.shopService.findMany).not.toHaveBeenCalled();
    const revoked = fixture(); revoked.state.operatorActive = false; await expect(revoked.read({ kind: 'service' })).rejects.toThrow(ForbiddenException);
    expect(revoked.tx.shop.findFirst).not.toHaveBeenCalled();
    await expect(fixture().read({ kind: 'service' }, catalogActor, '11')).rejects.toThrow(NotFoundException);
  });
  test.each(['variants', 'addOns'] as const)('oversized %s produce an explicit error instead of a truncated version', async kind => {
    const f = fixture(), parent = f.rows[0], limit = MENU_CATALOG_LIMITS[kind];
    parent[kind] = Array.from({ length: limit + 1 }, (_, index) => ({ id: BigInt(index + 100), serviceId: parent.id, name: 'Synthetic' }));
    try { await f.read({ kind: 'service', serviceId: '20' }); throw Error('Expected cap rejection'); }
    catch (error: any) { expect(error.getResponse?.()).toMatchObject({ code: 'MENU_CATALOG_TOO_LARGE', resource: kind }); }
  });
  test.each([
    {}, { kind: 'unknown' }, { kind: 'variant' }, { kind: 'addOn', serviceId: '01' }, { kind: 'service', page: '0' },
    { kind: 'service', page: ['1'] }, { kind: 'service', pageSize: '51' }, { kind: 'service', q: ['name'] },
    { kind: 'service', q: '\u0000' }, { kind: 'service', q: 'x'.repeat(101) }, { kind: 'service', actorId: '9' },
  ])('query shapes remain explicit and bounded (%p)', query => {
    expect(() => parseMenuCatalogQuery(query)).toThrow(BadRequestException);
  });
});

