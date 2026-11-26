import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const trees = ['src', 'backend', 'merchant-web', 'customer-app', 'deploy', 'scripts', '.github', 'assets'];
const rootFiles = ['.gitignore', '.dockerignore', '.env.release.example', 'backend/.env.example', 'compose.yaml', 'compose.local.yaml', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'data/massajoy1-sample.json', 'data/exports/massajoy1-public-sample-2026-10-28.json'];
const required = [...rootFiles, '.github/workflows/verify.yml', 'backend/package.json', 'backend/package-lock.json', 'backend/prisma/schema.prisma', 'backend/src/main.ts', 'merchant-web/package.json', 'merchant-web/package-lock.json', 'merchant-web/src/main.tsx', 'customer-app/pubspec.yaml', 'customer-app/pubspec.lock', 'customer-app/lib/main.dart', 'deploy/Dockerfile.api', 'deploy/Dockerfile.web', 'deploy/Caddyfile'];
const excludedDirectories = new Set(['.git', 'node_modules', 'dist', 'build', '.dart_tool', '.local', '.tools', 'coverage', '.gradle', '.pub-cache', '.aistudio']);
const permittedName = name => !excludedDirectories.has(name) && !/^\.env(?:\.|$)|^\.flutter-plugins|\.log$|\.private\.|firebase-adminsdk|service-account|\.(?:pem|key|p12|pfx|sqlite|sqlite3|db)$/i.test(name);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const posix = relative => relative.split(path.sep).join('/');
const inside = (parent, child) => child !== parent && !path.relative(parent, child).startsWith('..' + path.sep) && path.relative(parent, child) !== '..' && !path.isAbsolute(path.relative(parent, child));

export function isReleaseInput(relative) {
  // These exact public templates/fixtures are CI inputs; other .env/import files remain excluded.
  if (rootFiles.includes(relative)) return true;
  const parts = relative.split('/');
  return trees.includes(parts[0]) && parts.every(permittedName);
}

export async function releaseInventory(root) {
  root = path.resolve(root);
  const files = {};
  async function collect(relative) {
    const absolute = path.resolve(root, relative);
    if (!inside(root, absolute)) throw new Error('SOURCE_PATH_OUTSIDE_ROOT');
    let info;
    try { info = await lstat(absolute); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REQUIRES_REVIEW');
    if (info.isDirectory()) {
      for (const entry of (await readdir(absolute)).sort()) {
        const child = path.posix.join(relative, entry);
        if (permittedName(entry) || child === 'backend/.env.example') await collect(child);
      }
    } else if (info.isFile()) {
      const bytes = await readFile(absolute);
      files[relative] = { bytes: bytes.length, sha256: digest(bytes) };
    } else throw new Error('SOURCE_SPECIAL_FILE_REQUIRES_REVIEW');
  }
  for (const entry of [...rootFiles, ...trees].sort()) await collect(entry);
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
  return { files: sorted, fileCount: Object.keys(sorted).length, sha256: digest(Object.entries(sorted).map(([file, value]) => `${file}\0${value.sha256}\n`).join('')), missingRequired: required.filter(file => !Object.hasOwn(sorted, file)) };
}

function git(root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
  env.GIT_OPTIONAL_LOCKS = '0';
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('GIT_SOURCE_CHECK_FAILED');
  return result.stdout;
}

export async function checkReleaseSource(root) {
  root = path.resolve(root);
  const gitRoot = path.resolve(git(root, ['rev-parse', '--show-toplevel']).trim());
  if ((process.platform === 'win32' ? gitRoot.toLowerCase() !== root.toLowerCase() : gitRoot !== root)) throw new Error('EXPECTED_EXACT_GIT_ROOT');
  const commit = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
  const inventory = await releaseInventory(root);
  const records = git(root, ['ls-files', '-v', '-z']).split('\0').filter(Boolean);
  const tracked = new Set(records.map(record => posix(record.slice(2))));
  const suppressed = records.filter(record => /[a-zS]/.test(record[0])).map(record => posix(record.slice(2))).filter(isReleaseInput).sort();
  const changed = git(root, ['diff', '--no-ext-diff', 'HEAD', '--name-only', '-z']).split('\0').filter(Boolean).map(posix).filter(isReleaseInput).sort();
  const untracked = Object.keys(inventory.files).filter(file => !tracked.has(file));
  const deleted = [...tracked].filter(file => isReleaseInput(file) && !Object.hasOwn(inventory.files, file)).sort();
  const passed = !inventory.missingRequired.length && !untracked.length && !changed.length && !deleted.length && !suppressed.length;
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), scope: 'Offline release-source tracking and clean-checkout checks only; no commit, staging, push, build, database or service action.', status: passed ? 'pass_for_release_source_only' : 'blocked', passed, deploymentReady: false, commit, source: inventory, untrackedReleaseFiles: untracked, changedReleaseFiles: changed, deletedReleaseFiles: deleted, suppressedIndexReleaseFiles: suppressed, counts: { untracked: untracked.length, changed: changed.length, deleted: deleted.length, suppressed: suppressed.length, missingRequired: inventory.missingRequired.length }, excluded: ['environment and private credential files except the two exact approved public environment templates', 'dependency/build/local/cache directories', 'databases', 'imported data except the two explicit public compatibility fixtures'], unverified: ['Actual CI execution', 'Runtime and business acceptance', 'Production approval'] };
}

export async function main(args) {
  let reportFile;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--report') throw new Error('INVALID_ARGUMENTS');
    reportFile = path.resolve(args[1]);
    if (!inside(path.resolve('.local'), reportFile)) throw new Error('REPORT_MUST_BE_INSIDE_LOCAL');
  }
  let result;
  try { result = await checkReleaseSource(process.cwd()); }
  catch (error) { result = { schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'error', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'RELEASE_SOURCE_CHECK_FAILED', passed: false, deploymentReady: false }; }
  if (reportFile) { await mkdir(path.dirname(reportFile), { recursive: true }); await writeFile(reportFile, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify({ status: result.status, code: result.code, commit: result.commit, sourceSha256: result.source?.sha256, files: result.source?.fileCount, counts: result.counts, deploymentReady: false, ...(reportFile ? { report: path.relative(process.cwd(), reportFile) } : {}) }));
  return result.passed ? 0 : result.status === 'error' ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)); } catch (error) { const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'RELEASE_SOURCE_CHECK_FAILED'; console.error(JSON.stringify({ status: 'error', code })); process.exitCode = 1; }
}
