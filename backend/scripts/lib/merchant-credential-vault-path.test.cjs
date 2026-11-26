'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runInThisContext } = require('node:vm');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '../../..');
const LOG_SCOPE = path.join(ROOT, '.local', 'vault-deployment-fix-20261113');
const SOURCE = fs.readFileSync(path.join(__dirname, 'merchant-credential-vault.cjs'), 'utf8');
const identity = { shopId: '201', userId: '301', passwordHash: '$2b$12$' + 'A'.repeat(53) };
const previous = { ...identity, passwordHash: '$2b$12$' + 'B'.repeat(53) };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture(t) {
  fs.mkdirSync(LOG_SCOPE, { recursive: true });
  const scope = fs.mkdtempSync(path.join(LOG_SCOPE, 'synthetic-path-'));
  t.after(() => {
    const actual = fs.realpathSync(scope), parent = fs.realpathSync(LOG_SCOPE);
    assert.equal(path.dirname(actual), parent);
    assert(path.basename(actual).startsWith('synthetic-path-'));
    assert(!fs.lstatSync(scope).isSymbolicLink());
    fs.rmSync(actual, { recursive: true, force: true });
  });
  return { scope, directory: path.join(scope, 'persistent volume', 'vault') };
}

function load(scope, env = {}, packaged = false, runtimeOptions = {}) {
  // Execute the real CJS with a synthetic module root and isolated environment.
  // No test loads the canonical application's real vault or inherited secrets.
  const filename = path.join(scope, 'app', ...(packaged ? [] : ['backend']), 'scripts', 'lib', 'merchant-credential-vault.cjs');
  const module = { exports: {} };
  const requireRuntime = createRequire(filename);
  runInThisContext('(function(require,module,__dirname,process){\n' + SOURCE + '\n})', { filename })(
    id => id === 'node:fs' && runtimeOptions.fs ? runtimeOptions.fs : requireRuntime(id),
    module, path.dirname(filename), { platform: process.platform, getuid: process.getuid?.bind(process), env, ...runtimeOptions.process },
  );
  return module.exports;
}

function inventory(directory) {
  const result = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      assert(!fs.lstatSync(file).isSymbolicLink());
      if (entry.isDirectory()) walk(file);
      else result.push([path.relative(directory, file), digest(fs.readFileSync(file))]);
    }
  }
  walk(directory);
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

test('packaged layout persists current/history/receipts in the explicitly configured absolute directory', t => {
  const { scope, directory } = fixture(t), env = { MERCHANT_CREDENTIAL_VAULT_DIR: directory, NODE_ENV: 'test' };
  const runtime = load(scope, env, true), operationId = crypto.randomUUID(), version = digest('synthetic-version');
  runtime.writeMerchantCredential({ ...previous, password: 'SyntheticOld7' });
  runtime.writeMerchantCredential({ ...identity, password: 'SyntheticNew9', operationId });
  runtime.writeMerchantCredentialReceipt({ operationId, shopId: identity.shopId, userId: identity.userId, version });
  assert(fs.existsSync(path.join(directory, 'key.bin')));
  const before = inventory(directory), restoredRuntime = load(scope, { ...env }, true);
  assert.equal(restoredRuntime.readMerchantCredential(identity).password, 'SyntheticNew9');
  assert.equal(restoredRuntime.readMerchantCredential(previous).password, 'SyntheticOld7');
  assert.deepEqual(restoredRuntime.readMerchantCredentialReceipt(operationId), { shopId: identity.shopId, userId: identity.userId, version });
  assert.deepEqual(inventory(directory), before);
  assert.equal(before.length, 4);
  assert(!fs.existsSync(path.join(scope, '.local')));
  assert(!fs.existsSync(path.join(scope, 'app', '.local')));
});

test('unconfigured local layout retains its existing directory, key and immutable envelope bytes', t => {
  const { scope } = fixture(t), directory = path.join(scope, 'app', '.local', 'store-account-credentials', 'vault');
  fs.mkdirSync(directory, { recursive: true });
  const key = crypto.randomBytes(32); fs.writeFileSync(path.join(directory, 'key.bin'), key);
  const runtime = load(scope, { NODE_ENV: 'test' });
  runtime.writeMerchantCredential({ ...identity, password: 'LocalExisting9' });
  const before = inventory(directory);
  assert.equal(load(scope).readMerchantCredential(identity).password, 'LocalExisting9');
  assert.deepEqual(inventory(directory), before);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'key.bin')), key);
});

test('rejects explicitly empty, relative, root-only and malformed directory settings before any file write', t => {
  const { scope } = fixture(t);
  const invalid = ['', ' ', 'relative/vault', '../vault', path.parse(scope).root, scope + '\u0000vault', scope + '\nvault', ' ' + scope, scope + ' '];
  if (process.platform === 'win32') invalid.push('C:relative-vault', '\\root-relative-vault', '/root-relative-vault', scope + '\\bad:stream', scope + '\\trailing.');
  for (const value of invalid) assert.throws(() => load(scope, { MERCHANT_CREDENTIAL_VAULT_DIR: value }), /Invalid credential vault directory/);
  assert.deepEqual(fs.readdirSync(scope), []);
});

test('rejects linked vault directories and linked ancestor directories without touching their targets', t => {
  const { scope } = fixture(t), outside = path.join(scope, 'outside'), link = path.join(scope, 'linked');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const directory of [link, path.join(link, 'nested', 'vault')]) {
    assert.throws(() => load(scope, { MERCHANT_CREDENTIAL_VAULT_DIR: directory }).writeMerchantCredential({ ...identity, password: 'NeverWrite9' }), /Credential vault links/);
  }
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('rejects dangling linked ancestors and a regular file in the directory chain', t => {
  const { scope } = fixture(t), link = path.join(scope, 'dangling'), missing = path.join(scope, 'missing');
  fs.symlinkSync(missing, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => load(scope, { MERCHANT_CREDENTIAL_VAULT_DIR: path.join(link, 'vault') }).writeMerchantCredential({ ...identity, password: 'NeverWrite9' }), /Credential vault links/);
  const file = path.join(scope, 'not-directory'); fs.writeFileSync(file, 'synthetic');
  assert.throws(() => load(scope, { MERCHANT_CREDENTIAL_VAULT_DIR: path.join(file, 'vault') }), /Invalid credential vault directory/);
  assert(!fs.existsSync(missing));
});

test('pins directory selection to the loaded instance so a cached key cannot be redirected by env changes', t => {
  const { scope, directory } = fixture(t), other = path.join(scope, 'other-vault'), env = { MERCHANT_CREDENTIAL_VAULT_DIR: directory };
  const runtime = load(scope, env); runtime.writeMerchantCredential({ ...identity, password: 'PinnedCurrent9' });
  const keyBefore = fs.readFileSync(path.join(directory, 'key.bin'));
  env.MERCHANT_CREDENTIAL_VAULT_DIR = other;
  runtime.writeMerchantCredential({ ...previous, password: 'PinnedHistory7' });
  assert.equal(load(scope, { MERCHANT_CREDENTIAL_VAULT_DIR: directory }).readMerchantCredential(previous).password, 'PinnedHistory7');
  assert.deepEqual(fs.readFileSync(path.join(directory, 'key.bin')), keyBefore);
  assert(!fs.existsSync(other));
});

test('rechecks ancestor and key links after key caching instead of trusting prior permission setup', t => {
  const { scope } = fixture(t), parent = path.join(scope, 'safe'), directory = path.join(parent, 'vault');
  const runtime = load(scope, { MERCHANT_CREDENTIAL_VAULT_DIR: directory });
  runtime.writeMerchantCredential({ ...identity, password: 'BeforeLink9' });
  const moved = path.join(scope, 'moved'), outside = path.join(scope, 'outside');
  fs.renameSync(parent, moved); fs.mkdirSync(outside);
  fs.symlinkSync(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => runtime.readMerchantCredential(identity), /Credential vault links/);
  assert.throws(() => runtime.writeMerchantCredential({ ...previous, password: 'NeverWrite9' }), /Credential vault links/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(parent); fs.renameSync(moved, parent);
  const keyFile = path.join(directory, 'key.bin'), originalKey = path.join(directory, 'original-key.bin');
  fs.renameSync(keyFile, originalKey); fs.symlinkSync(originalKey, keyFile, 'file');
  assert.throws(() => runtime.readMerchantCredential(identity), /Credential vault links/);
  assert.throws(() => runtime.writeMerchantCredential({ ...previous, password: 'NeverWrite9' }), /Credential vault links/);
});

test('production never auto-generates a key but can reuse an existing restored key without replacing it', t => {
  const { scope, directory } = fixture(t), env = { MERCHANT_CREDENTIAL_VAULT_DIR: directory, NODE_ENV: 'production' };
  const runtime = load(scope, env);
  assert.throws(() => runtime.writeMerchantCredential({ ...identity, password: 'Production9' }), /Configure MERCHANT_CREDENTIAL_VAULT_KEY/);
  assert(!fs.existsSync(path.join(directory, 'key.bin')));
  fs.mkdirSync(directory, { recursive: true });
  const key = crypto.randomBytes(32); fs.writeFileSync(path.join(directory, 'key.bin'), key);
  const restoredRuntime = load(scope, env); restoredRuntime.writeMerchantCredential({ ...identity, password: 'RestoredProduction9' });
  assert.equal(load(scope, env).readMerchantCredential(identity).password, 'RestoredProduction9');
  assert.deepEqual(fs.readFileSync(path.join(directory, 'key.bin')), key);
});

test('configured external keys remain compatible with absolute paths and never create a local key file', t => {
  const { scope, directory } = fixture(t), key = crypto.randomBytes(32).toString('base64');
  const env = { MERCHANT_CREDENTIAL_VAULT_DIR: directory, MERCHANT_CREDENTIAL_VAULT_KEY: key, NODE_ENV: 'production' };
  load(scope, env).writeMerchantCredential({ ...identity, password: 'ExternalKey9' });
  assert.equal(load(scope, env).readMerchantCredential(identity).password, 'ExternalKey9');
  assert(!fs.existsSync(path.join(directory, 'key.bin')));
  assert.throws(() => load(scope, { ...env, MERCHANT_CREDENTIAL_VAULT_KEY: crypto.randomBytes(32).toString('base64') }).readMerchantCredential(identity));
});

test('POSIX owner checks reject foreign vault/files before chmod but permit root-owned ancestors', t => {
  const { scope, directory } = fixture(t), env = { MERCHANT_CREDENTIAL_VAULT_DIR: directory }, uid = 1001;
  fs.mkdirSync(directory, { recursive: true });
  let foreign = directory, chmodCalls = 0;
  const ownedFs = Object.create(fs);
  ownedFs.lstatSync = filename => {
    const stat = fs.lstatSync(filename), resolved = path.resolve(filename);
    return new Proxy(stat, { get(target, property) {
      if (property === 'uid') return resolved === foreign || resolved !== directory && !resolved.startsWith(directory + path.sep) ? 0 : uid;
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  ownedFs.chmodSync = () => { chmodCalls++; };
  const runtimeOptions = { fs: ownedFs, process: { platform: 'linux', getuid: () => uid } };
  assert.throws(() => load(scope, env, false, runtimeOptions), /Credential vault ownership/);
  assert.equal(chmodCalls, 0);
  foreign = null;
  const runtime = load(scope, env, false, runtimeOptions), operationId = crypto.randomUUID(), version = digest('owner-version');
  runtime.writeMerchantCredential({ ...identity, password: 'OwnedCurrent9', operationId });
  runtime.writeMerchantCredentialReceipt({ ...identity, operationId, version });
  assert.equal(runtime.readMerchantCredential(identity).password, 'OwnedCurrent9');
  assert(chmodCalls > 0);
  const chmodBefore = chmodCalls;
  foreign = path.join(directory, 'key.bin');
  assert.throws(() => runtime.readMerchantCredential(identity), /Credential vault ownership/);
  assert.throws(() => runtime.writeMerchantCredential({ ...previous, password: 'NeverWrite9' }), /Credential vault ownership/);
  foreign = path.join(directory, 'v1', identity.userId, digest(identity.passwordHash) + '.json');
  assert.throws(() => runtime.readMerchantCredential(identity), /Credential vault ownership/);
  foreign = path.join(directory, 'operations', operationId + '.json');
  assert.throws(() => runtime.readMerchantCredentialReceipt(operationId), /Credential vault ownership/);
  assert.equal(chmodCalls, chmodBefore);
});

