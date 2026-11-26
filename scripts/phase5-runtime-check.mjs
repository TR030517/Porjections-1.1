import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, constants, open, mkdir, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Fixed local scope. No login, credentials file, arbitrary target, SQL mutation or media write.
const ROOT = new URL('../', import.meta.url);
const CWD = fileURLToPath(ROOT);
const TARGET = 'http://127.0.0.1:8088';
const PROJECT = 'massajoy2-local';
const COMPOSE = ['compose', '--project-name', PROJECT, '--env-file', '.local/compose.env', '-f', 'compose.yaml', '-f', 'compose.local.yaml'];
const SERVICES = ['db', 'api', 'web'];
const REPORT = 'docs/verification/phase5-runtime-2026-10-28.json';
let childEnvironment;
const report = {
  schemaVersion: 1, target: TARGET, project: PROJECT, startedAt: new Date().toISOString(),
  status: 'fail', deploymentReady: false, mode: 'read-only', checks: [],
  scope: {
    persistence: 'All generated Prisma models: count and sorted primary-key identity digest, not complete row contents or financial reconciliation.',
    filesystem: 'Directory ownership, access permissions and writable volume mount only; no probe file is created.',
    containerUid: 'docker exec id -u reports configured exec identity; it does not claim the MySQL daemon retains the entrypoint UID.',
    workers: 'Configuration inferred from allowlisted environment and source rules; timer execution and external delivery are not observed.',
    sideEffects: 'Default: reads and new sanitized report only. Explicit restart flag additionally restarts only the fixed local db/api/web.',
  },
};
class Failure extends Error { constructor(code) { super(code); this.code = code; } }
function requireThat(ok, code) { if (!ok) throw new Failure(code); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function docker(args, input) {
  requireThat(childEnvironment, 'COMPOSE_CHILD_ENVIRONMENT_NOT_PREPARED');
  const result = spawnSync('docker', args, { cwd: CWD, env: childEnvironment, encoding: 'utf8', input, timeout: 90000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  // Never forward Docker stderr, command strings, environment or arbitrary exception messages.
  requireThat(!result.error && result.status === 0, 'LOCAL_DOCKER_COMMAND_FAILED');
  return result.stdout.trim();
}
const compose = args => docker([...COMPOSE, ...args]);
async function prepareChildEnvironment() {
  const interpolated = new Set();
  for (const path of ['compose.yaml', 'compose.local.yaml']) {
    const source = await readFile(new URL(path, ROOT), 'utf8');
    for (const match of source.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) interpolated.add(match[1].toUpperCase());
  }
  childEnvironment = { ...process.env };
  // Compose host environment takes priority over --env-file. Remove every source
  // interpolation name, case-insensitively on Windows, without reading its value.
  for (const key of Object.keys(childEnvironment)) if (interpolated.has(key.toUpperCase())) delete childEnvironment[key];
  report.hostComposeInterpolationOverridesRemoved = true;
}
function nodeInApi(source) {
  const text = docker([...COMPOSE, 'exec', '-T', 'api', 'node'], source);
  try { return JSON.parse(text); } catch { throw new Failure('INVALID_SAFE_API_PROBE_RESULT'); }
}
function inspect(service) {
  const id = compose(['ps', '-q', service]);
  requireThat(/^[a-f0-9]{12,64}$/.test(id), 'EXPECTED_ONE_LOCAL_CONTAINER');
  const format = '{"image":{{json .Image}},"configuredUser":{{json .Config.User}},"readOnly":{{json .HostConfig.ReadonlyRootfs}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"ports":{{json .NetworkSettings.Ports}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"mounts":[{{range $i,$v := .Mounts}}{{if $i}},{{end}}{"type":{{json $v.Type}},"name":{{json $v.Name}},"destination":{{json $v.Destination}},"rw":{{json $v.RW}}}{{end}}]}';
  let value;
  try { value = JSON.parse(docker(['inspect', '--format', format, id])); } catch { throw new Failure('INVALID_LOCAL_CONTAINER_METADATA'); }
  requireThat(value.project === PROJECT && value.service === service, 'COMPOSE_IDENTITY_MISMATCH');
  requireThat(/^sha256:[a-f0-9]{64}$/.test(value.image), 'INVALID_CONTAINER_IMAGE_ID');
  // Report only the documented media/database/TLS mounts; never host source paths.
  value.mounts = value.mounts.filter(m => ['/app/media', '/var/lib/mysql', '/data', '/config'].includes(m.destination));
  const uidText = docker(['exec', id, 'id', '-u']);
  requireThat(/^\d+$/.test(uidText), 'INVALID_CONTAINER_UID');
  value.uid = Number(uidText);
  return value;
}
function validateContainers(containers) {
  for (const service of SERVICES) {
    const state = containers[service];
    requireThat(state.running && state.health === 'healthy', 'LOCAL_CONTAINER_NOT_HEALTHY');
    const published = Object.entries(state.ports ?? {}).flatMap(([containerPort, hosts]) => (hosts ?? []).map(host => ({ containerPort, ...host })));
    if (service === 'web') requireThat(published.length === 1 && published[0].containerPort === '80/tcp' && published[0].HostIp === '127.0.0.1' && published[0].HostPort === '8088', 'ONLY_LOOPBACK_8088_MAY_BE_PUBLISHED');
    else requireThat(published.length === 0, 'DATABASE_OR_API_HOST_PORT_FORBIDDEN');
  }
  requireThat(containers.api.uid === 1000 && containers.api.readOnly === true, 'API_NONROOT_READONLY_REQUIRED');
  for (const [service, destination, name] of [['db', '/var/lib/mysql', 'database'], ['api', '/app/media', 'media']]) {
    const mount = containers[service].mounts.find(m => m.destination === destination);
    requireThat(mount?.type === 'volume' && mount.name === `${PROJECT}_${name}` && mount.rw === true, 'EXPECTED_LOCAL_PERSISTENT_VOLUME_REQUIRED');
  }
}
const environmentProbe = String.raw`
const fs=require('node:fs'),{constants}=fs;
(async()=>{
 const env=process.env;
 const database=new URL(env.DATABASE_URL);if(database.protocol!=='mysql:'||database.hostname!=='db'||!['','3306'].includes(database.port)||database.pathname!=='/massajoy2_local')throw Error();
 if(env.NODE_ENV!=='development'||env.MEDIA_STORAGE_DRIVER!=='local'||env.MEDIA_LOCAL_DIR!=='/app/media'||(env.PAYMENT_PROVIDER||'disabled')!=='disabled'||![undefined,'false'].includes(env.PAYMENT_EXTERNAL_ENABLED)||![undefined,'false'].includes(env.AUTH_LOCAL_OTP))throw Error();
 const info=fs.lstatSync('/app/media');if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==1000||process.getuid()!==1000||fs.realpathSync('/app/media')!=='/app/media')throw Error();
 fs.accessSync('/app/media',constants.R_OK|constants.W_OK|constants.X_OK);
 const flag=env.NOTIFICATION_WORKER_ENABLED;
 if(flag!==undefined&&!['true','false'].includes(flag))throw Error();
 console.log(JSON.stringify({environment:{NODE_ENV:'development',MEDIA_STORAGE_DRIVER:'local',MEDIA_LOCAL_DIR:'/app/media',PAYMENT_PROVIDER:'disabled',PAYMENT_EXTERNAL_ENABLED:env.PAYMENT_EXTERNAL_ENABLED===undefined?'unset':'false',AUTH_LOCAL_OTP:env.AUTH_LOCAL_OTP===undefined?'unset':'false',NOTIFICATION_WORKER_ENABLED:flag??'unset'},mediaDirectory:{uid:info.uid,gid:info.gid,modeOctal:(info.mode&511).toString(8),directory:true,symlink:false,readWriteSearchAccess:true,probeFileWritten:false}}));
})().catch(()=>{process.exitCode=1});
`;
const snapshotProbe = String.raw`
const{PrismaClient,Prisma}=require('@prisma/client'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const database=new URL(process.env.DATABASE_URL);if(database.protocol!=='mysql:'||database.hostname!=='db'||!['','3306'].includes(database.port)||database.pathname!=='/massajoy2_local'||process.env.NODE_ENV!=='development')process.exit(1);
const p=new PrismaClient({log:[]});
(async()=>{
 const models=Prisma.dmmf.datamodel.models.slice().sort((a,b)=>a.name.localeCompare(b.name));
 const result=await p.$transaction(async tx=>{
  const tables=[];
  for(const model of models){
   if(!/^[A-Za-z][A-Za-z0-9]*$/.test(model.name))throw Error();
   const key=model.primaryKey?.fields?.length?model.primaryKey.fields:model.fields.filter(f=>f.isId).map(f=>f.name);
   if(!key.length||key.some(k=>!/^[A-Za-z][A-Za-z0-9]*$/.test(k)))throw Error();
   const delegate=tx[model.name[0].toLowerCase()+model.name.slice(1)];if(!delegate)throw Error();
   const count=await delegate.count();if(!Number.isSafeInteger(count)||count>1000000)throw Error();
   const digest=createHash('sha256').update(JSON.stringify({model:model.name,key})+'\n');let seen=0;
   while(seen<count){
    const rows=await delegate.findMany({select:Object.fromEntries(key.map(k=>[k,true])),orderBy:key.map(k=>({[k]:'asc'})),skip:seen,take:250});
    if(!rows.length)throw Error();
    for(const row of rows)digest.update(JSON.stringify(key.map(k=>({type:typeof row[k],value:String(row[k])})))+'\n');
    seen+=rows.length;
   }
   if(seen!==count)throw Error();tables.push({model:model.name,count,identitySha256:digest.digest('hex')});
  }
  const rows=await tx.$queryRawUnsafe('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name');
  if(rows.some(r=>!r.finished_at||r.rolled_back_at))throw Error();
  return{models:tables,migrations:rows.map(r=>r.migration_name)};
 },{isolationLevel:'RepeatableRead',timeout:60000,maxWait:10000});
 const folder='/app/prisma/migrations';result.imageRequiredMigrations=fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(path.join(folder,e.name,'migration.sql'))).map(e=>e.name).sort();
 console.log(JSON.stringify(result));
})().catch(()=>{process.exitCode=1}).finally(()=>p.$disconnect());
`;
async function expectedMigrations() {
  const folder = new URL('backend/prisma/migrations/', ROOT);
  const entries = await readdir(folder, { withFileTypes: true });
  const names = [];
  for (const entry of entries) if (entry.isDirectory() && /^\d{12}_[a-z0-9_]+$/.test(entry.name)) {
    await access(new URL(`${entry.name}/migration.sql`, folder), constants.R_OK);
    names.push(entry.name);
  }
  names.sort(); requireThat(names.length === 18, 'EXPECTED_PHASE5_EIGHTEEN_SOURCE_MIGRATIONS');
  return names;
}
function validateSnapshot(value, expected) {
  requireThat(Array.isArray(value?.models) && value.models.length > 0 && value.models.every(m => /^[A-Za-z][A-Za-z0-9]*$/.test(m.model) && Number.isSafeInteger(m.count) && m.count >= 0 && /^[a-f0-9]{64}$/.test(m.identitySha256)), 'INVALID_DYNAMIC_MODEL_SNAPSHOT');
  requireThat(JSON.stringify(value.migrations) === JSON.stringify(expected) && JSON.stringify(value.imageRequiredMigrations) === JSON.stringify(expected), 'SOURCE_IMAGE_DATABASE_MIGRATION_NAMES_MISMATCH');
  return { ...value, modelCount: value.models.length, totalRows: value.models.reduce((sum, m) => sum + m.count, 0), aggregateSha256: hash(JSON.stringify(value.models)) };
}
async function get(path) {
  const url = new URL(path, TARGET);
  requireThat(url.origin === TARGET && !url.username && !url.password && !url.search && !url.hash, 'ONLY_FIXED_LOCAL_HTTP_ACCEPTED');
  let response;
  try { response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'Accept-Encoding': 'identity' } }); }
  catch { throw new Failure('LOCAL_HTTP_UNREACHABLE'); }
  requireThat(response.status === 200 && response.body, 'LOCAL_HTTP_EXPECTED_200');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; requireThat(size <= 25 * 1024 * 1024, 'LOCAL_ASSET_TOO_LARGE'); chunks.push(chunk); }
  return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type') ?? '' };
}
async function publicApiChecks() {
  let health, payments;
  try { health = JSON.parse((await get('/api/v1/health')).bytes); payments = JSON.parse((await get('/api/v1/payments/config')).bytes); }
  catch (error) { if (error instanceof Failure) throw error; throw new Failure('INVALID_LOCAL_PUBLIC_JSON'); }
  requireThat(health?.status === 'healthy' && health.app === 'Massajoy2.0' && health.version === '2.0.0' && Number.isFinite(Date.parse(health.timestamp)), 'DATABASE_RELEASE_HEALTH_NOT_READY');
  requireThat(payments?.enabled === false && payments.provider === 'disabled', 'PAYMENTS_MUST_REMAIN_DISABLED');
  return { health: { healthy: true, releaseMigrations: 18 }, payments: { enabled: false, provider: 'disabled' } };
}
function imageFileHash(webId, path) {
  requireThat(/^\/srv\/(admin|merchant|customer)\/[A-Za-z0-9_./-]+$/.test(path) && !path.includes('..'), 'UNSAFE_IMAGE_ASSET_PATH');
  const output = docker(['exec', webId, 'sha256sum', path]);
  const digest = /^([a-f0-9]{64})\s/.exec(output)?.[1];
  requireThat(digest, 'IMAGE_ASSET_HASH_UNAVAILABLE'); return digest;
}
async function frontends() {
  // Keep this mapping aligned with the actual final COPY paths, not assumed Vite output roots.
  const dockerfile = await readFile(new URL('deploy/Dockerfile.web', ROOT), 'utf8');
  for (const line of ['COPY --from=admin /src/dist /srv/admin', 'COPY --from=merchant /src/dist /srv/merchant', 'COPY --from=customer /src/build/web /srv/customer']) requireThat(dockerfile.includes(line), 'WEB_IMAGE_LAYOUT_CHANGED_REVIEW_MAPPING');
  const webId = compose(['ps', '-q', 'web']); requireThat(/^[a-f0-9]{12,64}$/.test(webId), 'EXPECTED_ONE_LOCAL_WEB_CONTAINER');
  const results = [];
  for (const [name, prefix, deep] of [['customer', '/', '/s/phase5-runtime-check'], ['admin', '/admin/', '/admin/stores/phase5-runtime-check'], ['merchant', '/merchant/', '/merchant/dashboard']]) {
    const index = await get(prefix); requireThat(/text\/html/i.test(index.type), 'EXPECTED_FRONTEND_HTML');
    const html = index.bytes.toString('utf8');
    if (name === 'customer') requireThat(/<base\b[^>]*href=["']\/["']/i.test(html), 'CUSTOMER_BASE_PATH_MUST_BE_ROOT');
    const paths = new Set();
    for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      if (/^<link\b/i.test(tag[0]) && !/\brel=["'](?:stylesheet|modulepreload)["']/i.test(tag[0])) continue;
      const value = /\b(?:src|href)=["']([^"']+)["']/i.exec(tag[0])?.[1];
      if (!value) continue;
      const url = new URL(value.replaceAll('&amp;', '&'), TARGET + prefix);
      requireThat(url.origin === TARGET && !url.username && !url.password && !url.search && !url.hash && url.pathname.startsWith(prefix), 'EXTERNAL_OR_UNEXPECTED_ASSET_REFERENCE');
      if (name !== 'customer') requireThat(url.pathname.startsWith(prefix + 'assets/'), 'INVALID_SUBAPP_ASSET_BASE');
      requireThat(/^[A-Za-z0-9_./-]+$/.test(url.pathname) && !url.pathname.includes('..'), 'INVALID_FRONTEND_ASSET_PATH');
      paths.add(url.pathname);
    }
    if (name === 'customer') { paths.add('/main.dart.js'); paths.add('/flutter.js'); }
    requireThat(paths.size > 0 && paths.size <= 32, 'UNEXPECTED_FRONTEND_ASSET_COUNT');
    const artifacts = [{ path: prefix, imagePath: `/srv/${name}/index.html`, sha256: hash(index.bytes), byteLength: index.bytes.length }];
    for (const path of paths) {
      const asset = await get(path);
      requireThat(asset.bytes.length > 0 && !/text\/html/i.test(asset.type) && (path.endsWith('.css') ? /text\/css/i : /(?:java|ecma)script/i).test(asset.type), 'ASSET_IS_NOT_EXPECTED_STATIC_CONTENT');
      artifacts.push({ path, imagePath: `/srv/${name}/${path.slice(prefix.length)}`, sha256: hash(asset.bytes), byteLength: asset.bytes.length });
    }
    for (const artifact of artifacts) requireThat(imageFileHash(webId, artifact.imagePath) === artifact.sha256, 'SERVED_ASSET_BYTES_DIFFER_FROM_CONTAINER');
    const fallback = await get(deep);
    requireThat(/text\/html/i.test(fallback.type) && hash(fallback.bytes) === hash(index.bytes), 'FRONTEND_DEEP_LINK_FALLBACK_MISMATCH');
    results.push({ name, artifacts, deepLinkMatchesIndex: true });
  }
  return results;
}
async function workerConfiguration(environment) {
  const sources = [
    ['booking', 'backend/src/modules/booking/booking.service.ts'],
    ['notifications', 'backend/src/modules/notifications/notification-worker.service.ts'],
    ['media', 'backend/src/modules/upload/upload.service.ts'],
  ];
  const evidence = [];
  for (const [worker, path] of sources) {
    const source = await readFile(new URL(path, ROOT), 'utf8');
    requireThat(source.includes('onModuleInit()') && source.includes('setInterval('), 'WORKER_CONFIGURATION_SOURCE_CHANGED');
    if (worker === 'notifications') requireThat(source.includes("process.env.NODE_ENV === 'test' || process.env.NOTIFICATION_WORKER_ENABLED === 'false'"), 'NOTIFICATION_WORKER_RULE_CHANGED');
    if (worker === 'media') requireThat(source.includes("process.env.NODE_ENV==='test'||!this.storage.available()"), 'MEDIA_WORKER_RULE_CHANGED');
    const configured = worker !== 'notifications' || environment.NOTIFICATION_WORKER_ENABLED !== 'false';
    evidence.push({ worker, configured, automaticExecutionObserved: false, source: path, sourceSha256: hash(source), rule: worker === 'booking' ? 'Booking expiry timer starts on module initialization; no NODE_ENV guard.' : worker === 'notifications' ? 'Starts unless NODE_ENV=test or NOTIFICATION_WORKER_ENABLED=false.' : 'Starts unless NODE_ENV=test or media storage unavailable; local driver configured.' });
  }
  return evidence;
}
async function state(expected) {
  const containers = Object.fromEntries(SERVICES.map(s => [s, inspect(s)])); validateContainers(containers);
  return { containers, runtime: nodeInApi(environmentProbe), database: validateSnapshot(nodeInApi(snapshotProbe), expected) };
}
async function healthy(service) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) { const current = inspect(service); if (current.running && current.health === 'healthy') return; await delay(2000); }
  throw new Failure('LOCAL_CONTAINER_RESTART_HEALTH_TIMEOUT');
}
async function main() {
  const args = process.argv.slice(2);
  requireThat(args.length >= 1 && args.length <= 2 && args.includes('--acknowledge-local-runtime-check') && new Set(args).size === args.length && args.every(a => ['--acknowledge-local-runtime-check', '--acknowledge-local-restart'].includes(a)), 'EXPLICIT_FIXED_LOCAL_RUNTIME_ACK_REQUIRED');
  const restart = args.includes('--acknowledge-local-restart'); report.mode = restart ? 'local-restart' : 'read-only';
  await prepareChildEnvironment();
  const expected = await expectedMigrations();
  report.before = await state(expected); report.checks.push({ id: 'local.containers_environment_media_access_dynamic_database', status: 'pass' });
  report.workers = await workerConfiguration(report.before.runtime.environment);
  report.publicApi = await publicApiChecks(); report.frontends = await frontends();
  report.checks.push({ id: 'gateway.health18_payments_disabled', status: 'pass' }, { id: 'three_frontends.served_bytes_match_container_and_deep_links', status: 'pass' });
  if (restart) {
    for (const service of SERVICES) { compose(['restart', service]); await healthy(service); }
    report.after = await state(expected); report.afterPublicApi = await publicApiChecks(); report.afterFrontends = await frontends();
    requireThat(JSON.stringify(report.before.database) === JSON.stringify(report.after.database), 'RESTART_MODEL_COUNTS_IDENTITIES_OR_MIGRATIONS_CHANGED');
    requireThat(JSON.stringify(report.before.runtime) === JSON.stringify(report.after.runtime), 'RESTART_ALLOWLISTED_RUNTIME_CONFIGURATION_CHANGED');
    requireThat(JSON.stringify(report.frontends) === JSON.stringify(report.afterFrontends), 'RESTART_SERVED_ARTIFACTS_CHANGED');
    for (const service of SERVICES) {
      const before = report.before.containers[service], after = report.after.containers[service];
      requireThat(before.image === after.image && before.startedAt !== after.startedAt, 'LOCAL_RESTART_OR_SAME_IMAGE_NOT_VERIFIED');
      report.checks.push({ id: `${service}.same_image_restarted_healthy`, status: 'pass' });
    }
    report.checks.push({ id: 'database.all_model_counts_and_identity_digests_preserved', status: 'pass' });
  }
  report.status = restart ? 'pass_for_local_phase5_restart_scope' : 'pass_for_local_phase5_readonly_scope';
}
async function reserveReport() {
  await mkdir(new URL('docs/verification/', ROOT), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    const path = attempt === 0 ? REPORT : REPORT.replace('.json', `-attempt-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    try { return { handle: await open(new URL(path, ROOT), 'wx', 0o600), path }; }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  throw new Failure('NEW_REPORT_FILE_COULD_NOT_BE_RESERVED');
}
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('Usage: node scripts/phase5-runtime-check.mjs --acknowledge-local-runtime-check [--acknowledge-local-restart]\nFixed massajoy2-local / http://127.0.0.1:8088 only. Default read-only; optional flag restarts db/api/web. No login, DB/media writes or environment-file output. Writes a new sanitized wx report; existing reports are never replaced.');
} else {
  let output;
  try { output = await reserveReport(); await main(); }
  catch (error) { report.error = error instanceof Failure ? error.code : 'RUNTIME_CHECK_FAILED_WITHOUT_SENSITIVE_OUTPUT'; process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString();
    if (output) {
      try { await output.handle.writeFile(JSON.stringify(report, null, 2) + '\n', 'utf8'); await output.handle.close(); }
      catch { report.error = 'SAFE_REPORT_WRITE_FAILED'; process.exitCode = 1; }
    }
    console.log(JSON.stringify({ status: report.error ? 'fail' : report.status, deploymentReady: false, checksPassed: report.checks.length, ...(output ? { report: output.path } : {}), ...(report.error ? { code: report.error } : {}) }));
  }
}
