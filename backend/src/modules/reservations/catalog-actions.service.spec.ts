import { CatalogActionsService } from './catalog-actions.service';
import { parseCatalogMutation } from './catalog-actions.dto';
import { catalogSelectionRevision } from '../../common/menu-catalog-snapshot';
import { priceMenuRevision } from '../../common/shop-price-menu-revision';

const actor = { id: '2', role: 'MERCHANT' }, admin = { id: '1', role: 'ADMIN' };
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}
/** Staged transaction substitute: failures discard every staged table write.
 * It exercises the command with real authorization/version/menu helpers, not SQL. */
function fixture() {
  const time = new Date('2030-01-01T00:00:00Z');
  const user = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null });
  let state: any = { users: [user(1n, 'ADMIN'), user(2n), user(3n)], shops: [10n, 11n].map(id => ({ id, deletedAt: null, ownerId: 1n, status: 'PUBLISHED',
    timezone: 'America/Chicago', businessHours: { keep: true }, studioProfile: { priceMenu: [{ category: 'Existing', items: [] }], private: { source: ['KEEP'] }, bookingSettings: { leadHours: 12 } } })),
    services: [{ id: 20n, shopId: 10n, name: 'Existing massage', nameEn: null, description: 'Preserve', category: 'MASSAGE', durationKind: 'TIMED', durationMin: 60, priceCents: 6000,
      priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 5, roomBufferMin: 7,
      isActive: true, sortOrder: 9, createdAt: time, updatedAt: time, variants: [{ id: 30n, serviceId: 20n, name: '60 min', durationMin: 60, priceCents: 6000,
        priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true, sortOrder: 0, createdAt: time, updatedAt: time }], addOns: [] }], receipts: [], audits: [], granted: ['CATALOG_MANAGE'] };
  let sequence = 100n, fail = '', hideReadback = false, wrote = false, queue = Promise.resolve();
  const locks: string[] = [], transactions: any[] = [];
  const decorate = (data: any, shop: any) => ({ ...clone(shop), owner: data.users[0], loginBinding: { userId: shop.id === 10n ? 2n : 3n,
    user: data.users.find((row: any) => row.id === (shop.id === 10n ? 2n : 3n)) } });
  function client(data: any): any {
    return {
      $queryRaw: async (sql: any) => { locks.push(Array.isArray(sql) ? sql.join('?') : sql.sql); return []; },
      user: { findFirst: async ({ where }: any) => clone(data.users.find((row: any) => row.id === where.id && row.role === where.role && row.status === 'ACTIVE') ?? null) },
      shop: { findFirst: async ({ where }: any) => { const shop = data.shops.find((row: any) => row.id === where.id); return shop ? decorate(data, shop) : null; },
        update: async ({ where, data: patch }: any) => { if (fail === 'menu') throw Error('synthetic menu failure'); const shop = data.shops.find((row: any) => row.id === where.id); Object.assign(shop, clone(patch)); return decorate(data, shop); } },
      shopAccountGrant: { findFirst: async ({ where, select }: any) => {
        if (where.targetShopId !== 10n || where.sourceShop?.loginBinding?.is?.userId !== 3n) return null;
        return select ? { sourceShopId: 11n } : { status: 'ACTIVE', sourceShopId: 11n, permissions: clone(data.granted), sourceShop: decorate(data, data.shops[1]) };
      } },
      shopService: {
        findMany: async ({ where, select }: any) => {
          if (hideReadback && wrote && select) return [];
          return data.services.filter((row: any) => row.shopId === where.shopId && where.id.in.includes(row.id)).map((row: any) => ({ ...clone(row),
            ...(select ? { _count: { variants: row.variants.length, addOns: row.addOns.length } } : {}) }));
        },
        create: async ({ data: changes }: any) => { wrote = true; const row = { id: sequence++, nameEn: null, createdAt: time, updatedAt: time, variants: [], addOns: [], ...clone(changes) }; data.services.push(row); return clone(row); },
      },
      shopServiceVariant: { create: async ({ data: changes }: any) => { wrote = true; const row = { id: sequence++, createdAt: time, updatedAt: time, ...clone(changes) };
        data.services.find((parent: any) => parent.id === changes.serviceId).variants.push(row); return clone(row); } },
      auditLog: { create: async ({ data: audit }: any) => { if (fail === 'audit') throw Error('synthetic audit failure'); data.audits.push(clone(audit)); return audit; } },
      catalogMutationOperation: {
        findUnique: async ({ where }: any) => clone(data.receipts.find((row: any) => row.actorId === where.actorId_idempotencyKey.actorId && row.idempotencyKey === where.actorId_idempotencyKey.idempotencyKey) ?? null),
        create: async ({ data: receipt }: any) => { if (fail === 'receipt') throw Error('synthetic receipt failure'); data.receipts.push(clone(receipt)); return receipt; },
      },
    };
  }
  const db: any = { $transaction: (work: any, options: any) => {
    const run = queue.then(async () => { const staged = clone(state); transactions.push(options); const result = await work(client(staged)); state = staged; return result; });
    queue = run.then(() => undefined, () => undefined); return run;
  } };
  const source = () => catalogSelectionRevision(10n, state.services[0]);
  const revision = () => priceMenuRevision(10n, state.shops[0].studioProfile, state.services);
  const create = (patch: any = {}) => ({ action: 'CREATE_SERVICE', idempotencyKey: 'synthetic-key-01', expectedPriceMenuRevision: revision(),
    service: { name: 'New synthetic massage', category: 'MASSAGE' }, variant: { name: '90 min', durationMin: 90, priceCents: 9501 }, ...patch });
  const variant = (patch: any = {}) => ({ action: 'CREATE_VARIANT', idempotencyKey: 'synthetic-key-02', expectedPriceMenuRevision: revision(), expectedSelectionRevision: source(),
    serviceId: '20', variant: { name: '90 min', durationMin: 90, priceCents: 9501 }, ...patch });
  const link = (patch: any = {}) => ({ action: 'LINK_EXISTING_VARIANT', idempotencyKey: 'synthetic-key-03', expectedPriceMenuRevision: revision(), expectedSelectionRevision: source(),
    serviceId: '20', variantId: '30', display: { groupIndex: 0 }, ...patch });
  return { service: new CatalogActionsService(db), state: () => state, create, variant, link, source, revision, locks, transactions,
    fail: (point: string) => { fail = point; }, hideReadback: () => { hideReadback = true; } };
}

describe('atomic catalog actions (staged transaction substitute)', () => {
  test('create service + first variant + one display row preserve unrelated profile/catalog/policy and produce current versions', async () => {
    const f = fixture(), before = clone(f.state()), result = await f.service.execute('10', actor, f.create({ display: { groupIndex: 0 } }));
    expect(result).toMatchObject({ action: 'CREATE_SERVICE', shopId: '10', created: { service: true, variant: true, display: true }, displayStatus: 'ADDED' });
    const created = f.state().services[1];
    expect(created).toMatchObject({ id: BigInt(result.serviceId), participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, priceBasis: 'PER_BOOKING', isActive: true });
    expect(created.variants).toHaveLength(1); expect(created.variants[0]).toMatchObject({ id: BigInt(result.variantId), durationMin: 90, priceCents: 9501, currency: 'usd', priceBasis: 'PER_BOOKING' });
    expect(f.state().shops[0].studioProfile.private).toEqual(before.shops[0].studioProfile.private);
    expect(f.state().shops[0].studioProfile.bookingSettings).toEqual(before.shops[0].studioProfile.bookingSettings);
    expect(f.state().shops[1]).toEqual(before.shops[1]); expect(f.state().services[0]).toEqual(before.services[0]);
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[0]).toMatchObject({ id: result.displayItemId, booking: { serviceId: result.serviceId, variantId: result.variantId }, pricing: { durationMin: 90, priceCents: 9501 } });
    expect(result.priceMenuRevision).toBe(f.revision()); expect(result.selectionRevision).toBe(catalogSelectionRevision(10n, created));
    expect(f.state().receipts).toHaveLength(1); expect(f.locks[0]).toContain('shops'); expect(f.transactions[0].isolationLevel).toBe('ReadCommitted');
  });
  test('catalog-only creation changes no profile and explicit inactive service/option stays paused', async () => {
    const f = fixture(), profile = clone(f.state().shops[0].studioProfile);
    const result = await f.service.execute('10', admin, f.create({ service: { name: 'Paused', isActive: false, durationKind: 'PER_SESSION' }, variant: { name: 'One session', durationMin: 45, priceCents: 8000, isActive: false } }));
    expect(result).toMatchObject({ displayStatus: 'NOT_REQUESTED', displayItemId: null, created: { display: false } });
    expect(f.state().shops[0].studioProfile).toEqual(profile); expect(f.state().services[1].isActive).toBe(false); expect(f.state().services[1].variants[0].isActive).toBe(false);
  });
  test('CAT-only associated actor adds a variant inheriting paused COUPLE policy without changing existing amounts or resuming parent', async () => {
    const f = fixture(); Object.assign(f.state().services[0], { isActive: false, participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' });
    const original = clone(f.state().services[0]);
    const result = await f.service.execute('10', { id: '3', role: 'MERCHANT' }, f.variant({ display: { newGroupCategory: 'Couples' } }));
    const parent = f.state().services[0]; expect({ ...parent, variants: original.variants }).toEqual(original); expect(parent.variants[0]).toEqual(original.variants[0]);
    expect(parent.variants[1]).toMatchObject({ serviceId: 20n, priceCents: 9501, priceBasis: 'PER_BOOKING' });
    expect(f.state().shops[0].studioProfile.priceMenu[1]).toMatchObject({ category: 'Couples', items: [{ bookingMode: 'COUPLE', bookingEnabled: true }] });
    expect(result.created).toEqual({ service: false, variant: true, display: true });
  });
  test('first independent variant preserves old base choice and rebinds only its exact base menu rows', async () => {
    const f = fixture(); f.state().services[0].variants = [];
    f.state().shops[0].studioProfile.priceMenu[0].items = [
      { id: 'base', name: 'Keep custom wording', priceText: '$60', booking: { serviceId: '20' }, description: 'KEEP' },
      { id: 'unrelated', name: 'Display only', priceText: 'Ask', bookingEnabled: false },
    ];
    const oldOther = clone(f.state().shops[0].studioProfile.priceMenu[0].items[1]);
    await f.service.execute('10', actor, f.variant({ display: { groupIndex: 0 } }));
    expect(f.state().services[0].variants).toHaveLength(2);
    const base = f.state().services[0].variants.find((row: any) => row.durationMin === 60);
    expect(base).toMatchObject({ priceCents: 6000, isActive: true });
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[0]).toEqual({ id: 'base', name: 'Keep custom wording', priceText: '$60', booking: { serviceId: '20', variantId: String(base.id) }, description: 'KEEP' });
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[1]).toEqual(oldOther);
  });
  test('existing variant linking never creates a service/variant, and repeat linking with a new key does not duplicate or move its row', async () => {
    const f = fixture(), catalog = clone(f.state().services);
    const first = await f.service.execute('10', actor, f.link());
    const second = await f.service.execute('10', actor, f.link({ idempotencyKey: 'synthetic-key-new', display: { newGroupCategory: 'Must not create empty group' } }));
    expect(first.created).toEqual({ service: false, variant: false, display: true });
    expect(second).toMatchObject({ displayStatus: 'ALREADY_LINKED', displayItemId: first.displayItemId, created: { service: false, variant: false, display: false } });
    expect(f.state().services).toEqual(catalog); expect(f.state().shops[0].studioProfile.priceMenu).toHaveLength(1); expect(f.state().shops[0].studioProfile.priceMenu[0].items).toHaveLength(1);
  });
  test('same-key retry returns original receipt despite stale menu/source versions and cannot duplicate the command', async () => {
    const f = fixture(), body = f.create({ display: { groupIndex: 0 } });
    const first = await f.service.execute('10', actor, body), beforeReplay = clone(f.state());
    expect(await f.service.execute('10', actor, body)).toEqual(first); expect(f.state()).toEqual(beforeReplay);
    expect(await f.service.receipt('10', actor, body.idempotencyKey)).toEqual(first);
    await expect(f.service.execute('10', actor, { ...body, variant: { ...body.variant, priceCents: 9999 } })).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_OPERATION_KEY_REUSED' } });
  });
  test('serialized different-key commands from the same menu snapshot commit one append and reject the stale other', async () => {
    const f = fixture(), one = f.create({ display: { groupIndex: 0 } }), two = { ...one, idempotencyKey: 'synthetic-key-concurrent' };
    const results = await Promise.allSettled([f.service.execute('10', actor, one), f.service.execute('10', actor, two)]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(row => row.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({ status: 409, response: { code: 'PRICE_MENU_CHANGED' } });
    expect(f.state().services).toHaveLength(2); expect(f.state().receipts).toHaveLength(1);
  });
  test('unlinked source drift rejects with no write even when menu version is unchanged', async () => {
    const f = fixture(), body = f.variant(); f.state().services[0].variants[0].priceCents = 6200;
    expect(body.expectedPriceMenuRevision).toBe(f.revision()); const before = clone(f.state());
    await expect(f.service.execute('10', actor, body)).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_SELECTION_CHANGED' } }); expect(f.state()).toEqual(before);
  });
  test('revoked permissions are checked before POST replay and GET receipt, with actor/shop receipt isolation', async () => {
    const f = fixture(), body = f.link(); await f.service.execute('10', actor, body);
    await expect(f.service.receipt('10', admin, body.idempotencyKey)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.receipt('11', admin, body.idempotencyKey)).rejects.toMatchObject({ status: 404 });
    f.state().users.find((row: any) => row.id === 2n).status = 'SUSPENDED'; const before = clone(f.state());
    await expect(f.service.execute('10', actor, body)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.receipt('10', actor, body.idempotencyKey)).rejects.toMatchObject({ status: 403 }); expect(f.state()).toEqual(before);
  });
  test('foreign shop parent/child and actor-supplied privilege fields cannot cross catalog boundaries', async () => {
    const f = fixture(), before = clone(f.state());
    await expect(f.service.execute('11', admin, f.variant())).rejects.toMatchObject({ status: 409 });
    await expect(f.service.execute('10', actor, f.link({ variantId: '999' }))).rejects.toMatchObject({ status: 404 });
    await expect(f.service.execute('10', actor, f.create({ actorId: '1' }))).rejects.toMatchObject({ status: 400 });
    await expect(f.service.execute('10', { id: '2', role: 'STAFF' }, f.create())).rejects.toMatchObject({ status: 403 }); expect(f.state()).toEqual(before);
  });
  test.each(['menu', 'audit', 'receipt'])('%s failure rolls service, first variant, display and receipt back together', async point => {
    const f = fixture(), before = clone(f.state()); f.fail(point);
    await expect(f.service.execute('10', actor, f.create({ display: { groupIndex: 0 } }))).rejects.toThrow('synthetic'); expect(f.state()).toEqual(before);
  });
  test('post-create incomplete readback rolls back instead of returning a misleading partial success', async () => {
    const f = fixture(), before = clone(f.state()); f.hideReadback();
    await expect(f.service.execute('10', actor, f.create())).rejects.toMatchObject({ status: 409 }); expect(f.state()).toEqual(before);
  });
  test('invalid saved layout or full layout cannot leave an orphan service or receipt', async () => {
    const f = fixture(); f.state().shops[0].studioProfile.priceMenu[0].privateField = 'must not discard'; let before = clone(f.state());
    await expect(f.service.execute('10', actor, f.create())).rejects.toMatchObject({ status: 409, response: { code: 'PRICE_MENU_REPAIR_REQUIRED' } }); expect(f.state()).toEqual(before);
    delete f.state().shops[0].studioProfile.priceMenu[0].privateField;
    f.state().shops[0].studioProfile.priceMenu = Array.from({ length: 100 }, () => ({ category: 'Full', items: [] })); before = clone(f.state());
    await expect(f.service.execute('10', actor, f.create({ display: { newGroupCategory: 'Overflow' } }))).rejects.toMatchObject({ status: 400 }); expect(f.state()).toEqual(before);
  });
  test('missing receipt is explicitly pending/unknown and leaves all tables untouched', async () => {
    const f = fixture(), before = clone(f.state());
    await expect(f.service.receipt('10', actor, 'synthetic-no-receipt')).rejects.toMatchObject({ status: 404, response: { code: 'CATALOG_OPERATION_NOT_FOUND' } }); expect(f.state()).toEqual(before);
  });
});

describe('catalog command deep input boundaries', () => {
  test.each([2001, 10000])('accepts %i-character descriptions with service and variant names at their limits', length => {
    const f = fixture(), body = f.create({ service: { name: 'N'.repeat(200), description: 'D'.repeat(length) }, variant: { name: 'V'.repeat(100), durationMin: 60, priceCents: 6000 } });
    const parsed = parseCatalogMutation(body);
    expect(parsed.service?.name).toBe(body.service.name); expect(parsed.service?.description).toBe(body.service.description); expect(parsed.variant?.name).toBe(body.variant.name); expect(f.transactions).toHaveLength(0);
  });
  test.each([
    ['service name', { service: { name: 'N'.repeat(201) } }],
    ['service description', { service: { name: 'Massage', description: 'D'.repeat(10001) } }],
    ['variant name', { variant: { name: 'V'.repeat(101), durationMin: 60, priceCents: 6000 } }],
  ])('rejects an overlong %s before any transaction', (_field, patch) => {
    const f = fixture(); expect(() => parseCatalogMutation(f.create(patch))).toThrow(); expect(f.transactions).toHaveLength(0);
  });
  test('rejects mixed actions, raw number/string coercion, nested policies, private JSON and ambiguous groups before transactions', () => {
    const f = fixture(), valid = f.create();
    const invalid = [
      { ...valid, serviceId: '20' }, { ...valid, variant: { ...valid.variant, durationMin: '90' } }, { ...valid, variant: { ...valid.variant, isActive: 'false' } },
      { ...valid, service: { ...valid.service, participantCount: 2 } }, { ...valid, variant: { ...valid.variant, priceBasis: 'PER_PERSON' } },
      { ...valid, display: null }, { ...valid, display: { groupIndex: 0, newGroupCategory: 'Both' } }, { ...valid, display: { groupIndex: '0' } },
      { ...valid, studioProfile: { anything: true } }, { ...valid, service: { name: 'HTML <img src=x>' } }, { ...f.variant(), serviceId: 20 },
      { ...valid, idempotencyKey: '../bad' }, { ...valid, variant: { ...valid.variant, priceCents: 0 } }, { ...valid, service: { name: 'Null active', isActive: null } },
    ];
    for (const body of invalid) expect(() => parseCatalogMutation(body)).toThrow(); expect(f.transactions).toHaveLength(0);
  });
});
