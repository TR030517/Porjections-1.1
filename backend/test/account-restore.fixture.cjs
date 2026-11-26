// Nonempty synthetic backup source only. Never run against an existing schema.
// Historical provision records deliberately survive an unbind and a rebind.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { hash } = require('bcryptjs');
const sharp = require('sharp');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function seedAccountRestore(db, { writeMedia }) {
  let stage = 'GUARDS';
  try {
  assert.equal(process.env.MASSAJOY_ACCOUNT_RESTORE_DISPOSABLE, 'fresh-container-only');
  const [{ name }] = await db.$queryRaw`SELECT DATABASE() AS name`;
  assert.match(name, /^mj2_test_account_restore_[a-f0-9]{8}$/);
  assert.equal(await db.user.count(), 0);
  const migrations = await db.$queryRaw`SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations`;
  assert.equal(migrations.length, 23); assert.ok(migrations.every(row => row.finished_at && !row.rolled_back_at));
  stage = 'USERS';
  const suffix = randomBytes(4).toString('hex'), passwordHash = await hash('Synthetic-restore-' + randomBytes(24).toString('base64url'), 4);
  const add = (label, role) => db.user.create({ data: { name: 'Synthetic restore ' + label, role, status: 'ACTIVE', passwordHash,
    ...(role === 'MERCHANT' ? { loginName: label + '-' + suffix, phone: null, email: null } : { phone: null, email: label + '-' + suffix + '@example.invalid' }) } });
  const admin = await add('admin', 'ADMIN'), former = await add('former-operator', 'ADMIN'), owner = await add('financial-owner', 'MERCHANT');
  const a = await add('login-a', 'MERCHANT'), b = await add('login-b', 'MERCHANT'), retiredA = await add('retired-a', 'MERCHANT'), retiredC = await add('retired-c', 'MERCHANT'), customer = await add('customer', 'CUSTOMER');
  stage = 'SHOPS';
  const shops = [];
  for (let index = 0; index < 3; index++) {
    const shop = await db.shop.create({ data: { ownerId: owner.id, name: 'Synthetic restore shop ' + index, shortName: 'restore-' + suffix + '-' + index,
      phone: 'SYNTHETIC', address: 'Synthetic address', city: 'Synthetic city', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', timezone: 'UTC', status: index === 1 ? 'SUSPENDED' : 'PENDING' } });
    await db.merchantProfile.create({ data: { shopId: shop.id, userId: owner.id } }); shops.push(shop);
  }
  const [sa, sb, sc] = shops;
  stage = 'PROVISION_HISTORY';
  // Create immutable APPLIED history and matching creation audit while these
  // bindings exist, then emulate a later controlled unbind/rebind. Restoration
  // must not guess that the old successful operations failed retroactively.
  for (const [index, shop, user] of [[0, sa, retiredA], [1, sc, retiredC]]) {
    const binding = await db.shopLoginBinding.create({ data: { shopId: shop.id, userId: user.id, createdById: former.id, reason: 'Synthetic approved historical provision' } });
    const operation = await db.accountProvisionOperation.create({ data: { id: randomUUID(), actorId: former.id, shopId: shop.id, userId: user.id,
      idempotencyKey: 'restore.provision:' + suffix + ':' + index, requestHash: sha('synthetic-provision-' + suffix + '-' + index), status: 'APPLIED' } });
    await db.auditLog.create({ data: { operatorId: former.id, action: 'SHOP_LOGIN_CREATED_AND_BOUND', targetType: 'SHOP_ACCOUNT', targetId: shop.id,
      detail: { operationId: operation.id, loginUserId: String(user.id), fields: ['loginName', 'loginBinding'], reasonRecorded: true } } });
    await db.shopLoginBinding.delete({ where: { id: binding.id } });
  }
  await db.shopLoginBinding.createMany({ data: [
    { shopId: sa.id, userId: a.id, createdById: admin.id, reason: 'Synthetic current independent account' },
    { shopId: sb.id, userId: b.id, createdById: admin.id, reason: 'Synthetic current independent account' },
  ] });
  stage = 'GRANTS';
  await db.shopAccountGrant.createMany({ data: [
    { sourceShopId: sa.id, targetShopId: sb.id, status: 'ACTIVE', permissions: ['BOOKINGS_READ', 'CATALOG_MANAGE', 'COPY_CONFIG'], createdById: former.id, updatedById: former.id, reason: 'Synthetic directed permissions history' },
    { sourceShopId: sb.id, targetShopId: sa.id, status: 'REVOKED', permissions: [], createdById: former.id, updatedById: former.id, reason: 'Synthetic revoked permissions history', revokedById: former.id, revokedReason: 'Synthetic historical revocation', revokedAt: new Date() },
  ] });
  const copyId = randomUUID();
  stage = 'COPY';
  await db.copyConfigOperation.create({ data: { id: copyId, actorId: former.id, sourceShopId: sa.id, targetShopId: sb.id, kind: 'HOURS',
    idempotencyKey: 'restore-copy-' + suffix, requestHash: sha('synthetic-copy-' + suffix), result: { operationId: copyId, status: 'APPLIED', kind: 'HOURS', created: 0, skipped: 0, sourceShopId: String(sa.id), targetShopId: String(sb.id) } } });
  stage = 'IDENTITIES';
  await db.authProviderIdentity.createMany({ data: ['GOOGLE', 'APPLE'].map(provider => ({ id: randomUUID(), userId: customer.id, provider, subject: 'Synthetic-' + provider + '-Case-' + suffix })) });
  const future = new Date(Date.now() + 3600000), now = new Date();
  stage = 'CHALLENGES';
  await db.socialLoginChallenge.createMany({ data: ['GOOGLE', 'APPLE'].map((provider, index) => ({ id: randomUUID(), provider, nonceHash: sha(randomBytes(32)), expiresAt: future, consumedAt: index ? now : null })) });
  await db.emailLoginChallenge.createMany({ data: ['PENDING', 'SENT', 'FAILED'].map((deliveryState, index) => ({ id: randomUUID(), email: customer.email,
    codeHash: sha(randomBytes(32)), deliveryState, attempts: index === 1 ? 5 : 0, expiresAt: future, consumedAt: index ? now : null })) });
  await db.emailLoginThrottle.create({ data: { email: customer.email, lastSentAt: now, windowStart: now, sendCount: 5 } });
  stage = 'SESSIONS';
  await db.authSession.createMany({ data: [
    { id: randomUUID(), userId: customer.id, tokenHash: sha(randomBytes(48)), expiresAt: future },
    { id: randomUUID(), userId: b.id, tokenHash: sha(randomBytes(48)), expiresAt: future, revokedAt: now },
  ] });
  // Deliberate historical cases: bindings/grants/operation/audits remain intact
  // after account suspension and a former operator's role change.
  await db.user.updateMany({ where: { id: { in: [b.id, retiredA.id, retiredC.id, owner.id] } }, data: { status: 'SUSPENDED' } });
  await db.user.update({ where: { id: former.id }, data: { role: 'STAFF', status: 'SUSPENDED' } });
  stage = 'MEDIA';
  const namespace = sha(JSON.stringify({ driver: 'local', dir: '/app/media', bucket: null, endpoint: null, region: 'us-east-1' }));
  const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#48a1a1' } }).webp().toBuffer();
  const files = [];
  for (const [index, scope, purpose, status] of [[0, 'SHOP', 'logo', 'BOUND'], [1, 'AVATAR', 'avatar', 'BOUND'], [2, 'SHOP', 'gallery', 'STAGED']]) {
    const id = randomUUID(), key = id + '.webp', uploader = scope === 'SHOP' ? a : customer;
    await writeMedia(key, image);
    await db.mediaAsset.create({ data: { id, ownerId: uploader.id, shopId: scope === 'SHOP' ? sa.id : null, shopOwnerId: scope === 'SHOP' ? owner.id : null,
      scope, purpose, status, requestKey: 'restore-media-' + index + '-' + suffix, inputHash: sha('synthetic-input-' + index), contentHash: sha(image),
      storageNamespace: namespace, storageDriver: 'local', objectKey: key, mimeType: 'image/webp', sizeBytes: image.length, width: 8, height: 6,
      expiresAt: future, boundAt: status === 'BOUND' ? now : null } });
    const url = '/api/v1/upload/media/' + id + '/file';
    if (scope === 'AVATAR') await db.user.update({ where: { id: customer.id }, data: { avatarUrl: url } });
    else if (purpose === 'logo') await db.shop.update({ where: { id: sa.id }, data: { studioProfile: { logoUrl: url, gallery: [] } } });
    files.push({ key, bytes: image.length, sha256: sha(image) });
  }
  return { files, namespace, expectedTableCounts: { users: 8, shops: 3, merchant_profiles: 3, shop_login_bindings: 2, shop_account_grants: 2,
    auth_provider_identities: 2, social_login_challenges: 2, email_login_challenges: 3, email_login_throttles: 1, copy_config_operations: 1, account_provision_operations: 2, auth_sessions: 2, audit_logs: 2, media_assets: 3 },
    historicalCases: ['financial owner differs from independent login', 'unbound former provision', 'rebound former provision with different creator', 'suspended account and former operator', 'revoked empty grant', 'consumed and failed challenges', 'bound avatar/shop media and staged media'] };
  } catch (error) {
    const code = /^P\d{4}$/.test(error?.code ?? '') ? error.code : error?.code === 'ERR_ASSERTION' ? 'ASSERTION' : 'FAILED';
    throw Error('RESTORE_FIXTURE_' + stage + '_' + code);
  }
}
module.exports = { seedAccountRestore };
