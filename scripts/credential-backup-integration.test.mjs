import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { ROOT, backupBundle, backupErrorDetails, captureSnapshot, fileDigest, hash, repositoryMigrations, restoreBundle, restoreErrorCode, validateBundle } from './backup-lib.mjs';
import { runRestore } from './restore-check.mjs';

const local = join(ROOT, '.local');
const backups = join(local, 'backups');
const sourceConfig = {
  schemaVersion: 2,
  db: { container: 'credential-unit-source-db', database: 'credential_unit_source' },
  writers: ['credential-unit-writer'],
  media: { driver: 'none' },
};
const targetDbContainer = 'credential-unit-target-db';
const keyName = 'recovery-key.bin';
const vaultParts = ['.local', 'store-account-credentials', 'vault'];
const jsonRows = rows => rows.map(row => JSON.stringify(row)).join('\n');
const tables = ['_prisma_migrations', 'account_provision_operations', 'shops', 'users'];
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

async function assertRealDirectory(path) {
  assert.ok((await fs.lstat(path)).isDirectory());
  assert.ok(samePath(await fs.realpath(path), resolve(path)), 'fixture directory must not resolve through a link');
}

async function removeFixture(path, parent, expectedName) {
  assert.equal(path, join(parent, expectedName));
  await assertRealDirectory(parent);
  try { await assertRealDirectory(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await fs.rm(path, { recursive: true });
}

async function loadVault(appRoot) {
  const relative = join('backend', 'scripts', 'lib', 'merchant-credential-vault.cjs');
  const filename = join(appRoot, relative);
  const source = await fs.readFile(join(ROOT, relative), 'utf8');
  const module = { exports: {} };
  // Execute the actual vault implementation with a synthetic app root and no
  // inherited key override, even if a developer runs the test with env loaded.
  const run = runInThisContext(`(function(require, module, __dirname, process){\n${source}\n})`, { filename });
  run(createRequire(filename), module, dirname(filename), { platform: process.platform, env: {} });
  return module.exports;
}

function createAdapter(migrations, receiptRow, source) {
  const state = { revision: 0, writes: [], imported: false };
  const adapter = {
    async inspect(container) {
      if (source && sourceConfig.writers.includes(container)) return { running: false };
      assert.equal(container, targetDbContainer);
      return { running: true, composeProject: 'massajoy2-phase5-a1b2c3d4', composeService: 'db' };
    },
    async query(sql) {
      if (/^(CREATE DATABASE|CREATE USER|GRANT |DROP USER)/.test(sql)) {
        state.writes.push(sql.split(' ', 2).join(' '));
        assert.equal(source, false, 'source must receive only reads');
        return '';
      }
      if (sql.includes('FROM information_schema.tables')) return jsonRows(tables.map(table => [table, 'BASE TABLE', 'InnoDB']));
      if (sql.includes('information_schema.routines')) return '0';
      if (sql.startsWith('SELECT JSON_ARRAY(migration_name')) return jsonRows(migrations.map(({name,sha256}) => [name, sha256, true, false]));
      if (sql.includes('FROM information_schema.columns')) return jsonRows([['id', 'bigint', 'NO', null, '', null, '', null]]);
      if (sql.startsWith('SHOW CREATE TABLE')) return `${sql} (id bigint NOT NULL)`;
      if (sql.startsWith('SELECT COUNT(*) FROM `')) return sql.includes('`_prisma_migrations`') ? String(migrations.length) : '1';
      if (sql.startsWith('SELECT SHA2')) {
        if (sql.includes('`_prisma_migrations`')) return migrations.map(({ sha256 }) => sha256).sort().join('\n');
        if (sql.includes('`account_provision_operations`')) return hash(receiptRow);
        return hash([sql, state.revision]);
      }
      if (sql.includes('information_schema.key_column_usage')) return '';
      if (sql.startsWith('/* SNAPSHOT_PROVISION_REFERENCES */')) return '0';
      if (sql.startsWith('/* SNAPSHOT_PROVISION_OPERATIONS */')) return jsonRows([receiptRow]);
      if (sql.startsWith('/* SNAPSHOT_CREDENTIAL_RECEIPTS */')) return jsonRows([[receiptRow[0], receiptRow[2], receiptRow[3]]]);
      throw Error('UNEXPECTED_SYNTHETIC_SQL');
    },
    async dump(path) {
      assert.equal(source, true);
      await fs.writeFile(path, gzipSync('SYNTHETIC SQL ONLY'), { flag: 'wx', mode: 0o600 });
    },
    async import(_path, database, restricted) {
      assert.equal(source, false);
      assert.match(database, /^mj2_restore_[a-f0-9]{8}$/);
      assert.match(restricted.user, /^mj2_restore_[a-f0-9]{16}$/);
      state.imported = true;
    },
  };
  return { adapter, state };
}

async function fixture(t) {
  await fs.mkdir(backups, { recursive: true, mode: 0o700 });
  await assertRealDirectory(local);
  await assertRealDirectory(backups);
  const scope = await fs.mkdtemp(join(local, 'credential-protocol-unit-'));
  const bundle = join(backups, basename(scope));
  t.after(async () => {
    for (const [path, parent, name] of [
      [bundle, backups, basename(scope)],
      [bundle + '.partial', backups, basename(scope) + '.partial'],
      [scope, local, basename(scope)],
    ]) await removeFixture(path, parent, name);
  });
  const sourceApp = join(scope, 'source-app');
  const targetApp = join(scope, 'target-app');
  const targetDirectory = join(targetApp, ...vaultParts);
  await fs.mkdir(dirname(targetDirectory), { recursive: true, mode: 0o700 });
  const recoveryKeyFile = join(scope, keyName);
  const wrongKeyFile = join(scope, 'wrong-key.bin');
  const recoveryKey = randomBytes(32);
  const wrongKey = Buffer.from(recoveryKey);
  wrongKey[0] ^= 1;
  await fs.writeFile(recoveryKeyFile, recoveryKey, { flag: 'wx', mode: 0o600 });
  await fs.writeFile(wrongKeyFile, wrongKey, { flag: 'wx', mode: 0o600 });
  const config = { ...sourceConfig, credentialVault: { directory: join(sourceApp, ...vaultParts), recoveryKeyFile } };
  const target = { schemaVersion: 1, directory: targetDirectory, recoveryKeyFile };
  const vault = await loadVault(sourceApp);
  const operationId = randomUUID();
  const receipt = { userId: '17001', shopId: '17000', version: hash('synthetic version') };
  const current = {
    userId: receipt.userId, shopId: receipt.shopId, passwordHash: '$2b$12$' + 'A'.repeat(53),
    password: 'SYNTHETIC_PRIVATE_CURRENT_01', operationId,
  };
  const previous = { ...current, passwordHash: '$2b$12$' + 'B'.repeat(53), password: 'SYNTHETIC_PRIVATE_OLDER_02', operationId: null };
  vault.writeMerchantCredential(previous);
  vault.writeMerchantCredential(current);
  vault.writeMerchantCredentialReceipt({ operationId, ...receipt });
  const receiptRow = [operationId, '17002', receipt.shopId, receipt.userId, 'synthetic-credential-operation', hash('synthetic request'), 'CREDENTIALS_APPLIED'];
  const migrations = await repositoryMigrations();
  const source = createAdapter(migrations, receiptRow, true);
  const destination = createAdapter(migrations, receiptRow, false);
  return {
    bundle, scope, config, target, targetApp, wrongKeyFile, recoveryKey,
    vault, current, previous, receipt, operationId, source, destination,
    backup: (overrides = {}) => backupBundle(config, { directory: bundle, adapter: source.adapter, acknowledged: true, ...overrides }),
    restore: (expectedDigest, overrides = {}) => restoreBundle(config, bundle, {
      adapter: source.adapter, targetAdapter: destination.adapter, targetDbContainer,
      credentialTarget: target, expectedDigest, acknowledged: true, ...overrides,
    }),
  };
}

const assertNoTargetMutation = async f => {
  assert.deepEqual(f.destination.state.writes, []);
  assert.equal(f.destination.state.imported, false);
  await assert.rejects(fs.lstat(f.target.directory), { code: 'ENOENT' });
};

async function rewriteManifest(path, edit) {
  const filename = join(path, 'manifest.json');
  const { bundleDigest, ...manifest } = JSON.parse(await fs.readFile(filename, 'utf8'));
  await edit(manifest);
  manifest.bundleDigest = hash(manifest);
  assert.notEqual(manifest.bundleDigest, bundleDigest);
  await fs.writeFile(filename, JSON.stringify(manifest));
  return manifest.bundleDigest;
}

test('a credential backup restores actual current and historical envelopes and their operation receipt', async t => {
  const f = await fixture(t);
  const result = await f.backup();
  const { manifest } = await validateBundle(f.bundle, result.bundleDigest);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.credentialVault.databaseDigest, manifest.snapshot.digest);
  assert.equal(manifest.credentialVault.filesCount, 4);
  assert.deepEqual((await fs.readdir(f.bundle)).sort(), ['credentials.enc', 'database.sql.gz', 'manifest.json', 'media']);
  const ciphertext = await fs.readFile(join(f.bundle, 'credentials.enc'));
  assert.ok(!ciphertext.includes(f.recoveryKey));
  assert.ok(!ciphertext.includes(Buffer.from(f.current.password)));
  assert.ok(!ciphertext.includes(Buffer.from(f.operationId)));
  assert.doesNotMatch(JSON.stringify({ manifest, result }), /SYNTHETIC_PRIVATE|recovery-key\.bin|[\\/]v1[\\/]/);

  const restored = await f.restore(result.bundleDigest);
  assert.equal(restored.passed, true);
  assert.equal(restored.sourceUnchanged, true);
  assert.equal(restored.temporaryAccountRemoved, true);
  assert.equal(f.destination.state.imported, true);
  assert.deepEqual(f.source.state.writes, []);
  const targetVault = await loadVault(f.targetApp);
  for (const version of [f.current, f.previous]) {
    assert.deepEqual(targetVault.readMerchantCredential(version), f.vault.readMerchantCredential(version));
  }
  assert.deepEqual(targetVault.readMerchantCredentialReceipt(f.operationId), f.receipt);
  assert.doesNotMatch(JSON.stringify(restored), /SYNTHETIC_PRIVATE|recovery-key\.bin|[\\/]v1[\\/]/);
});

test('a version 3 bundle can be checked offline without a recovery key but cannot restore with a wrong one', async t => {
  const f = await fixture(t);
  const { bundleDigest } = await f.backup();
  const withheld = join(f.scope, 'withheld-key.bin');
  await fs.rename(f.target.recoveryKeyFile, withheld);
  assert.equal((await validateBundle(f.bundle, bundleDigest)).manifest.schemaVersion, 3);
  await fs.rename(withheld, f.target.recoveryKeyFile);
  await assert.rejects(f.restore(bundleDigest, { credentialTarget: { ...f.target, recoveryKeyFile: f.wrongKeyFile } }), /CREDENTIAL_ARCHIVE_DECRYPTION_FAILED/);
  await assertNoTargetMutation(f);
});

test('an omitted or already populated credential destination refuses before database creation', async t => {
  const f = await fixture(t);
  const { bundleDigest } = await f.backup();
  await assert.rejects(f.restore(bundleDigest, { credentialTarget: undefined }), /CREDENTIAL_[A-Z_]+/);
  await assertNoTargetMutation(f);
  await fs.mkdir(f.target.directory);
  const marker = join(f.target.directory, 'marker');
  await fs.writeFile(marker, 'keep existing target');
  await assert.rejects(f.restore(bundleDigest), /CREDENTIAL_[A-Z_]+/);
  assert.deepEqual(f.destination.state.writes, []);
  assert.equal(await fs.readFile(marker, 'utf8'), 'keep existing target');
  assert.deepEqual(await fs.readdir(f.target.directory), ['marker']);
});

test('tampered credential ciphertext fails offline validation and rehashing cannot make it decrypt', async t => {
  const f = await fixture(t);
  const { bundleDigest } = await f.backup();
  const archive = join(f.bundle, 'credentials.enc');
  const envelope = JSON.parse(await fs.readFile(archive, 'utf8'));
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[bytes.length - 1] ^= 1;
  envelope.ciphertext = bytes.toString('base64');
  await fs.writeFile(archive, JSON.stringify(envelope));
  await assert.rejects(validateBundle(f.bundle, bundleDigest), /CREDENTIAL_[A-Z_]+/);
  await assert.rejects(f.restore(bundleDigest), /CREDENTIAL_[A-Z_]+/);
  await assertNoTargetMutation(f);

  const forgedDigest = await rewriteManifest(f.bundle, async manifest => { manifest.credentialVault.archive = await fileDigest(archive); });
  assert.equal((await validateBundle(f.bundle, forgedDigest)).manifest.schemaVersion, 3);
  await assert.rejects(f.restore(forgedDigest), /CREDENTIAL_ARCHIVE_DECRYPTION_FAILED/);
  await assertNoTargetMutation(f);
});

test('an authenticated credential archive cannot be paired with a different database snapshot', async t => {
  const f = await fixture(t);
  await f.backup();
  f.source.state.revision++;
  const otherSnapshot = await captureSnapshot(f.source.adapter, { database: f.config.db.database });
  const mismatchedDigest = await rewriteManifest(f.bundle, manifest => { manifest.snapshot = otherSnapshot; });
  await assert.rejects(validateBundle(f.bundle, mismatchedDigest), /CREDENTIAL_[A-Z_]+/);
  const rewrittenDigest = await rewriteManifest(f.bundle, manifest => { manifest.credentialVault.databaseDigest = otherSnapshot.digest; });
  assert.equal((await validateBundle(f.bundle, rewrittenDigest)).manifest.snapshot.digest, otherSnapshot.digest);
  await assert.rejects(f.restore(rewrittenDigest), /CREDENTIAL_ARCHIVE_DECRYPTION_FAILED/);
  await assertNoTargetMutation(f);
});

test('a valid new envelope written after backup makes the stopped source no longer match', async t => {
  const f = await fixture(t);
  const { bundleDigest } = await f.backup();
  f.vault.writeMerchantCredential({ ...f.current, passwordHash: '$2b$12$' + 'C'.repeat(53), operationId: null });
  await assert.rejects(f.restore(bundleDigest), /CREDENTIAL_[A-Z_]+/);
  await assertNoTargetMutation(f);
});

test('vault drift during the database dump leaves only a partial bundle and safe diagnostics', async t => {
  const f = await fixture(t);
  const originalDump = f.source.adapter.dump;
  f.source.adapter.dump = async path => {
    await originalDump(path);
    f.vault.writeMerchantCredential({ ...f.current, passwordHash: '$2b$12$' + 'C'.repeat(53), operationId: null });
  };
  await assert.rejects(f.backup(), error => {
    const details = backupErrorDetails(error);
    assert.equal(details.code, 'BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED');
    assert.match(details.causeCode, /CREDENTIAL_[A-Z_]+/);
    assert.doesNotMatch(JSON.stringify(details), /SYNTHETIC_PRIVATE|credential-protocol-unit-|recovery-key\.bin/);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
  await assert.rejects(fs.lstat(f.bundle), { code: 'ENOENT' });
  assert.ok((await fs.lstat(f.bundle + '.partial')).isDirectory());
});

test('a committed database credential operation without its receipt refuses before backup staging', async t => {
  const f = await fixture(t);
  await fs.unlink(join(f.config.credentialVault.directory, 'operations', `${f.operationId}.json`));
  await assert.rejects(f.backup(), /CREDENTIAL_[A-Z_]+/);
  await assert.rejects(fs.lstat(f.bundle), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(f.bundle + '.partial'), { code: 'ENOENT' });
  assert.deepEqual(f.source.state.writes, []);
  await assertNoTargetMutation(f);
});

test('a legacy version 2 database bundle still restores without a credential target', async t => {
  const f = await fixture(t);
  const { bundleDigest } = await backupBundle(sourceConfig, { directory: f.bundle, adapter: f.source.adapter, acknowledged: true });
  const { manifest } = await validateBundle(f.bundle, bundleDigest);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(Object.hasOwn(manifest, 'credentialVault'), false);
  const options = { adapter: f.source.adapter, targetAdapter: f.destination.adapter, targetDbContainer, expectedDigest: bundleDigest, acknowledged: true };
  await assert.rejects(restoreBundle(sourceConfig, f.bundle, { ...options, credentialTarget: f.target }), /CREDENTIAL_[A-Z_]+/);
  await assertNoTargetMutation(f);
  const restored = await restoreBundle(sourceConfig, f.bundle, options);
  assert.equal(restored.passed, true);
  assert.equal(restored.sourceUnchanged, true);
  await assert.rejects(fs.lstat(f.target.directory), { code: 'ENOENT' });
});

test('restore diagnostics expose fixed codes only even for uppercase secret-like errors and throwing getters', () => {
  const raw = Object.assign(Error('SYNTHETIC_PRIVATE_SECRET'), { code: 'SYNTHETIC_PRIVATE_CODE', password: 'SYNTHETIC_PRIVATE_PASSWORD' });
  const getter = { get message() { throw raw; } };
  for (const error of [raw, getter, null, undefined, 'SYNTHETIC_PRIVATE_STRING', { message: { toString() { throw raw; } } }]) {
    assert.equal(restoreErrorCode(error), 'RESTORE_INVOCATION_OR_OPERATION_FAILED');
    assert.equal(restoreErrorCode(error, 'NEW_TARGET_RESTORE_FAILED'), 'NEW_TARGET_RESTORE_FAILED');
  }
  assert.equal(restoreErrorCode(Error('CREDENTIAL_ARCHIVE_DECRYPTION_FAILED')), 'CREDENTIAL_ARCHIVE_DECRYPTION_FAILED');
  assert.equal(restoreErrorCode(Error('SOURCE_UNCHANGED_VERIFICATION_FAILED')), 'RESTORE_INVOCATION_OR_OPERATION_FAILED');
});

test('restore CLI rejects credential configuration without acknowledgement before accessing its path', async t => {
  const output = [], errors = [];
  t.mock.method(console, 'log', value => output.push(value));
  t.mock.method(console, 'error', value => errors.push(value));
  const code = await runRestore(['--bundle', 'SYNTHETIC_PRIVATE_BUNDLE_DOES_NOT_EXIST', '--credential-target-config', 'SYNTHETIC_PRIVATE_TARGET_DOES_NOT_EXIST']);
  assert.equal(code, 1);
  assert.deepEqual(output, []);
  assert.deepEqual(errors.map(value => JSON.parse(value)), [{ passed: false, error: { code: 'RESTORE_CONFIG_WITHOUT_ACKNOWLEDGEMENT' }, deploymentReady: false }]);
  assert.doesNotMatch(errors.join('\n'), /SYNTHETIC_PRIVATE/);
});

test('offline restore CLI reports ciphertext verification without authentication or access to a recovery key', async t => {
  const f = await fixture(t);
  const { bundleDigest } = await f.backup();
  await fs.unlink(f.target.recoveryKeyFile);
  const output = [], errors = [];
  t.mock.method(console, 'log', value => output.push(value));
  t.mock.method(console, 'error', value => errors.push(value));
  const code = await runRestore(['--bundle', f.bundle, '--expected-bundle-digest', bundleDigest]);
  assert.equal(code, 0);
  assert.deepEqual(errors, []);
  assert.equal(output.length, 1);
  const report = JSON.parse(output[0]);
  assert.equal(report.mode, 'offline-bundle-verification');
  assert.equal(report.credentialVaultIncluded, true);
  assert.equal(report.credentialCiphertextVerified, true);
  assert.equal(report.credentialsAuthenticated, false);
  assert.equal(report.databaseAccessed, false);
  assert.equal(report.mediaTargetAccessed, false);
  assert.equal(report.credentialTargetAccessed, false);
  assert.equal(report.deploymentReady, false);
  await assertNoTargetMutation(f);
});

test('a failed database import retains its isolated database and leaves the credential target unpublished', async t => {
  const f = await fixture(t);
  const { bundleDigest } = await f.backup();
  const beforeSource = await captureSnapshot(f.source.adapter, { database: f.config.db.database });
  const beforeVault = f.vault.readMerchantCredential(f.current);
  const beforeReceipt = f.vault.readMerchantCredentialReceipt(f.operationId);
  f.destination.adapter.import = async () => { throw Object.assign(Error('SYNTHETIC_PRIVATE_SECRET'), { code: 'SYNTHETIC_PRIVATE_CODE' }); };
  const restored = await f.restore(bundleDigest);
  assert.equal(restored.passed, false);
  assert.deepEqual(restored.error, { code: 'NEW_TARGET_RESTORE_FAILED' });
  assert.equal(restored.databaseCreated, true);
  assert.equal(restored.temporaryAccountRemoved, true);
  assert.equal(restored.sourceUnchanged, true);
  assert.match(restored.database, /^mj2_restore_[a-f0-9]{8}$/);
  assert.deepEqual(f.source.state.writes, []);
  assert.deepEqual(f.destination.state.writes, ['CREATE DATABASE', 'CREATE USER', 'GRANT ALL', 'DROP USER']);
  assert.doesNotMatch(JSON.stringify(restored), /SYNTHETIC_PRIVATE/);
  assert.deepEqual(await captureSnapshot(f.source.adapter, { database: f.config.db.database }), beforeSource);
  assert.deepEqual(f.vault.readMerchantCredential(f.current), beforeVault);
  assert.deepEqual(f.vault.readMerchantCredentialReceipt(f.operationId), beforeReceipt);
  await assert.rejects(fs.lstat(f.target.directory), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(dirname(f.target.directory)), []);
});
