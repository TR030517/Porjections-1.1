// A new synthetic 23-migration source and a second disposable restore server.
// This runner never connects to an existing stack or reads a real .env file.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, createDockerAdapter, backupBundle, restoreBundle, validateBundle, captureSnapshot, canonical } from './backup-lib.mjs';

const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (Object.hasOwn(options, key)) throw Error('DUPLICATE_RESTORE_DRILL_ARGUMENT');
  if (key === '--acknowledge-isolated-account-restore') options[key] = true;
  else if (key === '--helper-image' && args[index + 1]) options[key] = args[++index];
  else throw Error('INVALID_RESTORE_DRILL_ARGUMENT');
}
if (!options['--acknowledge-isolated-account-restore'] || !/^sha256:[a-f0-9]{64}$/.test(options['--helper-image'] ?? '')) {
  console.log('Offline plan only: node scripts/account-restore-drill.mjs --acknowledge-isolated-account-restore --helper-image sha256:<local-api-image-id>. Creates only new labelled DB/media resources and synthetic fixtures; no current stack or external providers.');
  process.exit(2);
}
const suffix = randomBytes(4).toString('hex'), project = 'massajoy2-phase5-' + suffix, label = 'account-23-restore-isolated';
const backend = join(ROOT, 'backend'), folder = join(ROOT, '.local/account-followup-results', 'restore23-' + suffix);
const reportFile = join(ROOT, 'docs/verification/account-restore23-2026-10-28.json');
const names = { source: project + '-source-db', target: project + '-db', writer: project + '-source-writer', reader: project + '-source-media', mediaTarget: project + '-target-media' };
const volumeNames = ['source_db', 'target_db', 'source_media', 'target_media'].map(name => project + '_' + name);
const database = 'mj2_test_account_restore_' + suffix;
const systemEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['path', 'systemroot', 'windir', 'temp', 'tmp', 'pathext', 'comspec', 'userprofile', 'appdata', 'localappdata', 'programdata', 'allusersprofile', 'programfiles', 'programfiles(x86)', 'homedrive', 'homepath'].includes(key.toLowerCase())));
const environment = { ...systemEnv, ACCOUNT_RESTORE_SOURCE_ROOT: randomBytes(32).toString('hex'), ACCOUNT_RESTORE_TARGET_ROOT: randomBytes(32).toString('hex'), ACCOUNT_RESTORE_PASSWORD: randomBytes(32).toString('hex'), ACCOUNT_RESTORE_HELPER_IMAGE: options['--helper-image'] };
const sourceConfig = { schemaVersion: 2, db: { container: names.source, database }, writers: [names.writer], media: { driver: 'local', container: names.reader, directory: '/app/media' } };
const mediaTarget = { schemaVersion: 2, container: names.mediaTarget, directory: '/app/media' };
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'fail', deploymentReady: false, scope: 'New synthetic 23-migration DB plus actual local media, restored onto a separate new MySQL and empty media volume', existingStackAccessed: false, realEnvFilesRead: false, externalProvidersContacted: false, checks: [], cleanup: { attempted: false, passed: false } };
let attempted = false, composeArgs;
function run(binary, argv, { input, env = systemEnv, cwd = ROOT, timeout = 180000 } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(binary, argv, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', bytes = 0;
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) child.kill(); else stdout += chunk; }); child.stderr.resume();
    const timer = setTimeout(() => child.kill(), timeout); timer.unref();
    child.once('error', () => { clearTimeout(timer); reject(Error('ACCOUNT_RESTORE_COMMAND_FAILED')); });
    child.once('close', code => { clearTimeout(timer); code === 0 && bytes <= 8 * 1024 * 1024 ? done(stdout.trim()) : reject(Error('ACCOUNT_RESTORE_COMMAND_FAILED')); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
async function check(name, work) {
  try { const result = await work(); report.checks.push({ name, passed: true }); console.log(JSON.stringify({ stage: name, passed: true })); return result; }
  catch (error) { const code = /^[A-Z0-9_]{4,100}$/.test(error?.message ?? '') ? error.message : 'ACCOUNT_RESTORE_ASSERTION_FAILED'; report.checks.push({ name, passed: false, code }); throw Error('ACCOUNT_RESTORE_STAGE_FAILED'); }
}
const helper = '${ACCOUNT_RESTORE_HELPER_IMAGE:?required}';
function composeDocument() {
  const common = `    image: ${helper}\n    pull_policy: never\n    user: "1000:1000"\n    read_only: true\n    network_mode: none\n    cap_drop: [ALL]\n    security_opt: [no-new-privileges:true]\n    entrypoint: ["node", "-e", "setInterval(()=>{},60000)"]\n    labels:\n      massajoy.task: ${label}\n`;
  return `services:
  source-db:
    image: mysql:8.4
    pull_policy: never
    container_name: ${names.source}
    environment:
      MYSQL_ROOT_PASSWORD: \${ACCOUNT_RESTORE_SOURCE_ROOT:?required}
      MYSQL_DATABASE: ${database}
      MYSQL_USER: accountrestore
      MYSQL_PASSWORD: \${ACCOUNT_RESTORE_PASSWORD:?required}
    ports: ["127.0.0.1::3306"]
    volumes: ["source_db:/var/lib/mysql"]
    labels:
      massajoy.task: ${label}
  db:
    image: mysql:8.4
    pull_policy: never
    container_name: ${names.target}
    environment:
      MYSQL_ROOT_PASSWORD: \${ACCOUNT_RESTORE_TARGET_ROOT:?required}
      MYSQL_DATABASE: restore_control
    volumes: ["target_db:/var/lib/mysql"]
    labels:
      massajoy.task: ${label}
  source-writer:
    container_name: ${names.writer}
${common}    volumes: ["source_media:/app/media"]
  source-media:
    container_name: ${names.reader}
${common}    volumes: ["source_media:/app/media:ro"]
  target-media:
    container_name: ${names.mediaTarget}
${common}    volumes: ["target_media:/app/media"]
networks:
  default:
    driver: bridge
volumes:
${['source_db', 'target_db', 'source_media', 'target_media'].map(name => `  ${name}:\n    labels:\n      massajoy.task: ${label}`).join('\n')}
`;
}
// Prisma's generated runtime can probe schema-relative .env paths. Suppress
// those probes, and reject direct attempts before requiring the client.
const noEnvReads = `const fs=require('node:fs'),path=require('node:path');const isEnv=p=>typeof p==='string'&&/^\\.env(?:\\.|$)/i.test(path.basename(p));const exists=fs.existsSync,read=fs.readFileSync;fs.existsSync=function(p){return isEnv(p)?false:exists.apply(this,arguments)};fs.readFileSync=function(p){if(isEnv(p))throw Error('ENV_FILE_READ_FORBIDDEN');return read.apply(this,arguments)};`;
try {
  try { await fs.access(reportFile); throw Error('ACCOUNT_RESTORE_REPORT_ALREADY_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(join(ROOT, '.local/account-followup-results'), { recursive: true, mode: 0o700 });
  await fs.mkdir(folder, { recursive: false, mode: 0o700 });
  const composeFile = join(folder, 'compose.yaml'), emptyEnv = join(folder, 'empty-compose-env');
  await fs.writeFile(composeFile, composeDocument(), { flag: 'wx', mode: 0o600 }); await fs.writeFile(emptyEnv, '', { flag: 'wx', mode: 0o600 });
  composeArgs = ['compose', '--project-name', project, '--env-file', emptyEnv, '--file', composeFile];
  await check('new_random_project_and_named_volumes_do_not_exist', async () => {
    if (await run('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.Names}}'])) throw Error();
    if (await run('docker', ['volume', 'ls', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.Name}}'])) throw Error();
    for (const name of Object.values(names)) if (await run('docker', ['ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'])) throw Error();
  });
  attempted = true;
  await check('only_new_labelled_source_target_and_media_helpers_start', async () => { await run('docker', [...composeArgs, 'up', '-d', '--pull', 'never'], { env: environment, timeout: 300000 }); });
  await check('two_new_mysql_servers_are_ready_and_source_is_loopback_only', async () => {
    for (const name of [names.source, names.target]) {
      let ready = false;
      for (let index = 0; index < 100; index++) { try { await run('docker', ['exec', name, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping --silent --host=127.0.0.1 --user=root'], { timeout: 5000 }); ready = true; break; } catch { await new Promise(done => setTimeout(done, 500)); } }
      if (!ready) throw Error('NEW_MYSQL_NOT_READY');
    }
    let port; try { port = await run('docker', ['port', names.source, '3306/tcp']); } catch { throw Error('SOURCE_LOOPBACK_PORT_UNAVAILABLE'); }
    if (!/^127\.0\.0\.1:\d+$/.test(port)) throw Error('SOURCE_PORT_NOT_EXCLUSIVELY_LOOPBACK');
  });
  const port = (await run('docker', ['port', names.source, '3306/tcp'])).split(':')[1];
  const url = `mysql://accountrestore:${environment.ACCOUNT_RESTORE_PASSWORD}@127.0.0.1:${port}/${database}`;
  const childEnv = { ...systemEnv, DATABASE_URL: url, NODE_ENV: 'test', PAYMENT_PROVIDER: 'disabled', PAYMENT_EXTERNAL_ENABLED: 'false', FCM_ENABLED: 'false', NOTIFICATION_WORKER_ENABLED: 'false', MASSAJOY_ACCOUNT_RESTORE_DISPOSABLE: 'fresh-container-only' };
  const schemaCopy = join(folder, 'isolated-prisma');
  await check('twenty_three_migrations_deploy_only_to_new_empty_source', async () => {
    await fs.cp(join(backend, 'prisma'), schemaCopy, { recursive: true, filter: source => !/^\.env(?:\.|$)/i.test(source.split(/[\\/]/).at(-1)) });
    const migrationNames = (await fs.readdir(join(schemaCopy, 'migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory()); if (migrationNames.length !== 23) throw Error();
    await run(process.execPath, [join(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(schemaCopy, 'schema.prisma')], { env: childEnv, cwd: folder, timeout: 300000 });
  });
  const fixture = await check('synthetic_account_history_and_three_real_webp_files_are_nonempty', async () => {
    const writer = `const fs=require('node:fs');const key=process.argv[1];if(!/^[a-f0-9-]{36}\\.webp$/.test(key))throw Error('INVALID_SYNTHETIC_KEY');const b=fs.readFileSync(0);if(!b.length||b.length>8388608)throw Error('INVALID_SYNTHETIC_BYTES');fs.writeFileSync('/app/media/'+key,b,{flag:'wx',mode:384});`;
    const worker = noEnvReads + `const {PrismaClient}=require(${JSON.stringify(join(backend, 'node_modules/@prisma/client'))}),{spawnSync}=require('node:child_process'),db=new PrismaClient({log:[]});(async()=>{try{const result=await require(${JSON.stringify(join(backend, 'test/account-restore.fixture.cjs'))}).seedAccountRestore(db,{writeMedia:async(key,bytes)=>{const r=spawnSync('docker',['exec','-i',${JSON.stringify(names.writer)},'node','-e',${JSON.stringify(writer)},key],{input:bytes,encoding:null,windowsHide:true});if(r.status!==0)throw Error('SYNTHETIC_MEDIA_WRITE_FAILED');}});console.log('ACCOUNT_FIXTURE_RESULT:'+JSON.stringify(result));}finally{await db.$disconnect();}})().catch(error=>{const code=/^RESTORE_FIXTURE_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'RESTORE_FIXTURE_FAILED';console.log('ACCOUNT_FIXTURE_RESULT:'+JSON.stringify({failed:true,code}));});`;
    const output = await run(process.execPath, ['-e', worker], { env: childEnv, cwd: folder });
    const line = output.split(/\r?\n/).find(value => value.startsWith('ACCOUNT_FIXTURE_RESULT:')); if (!line) throw Error();
    const value = JSON.parse(line.slice('ACCOUNT_FIXTURE_RESULT:'.length)); if (value.failed) throw Error(value.code); if (value.files?.length !== 3) throw Error('RESTORE_FIXTURE_MEDIA_COUNT'); return value;
  });
  const adapter = createDockerAdapter(sourceConfig), targetAdapter = createDockerAdapter({ ...sourceConfig, db: { ...sourceConfig.db, container: names.target } });
  await check('source_writer_stops_before_snapshot_and_target_storage_is_empty', async () => {
    await run('docker', [...composeArgs, 'stop', 'source-writer'], { env: environment });
    if ((await adapter.inspect(names.writer)).running !== false || (await adapter.mediaList(mediaTarget)).length !== 0) throw Error();
    const count = await targetAdapter.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys');", { database: 'information_schema' }); if (count !== '0') throw Error();
  });
  const source = await check('full_source_snapshot_includes_every_nonempty_account_table_and_immutable_history', async () => {
    const snapshot = await captureSnapshot(adapter, { database }); if (snapshot.migrations.length !== 23) throw Error();
    for (const [name, count] of Object.entries(fixture.expectedTableCounts)) if (snapshot.tables.find(table => table.table === name)?.rows !== String(count)) throw Error();
    if (snapshot.media.length !== 3 || snapshot.media.some(asset => asset.namespace !== fixture.namespace)) throw Error();
    if (canonical(await adapter.mediaList(sourceConfig.media)) !== canonical(fixture.files.slice().sort((a, b) => a.key.localeCompare(b.key)))) throw Error();
    report.accountTableCounts = Object.fromEntries(Object.entries(fixture.expectedTableCounts).filter(([name]) => ['shop_login_bindings', 'shop_account_grants', 'auth_provider_identities', 'social_login_challenges', 'email_login_challenges', 'email_login_throttles', 'copy_config_operations', 'account_provision_operations'].includes(name)));
    report.historicalCases = fixture.historicalCases; report.migrations = 23; report.tables = snapshot.tables.length; report.mediaFiles = snapshot.media.length;
    return snapshot;
  });
  const bundlePath = join(ROOT, '.local/backups', 'account23-' + suffix);
  const backup = await check('complete_database_and_media_bundle_is_written_and_digest_pinned', async () => {
    const result = await backupBundle(sourceConfig, { adapter, directory: bundlePath, acknowledged: true });
    const validated = await validateBundle(bundlePath, result.bundleDigest);
    if (validated.manifest.snapshot.digest !== source.digest || result.migrations !== 23 || result.mediaFiles !== 3) throw Error(); return result;
  });
  const restored = await check('new_target_restore_matches_all_rows_structure_migrations_and_media_bytes', async () => {
    const result = await restoreBundle(sourceConfig, bundlePath, { adapter, targetAdapter, targetDbContainer: names.target, target: mediaTarget, expectedDigest: backup.bundleDigest, acknowledged: true });
    if (!result.passed || !result.rowsAndStructureMatch || !result.mediaBytesMatch || !result.sourceUnchanged || !result.temporaryAccountRemoved || result.migrations !== 23 || result.mediaFiles !== 3) throw Error(); return result;
  });
  await check('post_restore_source_db_and_media_are_unchanged_and_temporary_database_accounts_are_absent', async () => {
    const after = await captureSnapshot(adapter, { database }); if (after.digest !== source.digest) throw Error();
    if (canonical(await adapter.mediaList(sourceConfig.media)) !== canonical(fixture.files.slice().sort((a, b) => a.key.localeCompare(b.key)))) throw Error();
    const count = await targetAdapter.query("SELECT COUNT(*) FROM mysql.user WHERE User REGEXP '^mj2_restore_[a-f0-9]{16}$';", { database: 'information_schema' }); if (count !== '0') throw Error();
    report.sourceUnchanged = true; report.temporaryAccountsRemaining = 0; report.temporaryAccountRemoved = true;
  });
  report.bundleDigest = backup.bundleDigest; report.rowsAndStructureMatch = restored.rowsAndStructureMatch; report.mediaBytesMatch = restored.mediaBytesMatch;
  report.status = 'pass_for_new_synthetic_twenty_three_migration_db_and_media_restore';
} catch (error) {
  report.error = /^[A-Z0-9_]{4,100}$/.test(error?.message ?? '') ? error.message : 'ACCOUNT_RESTORE_DRILL_FAILED'; process.exitCode = 1;
} finally {
  if (attempted) {
    report.cleanup.attempted = true;
    try {
      for (const name of Object.values(names)) {
        const out = await run('docker', ['ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}']);
        if (!out) continue;
        const metadata = JSON.parse(await run('docker', ['inspect', '--format', '{{json .Config.Labels}}', name]));
        if (metadata['com.docker.compose.project'] !== project || metadata['massajoy.task'] !== label || !name.startsWith(project + '-')) throw Error();
      }
      for (const name of volumeNames) {
        const present = await run('docker', ['volume', 'ls', '--filter', 'name=^' + name + '$', '--format', '{{.Name}}']); if (!present) continue;
        const metadata = JSON.parse(await run('docker', ['volume', 'inspect', '--format', '{{json .Labels}}', name]));
        if (metadata['com.docker.compose.project'] !== project || metadata['massajoy.task'] !== label) throw Error();
      }
      await run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'], { env: environment });
      if (await run('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.Names}}'])) throw Error();
      if (await run('docker', ['volume', 'ls', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.Name}}'])) throw Error();
      report.cleanup.passed = true;
    } catch { report.cleanup.code = 'ACCOUNT_RESTORE_EXACT_RESOURCE_CLEANUP_FAILED'; report.status = 'fail'; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); report.passed = report.status.startsWith('pass_') && report.cleanup.passed;
  report.counts = { pass: report.checks.filter(check => check.passed).length, fail: report.checks.filter(check => !check.passed).length };
  report.boundaries = ['Synthetic source only; this is not a backup of current local or production data.', 'OAuth subjects and challenge hashes are synthetic; no provider or OTP delivery acceptance.', 'No restored application started; sessions and one-time challenge replay policy for an actual disaster remains a separate operational decision.', 'Local media only; S3 backup/restore remains explicitly unsupported.'];
  try { await fs.mkdir(resolve(reportFile, '..'), { recursive: true }); await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch { console.error('ACCOUNT_RESTORE_REPORT_NOT_OVERWRITTEN'); process.exitCode = 1; }
  console.log(JSON.stringify({ status: report.status, passed: report.passed, counts: report.counts, cleanup: report.cleanup, report: relative(ROOT, reportFile).replaceAll('\\', '/') }));
}
