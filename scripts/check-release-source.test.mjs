import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkReleaseSource, isReleaseInput, releaseInventory } from './check-release-source.mjs';

function git(root, args) { const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Local fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-C', root, ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout; }
async function fixture(action) {
  const root = await mkdtemp(path.join(tmpdir(), 'mj2-source-test-'));
  try {
    git(root, ['init', '--quiet']);
    const probe = await releaseInventory(root);
    for (const relative of probe.missingRequired) { await mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await writeFile(path.join(root, relative), relative + '\n'); }
    await writeFile(path.join(root, '.gitignore'), '.local/\nnode_modules/\n.env*\n!.env.release.example\n!backend/.env.example\n');
    git(root, ['add', '--all']); git(root, ['commit', '--quiet', '-m', 'Synthetic release source fixture']);
    return await action(root);
  } finally { assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true }); }
}

test('a real clean checkout passes only the source gate and has stable byte hashes', async () => fixture(async root => {
  const before = await readFile(path.join(root, '.git', 'index'));
  const a = await checkReleaseSource(root), b = await checkReleaseSource(root);
  assert.equal(a.passed, true); assert.equal(a.deploymentReady, false); assert.equal(a.source.sha256, b.source.sha256);
  assert.deepEqual(await readFile(path.join(root, '.git', 'index')), before);
}));
test('untracked product source is blocked without staging or exposing local secrets', async () => fixture(async root => {
  await writeFile(path.join(root, 'backend', 'src', 'untracked.ts'), 'export const value = 1;');
  await writeFile(path.join(root, '.env.production'), 'PASSWORD=private-fixture-marker');
  await mkdir(path.join(root, 'backend', '.local'), { recursive: true }); await writeFile(path.join(root, 'backend', '.local', 'secret.txt'), 'private-fixture-marker');
  const result = await checkReleaseSource(root); assert.equal(result.passed, false); assert.deepEqual(result.untrackedReleaseFiles, ['backend/src/untracked.ts']); assert.ok(!JSON.stringify(result).includes('private-fixture-marker'));
}));
test('both unstaged and staged product changes block the gate', async () => fixture(async root => {
  const file = path.join(root, 'backend', 'src', 'main.ts'); await writeFile(file, 'changed\n');
  assert.ok((await checkReleaseSource(root)).changedReleaseFiles.includes('backend/src/main.ts'));
  git(root, ['add', '--', 'backend/src/main.ts']); assert.ok((await checkReleaseSource(root)).changedReleaseFiles.includes('backend/src/main.ts'));
}));
test('deleted required input is distinguished from a clean source tree', async () => fixture(async root => {
  await rm(path.join(root, 'customer-app', 'pubspec.lock')); const r = await checkReleaseSource(root);
  assert.equal(r.passed, false); assert.deepEqual(r.deletedReleaseFiles, ['customer-app/pubspec.lock']); assert.ok(r.source.missingRequired.includes('customer-app/pubspec.lock'));
}));
test('a directory nested in another repository cannot pretend to be an independent checkout', async () => fixture(async root => {
  const nested = path.join(root, 'nested'); await mkdir(nested); await assert.rejects(checkReleaseSource(nested), /EXPECTED_EXACT_GIT_ROOT/);
}));
test('credential paths, artifacts and unrelated imports are excluded; migrations and source remain', () => {
  for (const p of ['backend/.env.production', 'backend/.env.local', 'customer-app/build/main.dart.js', 'backend/src/key.private.json', 'backend/a.pem', 'backend/cache.db', 'data/store-export.json', '.local/main.ts', 'backend/node_modules/package/index.js']) assert.equal(isReleaseInput(p), false, p);
  for (const p of ['backend/prisma/migrations/initial/migration.sql', 'src/components/StoreManagement.tsx', 'scripts/check-release-source.mjs', '.github/workflows/verify.yml', 'compose.local.yaml', '.env.release.example', 'backend/.env.example', 'data/exports/massajoy1-public-sample-2026-10-28.json']) assert.equal(isReleaseInput(p), true, p);
});
test('the exact public release template remains tracked and changes or deletion block the gate', async () => fixture(async root => {
  const file = path.join(root, '.env.release.example');
  await writeFile(file, 'PUBLIC_TEMPLATE_CHANGE\n');
  let result = await checkReleaseSource(root);
  assert.equal(result.passed, false); assert.ok(result.changedReleaseFiles.includes('.env.release.example'));
  await rm(file); result = await checkReleaseSource(root);
  assert.equal(result.passed, false); assert.ok(result.deletedReleaseFiles.includes('.env.release.example')); assert.ok(result.source.missingRequired.includes('.env.release.example'));
}));
test('the exact backend developer template is inventoried and changes or deletion block the gate', async () => fixture(async root => {
  const file = path.join(root, 'backend', '.env.example');
  await writeFile(file, 'DATABASE_URL=mysql://local-placeholder\n');
  let result = await checkReleaseSource(root);
  assert.equal(result.passed, false); assert.ok(result.changedReleaseFiles.includes('backend/.env.example'));
  await rm(file); result = await checkReleaseSource(root);
  assert.equal(result.passed, false); assert.ok(result.deletedReleaseFiles.includes('backend/.env.example')); assert.ok(result.source.missingRequired.includes('backend/.env.example'));
}));
test('untracked required public fixtures cannot pass merely because all app source is tracked', async () => fixture(async root => {
  const relative = 'data/exports/massajoy1-public-sample-2026-10-28.json';
  git(root, ['rm', '--cached', '--', relative]); git(root, ['commit', '--quiet', '-m', 'Drop fixture tracking only']);
  const result = await checkReleaseSource(root);
  assert.equal(result.passed, false); assert.deepEqual(result.untrackedReleaseFiles, [relative]);
}));
test('inherited Git redirection cannot redirect the source check outside its requested checkout', async () => fixture(async root => {
  const moduleUrl = new URL('./check-release-source.mjs', import.meta.url).href;
  const code = `import { checkReleaseSource } from ${JSON.stringify(moduleUrl)}; const r = await checkReleaseSource(process.argv[1]); if (!r.passed) process.exit(1); console.log(r.commit);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, root], { encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_DIR: path.join(root, 'foreign-git'), GIT_WORK_TREE: path.join(root, 'foreign-tree'), GIT_INDEX_FILE: path.join(root, 'foreign-index') } });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout.trim(), /^[a-f0-9]{40,64}$/);
}));
for (const flag of ['--assume-unchanged', '--skip-worktree']) test(`suppressed index comparison ${flag} cannot hide a modified release input`, async () => fixture(async root => {
  const relative = 'backend/src/main.ts';
  git(root, ['update-index', flag, '--', relative]); await writeFile(path.join(root, relative), 'silently changed source\n');
  const result = await checkReleaseSource(root);
  assert.equal(result.passed, false); assert.deepEqual(result.suppressedIndexReleaseFiles, [relative]);
}));
test('source check errors still produce a sanitized CI report and fail closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mj2-source-error-'));
  try {
    const script = fileURLToPath(new URL('./check-release-source.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--report', '.local/source-error.json'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(await readFile(path.join(root, '.local/source-error.json'), 'utf8'));
    assert.equal(report.status, 'error'); assert.equal(report.code, 'GIT_SOURCE_CHECK_FAILED'); assert.equal(report.deploymentReady, false);
    assert.equal(JSON.stringify(report).includes(root), false);
  } finally { assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true }); }
});
test('source symlinks are rejected rather than silently copying outside files', async () => {
  if (process.platform === 'win32') {
    // A directory junction is available without Windows symlink privilege.
    await fixture(async root => { const external = await mkdtemp(path.join(tmpdir(), 'mj2-source-external-')); try { await symlink(external, path.join(root, 'src'), 'junction'); await assert.rejects(releaseInventory(root), /SOURCE_SYMLINK_REQUIRES_REVIEW/); } finally { await rm(path.join(root, 'src'), { force: true, recursive: true }); await rm(external, { recursive: true, force: true }); } });
  } else await fixture(async root => { await symlink(tmpdir(), path.join(root, 'src')); await assert.rejects(releaseInventory(root), /SOURCE_SYMLINK_REQUIRES_REVIEW/); });
});
