import { ServiceWorkspaceService } from './service-workspace.service';
import { parseWorkspaceCommand, workspaceText } from './service-workspace.dto';
import { catalogSelectionRevision } from '../../common/menu-catalog-snapshot';
import { priceMenuRevision } from '../../common/shop-price-menu-revision';

const owner = { id: '2', role: 'MERCHANT' }, associated = { id: '3', role: 'MERCHANT' }, admin = { id: '1', role: 'ADMIN' };
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}
/** Synthetic staged-table transaction substitute. Runs the real command,
 * version, authorization and display helpers; it is not Prisma/MySQL or HTTP. */
function fixture() {
  const time = new Date('2030-01-01T00:00:00Z');
  const user = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null });
  let state: any = {
    users: [user(1n, 'ADMIN'), user(2n), user(3n)],
    shops: [10n, 11n].map(id => ({ id, deletedAt: null, ownerId: 1n, status: 'PUBLISHED', timezone: 'America/Chicago',
      studioProfile: { priceMenu: [{ category: 'Existing', items: [] }], private: { keep: true }, bookingSettings: { leadHours: 12 } } })),
    services: [{ id: 20n, shopId: 10n, name: 'Existing massage', nameEn: null, description: 'Preserve', category: 'MASSAGE', durationKind: 'TIMED',
      durationMin: 60, priceCents: 6000, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null,
      staffBufferMin: 5, roomBufferMin: 7, isActive: true, sortOrder: 9, createdAt: time, updatedAt: time,
      variants: [{ id: 30n, serviceId: 20n, name: '60 min', durationMin: 60, priceCents: 6000, priceBasis: 'PER_BOOKING', currency: 'usd',
        isActive: true, sortOrder: 0, createdAt: time, updatedAt: time }], addOns: [] }],
    receipts: [], audits: [], granted: ['CATALOG_MANAGE'], futureService: false, futureVariant: false,
  };
  let sequence = 100n, failure = '', queue = Promise.resolve(), wrote = false, hideReadback = false;
  const writes: string[] = [], locks: string[] = [], transactions: any[] = [];
  const decorate = (data: any, shop: any) => ({ ...clone(shop), owner: data.users[0], loginBinding: { userId: shop.id === 10n ? 2n : 3n,
    user: data.users.find((row: any) => row.id === (shop.id === 10n ? 2n : 3n)) } });
  function client(data: any): any {
    const updateChild = (field: 'variants' | 'addOns', where: any, patch: any) => {
      writes.push(field + '.update'); wrote = true;
      const child = data.services.flatMap((row: any) => row[field]).find((row: any) => row.id === where.id);
      if (!child) throw Error('fixture child missing'); Object.assign(child, clone(patch)); return clone(child);
    };
    const createChild = (field: 'variants' | 'addOns', changes: any) => {
      writes.push(field + '.create'); wrote = true;
      const row = { id: sequence++, createdAt: time, updatedAt: time, ...clone(changes) };
      data.services.find((parent: any) => parent.id === changes.serviceId)[field].push(row); return clone(row);
    };
    return {
      $queryRaw: async (sql: any) => { locks.push(sql.sql); return []; },
      user: { findFirst: async ({ where }: any) => clone(data.users.find((row: any) => row.id === where.id && row.role === where.role && row.status === 'ACTIVE') ?? null) },
      shop: {
        findFirst: async ({ where }: any) => { const shop = data.shops.find((row: any) => row.id === where.id); return shop ? decorate(data, shop) : null; },
        update: async ({ where, data: patch }: any) => { writes.push('shop.update'); if (failure === 'menu') throw Error('synthetic menu failure');
          const shop = data.shops.find((row: any) => row.id === where.id); Object.assign(shop, clone(patch)); return decorate(data, shop); },
      },
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
        create: async ({ data: changes }: any) => { writes.push('service.create'); wrote = true;
          const row = { id: sequence++, nameEn: null, createdAt: time, updatedAt: time, variants: [], addOns: [], ...clone(changes) }; data.services.push(row); return clone(row); },
        update: async ({ where, data: patch }: any) => { writes.push('service.update'); wrote = true;
          const row = data.services.find((row: any) => row.id === where.id); Object.assign(row, clone(patch)); return clone(row); },
      },
      shopServiceVariant: { create: async ({ data: changes }: any) => createChild('variants', changes), update: async ({ where, data: patch }: any) => updateChild('variants', where, patch) },
      shopServiceAddOn: { create: async ({ data: changes }: any) => createChild('addOns', changes), update: async ({ where, data: patch }: any) => updateChild('addOns', where, patch) },
      booking: { findFirst: async () => data.futureService ? { id: 900n } : null },
      bookingItem: { findFirst: async () => data.futureVariant ? { id: 901n } : null },
      auditLog: { create: async ({ data: audit }: any) => { writes.push('audit.create'); if (failure === 'audit') throw Error('synthetic audit failure'); data.audits.push(clone(audit)); return audit; } },
      catalogMutationOperation: {
        findUnique: async ({ where }: any) => clone(data.receipts.find((row: any) => row.actorId === where.actorId_idempotencyKey.actorId && row.idempotencyKey === where.actorId_idempotencyKey.idempotencyKey) ?? null),
        create: async ({ data: receipt }: any) => { writes.push('receipt.create'); if (failure === 'receipt') throw Error('synthetic receipt failure'); data.receipts.push(clone(receipt)); return receipt; },
      },
    };
  }
  const db: any = { $transaction: (work: any, options: any) => {
    const run = queue.then(async () => { const staged = clone(state); transactions.push(options); const result = await work(client(staged)); state = staged; return result; });
    queue = run.then(() => undefined, () => undefined); return run;
  } };
  const revision = () => priceMenuRevision(10n, state.shops[0].studioProfile, state.services);
  const source = () => catalogSelectionRevision(10n, state.services[0]);
  const edit = (patch: any = {}) => ({ action: 'SAVE_SERVICE_WORKSPACE', idempotencyKey: 'workspace-synthetic-01', expectedPriceMenuRevision: revision(),
    serviceId: '20', expectedSelectionRevision: source(), ...patch });
  const create = (patch: any = {}) => ({ action: 'SAVE_SERVICE_WORKSPACE', idempotencyKey: 'workspace-synthetic-new', expectedPriceMenuRevision: revision(),
    service: { name: 'New massage' }, variants: [{ tempKey: 'first', changes: { name: '90 min', durationMin: 90, priceCents: 9501 } }], ...patch });
  const bind = (patch: any = {}) => {
    state.shops[0].studioProfile.priceMenu[0].items.push({ id: 'display-a', name: 'Existing massage', priceText: '$60', booking: { serviceId: '20', variantId: '30' }, ...patch });
  };
  return { service: new ServiceWorkspaceService(db), state: () => state, revision, source, edit, create, bind, writes, locks, transactions,
    fail: (point: string) => { failure = point; }, hideReadback: () => { hideReadback = true; } };
}

describe('single-page workspace commands (synthetic staged transaction)', () => {
  test('create commits service, explicit variant, add-on, display, receipt and versions together', async () => {
    const f = fixture(), original = clone(f.state());
    const result = await f.service.execute('10', owner, f.create({
      addOns: [{ tempKey: 'extra', changes: { name: 'Oil', priceCents: 500, description: 'Line one\nLine two' } }],
      newGroups: [{ tempKey: 'newGroup', category: 'Body care' }],
      displays: [{ tempKey: 'display', target: { kind: 'VARIANT', tempKey: 'first' }, group: { tempKey: 'newGroup' }, changes: {} }],
    }));
    expect(result).toMatchObject({ outcome: 'COMMITTED', serviceId: '100', requiredPermissions: ['CATALOG_MANAGE'] });
    expect(f.state().services[1]).toMatchObject({ id: 100n, participantCount: 1, requiredStaffCount: 1, variants: [{ priceCents: 9501, durationMin: 90, priceBasis: 'PER_BOOKING', currency: 'usd' }], addOns: [{ priceCents: 500 }] });
    expect(f.state().shops[0].studioProfile.priceMenu[1].items[0]).toMatchObject({ id: result.idMap.displays.display, booking: { serviceId: '100', variantId: result.idMap.variants.first }, isVisible: true });
    expect(result.priceMenuRevision).toBe(f.revision());
    expect(result.selectionRevision).toBe(catalogSelectionRevision(10n, f.state().services[1]));
    expect(f.state().shops[0].studioProfile.private).toEqual(original.shops[0].studioProfile.private);
    expect(f.state().shops[1]).toEqual(original.shops[1]); expect(f.state().services[0]).toEqual(original.services[0]);
    expect(f.state().receipts).toHaveLength(1); expect(f.transactions[0].isolationLevel).toBe('ReadCommitted'); expect(f.locks[0]).toContain('shops');
  });
  test('explicit metadata/price changes preserve untouched policies, sibling children and raw custom displays', async () => {
    const f = fixture(); f.bind({ name: 'Keep $60 custom', priceText: '', pricing: { kind: 'TIMED', baseName: 'Old', durationMin: 60, priceCents: 6000, titleMode: 'CUSTOM' }, isVisible: false });
    const before = clone(f.state()), result = await f.service.execute('10', associated, f.edit({ service: { description: 'First line\nSecond line' }, variants: [{ id: '30', changes: { priceCents: 7001 } }] }));
    expect(result.requiredPermissions).toEqual(['CATALOG_MANAGE']);
    expect(f.state().services[0]).toMatchObject({ description: 'First line\nSecond line', participantCount: 1, requiredStaffCount: 1, staffBufferMin: 5, roomBufferMin: 7 });
    expect(f.state().services[0].variants[0]).toMatchObject({ priceCents: 7001, durationMin: 60 });
    expect(f.state().shops[0].studioProfile).toEqual(before.shops[0].studioProfile); expect(result.warnings).toHaveLength(1);
  });
  test('first variant preserves edited base choice, exact legacy identity and explicit SERVICE draft targets', async () => {
    const f = fixture(); f.state().services[0].variants = []; f.state().services[0].priceBasis = 'PER_PERSON';
    f.state().shops[0].studioProfile.priceMenu[0].items = [
      { id: 'base', name: 'Custom base', priceText: '$60', booking: { serviceId: '20' }, description: 'Keep', isVisible: false },
      { name: 'No ID base', priceText: '$60', booking: { serviceId: '20' } },
      { id: 'legacy', name: 'Legacy text', priceText: 'Ask', bookingEnabled: false },
    ];
    const before = clone(f.state()), snapshot = await f.service.snapshot('10', owner, '20'); expect(f.state()).toEqual(before);
    const result = await f.service.execute('10', owner, f.edit({ service: { durationMin: 75, priceCents: 7500 },
      variants: [{ tempKey: 'second', changes: { name: '90 min', durationMin: 90, priceCents: 9000 } }],
      displays: [{ id: 'base', target: { kind: 'SERVICE' }, changes: { description: 'Edited' } },
        { tempKey: 'baseAgain', target: { kind: 'SERVICE' }, group: { index: 0 }, changes: {} },
        { id: 'legacy', target: { kind: 'SERVICE' }, changes: {} }],
    }));
    const parent = f.state().services[0], kept = parent.variants.find((row: any) => row.durationMin === 75), menu = f.state().shops[0].studioProfile.priceMenu[0].items;
    expect(parent.variants).toHaveLength(2); expect(kept).toMatchObject({ priceCents: 7500, priceBasis: 'PER_BOOKING' });
    expect(menu[0]).toMatchObject({ id: 'base', name: 'Custom base', isVisible: false, booking: { serviceId: '20', variantId: String(kept.id) }, description: 'Edited' });
    expect(menu[1].id).toBe(result.idMap.displays[snapshot.priceMenu[0].items[1].id!]); expect(menu[1].id).not.toMatch(/^legacy:/);
    expect(menu[2]).toMatchObject({ id: 'legacy', name: 'Legacy text', booking: { serviceId: '20', variantId: String(kept.id) } });
    expect(menu[3].booking.variantId).toBe(String(kept.id));
  });
  test('hide and unhide affect only display visibility and never pause underlying option', async () => {
    const f = fixture(); f.bind(); const before = clone(f.state().services);
    await f.service.execute('10', owner, f.edit({ displays: [{ id: 'display-a', changes: { isVisible: false } }] }));
    expect(f.state().services).toEqual(before); expect(f.state().shops[0].studioProfile.priceMenu[0].items[0].isVisible).toBe(false);
    const snapshot = await f.service.snapshot('10', owner, '20'); expect(snapshot.priceMenu[0].items[0].isVisible).toBe(false);
    await f.service.execute('10', owner, f.edit({ idempotencyKey: 'workspace-unhide', displays: [{ id: 'display-a', changes: { isVisible: true } }] }));
    expect(f.state().services).toEqual(before); expect(f.state().shops[0].studioProfile.priceMenu[0].items[0].isVisible).toBe(true);
  });
  test('unchanged effective display values do not require catalog permission or rewrite raw legacy projection', async () => {
    const f = fixture(); f.bind(); f.state().granted = ['RESERVATION_CONFIG'];
    const before = clone(f.state().shops[0].studioProfile);
    const result = await f.service.execute('10', associated, f.edit({ policy: { staffBufferMin: 8 }, displays: [{ id: 'display-a', changes: { titleMode: 'AUTO', isVisible: true } }] }));
    expect(result.requiredPermissions).toEqual(['RESERVATION_CONFIG']); expect(f.state().shops[0].studioProfile).toEqual(before);
  });
  test('explicit custom and automatic titles convert only the edited legacy bound row coherently', async () => {
    const f = fixture(); f.bind(); f.bind({ id: 'untouched', name: 'Do not rewrite' }); const untouched = clone(f.state().shops[0].studioProfile.priceMenu[0].items[1]);
    await f.service.execute('10', owner, f.edit({ displays: [{ id: 'display-a', changes: { name: 'My custom title' } }] }));
    const custom = f.state().shops[0].studioProfile.priceMenu[0].items[0]; expect(custom).toMatchObject({ name: 'My custom title', priceText: '', pricing: { titleMode: 'CUSTOM', priceCents: 6000 } });
    expect((await f.service.snapshot('10', owner, '20')).priceMenu[0].items[0].name).toBe('My custom title');
    await f.service.execute('10', owner, f.edit({ idempotencyKey: 'workspace-auto-title', displays: [{ id: 'display-a', changes: { titleMode: 'AUTO' } }] }));
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[0]).toMatchObject({ name: '60 min Existing massage $60', priceText: '', pricing: { titleMode: 'AUTO' } });
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[1]).toEqual(untouched);
  });
  test('unchanged legacy per-person base becomes a preserved per-person choice rather than a price rewrite', async () => {
    const f = fixture(); f.state().services[0].variants = []; f.state().services[0].priceBasis = 'PER_PERSON';
    await f.service.execute('10', owner, f.edit({ variants: [{ tempKey: 'new', changes: { name: '90 min', durationMin: 90, priceCents: 9000 } }] }));
    expect(f.state().services[0]).toMatchObject({ priceBasis: 'PER_PERSON', priceCents: 6000, durationMin: 60 });
    expect(f.state().services[0].variants[0]).toMatchObject({ priceBasis: 'PER_PERSON', priceCents: 6000, durationMin: 60 });
    expect(f.state().services[0].variants[1]).toMatchObject({ priceBasis: 'PER_BOOKING', priceCents: 9000 });
  });
  test('catalog-only actor may save unchanged policy, while actual policy or mixed changes fail before writes', async () => {
    const f = fixture(); const policy = { participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 5, roomBufferMin: 7 };
    const result = await f.service.execute('10', associated, f.edit({ service: { name: 'Renamed' }, policy }));
    expect(result.requiredPermissions).toEqual(['CATALOG_MANAGE']); const before = clone(f.state()), writes = f.writes.length;
    await expect(f.service.execute('10', associated, f.edit({ idempotencyKey: 'workspace-forbidden-policy', service: { name: 'Forbidden' }, policy: { staffBufferMin: 8 } }))).rejects.toMatchObject({ status: 403 });
    expect(f.state()).toEqual(before); expect(f.writes).toHaveLength(writes);
  });
  test('rules-only actor may save actual policy with unchanged catalog fields, cannot edit catalog', async () => {
    const f = fixture(); f.state().granted = ['RESERVATION_CONFIG'];
    const result = await f.service.execute('10', associated, f.edit({ policy: { staffBufferMin: 8 }, service: { name: 'Existing massage' }, variants: [{ id: '30', changes: { priceCents: 6000 } }] }));
    expect(result.requiredPermissions).toEqual(['RESERVATION_CONFIG']); expect(f.state().services[0].staffBufferMin).toBe(8);
    const before = clone(f.state()); await expect(f.service.execute('10', associated, f.edit({ idempotencyKey: 'workspace-forbidden-catalog', service: { name: 'Cannot rename' } }))).rejects.toMatchObject({ status: 403 }); expect(f.state()).toEqual(before);
  });
  test('menu and complete selection CAS independently reject stale drafts without writes', async () => {
    const f = fixture(); f.bind(); let draft = f.edit({ service: { name: 'stale' } });
    f.state().shops[0].studioProfile.priceMenu[0].category = 'Changed'; let before = clone(f.state());
    await expect(f.service.execute('10', owner, draft)).rejects.toMatchObject({ status: 409, response: { code: 'PRICE_MENU_CHANGED' } }); expect(f.state()).toEqual(before); expect(f.writes).toHaveLength(0);
    const g = fixture(); draft = g.edit({ service: { name: 'stale source' } }); g.state().services[0].variants[0].priceCents++;
    expect(draft.expectedPriceMenuRevision).toBe(g.revision()); before = clone(g.state());
    await expect(g.service.execute('10', owner, draft)).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_SELECTION_CHANGED' } }); expect(g.state()).toEqual(before); expect(g.writes).toHaveLength(0);
  });
  test.each(['menu', 'audit', 'receipt'])('%s failure discards all staged service/child/display/audit/receipt changes', async point => {
    const f = fixture(), before = clone(f.state()); f.fail(point);
    await expect(f.service.execute('10', owner, f.create({ displays: [{ tempKey: 'display', target: { kind: 'VARIANT', tempKey: 'first' }, group: { index: 0 }, changes: {} }] }))).rejects.toThrow('synthetic'); expect(f.state()).toEqual(before);
  });
  test('invalid late display and incomplete post-write parent readback discard all staged writes', async () => {
    const f = fixture(), before = clone(f.state());
    await expect(f.service.execute('10', owner, f.create({ displays: [{ tempKey: 'bad', target: { kind: 'VARIANT', tempKey: 'first' }, group: { index: 0 }, position: 99, changes: {} }] }))).rejects.toMatchObject({ status: 400 }); expect(f.state()).toEqual(before);
    f.hideReadback(); await expect(f.service.execute('10', owner, f.create())).rejects.toMatchObject({ status: 409 }); expect(f.state()).toEqual(before);
  });
  test('receipt replay is exact, payload reuse conflicts, access and required permissions are rechecked', async () => {
    const f = fixture(), body = f.create(), result = await f.service.execute('10', associated, body), before = clone(f.state());
    expect(await f.service.execute('10', associated, body)).toEqual(result); expect(await f.service.receipt('10', associated, body.idempotencyKey)).toEqual(result); expect(f.state()).toEqual(before);
    await expect(f.service.execute('10', associated, { ...body, service: { name: 'Changed intent' } })).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_OPERATION_KEY_REUSED' } });
    await expect(f.service.receipt('10', admin, body.idempotencyKey)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.receipt('11', associated, body.idempotencyKey)).rejects.toMatchObject({ status: 404 });
    f.state().granted = ['RESERVATION_CONFIG']; await expect(f.service.execute('10', associated, body)).rejects.toMatchObject({ status: 403 }); await expect(f.service.receipt('10', associated, body.idempotencyKey)).rejects.toMatchObject({ status: 403 });
  });
  test('NOT_EXECUTED reconciliation seals key, repeats same receipt, and late write cannot mutate anything', async () => {
    const f = fixture(), draft = f.create(), before = clone(f.state());
    await expect(f.service.receipt('10', owner, draft.idempotencyKey)).rejects.toMatchObject({ status: 404 }); expect(f.state()).toEqual(before);
    const receipt = await f.service.reconcile('10', owner, draft.idempotencyKey), sealed = clone(f.state());
    expect(receipt).toMatchObject({ outcome: 'NOT_EXECUTED', action: null, requiredPermissions: [] }); expect(f.state().services).toEqual(before.services); expect(f.state().shops).toEqual(before.shops);
    expect(await f.service.reconcile('10', owner, draft.idempotencyKey)).toEqual(receipt); expect(await f.service.receipt('10', owner, draft.idempotencyKey)).toEqual(receipt);
    await expect(f.service.execute('10', owner, draft)).rejects.toMatchObject({ status: 409, response: { code: 'SERVICE_WORKSPACE_OPERATION_SEALED' } }); expect(f.state()).toEqual(sealed);
  });
  test('concurrent synthetic serialization commits one stale-menu competing write and replays same key once', async () => {
    const f = fixture(), body = f.create({ displays: [{ tempKey: 'one', target: { kind: 'VARIANT', tempKey: 'first' }, group: { index: 0 }, changes: {} }] });
    const pair = await Promise.allSettled([f.service.execute('10', owner, body), f.service.execute('10', owner, { ...body, idempotencyKey: 'workspace-competitor' })]);
    expect(pair.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect((pair.find(row => row.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409, response: { code: 'PRICE_MENU_CHANGED' } });
    expect(f.state().services).toHaveLength(2); expect(f.state().receipts).toHaveLength(1);
    const g = fixture(), repeat = g.create(), results = await Promise.all([g.service.execute('10', owner, repeat), g.service.execute('10', owner, repeat)]);
    expect(results[0]).toEqual(results[1]); expect(g.state().services).toHaveLength(2); expect(g.state().receipts).toHaveLength(1);
  });
  test('future bookings prevent disabling/duration/policy edits but do not prevent price and visibility updates', async () => {
    const f = fixture(); f.bind(); f.state().futureService = true; f.state().futureVariant = true; const before = clone(f.state());
    for (const patch of [{ service: { isActive: false } }, { policy: { staffBufferMin: 8 } }, { variants: [{ id: '30', changes: { durationMin: 75 } }] }, { variants: [{ id: '30', changes: { isActive: false } }] }]) {
      await expect(f.service.execute('10', owner, f.edit(patch))).rejects.toMatchObject({ status: 409 }); expect(f.state()).toEqual(before);
    }
    await f.service.execute('10', owner, f.edit({ variants: [{ id: '30', changes: { priceCents: 7000 } }], displays: [{ id: 'display-a', changes: { isVisible: false } }] }));
    expect(f.state().services[0].variants[0]).toMatchObject({ priceCents: 7000, isActive: true, durationMin: 60 });
  });
  test('layout rename/move/remove/order preserves hidden binding and cannot change any catalog row', async () => {
    const f = fixture(); f.bind({ isVisible: false }); f.state().shops[0].studioProfile.priceMenu.push({ category: 'Second', items: [{ id: 'legacy', name: 'Call', priceText: 'Ask' }] });
    const before = clone(f.state().services);
    await f.service.execute('10', owner, { action: 'SAVE_MENU_LAYOUT', idempotencyKey: 'workspace-layout', expectedPriceMenuRevision: f.revision(), groups: [{ index: 0, category: 'Renamed' }, { tempKey: 'new', category: 'Third' }],
      moves: [{ itemId: 'display-a', group: { tempKey: 'new' }, position: 0 }], removeGroups: [{ index: 1, moveTo: { index: 0 } }], groupOrder: [{ tempKey: 'new' }, { index: 0 }] });
    expect(f.state().services).toEqual(before); expect(f.state().shops[0].studioProfile.priceMenu).toMatchObject([{ category: 'Third', items: [{ id: 'display-a', isVisible: false, booking: { serviceId: '20', variantId: '30' } }] }, { category: 'Renamed', items: [{ id: 'legacy' }] }]);
  });
  test('legacy text edit cannot rebind booking objects; permanent last-position removal pauses exact option', async () => {
    const f = fixture(); f.bind(); const catalog = clone(f.state().services);
    f.state().shops[0].studioProfile.priceMenu[0].items.push({ id: 'legacy', name: 'Ask us', priceText: 'Call' });
    await f.service.execute('10', owner, { action: 'SAVE_LEGACY_DISPLAY', idempotencyKey: 'workspace-legacy', expectedPriceMenuRevision: f.revision(), itemId: 'legacy', changes: { description: 'One\nTwo', priceText: 'From $60', isVisible: false } }); expect(f.state().services).toEqual(catalog);
    await expect(f.service.execute('10', owner, { action: 'SAVE_LEGACY_DISPLAY', idempotencyKey: 'workspace-not-legacy', expectedPriceMenuRevision: f.revision(), itemId: 'display-a', changes: { priceText: '$1' } })).rejects.toMatchObject({ status: 400 });
    await f.service.execute('10', owner, { action: 'REMOVE_MENU_DISPLAY', idempotencyKey: 'workspace-remove', expectedPriceMenuRevision: f.revision(), itemId: 'display-a', confirm: true });
    expect(f.state().services[0].isActive).toBe(true); expect(f.state().services[0].variants[0].isActive).toBe(false);
  });
  test('hidden duplicate bindings count for last-position removal, while future orders guard true last removal', async () => {
    const f = fixture(); f.bind(); f.bind({ id: 'hidden-duplicate', isVisible: false }); f.state().futureVariant = true;
    await f.service.execute('10', owner, { action: 'REMOVE_MENU_DISPLAY', idempotencyKey: 'workspace-remove-visible', expectedPriceMenuRevision: f.revision(), itemId: 'display-a', confirm: true });
    expect(f.state().services[0].variants[0].isActive).toBe(true); const before = clone(f.state());
    await expect(f.service.execute('10', owner, { action: 'REMOVE_MENU_DISPLAY', idempotencyKey: 'workspace-remove-hidden', expectedPriceMenuRevision: f.revision(), itemId: 'hidden-duplicate', confirm: true })).rejects.toMatchObject({ status: 409 }); expect(f.state()).toEqual(before);
  });
  test('foreign service/child and display retarget attempts fail closed before any mutation', async () => {
    const f = fixture(); f.bind(); const before = clone(f.state());
    await expect(f.service.execute('11', admin, { ...f.edit(), expectedPriceMenuRevision: priceMenuRevision(11n, f.state().shops[1].studioProfile, []) })).rejects.toMatchObject({ status: 404 });
    await expect(f.service.execute('10', owner, f.edit({ variants: [{ id: '999', changes: { priceCents: 1 } }] }))).rejects.toMatchObject({ status: 404 });
    await expect(f.service.execute('10', owner, f.edit({ displays: [{ id: 'display-a', target: { kind: 'VARIANT', id: '999' }, changes: {} }] }))).rejects.toMatchObject({ status: 400 });
    expect(f.state()).toEqual(before); expect(f.writes).toHaveLength(0);
  });
});

describe('single-page strict input boundaries', () => {
  test('rejects mixed actions, unknown fields, coercion, duplicate identities, unsafe titles and malformed versions', async () => {
    const f = fixture(), valid = f.create();
    for (const body of [{ ...valid, actorId: '1' }, { ...valid, expectedPriceMenuRevision: 'bad' }, { ...valid, confirm: true },
      { ...valid, variants: [{ tempKey: 'x', changes: { name: 'A', durationMin: '60', priceCents: 1 } }] },
      { ...valid, variants: [{ tempKey: 'x', changes: {} }, { tempKey: 'x', changes: {} }] },
      { ...valid, service: { name: '<img src=x>' } }, { ...valid, service: { name: 'One\nTwo' } },
      { ...valid, service: { name: 'N'.repeat(201) } }, { ...valid, policy: { extraPrivilege: true } }]) {
      await expect(f.service.execute('10', owner, body)).rejects.toMatchObject({ status: 400 });
    }
    expect(f.state().receipts).toHaveLength(0); expect(f.writes).toHaveLength(0);
    expect(workspaceText('One\r\nTwo', 100, true, true)).toBe('One\nTwo');
    expect(() => parseWorkspaceCommand({ ...valid, serviceId: '20' })).toThrow();
  });
});

describe('single-page migrated structured-price compatibility (synthetic transaction)', () => {
  const legacy = (id = 'display-a') => ({ id, name: '30mins Massage', priceText: '30 min · $40', description: 'Cards+$3', isVisible: false,
    pricing: { kind: 'TIMED', baseName: 'Massage', durationMin: 30, priceCents: 4000, titleMode: 'CUSTOM', legacySource: { name: '30mins Massage', priceText: 'price=40; price_vip=0; og_price=0; price_minute=0; times=1' } } });
  test('legacy association stores original wording, exposes the canonical title, and applies the chosen visibility', async () => {
    const f = fixture();
    const original = { name: 'Old massage $9', priceText: 'Call for original promotion' };
    f.state().shops[0].studioProfile.priceMenu[0].items = [
      { id: 'now-hidden', ...original, isVisible: true },
      legacy('now-visible'),
    ];
    const command = f.edit({ displays: [
      { id: 'now-hidden', target: { kind: 'VARIANT', id: '30' }, changes: { isVisible: false, titleMode: 'AUTO' } },
      { id: 'now-visible', target: { kind: 'VARIANT', id: '30' }, changes: { isVisible: true, titleMode: 'AUTO' } },
    ] });
    const receipt = await f.service.execute('10', owner, command);
    expect(await f.service.execute('10', owner, command)).toEqual(receipt);
    const items = (await f.service.snapshot('10', owner, '20')).priceMenu[0].items;
    expect(items).toMatchObject([
      { isVisible: false, pricing: { priceCents: 6000, titleMode: 'AUTO', legacySource: original } },
      { isVisible: true, pricing: { priceCents: 6000, titleMode: 'AUTO', legacySource: legacy().pricing.legacySource } },
    ]);
    for (const item of items) {
      expect(item).toMatchObject({ booking: { serviceId: '20', variantId: '30' }, priceText: '' });
      expect(item.name).not.toContain('$9');
    }
    expect(f.state().receipts).toHaveLength(1);
  });
  test('snapshot keeps raw JSON and its revision unchanged while retaining custom wording and complete source in the read projection', async () => {
    const f = fixture(); f.bind(legacy()); const before = clone(f.state()), revision = f.revision();
    const result = await f.service.snapshot('10', owner, '20');
    expect(f.state()).toEqual(before); expect(f.revision()).toBe(revision); expect(result.priceMenuRevision).toBe(revision);
    expect(result.priceMenu[0].items[0]).toMatchObject({ name: '30mins Massage', priceText: '', isVisible: false, pricing: { titleMode: 'CUSTOM', legacySource: legacy().pricing.legacySource } });
    expect(f.writes).toHaveLength(0);
  });
  test('price-only command leaves every migrated menu field untouched and committed readback reflects only authoritative catalog pricing', async () => {
    const f = fixture(); f.bind(legacy()); f.bind(legacy('untouched')); const before = clone(f.state().shops[0].studioProfile);
    const result = await f.service.execute('10', owner, f.edit({ variants: [{ id: '30', changes: { priceCents: 6525 } }] }));
    expect(f.state().shops[0].studioProfile).toEqual(before); expect(result.changes.displayIds).toEqual([]);
    const read = await f.service.snapshot('10', owner, '20'); expect(read.priceMenuRevision).toBe(result.priceMenuRevision);
    expect(read.priceMenu[0].items[0]).toMatchObject({ name: '30mins Massage', pricing: { priceCents: 6525, titleMode: 'CUSTOM', legacySource: legacy().pricing.legacySource } });
  });
  test('explicit display edit normalizes only its target, preserving full source and every non-target raw field', async () => {
    const f = fixture(); f.bind(legacy()); f.bind(legacy('untouched')); const untouched = clone(f.state().shops[0].studioProfile.priceMenu[0].items[1]);
    await f.service.execute('10', owner, f.edit({ displays: [{ id: 'display-a', changes: { name: 'Explicit custom title', isVisible: true } }] }));
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[0]).toMatchObject({ name: 'Explicit custom title', priceText: '', isVisible: true, pricing: { titleMode: 'CUSTOM', legacySource: legacy().pricing.legacySource } });
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[1]).toEqual(untouched);
  });
  test('layout rename retains migrated raw content and service catalog byte-equivalence', async () => {
    const f = fixture(); f.bind(legacy()); const before = clone(f.state()), item = clone(before.shops[0].studioProfile.priceMenu[0].items[0]);
    await f.service.execute('10', owner, { action: 'SAVE_MENU_LAYOUT', idempotencyKey: 'workspace-legacy-layout', expectedPriceMenuRevision: f.revision(), groups: [{ index: 0, category: 'Moved name' }] });
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[0]).toEqual(item); expect(f.state().services).toEqual(before.services);
  });
  test('first variant upgrades only its legacy base binding, retains the historical source and leaves sibling raw wording intact', async () => {
    const f = fixture(); f.state().services[0].variants = []; f.bind({ ...legacy(), booking: { serviceId: '20' } });
    f.state().shops[0].studioProfile.priceMenu[0].items.push({ ...legacy('untouched'), booking: { serviceId: '999' } });
    const untouched = clone(f.state().shops[0].studioProfile.priceMenu[0].items[1]);
    await f.service.execute('10', owner, f.edit({ variants: [{ tempKey: 'new', changes: { name: '90 minutes', durationMin: 90, priceCents: 9000 } }] }));
    expect(f.state().services[0].variants).toHaveLength(2);
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[0]).toMatchObject({ priceText: '', pricing: { legacySource: legacy().pricing.legacySource }, booking: { serviceId: '20', variantId: expect.any(String) } });
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[1]).toEqual(untouched);
  });
});
