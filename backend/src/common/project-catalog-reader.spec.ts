import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readProjectCatalog, parseProjectCatalogQuery } from './project-catalog-reader';
import { catalogSelectionRevision, MENU_CATALOG_LIMITS, MENU_CATALOG_SELECT } from './menu-catalog-snapshot';
import { ReservationsService } from '../modules/reservations/reservations.service';

const admin = { id: '1', role: 'ADMIN' }, owner = { id: '2', role: 'MERCHANT' }, editor = { id: '3', role: 'MERCHANT' }, staff = { id: '4', role: 'STAFF' };
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(+value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, clone(row)])) as T;
  return value;
}
function parent(id = 20n, extra: any = {}) {
  return { id, shopId: 10n, name: 'Synthetic massage', nameEn: 'Massage', description: 'Description needle', category: 'MASSAGE', isActive: true,
    durationKind: 'TIMED', durationMin: 0, priceCents: 0, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 2, requiredRoomType: null,
    staffBufferMin: 15, roomBufferMin: 10, sortOrder: 0,
    variants: [{ id: 30n, serviceId: id, name: '60 minute option', durationMin: 60, priceCents: 13057, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true, sortOrder: 0 },
      { id: 31n, serviceId: id, name: '90 minute paused option', durationMin: 90, priceCents: 16057, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: false, sortOrder: 1 }],
    addOns: [{ id: 40n, serviceId: id, name: 'Oil', description: 'Extra description', priceCents: 1001, currency: 'usd', isActive: true, sortOrder: 0 },
      { id: 41n, serviceId: id, name: 'Paused extra', description: null, priceCents: 501, currency: 'usd', isActive: false, sortOrder: 1 }],
    owner: { passwordHash: 'HIDDEN_PASSWORD' }, studioProfile: { provider: 'HIDDEN_PROVIDER' }, shifts: ['HIDDEN_SHIFT'], timeOff: ['HIDDEN_LEAVE'], rooms: ['HIDDEN_ROOM'], balanceCents: 9999,
    ...extra };
}
function fixture() {
  const rows: any[] = [parent(), parent(21n, { name: 'Paused malformed legacy', isActive: false, durationKind: 'UNKNOWN', durationMin: 15, variants: [], addOns: [], sortOrder: 1 })];
  const state = { operatorActive: true, grant: ['CATALOG_MANAGE'], staffGrant: ['RESERVATION_CONFIG'], shopExists: true, onCount: undefined as undefined | (() => void) };
  const shop: any = { id: 10n, deletedAt: null, status: 'PENDING', loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } } };
  let snapshot = rows;
  const match = (row: any, where: any) => row.shopId === where.shopId && (where.isActive === undefined || row.isActive === where.isActive)
    && (!where.id || where.id.in.includes(row.id)) && (!where.OR || where.OR.some((part: any) => Object.entries(part).some(([key, filter]: [string, any]) => String(row[key] ?? '').toLowerCase().includes(filter.contains.toLowerCase()))));
  const forbiddenRead = () => jest.fn(() => { throw Error('Unrelated resource read'); });
  const tx: any = {
    user: { findFirst: jest.fn(async ({ where }: any) => state.operatorActive && ((where.role === 'ADMIN' && where.id === 1n) || (where.role === 'MERCHANT' && [2n, 3n, 5n].includes(where.id)) || (where.role === 'STAFF' && where.id === 4n)) ? { id: where.id } : null) },
    shop: { findFirst: jest.fn(async ({ where }: any) => state.shopExists && where.id === 10n ? shop : null) },
    shopAccountGrant: { findFirst: jest.fn(async ({ where }: any) => where.sourceShop.loginBinding.is.userId === 3n ? { status: 'ACTIVE', sourceShopId: 11n, permissions: state.grant, sourceShop: { status: 'APPROVED' } } : null) },
    shopStaffGrant: { findUnique: jest.fn(async ({ where }: any) => where.shopId_userId.shopId === 10n && where.shopId_userId.userId === 4n ? { status: 'ACTIVE', permissions: state.staffGrant } : null) },
    shopService: {
      findMany: jest.fn(async ({ where, select, skip = 0, take }: any) => snapshot.filter(row => match(row, where)).sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1)).slice(skip, skip + take)
        .map(row => ({ ...clone(row), _count: row._count ?? { variants: row.variants.length, addOns: row.addOns.length },
          variants: clone(row.variants.slice(0, select.variants.take)), addOns: clone(row.addOns.slice(0, select.addOns.take)) }))),
      count: jest.fn(async ({ where }: any) => { state.onCount?.(); return snapshot.filter(row => match(row, where)).length; }),
      create: jest.fn(() => { throw Error('Read must not create'); }), update: jest.fn(() => { throw Error('Read must not update'); }),
    },
    therapist: { findMany: forbiddenRead() }, shopRoom: { findMany: forbiddenRead() }, therapistTimeOff: { findMany: forbiddenRead() }, booking: { findMany: forbiddenRead() }, paymentRecord: { findMany: forbiddenRead() },
    $queryRaw: jest.fn(() => { throw Error('Read must not acquire raw locks'); }), $executeRaw: jest.fn(() => { throw Error('Read must not write'); }),
  };
  const db: any = { $transaction: jest.fn(async (work: any, options: any) => { expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 }); snapshot = clone(rows); return work(tx); }) };
  return { rows, state, tx, db, shop, read: (query: any = {}, actor = editor, shopId = '10') => readProjectCatalog(db, shopId, actor, query) };
}

describe('complete same-shop project catalog with either existing permission', () => {
  test('CAT-only reads unused legacy base, full active/inactive children and explicit safe metadata without RES configuration reads', async () => {
    const f = fixture(), result = await f.read();
    expect(result).toMatchObject({ shopId: '10', search: '', status: 'all', page: 1, pageSize: 25, total: 2, hasMore: false, canManageCatalog: true, canConfigurePolicy: false });
    expect(result.items[0]).toMatchObject({ id: '20', shopId: '10', name: 'Synthetic massage', nameEn: 'Massage', description: 'Description needle', category: 'MASSAGE',
      durationMin: 0, priceCents: 0, hasVariants: true, variantCount: 2, addOnCount: 2, preview: null,
      variants: [{ id: '30', isActive: true, preview: { pricing: { priceCents: 13057, durationMin: 60 }, bookingEnabled: true } },
        { id: '31', isActive: false, preview: { bookingEnabled: false } }], addOns: [{ id: '40', description: 'Extra description' }, { id: '41', isActive: false }] });
    expect(result.items[1]).toMatchObject({ id: '21', isActive: false, durationKind: 'UNKNOWN', durationMin: 15, priceCents: 0, preview: null });
    expect(result.items[0].selectionRevision).toBe(catalogSelectionRevision(10n, f.rows[0]));
    const output = JSON.stringify(result); for (const hidden of ['HIDDEN_', 'owner', 'studioProfile', 'shifts', 'timeOff', 'rooms', 'balanceCents', 'password']) expect(output).not.toContain(hidden);
    expect(f.tx.shopService.findMany).toHaveBeenCalledWith({ where: { shopId: 10n }, select: MENU_CATALOG_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], skip: 0, take: 25 });
    expect(f.tx.$queryRaw).not.toHaveBeenCalled(); expect(f.tx.$executeRaw).not.toHaveBeenCalled(); expect(f.tx.shopService.create).not.toHaveBeenCalled(); expect(f.tx.shopService.update).not.toHaveBeenCalled();
    for (const model of ['therapist', 'shopRoom', 'therapistTimeOff', 'booking', 'paymentRecord']) expect(f.tx[model].findMany).not.toHaveBeenCalled();
  });

  test('RES-only associated merchant and STAFF can read this safe subset without catalog write capability', async () => {
    const f = fixture(); f.state.grant = ['RESERVATION_CONFIG'];
    for (const actor of [editor, staff]) {
      expect(await f.read({}, actor)).toMatchObject({ canManageCatalog: false, canConfigurePolicy: true, total: 2 });
    }
    expect(f.tx.shopStaffGrant.findUnique).toHaveBeenCalled();
    f.state.grant = ['CATALOG_MANAGE', 'RESERVATION_CONFIG']; expect(await f.read()).toMatchObject({ canManageCatalog: true, canConfigurePolicy: true });
    for (const actor of [admin, owner]) expect(await f.read({}, actor)).toMatchObject({ canManageCatalog: true, canConfigurePolicy: true });
    expect(await new ReservationsService(f.db).projectCatalog('10', staff, {})).toMatchObject({ canManageCatalog: false, canConfigurePolicy: true });
  });

  test('both-permission denial never reaches catalog reads, and only Forbidden permits a fallback attempt', async () => {
    const f = fixture(); f.state.grant = []; f.state.staffGrant = [];
    for (const actor of [editor, staff, { id: '5', role: 'MERCHANT' }]) await expect(f.read({}, actor)).rejects.toThrow(ForbiddenException);
    expect(f.tx.shopService.findMany).not.toHaveBeenCalled(); expect(f.tx.shopService.count).not.toHaveBeenCalled();
    const gone = fixture(); gone.state.shopExists = false;
    await expect(gone.read()).rejects.toThrow(NotFoundException); expect(gone.tx.user.findFirst).toHaveBeenCalledTimes(1);
    const broken = fixture(); broken.tx.shop.findFirst.mockRejectedValueOnce(new BadRequestException('Synthetic malformed shop'));
    await expect(broken.read()).rejects.toThrow('Synthetic malformed shop'); expect(broken.tx.user.findFirst).toHaveBeenCalledTimes(1);
    const revoked = fixture(); revoked.state.operatorActive = false; await expect(revoked.read()).rejects.toThrow(ForbiddenException); expect(revoked.tx.shopService.findMany).not.toHaveBeenCalled();
  });

  test('parent status and description search filters do not discard inactive children or require menu representation', async () => {
    const f = fixture();
    expect(await f.read({ search: ' needle ', status: 'active' })).toMatchObject({ search: 'needle', total: 1, items: [{ id: '20', variants: [{ id: '30' }, { id: '31', isActive: false }] }] });
    expect(await f.read({ status: 'inactive' })).toMatchObject({ total: 1, items: [{ id: '21', isActive: false }] });
    expect(f.tx.shopService.count.mock.calls[0][0].where).toEqual({ shopId: 10n, isActive: true, OR: [{ name: { contains: 'needle' } }, { nameEn: { contains: 'needle' } }, { description: { contains: 'needle' } }] });
  });

  test('more than500 parents paginate to the true final row without N+1 or global truncation', async () => {
    const f = fixture(); f.rows.splice(0, f.rows.length, ...Array.from({ length: 601 }, (_, index) => parent(BigInt(1000 + index), { variants: [], addOns: [], sortOrder: 0 })));
    const final = await f.read({ page: '25', pageSize: '25' });
    expect(final).toMatchObject({ total: 601, hasMore: false, items: [{ id: '1600' }] });
    expect(f.tx.shopService.findMany).toHaveBeenCalledTimes(1); expect(f.tx.shopService.count).toHaveBeenCalledTimes(1);
    expect(f.tx.shopService.findMany.mock.calls[0][0]).toMatchObject({ skip: 600, take: 25 });
    expect(await f.read({ page: '26', pageSize: '25' })).toMatchObject({ total: 601, hasMore: false, items: [] });
  });

  test('exact focus hydrates a later large ID, filters to empty and never falls back to another shop or first row', async () => {
    const f = fixture(), large = 9007199254740993n; f.rows.push(parent(large, { name: 'Focus target' }));
    expect(await f.read({ serviceId: String(large) })).toMatchObject({ serviceId: String(large), total: 1, items: [{ id: String(large) }] });
    expect(await f.read({ serviceId: String(large), search: 'absent' })).toMatchObject({ total: 0, items: [] });
    expect(await f.read({ serviceId: '21', status: 'active' })).toMatchObject({ total: 0, items: [] });
    expect(await f.read({ serviceId: String(large), page: '2' })).toMatchObject({ total: 1, items: [] });
    f.rows.push(parent(99n, { shopId: 11n }));
    for (const serviceId of ['99', '98']) await expect(f.read({ serviceId })).rejects.toThrow(NotFoundException);
  });

  test('revision covers inactive siblings and policy, while canonical preview shows whole-visit amount separately from raw base', async () => {
    const f = fixture(); Object.assign(f.rows[0], { participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' }); Object.assign(f.rows[0].variants[0], { priceCents: 4000, priceBasis: 'PER_PERSON' });
    const first = (await f.read({ serviceId: '20' })).items[0];
    expect(first.variants[0]).toMatchObject({ priceCents: 4000, preview: { pricing: { priceCents: 4000 } } });
    f.rows[0].variants[1].isActive = true;
    const second = (await f.read({ serviceId: '20' })).items[0]; expect(second.selectionRevision).not.toBe(first.selectionRevision);
    f.rows[0].staffBufferMin++; expect((await f.read({ serviceId: '20' })).items[0].selectionRevision).not.toBe(second.selectionRevision);
  });

  test.each(['variants', 'addOns'] as const)('complete %s over cap errors instead of returning a partial child list/hash', async kind => {
    const f = fixture(), cap = MENU_CATALOG_LIMITS[kind]; f.rows[0][kind] = Array.from({ length: cap + 1 }, (_, index) => ({ id: BigInt(index + 100), serviceId: 20n }));
    await expect(f.read()).rejects.toMatchObject({ response: { code: 'MENU_CATALOG_TOO_LARGE', resource: kind } });
  });

  test('incomplete and foreign child collections fail closed rather than exporting a misleading selection version', async () => {
    const incomplete = fixture(); incomplete.rows[0]._count = { variants: 3, addOns: 2 };
    await expect(incomplete.read()).rejects.toMatchObject({ response: { code: 'MENU_CATALOG_INCOMPLETE' } });
    const foreign = fixture(); foreign.rows[0].variants[0].serviceId = 99n; await expect(foreign.read()).rejects.toThrow(NotFoundException);
  });

  test('page rows and total use one repeatable snapshot even when a concurrent commit changes the live catalog', async () => {
    const f = fixture(); f.state.onCount = () => { f.rows.push(parent(22n)); f.state.onCount = undefined; };
    expect(await f.read()).toMatchObject({ total: 2, items: [{ id: '20' }, { id: '21' }] });
    expect((await f.read()).total).toBe(3); expect(f.db.$transaction).toHaveBeenCalledTimes(2);
  });

  test.each([null, [], { q: 'alias' }, { search: ['a'] }, { search: '\n' }, { search: 'x'.repeat(101) }, { status: 'ACTIVE' }, { status: null }, { page: 1 },
    { page: '01' }, { page: '0' }, { page: '100001' }, { pageSize: '51' }, { pageSize: ['25'] }, { serviceId: '01' }, { serviceId: '9223372036854775808' }, { actorId: '1' }])('query contract rejects ambiguous or unbounded input %p', query => {
    expect(() => parseProjectCatalogQuery(query)).toThrow(BadRequestException);
  });

  test('unsupported roles fail before starting a transaction', async () => {
    const f = fixture(); for (const role of ['CUSTOMER', 'UNKNOWN']) await expect(f.read({}, { id: '9', role })).rejects.toThrow(ForbiddenException);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
});
