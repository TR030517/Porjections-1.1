// Actual AuthModule, Passport JWT/session lookup and controller guards. No
// synthetic identity headers, guard overrides, provider transport or .env files.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { hash } = require('bcryptjs');
const request = require('supertest');
const { PrismaModule } = require('../src/prisma/prisma.module');
const { PrismaService } = require('../src/prisma/prisma.service');
const { AuthModule } = require('../src/modules/auth/auth.module');
const { MerchantModule } = require('../src/modules/merchant/merchant.module');
const { StudioModule } = require('../src/modules/studio/studio.module');
const { AccountAccessModule } = require('../src/modules/account-access/account-access.module');
const { AccountCopyModule } = require('../src/modules/account-copy/account-copy.module');
const { AuditLogController } = require('../src/modules/admin/audit-log.controller');
const { AuditLogService } = require('../src/modules/admin/audit-log.service');
const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');

async function runAccountJwt({ check }) {
  assert.equal(process.env.MASSAJOY_ACCOUNT_JWT_DISPOSABLE, 'fresh-container-only');
  const configured = new URL(process.env.DATABASE_URL);
  assert.equal(configured.hostname, '127.0.0.1');
  assert.match(configured.pathname, /^\/mj2_test_account_jwt_[a-f0-9]{8}$/);
  assert.equal(process.env.NODE_ENV, 'test');
  const module = await Test.createTestingModule({ imports: [PrismaModule, AuthModule, MerchantModule, StudioModule, AccountAccessModule, AccountCopyModule], controllers:[AuditLogController], providers:[AuditLogService] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new BigIntInterceptor());
  let db;
  try {
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);
    const http = request(app.getHttpServer()), origin = 'https://account-jwt.example.invalid';
    const base = '/api/v1', overview = base + '/account-access/admin/overview';
    const bearer = (call, token) => call.set('Authorization', 'Bearer ' + token);
    const cookieOf = response => {
      const headers = response.headers['set-cookie'];
      assert.ok(Array.isArray(headers));
      const raw = headers.find(value => value.startsWith('massajoy_refresh='));
      assert.ok(raw); return { raw, value: raw.split(';')[0] };
    };
    const browserPost = route => http.post(base + route).set('Origin', origin);
    const login = async (identifier, password) => {
      const response = await browserPost('/auth/login').send({ identifier, password });
      assert.equal(response.status, 200);
      assert.equal(response.body.refreshToken, undefined);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(typeof response.body.accessToken, 'string');
      return { token: response.body.accessToken, cookie: cookieOf(response), user: response.body.user };
    };
    let users, shops, sessions;
    const password = 'Synthetic-' + crypto.randomBytes(18).toString('base64url');
    const nextPassword = 'Replacement-' + crypto.randomBytes(18).toString('base64url');
    await check('fresh isolated schema has exactly twenty-three completed migrations before synthetic fixtures', async () => {
      const rows = await db.$queryRaw`SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations`;
      assert.equal(rows.length, 23); assert.ok(rows.every(row => row.finished_at && !row.rolled_back_at));
      assert.equal(await db.user.count(), 0);
      const passwordHash = await hash(password, 12), suffix = crypto.randomBytes(4).toString('hex');
      const add = (name, role, management = false) => db.user.create({ data: { name: 'Synthetic JWT ' + name, role, status: 'ACTIVE', passwordHash,
        email: management ? null : name + '-' + suffix + '@example.invalid', emailVerifiedAt: role === 'CUSTOMER' ? new Date() : null, phone: null, loginName: management ? name + '-' + suffix : null } });
      const [admin, a, b, customer] = await Promise.all([add('admin', 'ADMIN'), add('merchant-a', 'MERCHANT', true), add('merchant-b', 'MERCHANT', true), add('customer', 'CUSTOMER')]);
      users = { admin, a, b, customer }; shops = [];
      for (const [index, user] of [a, b].entries()) {
        const shop = await db.shop.create({ data: { ownerId: user.id, name: 'Synthetic JWT shop ' + index, shortName: 'jwt-' + suffix + '-' + index, phone: 'SYNTHETIC', address: 'Synthetic address', city: 'Synthetic city', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', timezone: 'UTC', status: 'PENDING' } });
        await db.shopLoginBinding.create({ data: { shopId: shop.id, userId: user.id, createdById: admin.id, reason: 'Synthetic JWT integration binding' } });
        await db.merchantProfile.create({ data: { shopId: shop.id, userId: user.id } }); shops.push(shop);
      }
      assert.ok([a, b].every(user => user.email === null && user.phone === null));
    });
    await check('quick authentication and external delivery remain explicitly unconfigured', async () => {
      const response = await http.get(base + '/auth/customer/config'); assert.equal(response.status, 200);
      assert.equal(response.body.passwordEnabled, true);
      for (const key of ['google', 'apple', 'emailOtp']) assert.equal(response.body[key].enabled, false);
      assert.equal(response.body.nativeSocialEnabled, false);
    });
    await check('real bcrypt password login issues signed session JWTs for independent usernames and email accounts', async () => {
      const admin = await login(users.admin.email, password), a = await login(users.a.loginName, password), b = await login(users.b.loginName, password);
      const customerResponse = await browserPost('/auth/customer/password/login').send({ email: users.customer.email, password });
      assert.equal(customerResponse.status, 200); assert.equal(customerResponse.body.user.role, 'CUSTOMER');
      assert.equal((await browserPost('/auth/customer/password/login').send({ email: users.admin.email, password })).status, 401);
      const claims = app.get(JwtService).verify(a.token);
      assert.equal(claims.sub, String(users.a.id)); assert.equal(claims.role, 'MERCHANT'); assert.equal(typeof claims.sid, 'string');
      const session = await db.authSession.findUnique({ where: { id: claims.sid } });
      assert.equal(session.userId, users.a.id); assert.equal(session.revokedAt, null);
      assert.notEqual(session.tokenHash, decodeURIComponent(a.cookie.value.split('=')[1]));
      sessions = { admin, a, b, customer: { token: customerResponse.body.accessToken } };
    });
    await check('actual JWT and role guards reject anonymous customers and forged tokens at management boundaries', async () => {
      for (const route of ['/merchant/shops', '/account-access/admin/overview', '/studio/stores']) assert.equal((await http.get(base + route)).status, 401);
      assert.equal((await bearer(http.get(base + '/merchant/shops'), sessions.customer.token)).status, 403);
      const token = sessions.a.token, parts = token.split('.'); parts[1] = Buffer.from(JSON.stringify({ sub: String(users.a.id), role: 'ADMIN' })).toString('base64url');
      assert.equal((await bearer(http.get(overview), parts.join('.'))).status, 401);
    });
    await check('each independently bound merchant sees only its shop and cannot read the other shop catalogue', async () => {
      for (const [who, index] of [['a', 0], ['b', 1]]) {
        const response = await bearer(http.get(base + '/merchant/shops'), sessions[who].token);
        assert.equal(response.status, 200); assert.deepEqual(response.body.map(row => row.id), [String(shops[index].id)]);
        assert.equal(response.body[0].accessType, 'OWN');
        const other = await bearer(http.get(base + '/merchant/shops/' + shops[1 - index].id + '/services'), sessions[who].token);
        assert.equal(other.status, 403);
      }
    });
    await check('only ADMIN can access real AccountAccess overview and Studio routes', async () => {
      const admin = await bearer(http.get(overview), sessions.admin.token); assert.equal(admin.status, 200); assert.equal(admin.body.shops.length, 2);
      assert.equal((await bearer(http.get(base + '/studio/stores?page=1&pageSize=25'), sessions.admin.token)).status, 200);
      for (const token of [sessions.a.token, sessions.b.token, sessions.customer.token]) {
        assert.equal((await bearer(http.get(overview), token)).status, 403);
        assert.equal((await bearer(http.get(base + '/studio/stores'), token)).status, 403);
      }
    });
    await check('browser refresh cookies are HttpOnly Strict auth-path cookies and require a trusted origin', async () => {
      assert.match(sessions.a.cookie.raw, /; HttpOnly(?:;|$)/i); assert.match(sessions.a.cookie.raw, /; SameSite=Strict(?:;|$)/i);
      assert.match(sessions.a.cookie.raw, /; Path=\/api\/v1\/auth(?:;|$)/i); assert.doesNotMatch(sessions.a.cookie.raw, /; Secure(?:;|$)/i);
      for (const call of [http.post(base + '/auth/refresh'), http.post(base + '/auth/refresh').set('Origin', 'https://untrusted.example.invalid'), browserPost('/auth/refresh').set('Sec-Fetch-Site', 'cross-site')]) {
        assert.equal((await call.set('Cookie', sessions.a.cookie.value).send({})).status, 403);
      }
      assert.equal((await bearer(http.get(base + '/auth/me'), sessions.a.token)).status, 200);
    });
    await check('refresh atomically rotates real sessions and old JWT plus refresh-cookie replay are rejected', async () => {
      const old = sessions.a;
      const response = await browserPost('/auth/refresh').set('Cookie', old.cookie.value).send({}); assert.equal(response.status, 200);
      assert.equal(response.body.refreshToken, undefined); assert.equal(response.body.user.role, 'MERCHANT');
      sessions.a = { token: response.body.accessToken, cookie: cookieOf(response) };
      assert.notEqual(sessions.a.cookie.value, old.cookie.value);
      assert.equal((await browserPost('/auth/refresh').set('Cookie', old.cookie.value).send({})).status, 401);
      assert.equal((await bearer(http.get(base + '/auth/me'), old.token)).status, 401);
      assert.equal((await bearer(http.get(base + '/auth/me'), sessions.a.token)).status, 200);
      const first = await db.authSession.findUnique({ where: { id: app.get(JwtService).verify(old.token).sid } });
      assert.ok(first.revokedAt); assert.equal(first.rotatedTo, app.get(JwtService).verify(sessions.a.token).sid);
    });
    await check('logout clears the cookie and revokes both real access and refresh credentials', async () => {
      const old = sessions.a;
      const response = await browserPost('/auth/logout').set('Cookie', old.cookie.value).send({}); assert.equal(response.status, 200);
      assert.match(cookieOf(response).raw, /Expires=Thu, 01 Jan 1970/i);
      assert.equal((await bearer(http.get(base + '/merchant/shops'), old.token)).status, 401);
      assert.equal((await browserPost('/auth/refresh').set('Cookie', old.cookie.value).send({})).status, 401);
    });
    await check('a disabled real account loses existing JWT refresh and password access immediately', async () => {
      await db.user.update({ where: { id: users.b.id }, data: { status: 'SUSPENDED' } });
      assert.equal((await bearer(http.get(base + '/merchant/shops'), sessions.b.token)).status, 401);
      assert.equal((await browserPost('/auth/refresh').set('Cookie', sessions.b.cookie.value).send({})).status, 401);
      assert.equal((await browserPost('/auth/login').send({ identifier: users.b.loginName, password })).status, 401);
    });
    await check('ADMIN password reset revokes old sessions and only the replacement password authenticates', async () => {
      const old = await login(users.a.loginName, password);
      const response = await bearer(http.patch(base + '/account-access/admin/accounts/' + users.a.id + '/password'), sessions.admin.token).send({ password: nextPassword, reason: 'Synthetic approved password recovery' });
      assert.equal(response.status, 200); assert.equal(response.body.reset, true); assert.ok(response.body.revokedSessions >= 1);
      assert.doesNotMatch(JSON.stringify(response.body), /passwordHash|tokenHash/); assert.equal(response.body.password, undefined);
      assert.equal((await bearer(http.get(base + '/merchant/shops'), old.token)).status, 401);
      assert.equal((await browserPost('/auth/refresh').set('Cookie', old.cookie.value).send({})).status, 401);
      assert.equal((await browserPost('/auth/login').send({ identifier: users.a.loginName, password })).status, 401);
      sessions.a = await login(users.a.loginName, nextPassword);
      assert.equal((await bearer(http.get(base + '/merchant/shops'), sessions.a.token)).status, 200);
    });
    await check('JWT role claims never override current database role and the production cookie branch adds Secure', async () => {
      const claims = app.get(JwtService).verify(sessions.a.token);
      const staleRoleToken = app.get(JwtService).sign({ sub: claims.sub, sid: claims.sid, role: 'ADMIN' });
      assert.equal((await bearer(http.get(overview), staleRoleToken)).status, 403);
      process.env.NODE_ENV = 'production';
      try { const response = await login(users.a.loginName, nextPassword); assert.match(response.cookie.raw, /; Secure(?:;|$)/i); }
      finally { process.env.NODE_ENV = 'test'; }
    });
    await check('real JWT rejects unusable legacy binding and atomically provisions a separate login without rewriting its ledger',async()=>{
      const suffix=crypto.randomBytes(4).toString('hex');
      const legacy=await db.user.create({data:{role:'MERCHANT',status:'ACTIVE',name:'Synthetic credentialless legacy owner'}});
      const shop=await db.shop.create({data:{ownerId:legacy.id,name:'Synthetic JWT provisioning shop',shortName:'jwt-provision-'+suffix,phone:'SYNTHETIC',address:'Synthetic address',city:'Synthetic city',state:'NY',zipCode:'00000',latitude:1,longitude:1,category:'MIXED',timezone:'UTC',status:'PENDING'}});
      const ledger=await db.merchantProfile.create({data:{shopId:shop.id,userId:legacy.id}});
      const body={shopId:String(shop.id),loginName:'jwt-provision-'+suffix,name:'Synthetic independent login',password,reason:'Synthetic independent login provisioning',idempotencyKey:'jwt-provision-'+suffix};
      const current=await bearer(http.get(overview),sessions.admin.token);assert.equal(current.body.accounts.find(row=>row.id===String(legacy.id)).loginReady,false);
      assert.equal((await bearer(http.post(base+'/account-access/admin/bind'),sessions.admin.token).send({shopId:String(shop.id),userId:String(legacy.id),reason:body.reason})).status,409);
      assert.equal((await http.post(base+'/account-access/admin/create-and-bind').send(body)).status,401);
      for(const token of [sessions.a.token,sessions.customer.token])assert.equal((await bearer(http.post(base+'/account-access/admin/create-and-bind'),token).send(body)).status,403);
      const before=await db.user.count(),created=await bearer(http.post(base+'/account-access/admin/create-and-bind'),sessions.admin.token).send(body);
      assert.equal(created.status,201);assert.equal(created.body.replayed,false);assert.equal(created.body.binding.loginReady,true);
      const replay=await bearer(http.post(base+'/account-access/admin/create-and-bind'),sessions.admin.token).send(body);
      assert.equal(replay.status,201);assert.equal(replay.body.operationId,created.body.operationId);assert.equal(replay.body.replayed,true);assert.equal(await db.user.count(),before+1);
      assert.equal((await bearer(http.post(base+'/account-access/admin/create-and-bind'),sessions.admin.token).send({...body,password:nextPassword})).status,409);
      const signed=await login(body.loginName,password),shopsResponse=await bearer(http.get(base+'/merchant/shops'),signed.token);
      assert.equal(shopsResponse.status,200);assert.deepEqual(shopsResponse.body.map(row=>row.id),[String(shop.id)]);
      assert.deepEqual(await db.merchantProfile.findUnique({where:{shopId:shop.id}}),ledger);assert.equal((await db.shop.findUnique({where:{id:shop.id}})).ownerId,legacy.id);
      assert.doesNotMatch(JSON.stringify(created.body),/passwordHash|requestHash|phone|Synthetic independent login provisioning/);
    });
    await check('real ADMIN audit query reports saved reset reason presence without exposing its text or credentials',async()=>{
      const stored=await db.auditLog.findFirst({where:{action:'SHOP_LOGIN_PASSWORD_RESET'},orderBy:{id:'desc'}});
      assert.equal(stored.detail.reason,'Synthetic approved password recovery');
      const response=await bearer(http.get(base+'/admin/audit-logs').query({action:'SHOP_LOGIN_PASSWORD_RESET'}),sessions.admin.token);
      assert.equal(response.status,200);assert.ok(response.body.items.length>0);
      assert.equal(response.body.items[0].detail.reasonRecorded,true);assert.ok(response.body.items[0].detail.fields.includes('passwordReset'));
      assert.doesNotMatch(JSON.stringify(response.body),/Synthetic approved password recovery|passwordHash|requestHash|tokenHash/);
    });
    let copyContext;
    await check('real copy HTTP history is actor-scoped and every successful preview apply resolve and history is no-store',async()=>{
      await db.user.update({where:{id:users.b.id},data:{status:'ACTIVE'}});
      await db.shop.update({where:{id:shops[0].id},data:{businessHours:{monday:{open:'09:00',close:'18:00'}}}});
      await db.shop.update({where:{id:shops[1].id},data:{businessHours:{monday:{open:'10:00',close:'17:00'}}}});
      const grant=await bearer(http.post(base+'/account-access/admin/grants'),sessions.admin.token).send({sourceShopId:String(shops[0].id),targetShopId:String(shops[1].id),permissions:['SHOP_SETTINGS_MANAGE','COPY_CONFIG'],reason:'Synthetic HTTP copy access'});assert.equal(grant.status,201);
      const copyBase=base+'/account-access/copy',body={sourceShopId:String(shops[0].id),targetShopId:String(shops[1].id),kind:'HOURS'};
      const successful=(response,status)=>{assert.equal(response.status,status);assert.equal(response.headers['cache-control'],'no-store');return response.body;};
      const ownPreview=successful(await bearer(http.post(copyBase+'/preview'),sessions.a.token).send(body),201);
      const requestBody={...body,previewHash:ownPreview.previewHash,idempotencyKey:'jwt-copy-own-'+crypto.randomBytes(8).toString('hex')};
      assert.equal(successful(await bearer(http.post(copyBase+'/resolve'),sessions.a.token).send(requestBody),201).status,'UNKNOWN');
      const own=successful(await bearer(http.post(copyBase+'/apply'),sessions.a.token).send(requestBody),201);assert.equal(own.status,'APPLIED');
      assert.equal(successful(await bearer(http.post(copyBase+'/resolve'),sessions.a.token).send(requestBody),201).operationId,own.operationId);
      const companyPreview=successful(await bearer(http.post(copyBase+'/preview'),sessions.admin.token).send(body),201);
      const company=successful(await bearer(http.post(copyBase+'/apply'),sessions.admin.token).send({...body,previewHash:companyPreview.previewHash,idempotencyKey:'jwt-copy-admin-'+crypto.randomBytes(8).toString('hex')}),201);
      const ownHistory=successful(await bearer(http.get(copyBase+'/history').query({page:'1',limit:'20'}),sessions.a.token),200);
      assert.equal(ownHistory.total,1);assert.deepEqual(ownHistory.items.map(row=>row.operationId),[own.operationId]);
      const adminHistory=successful(await bearer(http.get(copyBase+'/history'),sessions.admin.token),200);assert.equal(adminHistory.total,1);assert.deepEqual(adminHistory.items.map(row=>row.operationId),[company.operationId]);
      const staff=await db.user.create({data:{role:'STAFF',name:'Synthetic HTTP copy denied staff',email:'copy-staff-'+crypto.randomBytes(8).toString('hex')+'@example.invalid',passwordHash:await hash(password,4)}});
      const staffSession=await login(staff.email,password);assert.equal((await bearer(http.get(copyBase+'/history'),staffSession.token)).status,403);
      copyContext={copyBase,requestBody};
    });
    await check('actual copy resolve DTO rejects malformed keys and unsigned previews before any operation is created',async()=>{
      const before=await db.copyConfigOperation.count();
      for(const invalid of [{...copyContext.requestBody,idempotencyKey:'bad!'},{...copyContext.requestBody,previewHash:'unsigned-preview'},{...copyContext.requestBody,ownerId:String(users.admin.id)}])assert.equal((await bearer(http.post(copyContext.copyBase+'/resolve'),sessions.a.token).send(invalid)).status,400);
      assert.equal(await db.copyConfigOperation.count(),before);
    });
    return { syntheticUsers: await db.user.count(), syntheticShops: await db.shop.count(), realJwtOrCookiesTested: true, identityOrGuardOverrides: false };
  } finally { await app.close(); }
}
module.exports = { runAccountJwt };
