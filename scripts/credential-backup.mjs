import {promises as fs, constants, lstatSync, realpathSync} from 'node:fs';
import {resolve, relative, dirname, basename, join, parse, sep, isAbsolute} from 'node:path';
import {createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE = 128 * 1024 * 1024;
const MAX_FILES = 100000;
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[1-9]\d{0,18}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const snapshots = new WeakMap();
const sourceSnapshots = new WeakMap();
const openedSnapshots = new WeakMap();
export const CREDENTIAL_BACKUP_CODES = new Set([
  'INVALID_CREDENTIAL_BACKUP_CONFIG', 'UNSAFE_CREDENTIAL_BACKUP_PATH',
  'CREDENTIAL_VAULT_UNAVAILABLE', 'INVALID_CREDENTIAL_VAULT_FILE',
  'CREDENTIAL_VAULT_LIMIT_EXCEEDED', 'CREDENTIAL_VAULT_KEY_UNAVAILABLE',
  'CREDENTIAL_RECOVERY_KEY_UNAVAILABLE', 'CREDENTIAL_RECOVERY_KEY_NOT_INDEPENDENT',
  'CREDENTIAL_BACKUP_SOURCE_CHANGED',
  'CREDENTIAL_DATABASE_REFERENCE_MISSING',
  'INVALID_CREDENTIAL_VAULT_ENVELOPE', 'CREDENTIAL_VAULT_DECRYPTION_FAILED',
  'INVALID_CREDENTIAL_ARCHIVE', 'CREDENTIAL_ARCHIVE_DIGEST_MISMATCH',
  'CREDENTIAL_ARCHIVE_DECRYPTION_FAILED', 'CREDENTIAL_TARGET_ALREADY_EXISTS',
  'CREDENTIAL_TARGET_PARENT_REQUIRED', 'CREDENTIAL_TARGET_PUBLISH_FAILED',
  'CREDENTIAL_TARGET_PERMISSION_FAILED', 'CREDENTIAL_BACKUP_OPERATION_FAILED',
]);
const fail = code => { throw Error(code); };
const fixed = error => CREDENTIAL_BACKUP_CODES.has(error?.message) ? error : Error('CREDENTIAL_BACKUP_OPERATION_FAILED');
const exactKeys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const digest = data => createHash('sha256').update(data).digest('hex');
const folded = value => process.platform === 'win32' ? value.toLowerCase() : value;
const same = (a, b) => folded(resolve(a)) === folded(resolve(b));
const contains = (parent, child) => { const part = relative(folded(resolve(parent)), folded(resolve(child))); return part === '' || !part.startsWith('..' + sep) && part !== '..' && !isAbsolute(part); };
const overlaps = (a, b) => contains(a, b) || contains(b, a);

function noLinks(path, allowMissing = false) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) return absolute;
      fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
    }
    if (stat.isSymbolicLink()) fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
    try { if (!same(realpathSync(current), current)) fail('UNSAFE_CREDENTIAL_BACKUP_PATH'); }
    catch { fail('UNSAFE_CREDENTIAL_BACKUP_PATH'); }
  }
  return absolute;
}
function local(path, root, allowMissing = false) {
  if (typeof path !== 'string' || !path || path.includes('\0')) fail('INVALID_CREDENTIAL_BACKUP_CONFIG');
  const absolute = resolve(root, path), localRoot = join(resolve(root), '.local');
  if (same(absolute, localRoot) || !contains(localRoot, absolute)) fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
  if (process.platform === 'win32' && relative(localRoot, absolute).split(sep).some(part => /[:. ]$/u.test(part)
    || /[:*?"<>|\x00-\x1f]/u.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(part))) fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
  return noLinks(absolute, allowMissing);
}
function baseVaultConfig(config, root) {
  if (!exactKeys(config, ['directory', 'recoveryKeyFile'], ['sourceKeyFile'])) fail('INVALID_CREDENTIAL_BACKUP_CONFIG');
  const directory = local(config.directory, root, true), recoveryKeyFile = local(config.recoveryKeyFile, root, true);
  const sourceKeyFile = config.sourceKeyFile === undefined ? join(directory, 'key.bin') : local(config.sourceKeyFile, root, true);
  const backups = join(resolve(root), '.local', 'backups');
  if (overlaps(directory, backups) || overlaps(directory, recoveryKeyFile) || overlaps(backups, recoveryKeyFile)
    || overlaps(backups, sourceKeyFile) || overlaps(recoveryKeyFile, sourceKeyFile)
    || config.sourceKeyFile !== undefined && overlaps(directory, sourceKeyFile) && !same(sourceKeyFile, join(directory, 'key.bin'))) fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
  return {directory, recoveryKeyFile, sourceKeyFile};
}
export function validateCredentialVaultConfig(config, root) { baseVaultConfig(config, root); return config; }

async function readRegular(path, max, code) {
  try {
    noLinks(path, true);
    if (!lstatSync(path).isFile()) fail(code);
    const file = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > max || stat.size < 1) fail(code);
      const data = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < data.length) {
        const {bytesRead} = await file.read(data, offset, data.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== stat.size) { data.fill(0); fail(code); }
      return data.subarray(0, offset);
    } finally { await file.close(); }
  } catch (error) { if (CREDENTIAL_BACKUP_CODES.has(error?.message)) throw error; fail(code); }
}
async function readKey(path, recovery = false) {
  const code = recovery ? 'CREDENTIAL_RECOVERY_KEY_UNAVAILABLE' : 'CREDENTIAL_VAULT_KEY_UNAVAILABLE';
  const key = await readRegular(path, 32, code);
  if (key.length !== 32) { key.fill(0); fail(code); }
  return key;
}
function base64(value, bytes, max = 65536) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(max / 3) * 4) fail('INVALID_CREDENTIAL_VAULT_ENVELOPE');
  const data = Buffer.from(value, 'base64');
  if (data.toString('base64') !== value || bytes !== undefined && data.length !== bytes || data.length > max) fail('INVALID_CREDENTIAL_VAULT_ENVELOPE');
  return data;
}
function decipherBytes(key, iv, tag, associatedData, ciphertext) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(associatedData); decipher.setAuthTag(tag);
  const pending = decipher.update(ciphertext);
  try {
    const tail = decipher.final();
    if (!tail.length) return pending;
    const result = Buffer.concat([pending, tail]);
    pending.fill(0); tail.fill(0);
    return result;
  } catch (error) { pending.fill(0); throw error; }
}
function decryptEnvelope(document, key, aad) {
  try {
    const clear = decipherBytes(key, base64(document.iv, 12), base64(document.tag, 16), Buffer.from(aad), base64(document.ciphertext));
    try { return JSON.parse(clear.toString('utf8')); } finally { clear.fill(0); }
  } catch (error) {
    if (error?.message === 'INVALID_CREDENTIAL_VAULT_ENVELOPE') throw error;
    fail('CREDENTIAL_VAULT_DECRYPTION_FAILED');
  }
}
function checkEnvelope(name, data, key) {
  let document;
  try { document = JSON.parse(data.toString('utf8')); } catch { fail('INVALID_CREDENTIAL_VAULT_ENVELOPE'); }
  if (name.startsWith('v1/')) {
    const [, userId, filename] = name.split('/'), fingerprint = filename.slice(0, -5);
    if (!exactKeys(document, ['version', 'shopId', 'userId', 'hashFingerprint', 'iv', 'tag', 'ciphertext']) || document.version !== 1
      || typeof document.shopId !== 'string' || !ID.test(document.shopId) || document.userId !== userId || document.hashFingerprint !== fingerprint) fail('INVALID_CREDENTIAL_VAULT_ENVELOPE');
    const value = decryptEnvelope(document, key, `massajoy:merchant-credential:v1:${document.shopId}:${userId}:${fingerprint}`);
    if (!exactKeys(value, ['password', 'updatedAt'], ['operationId']) || typeof value.password !== 'string'
      || Buffer.byteLength(value.password) < 6 || Buffer.byteLength(value.password) > 72 || /[\0\r\n]/u.test(value.password)
      || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
      || value.operationId !== undefined && value.operationId !== null && (typeof value.operationId !== 'string' || !UUID.test(value.operationId))) fail('INVALID_CREDENTIAL_VAULT_ENVELOPE');
    return;
  }
  const operationId = basename(name, '.json');
  if (!exactKeys(document, ['version', 'iv', 'tag', 'ciphertext']) || document.version !== 1) fail('INVALID_CREDENTIAL_VAULT_ENVELOPE');
  const value = decryptEnvelope(document, key, 'massajoy:merchant-credential-receipt:v1:' + operationId);
  if (!exactKeys(value, ['shopId', 'userId', 'version']) || typeof value.shopId !== 'string' || !ID.test(value.shopId)
    || typeof value.userId !== 'string' || !ID.test(value.userId) || typeof value.version !== 'string' || !HEX.test(value.version)) fail('INVALID_CREDENTIAL_VAULT_ENVELOPE');
}
function fileName(name) {
  return typeof name === 'string' && (name === 'key.bin' || /^v1\/[1-9]\d{0,18}\/[a-f0-9]{64}\.json$/.test(name)
    || /^operations\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(name));
}
function snapshotFromFiles(files, source) {
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) fail('CREDENTIAL_VAULT_LIMIT_EXCEEDED');
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  let bytes = 0;
  for (let index = 0; index < sorted.length; index++) {
    const row = sorted[index];
    if (!exactKeys(row, ['path', 'data']) || !fileName(row.path) || !Buffer.isBuffer(row.data)
      || index > 0 && row.path === sorted[index - 1].path) fail('INVALID_CREDENTIAL_VAULT_FILE');
    bytes += row.data.length;
    if (row.data.length < 1 || row.data.length > (row.path === 'key.bin' ? 32 : 65536) || bytes > MAX_BYTES) fail('CREDENTIAL_VAULT_LIMIT_EXCEEDED');
  }
  const key = sorted.find(row => row.path === 'key.bin')?.data;
  if (!key || key.length !== 32) fail('CREDENTIAL_VAULT_KEY_UNAVAILABLE');
  for (const row of sorted) if (row.path !== 'key.bin') checkEnvelope(row.path, row.data, key);
  const vaultDigest = digest(JSON.stringify(sorted.map(row => [row.path, row.data.length, digest(row.data)])));
  const result = {digest: vaultDigest, filesCount: sorted.length};
  if (source) {
    Object.defineProperty(result, 'sourceDigest', {value: digest(JSON.stringify([vaultDigest, source]))});
    sourceSnapshots.set(result, source);
  }
  Object.freeze(result);
  snapshots.set(result, sorted);
  return result;
}
async function inventory(directory, sourceKeyFile, source) {
  noLinks(directory, true);
  try { if (!(await fs.lstat(directory)).isDirectory()) fail('CREDENTIAL_VAULT_UNAVAILABLE'); }
  catch { fail('CREDENTIAL_VAULT_UNAVAILABLE'); }
  const files = [], key = await readKey(sourceKeyFile);
  let bytes = key.length, entries = 0;
  async function visit(folder, prefix = '') {
    for await (const entry of await fs.opendir(folder)) {
      if (++entries > MAX_FILES * 2 + 2) fail('CREDENTIAL_VAULT_LIMIT_EXCEEDED');
      const {name} = entry;
      const relativeName = prefix + name, path = join(folder, name);
      noLinks(path);
      const stat = await fs.lstat(path);
      if (stat.isDirectory()) {
        if (!(relativeName === 'v1' || relativeName === 'operations' || /^v1\/[1-9]\d{0,18}$/.test(relativeName))) fail('INVALID_CREDENTIAL_VAULT_FILE');
        await visit(path, relativeName + '/');
      } else {
        if (!stat.isFile() || !fileName(relativeName)) fail('INVALID_CREDENTIAL_VAULT_FILE');
        if (relativeName === 'key.bin') {
          const diskKey = await readKey(path);
          try {
            if (same(path, sourceKeyFile) && !timingSafeEqual(diskKey, key)) fail('CREDENTIAL_BACKUP_SOURCE_CHANGED');
            if (source) source.diskKeyDigest = digest(diskKey);
          } finally { diskKey.fill(0); }
          continue;
        }
        if (files.length + 2 > MAX_FILES || bytes + stat.size > MAX_BYTES) fail('CREDENTIAL_VAULT_LIMIT_EXCEEDED');
        const data = await readRegular(path, 65536, 'INVALID_CREDENTIAL_VAULT_FILE');
        if ((bytes += data.length) > MAX_BYTES) fail('CREDENTIAL_VAULT_LIMIT_EXCEEDED');
        files.push({path: relativeName, data});
      }
    }
  }
  try {
    await visit(directory);
    if (same(join(directory, 'key.bin'), sourceKeyFile) && source && !source.diskKeyDigest) fail('CREDENTIAL_BACKUP_SOURCE_CHANGED');
    if (source && source.recoveryKeyDigest === digest(key)) fail('CREDENTIAL_RECOVERY_KEY_NOT_INDEPENDENT');
    files.push({path: 'key.bin', data: key});
    return snapshotFromFiles(files, source);
  } catch (error) { key.fill(0); throw error; }
}
export async function captureCredentialVault(config, root) {
  let recovery;
  try {
    const paths = baseVaultConfig(config, root);
    recovery = await readKey(paths.recoveryKeyFile, true);
    return await inventory(paths.directory, paths.sourceKeyFile, {...paths, recoveryKeyDigest: digest(recovery), diskKeyDigest: null});
  } catch (error) { throw fixed(error); }
  finally { recovery?.fill(0); }
}

export function verifyCredentialVaultReferences(snapshot, references) {
  const files = snapshots.get(snapshot);
  if (!files || !exactKeys(references, ['operations']) || !Array.isArray(references.operations)) fail('CREDENTIAL_DATABASE_REFERENCE_MISSING');
  const key = files.find(row => row.path === 'key.bin')?.data;
  const receipts = new Map(files.filter(row => row.path.startsWith('operations/')).map(row => [basename(row.path, '.json'), row.data]));
  const seen = new Set();
  for (const operation of references.operations) {
    if (!exactKeys(operation, ['id', 'shopId', 'userId']) || typeof operation.id !== 'string' || !UUID.test(operation.id)
      || typeof operation.shopId !== 'string' || !ID.test(operation.shopId) || typeof operation.userId !== 'string'
      || !ID.test(operation.userId) || seen.has(operation.id)) fail('CREDENTIAL_DATABASE_REFERENCE_MISSING');
    seen.add(operation.id);
    const envelope = receipts.get(operation.id);
    if (!envelope) fail('CREDENTIAL_DATABASE_REFERENCE_MISSING');
    try {
      const receipt = decryptEnvelope(JSON.parse(envelope.toString('utf8')), key, 'massajoy:merchant-credential-receipt:v1:' + operation.id);
      if (receipt.shopId !== operation.shopId || receipt.userId !== operation.userId) fail('CREDENTIAL_DATABASE_REFERENCE_MISSING');
    } catch { fail('CREDENTIAL_DATABASE_REFERENCE_MISSING'); }
  }
  return true;
}

const aad = databaseDigest => Buffer.from('massajoy:credential-backup:v1:' + databaseDigest);
function descriptorCheck(descriptor) {
  if (!exactKeys(descriptor, ['version', 'format', 'databaseDigest', 'filesCount', 'archive']) || descriptor.version !== 1
    || descriptor.format !== 'aes-256-gcm-vault' || typeof descriptor.databaseDigest !== 'string' || !HEX.test(descriptor.databaseDigest) || !Number.isSafeInteger(descriptor.filesCount)
    || descriptor.filesCount < 1 || descriptor.filesCount > MAX_FILES || !exactKeys(descriptor.archive, ['sha256', 'bytes'])
    || typeof descriptor.archive.sha256 !== 'string' || !HEX.test(descriptor.archive.sha256) || !Number.isSafeInteger(descriptor.archive.bytes) || descriptor.archive.bytes < 1
    || descriptor.archive.bytes > MAX_ARCHIVE) fail('INVALID_CREDENTIAL_ARCHIVE');
}
export async function writeCredentialArchive(snapshot, path, config, root, databaseDigest) {
  let recovery, clear;
  try {
    const paths = baseVaultConfig(config, root), output = local(path, root, true), files = snapshots.get(snapshot), source = sourceSnapshots.get(snapshot);
    if (!files || !source || typeof databaseDigest !== 'string' || !HEX.test(databaseDigest) || overlaps(paths.directory, output)
      || overlaps(output, paths.recoveryKeyFile) || overlaps(output, paths.sourceKeyFile)) fail('INVALID_CREDENTIAL_ARCHIVE');
    if (Object.keys(paths).some(key => !same(paths[key], source[key]))) fail('CREDENTIAL_BACKUP_SOURCE_CHANGED');
    noLinks(dirname(output));
    recovery = await readKey(paths.recoveryKeyFile, true);
    if (digest(recovery) !== source.recoveryKeyDigest) fail('CREDENTIAL_BACKUP_SOURCE_CHANGED');
    clear = Buffer.from(JSON.stringify({version: 1, databaseDigest, files: files.map(row => ({path: row.path, data: row.data.toString('base64')}))}));
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', recovery, iv); cipher.setAAD(aad(databaseDigest));
    const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
    const document = Buffer.from(JSON.stringify({version: 1, format: 'aes-256-gcm-vault', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')}));
    if (document.length > MAX_ARCHIVE) fail('CREDENTIAL_VAULT_LIMIT_EXCEEDED');
    await fs.writeFile(output, document, {flag: 'wx', mode: 0o600});
    return {version: 1, format: 'aes-256-gcm-vault', databaseDigest, filesCount: snapshot.filesCount, archive: {sha256: digest(document), bytes: document.length}};
  } catch (error) { throw fixed(error); }
  finally { recovery?.fill(0); clear?.fill(0); }
}
async function archiveDocument(path, descriptor) {
  descriptorCheck(descriptor);
  const bytes = await readRegular(path, MAX_ARCHIVE, 'INVALID_CREDENTIAL_ARCHIVE');
  if (bytes.length !== descriptor.archive.bytes || digest(bytes) !== descriptor.archive.sha256) fail('CREDENTIAL_ARCHIVE_DIGEST_MISMATCH');
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_CREDENTIAL_ARCHIVE'); }
  try {
    if (!exactKeys(document, ['version', 'format', 'iv', 'tag', 'ciphertext']) || document.version !== 1 || document.format !== 'aes-256-gcm-vault') fail('INVALID_CREDENTIAL_ARCHIVE');
    return {iv: base64(document.iv, 12), tag: base64(document.tag, 16), ciphertext: base64(document.ciphertext, undefined, MAX_ARCHIVE)};
  } catch { fail('INVALID_CREDENTIAL_ARCHIVE'); }
}
export async function validateCredentialArchive(path, descriptor) { try { await archiveDocument(path, descriptor); return {filesCount: descriptor.filesCount}; } catch (error) { throw fixed(error); } }
function targetConfig(target, root) {
  if (!exactKeys(target, ['schemaVersion', 'directory', 'recoveryKeyFile']) || target.schemaVersion !== 1) fail('INVALID_CREDENTIAL_BACKUP_CONFIG');
  const directory = local(target.directory, root, true), recoveryKeyFile = local(target.recoveryKeyFile, root, true);
  if (overlaps(directory, join(resolve(root), '.local', 'store-account-credentials', 'vault'))
    || overlaps(directory, join(resolve(root), '.local', 'backups')) || overlaps(directory, recoveryKeyFile)
    || overlaps(join(resolve(root), '.local', 'backups'), recoveryKeyFile)) fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
  return {directory, recoveryKeyFile};
}
export function validateCredentialTargetConfig(target, root) { targetConfig(target, root); return target; }
export async function openCredentialArchive(path, descriptor, credentialTarget, root) {
  let key, clear, vaultKey, opened = false;
  try {
    const target = targetConfig(credentialTarget, root);
    if (overlaps(target.directory, path) || overlaps(target.recoveryKeyFile, path)) fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
    const document = await archiveDocument(path, descriptor);
    key = await readKey(target.recoveryKeyFile, true);
    try {
      clear = decipherBytes(key, document.iv, document.tag, aad(descriptor.databaseDigest), document.ciphertext);
    } catch { fail('CREDENTIAL_ARCHIVE_DECRYPTION_FAILED'); }
    let value;
    try { value = JSON.parse(clear.toString('utf8')); } catch { fail('INVALID_CREDENTIAL_ARCHIVE'); }
    if (!exactKeys(value, ['version', 'databaseDigest', 'files']) || value.version !== 1 || value.databaseDigest !== descriptor.databaseDigest
      || !Array.isArray(value.files) || value.files.length !== descriptor.filesCount) fail('INVALID_CREDENTIAL_ARCHIVE');
    let bytes = 0;
    const files = value.files.map(row => {
      if (!exactKeys(row, ['path', 'data']) || !fileName(row.path)) fail('INVALID_CREDENTIAL_ARCHIVE');
      const data = base64(row.data, undefined, row.path === 'key.bin' ? 32 : 65536);
      if (row.path === 'key.bin') {
        if (vaultKey) { data.fill(0); fail('INVALID_CREDENTIAL_VAULT_FILE'); }
        vaultKey = data;
      }
      if ((bytes += data.length) > MAX_BYTES) fail('CREDENTIAL_VAULT_LIMIT_EXCEEDED');
      return {path: row.path, data};
    });
    if (vaultKey?.length === 32 && timingSafeEqual(key, vaultKey)) fail('CREDENTIAL_RECOVERY_KEY_NOT_INDEPENDENT');
    const snapshot = snapshotFromFiles(files);
    openedSnapshots.set(snapshot, {...target, recoveryKeyDigest: digest(key)});
    opened = true;
    return snapshot;
  } catch (error) { throw fixed(error); }
  finally { key?.fill(0); clear?.fill(0); if (!opened) vaultKey?.fill(0); }
}
export async function prepareCredentialTarget(target, root, sourceConfig, bundlePath) {
  try {
    const prepared = targetConfig(target, root), source = sourceConfig ? baseVaultConfig(sourceConfig, root) : null;
    for (const forbidden of [source?.directory, source?.sourceKeyFile, source?.recoveryKeyFile, bundlePath && resolve(root, bundlePath)].filter(Boolean))
      if (overlaps(prepared.directory, forbidden)) fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
    try { await fs.lstat(prepared.directory); fail('CREDENTIAL_TARGET_ALREADY_EXISTS'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    noLinks(dirname(prepared.directory), true);
    try { if (!(await fs.lstat(dirname(prepared.directory))).isDirectory()) fail('CREDENTIAL_TARGET_PARENT_REQUIRED'); }
    catch { fail('CREDENTIAL_TARGET_PARENT_REQUIRED'); }
    const recovery = await readKey(prepared.recoveryKeyFile, true);
    recovery.fill(0);
    return {directory: prepared.directory};
  } catch (error) { throw fixed(error); }
}
function protectDirectory(directory) {
  try {
    if (process.platform === 'win32') {
      const user = execFileSync('whoami.exe', [], {encoding: 'utf8', windowsHide: true}).trim();
      if (!user || /[\r\n]/.test(user)) fail('CREDENTIAL_TARGET_PERMISSION_FAILED');
      execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`], {stdio: 'ignore', windowsHide: true});
    }
  } catch { fail('CREDENTIAL_TARGET_PERMISSION_FAILED'); }
}
export async function restoreCredentialVault(snapshot, target, root) {
  let staging, owned = false;
  try {
    const files = snapshots.get(snapshot), opened = openedSnapshots.get(snapshot);
    if (!files || !opened) fail('INVALID_CREDENTIAL_ARCHIVE');
    const paths = targetConfig(target, root), {directory} = paths;
    if (!same(directory, opened.directory) || !same(paths.recoveryKeyFile, opened.recoveryKeyFile)) fail('UNSAFE_CREDENTIAL_BACKUP_PATH');
    async function checkTarget() {
      await prepareCredentialTarget(target, root);
      const key = await readKey(paths.recoveryKeyFile, true);
      try { if (digest(key) !== opened.recoveryKeyDigest) fail('CREDENTIAL_ARCHIVE_DECRYPTION_FAILED'); }
      finally { key.fill(0); }
    }
    await checkTarget();
    staging = directory + '.partial-' + randomBytes(8).toString('hex');
    noLinks(staging, true);
    await fs.mkdir(staging, {recursive: false, mode: 0o700}); owned = true;
    protectDirectory(staging);
    for (const row of files) {
      const destination = join(staging, ...row.path.split('/'));
      await fs.mkdir(dirname(destination), {recursive: true, mode: 0o700});
      await fs.writeFile(destination, row.data, {flag: 'wx', mode: 0o600});
    }
    const actual = await inventory(staging, join(staging, 'key.bin'));
    snapshots.get(actual).find(row => row.path === 'key.bin').data.fill(0);
    if (actual.digest !== snapshot.digest) fail('INVALID_CREDENTIAL_ARCHIVE');
    await checkTarget();
    try { await fs.rename(staging, directory); } catch { fail('CREDENTIAL_TARGET_PUBLISH_FAILED'); }
    owned = false;
    return {filesCount: snapshot.filesCount, digest: snapshot.digest};
  } catch (error) { throw fixed(error); }
  finally {
    if (owned && staging) {
      try {
        const location = local(staging, root, true);
        if (same(location, staging)) await fs.rm(location, {recursive: true, force: true});
      } catch { fail('CREDENTIAL_TARGET_PUBLISH_FAILED'); }
    }
  }
}
