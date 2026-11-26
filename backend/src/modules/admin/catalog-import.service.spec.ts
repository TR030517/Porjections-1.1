/** Transactional decisions with a serialized rollback-capable memory fixture.
 * Actual MySQL locks/HTTP are checked separately in an isolated synthetic DB. */
import { CatalogImportService } from './catalog-import.service';
import { catalogDigest } from './catalog-import.parser';

const actor = { id: '1', role: 'ADMIN' }, other = { id: '2', role: 'ADMIN' };
const text = 'name,category,duration_minutes,price_usd,description\nMassage,MASSAGE,90,75,Public description\nMassage,MASSAGE,60,50,Public description';
const copy = <T>(value: T): T => structuredClone(value);
function fixture() {
  const users = new Map<bigint, any>([1n, 2n].map(id => [id, { id, role: 'ADMIN', status: 'ACTIVE', deletedAt: null }]));
  const shops = new Map<bigint, any>([11n, 12n].map(id => [id, { id, name: `Synthetic ${id}`, shortName: `synthetic${id}`, status: 'PENDING', deletedAt: null }]));
  const services = new Map<bigint, any>(), variants = new Map<bigint, any>(), audits: any[] = [], locks: any[] = [], writes: any[] = [];
  let serviceId = 100n, variantId = 200n, queue = Promise.resolve(), failAudit = false, failVariant = false, badSave = false;
  const failures: any[] = [];
  const db: any = {
    $queryRaw: jest.fn(async (query: any) => { locks.push({ table: query.strings.join('').includes('FROM shops') ? 'shops' : 'users', id: query.values[0] }); return []; }),
    user: { findFirst: jest.fn(async ({ where }: any) => { const u = users.get(where.id); return u && u.role === where.role && u.status === where.status && u.deletedAt === null ? { id: u.id } : null; }) },
    shop: { findUnique: jest.fn(async ({ where }: any) => copy(shops.get(where.id) ?? null)) },
    shopService: {
      findMany: jest.fn(async ({ where, take }: any) => copy([...services.values()].filter(s => s.shopId === where.shopId).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, take))),
      create: jest.fn(async ({ data }: any) => { const id = ++serviceId, row = { ...copy(data), id, createdAt: new Date(), updatedAt: new Date() }; services.set(id, row); writes.push({ type: 'service', id }); return badSave ? { ...row, isActive: true } : copy(row); }),
    },
    shopServiceVariant: {
      findMany: jest.fn(async ({ where, take }: any) => copy([...variants.values()].filter(v => services.get(v.serviceId)?.shopId === where.service.shopId).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, take))),
      create: jest.fn(async ({ data }: any) => { if (failVariant) throw Error('Synthetic variant failure'); const id = ++variantId, row = { ...copy(data), id, createdAt: new Date(), updatedAt: new Date() }; variants.set(id, row); writes.push({ type: 'variant', id }); return copy(row); }),
    },
    auditLog: {
      findMany: jest.fn(async ({ where }: any) => audits.filter(a => a.operatorId === where.operatorId && a.action === where.action && a.targetType === where.targetType && a.targetId === where.targetId && a.detail.requestKeyHash === where.detail.equals).slice(-2).reverse().map(a => ({ detail: copy(a.detail) }))),
      create: jest.fn(async ({ data }: any) => { if (failAudit) throw Error('Synthetic audit failure'); audits.push(copy(data)); return data; }),
    },
  };
  db.$transaction = jest.fn((work: any) => {
    const pending = queue.then(async () => {
      if (failures.length) throw failures.shift();
      const before = { services: copy(services), variants: copy(variants), audits: copy(audits), writes: copy(writes), serviceId, variantId };
      try { return await work(db); } catch (error) {
        services.clear(); before.services.forEach((v, k) => services.set(k, v)); variants.clear(); before.variants.forEach((v, k) => variants.set(k, v));
        audits.splice(0, audits.length, ...before.audits); writes.splice(0, writes.length, ...before.writes); serviceId = before.serviceId; variantId = before.variantId; throw error;
      }
    });
    queue = pending.catch(() => undefined); return pending;
  });
  return { db, users, shops, services, variants, audits, locks, writes, failures, service: new CatalogImportService(db),
    failAudit: () => { failAudit = true; }, failVariant: () => { failVariant = true; }, badSave: () => { badSave = true; } };
}
const rejection = async (pending: Promise<any>, code: string) => {
  try { await pending; throw Error('Expected rejection'); } catch (error: any) { expect(error.getResponse?.().catalogImportCode).toBe(code); }
};
const seed = (f: ReturnType<typeof fixture>, id = 10n, name = 'Existing', category = 'MASSAGE') => {
  const row = { id, shopId: 11n, name, category, isActive: true, durationMin: 60, priceCents: 5000, priceBasis: 'PER_BOOKING', participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' };
  f.services.set(id, row); return row;
};

describe('catalog safe append and receipts', () => {
  test('explicit timed CSV creates a separate timed group when only a non-timed namesake exists',async()=>{
    const f=fixture(),saved={...seed(f,10n,'Massage'),durationKind:'PER_SESSION'};f.services.set(10n,saved);
    const before=catalogDigest(saved),p=await f.service.preview(actor,'11',text);
    expect(p.summary.newServices).toBe(1);expect(p.groups[0].action).toBe('CREATE');
    const r=await f.service.apply(actor,'11',text,p.previewToken,'timed-kind-explicit-key');
    expect(catalogDigest(f.services.get(10n))).toBe(before);expect(f.services.get(BigInt(r.created[0].serviceId)).durationKind).toBe('TIMED');
  });
  test('skips the entire normalized same-name/category group, preserves legacy fallback and unrelated shops', async () => {
    const f = fixture(), old = seed(f, 10n, '  MASSAGE  '), oldBytes = catalogDigest(old);
    f.services.set(20n, { ...old, id: 20n, shopId: 12n, name: 'Foot' });
    const source = text + '\nFoot,REFLEXOLOGY,60,45,';
    const p = await f.service.preview(actor, '11', source);
    expect(p.summary).toMatchObject({ newServices: 1, newVariants: 1, skippedServices: 1 });
    expect(p.groups[0]).toMatchObject({ action: 'SKIP', existingIds: ['10'] });
    const receipt = await f.service.apply(actor, '11', source, p.previewToken, 'safe-append-key');
    expect(receipt.summary).toEqual({ createdServices: 1, createdVariants: 1, skippedServices: 1 });
    expect(catalogDigest(f.services.get(10n))).toBe(oldBytes);
    expect([...f.variants.values()].some(v => v.serviceId === 10n)).toBe(false);
    expect(f.locks).toEqual([{ table: 'shops', id: 11n }, { table: 'users', id: 1n }]);
    expect(f.audits[0]).toMatchObject({ action: 'CATALOG_IMPORT_APPLY', targetType: 'CATALOG_IMPORT', targetId: 1n, operatorId: 1n });
    expect(JSON.stringify(f.audits[0].detail)).not.toContain('safe-append-key');
    expect(JSON.stringify(f.audits[0].detail)).not.toContain('previewToken');
    expect(JSON.stringify(f.audits[0].detail)).not.toContain('Public description');
  });
  test('creates only disabled single-person services and disabled USD variants; shortest duration supplies base', async () => {
    const f = fixture(), p = await f.service.preview(actor, '11', text), r = await f.service.apply(actor, '11', text, p.previewToken, 'disabled-new-key');
    expect(r.summary).toEqual({ createdServices: 1, createdVariants: 2, skippedServices: 0 });
    expect([...f.services.values()][0]).toMatchObject({ name: 'Massage', nameEn: 'Massage', durationMin: 60, priceCents: 5000, isActive: false, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0 });
    expect([...f.variants.values()].map(v => [v.name, v.durationMin, v.priceCents, v.currency, v.isActive, v.priceBasis, v.sortOrder])).toEqual([
      ['60 min', 60, 5000, 'usd', false, 'PER_BOOKING', 0], ['90 min', 90, 7500, 'usd', false, 'PER_BOOKING', 1],
    ]);
  });
  test('all existing groups have no applicable token, inactive rows and duplicate existing names remain intact', async () => {
    const f = fixture(); seed(f, 10n, 'Massage').isActive = false; seed(f, 11n, 'massage');
    const p = await f.service.preview(actor, '11', text); expect(p.canApply).toBe(false); expect(p.previewToken).toBeNull(); expect(p.expiresAt).toBeNull();
    expect(p.groups[0].existingIds).toEqual(['10', '11']); expect(f.writes).toEqual([]);
  });
  test.each(['shop status', 'shop identity', 'inactive service', 'inactive variant', 'new catalog row'])('invalidates whole preview after %s changes', async kind => {
    const f = fixture(); seed(f); f.variants.set(30n, { id: 30n, serviceId: 10n, name: 'Old', durationMin: 60, priceCents: 50, isActive: false, currency: 'usd' });
    const p = await f.service.preview(actor, '11', text);
    if (kind === 'shop status') f.shops.get(11n).status = 'ACTIVE';
    else if (kind === 'shop identity') f.shops.get(11n).name = 'Renamed';
    else if (kind === 'inactive service') f.services.get(10n).isActive = false;
    else if (kind === 'inactive variant') f.variants.get(30n).currency = 'eur';
    else seed(f, 12n, 'Another');
    await rejection(f.service.apply(actor, '11', text, p.previewToken, 'stale-catalog-key'), 'TARGET_CHANGED');
    expect(f.writes).toEqual([]); expect(f.audits).toEqual([]);
  });
  test('same actor/key concurrent apply mutates once, receipt restores without text and replays before token validation', async () => {
    const f = fixture(), p = await f.service.preview(actor, '11', text);
    const results = await Promise.all([1, 2].map(() => f.service.apply(actor, '11', text, p.previewToken, 'concurrent-catalog')));
    expect(results.map(r => r.replayed).sort()).toEqual([false, true]); expect(f.services.size).toBe(1); expect(f.variants.size).toBe(2); expect(f.audits).toHaveLength(1);
    f.shops.get(11n).deletedAt = new Date();
    const replay = await f.service.apply(actor, '11', text, 'unavailable-or-expired-token', 'concurrent-catalog');
    expect(replay.operationId).toBe(results[0].operationId); expect(replay.replayed).toBe(true);
    expect(await f.service.result(actor, 'concurrent-catalog')).toMatchObject({ found: true, state: 'APPLIED', receipt: { operationId: replay.operationId } });
    expect(await f.service.result(other, 'concurrent-catalog')).toEqual({ found: false });
  });
  test('key reuse conflicts on shop or parsed text and another actor has an independent namespace', async () => {
    const f = fixture(), p = await f.service.preview(actor, '11', text); await f.service.apply(actor, '11', text, p.previewToken, 'key-scope-test');
    await rejection(f.service.apply(actor, '12', text, p.previewToken, 'key-scope-test'), 'REQUEST_KEY_REUSED');
    await rejection(f.service.apply(actor, '11', text.replace('75', '76'), p.previewToken, 'key-scope-test'), 'REQUEST_KEY_REUSED');
    const next = await f.service.preview(other, '12', text); const r = await f.service.apply(other, '12', text, next.previewToken, 'key-scope-test');
    expect(r.shopId).toBe('12'); expect(f.audits).toHaveLength(2);
  });
  test('signature binds actor, shop and parsed input; first apply must be unexpired', async () => {
    const f = fixture(), p = await f.service.preview(actor, '11', text);
    await rejection(f.service.apply(other, '11', text, p.previewToken, 'other-actor-key'), 'PREVIEW_MISMATCH');
    await rejection(f.service.apply(actor, '12', text, p.previewToken, 'other-shop-key'), 'PREVIEW_MISMATCH');
    await rejection(f.service.apply(actor, '11', text.replace('75', '76'), p.previewToken, 'other-text-key'), 'PREVIEW_MISMATCH');
    await rejection(f.service.apply(actor, '11', text, p.previewToken!.slice(0, -8) + 'AAAAAAAA', 'bad-signature-key'), 'PREVIEW_INVALID');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60000);
    try { await rejection(f.service.apply(actor, '11', text, p.previewToken, 'expired-preview-key'), 'PREVIEW_EXPIRED'); } finally { clock.mockRestore(); }
    expect(f.writes).toEqual([]);
  });
  test('absent result is not failure; resolve fences late apply and does not lock or write any shop', async () => {
    const f = fixture(), p = await f.service.preview(actor, '11', text);
    expect(await f.service.result(actor, 'fence-late-key')).toEqual({ found: false });
    const terminal = await f.service.resolve(actor, '11', 'fence-late-key', p.packageDigest);
    expect(terminal).toMatchObject({ found: true, state: 'NOT_APPLIED', shopId: '11', packageDigest: p.packageDigest });
    expect(f.locks).toEqual([{ table: 'users', id: 1n }]); expect(f.db.shop.findUnique).toHaveBeenCalledTimes(1);
    expect(await f.service.resolve(actor, '11', 'fence-late-key', p.packageDigest)).toEqual(terminal);
    expect(await f.service.result(actor, 'fence-late-key')).toEqual(terminal);
    await rejection(f.service.apply(actor, '11', text, p.previewToken, 'fence-late-key'), 'REQUEST_CLOSED');
    await rejection(f.service.resolve(actor, '12', 'fence-late-key', p.packageDigest), 'REQUEST_KEY_REUSED');
    expect(f.writes).toEqual([]); expect(f.audits).toHaveLength(1);
    const fresh = await f.service.preview(actor, '11', text); await f.service.apply(actor, '11', text, fresh.previewToken, 'after-fence-key'); expect(f.services.size).toBe(1);
  });
  test('apply/resolve races yield exactly one terminal receipt and no late write after NOT_APPLIED', async () => {
    for (const resolveFirst of [true, false]) {
      const f = fixture(), p = await f.service.preview(actor, '11', text), apply = () => f.service.apply(actor, '11', text, p.previewToken, 'terminal-race-key'), end = () => f.service.resolve(actor, '11', 'terminal-race-key', p.packageDigest);
      const outcomes = await Promise.allSettled(resolveFirst ? [end(), apply()] : [apply(), end()]);
      const result = await f.service.result(actor, 'terminal-race-key'); expect(result).toMatchObject({ state: resolveFirst ? 'NOT_APPLIED' : 'APPLIED' });
      expect(f.audits).toHaveLength(1); expect(f.services.size).toBe(resolveFirst ? 0 : 1); expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(resolveFirst ? 1 : 0);
    }
  });
  test.each(['audit', 'variant', 'verification'])('%s failure rolls back every created row and receipt', async stage => {
    const f = fixture(), p = await f.service.preview(actor, '11', text);
    if (stage === 'audit') f.failAudit(); else if (stage === 'variant') f.failVariant(); else f.badSave();
    await expect(f.service.apply(actor, '11', text, p.previewToken, 'rollback-key')).rejects.toThrow();
    expect(f.services.size).toBe(0); expect(f.variants.size).toBe(0); expect(f.audits).toEqual([]); expect(f.writes).toEqual([]);
  });
  test.each([{ role: 'MERCHANT' }, { status: 'DISABLED' }, { deletedAt: new Date() }])('live ADMIN DB state is enforced for preview/apply/result/resolve (%p)', async change => {
    const f = fixture(), p = await f.service.preview(actor, '11', text); Object.assign(f.users.get(1n), change);
    for (const pending of [f.service.preview(actor, '11', text), f.service.apply(actor, '11', text, p.previewToken, 'revoked-key'), f.service.result(actor, 'revoked-key'), f.service.resolve(actor, '11', 'revoked-key', p.packageDigest)]) await expect(pending).rejects.toThrow('管理员账户不可用');
    expect(f.writes).toEqual([]); expect(f.audits).toEqual([]);
  });
  test('non-admin actors, missing/deleted shops, invalid keys and int64 overflow fail closed', async () => {
    const f = fixture();
    await expect(f.service.preview({ id: '1', role: 'MERCHANT' }, '11', text)).rejects.toThrow('仅公司管理员');
    await expect(f.service.preview(actor, '99', text)).rejects.toThrow('门店不存在');
    f.shops.get(11n).deletedAt = new Date(); await expect(f.service.preview(actor, '11', text)).rejects.toThrow('门店不存在');
    await rejection(f.service.result(actor, 'bad'), 'REQUEST_KEY_INVALID');
    await rejection(f.service.resolve(actor, '9223372036854775808', 'good-key-eight', 'a'.repeat(64)), 'SHOP_ID_INVALID');
  });
  test('bounds total existing service and variant reads and blocks overflow', async () => {
    const f = fixture(); for (let id = 1n; id <= 501n; id++) seed(f, id, `Existing ${id}`);
    await rejection(f.service.preview(actor, '11', text), 'CATALOG_TOO_LARGE');
    expect(f.db.shopService.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 501 })); expect(f.db.shopServiceVariant.findMany).not.toHaveBeenCalled();
    f.services.clear(); seed(f); for (let id = 1n; id <= 2001n; id++) f.variants.set(id, { id, serviceId: 10n });
    await rejection(f.service.preview(actor, '11', text), 'CATALOG_TOO_LARGE'); expect(f.db.shopServiceVariant.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2001 }));
  });
  test('bounded retry only accepts transaction-aborted DB conflicts, not ambiguous connection errors', async () => {
    const f = fixture(); f.failures.push({ code: 'P2034' }, { code: 'P2010', meta: { code: '1213' } }); expect((await f.service.preview(actor, '11', text)).canApply).toBe(true);
    const count = f.db.$transaction.mock.calls.length; f.failures.push({ code: 'P2028' }); await expect(f.service.preview(actor, '11', text)).rejects.toMatchObject({ code: 'P2028' }); expect(f.db.$transaction.mock.calls.length).toBe(count + 1);
    f.failures.push(...Array.from({ length: 3 }, () => ({ code: 'P2034' }))); await expect(f.service.preview(actor, '11', text)).rejects.toThrow('写入冲突');
  });
  test('malformed or duplicate receipts stay blocked instead of guessing a result', async () => {
    const f = fixture(), p = await f.service.preview(actor, '11', text); await f.service.apply(actor, '11', text, p.previewToken, 'damaged-receipt-key');
    f.audits[0].detail.receipt.summary.createdVariants++;
    await expect(f.service.result(actor, 'damaged-receipt-key')).rejects.toThrow('收据暂不可用');
    f.audits.push(copy(f.audits[0])); await expect(f.service.result(actor, 'damaged-receipt-key')).rejects.toThrow('收据暂不可用');
  });
});
