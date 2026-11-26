'use strict';

// Shared by the ADMIN account API and local account migration. No plaintext or
// bcrypt hash is stored here; a credential is readable only for its current DB
// hash. Immutable, hash-addressed envelopes also make a rolled-back DB write
// leave an unreachable ciphertext instead of replacing the previous password.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
function vaultDirectory(configured) {
  if (configured === undefined) return path.join(ROOT, '.local', 'store-account-credentials', 'vault');
  if (typeof configured !== 'string' || !configured || configured !== configured.trim() || /[\u0000-\u001f\u007f]/u.test(configured) || !path.isAbsolute(configured)) throw new Error('Invalid credential vault directory');
  if (process.platform === 'win32') {
    // A drive-root-relative path (\vault) is not a stable absolute deployment
    // setting, even though path.isAbsolute accepts it on Windows.
    if (!/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/])/u.test(configured) || /[<>"|?*]/u.test(configured) || configured.slice(2).includes(':')) throw new Error('Invalid credential vault directory');
    if (configured.split(/[\\/]/u).some(part => part && /[. ]$/u.test(part))) throw new Error('Invalid credential vault directory');
  }
  if (configured.split(process.platform === 'win32' ? /[\\/]/u : /\//u).some(part => part === '.' || part === '..')) throw new Error('Invalid credential vault directory');
  const directory = path.resolve(configured);
  if (directory === path.parse(directory).root) throw new Error('Invalid credential vault directory');
  return directory;
}

// Pin directory selection to this module instance, like its key cache. Runtime
// environment changes must not redirect a previously cached key to another vault.
const DIRECTORY = vaultDirectory(process.env.MERCHANT_CREDENTIAL_VAULT_DIR);
const KEY_FILE = path.join(DIRECTORY, 'key.bin');
const ID = /^[1-9]\d{0,18}$/;
const BCRYPT = /^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;
let protectedDirectory = false;
let cachedKey;

function checkedChain(filename, directory) {
  const root = path.parse(filename).root;
  let current = root;
  const parts = path.relative(root, filename).split(path.sep).filter(Boolean);
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      if (error.code === 'ENOTDIR') throw new Error('Invalid credential vault directory');
      throw error;
    }
    // lstat catches dangling links as well as existing symlink/junction targets.
    if (stat.isSymbolicLink()) throw new Error('Credential vault links are not allowed');
    if ((index < parts.length - 1 || directory) && !stat.isDirectory()) throw new Error('Invalid credential vault directory');
    // /app and other parents may belong to root. Only the vault itself and
    // existing children must belong to this POSIX process; never chmod others.
    if (process.platform !== 'win32' && typeof process.getuid === 'function' && (current === DIRECTORY || current.startsWith(DIRECTORY + path.sep)) && stat.uid !== process.getuid()) throw new Error('Credential vault ownership does not match current user');
  }
}

function checkedPath(...parts) {
  const result = path.resolve(DIRECTORY, ...parts);
  if (result !== DIRECTORY && !result.startsWith(DIRECTORY + path.sep)) throw new Error('Invalid credential vault path');
  checkedChain(DIRECTORY, true);
  if (result !== DIRECTORY) checkedChain(result, false);
  return result;
}

checkedPath();

function prepareDirectory() {
  checkedPath();
  if (protectedDirectory) return;
  fs.mkdirSync(DIRECTORY, { recursive: true, mode: 0o700 });
  checkedPath();
  if (process.platform === 'win32') {
    const user = execFileSync('whoami.exe', [], { encoding: 'utf8', windowsHide: true }).trim();
    execFileSync('icacls.exe', [DIRECTORY, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`], { stdio: 'ignore', windowsHide: true });
  } else {
    fs.chmodSync(DIRECTORY, 0o700);
  }
  protectedDirectory = true;
}

function writeNewFile(filename, contents) {
  const temporary = checkedPath(path.relative(DIRECTORY, filename) + '.' + crypto.randomUUID() + '.tmp');
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    // A complete file becomes visible atomically; another process may have
    // already created the same immutable record/key while this one prepared it.
    fs.linkSync(temporary, filename);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    fs.unlinkSync(temporary);
  }
}

function key(create) {
  checkedPath('key.bin');
  if (cachedKey) return cachedKey;
  const configured = process.env.MERCHANT_CREDENTIAL_VAULT_KEY;
  if (configured) {
    const decoded = Buffer.from(configured, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== configured) throw new Error('Invalid merchant credential vault key');
    return cachedKey = decoded;
  }
  checkedPath('key.bin');
  if (!fs.existsSync(KEY_FILE)) {
    if (!create) throw new Error('Merchant credential vault key is unavailable');
    if (process.env.NODE_ENV === 'production') throw new Error('Configure MERCHANT_CREDENTIAL_VAULT_KEY before storing merchant credentials');
    prepareDirectory();
    writeNewFile(KEY_FILE, crypto.randomBytes(32));
  }
  const result = fs.readFileSync(KEY_FILE);
  if (result.length !== 32) throw new Error('Merchant credential vault key is unavailable');
  return cachedKey = result;
}

function identity(input) {
  const shopId = String(input.shopId), userId = String(input.userId);
  if (!ID.test(shopId) || !ID.test(userId) || !BCRYPT.test(input.passwordHash ?? '')) throw new Error('Invalid merchant credential identity');
  const fingerprint = crypto.createHash('sha256').update(input.passwordHash).digest('hex');
  const filename = checkedPath('v1', userId, fingerprint + '.json');
  const aad = Buffer.from(`massajoy:merchant-credential:v1:${shopId}:${userId}:${fingerprint}`);
  return { shopId, userId, fingerprint, filename, aad };
}

function readMerchantCredential(input) {
  if (!BCRYPT.test(input.passwordHash ?? '')) return null;
  const entry = identity(input);
  if (!fs.existsSync(entry.filename)) return null;
  const document = JSON.parse(fs.readFileSync(entry.filename, 'utf8'));
  if (document.version !== 1 || document.shopId !== entry.shopId || document.userId !== entry.userId || document.hashFingerprint !== entry.fingerprint) throw new Error('Invalid merchant credential envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(false), Buffer.from(document.iv, 'base64'));
  decipher.setAAD(entry.aad);
  decipher.setAuthTag(Buffer.from(document.tag, 'base64'));
  const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(document.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  if (typeof value.password !== 'string' || Buffer.byteLength(value.password, 'utf8') < 6 || Buffer.byteLength(value.password, 'utf8') > 72 || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid merchant credential payload');
  return { password: value.password, updatedAt: value.updatedAt, operationId: typeof value.operationId === 'string' ? value.operationId : null };
}

function writeMerchantCredential(input) {
  const entry = identity(input);
  if (typeof input.password !== 'string' || Buffer.byteLength(input.password, 'utf8') < 6 || Buffer.byteLength(input.password, 'utf8') > 72 || /[\u0000\r\n]/u.test(input.password)) throw new Error('Invalid merchant credential password');
  prepareDirectory();
  const encryptionKey = key(true);
  const directory = checkedPath('v1', entry.userId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(entry.aad);
  const payload = { password: input.password, updatedAt: new Date().toISOString(), operationId: input.operationId ?? null };
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  writeNewFile(entry.filename, JSON.stringify({ version: 1, shopId: entry.shopId, userId: entry.userId, hashFingerprint: entry.fingerprint, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
  const saved = readMerchantCredential(input);
  if (!saved || saved.password !== input.password) throw new Error('Merchant credential vault write could not be verified');
  return { updatedAt: saved.updatedAt };
}

function randomMerchantPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (;;) {
    const value = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    if (/[A-Za-z]/.test(value) && /\d/.test(value)) return value;
  }
}

function receiptIdentity(operationId) {
  if (typeof operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(operationId)) throw new Error('Invalid merchant credential operation');
  return { filename: checkedPath('operations', operationId + '.json'), aad: Buffer.from('massajoy:merchant-credential-receipt:v1:' + operationId) };
}

function writeMerchantCredentialReceipt(input) {
  const entry = receiptIdentity(input.operationId);
  if (!ID.test(String(input.shopId)) || !ID.test(String(input.userId)) || !/^[a-f0-9]{64}$/.test(input.version ?? '')) throw new Error('Invalid merchant credential receipt');
  prepareDirectory();
  fs.mkdirSync(checkedPath('operations'), { recursive: true, mode: 0o700 });
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(true), iv);
  cipher.setAAD(entry.aad);
  const payload = JSON.stringify({ shopId: String(input.shopId), userId: String(input.userId), version: input.version });
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  writeNewFile(entry.filename, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
}

function readMerchantCredentialReceipt(operationId) {
  const entry = receiptIdentity(operationId);
  if (!fs.existsSync(entry.filename)) return null;
  const document = JSON.parse(fs.readFileSync(entry.filename, 'utf8'));
  if (document.version !== 1) throw new Error('Invalid merchant credential receipt');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(false), Buffer.from(document.iv, 'base64'));
  decipher.setAAD(entry.aad);
  decipher.setAuthTag(Buffer.from(document.tag, 'base64'));
  const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(document.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  if (!ID.test(value.shopId ?? '') || !ID.test(value.userId ?? '') || !/^[a-f0-9]{64}$/.test(value.version ?? '')) throw new Error('Invalid merchant credential receipt');
  return value;
}

module.exports = { randomMerchantPassword, readMerchantCredential, writeMerchantCredential, writeMerchantCredentialReceipt, readMerchantCredentialReceipt };
