// Actual disposable MySQL: resolution is serialized with the actual write, not
// inferred from a failed browser request. Never run against retained shop data.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AccountCopyService } = require('../src/modules/account-copy/account-copy.service');

async function runAccountCopyRecovery(db, context) {
  if (process.env.MASSAJOY_ACCOUNT_DISPOSABLE !== 'fresh-container-only') throw Error('ACCOUNT_DISPOSABLE_GUARD_REQUIRED');
  const [{ name }] = await db.$queryRaw`SELECT DATABASE() AS name`;
  if (!/^mj2_test_account_[a-f0-9]{8}$/.test(name)) throw Error('ACCOUNT_DISPOSABLE_SCHEMA_REQUIRED');
  const { check, admin, accounts, shops, service: access } = context;
  const copies = new AccountCopyService(db);
  const base = { sourceShopId: String(shops.a.id), targetShopId: String(shops.b.id), kind: 'HOURS' };
  const reason = 'Synthetic isolated copy resolution';
  const grant = () => access.grant(admin, { ...base, permissions: ['SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'], reason });
  await grant();
  const protectedFields = { ownerId: true, address: true, phone: true, timezone: true, shortName: true };
  const before = await db.shop.findUnique({ where: { id: shops.b.id }, select: protectedFields });
  const ledger = await db.merchantProfile.findUnique({ where: { shopId: shops.b.id } });
  const request = async actor => ({ ...base, previewHash: (await copies.preview(actor, base)).previewHash, idempotencyKey: randomUUID() });
  const count = async () => ({ operations: await db.copyConfigOperation.count(), audits: await db.auditLog.count({ where: { action: 'SHOP_CONFIG_COPIED' } }) });
  let appliedBody, applied;

  await check('copy resolve preserves UNKNOWN before expiry and proves only expired original preview did not execute', async () => {
    const body = await request(accounts.a), initial = await count();
    assert.equal((await copies.resolve(accounts.a, body)).status, 'UNKNOWN');
    assert.deepEqual(await count(), initial);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 6 * 60 * 1000;
      const result = await copies.resolve(accounts.a, body);
      assert.equal(result.status, 'NOT_APPLIED'); assert.equal(result.reason, 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION');
      await assert.rejects(async () => copies.apply(accounts.a, body), error => error.getStatus() === 409);
    } finally { Date.now = realNow; }
    assert.deepEqual(await count(), initial);
  });
  await check('copy resolve reads committed receipt after expiry without replaying a write or audit', async () => {
    appliedBody = await request(accounts.a); applied = await copies.apply(accounts.a, appliedBody);
    const initial = await count(), realNow = Date.now;
    try { Date.now = () => realNow() + 6 * 60 * 1000; assert.deepEqual(await copies.resolve(accounts.a, appliedBody), applied); }
    finally { Date.now = realNow; }
    assert.deepEqual(await count(), initial);
    assert.deepEqual(Object.keys(applied).sort(), ['created','kind','operationId','skipped','sourceShopId','status','targetShopId'].sort());
  });
  await check('copy resolve serializes behind in-flight SQL apply and returns its actual committed result', async () => {
    const body = await request(accounts.a);
    let release, locked;
    const gate = new Promise(r => { release = r; }), held = new Promise(r => { locked = r; });
    const blocker = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM shops WHERE id = ${shops.a.id} FOR UPDATE`;
      locked(); await gate;
    }, { timeout: 20000 });
    await held;
    const pendingApply = copies.apply(accounts.a, body);
    // This is only ordering of lock admission in this synthetic integration
    // case. Correctness is checked from the real committed operation below.
    await new Promise(r => setTimeout(r, 150));
    const pendingResolve = copies.resolve(accounts.a, body);
    release(); await blocker;
    const [result, receipt] = await Promise.all([pendingApply, pendingResolve]);
    assert.equal(receipt.status, 'APPLIED'); assert.deepEqual(receipt, result);
    assert.equal(await db.copyConfigOperation.count({ where: { actorId: BigInt(accounts.a.id), idempotencyKey: body.idempotencyKey } }), 1);
  });
  await check('copy resolution validates original actor signature and key content without exposing other operations', async () => {
    await assert.rejects(async () => copies.resolve(accounts.b, appliedBody), error => error.getStatus() === 400);
    await assert.rejects(async () => copies.resolve(accounts.a, { ...appliedBody, targetShopId: String(shops.c.id) }), error => error.getStatus() === 400);
    await assert.rejects(async () => copies.resolve(accounts.a, { ...appliedBody, previewHash: appliedBody.previewHash + 'x' }), error => error.getStatus() === 400);
    const catalog = { ...base, kind: 'CATALOG' };
    const preview = await copies.preview(accounts.a, catalog);
    await assert.rejects(async () => copies.resolve(accounts.a, { ...catalog, previewHash: preview.previewHash, idempotencyKey: appliedBody.idempotencyKey }), error => error.getStatus() === 409);
  });
  await check('copy history is own-actor, permission scoped, bounded and projects no request keys or configuration', async () => {
    const result = await copies.history(accounts.a, { page: '1', limit: '2' });
    assert.ok(result.total >= 2); assert.equal(result.items.length, 2);
    assert.equal(result.page, 1); assert.equal(result.limit, 2);
    for (const row of result.items) {
      assert.equal(row.sourceShopId, base.sourceShopId); assert.equal(row.targetShopId, base.targetShopId);
      assert.deepEqual(Object.keys(row).sort(), ['created','kind','operationId','skipped','sourceShopId','status','targetShopId','createdAt','sourceShopName','targetShopName'].sort());
    }
    assert.equal((await copies.history(admin)).total, 0);
    assert.equal((await copies.history(accounts.b)).total, 0);
    await assert.rejects(async () => copies.history(accounts.staff), error => error.getStatus() === 403);
    for (const query of [{ page: '0' }, { page: '1e2' }, { limit: '51' }, { limit: ['2'] }]) await assert.rejects(async () => copies.history(accounts.a, query), error => error.getStatus() === 400);
  });
  await check('copy receipt projection discards unexpected JSON and fails closed for mismatched historical receipts', async () => {
    const row = await db.copyConfigOperation.findUnique({ where: { id: applied.operationId } });
    await db.copyConfigOperation.update({ where: { id: row.id }, data: { result: { ...row.result, privateUnexpectedField: 'synthetic-private-only' } } });
    assert.deepEqual(await copies.resolve(accounts.a, appliedBody), applied);
    await db.copyConfigOperation.update({ where: { id: row.id }, data: { result: { ...row.result, targetShopId: String(shops.c.id) } } });
    try { await assert.rejects(async () => copies.resolve(accounts.a, appliedBody), error => error.getStatus() === 503); }
    finally { await db.copyConfigOperation.update({ where: { id: row.id }, data: { result: row.result } }); }
  });
  await check('copy revocation hides history and blocks resolving unknown without claiming failure or changing configuration', async () => {
    const pending = await request(accounts.a), initial = await count();
    const row = await db.shopAccountGrant.findUnique({ where: { sourceShopId_targetShopId: { sourceShopId: shops.a.id, targetShopId: shops.b.id } } });
    await access.revoke(admin, String(row.id), { reason });
    await assert.rejects(async () => copies.resolve(accounts.a, pending), error => error.getStatus() === 403);
    assert.equal((await copies.history(accounts.a)).total, 0);
    assert.deepEqual(await count(), initial);
    assert.deepEqual(await db.shop.findUnique({ where: { id: shops.b.id }, select: protectedFields }), before);
    assert.deepEqual(await db.merchantProfile.findUnique({ where: { shopId: shops.b.id } }), ledger);
    assert.equal(await db.paymentRecord.count(), 0); assert.equal(await db.merchantTransaction.count(), 0);
  });
}
module.exports = { runAccountCopyRecovery };
