import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { AccountCopyService } from './account-copy.service';
import { CopyApplyDto, CopyPreviewDto } from './account-copy.controller';
import { planAddOnCopy } from './addon-copy-plan';
import { normalizeHours } from '../booking/hours';

const ALL = ['SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'RESERVATION_CONFIG', 'COPY_CONFIG'];
const actor = { id: '1', role: 'ADMIN' }, associated = { id: '4', role: 'MERCHANT' };
const body: CopyPreviewDto = { sourceShopId: '10', targetShopId: '11', kind: 'ADD_ONS' };
const parent = (id: bigint, shopId = 10n, patch: any = {}) => ({ id, shopId, name: 'Body Massage', category: 'MASSAGE', priceBasis: 'PER_PERSON', participantCount: 1, isActive: true,
  nameEn: null, durationMin: 60, priceCents: 8000, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, description: null, sortOrder: 0, variants: [], ...patch });
const addon = (id: bigint, serviceId = 100n, patch: any = {}) => ({ id, serviceId, name: 'Essential Oil', description: 'Original note', priceCents: 1000, currency: 'usd', isActive: true, sortOrder: 0,
  createdAt: new Date('2035-01-01T00:00:00Z'), updatedAt: new Date('2035-01-01T00:00:00Z'), ...patch });
const stable = (value: any) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = (value: any) => createHash('sha256').update(stable(value)).digest('hex');
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T : value;
}
function project(row: any, select?: any): any {
  if (!select) return clone(row);
  return Object.fromEntries(Object.entries(select).filter(([, v]) => v).map(([key, v]: any) => [key, key === 'variants' || key === 'addOns' ? (row[key] ?? []).map((variant: any) => project(variant, v.select)) : clone(row[key])]));
}
function fixture() {
  const user = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null });
  const shop = (id: bigint, login: bigint) => ({ id, ownerId: 9n, name: `Synthetic ${id}`, status: 'APPROVED', deletedAt: null, timezone: 'UTC', address: 'Protected', phone: '+12025550100',
    businessHours: { monday: { open: '09:00', close: '17:00', closed: false } }, studioProfile: { priceMenu: [{ category: 'Body', items: [{ name: 'Display', priceText: 'Call for price' }] }], privateData: 'KEEP' }, login });
  let state: any = { users: [user(1n, 'ADMIN'), user(2n), user(3n), user(4n), user(5n, 'STAFF'), user(9n)], shops: [shop(10n, 2n), shop(11n, 3n), shop(20n, 4n)],
    services: [parent(100n), parent(200n, 11n, { name: 'ＢＯＤＹ ＭＡＳＳＡＧＥ', isActive: false })], addons: [addon(1000n)],
    grants: [10n, 11n].map(targetShopId => ({ actorId: 4n, sourceShopId: 20n, targetShopId, status: 'ACTIVE', permissions: [...ALL] })), operations: [], audits: [],
    bookingSnapshots: [{ name: 'Historical', priceCents: 3000 }], balances: [1200], variants: [], therapists: [], rooms: [] };
  let failAudit = false;
  const events: string[] = [], mutations: string[] = [], historyQueries: any[] = [];
  const decorated = (data: any, row: any) => ({ ...row, loginBinding: { userId: row.login, user: data.users.find((u: any) => u.id === row.login) } });
  const requirements = (value: any): string[] => value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => key === 'array_contains' ? [String(child)] : requirements(child)) : [];
  const queryActor = (value: any): bigint | null => { if (!value || typeof value !== 'object') return null; if (typeof value.userId === 'bigint') return value.userId; for (const child of Object.values(value)) { const found = queryActor(child); if (found) return found; } return null; };
  function client(data: any): any {
    const filteredOps = (where: any) => data.operations.filter((row: any) => row.actorId === where.actorId && where.OR.some((clause: any) => row.kind === clause.kind && clause.sourceShopId.in.includes(row.sourceShopId) && clause.targetShopId.in.includes(row.targetShopId)));
    return {
      $queryRaw: jest.fn(async (q: any) => { events.push(q.sql?.includes('FOR UPDATE') && q.sql?.includes('shops') ? 'lock-shop' : 'read-auth-lock'); return []; }),
      user: { findFirst: async ({ where }: any) => data.users.find((u: any) => u.id === where.id && u.role === where.role && u.status === 'ACTIVE' && !u.deletedAt) ?? null },
      shop: {
        findFirst: async ({ where }: any) => { const row = data.shops.find((s: any) => s.id === where.id && !s.deletedAt); return row ? decorated(data, row) : null; },
        findMany: async ({ where }: any) => { historyQueries.push(clone(where)); const requested = requirements(where), uid = queryActor(where); return data.shops.filter((s: any) => !uid || s.login === uid || data.grants.some((g: any) => g.actorId === uid && g.targetShopId === s.id && g.status === 'ACTIVE' && requested.every(p => g.permissions.includes(p)))).map((s: any) => ({ id: s.id, name: s.name })); },
        update: async ({ where, data: patch }: any) => { mutations.push('shop'); const row = data.shops.find((s: any) => s.id === where.id); Object.assign(row, patch); return row; },
      },
      shopAccountGrant: { findFirst: async ({ where, select }: any) => { const uid = where.sourceShop.loginBinding.is.userId, row = data.grants.find((g: any) => g.actorId === uid && g.targetShopId === where.targetShopId && g.status === 'ACTIVE'); return row && select ? { sourceShopId: row.sourceShopId } : row ?? null; } },
      shopStaffGrant: { findUnique: async () => null },
      shopService: {
        findMany: async ({ where, take, select }: any) => data.services.filter((s: any) => s.shopId === where.shopId).sort((a: any, b: any) => a.id < b.id ? -1 : 1).slice(0, take).map((s: any) => project({ ...s, addOns: data.addons.filter((addon: any) => addon.serviceId === s.id) }, select)),
        create: async ({ data: patch }: any) => { mutations.push('service'); const row = { id: 300n, variants: [], ...patch }; data.services.push(row); return row; },
      },
      shopServiceVariant: { create: async ({ data: patch }: any) => { mutations.push('variant'); const row = { id: BigInt(5000 + data.variants.length), ...patch }; data.variants.push(row); data.services.find((service: any) => service.id === patch.serviceId).variants.push(row); return row; } },
      shopServiceAddOn: {
        findMany: async ({ where, take, select }: any) => { events.push('load-addons'); return data.addons.filter((a: any) => data.services.some((s: any) => s.id === a.serviceId && s.shopId === where.service.shopId)).slice(0, take).map((a: any) => project(a, select)); },
        create: async ({ data: patch }: any) => { mutations.push('addon'); const row = { id: BigInt(3000 + data.addons.length), createdAt: new Date(), updatedAt: new Date(), ...patch }; data.addons.push(row); return row; },
      },
      booking: { findMany: async () => [] },
      bookingResourceLock: { findMany: async () => [] },
      copyConfigOperation: {
        findUnique: async ({ where }: any) => data.operations.find((o: any) => o.actorId === where.actorId_idempotencyKey.actorId && o.idempotencyKey === where.actorId_idempotencyKey.idempotencyKey) ?? null,
        create: async ({ data: input }: any) => { mutations.push('operation'); const row = { createdAt: new Date(), ...input }; data.operations.push(row); return row; },
        count: async ({ where }: any) => filteredOps(where).length,
        findMany: async ({ where, skip, take }: any) => filteredOps(where).slice(skip, skip + take),
      },
      auditLog: { create: async ({ data: input }: any) => { mutations.push('audit'); if (failAudit) throw Error('Synthetic audit failure'); data.audits.push(input); return input; } },
    };
  }
  const db: any = new Proxy({}, { get: (_target, key) => key === '$transaction' ? async (work: any) => { const staged = clone(state), result = await work(client(staged)); state = staged; return result; } : client(state)[key] });
  return { service: new AccountCopyService(db), state: () => state, events, mutations, historyQueries, failAudit: () => { failAudit = true; } };
}

describe('deterministic standalone add-on copy planning', () => {
  test('matching includes service duration kind and reports explicit parent type metadata',()=>{
    const source=parent(100n,10n,{durationKind:'PER_SESSION'}),timed=parent(200n,11n,{durationKind:'TIMED'});
    expect(planAddOnCopy([source],[timed],[addon(1n)],[])[0]).toMatchObject({action:'SKIP',reasonCode:'MAIN_NOT_FOUND',sourceDurationKind:'PER_SESSION',targetDurationKind:null,targetServiceId:null});
    const variable=parent(200n,11n,{durationKind:'PER_SESSION'});
    expect(planAddOnCopy([source],[variable],[addon(1n)],[])[0]).toMatchObject({action:'CREATE',sourceDurationKind:'PER_SESSION',targetDurationKind:'PER_SESSION',targetServiceId:'200'});
    expect(()=>planAddOnCopy([parent(100n,10n,{durationKind:null})],[timed],[addon(1n)],[])).toThrow(BadRequestException);
  });
  test('matches only the exact normalized four-field main key and copies inactive sources as inactive drafts without mutating source data', () => {
    const source = [parent(100n)], target = [parent(200n, 11n, { name: '  ＢＯＤＹ ＭＡＳＳＡＧＥ  ', isActive: false })], rows = [addon(1n, 100n, { isActive: false })], before = clone(rows);
    expect(planAddOnCopy(source, target, rows, [])[0]).toMatchObject({ sourceId: '1', sourceServiceId: '100', targetServiceId: '200', targetServiceName: target[0].name, action: 'CREATE', reasonCode: 'NEW', sourceActive: false, priceCents: 1000 });
    expect(rows).toEqual(before);
    for (const patch of [{ name: 'Body Work' }, { category: 'OTHER' }, { priceBasis: 'PER_BOOKING' }, { participantCount: 2 }]) expect(planAddOnCopy(source, [parent(200n, 11n, patch)], rows, [])[0]).toMatchObject({ action: 'SKIP', reasonCode: 'MAIN_NOT_FOUND', targetServiceId: null, targetServiceName: null });
  });
  test('either-side main ambiguity wins and never projects a guessed target, even when only source is ambiguous', () => {
    for (const [s, t] of [[[parent(100n), parent(101n)], [parent(200n, 11n)]], [[parent(100n)], [parent(200n, 11n), parent(201n, 11n)]]] as any[]) {
      expect(planAddOnCopy(s, t, [addon(1n)], [])[0]).toMatchObject({ reasonCode: 'AMBIGUOUS_MAIN', targetServiceId: null, targetServiceName: null, action: 'SKIP' });
    }
  });
  test('source duplicate names all skip, target inactive names are preserved and name matching is NFKC/case/trim exact', () => {
    const s = [parent(100n)], t = [parent(200n, 11n)];
    expect(planAddOnCopy(s, t, [addon(1n), addon(2n, 100n, { name: ' ＥＳＳＥＮＴＩＡＬ ＯＩＬ ' })], []).map(x => x.reasonCode)).toEqual(['DUPLICATE_SOURCE_NAME', 'DUPLICATE_SOURCE_NAME']);
    const existing = addon(3n, 200n, { isActive: false, priceCents: 9000 });
    expect(planAddOnCopy(s, t, [addon(1n)], [existing])[0]).toMatchObject({ action: 'SKIP', reasonCode: 'TARGET_NAME_EXISTS', targetServiceId: '200' });
    expect(existing.priceCents).toBe(9000); expect(existing.isActive).toBe(false);
  });
  test('capacity counts inactive target rows and earlier creates in stable source sort order', () => {
    const existing = Array.from({ length: 49 }, (_, i) => addon(BigInt(100 + i), 200n, { name: `Existing ${i}`, isActive: false }));
    const rows = [addon(2n, 100n, { name: 'Second', sortOrder: 2 }), addon(1n, 100n, { name: 'First', sortOrder: 1 })];
    expect(planAddOnCopy([parent(100n)], [parent(200n, 11n)], rows, existing).map(x => [x.name, x.action, x.reasonCode])).toEqual([['First', 'CREATE', 'NEW'], ['Second', 'SKIP', 'TARGET_LIMIT']]);
  });
  test('rejects parent/source/target aggregate limits and invalid USD payload instead of partially dropping rows', () => {
    const s = [parent(100n)], t = [parent(200n, 11n)];
    expect(() => planAddOnCopy(Array.from({ length: 501 }, (_, i) => parent(BigInt(i + 1))), t, [], [])).toThrow(BadRequestException);
    expect(() => planAddOnCopy(s, Array.from({ length: 501 }, (_, i) => parent(BigInt(i + 1000), 11n)), [], [])).toThrow(BadRequestException);
    expect(() => planAddOnCopy(s, t, Array.from({ length: 501 }, (_, i) => addon(BigInt(i + 1))), [])).toThrow(BadRequestException);
    expect(() => planAddOnCopy(s, t, [], Array.from({ length: 2001 }, (_, i) => addon(BigInt(i + 1), 200n)))).toThrow(BadRequestException);
    for (const patch of [{ priceCents: 1.5 }, { priceCents: 10000001 }, { currency: 'eur' }, { name: '<b>Oil</b>' }, { isActive: 'false' }]) expect(() => planAddOnCopy(s, t, [addon(1n, 100n, patch)], [])).toThrow(BadRequestException);
  });
  test('accepts all exact total boundaries while preserving the per-parent fifty-item limit', () => {
    const s = Array.from({ length: 500 }, (_, i) => parent(BigInt(i + 1), 10n, { name: `Main ${i}` }));
    const t = Array.from({ length: 500 }, (_, i) => parent(BigInt(i + 1001), 11n, { name: `Main ${i}` }));
    const sourceRows = Array.from({ length: 500 }, (_, i) => addon(BigInt(i + 1), BigInt(Math.floor(i / 50) + 1), { name: `Source item ${i}` }));
    const targetRows = Array.from({ length: 2000 }, (_, i) => addon(BigInt(i + 5001), BigInt(Math.floor(i / 50) + 1001), { name: `Existing item ${i}` }));
    const rows = planAddOnCopy(s, t, sourceRows, targetRows);
    expect(rows).toHaveLength(500); expect(rows.every(row => row.action === 'SKIP' && row.reasonCode === 'TARGET_LIMIT')).toBe(true);
  });
});

describe('signed add-on copy transactions, permissions and legacy compatibility', () => {
  let secret: string | undefined;
  beforeAll(() => { secret = process.env.JWT_SECRET; process.env.JWT_SECRET = 'SyntheticCopySigningSecret-Unique-2035-Only'; });
  afterAll(() => { if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret; });
  const applyBody = (preview: any, key = 'synthetic-addon-copy-001') => ({ ...body, previewHash: preview.previewHash, idempotencyKey: key });
  test('preview is read-only and apply creates only new inactive target configuration, one operation and audit', async () => {
    const f = fixture(), before = clone(f.state()), preview = await f.service.preview(actor, body);
    expect(f.state()).toEqual(before); expect(f.mutations).toEqual([]);
    expect(Object.keys(preview.changes.addOns[0]).sort()).toEqual(['sourceId','sourceServiceId','sourceServiceName','targetServiceId','targetServiceName','sourceDurationKind','targetDurationKind','name','description','priceCents','currency','sortOrder','sourceActive','action','reasonCode','reason'].sort());
    const result = await f.service.apply(actor, applyBody(preview));
    expect(result).toMatchObject({ kind: 'ADD_ONS', created: 1, skipped: 0 });
    expect(f.mutations).toEqual(['addon', 'operation', 'audit']);
    expect(f.state().addons[1]).toMatchObject({ serviceId: 200n, name: 'Essential Oil', priceCents: 1000, isActive: false });
    expect(f.state().addons[1].id).not.toBe(1000n); expect(f.state().addons[1]).not.toHaveProperty('sourceId');
    for (const key of ['shops','services','bookingSnapshots','balances','variants','therapists','rooms']) expect(f.state()[key]).toEqual(before[key]);
    expect(f.state().addons[0]).toEqual(before.addons[0]); expect(f.state().audits[0].detail.fields).toEqual(['addOns']);
    const fresh = await f.service.preview(actor, body); expect(fresh.changes.addOns[0].reasonCode).toBe('TARGET_NAME_EXISTS');
  });
  test('all three permissions must exist on both sides, including independent checks of catalog versus reservation rights', async () => {
    for (const side of [10n, 11n]) for (const permission of ['COPY_CONFIG','CATALOG_MANAGE','RESERVATION_CONFIG']) {
      const f = fixture(); f.state().grants.find((g: any) => g.targetShopId === side).permissions = ALL.filter(p => p !== permission);
      await expect(f.service.preview(associated, body)).rejects.toThrow(ForbiddenException);
      expect(f.mutations).toEqual([]); expect(f.events).not.toContain('load-addons');
    }
    const f = fixture(); await expect(f.service.preview({ id: '5', role: 'STAFF' }, body)).rejects.toThrow(ForbiddenException);
  });
  test.each([[10n,11n],[11n,10n]])('own/associated price-menu copy %s to %s requires complete unified-menu access and records history', async (sourceShopId,targetShopId) => {
    const who={id:'2',role:'MERCHANT'},input={sourceShopId:String(sourceShopId),targetShopId:String(targetShopId),kind:'PRICE_MENU' as const};
    const setup=(permissions:string[])=>{const f=fixture();f.state().grants.push({actorId:2n,sourceShopId:10n,targetShopId:11n,status:'ACTIVE',permissions});return f;};
    for(const permissions of [['SHOP_SETTINGS_MANAGE'],['CATALOG_MANAGE'],['COPY_CONFIG'],['COPY_CONFIG','CATALOG_MANAGE'],['COPY_CONFIG','RESERVATION_CONFIG']]){
      const f=setup(permissions),before=clone(f.state());await expect(f.service.preview(who,input)).rejects.toThrow(ForbiddenException);expect(f.state()).toEqual(before);expect(f.mutations).toEqual([]);
    }
    const f=setup(['COPY_CONFIG','CATALOG_MANAGE','RESERVATION_CONFIG']),before=clone(f.state()),preview=await f.service.preview(who,input),request={...input,previewHash:preview.previewHash,idempotencyKey:'copy-only-menu-'+sourceShopId};
    expect(f.state()).toEqual(before);const receipt=await f.service.apply(who,request);expect(receipt).toMatchObject({kind:'PRICE_MENU',sourceShopId:String(sourceShopId),targetShopId:String(targetShopId)});
    expect(await f.service.apply(who,request)).toEqual(receipt);expect(await f.service.resolve(who,request)).toEqual(receipt);expect((await f.service.history(who)).items).toHaveLength(1);
    expect(f.state().operations).toHaveLength(1);expect(f.state().audits).toHaveLength(1);
    for(const key of ['services','variants','addons','therapists','rooms','bookingSnapshots','balances'])expect(f.state()[key]).toEqual(before[key]);
    const grant=f.state().grants.find((row:any)=>row.actorId===2n&&row.targetShopId===11n);grant.permissions=['SHOP_SETTINGS_MANAGE'];
    expect((await f.service.history(who)).items).toEqual([]);const revoked=clone(f.state());
    await expect(f.service.resolve(who,request)).rejects.toThrow(ForbiddenException);await expect(f.service.apply(who,request)).rejects.toThrow(ForbiddenException);expect(f.state()).toEqual(revoked);
  });
  test.each([10n,11n])('unified price-menu permissions must remain active on side %s', async side => {
    const f=fixture(),input={sourceShopId:'10',targetShopId:'11',kind:'PRICE_MENU' as const};
    for(const grant of f.state().grants)grant.permissions=[...ALL];
    const preview=await f.service.preview(associated,input),request={...input,previewHash:preview.previewHash,idempotencyKey:'two-associated-menu-'+side};
    f.state().grants.find((grant:any)=>grant.targetShopId===side).permissions=['CATALOG_MANAGE'];const before=clone(f.state());
    await expect(f.service.preview(associated,input)).rejects.toThrow(ForbiddenException);await expect(f.service.apply(associated,request)).rejects.toThrow(ForbiddenException);expect(f.state()).toEqual(before);expect(f.mutations).toEqual([]);
    f.state().grants.find((grant:any)=>grant.targetShopId===side).permissions=[...ALL];
    expect((await f.service.apply(associated,request)).kind).toBe('PRICE_MENU');
  });
  test('hours alone needs COPY_CONFIG; unified menu requires catalog and reservation rights', async () => {
    const f=fixture(),input={sourceShopId:'10',targetShopId:'11',kind:'HOURS' as const};for(const grant of f.state().grants)grant.permissions=['COPY_CONFIG'];
    const preview=await f.service.preview(associated,input);expect((await f.service.apply(associated,{...input,previewHash:preview.previewHash,idempotencyKey:'copy-only-hours'})).kind).toBe('HOURS');
    const catalog=fixture();for(const grant of catalog.state().grants)grant.permissions=['CATALOG_MANAGE'];
    await expect(catalog.service.preview(associated,input)).rejects.toThrow(ForbiddenException);expect(catalog.mutations).toEqual([]);
    const menu={...input,kind:'PRICE_MENU' as const}; await expect(f.service.preview(associated,menu)).rejects.toThrow(ForbiddenException); for(const grant of f.state().grants)grant.permissions=[...ALL]; const signed=await f.service.preview(associated,menu);f.state().shops.find((shop:any)=>shop.id===11n).studioProfile.priceMenu=[{category:'Target changed',items:[{name:'Preserve new target',priceText:'Do not overwrite'}]}];const before=clone(f.state()), mutationsBefore=f.mutations.slice();
    await expect(f.service.apply(associated,{...menu,previewHash:signed.previewHash,idempotencyKey:'menu-target-drift-remains'})).rejects.toThrow(ConflictException);expect(f.state()).toEqual(before);expect(f.mutations).toEqual(mutationsBefore);
  });
  test('source add-on, target add-on and either main-key drift reject the signed plan without partial writes', async () => {
    for (const field of ['sourcePrice','targetName','sourceParent','targetParent','sourceInvalid']) {
      const f = fixture(), p = await f.service.preview(actor, body);
      if (field === 'sourcePrice') f.state().addons[0].priceCents = 2000;
      if (field === 'sourceInvalid') f.state().addons[0].currency = 'eur';
      if (field === 'targetName') f.state().addons.push(addon(2000n, 200n, { name: 'Other existing' }));
      if (field === 'sourceParent') f.state().services[0].participantCount = 2;
      if (field === 'targetParent') f.state().services[1].name = 'Changed';
      const before = clone(f.state()); await expect(f.service.apply(actor, applyBody(p))).rejects.toThrow(ConflictException);
      expect(f.state()).toEqual(before); expect(f.mutations).toEqual([]);
    }
  });
  test('original key replays immutable receipt after drift/expiry, while another digest with that key is rejected', async () => {
    const f = fixture(), p = await f.service.preview(actor, body), request = applyBody(p), first = await f.service.apply(actor, request);
    f.state().addons[0].name = 'New name'; const future = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(p.expiresAt) + 1);
    try { expect(await f.service.apply(actor, request)).toEqual(first); expect(await f.service.resolve(actor, request)).toEqual(first); }
    finally { future.mockRestore(); }
    expect(f.state().operations).toHaveLength(1); expect(f.state().addons).toHaveLength(2);
    const changed = await f.service.preview(actor, body); await expect(f.service.apply(actor, applyBody(changed))).rejects.toThrow(ConflictException);
  });
  test('unknown and expired absent requests resolve without writes, and expired new apply never creates configurations', async () => {
    const f = fixture(), p = await f.service.preview(actor, body), request = applyBody(p);
    expect(await f.service.resolve(actor, request)).toMatchObject({ status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED' });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(p.expiresAt) + 1);
    try { expect(await f.service.resolve(actor, request)).toMatchObject({ status: 'NOT_APPLIED' }); await expect(f.service.apply(actor, request)).rejects.toThrow(ConflictException); }
    finally { clock.mockRestore(); }
    expect(f.mutations).toEqual([]);
  });
  test('history ANDs all required shop permissions, and resolve/replay cannot bypass later revocation', async () => {
    const f = fixture(), p = await f.service.preview(associated, body), request = applyBody(p);
    await f.service.apply(associated, request);
    const history = await f.service.history(associated); expect(history.items).toHaveLength(1); expect(history.items[0]).toMatchObject({ kind: 'ADD_ONS', created: 1 });
    expect(f.historyQueries.some(q => q.AND?.length === 3)).toBe(true);
    f.state().grants.find((g: any) => g.targetShopId === 11n).permissions = ALL.filter(p => p !== 'RESERVATION_CONFIG');
    expect((await f.service.history(associated)).items).toEqual([]);
    await expect(f.service.resolve(associated, request)).rejects.toThrow(ForbiddenException);
    await expect(f.service.apply(associated, request)).rejects.toThrow(ForbiddenException);
    expect(f.state().operations).toHaveLength(1);
  });
  test('new receipt/history rejects unknown fields and impossible aggregate counts instead of presenting unverifiable results', async () => {
    const f = fixture(), p = await f.service.preview(actor, body); await f.service.apply(actor, applyBody(p));
    const row = f.state().operations[0];
    for (const result of [{ ...row.result, created: 500, skipped: 1 }, { ...row.result, hidden: 'PRIVATE' }, { ...row.result, skipped: -1 }]) expect(() => (f.service as any).receipt({ ...row, result })).toThrow(ServiceUnavailableException);
  });
  test('audit failure rolls back newly created target rows and operation together', async () => {
    const f = fixture(), p = await f.service.preview(actor, body), before = clone(f.state()); f.failAudit();
    await expect(f.service.apply(actor, applyBody(p))).rejects.toThrow('Synthetic audit failure'); expect(f.state()).toEqual(before);
  });
  test('real DTO boundary accepts ADD_ONS but rejects client action, plan, target parent IDs and price injection', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
    expect((await pipe.transform(body, { type: 'body', metatype: CopyPreviewDto })).kind).toBe('ADD_ONS');
    for (const patch of [{ action: 'CREATE' }, { targetServiceId: '200' }, { priceCents: 1 }, { changes: { addOns: [] } }]) await expect(pipe.transform({ ...body, previewHash: 'token', idempotencyKey: 'synthetic-copy-dto', ...patch }, { type: 'body', metatype: CopyApplyDto })).rejects.toThrow();
  });
  test('signed previews cannot be moved to another actor, reversed store pair or different copy kind', async () => {
    const f = fixture(), p = await f.service.preview(actor, body), request = applyBody(p);
    for (const [who, command] of [[associated, request], [actor, { ...request, sourceShopId: '11', targetShopId: '10' }], [actor, { ...request, kind: 'CATALOG' }]] as const) await expect(Promise.resolve().then(() => f.service.apply(who, command))).rejects.toThrow(BadRequestException);
    expect(f.mutations).toEqual([]); expect(f.state().operations).toEqual([]);
  });
  test('catalog copies non-timed semantics to a new disabled parent and type-only drift refuses an unapplied preview',async()=>{
    const f=fixture();f.state().services[0].durationKind='VARIABLE';
    const input={...body,kind:'CATALOG' as const},p=await f.service.preview(actor,input);
    expect(p.changes.services[0]).toMatchObject({action:'CREATE',durationKind:'VARIABLE'});
    const receipt=await f.service.apply(actor,{...input,previewHash:p.previewHash,idempotencyKey:'non-timed-catalog-copy'});
    expect(receipt.created).toBe(1);expect(f.state().services.find((s:any)=>s.id===300n)).toMatchObject({durationKind:'VARIABLE',isActive:false});
    const another=fixture(),preview=await another.service.preview(actor,body);another.state().services[0].durationKind='VARIABLE';
    await expect(another.service.apply(actor,applyBody(preview))).rejects.toThrow(ConflictException);expect(another.mutations).toEqual([]);
  });
  test('a previously committed legacy catalog request replays its old signed digest despite current duration kind',async()=>{
    const f=fixture(),operationId='11111111-1111-4111-8111-111111111111',idempotencyKey='legacy-duration-copy-result';
    const oldDigest=digest({kind:'CATALOG',sourceRows:'legacy-without-kind',targetRows:[]});
    const payload=Buffer.from(stable({actor:actor.id,source:'10',target:'11',kind:'CATALOG',digest:oldDigest,expires:Date.now()-60000})).toString('base64url');
    const previewHash=payload+'.'+createHmac('sha256',process.env.JWT_SECRET!).update('shop-config-copy:'+payload).digest('base64url');
    const result={operationId,status:'APPLIED',kind:'CATALOG',created:1,skipped:0,sourceShopId:'10',targetShopId:'11'};
    f.state().operations.push({id:operationId,actorId:1n,sourceShopId:10n,targetShopId:11n,kind:'CATALOG',idempotencyKey,requestHash:digest({source:'10',target:'11',kind:'CATALOG',previewDigest:oldDigest}),result});
    f.state().services[0].durationKind='VARIABLE';
    const request={...body,kind:'CATALOG' as const,previewHash,idempotencyKey};
    expect(await f.service.apply(actor,request)).toEqual(result);expect(await f.service.resolve(actor,request)).toEqual(result);
    expect(f.mutations).toEqual([]);expect(f.events).not.toContain('load-addons');
  });
  test('current-schema kind-aware catalog and legacy hours/menu signing ignore unrelated add-on configuration', async () => {
    const fields = ['id','isActive','name','nameEn','category','durationMin','durationKind','priceCents','priceBasis','participantCount','requiredStaffCount','requiredRoomType','staffBufferMin','roomBufferMin','description','sortOrder'];
    const select = Object.fromEntries(fields.map(key => [key, true]));
    for (const kind of ['HOURS','CATALOG'] as const) {
      const f = fixture(), oldBody = { ...body, kind }, source = f.state().shops[0], target = f.state().shops[1], p = await f.service.preview(actor, oldBody);
      const [payload, signature] = p.previewHash.split('.'), signed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const fingerprint = kind === 'HOURS' ? { kind, source: [source.timezone, source.businessHours], target: [target.timezone, target.businessHours] }
        : { kind, sourceRows: [project(f.state().services[0], select)].map(row => ({ ...row, durationKind: row.durationKind === undefined ? 'TIMED' : row.durationKind, variants: [] })), targetRows: [project(f.state().services[1], select)].map(row => ({ ...row, durationKind: row.durationKind === undefined ? 'TIMED' : row.durationKind, variants: [] })) };
      expect(signed.digest).toBe(digest(fingerprint));
      expect(signature).toBe(createHmac('sha256', process.env.JWT_SECRET!).update('shop-config-copy:' + payload).digest('base64url'));
      f.state().addons[0].priceCents = 9000;
      expect(JSON.parse(Buffer.from((await f.service.preview(actor, oldBody)).previewHash.split('.')[0], 'base64url').toString()).digest).toBe(signed.digest);
      const request = { ...oldBody, previewHash: p.previewHash, idempotencyKey: 'legacy-compatible-' + kind };
      const first = await f.service.apply(actor, request); expect(await f.service.apply(actor, request)).toEqual(first);
      if (kind === 'HOURS') expect(f.state().shops[1].businessHours).toEqual(normalizeHours(source.businessHours));
      expect(f.events).not.toContain('load-addons');
    }
  });
});


describe('unified PRICE_MENU signed transactions', () => {
  const input = { sourceShopId: '10', targetShopId: '11', kind: 'PRICE_MENU' as const };
  let secret: string | undefined;
  beforeAll(() => { secret = process.env.JWT_SECRET; process.env.JWT_SECRET = 'synthetic-unified-menu-secret-32-characters'; });
  afterAll(() => { if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret; });
  function linked() {
    const f = fixture();
    f.state().services[0].name = 'Couples Massage';
    f.state().services[0].participantCount = 2; f.state().services[0].requiredStaffCount = 2;
    f.state().services[0].variants.push({ id: 101n, serviceId: 100n, name: '90 minutes', durationMin: 90, priceCents: 22000, priceBasis: 'PER_BOOKING', currency: 'usd', sortOrder: 0, isActive: true });
    f.state().shops[0].studioProfile.priceMenu = [{ category: 'Couples', items: [{ name: 'Stale wording', priceText: 'Stale price', booking: { serviceId: '100', variantId: '101' } }] }];
    f.state().shops[1].studioProfile.features = { onlineBooking: false, reviews: true };
    return f;
  }
  test('atomic menu/catalog mapping retains history and settings, retries use immutable receipt and fresh previews reuse IDs', async () => {
    const f = linked(), before = clone(f.state()), p = await f.service.preview(actor, input);
    expect(f.state()).toEqual(before); expect(f.mutations).toEqual([]);
    expect(p.changes.priceMenu.catalogLinks).toMatchObject([{ resource: 'SERVICE', sourceId: '100', targetId: null }, { resource: 'VARIANT', sourceId: '101', targetId: null }]);
    const request = { ...input, previewHash: p.previewHash, idempotencyKey: 'unified-menu-atomic' }, result = await f.service.apply(actor, request);
    const target = f.state().services.find((row: any) => row.shopId === 11n && row.name === 'Couples Massage');
    expect(target).toMatchObject({ isActive: false, participantCount: 2, requiredStaffCount: 2 }); expect(target.variants[0].isActive).toBe(false);
    expect(f.state().shops[1].studioProfile.priceMenu[0].items[0]).toMatchObject({ booking: { serviceId: String(target.id), variantId: String(target.variants[0].id) }, bookingEnabled: false, pricing: { priceCents: 22000 } });
    expect(f.state().shops[1].studioProfile.features).toEqual(before.shops[1].studioProfile.features);
    for (const field of ['users', 'bookingSnapshots', 'balances', 'therapists', 'rooms']) expect(f.state()[field]).toEqual(before[field]);
    expect(f.state().services.find((row: any) => row.id === 200n)).toEqual(before.services.find((row: any) => row.id === 200n));
    const after = clone(f.state()); expect(await f.service.apply(actor, request)).toEqual(result); expect(await f.service.resolve(actor, request)).toEqual(result); expect(f.state()).toEqual(after);
    const fresh = await f.service.preview(actor, input); expect(fresh.changes.priceMenu.catalogLinks.every((row: any) => row.action === 'REUSE')).toBe(true);
    await f.service.apply(actor, { ...input, previewHash: fresh.previewHash, idempotencyKey: 'unified-menu-second' });
    expect(f.state().services).toHaveLength(after.services.length); expect(f.state().variants).toHaveLength(after.variants.length);
    expect((await f.service.history(actor)).items).toHaveLength(2);
  });
  test('audit failure rolls new resources and menu back together', async () => {
    const f = linked(), p = await f.service.preview(actor, input), before = clone(f.state()); f.failAudit();
    await expect(f.service.apply(actor, { ...input, previewHash: p.previewHash, idempotencyKey: 'unified-menu-rollback' })).rejects.toThrow('Synthetic audit failure');
    expect(f.state()).toEqual(before);
  });
  test('source option, target unrelated catalog and target activation changes invalidate the signed plan before writes', async () => {
    for (const change of ['sourcePrice', 'targetPolicy', 'targetActivation']) {
      const f = linked(), p = await f.service.preview(actor, input);
      if (change === 'sourcePrice') f.state().services[0].variants[0].priceCents = 23000;
      if (change === 'targetPolicy') f.state().services[1].staffBufferMin = 15;
      if (change === 'targetActivation') f.state().services[1].isActive = true;
      const before = clone(f.state());
      await expect(f.service.apply(actor, { ...input, previewHash: p.previewHash, idempotencyKey: 'unified-menu-drift-' + change })).rejects.toThrow(ConflictException);
      expect(f.state()).toEqual(before); expect(f.mutations).toEqual([]);
    }
  });
  test('a committed legacy menu receipt still replays, but an unexecuted old stripped-menu plan cannot apply', async () => {
    const f = linked(), operationId = '22222222-2222-4222-8222-222222222222', idempotencyKey = 'legacy-menu-receipt';
    const oldDigest = digest({ kind: 'PRICE_MENU', source: f.state().shops[0].studioProfile.priceMenu, target: f.state().shops[1].studioProfile.priceMenu });
    const signed = (expires: number) => { const payload = Buffer.from(stable({ actor: actor.id, source: '10', target: '11', kind: 'PRICE_MENU', digest: oldDigest, expires })).toString('base64url'); return payload + '.' + createHmac('sha256', process.env.JWT_SECRET!).update('shop-config-copy:' + payload).digest('base64url'); };
    const result = { operationId, status: 'APPLIED', kind: 'PRICE_MENU', created: 1, skipped: 0, sourceShopId: '10', targetShopId: '11', groups: 1, omittedManagedImages: 0 };
    f.state().operations.push({ id: operationId, actorId: 1n, sourceShopId: 10n, targetShopId: 11n, kind: 'PRICE_MENU', idempotencyKey, requestHash: digest({ source: '10', target: '11', kind: 'PRICE_MENU', previewDigest: oldDigest }), result });
    const before = clone(f.state()), request = { ...input, previewHash: signed(Date.now() - 10000), idempotencyKey };
    expect(await f.service.apply(actor, request)).toEqual(result); expect(await f.service.resolve(actor, request)).toEqual(result);
    await expect(f.service.apply(actor, { ...input, previewHash: signed(Date.now() + 10000), idempotencyKey: 'unexecuted-legacy-menu' })).rejects.toThrow(ConflictException);
    expect(f.state()).toEqual(before); expect(f.mutations).toEqual([]);
  });
});
