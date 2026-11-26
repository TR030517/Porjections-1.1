import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Deliberately fixed to this project's isolated local Compose stack.
const root = fileURLToPath(new URL('../', import.meta.url));
const compose = ['compose', '--project-name', 'massajoy2-local', '--env-file', '.local/compose.env', '-f', 'compose.yaml', '-f', 'compose.local.yaml'];
const destination = new URL('docs/verification/compose-restart.json', new URL('../', import.meta.url));
const report = { schemaVersion: 1, target: 'massajoy2-local', startedAt: new Date().toISOString(), status: 'fail', checks: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(args) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 45000, windowsHide: true, maxBuffer: 1024 * 1024 });
  // Commands only return counts/allowlisted runtime state; never include env, credentials or log bodies.
  if (result.error || result.status !== 0) throw new Error('LOCAL_DOCKER_COMMAND_FAILED');
  return result.stdout.trim();
}
function local(args) { return command([...compose, ...args]); }
function inspect(service) {
  const id = local(['ps', '-q', service]);
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('EXPECTED_ONE_LOCAL_CONTAINER');
  return JSON.parse(command(['inspect', '--format', '{"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}}', id]));
}
async function waitHealthy(service) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = inspect(service);
    if (state.running && state.health === 'healthy') return state;
    await delay(2000);
  }
  throw new Error('LOCAL_CONTAINER_HEALTH_TIMEOUT');
}
function counts() {
  const code = "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const result={};for(const n of ['user','shop','region','booking','merchantProfile','merchantTransaction','paymentRecord','paymentEvent','refundRequest','pushDevice'])result[n]=await p[n].count();result.migrations=(await p.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).map(r=>r.migration_name);console.log(JSON.stringify(result))})().catch(()=>{process.exitCode=1}).finally(()=>p.$disconnect());";
  return JSON.parse(local(['exec', '-T', 'api', 'node', '-e', code]));
}
async function main() {
  if (process.argv.slice(2).join(' ') !== '--acknowledge-local-restart') throw new Error('EXPLICIT_LOCAL_RESTART_FLAG_REQUIRED');
  const before = { api: inspect('api'), db: inspect('db'), web: inspect('web'), counts: counts() };
  if (before.counts.user !== 2 || before.counts.shop !== 5 || before.counts.region !== 9 || before.counts.merchantProfile !== 5 || before.counts.booking !== 0 || before.counts.paymentRecord !== 0 || before.counts.merchantTransaction !== 0 || before.counts.paymentEvent !== 0 || before.counts.refundRequest !== 0 || before.counts.pushDevice !== 0) throw new Error('CLEAN_REVIEW_BASELINE_REQUIRED');
  report.before = before;
  local(['restart', 'db']);
  await waitHealthy('db');
  local(['restart', 'api']);
  await waitHealthy('api');
  local(['restart', 'web']);
  await waitHealthy('web');
  const deadline = Date.now() + 30000;
  let httpReady = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:8088/api/v1/health', { signal: AbortSignal.timeout(5000), redirect: 'manual' });
      const body = await response.json();
      if (response.ok && body.status === 'healthy' && body.app === 'Massajoy2.0') { httpReady = true; break; }
    } catch { /* Local processes are restarting; retry within this bounded check. */ }
    await delay(1000);
  }
  if (!httpReady) throw new Error('LOCAL_GATEWAY_HEALTH_TIMEOUT');
  const after = { api: inspect('api'), db: inspect('db'), web: inspect('web'), counts: counts() };
  report.after = after;
  if (JSON.stringify(before.counts) !== JSON.stringify(after.counts)) throw new Error('PERSISTENT_COUNTS_OR_MIGRATIONS_CHANGED');
  for (const service of ['db', 'api', 'web']) {
    if (after[service].image !== before[service].image || after[service].startedAt === before[service].startedAt || !after[service].running) throw new Error('CONTAINER_RESTART_NOT_VERIFIED');
    report.checks.push({ id: `${service}.same_image_restarted`, status: 'pass' });
  }
  report.checks.push({ id: 'database.persistent_counts_and_migrations', status: 'pass' }, { id: 'gateway.database_health', status: 'pass' });
  report.status = 'pass';
}
try { await main(); }
catch (error) { report.error = /^[A-Z_]+$/.test(error.message) ? error.message : 'RESTART_VERIFICATION_FAILED'; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(new URL('.', destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, checksPassed: report.checks.length, report: 'docs/verification/compose-restart.json', ...(report.error ? { code: report.error } : {}) }));
}
