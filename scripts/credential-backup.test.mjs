import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {
  captureCredentialVault, openCredentialArchive, prepareCredentialTarget, restoreCredentialVault,
  validateCredentialArchive, validateCredentialTargetConfig, validateCredentialVaultConfig, verifyCredentialVaultReferences, writeCredentialArchive,
} from './credential-backup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(root, '.local');
const runtimePath = join('backend', 'scripts', 'lib', 'merchant-credential-vault.cjs');
const vaultPath = join('.local', 'store-account-credentials', 'vault');
const require = createRequire(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const dbDigest = hash('synthetic database');
const identity = {shopId: '201', userId: '301', passwordHash: '$2b$12$' + 'A'.repeat(53)};
const previous = {...identity, passwordHash: '$2b$12$' + 'B'.repeat(53)};
const error = message => ({message});

async function copyRuntime(app) {
  const modulePath = join(app, runtimePath);
  await fs.mkdir(dirname(modulePath), {recursive: true});
  await fs.copyFile(join(root, runtimePath), modulePath);
  return require(modulePath);
}

async function fixture(t) {
  await fs.mkdir(local, {recursive: true});
  const scope = await fs.mkdtemp(join(local, 'credential-backup-helper-'));
  t.after(async () => {
    const [resolvedLocal, resolvedScope] = await Promise.all([fs.realpath(local), fs.realpath(scope)]);
    const child = relative(resolvedLocal, resolvedScope);
    if (!child.startsWith('credential-backup-helper-') || child.includes(sep) || (await fs.lstat(scope)).isSymbolicLink()) throw Error('Unexpected fixture path');
    await fs.rm(resolvedScope, {recursive: true, force: true});
  });
  const recoveryKeyFile = join(scope, 'recovery.key');
  await fs.writeFile(recoveryKeyFile, randomBytes(32), {flag: 'wx', mode: 0o600});
  const app = join(scope, 'source'), restoredApp = join(scope, 'restored');
  const directory = join(app, vaultPath);
  const target = {schemaVersion: 1, directory: join(restoredApp, vaultPath), recoveryKeyFile};
  await fs.mkdir(dirname(target.directory), {recursive: true});
  const config = {directory, recoveryKeyFile};
  return {scope, app, restoredApp, config, target, archive: join(scope, 'credentials.enc')};
}

test('archive restores real runtime envelopes, old hashes and receipts with an external source key', async t => {
  const {scope, app, restoredApp, config, target, archive} = await fixture(t);
  const operationId = randomUUID(), version = hash('synthetic credential version');
  const syntheticKey = randomBytes(32), previousKeyEnv = process.env.MERCHANT_CREDENTIAL_VAULT_KEY;
  const runtime = await copyRuntime(app), restored = await copyRuntime(restoredApp);
  config.sourceKeyFile = join(scope, 'vault.key');
  await fs.writeFile(config.sourceKeyFile, syntheticKey, {flag: 'wx', mode: 0o600});
  try {
    process.env.MERCHANT_CREDENTIAL_VAULT_KEY = syntheticKey.toString('base64');
    runtime.writeMerchantCredential({...previous, password: 'SyntheticOld7'});
    runtime.writeMerchantCredential({...identity, password: 'SyntheticNew9', operationId});
    runtime.writeMerchantCredentialReceipt({...identity, operationId, version});
  } finally {
    if (previousKeyEnv === undefined) delete process.env.MERCHANT_CREDENTIAL_VAULT_KEY;
    else process.env.MERCHANT_CREDENTIAL_VAULT_KEY = previousKeyEnv;
    syntheticKey.fill(0);
  }
  await assert.rejects(fs.stat(join(config.directory, 'key.bin')), {code: 'ENOENT'});
  assert.equal(validateCredentialVaultConfig(config, root), config);
  assert.equal(validateCredentialTargetConfig(target, root), target);
  const snapshot = await captureCredentialVault(config, root);
  assert.deepEqual(Object.keys(snapshot), ['digest', 'filesCount']);
  assert.equal(snapshot.filesCount, 4);
  assert.equal((await captureCredentialVault(config, root)).sourceDigest, snapshot.sourceDigest);
  const references = {operations: [{id: operationId, shopId: identity.shopId, userId: identity.userId}]};
  assert.equal(verifyCredentialVaultReferences(snapshot, references), true);
  assert.throws(() => verifyCredentialVaultReferences(snapshot, {operations: [{...references.operations[0], id: randomUUID()}]}), error('CREDENTIAL_DATABASE_REFERENCE_MISSING'));
  assert.throws(() => verifyCredentialVaultReferences(snapshot, {operations: [{...references.operations[0], shopId: '202'}]}), error('CREDENTIAL_DATABASE_REFERENCE_MISSING'));
  assert.throws(() => verifyCredentialVaultReferences(snapshot, {operations: [{...references.operations[0], userId: '302'}]}), error('CREDENTIAL_DATABASE_REFERENCE_MISSING'));
  const descriptor = await writeCredentialArchive(snapshot, archive, config, root, dbDigest);
  const document = JSON.parse(await fs.readFile(archive, 'utf8'));
  assert.deepEqual(Object.keys(document), ['version', 'format', 'iv', 'tag', 'ciphertext']);
  assert.deepEqual(await validateCredentialArchive(archive, descriptor), {filesCount: 4});
  assert.equal((await prepareCredentialTarget(target, root, config, archive)).directory, target.directory);
  await assert.rejects(fs.stat(target.directory), {code: 'ENOENT'});
  const decrypted = await openCredentialArchive(archive, descriptor, target, root);
  assert.equal(decrypted.digest, snapshot.digest);
  assert.equal(verifyCredentialVaultReferences(decrypted, references), true);
  await assert.rejects(restoreCredentialVault(decrypted, {...target, directory: join(scope, 'unapproved-vault')}, root), error('UNSAFE_CREDENTIAL_BACKUP_PATH'));
  assert.deepEqual(await restoreCredentialVault(decrypted, target, root), {filesCount: 4, digest: snapshot.digest});
  try {
    delete process.env.MERCHANT_CREDENTIAL_VAULT_KEY;
    const current = restored.readMerchantCredential(identity);
    assert.equal(current?.password === 'SyntheticNew9', true);
    assert.equal(current.operationId, operationId);
    assert.equal(restored.readMerchantCredential(previous)?.password === 'SyntheticOld7', true);
    assert.deepEqual(restored.readMerchantCredentialReceipt(operationId), {shopId: identity.shopId, userId: identity.userId, version});
  } finally { if (previousKeyEnv !== undefined) process.env.MERCHANT_CREDENTIAL_VAULT_KEY = previousKeyEnv; }
  await assert.rejects(restoreCredentialVault(decrypted, target, root), error('CREDENTIAL_TARGET_ALREADY_EXISTS'));
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(target.directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(join(target.directory, 'key.bin'))).mode & 0o777, 0o600);
  }
});

test('wrong recovery key, changed database binding, changed recovery key and corrupted archive fail closed', async t => {
  const {scope, config, target, archive} = await fixture(t);
  await fs.mkdir(config.directory, {recursive: true});
  await fs.writeFile(join(config.directory, 'key.bin'), randomBytes(32), {mode: 0o600});
  const snapshot = await captureCredentialVault(config, root);
  assert.equal(verifyCredentialVaultReferences(snapshot, {operations: []}), true);
  assert.throws(() => verifyCredentialVaultReferences({}, {operations: []}), error('CREDENTIAL_DATABASE_REFERENCE_MISSING'));
  const descriptor = await writeCredentialArchive(snapshot, archive, config, root, dbDigest);
  const opened = await openCredentialArchive(archive, descriptor, target, root);
  await assert.rejects(openCredentialArchive(archive, {...descriptor, databaseDigest: hash('other database')}, target, root), error('CREDENTIAL_ARCHIVE_DECRYPTION_FAILED'));
  const wrongKey = join(scope, 'wrong.key');
  await fs.writeFile(wrongKey, randomBytes(32), {mode: 0o600});
  await assert.rejects(openCredentialArchive(archive, descriptor, {...target, recoveryKeyFile: wrongKey}, root), error('CREDENTIAL_ARCHIVE_DECRYPTION_FAILED'));
  await fs.copyFile(wrongKey, config.recoveryKeyFile);
  await assert.rejects(restoreCredentialVault(opened, target, root), error('CREDENTIAL_ARCHIVE_DECRYPTION_FAILED'));
  assert.notEqual((await captureCredentialVault(config, root)).sourceDigest, snapshot.sourceDigest);
  const untouched = join(scope, 'untouched.enc');
  await assert.rejects(writeCredentialArchive(snapshot, untouched, config, root, dbDigest), error('CREDENTIAL_BACKUP_SOURCE_CHANGED'));
  await assert.rejects(fs.stat(untouched), {code: 'ENOENT'});
  const corrupted = await fs.readFile(archive);
  corrupted[corrupted.length - 2] ^= 1;
  await fs.writeFile(archive, corrupted);
  await assert.rejects(validateCredentialArchive(archive, descriptor), error('CREDENTIAL_ARCHIVE_DIGEST_MISMATCH'));
  await assert.rejects(fs.stat(target.directory), {code: 'ENOENT'});
});

test('rejects unknown, unverified and unsafe vault inputs and keeps destinations untouched', async t => {
  const {scope, app, config, target} = await fixture(t);
  await fs.mkdir(config.directory, {recursive: true});
  await assert.rejects(captureCredentialVault(config, root), error('CREDENTIAL_VAULT_KEY_UNAVAILABLE'));
  const keyPath = join(config.directory, 'key.bin');
  const key = randomBytes(32);
  await fs.writeFile(keyPath, key, {mode: 0o600});
  await fs.writeFile(config.recoveryKeyFile, key);
  key.fill(0);
  await assert.rejects(captureCredentialVault(config, root), error('CREDENTIAL_RECOVERY_KEY_NOT_INDEPENDENT'));
  await fs.writeFile(config.recoveryKeyFile, randomBytes(32));
  const unknown = join(config.directory, 'unknown.json');
  await fs.writeFile(unknown, '{}');
  await assert.rejects(captureCredentialVault(config, root), error('INVALID_CREDENTIAL_VAULT_FILE'));
  await fs.unlink(unknown);
  const runtime = await copyRuntime(app);
  const previousKeyEnv = process.env.MERCHANT_CREDENTIAL_VAULT_KEY;
  try {
    delete process.env.MERCHANT_CREDENTIAL_VAULT_KEY;
    runtime.writeMerchantCredential({...identity, password: 'SyntheticNew9'});
  } finally { if (previousKeyEnv !== undefined) process.env.MERCHANT_CREDENTIAL_VAULT_KEY = previousKeyEnv; }
  const wrongSourceKey = join(scope, 'incorrect-vault.key');
  await fs.writeFile(wrongSourceKey, randomBytes(32), {mode: 0o600});
  await assert.rejects(captureCredentialVault({...config, sourceKeyFile: wrongSourceKey}, root), error('CREDENTIAL_VAULT_DECRYPTION_FAILED'));
  const file = join(config.directory, 'v1', identity.userId, hash(identity.passwordHash) + '.json');
  const document = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({...document, userId: '999'}));
  await assert.rejects(captureCredentialVault(config, root), error('INVALID_CREDENTIAL_VAULT_ENVELOPE'));

  const unsafe = error('UNSAFE_CREDENTIAL_BACKUP_PATH');
  assert.throws(() => validateCredentialVaultConfig({...config, recoveryKeyFile: join(config.directory, 'recovery.key')}, root), unsafe);
  assert.throws(() => validateCredentialTargetConfig({...target, directory: join(root, vaultPath)}, root), unsafe);
  assert.throws(() => validateCredentialTargetConfig({...target, directory: join(root, '.local', 'backups', 'restore')}, root), unsafe);
  assert.throws(() => validateCredentialTargetConfig({...target, recoveryKeyFile: join(root, 'outside.key')}, root), unsafe);
  assert.throws(() => validateCredentialTargetConfig({...target, directory: scope}, root), unsafe);
  await assert.rejects(prepareCredentialTarget({...target, directory: dirname(config.directory)}, root, config), unsafe);
  await assert.rejects(prepareCredentialTarget({...target, directory: join(scope, 'missing', 'vault')}, root, config), error('CREDENTIAL_TARGET_PARENT_REQUIRED'));
  const link = join(scope, 'link');
  await fs.symlink(dirname(target.directory), link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateCredentialTargetConfig({...target, directory: join(link, 'vault')}, root), unsafe);
  await fs.unlink(link);
  await assert.rejects(fs.stat(target.directory), {code: 'ENOENT'});
});
