// Real persistence/locking on a newly created disposable MySQL only.
// HTTP uses an explicitly synthetic identity guard: it tests actual routing,
// RolesGuard/DTO/service boundaries, NOT JWT verification or cookie login.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { AuthGuard } = require('@nestjs/passport');
const { ValidationPipe, UnauthorizedException } = require('@nestjs/common');
const request = require('supertest');
const { compare, hash } = require('bcryptjs');
const { AccountAccessService } = require('../src/modules/account-access/account-access.service');
const { AccountAccessController } = require('../src/modules/account-access/account-access.controller');
const { RolesGuard } = require('../src/common/guards/roles.guard');
const { requireShopAccess, shopAccessWhere } = require('../src/common/shop-access');

async function runAccountAccess(db, { check }) {
  if (process.env.MASSAJOY_ACCOUNT_DISPOSABLE !== 'fresh-container-only') throw Error('ACCOUNT_DISPOSABLE_GUARD_REQUIRED');
  const [{ name }] = await db.$queryRaw`SELECT DATABASE() AS name`;
  if (!/^mj2_test_account_[a-f0-9]{8}$/.test(name) || await db.user.count() !== 0) throw Error('NEW_EMPTY_ACCOUNT_SCHEMA_REQUIRED');
  await check('twenty-three migrations are completely applied before synthetic account checks', async () => {
    const rows = await db.$queryRaw`SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
    assert.equal(rows.length, 23); assert.ok(rows.every(row => row.finished_at && !row.rolled_back_at));
  });
  const suffix = crypto.randomBytes(4).toString('hex'), fixtureHash = await hash('Synthetic-account-fixture-pass', 4);
  const addUser = (label, role) => db.user.create({ data: { role, name: 'Synthetic ' + label, ...(role === 'MERCHANT' && label !== 'legacy' ? {passwordHash:fixtureHash} : {}), ...(role === 'MERCHANT' ? { loginName: label + '-' + suffix, email: null, phone: null } : { email: label + '-' + suffix + '@example.invalid', phone: 'T-' + label.slice(0, 7) + '-' + suffix }) } });
  const administrator = await addUser('admin', 'ADMIN'), legacy = await addUser('legacy', 'MERCHANT');
  const a = await addUser('login-a', 'MERCHANT'), b = await addUser('login-b', 'MERCHANT'), c = await addUser('login-c', 'MERCHANT'), unused = await addUser('unused', 'MERCHANT');
  const staff = await addUser('staff', 'STAFF'), customer = await addUser('customer', 'CUSTOMER');
  const shops = [];
  for (let i = 0; i < 4; i++) {
    const shop = await db.shop.create({ data: { ownerId: legacy.id, name: 'Synthetic account shop ' + i, shortName: 'account-' + suffix + '-' + i, phone: 'SYNTHETIC', address: 'Synthetic address', city: 'Synthetic city', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', timezone: 'UTC', status: 'APPROVED', businessHours: { monday: [{ open: '09:00', close: '18:00' }] } } });
    await db.merchantProfile.create({ data: { shopId: shop.id, userId: legacy.id } }); shops.push(shop);
  }
  const [sa, sb, sc, sd] = shops, actor = user => ({ id: String(user.id), role: user.role }), admin = actor(administrator), service = new AccountAccessService(db);
  const reason = 'Synthetic company-approved assignment';
  const headers = { admin, merchant: actor(a), staff: actor(staff), customer: actor(customer), spoofAdmin: { id: String(a.id), role: 'ADMIN' } };
  const module = await Test.createTestingModule({ controllers: [AccountAccessController], providers: [{ provide: AccountAccessService, useValue: service }, RolesGuard] })
    .overrideGuard(AuthGuard('jwt')).useValue({ canActivate(context) { const req = context.switchToHttp().getRequest(), identity = headers[req.headers['x-synthetic-actor']]; if (!identity) throw new UnauthorizedException(); req.user = identity; return true; } }).compile();
  const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
  const http = request(app.getHttpServer()), path = '/api/v1/account-access/admin', as = (call, who = 'admin') => call.set('X-Synthetic-Actor', who);
  let first;
  try {
    await check('HTTP identity substitute preserves anonymous401, nonADMIN403 and real-account role recheck', async () => {
      assert.equal((await http.get(path + '/overview')).status, 401);
      for (const who of ['merchant', 'staff', 'customer', 'spoofAdmin']) assert.equal((await as(http.get(path + '/overview'), who)).status, 403);
      const result = await as(http.get(path + '/overview')); assert.equal(result.status, 200); assert.equal(result.body.shops.length, 4); assert.ok(result.body.shops.every(s => s.binding === null));
      assert.doesNotMatch(JSON.stringify(result.body), /passwordHash|tokenHash|"phone"/);
    });
    await check('three independent bindings preserve historical owners and per-shop ledger ownership', async () => {
      for (const [shop, user] of [[sa, a], [sb, b], [sc, c]]) {
        const result = await as(http.post(path + '/bind')).send({ shopId: String(shop.id), userId: String(user.id), reason });
        assert.equal(result.status, 201); assert.equal(result.body.binding.userId, String(user.id));
        assert.equal(result.body.binding.loginName, user.loginName); assert.equal(result.body.binding.email, null);
      }
      assert.equal(await db.shopLoginBinding.count(), 3);
      assert.ok((await db.shop.findMany()).every(s => s.ownerId === legacy.id));
      assert.ok((await db.merchantProfile.findMany()).every(p => p.userId === legacy.id && p.balanceCents === 0));
    });
    await check('one-to-one bindings reject overwrite and real SQL uniqueness protects both independent axes', async () => {
      assert.equal((await as(http.post(path + '/bind')).send({ shopId: String(sd.id), userId: String(a.id), reason })).status, 409);
      assert.equal((await as(http.post(path + '/bind')).send({ shopId: String(sa.id), userId: String(unused.id), reason })).status, 409);
      await assert.rejects(db.shopLoginBinding.create({ data: { shopId: sd.id, userId: a.id, createdById: administrator.id, reason } }), e => e.code === 'P2002');
      await assert.rejects(db.shopLoginBinding.create({ data: { shopId: sa.id, userId: unused.id, createdById: administrator.id, reason } }), e => e.code === 'P2002');
      assert.equal(await db.shopLoginBinding.count(), 3);
    });
    await check('historical owner has no login fallback while a bound independent account has home powers', async () => {
      await assert.rejects(requireShopAccess(db, sa.id, actor(legacy), 'BOOKINGS_READ'));
      assert.equal((await requireShopAccess(db, sa.id, actor(a), 'OWNER_ONLY')).accessType, 'OWN');
      assert.equal((await requireShopAccess(db, sd.id, admin, 'OWNER_ONLY')).accessType, 'ADMIN');
      assert.equal((await db.shop.findMany({ where: shopAccessWhere(actor(legacy), 'BOOKINGS_READ') })).length, 0);
    });
    await check('directed company grant permits its exact function with original actor and no owner capability', async () => {
      const result = await as(http.post(path + '/grants')).send({ sourceShopId: String(sa.id), targetShopId: String(sb.id), permissions: ['BOOKINGS_READ'], reason });
      assert.equal(result.status, 201); first = result.body.grant;
      assert.equal(first.createdById, String(administrator.id));
      const access = await requireShopAccess(db, sb.id, actor(a), 'BOOKINGS_READ'); assert.equal(access.accessType, 'ASSOCIATED'); assert.equal(access.isOwner, false); assert.equal(access.homeShopId, String(sa.id));
      await assert.rejects(requireShopAccess(db, sb.id, actor(a), 'BOOKINGS_MANAGE'));
      await assert.rejects(requireShopAccess(db, sb.id, actor(a), 'OWNER_ONLY'));
      const audit = await db.auditLog.findFirst({ where: { action: 'SHOP_ACCOUNT_GRANTED' }, orderBy: { id: 'desc' } }); assert.equal(audit.operatorId, administrator.id);
      assert.doesNotMatch(JSON.stringify(result.body), /password|Synthetic company-approved/);
    });
    await check('suspending the historical ledger owner does not disable independent home or associated login', async () => {
      await db.user.update({ where: { id: legacy.id }, data: { status: 'SUSPENDED' } });
      assert.equal((await requireShopAccess(db, sa.id, actor(a), 'OWNER_ONLY')).accessType, 'OWN');
      assert.equal((await requireShopAccess(db, sb.id, actor(a), 'BOOKINGS_READ')).accessType, 'ASSOCIATED');
      assert.deepEqual((await db.shop.findMany({ where: shopAccessWhere(actor(a), 'BOOKINGS_READ') })).map(row => String(row.id)).sort(), [String(sa.id), String(sb.id)].sort());
    });
    await check('grants are non-transitive, do not flow toSTAFF, and actual read predicates match exact directed scope', async () => {
      await service.grant(admin, { sourceShopId: String(sb.id), targetShopId: String(sc.id), permissions: ['BOOKINGS_READ'], reason });
      await assert.rejects(requireShopAccess(db, sc.id, actor(a), 'BOOKINGS_READ'));
      await assert.rejects(requireShopAccess(db, sb.id, actor(staff), 'BOOKINGS_READ'));
      const ids = (await db.shop.findMany({ where: shopAccessWhere(actor(a), 'BOOKINGS_READ') })).map(s => String(s.id)).sort();
      assert.deepEqual(ids, [String(sa.id), String(sb.id)].sort());
    });
    await check('missing or disabled independent bindings fail closed and inconsistent/owner permissions fail validation', async () => {
      const payload = { sourceShopId: String(sa.id), targetShopId: String(sd.id), permissions: ['BOOKINGS_READ'], reason };
      assert.equal((await as(http.post(path + '/grants')).send(payload)).status, 409);
      await db.user.update({ where: { id: b.id }, data: { status: 'SUSPENDED' } });
      await assert.rejects(service.grant(admin, { ...payload, targetShopId: String(sb.id) }));
      await assert.rejects(requireShopAccess(db, sb.id, actor(a), 'BOOKINGS_READ'));
      await db.user.update({ where: { id: b.id }, data: { status: 'ACTIVE' } });
      for (const permissions of [['OWNER_ONLY'], ['BOOKINGS_MANAGE'], ['REFUNDS_MANAGE'], ['COPY_CONFIG']]) assert.equal((await as(http.post(path + '/grants')).send({ ...payload, targetShopId: String(sb.id), permissions })).status, 400);
    });
    await check('a realSQL target lock serializes revocation after admitted work and rejects subsequent access', async () => {
      let enter, release; const entered = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
      const admitted = db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${sb.id} FOR UPDATE`);
        await requireShopAccess(tx, sb.id, actor(a), 'BOOKINGS_READ', { write: true }); enter(); await gate;
        await tx.auditLog.create({ data: { action: 'SYNTHETIC_ADMITTED_READ', targetType: 'SHOP', targetId: sb.id, operatorId: a.id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
      await Promise.race([entered, admitted]); let settled = false;
      const revoke = service.revoke(admin, first.id, { reason: 'Synthetic revocation' }).finally(() => { settled = true; });
      try { await new Promise(r => setTimeout(r, 150)); assert.equal(settled, false); } finally { release(); }
      await admitted; const revoked = await revoke; assert.equal(revoked.grant.status, 'REVOKED');
      await db.$transaction(async tx => { await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${sb.id} FOR UPDATE`); await assert.rejects(requireShopAccess(tx, sb.id, actor(a), 'BOOKINGS_READ', { write: true })); }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      assert.deepEqual((await db.shopAccountGrant.findUnique({ where: { id: BigInt(first.id) } })).permissions, []);
    });
    await check('regrant updates the same directed row without identity substitution or reverse access', async () => {
      const result = await service.grant(admin, { sourceShopId: String(sa.id), targetShopId: String(sb.id), permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'], reason });
      assert.equal(result.grant.id, first.id); assert.equal((await requireShopAccess(db, sb.id, actor(a), 'BOOKINGS_MANAGE')).accessType, 'ASSOCIATED');
      await assert.rejects(requireShopAccess(db, sa.id, actor(b), 'BOOKINGS_READ'));
      assert.equal(await db.shopAccountGrant.count(), 2);
    });
    await check('associated writes serialize source shop suspension and login-account suspension before rereading access', async () => {
      for (const kind of ['source-shop', 'source-account']) {
        let enter, release; const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
        const admitted = db.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${sb.id} FOR UPDATE`);
          await requireShopAccess(tx, sb.id, actor(a), 'BOOKINGS_MANAGE', { write: true }); enter(); await gate;
          await tx.auditLog.create({ data: { action: 'SYNTHETIC_AUTHORIZED_WRITE', targetType: 'SHOP', targetId: sb.id, operatorId: a.id } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
        await Promise.race([entered, admitted]); let settled = false;
        const suspend = (kind === 'source-shop' ? db.shop.update({ where: { id: sa.id }, data: { status: 'SUSPENDED' } }) : db.user.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } })).finally(() => { settled = true; });
        try { await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(settled, false); } finally { release(); }
        await admitted; await suspend;
        await assert.rejects(requireShopAccess(db, sb.id, actor(a), 'BOOKINGS_MANAGE'));
        if (kind === 'source-shop') await db.shop.update({ where: { id: sa.id }, data: { status: 'APPROVED' } });
        else await db.user.update({ where: { id: a.id }, data: { status: 'ACTIVE' } });
      }
    });
    await check('audit persistence failure rolls binding back in the same realSQL transaction', async () => {
      const broken = { $transaction: (work, options) => db.$transaction(tx => work(new Proxy(tx, { get(target, key) { if (key === 'auditLog') return { ...target.auditLog, create: async () => { throw Error('SYNTHETIC_AUDIT_FAILURE'); } }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } })), options) };
      await assert.rejects(new AccountAccessService(broken).bind(admin, { shopId: String(sd.id), userId: String(unused.id), reason }), /SYNTHETIC_AUDIT_FAILURE/);
      assert.equal(await db.shopLoginBinding.count({ where: { shopId: sd.id } }), 0);
    });
    await check('ADMIN password reset uses bcrypt12, revokes only selected account sessions and returns no secret', async () => {
      const expiresAt = new Date(Date.now() + 3600000);
      for (const user of [a, a, b]) await db.authSession.create({ data: { userId: user.id, tokenHash: crypto.randomBytes(32).toString('hex'), expiresAt } });
      const password = 'Synthetic-account-reset-123', result = await as(http.patch(path + '/accounts/' + a.id + '/password')).send({ password, reason });
      assert.equal(result.status, 200); assert.deepEqual(result.body, { userId: String(a.id), reset: true, revokedSessions: 2 });
      const saved = await db.user.findUnique({ where: { id: a.id } }); assert.match(saved.passwordHash, /^\$2[aby]\$12\$/); assert.equal(await compare(password, saved.passwordHash), true);
      assert.equal(await db.authSession.count({ where: { userId: b.id, revokedAt: null } }), 1);
      const audit = await db.auditLog.findFirst({ where: { action: 'SHOP_LOGIN_PASSWORD_RESET' }, orderBy: { id: 'desc' } }); assert.equal(audit.operatorId, administrator.id); assert.equal(audit.detail.reason,reason); assert.doesNotMatch(JSON.stringify(audit.detail), /Synthetic-account|passwordHash|\$2[aby]\$/);
    });
    await check('actual HTTP whitelist rejects injected ownership/role and prevents resetting other role types', async () => {
      assert.equal((await as(http.post(path + '/bind')).send({ shopId: String(sd.id), userId: String(unused.id), reason, ownerId: String(a.id) })).status, 400);
      assert.equal((await as(http.patch(path + '/accounts/' + customer.id + '/password')).send({ password: 'Synthetic-account-reset-123', reason })).status, 404);
      assert.equal((await as(http.patch(path + '/accounts/' + b.id + '/password'), 'merchant').send({ password: 'Synthetic-account-reset-123', reason })).status, 403);
      assert.equal((await as(http.delete(path + '/grants/' + first.id)).send({ reason: '   ' })).status, 400);
    });
    await check('credentialless legacy accounts are visible as not ready and rejected by bind even while ACTIVE', async () => {
      const blocked = await db.user.create({data:{role:'MERCHANT',status:'ACTIVE',name:'Synthetic credentialless owner'}});
      const view = await as(http.get(path + '/overview')); assert.equal(view.status,200);
      assert.equal(view.body.accounts.find(row=>row.id===String(blocked.id)).loginReady,false);
      assert.equal((await as(http.post(path + '/bind')).send({shopId:String(sd.id),userId:String(blocked.id),reason})).status,409);
      assert.equal(await db.shopLoginBinding.count({where:{shopId:sd.id}}),0);
      assert.doesNotMatch(JSON.stringify(view.body),/passwordHash|phone|tokenHash/);
    });
    await check('provisioning audit failure rolls new user binding and operation back together in actual SQL', async () => {
      const before={users:await db.user.count(),bindings:await db.shopLoginBinding.count(),operations:await db.accountProvisionOperation.count()};
      const broken={user:db.user,$transaction:(work,options)=>db.$transaction(tx=>work(new Proxy(tx,{get(target,key){if(key==='auditLog')return{create:async()=>{throw Error('SYNTHETIC_PROVISION_AUDIT_FAILURE')}};const value=target[key];return typeof value==='function'?value.bind(target):value;}})),options)};
      await assert.rejects(new AccountAccessService(broken).createAndBind(admin,{shopId:String(sd.id),loginName:'rollback-'+suffix,name:'Synthetic rollback login',password:'Synthetic-provision-safe-123',reason,idempotencyKey:'rollback-provision-'+suffix}),/SYNTHETIC_PROVISION_AUDIT_FAILURE/);
      assert.deepEqual({users:await db.user.count(),bindings:await db.shopLoginBinding.count(),operations:await db.accountProvisionOperation.count()},before);
    });
    await check('concurrent atomic provisioning replays one result and preserves the existing historical ledger', async () => {
      const provisionShop=await db.shop.create({data:{ownerId:legacy.id,name:'Synthetic provisioning shop',shortName:'provision-shop-'+suffix,phone:'SYNTHETIC',address:'Synthetic address',city:'Synthetic city',state:'NY',zipCode:'00000',latitude:1,longitude:1,category:'MIXED',timezone:'UTC',status:'PENDING'}});
      await db.merchantProfile.create({data:{shopId:provisionShop.id,userId:legacy.id}});
      const before={users:await db.user.count(),bindings:await db.shopLoginBinding.count(),profiles:await db.merchantProfile.count(),audits:await db.auditLog.count()};
      const ownerBefore=await db.shop.findUnique({where:{id:provisionShop.id},select:{ownerId:true}}),ledgerBefore=await db.merchantProfile.findUnique({where:{shopId:provisionShop.id}});
      const body={shopId:String(provisionShop.id),loginName:'provision-'+suffix,name:'Synthetic provisioned login',password:'Synthetic-provision-safe-123',reason,idempotencyKey:'provision-concurrent-'+suffix};
      const [first,replay]=await Promise.all([service.createAndBind(admin,body),service.createAndBind(admin,body)]);
      assert.equal(first.operationId,replay.operationId);assert.deepEqual([first.replayed,replay.replayed].sort(),[false,true]);
      assert.equal(await db.user.count(),before.users+1);assert.equal(await db.shopLoginBinding.count(),before.bindings+1);assert.equal(await db.merchantProfile.count(),before.profiles);assert.equal(await db.auditLog.count(),before.audits+1);
      assert.deepEqual(await db.shop.findUnique({where:{id:provisionShop.id},select:{ownerId:true}}),ownerBefore);assert.deepEqual(await db.merchantProfile.findUnique({where:{shopId:provisionShop.id}}),ledgerBefore);
      const operation=await db.accountProvisionOperation.findUnique({where:{id:first.operationId}});assert.match(operation.requestHash,/^[a-f0-9]{64}$/);assert.equal(operation.userId,BigInt(first.binding.userId));assert.equal(operation.status,'APPLIED');
      const user=await db.user.findUnique({where:{id:operation.userId}});assert.match(user.passwordHash,/^\$2[aby]\$12\$/);assert.equal(await compare(body.password,user.passwordHash),true);
      assert.doesNotMatch(JSON.stringify(first),/passwordHash|Synthetic-provision|requestHash|phone/);
      const changed=await as(http.post(path+'/create-and-bind')).send({...body,password:'Synthetic-provision-other-123'});assert.equal(changed.status,409);
      for(const role of ['merchant','staff','customer'])assert.equal((await as(http.post(path+'/create-and-bind'),role).send(body)).status,403);
      assert.equal((await http.post(path+'/create-and-bind').send(body)).status,401);
    });
    await check('all original owners and financial ledgers remain untouched after account workflow', async () => {
      assert.ok((await db.shop.findMany()).every(s => s.ownerId === legacy.id));
      const profiles = await db.merchantProfile.findMany({where:{shopId:{in:shops.map(shop=>shop.id)}}}); assert.equal(profiles.length, 4); assert.ok(profiles.every(p => p.userId === legacy.id && p.balanceCents === 0 && p.pendingCents === 0 && p.totalEarnedCents === 0));
      assert.equal(await db.merchantTransaction.count(), 0); assert.equal(await db.paymentRecord.count(), 0); assert.equal(await db.booking.count(), 0);
    });
  } finally { await app.close(); }
  return { admin, accounts: { a: actor(a), b: actor(b), c: actor(c), legacy: actor(legacy), staff: actor(staff), customer: actor(customer) }, shops: { a: sa, b: sb, c: sc, unbound: sd }, service };
}
module.exports = { runAccountAccess };
