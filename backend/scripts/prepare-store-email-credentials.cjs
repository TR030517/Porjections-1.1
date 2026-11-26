'use strict';
// Explicitly authorized local preparation. Credentials never enter reports or stdout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { PrismaClient } = require('@prisma/client');
const { targetUrl, protectedCredentialFile } = require('./migrate-legacy-store-accounts.cjs');
const ROOT = path.resolve(__dirname, '../..');
const SCHEMA = 'mj2_store_migration_84cec1e6';
const VERSION = 'email-vault-20261107-v1';
const serialize = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
const digest = value => crypto.createHash('sha256').update(serialize(value)).digest('hex');
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const email = value => typeof value === 'string' && value.trim().length <= 255 && /^[A-Za-z0-9._+-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value.trim()) ? value.trim().toLowerCase() : null;

async function plan(db) {
  const [shops, users] = await Promise.all([
    db.shop.findMany({ include: { loginBinding: { include: { user: true } } }, orderBy: { id: 'asc' } }),
    db.user.findMany({ select: { id: true, email: true, loginName: true } }),
  ]);
  if (shops.length !== 1335 || shops.some(s => s.deletedAt || s.status !== 'APPROVED')) throw Error('Expected the 1335 published migration stores');
  const owners = new Set(shops.map(s => String(s.ownerId)));
  const reserved = new Map(users.filter(u => u.email).map(u => [u.email.toLowerCase(), String(u.id)]));
  const logins = new Map(users.filter(u => u.loginName).map(u => [u.loginName.toLowerCase(), String(u.id)]));
  const rows = [];
  for (const shop of shops) {
    const account = shop.loginBinding?.user, profile = record(shop.studioProfile), legacy = record(profile.legacyImport);
    if (!account || account.deletedAt || account.role !== 'MERCHANT' || owners.has(String(account.id))) throw Error('Independent account binding is unsafe or missing');
    const userId = String(account.id), shopId = String(shop.id);
    const candidates = [account.email, ...(Array.isArray(profile.emails) ? profile.emails : [])].flatMap(v => typeof v === 'string' ? v.split(/[;,\n]/) : []).map(email).filter(Boolean);
    let desiredEmail = candidates.find(v => (!reserved.has(v) || reserved.get(v) === userId) && (!logins.has(v) || logins.get(v) === userId));
    if (!desiredEmail) {
      const stem = `shop-${shopId}`;
      for (let suffix = 0; ; suffix++) {
        const candidate = `${stem}${suffix ? '-' + suffix : ''}@pending.massajoy.test`;
        if ((!reserved.has(candidate) || reserved.get(candidate) === userId) && (!logins.has(candidate) || logins.get(candidate) === userId)) { desiredEmail = candidate; break; }
      }
    }
    reserved.set(desiredEmail, userId);
    const provisional = desiredEmail.endsWith('@pending.massajoy.test');
    const before = { shopId, userId, email: account.email, loginName: account.loginName, status: account.status, passwordHash: account.passwordHash, emailVerifiedAt: account.emailVerifiedAt, userUpdatedAt: account.updatedAt, shopUpdatedAt: shop.updatedAt, profile };
    const marker = record(profile.accountPreparation);
    const changed = marker.version !== VERSION || account.email !== desiredEmail || account.loginName !== null || account.status !== 'SUSPENDED';
    rows.push({ shopId, userId, desiredEmail, provisional, changed, before, fingerprint: digest(before) });
  }
  return { rows, digest: digest(rows), summary: { totalStores: rows.length, toUpdate: rows.filter(r => r.changed).length, realLoginEmails: rows.filter(r => !r.provisional).length, provisionalLoginEmails: rows.filter(r => r.provisional).length, loginEnabled: false } };
}

async function passwords(rows, vault) {
  const jobs = rows.map(row => ({ row, password: vault.randomMerchantPassword() })), results = new Map();
  const workerCode = `const { parentPort, workerData }=require('node:worker_threads'); const {hashSync}=require(workerData.bcrypt); parentPort.on('message',job=>{ try { parentPort.postMessage({id:job.id,hash:hashSync(job.password,12)}); } catch { parentPort.postMessage({id:job.id,error:true}); } });`;
  let next = 0, completed = 0;
  if (!jobs.length) return results;
  await new Promise((resolve, reject) => {
    const workers = [];
    const fail = () => { for (const worker of workers) void worker.terminate(); reject(Error('Password preparation failed; no credentials logged')); };
    for (let i = 0; i < Math.min(4, jobs.length); i++) {
      const worker = new Worker(workerCode, { eval: true, workerData: { bcrypt: require.resolve('bcryptjs') } }); workers.push(worker);
      const send = () => { if (next < jobs.length) { const id = next++; worker.postMessage({ id, password: jobs[id].password }); } };
      worker.on('error', fail);
      worker.on('message', message => {
        if (message.error) return fail();
        const job = jobs[message.id];
        results.set(job.row.shopId, { password: job.password, passwordHash: message.hash });
        completed++;
        if (completed % 200 === 0) console.log(`Prepared ${completed}/${jobs.length} encrypted-account password hashes (values hidden).`);
        if (completed === jobs.length) { for (const w of workers) void w.terminate(); resolve(); } else send();
      });
      send();
    }
  });
  return results;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw Error('Local preparation only');
  const args = process.argv.slice(2), arg = key => args.find(a => a.startsWith(key + '='))?.slice(key.length + 1);
  const envPath = path.join(ROOT, '.local/legacy-store-import-20261105/preview.env');
  const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).flatMap(line => { const m = /^([A-Z_]+)=(.*)$/.exec(line); return m ? [[m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]] : []; }));
  const db = new PrismaClient({ datasources: { db: { url: targetUrl(env.DATABASE_URL) } } });
  try {
    if ((await db.$queryRawUnsafe('SELECT DATABASE() AS name'))[0]?.name !== SCHEMA) throw Error('Database mismatch');
    const initial = await plan(db);
    const output = { mode: 'dry-run', schema: SCHEMA, ...initial.summary, digest: initial.digest };
    if (!args.includes('--apply')) { console.log(serialize(output)); return; }
    if (!args.includes('--acknowledge-local-only') || arg('--expected-digest') !== initial.digest) throw Error('Apply requires current digest and local acknowledgement');
    if (!initial.summary.toUpdate) { console.log(serialize({ ...output, mode: 'apply', updated: 0 })); return; }
    const vault = require('./lib/merchant-credential-vault.cjs');
    const changed = initial.rows.filter(r => r.changed);
    const prepared = await passwords(changed, vault);
    const backupFile = path.join(ROOT, '.local/store-account-credentials', 'before-email-vault-' + Date.now() + '.jsonl');
    const backup = protectedCredentialFile(backupFile);
    try { for (const row of changed) backup.append(row.before); } finally { backup.close(); }
    for (const row of changed) await vault.writeMerchantCredential({ shopId: row.shopId, userId: row.userId, ...prepared.get(row.shopId) });
    await db.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM shops ORDER BY id FOR UPDATE');
      await tx.$queryRawUnsafe('SELECT id FROM users ORDER BY id FOR UPDATE');
      const current = await plan(tx);
      if (current.digest !== initial.digest) throw Error('Account preparation stale; no database writes committed');
      for (const row of changed) {
        const generated = prepared.get(row.shopId), before = row.before;
        await tx.user.update({ where: { id: BigInt(row.userId) }, data: { email: row.desiredEmail, loginName: null, passwordHash: generated.passwordHash, status: 'SUSPENDED', ...(before.email !== row.desiredEmail ? { emailVerifiedAt: null } : {}) } });
        await tx.authSession.updateMany({ where: { userId: BigInt(row.userId), revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.shop.update({ where: { id: BigInt(row.shopId) }, data: { studioProfile: { ...before.profile, accountPreparation: { version: VERSION, preparedAt: new Date().toISOString(), provisionalEmail: row.provisional, previousLoginName: before.loginName, emailSource: row.provisional ? 'temporary-admin-review' : 'existing-store-contact', loginEnabled: false }, legacyImport: { ...record(before.profile.legacyImport), emailNeedsReview: row.provisional, loginEnabled: false } } } });
      }
    }, { maxWait: 30000, timeout: 180000, isolationLevel: 'Serializable' });
    console.log(serialize({ ...output, mode: 'apply', updated: changed.length, backupFile, credentialStorage: 'encrypted-admin-only-vault' }));
  } finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Local account preparation stopped. No credentials were logged; review the protected backup and regenerate the dry-run plan.'); process.exitCode = 1; });
module.exports = { plan };
