import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const customer = path.join(project, 'customer-app');
const build = path.join(customer, 'build');
const local = path.join(project, '.local');
const current = path.join(build, 'web');
const next = path.join(build, 'web-next');
const previous = path.join(build, 'web-previous');
const receipt = path.join(local, 'customer-web-update.json');
const lockPath = path.join(local, 'customer-web-update.lock');
const managed = new Set([current, next, previous]);
const args = ['build', 'web', '--release', '--no-pub', '--base-href=/',
  '--dart-define=API_BASE_URL=/api/v1', '--output=build/web-next'];

async function entry(target) {
  try { return await fs.lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function directory(target, { create = false } = {}) {
  const relative = path.relative(project, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Refusing a directory outside this project.');
  }
  const stat = await entry(target);
  if (!stat && create) await fs.mkdir(target);
  else if (!stat) return false;
  else if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe directory: ${target}`);
  if (await fs.realpath(target) !== target) throw new Error(`Redirected directory: ${target}`);
  return true;
}

async function managedDirectory(target) {
  if (!managed.has(target) || path.dirname(target) !== build) throw new Error('Unknown output directory.');
  await directory(build);
  return directory(target);
}

async function removeOutput(target) {
  if (await managedDirectory(target)) await fs.rm(target, { recursive: true });
}

async function moveOutput(from, to) {
  if (!await managedDirectory(from)) throw new Error(`Missing output directory: ${from}`);
  if (await managedDirectory(to)) throw new Error(`Output directory already exists: ${to}`);
  await fs.rename(from, to);
}

async function executable(candidate) {
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  const stat = await fs.stat(resolved).catch(() => null);
  return stat?.isFile() ? resolved : null;
}

async function findFlutter() {
  const options = process.argv.slice(2).filter(option => option !== '--publish-only');
  if (options.some(option => !option.startsWith('--flutter=')) || options.length > 1) {
    throw new Error('Usage: npm run customer:update -- [--flutter=<path-to-flutter>] [--publish-only]');
  }
  if (options.length) {
    const found = await executable(options[0].slice('--flutter='.length));
    if (!found) throw new Error('The explicitly supplied Flutter executable does not exist.');
    return found;
  }
  const filename = process.platform === 'win32' ? 'flutter.bat' : 'flutter';
  const candidates = [];
  if (process.env.FLUTTER_ROOT) candidates.push(path.join(process.env.FLUTTER_ROOT, 'bin', filename));
  const configPath = path.join(customer, '.dart_tool', 'package_config.json');
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (config.flutterRoot) {
      const sdk = fileURLToPath(new URL(config.flutterRoot, pathToFileURL(configPath)));
      candidates.push(path.join(sdk, 'bin', filename));
    }
    const flutter = config.packages?.find(pkg => pkg.name === 'flutter');
    if (flutter?.rootUri) {
      const packageRoot = fileURLToPath(new URL(flutter.rootUri, pathToFileURL(configPath)));
      candidates.push(path.resolve(packageRoot, '..', '..', 'bin', filename));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Flutter package configuration unavailable; checking PATH.');
  }
  for (const folder of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const cleanFolder = folder.replace(/^"|"$/g, '');
    candidates.push(path.join(cleanFolder, filename));
    if (process.platform === 'win32') candidates.push(path.join(cleanFolder, 'flutter.exe'));
  }
  for (const candidate of candidates) {
    const found = await executable(candidate);
    if (found) return found;
  }
  throw new Error('Flutter not found. Supply --flutter=<path>, FLUTTER_ROOT, package_config.json, or PATH.');
}

function runFlutter(flutter) {
  const options = { cwd: customer, stdio: 'inherit', windowsHide: true };
  let command = flutter, commandArgs = args;
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(flutter)) {
    // cmd.exe is needed for .bat launch; quote every fixed argument and reject expansion characters.
    const quote = value => {
      if (/[\x00-\x1f"%!^&|<>]/.test(value)) throw new Error('Unsupported character in the Flutter executable path.');
      return `"${value}"`;
    };
    command = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
    commandArgs = ['/d', '/s', '/c', `"${[flutter, ...args].map(quote).join(' ')}"`];
    options.windowsVerbatimArguments = true;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() :
      reject(new Error(`Flutter build failed (${signal ?? code}). The current website was not replaced.`)));
  });
}

async function artifact(name, source = next) {
  const target = path.join(source, name);
  const stat = await entry(target);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error(`Missing build artifact: ${name}`);
  return { bytes: stat.size, sha256: createHash('sha256').update(await fs.readFile(target)).digest('hex') };
}

const busyDirectory = error => process.platform === 'win32' && ['EPERM', 'EBUSY'].includes(error.code);

async function copyWebsite(source, target) {
  if (!await managedDirectory(source)) throw new Error('Missing copy source.');
  await managedDirectory(target);
  const last = ['flutter_service_worker.js', 'main.dart.js', 'flutter_bootstrap.js', 'index.html'];
  await fs.cp(source, target, { recursive: true, force: true,
    filter: file => !last.some(name => file === path.join(source, name)) });
  // Copy referenced assets first, then entry points; keep the live directory itself intact.
  for (const name of last) {
    const sourceFile = path.join(source, name);
    if ((await entry(sourceFile))?.isFile()) await fs.copyFile(sourceFile, path.join(target, name));
  }
}

async function main() {
  const publishOnly = process.argv.slice(2).includes('--publish-only');
  if (publishOnly && process.argv.slice(2).some(option => option !== '--publish-only' && !option.startsWith('--flutter='))) {
    throw new Error('Unknown update option.');
  }
  await directory(customer);
  await directory(build, { create: true });
  await directory(local, { create: true });
  const flutter = publishOnly ? null : await findFlutter();
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another customer update is active, or its lock remains after interruption. Check .local/customer-web-update.lock.');
    throw error;
  }
  const receiptTemp = `${receipt}.${process.pid}.tmp`;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    // Recover a previously interrupted swap before preparing the next build.
    if (!await managedDirectory(current) && await managedDirectory(previous)) await moveOutput(previous, current);
    if (!publishOnly) {
      await removeOutput(next);
      console.log('Building customer website; the current website remains available.');
      await runFlutter(flutter);
    } else {
      console.log('Publishing existing build/web-next without rebuilding.');
    }
    if (!await managedDirectory(next)) throw new Error('Flutter did not produce build/web-next.');
    const artifacts = { 'index.html': await artifact('index.html'), 'main.dart.js': await artifact('main.dart.js') };
    const update = { completedAt: new Date().toISOString(), apiBaseUrl: '/api/v1', baseHref: '/', artifacts };
    await fs.writeFile(receiptTemp, JSON.stringify(update, null, 2) + '\n', { flag: 'wx' });
    const existingReceipt = await entry(receipt);
    if (existingReceipt && (existingReceipt.isSymbolicLink() || !existingReceipt.isFile())) throw new Error('Unsafe update receipt path.');
    await removeOutput(previous);
    const hadCurrent = await managedDirectory(current);
    let installed = false;
    let oldMoved = false;
    let copyMode = false;
    let backupComplete = false;
    try {
      try {
        if (hadCurrent) { await moveOutput(current, previous); oldMoved = true; }
        await moveOutput(next, current);
      } catch (error) {
        if (oldMoved) { await moveOutput(previous, current); oldMoved = false; }
        if (!hadCurrent || !busyDirectory(error)) throw error;
        copyMode = true;
        console.log('Windows is holding the web directory; backing up and publishing files in place.');
        await managedDirectory(current);
        await managedDirectory(previous);
        await fs.cp(current, previous, { recursive: true, force: true });
        backupComplete = true;
        await copyWebsite(next, current);
      }
      installed = true;
      for (const name of Object.keys(artifacts)) {
        const saved = await artifact(name, current);
        if (saved.sha256 !== artifacts[name].sha256) throw new Error(`Published artifact mismatch: ${name}`);
      }
      update.completedAt = new Date().toISOString();
      update.publishMode = copyMode ? 'copy' : 'rename';
      await fs.writeFile(receiptTemp, JSON.stringify(update, null, 2) + '\n');
      await fs.rename(receiptTemp, receipt);
    } catch (error) {
      try {
        if (copyMode) {
          if (backupComplete) await copyWebsite(previous, current);
        } else {
          if (installed) await moveOutput(current, next);
          if (oldMoved) await moveOutput(previous, current);
        }
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], 'Update failed; automatic restore also failed. Preserved output directories require attention.');
      }
      throw error;
    }
    console.log('Customer website updated. Preview reads build/web directly; refresh the page, no preview restart needed.');
    console.log('Update receipt: .local/customer-web-update.json');
  } finally {
    const temporary = await entry(receiptTemp);
    if (temporary?.isFile() && !temporary.isSymbolicLink()) await fs.unlink(receiptTemp);
    await lock.close();
    await fs.unlink(lockPath);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
