// Real disposable MySQL only. Uses actual copy/authorization/booking-hours services.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { AccountCopyService } = require('../src/modules/account-copy/account-copy.service');
const { normalizeHours } = require('../src/modules/booking/hours');

async function runAccountCopy(db, context) {
  if (process.env.MASSAJOY_ACCOUNT_DISPOSABLE !== 'fresh-container-only') throw Error('ACCOUNT_DISPOSABLE_GUARD_REQUIRED');
  const [{ name }] = await db.$queryRaw`SELECT DATABASE() AS name`;
  if (!/^mj2_test_account_[a-f0-9]{8}$/.test(name)) throw Error('ACCOUNT_DISPOSABLE_SCHEMA_REQUIRED');
  const { check, admin, accounts, shops, service: access } = context;
  const copies = new AccountCopyService(db), source = shops.a.id, target = shops.b.id;
  const base = { sourceShopId: String(source), targetShopId: String(target), kind: 'HOURS' };
  const reason = 'Synthetic controlled configuration-copy integration';
  const copyPermissions = ['SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'];
  const key = () => crypto.randomUUID();
  await db.shop.updateMany({ where: { id: { in: [source, target] } }, data: { status: 'PENDING' } });
  await db.user.updateMany({ where: { id: { in: [BigInt(accounts.a.id), BigInt(accounts.b.id)] } }, data: { status: 'ACTIVE' } });
  await access.grant(admin, { sourceShopId: String(source), targetShopId: String(target), permissions: copyPermissions, reason });
  const hours = normalizeHours({ monday: { open: '09:00', close: '17:00' } });
  await db.shop.update({ where: { id: source }, data: { businessHours: hours } });
  await db.shop.update({ where: { id: target }, data: { businessHours: normalizeHours({ monday: { open: '10:00', close: '18:00' } }), timezone: 'America/New_York' } });
  const protectedBefore = await db.shop.findUnique({ where: { id: target }, select: { ownerId: true, address: true, phone: true, timezone: true, shortName: true, latitude: true, longitude: true } });
  const financialBefore = await db.merchantProfile.findUnique({ where: { shopId: target } });

  await check('copy rejects staff, unassociated accounts and unsigned or mismatched previews', async () => {
    await assert.rejects(async () => copies.preview(accounts.staff, base));
    await assert.rejects(async () => copies.preview(accounts.b, base));
    const preview = await copies.preview(accounts.a, base);
    await assert.rejects(async () => copies.apply(accounts.a, { ...base, previewHash: preview.previewHash + 'x', idempotencyKey: key() }));
    await assert.rejects(async () => copies.apply(accounts.a, { ...base, targetShopId: String(shops.c.id), previewHash: preview.previewHash, idempotencyKey: key() }));
    assert.equal(await db.copyConfigOperation.count(), 0);
  });
  await check('copy checks both content permissions and rejects stale source or target configuration', async () => {
    await access.grant(admin, { sourceShopId: String(source), targetShopId: String(target), permissions: ['CATALOG_MANAGE', 'COPY_CONFIG'], reason });
    await assert.rejects(async () => copies.preview(accounts.a, base));
    await access.grant(admin, { sourceShopId: String(source), targetShopId: String(target), permissions: copyPermissions, reason });
    const preview = await copies.preview(accounts.a, base);
    await db.shop.update({ where: { id: target }, data: { businessHours: normalizeHours({ monday: { open: '11:00', close: '18:00' } }) } });
    await assert.rejects(async () => copies.apply(accounts.a, { ...base, previewHash: preview.previewHash, idempotencyKey: key() }), error => error.getStatus() === 409);
    assert.equal(await db.copyConfigOperation.count(), 0);
  });
  await check('hours copy applies once with actual actor audit and preserves identity, location and all financial records', async () => {
    const preview = await copies.preview(accounts.a, base), body = { ...base, previewHash: preview.previewHash, idempotencyKey: key() };
    const result = await copies.apply(accounts.a, body);
    assert.equal(result.status, 'APPLIED');
    const replay = await copies.apply(accounts.a, body); assert.deepEqual(replay, result);
    const realNow = Date.now; try { Date.now = () => realNow() + 6 * 60 * 1000; assert.deepEqual(await copies.apply(accounts.a, body), result); } finally { Date.now = realNow; }
    assert.equal(await db.copyConfigOperation.count(), 1);
    const updated = await db.shop.findUnique({ where: { id: target } }); assert.deepEqual(updated.businessHours, hours);
    for (const [field, before] of Object.entries(protectedBefore)) assert.equal(String(updated[field]), String(before));
    assert.deepEqual(await db.merchantProfile.findUnique({ where: { shopId: target } }), financialBefore);
    const audit = await db.auditLog.findFirst({ where: { action: 'SHOP_CONFIG_COPIED' }, orderBy: { id: 'desc' } });
    assert.equal(audit.operatorId, BigInt(accounts.a.id)); assert.equal(audit.targetId, target);
  });
  const sourceService = await db.shopService.create({ data: { shopId: source, name: 'Synthetic Couple Price', category: 'MASSAGE', durationMin: 60, priceCents: 15000,
    priceBasis: 'PER_BOOKING', participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE', staffBufferMin: 5, roomBufferMin: 10 } });
  const sourceVariant = await db.shopServiceVariant.create({ data: { serviceId: sourceService.id, name: '60 minutes', durationMin: 60, priceCents: 15000, priceBasis: 'PER_BOOKING', currency: 'usd' } });
  const catalog = { ...base, kind: 'CATALOG' };
  await check('catalog copy creates inactive independent service and variant IDs with valid requirements, never resources or private fields', async () => {
    const preview = await copies.preview(accounts.a, catalog);
    assert.equal(preview.changes.services[0].action, 'CREATE');
    const result = await copies.apply(accounts.a, { ...catalog, previewHash: preview.previewHash, idempotencyKey: key() });
    assert.equal(result.created, 1);
    const row = await db.shopService.findFirst({ where: { shopId: target, name: sourceService.name }, include: { variants: true } });
    assert.notEqual(row.id, sourceService.id); assert.equal(row.isActive, false); assert.equal(row.variants[0].isActive, false); assert.notEqual(row.variants[0].id, sourceVariant.id);
    for (const field of ['priceCents', 'durationMin', 'participantCount', 'requiredStaffCount', 'requiredRoomType', 'staffBufferMin', 'roomBufferMin']) assert.equal(row[field], sourceService[field]);
    assert.equal(row.variants[0].priceCents, sourceVariant.priceCents); assert.equal(await db.therapist.count({ where: { shopId: target } }), 0);
    assert.equal(await db.shopRoom.count({ where: { shopId: target } }), 0); assert.equal(await db.shopImage.count({ where: { shopId: target } }), 0);
    const protectedAfter = await db.shop.findUnique({ where: { id: target }, select: { ownerId: true, address: true, phone: true, timezone: true, shortName: true, latitude: true, longitude: true } });
    assert.deepEqual(protectedAfter, protectedBefore);
  });
  await check('catalog conflicts skip existing target values without replacement or duplicate rows', async () => {
    const row = await db.shopService.findFirst({ where: { shopId: target, name: sourceService.name } });
    await db.shopService.update({ where: { id: row.id }, data: { priceCents: 19900 } });
    const preview = await copies.preview(accounts.a, catalog); assert.equal(preview.changes.services[0].action, 'SKIP');
    const result = await copies.apply(accounts.a, { ...catalog, previewHash: preview.previewHash, idempotencyKey: key() });
    assert.equal(result.created, 0); assert.equal(result.skipped, 1); assert.equal(await db.shopService.count({ where: { shopId: target } }), 1);
    assert.equal((await db.shopService.findUnique({ where: { id: row.id } })).priceCents, 19900);
  });
  await check('revoking association prevents pending copy and replay reads without changing target or operations', async () => {
    const preview = await copies.preview(accounts.a, base);
    const grant = await db.shopAccountGrant.findUnique({ where: { sourceShopId_targetShopId: { sourceShopId: source, targetShopId: target } } });
    await access.revoke(admin, String(grant.id), { reason });
    const before = await db.copyConfigOperation.count();
    await assert.rejects(async () => copies.apply(accounts.a, { ...base, previewHash: preview.previewHash, idempotencyKey: key() }));
    assert.equal(await db.copyConfigOperation.count(), before);
    assert.equal(await db.paymentRecord.count(), 0); assert.equal(await db.merchantTransaction.count(), 0);
  });
}
module.exports = { runAccountCopy };
