/* Test-only support. No existing database is reset, migrated or cleaned.
 * A caller must supply an existing isolated TEST_DATABASE_URL whose account has
 * temporary CREATE/DROP rights for mj2_test_booking_resources_* on 127.0.0.1:3310.
 * This helper never grants privileges and only drops the random database it created.
 */
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readdir } = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function isolatedTarget(value) {
  let target;
  try { target = new URL(value || 'invalid:'); } catch { throw new Error('ISOLATED_TEST_DATABASE_URL_REQUIRED'); }
  if (target.protocol !== 'mysql:' || !['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '3310' || !/^\/mj2_test_[a-zA-Z0-9_]+$/.test(target.pathname)) {
    throw new Error('LOOPBACK_3310_MJ2_TEST_DATABASE_REQUIRED');
  }
  return target;
}

function installTestEnvironment() {
  isolatedTarget(process.env.TEST_DATABASE_URL);
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(48).toString('base64url');
  process.env.PAYMENT_PROVIDER = 'disabled';
  process.env.PAYMENT_EXTERNAL_ENABLED = 'false';
  process.env.PLATFORM_FEE_BPS = '0';
  process.env.REFUND_POLICY_FULL_HOURS = '24';
  process.env.REFUND_POLICY_PARTIAL_PERCENT = '50';
  process.env.FCM_ENABLED = 'false';
  process.env.BOOKING_HOLD_MINUTES = '30';
  // Empty values also prevent ConfigModule dotenv files from filling host credentials.
  for (const key of [
    'AUTH_LOCAL_OTP', 'FCM_SERVICE_ACCOUNT', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_SERVICE_ACCOUNT_PATH',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TWILIO_FROM_NUMBER',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY',
    'SQUARE_ACCESS_TOKEN', 'SQUARE_WEBHOOK_SIGNATURE_KEY', 'SQUARE_MERCHANT_ID', 'SQUARE_LOCATION_ID', 'SQUARE_SHOP_ID',
  ]) process.env[key] = '';
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ esModuleInterop: true });
}

async function withFreshDatabase(action) {
  const { PrismaClient } = require('@prisma/client');
  const target = isolatedTarget(process.env.TEST_DATABASE_URL);
  const databaseName = `mj2_test_booking_resources_${randomBytes(8).toString('hex')}`;
  assert.match(databaseName, /^mj2_test_booking_resources_[a-f0-9]{16}$/);
  const disposable = new URL(target); disposable.pathname = '/' + databaseName;
  const base = new PrismaClient({ datasources: { db: { url: target.href } } });
  let db, created = false;
  try {
    try { await base.$executeRawUnsafe(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
    catch { throw new Error('FRESH_TEST_DATABASE_CREATE_FAILED_REQUIRE_TEMPORARY_PREFIX_GRANT'); }
    created = true;
    const deploy = spawnSync(process.execPath, [path.resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '..'), timeout: 60000, encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: disposable.href, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    });
    // Never print captured Prisma output; it can include connection credentials.
    assert.equal(deploy.status, 0, 'FRESH_TEST_DATABASE_MIGRATION_DEPLOY_FAILED');
    db = new PrismaClient({ datasources: { db: { url: disposable.href } } });
    await db.$connect();
    const directories = (await readdir(path.resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
    const applied = await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
    assert.deepEqual(applied.map(row => row.migration_name), directories, 'Every checked-in migration must deploy to the brand-new database');
    assert.equal(await db.user.count(), 0, 'No seed/import is permitted in the disposable database');
    assert.equal(await db.shop.count(), 0);
    assert.equal(await db.booking.count(), 0);
    process.env.DATABASE_URL = disposable.href;
    await action({ db, databaseUrl: disposable.href, migrationCount: applied.length });
  } finally {
    if (db) await db.$disconnect();
    if (created) {
      // The name is generated above, not an argument or a name from the environment.
      assert.notEqual(disposable.pathname, target.pathname, 'The existing test database cannot be dropped');
      await base.$executeRawUnsafe(`DROP DATABASE \`${databaseName}\``);
      const remaining = await base.$queryRaw`SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${databaseName}`;
      assert.equal(Number(remaining[0].n), 0, 'The exact disposable database must be removed');
    }
    await base.$disconnect();
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function within(promise, milliseconds, code) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

/** SHOW FULL PROCESSLIST exposes this test account's own connections without PROCESS.
 * Inspect only the two known disposable-database connection IDs; never print rows,
 * SQL text, account names, hosts or database connection values.
 */
async function waitForLockQueries(db, connectionIds, table = 'shops') {
  const expected = new Set(connectionIds.map(String));
  const tableSql = new RegExp('\\bFROM\\s+`?' + table + '`?\\s', 'i');
  assert.equal(expected.size, 2, 'Two distinct transaction connections are required');
  const deadline = Date.now() + 3000;
  let observed = [];
  while (Date.now() < deadline) {
    // Prisma's MySQL connector may expose SHOW's dynamic result columns as f0..f7.
    const rows = (await db.$queryRawUnsafe('SHOW FULL PROCESSLIST')).map(row => ({
      Id: row.Id ?? row.f0, Command: row.Command ?? row.f4,
      State: row.State ?? row.f6, Info: row.Info ?? row.f7,
    }));
    observed = rows.filter(row => expected.has(String(row.Id))).map(row => ({ command: row.Command, state: row.State, hasSql: !!row.Info,
      tableSql: tableSql.test(row.Info || ''), lockSql: /\bFOR\s+UPDATE\b/i.test(row.Info || '') }));
    const executing = rows.filter(row => expected.has(String(row.Id)) && ['Query', 'Execute'].includes(row.Command)
      && tableSql.test(row.Info || '') && /\bFOR\s+UPDATE\b/i.test(row.Info || ''));
    if (new Set(executing.map(row => String(row.Id))).size === expected.size) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`TWO_REAL_LOCK_QUERIES_NOT_OBSERVED_IN_MYSQL ${JSON.stringify(observed)}`);
}

/** Observe real transaction connections immediately before their row lock.
 * SQL, isolation, lock order and execution are retained. The observer's only
 * extra SQL is CONNECTION_ID(), which does not read any transactional table.
 */
function observedPrisma(db, observer) {
  return new Proxy(db, {
    get(target, property) {
      if (property !== '$transaction') { const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
      return (callback, options) => {
        if (typeof callback !== 'function') return target.$transaction(callback, options);
        return target.$transaction(tx => callback(new Proxy(tx, {
          get(transaction, key) {
            const value = Reflect.get(transaction, key);
            if (key !== '$queryRaw') return typeof value === 'function' ? value.bind(transaction) : value;
            return async (...args) => {
              const query = args[0];
              const sql = typeof query === 'string' ? query : query?.sql || query?.strings?.join('?') || '';
              const current = observer.current;
              const isObservedLock = current?.matches
                ? current.matches(sql, query?.values || args.slice(1))
                : current && /\bFROM\s+`?shops`?\s/i.test(sql) && /\bFOR\s+UPDATE\b/i.test(sql) && (query?.values || args.slice(1)).some(value => String(value) === String(current.shopId));
              if (isObservedLock) {
                const rows = await transaction.$queryRawUnsafe('SELECT CONNECTION_ID() AS id');
                current.attempts.push({ connectionId: String(rows[0].id), isolationLevel: options?.isolationLevel });
                if (current.attempts.length >= current.expected) current.ready.resolve();
              }
              return value.apply(transaction, args);
            };
          },
        })), options);
      };
    },
  });
}

module.exports = { isolatedTarget, installTestEnvironment, withFreshDatabase, observedPrisma, waitForLockQueries, waitForShopLockQueries: waitForLockQueries, deferred, within };
