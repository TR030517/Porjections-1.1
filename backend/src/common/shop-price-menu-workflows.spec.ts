import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { StudioService } from '../modules/studio/studio.service';
import { MerchantService } from '../modules/merchant/merchant.service';
import { AccountCopyService } from '../modules/account-copy/account-copy.service';
import { CopyPreviewDto } from '../modules/account-copy/account-copy.controller';
import { ReservationsService } from '../modules/reservations/reservations.service';
import { priceMenuRevision } from './shop-price-menu-revision';
import { UpdateShopDto } from '../modules/merchant/dto/merchant.dto';

const managed = '/api/v1/upload/media/11111111-1111-4111-8111-111111111111/file';
const menu = () => [{ category: '', items: [{ name: 'Original wording', priceText: '$80, ask in store', imageUrl: 'https://images.example.invalid/source.webp' }] }];
const actor = { id: '1', role: 'ADMIN' };

// Node's structuredClone creates objects outside Jest's VM realm. Build local
// fixture values so the strict production JSON-object guard sees Prisma-like
// plain objects; retain bigint IDs, Date instances and undefined properties.
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}

/** Real service/validator paths with staged in-memory rollback; not a substitute for SQL locking tests. */
function fixture() {
  const user = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null, loginName: `synthetic-${id}`, passwordHash: '$2b$10$' + 'a'.repeat(53) });
  const shop = (id: bigint) => ({ id, ownerId: 9n, name: `Synthetic ${id}`, shortName: `synthetic-${id}`, description: 'Introduction only', phone: '+12025550100',
    address: 'Synthetic address', city: '', state: '', zipCode: '', latitude: 0, longitude: 0, timezone: null, status: 'PENDING', deletedAt: null,
    businessHours: {}, createdAt: new Date('2026-10-29T00:00:00Z'), updatedAt: new Date('2026-10-29T00:00:00Z'),
    studioProfile: { sourceSample: { checksum: 'PRIVATE_SOURCE' }, privateProvider: { key: 'PRIVATE_PROVIDER' }, features: { onlineBooking: false },
      paymentPolicy: { payAtStoreEnabled: false, futureServerField: 'KEEP' }, gallery: [], priceMenu: menu() } });
  let state: any = { users: [user(1n, 'ADMIN'), user(2n), user(3n), user(9n)], shops: [shop(10n), shop(11n)], services: [], operations: [], audits: [], assets: [] };
  let failAudit = false;
  const writes: string[] = [];
  const decorated = (data: any, row: any) => ({ ...row, owner: data.users.find((u: any) => u.id === row.ownerId), shopImages: [], shopServices: clone(data.services.filter((service: any) => service.shopId === row.id)), staffGrants: [], incomingAccountGrants: [],
    loginBinding: { userId: row.id === 10n ? 2n : 3n, user: data.users.find((u: any) => u.id === (row.id === 10n ? 2n : 3n)) } });
  function client(data: any): any {
    return {
      $queryRaw: jest.fn(async (query: any) => {
        const sql = Array.isArray(query) ? query.join('?') : query.sql;
        if (sql.includes('media_assets')) return data.assets.filter((a: any) => query.values.includes(a.id));
        return [];
      }),
      $executeRaw: jest.fn(async (query: any) => { writes.push('media'); const row = data.assets.find((a: any) => query.values.includes(a.id)); if (row) row.status = query.sql.includes("status='ABANDONED'") ? 'ABANDONED' : 'BOUND'; return 1; }),
      user: { findFirst: jest.fn(async ({ where }: any) => data.users.find((u: any) => u.id === where.id && (!where.role || u.role === where.role) && (!where.status || u.status === where.status)) ?? null) },
      shop: {
        findMany: jest.fn(async () => data.shops.map((row: any) => decorated(data, row))),
        count: jest.fn(async () => data.shops.length),
        findFirst: jest.fn(async ({ where }: any) => { const row = data.shops.find((s: any) => s.id === where.id); return row ? decorated(data, row) : null; }),
        findUnique: jest.fn(async ({ where }: any) => { const row = data.shops.find((s: any) => s.id === where.id); return row ? decorated(data, row) : null; }),
        update: jest.fn(async ({ where, data: changes }: any) => { writes.push('shop'); const row = data.shops.find((s: any) => s.id === where.id); Object.assign(row, changes); return decorated(data, row); }),
      },
      shopAccountGrant: { findFirst: jest.fn(async () => null) },
      shopImage: { findMany: jest.fn(async () => []) },
      shopLoginBinding: { findUnique: jest.fn(async ({ where }: any) => { const row = data.shops.find((s: any) => s.id === where.shopId); return row ? decorated(data, row).loginBinding : null; }) },
      shopAlias: { findUnique: jest.fn(async () => null), create: jest.fn(async ({ data: input }: any) => input) },
      shopService: { findMany: jest.fn(async ({ where }: any) => clone(data.services.filter((service: any) => service.shopId === where.shopId && (!where.id?.in || where.id.in.includes(service.id))))), create: jest.fn(async ({ data: input }: any) => { writes.push('service'); const row = { id: BigInt(1000 + data.services.length), variants: [], addOns: [], ...input }; data.services.push(row); return row; }) },
      shopServiceVariant: { create: jest.fn(async ({ data: input }: any) => { writes.push('variant'); const parent = data.services.find((row: any) => row.id === input.serviceId), row = { id: BigInt(2000 + parent.variants.length), ...input }; parent.variants.push(row); return row; }) },
      copyConfigOperation: {
        findUnique: jest.fn(async ({ where }: any) => data.operations.find((o: any) => o.actorId === where.actorId_idempotencyKey.actorId && o.idempotencyKey === where.actorId_idempotencyKey.idempotencyKey) ?? null),
        create: jest.fn(async ({ data: input }: any) => { writes.push('operation'); data.operations.push(input); return input; }),
      },
      auditLog: { create: jest.fn(async ({ data: input }: any) => { if (failAudit) throw Error('Synthetic audit failure'); data.audits.push(input); return input; }) },
    };
  }
  // Serialize staged transactions as the real shop row lock does. This exercises
  // the fresh-read/CAS ordering, not database-level locking implementation.
  let queue = Promise.resolve();
  const transaction = (work: any) => {
    const run = queue.then(async () => { const staged = clone(state); const result = await work(client(staged)); state = staged; return result; });
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
  const db: any = new Proxy({}, { get: (_, key) => key === '$transaction' ? transaction : client(state)[key] });
  return { db, state: () => state, writes, failAudit: () => { failAudit = true; }, studio: new StudioService(db), merchant: new MerchantService(db, {} as any), copies: new AccountCopyService(db) };
}
const revision = (f: ReturnType<typeof fixture>, shopId = 10n) => priceMenuRevision(shopId, f.state().shops.find((shop: any) => shop.id === shopId).studioProfile, f.state().services);

describe('price menu revision preconditions on internal reads and locked writes', () => {
  test('platform list, merchant shops and both save responses agree on the current internal revision', async () => {
    const f = fixture(), baseline = revision(f);
    const platform = await f.studio.list('stores', {}, actor), merchant = await f.merchant.getMyShops('1', 'ADMIN');
    expect(platform.items.find((shop: any) => shop.id === '10').priceMenuRevision).toBe(baseline);
    expect(merchant.find((shop: any) => shop.id === 10n).priceMenuRevision).toBe(baseline);
    const saved = await f.studio.save('stores', '10', { priceMenu: [], expectedPriceMenuRevision: baseline }, actor);
    expect(saved.item.priceMenuRevision).toBe(revision(f)); expect(saved.item.priceMenuRevision).not.toBe(baseline);
    const again = await f.merchant.updateShop('2', '10', { priceMenu: menu(), expectedPriceMenuRevision: saved.item.priceMenuRevision });
    expect(again.priceMenuRevision).toBe(baseline); expect(again.priceMenuRevision).toBe(revision(f));
    expect(again).not.toHaveProperty('expectedPriceMenuRevision');
  });

  test('missing, stale and another-shop revisions reject before writes, media transitions or audit creation', async () => {
    for (const baseline of [undefined, null, 'a'.repeat(64), 'other-shop']) {
      const f = fixture(), before = clone(f.state());
      const expectedPriceMenuRevision = baseline === 'other-shop' ? revision(f, 11n) : baseline;
      const body = { priceMenu: [], expectedPriceMenuRevision };
      await expect(f.studio.save('stores', '10', body, actor)).rejects.toMatchObject({ response: { code: 'PRICE_MENU_CHANGED' }, status: 409 });
      await expect(f.merchant.updateShop('2', '10', body)).rejects.toMatchObject({ response: { code: 'PRICE_MENU_CHANGED' }, status: 409 });
      expect(f.state()).toEqual(before); expect(f.writes).toEqual([]);
    }
  });

  test('two editors using the same baseline cannot both commit different menus', async () => {
    const f = fixture(), baseline = revision(f);
    const firstMenu = [{ category: 'First editor', items: [{ name: 'First value', priceText: '$80' }] }];
    const secondMenu = [{ category: 'Second editor', items: [{ name: 'Stale value', priceText: '$90' }] }];
    const results = await Promise.allSettled([
      f.merchant.updateShop('2', '10', { priceMenu: firstMenu, expectedPriceMenuRevision: baseline }),
      f.studio.save('stores', '10', { priceMenu: secondMenu, expectedPriceMenuRevision: baseline }, actor),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ response: { code: 'PRICE_MENU_CHANGED' }, status: 409 });
    expect(f.state().shops[0].studioProfile.priceMenu).toEqual(firstMenu);
    expect(f.writes.filter(write => write === 'shop')).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
  });

  test('a stale ordinary full update preserves the new menu; an explicit stale full-menu update is atomic and rejected', async () => {
    const f = fixture(), baseline = revision(f), changed = [{ category: 'New', items: [{ name: 'Current value', priceText: 'Ask in store' }] }];
    await f.merchant.updateShop('2', '10', { priceMenu: changed, expectedPriceMenuRevision: baseline });
    const currentRevision = revision(f);
    const ordinary = await f.studio.save('stores', '10', { name: 'Updated name', about: 'Updated introduction', expectedPriceMenuRevision: baseline }, actor);
    expect(ordinary.item.priceMenu).toEqual(changed); expect(ordinary.item.priceMenuRevision).toBe(currentRevision);
    const before = clone(f.state());
    await expect(f.studio.save('stores', '10', { name: 'Must not commit', priceMenu: menu(), expectedPriceMenuRevision: baseline }, actor)).rejects.toMatchObject({ response: { code: 'PRICE_MENU_CHANGED' }, status: 409 });
    expect(f.state()).toEqual(before);
    const fresh = await f.studio.save('stores', '10', { name: 'Fresh name', priceMenu: [], expectedPriceMenuRevision: currentRevision }, actor);
    expect(fresh.item.name).toBe('Fresh name'); expect(fresh.item.priceMenu).toEqual([]);
    expect(f.state().shops[0].studioProfile.sourceSample.checksum).toBe('PRIVATE_SOURCE');
  });

  test('actual ValidationPipe metadata survives into the service and stale transformed requests are rejected', async () => {
    const f = fixture(), pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
    const body = { priceMenu: [], expectedPriceMenuRevision: revision(f) };
    const dto = await pipe.transform(body, { type: 'body', metatype: UpdateShopDto });
    const saved = await f.merchant.updateShop('2', '10', dto);
    expect(saved.priceMenu).toEqual([]); expect(saved.priceMenuRevision).toBe(revision(f));
    await expect(f.merchant.updateShop('2', '10', dto)).rejects.toMatchObject({ response: { code: 'PRICE_MENU_CHANGED' }, status: 409 });
  });

  test('new platform shop data accepts an initial menu without an existing editing baseline', async () => {
    const f = fixture();
    const data = await (f.studio as any).data(f.db, 'stores', { ownerId: '9', name: 'New shop', shortName: 'new-synthetic-shop', status: 'PENDING', priceMenu: menu() }, undefined, actor);
    expect(data.studioProfile.priceMenu).toEqual(menu()); expect(data).not.toHaveProperty('expectedPriceMenuRevision');
  });
});

describe('price menu saves preserve locked private profile and independent service data', () => {
  test('platform and merchant save static gallery subjects through real validation/media paths without upload transitions', async () => {
    const f = fixture(), original = clone(f.state().shops[0]);
    const platformMenu = [{ category: 'Body', items: [{ name: 'Body Massage', priceText: 'Call for price', imageUrl: '/service-gallery/v1/body-massage.webp' }] }];
    const platform = await f.studio.save('stores', '10', { priceMenu: platformMenu, expectedPriceMenuRevision: revision(f) }, actor);
    expect(platform.item.priceMenu).toEqual(platformMenu);
    expect(f.state().shops[0]).toEqual({ ...original, studioProfile: { ...original.studioProfile, priceMenu: platformMenu } });
    const merchantMenu = [{ category: 'Foot', items: [{ name: 'Foot Massage', priceText: 'Ask in store', imageUrl: '/service-gallery/v1/foot-massage.webp' }] }];
    const merchant = await f.merchant.updateShop('2', '10', { priceMenu: merchantMenu, expectedPriceMenuRevision: platform.item.priceMenuRevision });
    expect(merchant.priceMenu).toEqual(merchantMenu);
    expect(f.state().shops[0].studioProfile.priceMenu).toEqual(merchantMenu);
    expect(f.state().shops[0].studioProfile.sourceSample).toEqual(original.studioProfile.sourceSample);
    expect(f.writes).toEqual(['shop', 'shop']);
    expect(f.state().assets).toEqual([]);
    expect(f.state().audits.map((audit: any) => audit.detail.fields)).toEqual([['priceMenu'], ['priceMenu']]);
  });

  test('platform ordinary save preserves provenance/menu/private policy fields; menu clear is explicit and not reflected into description', async () => {
    const f = fixture();
    const original = clone(f.state().shops[0].studioProfile);
    const result = await f.studio.save('stores', '10', { name: 'Edited name', studioProfile: { sourceSample: 'CLIENT_INJECTION' } }, actor);
    expect(f.state().shops[0].studioProfile).toMatchObject(original);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SOURCE|PRIVATE_PROVIDER|CLIENT_INJECTION|futureServerField/);
    expect(result.item.priceMenu).toEqual(menu());
    await f.studio.save('stores', '10', { priceMenu: [], expectedPriceMenuRevision: result.item.priceMenuRevision }, actor);
    expect(f.state().shops[0].studioProfile.priceMenu).toEqual([]);
    expect(f.state().shops[0].studioProfile.sourceSample).toEqual(original.sourceSample);
    expect(f.state().shops[0].description).toBe('Introduction only');
    expect(f.writes).not.toContain('service'); expect(f.writes).not.toContain('variant');
  });

  test('merchant edits retain unknown server data, return a safe menu and do not let clients submit private profiles', async () => {
    const f = fixture();
    await f.merchant.updateShop('2', '10', { description: 'New introduction' });
    expect(f.state().shops[0].studioProfile.sourceSample.checksum).toBe('PRIVATE_SOURCE');
    const result = await f.merchant.updateShop('2', '10', { priceMenu: [{ category: '', items: [{ name: 'Price on request', priceText: '' }] }], expectedPriceMenuRevision: revision(f) });
    expect(result.priceMenu).toEqual([{ category: '', items: [{ name: 'Price on request', priceText: '' }] }]);
    expect(result).not.toHaveProperty('studioProfile'); expect(result).not.toHaveProperty('loginBinding');
    expect(JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toMatch(/PRIVATE|futureServerField/);
    await expect(f.merchant.updateShop('2', '10', { studioProfile: { priceMenu: [] } })).rejects.toThrow(BadRequestException);
  });

  test('invalid price input, malformed stored profile, unrelated merchant and audit failure leave existing data intact', async () => {
    for (const input of [null, [{ category: '', items: [{ name: 'Bad', priceText: 80 }] }]]) {
      const f = fixture(), before = clone(f.state());
      await expect(f.studio.save('stores', '10', { priceMenu: input, expectedPriceMenuRevision: revision(f) }, actor)).rejects.toThrow(BadRequestException);
      await expect(f.merchant.updateShop('2', '10', { priceMenu: input, expectedPriceMenuRevision: revision(f) })).rejects.toThrow(BadRequestException);
      expect(f.state()).toEqual(before);
    }
    const malformed = fixture(); malformed.state().shops[0].studioProfile = '{broken';
    await expect(malformed.studio.save('stores', '10', { name: 'Will not save' }, actor)).rejects.toThrow(ConflictException);
    await expect(malformed.merchant.updateShop('2', '10', { name: 'Will not save' })).rejects.toThrow(ConflictException);
    expect(malformed.state().shops[0].studioProfile).toBe('{broken');
    const denied = fixture(); await expect(denied.merchant.updateShop('3', '10', { priceMenu: [] })).rejects.toThrow(ForbiddenException);
    const failed = fixture(), before = clone(failed.state()); failed.failAudit();
    await expect(failed.merchant.updateShop('2', '10', { priceMenu: [], expectedPriceMenuRevision: revision(failed) })).rejects.toThrow('Synthetic audit failure'); expect(failed.state()).toEqual(before);
  });

  test('moving a shop image from gallery to menu keeps it bound, then clearing the final reference releases it', async () => {
    const f = fixture(); f.state().shops[0].studioProfile.gallery = [managed];
    f.state().assets.push({ id: '11111111-1111-4111-8111-111111111111', owner_id: 2n, shop_owner_id: 9n, shop_id: 10n, scope: 'SHOP', status: 'BOUND', expires_at: new Date(0) });
    // Clear the cover too: an omitted banner preserves the currently displayed
    // fallback cover, which would remain a valid reference after menu removal.
    await f.merchant.updateShop('2', '10', { gallery: [], bannerUrl: '', priceMenu: [{ category: '', items: [{ name: 'Photo', priceText: '', imageUrl: managed }] }], expectedPriceMenuRevision: revision(f) });
    expect(f.state().assets[0].status).toBe('BOUND');
    await f.merchant.updateShop('2', '10', { priceMenu: [], expectedPriceMenuRevision: revision(f) }); expect(f.state().assets[0].status).toBe('ABANDONED');
  });

  test('menu-only platform editing of an approved source sample preserves missing booking data; mixed updates still enforce full publication rules', async () => {
    const f = fixture(); f.state().shops[0].status = 'APPROVED';
    const before = clone(f.state().shops[0]);
    const nextMenu = [{ category: 'Source', items: [{ name: 'No duration supplied', priceText: '$50' }] }];
    const result = await f.studio.save('stores', '10', { priceMenu: nextMenu, expectedPriceMenuRevision: revision(f) }, actor);
    expect(result.item.priceMenu).toEqual(nextMenu);
    expect(f.state().shops[0]).toEqual({ ...before, studioProfile: { ...before.studioProfile, priceMenu: nextMenu } });
    expect(f.state().shops[0].timezone).toBeNull();
    expect(f.state().audits[0].detail.fields).toEqual(['priceMenu']);
    for (const mixed of [{ priceMenu: [], name: 'Mixed' }, { priceMenu: [], status: 'APPROVED' }, { priceMenu: [], sourceSample: 'Cannot bypass' }]) {
      const unchanged = clone(f.state());
      await expect(f.studio.save('stores', '10', { ...mixed, expectedPriceMenuRevision: revision(f) }, actor)).rejects.toThrow();
      expect(f.state()).toEqual(unchanged);
    }
  });

  test('payment-policy editing preserves menu, source provenance and unrelated future policy fields', async () => {
    const f = fixture(), before = clone(f.state().shops[0].studioProfile);
    expect(await new ReservationsService(f.db).paymentPolicy('10', actor, { payAtStoreEnabled: true })).toEqual({ paymentPolicy: { payAtStoreEnabled: true } });
    expect(f.state().shops[0].studioProfile).toEqual({ ...before, paymentPolicy: { ...before.paymentPolicy, payAtStoreEnabled: true } });
  });
});

describe('PRICE_MENU copy unifies target appointment identities while preserving protected fields', () => {
  const body: CopyPreviewDto = { sourceShopId: '10', targetShopId: '11', kind: 'PRICE_MENU' };
  const linkedSource = () => {
    const f = fixture();
    f.state().services.push({ id: 20n, shopId: 10n, name: 'Canonical massage', nameEn: null, category: 'MASSAGE', description: null, sortOrder: 0, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, durationKind: 'TIMED', durationMin: 60, priceCents: 7000,
      priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, isActive: true, addOns: [],
      variants: [{ id: 30n, serviceId: 20n, name: '60 min', durationMin: 60, priceCents: 9500, priceBasis: 'PER_BOOKING', currency: 'usd', sortOrder: 0, isActive: true }] });
    f.state().shops[0].studioProfile.priceMenu = [{ category: 'Massage', items: [{ id: 'source-menu-item', name: '60Mins Old wording $80', priceText: '',
      pricing: { kind: 'TIMED', baseName: 'Old wording', durationMin: 60, priceCents: 8000, titleMode: 'AUTO' },
      booking: { serviceId: '20', variantId: '30' }, bookingEnabled: true, bookingMode: 'SINGLE', reservedDurationMin: 60 }] }];
    return f;
  };
  let secret: string | undefined;
  beforeAll(() => { secret = process.env.JWT_SECRET; process.env.JWT_SECRET = 'synthetic-menu-copy-secret-at-least-32-characters'; });
  afterAll(() => { if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret; });

  test('preview/apply retain text and HTTPS photos, omit source-only managed image and replay the same receipt without rewriting', async () => {
    const f = fixture(); f.state().shops[0].studioProfile.priceMenu[0].items.push({ name: 'Shop-specific photo', priceText: '', imageUrl: managed });
    const before = clone(f.state().shops[1]), preview = await f.copies.preview(actor, body);
    expect(preview.changes.priceMenu.omittedManagedImages).toBe(1);
    expect(preview.changes.priceMenu.to[0].items[1]).not.toHaveProperty('imageUrl');
    const request = { ...body, previewHash: preview.previewHash, idempotencyKey: 'synthetic-menu-copy-001' };
    const first = await f.copies.apply(actor, request), after = f.state().shops[1];
    expect(first).toMatchObject({ kind: 'PRICE_MENU', created: 2, skipped: 0, groups: 1, omittedManagedImages: 1 });
    expect({ ...after, studioProfile: before.studioProfile }).toEqual(before);
    expect({ ...after.studioProfile, priceMenu: before.studioProfile.priceMenu }).toEqual(before.studioProfile);
    expect(after.studioProfile.priceMenu).toEqual(preview.changes.priceMenu.to);
    expect(await f.copies.apply(actor, request)).toEqual(first); expect(f.state().operations).toHaveLength(1);
    expect(f.writes.filter(x => x === 'shop')).toHaveLength(1); expect(f.writes).not.toContain('service'); expect(f.writes).not.toContain('variant');
    expect(f.state().audits[0].detail.fields).toEqual(['priceMenu', 'services', 'variants', 'addOns']);
  });

  test('copying a linked menu projects canonical values and replaces source identities with inactive target resources', async () => {
    const f = linkedSource(), before = clone(f.state()), preview = await f.copies.preview(actor, body);
    const projected = preview.changes.priceMenu.to[0].items[0];
    expect(projected).toMatchObject({ name: '60 min Canonical massage $95', priceText: '', pricing: { baseName: 'Canonical massage', priceCents: 9500, durationMin: 60 } });
    for (const field of ['id', 'booking', 'bookingEnabled', 'bookingMode', 'reservedDurationMin']) expect(projected).not.toHaveProperty(field);
    await f.copies.apply(actor, { ...body, previewHash: preview.previewHash, idempotencyKey: 'synthetic-linked-menu-copy' });
    const target = f.state().services.find((service: any) => service.shopId === 11n);
    expect(target).toMatchObject({ isActive: false, durationMin: 60, priceCents: 7000 });
    expect(target.variants[0]).toMatchObject({ isActive: false, priceCents: 9500 });
    expect(f.state().shops[1].studioProfile.priceMenu[0].items[0]).toMatchObject({ ...projected, booking: { serviceId: String(target.id), variantId: String(target.variants[0].id) }, bookingEnabled: false, bookingMode: 'SINGLE', reservedDurationMin: 60 });
    expect(preview.changes.priceMenu.catalogLinks).toMatchObject([{ sourceId: '20', resource: 'SERVICE', action: 'CREATE' }, { sourceId: '30', resource: 'VARIANT', action: 'CREATE' }]);
    expect(f.state().shops[1].studioProfile.features.onlineBooking).toBe(false);
    expect(f.state().shops[0]).toEqual(before.shops[0]);
    expect(f.state().services.filter((service: any) => service.shopId === 10n)).toEqual(before.services);
    expect(f.state().services.filter((service: any) => service.shopId === 11n)).toHaveLength(1);
    expect(f.writes.filter(write => write === 'service')).toHaveLength(1); expect(f.writes.filter(write => write === 'variant')).toHaveLength(1);
    expect(f.writes.filter(write => write === 'shop')).toEqual(['shop']);
  });

  test('a linked directory price change invalidates preview even when the stored source menu JSON is unchanged', async () => {
    const f = linkedSource(), storedMenu = clone(f.state().shops[0].studioProfile.priceMenu), preview = await f.copies.preview(actor, body);
    f.state().services[0].variants[0].priceCents = 10500;
    const before = clone(f.state());
    await expect(f.copies.apply(actor, { ...body, previewHash: preview.previewHash, idempotencyKey: 'synthetic-linked-menu-drift' }))
      .rejects.toMatchObject({ status: 409, message: '来源或目标配置已变化，请重新预览' });
    expect(f.state().shops[0].studioProfile.priceMenu).toEqual(storedMenu);
    expect(f.state()).toEqual(before);
    expect(f.writes).toEqual([]);
  });

  test('source/target menu drift, denied access and failed audit prevent a copied menu from committing', async () => {
    for (const index of [0,1]) {
      const f = fixture(), preview = await f.copies.preview(actor, body);
      f.state().shops[index].studioProfile.priceMenu = [];
      const before = clone(f.state());
      await expect(f.copies.apply(actor, { ...body, previewHash: preview.previewHash, idempotencyKey: 'synthetic-menu-drift' })).rejects.toThrow(ConflictException); expect(f.state()).toEqual(before);
    }
    const denied = fixture(); await expect(denied.copies.preview({ id: '2', role: 'MERCHANT' }, body)).rejects.toThrow(ForbiddenException);
    const failed = fixture(), preview = await failed.copies.preview(actor, body), before = clone(failed.state()); failed.failAudit();
    await expect(failed.copies.apply(actor, { ...body, previewHash: preview.previewHash, idempotencyKey: 'synthetic-menu-audit' })).rejects.toThrow('Synthetic audit failure'); expect(failed.state()).toEqual(before);
  });
});
