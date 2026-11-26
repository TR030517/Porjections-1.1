/* Dedicated synthetic accounts and an exactly disposable MySQL schema only. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { installTestEnvironment, withFreshDatabase } = require('./booking-resources.support.cjs');
installTestEnvironment();
require('ts-node/register/transpile-only');
require('reflect-metadata');

test('management password lifecycle uses real HTTP, MySQL sessions and isolated encrypted vault', { timeout: 180000 }, async t => {
  const vaultDir = await mkdtemp(path.join(os.tmpdir(),'mj2-password-integration-'));
  process.env.MERCHANT_CREDENTIAL_VAULT_DIR = vaultDir;
  process.env.MERCHANT_CREDENTIAL_VAULT_KEY = randomBytes(32).toString('base64');
  try { await withFreshDatabase(async ({ db }) => {
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { hash, compare } = require('bcryptjs');
    const { AppModule } = require('../src/app.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const vault = require('../scripts/lib/merchant-credential-vault.cjs');
    const prefix = randomBytes(6).toString('hex');
    const originalPassword = randomBytes(24).toString('base64url');
    const passwordHash = await hash(originalPassword, 10);
    const users = {}, auth = {}, updatedPasswords = {};
    for (const [name,role] of [['admin','ADMIN'],['merchant','MERCHANT'],['staff','STAFF'],['secondAdmin','ADMIN'],['customer','CUSTOMER']]) {
      users[name] = await db.user.create({data:{email:prefix+'.'+name+'@example.invalid', role, name:'Synthetic '+name, passwordHash, ...(role==='CUSTOMER'?{emailVerifiedAt:new Date()}:{})}});
    }
    const shop = await db.shop.create({data:{ownerId:users.merchant.id,name:'Password lifecycle synthetic store',shortName:'password-'+prefix,address:'Synthetic test address',city:'Test',state:'WA',zipCode:'00000',timezone:'America/Los_Angeles',latitude:1,longitude:1,phone:'TEST-ONLY',category:'MIXED',status:'APPROVED'}});
    await db.shopLoginBinding.create({data:{shopId:shop.id,userId:users.merchant.id,createdById:users.admin.id,reason:'Dedicated synthetic credential lifecycle'}});
    vault.writeMerchantCredential({shopId:String(shop.id),userId:String(users.merchant.id),password:originalPassword,passwordHash});
    const module = await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(db).compile();
    const app = module.createNestApplication({logger:false}); app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new BigIntInterceptor()); app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    await app.listen(0,'127.0.0.1'); const origin=await app.getUrl(); process.env.CORS_ORIGINS=origin;
    const originalFetch=globalThis.fetch; globalThis.fetch=(input,options)=>{assert.equal(new URL(String(input)).origin,origin,'External HTTP must never be used');return originalFetch(input,options)};
    const call=async(route,{token,body,method=body===undefined?'GET':'POST'}={})=>{const res=await fetch(origin+'/api/v1'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie'),cache:res.headers.get('cache-control')}};
    const expect=(result,status)=>{assert.equal(result.status,status,'Unexpected HTTP status; credentials intentionally omitted');return result.body};
    const login=async(name,password,alternate=false)=>expect(await call(alternate?'/auth/password/login':'/auth/login',{body:alternate?{email:users[name].email,password}:{identifier:users[name].email,password}}),200);
    try {
      for(const name of Object.keys(users))auth[name]=await login(name,originalPassword);
      await t.test('policy failure keeps the hash, vault and existing session unchanged',async()=>{
        const before=await db.user.findUniqueOrThrow({where:{id:users.admin.id}});
        expect(await call('/auth/password/change',{token:auth.admin.accessToken,body:{currentPassword:originalPassword,newPassword:'123456'}}),400);
        assert.ok((await db.user.findUniqueOrThrow({where:{id:users.admin.id}})).passwordHash===before.passwordHash);
        expect(await call('/auth/me',{token:auth.admin.accessToken}),200);
      });
      for(const name of ['admin','merchant','staff'])await t.test(name+' changes only own credentials and revokes all old sessions',async()=>{
        const next=name==='merchant'?'7'+randomBytes(4).toString('hex'):randomBytes(24).toString('base64url'); updatedPasswords[name]=next;
        const result=await call('/auth/password/change',{token:auth[name].accessToken,body:{currentPassword:originalPassword,newPassword:next}});
        const body=expect(result,200); assert.equal(body.changed,true);assert.equal(body.reauthenticationRequired,true);assert.ok(body.revokedSessions>=1);
        assert.equal(result.cache,'no-store'); assert.equal(result.cookie,null); assert.ok(!JSON.stringify(body).includes(next));
        expect(await call('/auth/me',{token:auth[name].accessToken}),401);
        expect(await call('/auth/refresh',{body:{refreshToken:auth[name].refreshToken}}),401);
        expect(await call('/auth/password/login',{body:{email:users[name].email,password:originalPassword}}),401);
        const row=await db.user.findUniqueOrThrow({where:{id:users[name].id}});assert.ok(await compare(next,row.passwordHash));
        assert.equal(await db.authSession.count({where:{userId:row.id,revokedAt:null}}),0);
        auth[name]=await login(name,next,true);expect(await call('/auth/me',{token:auth[name].accessToken}),200);
        if(name==='merchant')assert.ok(vault.readMerchantCredential({shopId:String(shop.id),userId:String(row.id),passwordHash:row.passwordHash}).password===next,'Encrypted vault matches current merchant credential');
      });
      await t.test('customers and non-admin recovery calls are denied without any account write',async()=>{
        const before=await db.user.findUniqueOrThrow({where:{id:users.secondAdmin.id}});
        expect(await call('/auth/password/change',{token:auth.customer.accessToken,body:{currentPassword:originalPassword,newPassword:randomBytes(18).toString('hex')}}),403);
        expect(await call('/auth/accounts/'+users.secondAdmin.id+'/password/recover',{token:auth.merchant.accessToken,body:{currentPassword:updatedPasswords.merchant,newPassword:randomBytes(18).toString('hex'),reason:'Synthetic recovery test',verificationReference:'QA-'+prefix}}),403);
        assert.ok((await db.user.findUniqueOrThrow({where:{id:users.secondAdmin.id}})).passwordHash===before.passwordHash);
      });
      await t.test('immediate admin reauthentication is mandatory for controlled recovery',async()=>{
        const before=await db.user.findUniqueOrThrow({where:{id:users.secondAdmin.id}});
        expect(await call('/auth/accounts/'+users.secondAdmin.id+'/password/recover',{token:auth.admin.accessToken,body:{currentPassword:originalPassword,newPassword:randomBytes(18).toString('hex'),reason:'Synthetic recovery test',verificationReference:'QA-'+prefix}}),401);
        assert.ok((await db.user.findUniqueOrThrow({where:{id:users.secondAdmin.id}})).passwordHash===before.passwordHash);
      });
      for(const name of ['secondAdmin','staff'])await t.test('controlled recovery of '+name+' preserves role/state and revokes the old identity',async()=>{
        const next=randomBytes(24).toString('base64url'),previous=await db.user.findUniqueOrThrow({where:{id:users[name].id}});
        const body=expect(await call('/auth/accounts/'+users[name].id+'/password/recover',{token:auth.admin.accessToken,body:{currentPassword:updatedPasswords.admin,newPassword:next,reason:'Synthetic independently verified account recovery',verificationReference:'QA-'+prefix+'-'+name}}),200);
        assert.equal(body.recovered,true);assert.ok(body.revokedSessions>=1);assert.ok(!JSON.stringify(body).includes(next));
        expect(await call('/auth/me',{token:auth[name].accessToken}),401);expect(await call('/auth/refresh',{body:{refreshToken:auth[name].refreshToken}}),401);
        const row=await db.user.findUniqueOrThrow({where:{id:users[name].id}});assert.equal(row.role,previous.role);assert.equal(row.status,previous.status);assert.ok(await compare(next,row.passwordHash));
        auth[name]=await login(name,next,true);expect(await call('/auth/me',{token:auth[name].accessToken}),200);
      });
      await t.test('only ADMIN reads escrowed credentials with secret-free audit',async()=>{
        const route='/account-access/admin/shops/'+shop.id+'/credentials';
        for(const name of ['merchant','staff','customer'])expect(await call(route,{token:auth[name].accessToken}),403);
        const result=await call(route,{token:auth.admin.accessToken});const body=expect(result,200);assert.equal(result.cache,'no-store');assert.ok(body.password===updatedPasswords.merchant);
        const audit=await db.auditLog.findMany({where:{operatorId:users.admin.id,action:'SHOP_LOGIN_CREDENTIALS_READ',targetId:shop.id}});assert.equal(audit.length,1);
        const allAudits=JSON.stringify(await db.auditLog.findMany(),(_,value)=>typeof value==='bigint'?String(value):value);
        assert.ok(!allAudits.includes(originalPassword));for(const password of Object.values(updatedPasswords))assert.ok(!allAudits.includes(password));
        assert.ok(!allAudits.includes('QA-'+prefix)); assert.equal(await db.auditLog.count({where:{action:'MANAGEMENT_PASSWORD_CHANGED'}}),3);assert.equal(await db.auditLog.count({where:{action:'MANAGEMENT_PASSWORD_RECOVERED'}}),2);
      });
    } finally {globalThis.fetch=originalFetch;await app.close()}
  }); } finally {await rm(vaultDir,{recursive:true,force:true})}
});
