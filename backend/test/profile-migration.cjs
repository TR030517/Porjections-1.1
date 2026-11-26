/* Only disposable loopback:3310 mj2_test_* databases. No existing database is reset. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const target = new URL(process.env.TEST_DATABASE_URL || 'invalid:');
if (target.protocol !== 'mysql:' || !['127.0.0.1','localhost'].includes(target.hostname) || target.port !== '3310' || !/^\/mj2_test_[a-zA-Z0-9_]+$/.test(target.pathname)) throw new Error('Explicit isolated TEST_DATABASE_URL required');
const migration = '202610270005_shop_merchant_profiles';
const source = path.resolve(__dirname, '../prisma');
const cli = path.resolve(__dirname, '../node_modules/prisma/build/index.js');
const base = new PrismaClient({ datasources: { db: { url: target.href } } });

async function scenario(name, action) {
  const dbName = `mj2_test_profile_${randomBytes(6).toString('hex')}`;
  const url = new URL(target); url.pathname = '/' + dbName;
  const folder = path.resolve(__dirname, '../.local', dbName);
  let db, created = false;
  try {
    await fs.mkdir(path.join(folder, 'migrations'), { recursive: true });
    await fs.copyFile(path.join(source, 'schema.prisma'), path.join(folder, 'schema.prisma'));
    await fs.copyFile(path.join(source, 'migrations/migration_lock.toml'), path.join(folder, 'migrations/migration_lock.toml'));
    for (const entry of await fs.readdir(path.join(source, 'migrations'), { withFileTypes: true })) if (entry.isDirectory() && (entry.name < migration || name === 'fresh')) await fs.cp(path.join(source, 'migrations', entry.name), path.join(folder, 'migrations', entry.name), { recursive: true });
    await base.$executeRawUnsafe(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    const deploy = () => spawnSync(process.execPath, [cli, 'migrate','deploy','--schema',path.join(folder,'schema.prisma')], { env: { ...process.env, DATABASE_URL: url.href, CHECKPOINT_DISABLE:'1', PRISMA_HIDE_UPDATE_MESSAGE:'1' }, encoding:'utf8', timeout:30000 });
    assert.equal(deploy().status, 0, 'Disposable four-migration baseline must deploy');
    db = new PrismaClient({ datasources: { db: { url: url.href } } });
    if (name === 'fresh') { await action({ db, deploy, databaseUrl: url.href }); return; }
    const owner = await db.user.create({ data: { phone:'test-owner', email:'owner@example.invalid', role:'MERCHANT' } });
    const other = await db.user.create({ data: { phone:'test-other', email:'other@example.invalid', role:'MERCHANT' } });
    const shop = async suffix => db.shop.create({ data: { ownerId:owner.id, name:`Test ${suffix}`, phone:'test', address:'test', city:'test', state:'NY', zipCode:'00000', latitude:0, longitude:0, category:'MIXED', status:'PENDING' } });
    const one = await shop('one'), two = await shop('two');
    const createBooking = async (atShop, paidCents=0) => {
      const service = await db.shopService.create({ data: { shopId:atShop.id, name:'Test', category:'MASSAGE',durationMin:60,priceCents:1500 } });
      return db.booking.create({ data:{ bookingNo:`test-${randomBytes(6).toString('hex')}`,userId:other.id,shopId:atShop.id,serviceId:service.id,bookingDate:new Date('2031-01-01'),startTime:new Date('2031-01-01T10:00:00Z'),endTime:new Date('2031-01-01T11:00:00Z'),durationMin:60,priceCents:1500,totalCents:1500,paidCents,paymentStatus:paidCents?'PAID':'UNPAID' } });
    };
    const shape = () => db.$queryRawUnsafe("SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_profiles' ORDER BY INDEX_NAME, SEQ_IN_INDEX");
    const upgrade = async () => {
      const before = await shape();
      await fs.cp(path.join(source,'migrations',migration),path.join(folder,'migrations',migration),{recursive:true});
      const result = deploy();
      if (result.status !== 0) { assert.deepEqual(await shape(), before, 'Rejected migration must preserve all original profile indexes'); assert.equal(await db.auditLog.count({ where: { action:'PROFILE_BACKFILL' } }), 0); }
      return result;
    };
    await action({ db, owner, other, one, two, createShop:shop, createBooking, upgrade, deploy });
  } finally {
    if (db) await db.$disconnect();
    // Only the fresh, random database created by this test can reach this identifier.
    assert.match(dbName, /^mj2_test_profile_[a-f0-9]{12}$/);
    if (created) await base.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await fs.rm(folder, { recursive:true, force:true });
  }
}
test('merchant profile migration preserves old money and audits zero-balance backfill', { timeout:240000 }, async t => {
  try {
    await t.test('fresh seven-migration database bootstraps and imports five isolated zero ledgers exactly once', async () => scenario('fresh', async ({ db, databaseUrl }) => {
      const env = { ...process.env, DATABASE_URL:databaseUrl, NODE_ENV:'test', ADMIN_EMAIL:'bootstrap@example.invalid', ADMIN_PHONE:'+15550001234', ADMIN_NAME:'Migration test admin' };
      const bootstrap = spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/bootstrap-admin.cjs')],{env,input:randomBytes(24).toString('base64url')+'\n',encoding:'utf8',timeout:15000}); assert.equal(bootstrap.status,0,'Fresh administrator bootstrap must succeed');
      const importer = () => spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/import-sample.cjs'),'--apply'],{env,encoding:'utf8',timeout:15000});
      assert.equal(importer().status,0,'Fresh sanitized import must succeed');
      const profiles=await db.merchantProfile.findMany({include:{shop:{select:{ownerId:true,status:true}}}}); assert.equal(profiles.length,5);assert.ok(profiles.every(p=>p.userId===p.shop.ownerId && p.shop.status==='PENDING' && p.balanceCents===0 && p.pendingCents===0 && p.totalEarnedCents===0 && p.stripeAccountId===null && !p.stripeOnboarding));
      assert.equal(await db.region.count(),9);assert.equal(await db.user.count(),2);assert.equal(await db.booking.count(),0);assert.equal(await db.merchantTransaction.count(),0);assert.equal(await db.paymentRecord.count(),0);assert.equal(await db.refundRequest.count(),0);
      assert.equal(await db.auditLog.count({where:{action:'MERCHANT_PROFILE_CREATED'}}),5);
      assert.notEqual(importer().status,0);assert.equal(await db.merchantProfile.count(),5);assert.equal(await db.region.count(),9);
      assert.equal((await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'))[0].n,7n);
    }));
    await t.test('one owner gains five missing shop profiles without replacing existing profile or transactions', async () => scenario('valid', async ({db,owner,one,two,createShop,createBooking,upgrade,deploy}) => {
      for (let i=0;i<4;i++) await createShop(`additional-${i}`);
      const booking = await createBooking(one, 1500);
      const profile = await db.merchantProfile.create({ data: {userId:owner.id,shopId:one.id,balanceCents:1234,pendingCents:21,totalEarnedCents:1500,stripeAccountId:'offline_preserve_account'} });
      const tx = await db.merchantTransaction.create({data:{profileId:profile.id,type:'PAYMENT',amount:1500,fee:266,net:1234,status:'COMPLETED',bookingId:booking.id}});
      const result = await upgrade(); assert.equal(result.status,0,'Valid upgrade must succeed');
      assert.deepEqual(await db.merchantProfile.findUnique({where:{id:profile.id}}),profile);
      assert.deepEqual(await db.merchantTransaction.findUnique({where:{id:tx.id}}),tx);
      const added=await db.merchantProfile.findUniqueOrThrow({where:{shopId:two.id}});
      assert.equal(added.userId,owner.id); assert.equal(added.balanceCents,0);assert.equal(added.pendingCents,0);assert.equal(added.totalEarnedCents,0);assert.equal(added.stripeAccountId,null);assert.equal(added.stripeOnboarding,false);
      const audits=await db.auditLog.findMany({where:{action:'PROFILE_BACKFILL'}}); assert.equal(audits.length,5);assert.ok(audits.some(a=>a.targetId===added.id));assert.ok(audits.every(a=>a.operatorId===owner.id));
      assert.equal(await db.merchantProfile.count({where:{userId:owner.id}}),6);
      await assert.rejects(db.shop.delete({where:{id:two.id}}), e=>e.code==='P2003');
      assert.equal(deploy().status,0);assert.equal(await db.auditLog.count({where:{action:'PROFILE_BACKFILL'}}),5);
    }));
    await t.test('wrong owner is rejected without modifying the old profile', async () => scenario('owner', async ({db,other,one,upgrade}) => {
      const profile=await db.merchantProfile.create({data:{userId:other.id,shopId:one.id,balanceCents:777}});
      assert.notEqual((await upgrade()).status,0);assert.deepEqual(await db.merchantProfile.findUnique({where:{id:profile.id}}),profile);assert.equal(await db.auditLog.count(),0);
    }));
    await t.test('financial history without a profile is rejected rather than reconstructed as zero', async () => scenario('financial', async ({db,one,createBooking,upgrade}) => {
      const booking=await createBooking(one,1500);assert.notEqual((await upgrade()).status,0);assert.equal(await db.merchantProfile.count(),0);assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).paidCents,1500);
    }));
    await t.test('orphan profile and cross-shop transaction references are rejected', async () => {
      await scenario('orphan', async ({db,owner,upgrade}) => { const profile=await db.merchantProfile.create({data:{userId:owner.id,shopId:999999n}});assert.notEqual((await upgrade()).status,0);assert.deepEqual(await db.merchantProfile.findUnique({where:{id:profile.id}}),profile); });
      await scenario('cross', async ({db,owner,one,two,createBooking,upgrade}) => { const p=await db.merchantProfile.create({data:{userId:owner.id,shopId:one.id}});const b=await createBooking(two);const row=await db.merchantTransaction.create({data:{profileId:p.id,type:'PAYMENT',amount:100,net:100,status:'COMPLETED',bookingId:b.id}});assert.notEqual((await upgrade()).status,0);assert.deepEqual(await db.merchantTransaction.findUnique({where:{id:row.id}}),row); });
    });
    await t.test('orphan owner and orphan transaction-profile references fail before index changes', async () => {
      const disableForeignKeys = (db, action) => db.$transaction(async tx => { await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0'); try { await action(tx); } finally { await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1'); } });
      await scenario('orphan-owner', async ({db,one,upgrade}) => { await disableForeignKeys(db, tx=>tx.shop.update({where:{id:one.id},data:{ownerId:999999n}}));assert.notEqual((await upgrade()).status,0);assert.equal((await db.shop.findUniqueOrThrow({where:{id:one.id}})).ownerId,999999n); });
      await scenario('orphan-transaction', async ({db,upgrade}) => { await disableForeignKeys(db,tx=>tx.merchantTransaction.create({data:{profileId:999999n,type:'PAYOUT',amount:-100,net:-100,status:'COMPLETED'}}));assert.notEqual((await upgrade()).status,0);assert.equal(await db.merchantTransaction.count(),1); });
    });
  } finally { await base.$disconnect(); }
});
