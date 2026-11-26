#!/usr/bin/env node
// An explicitly selected local database is read for planning; only --apply can write it.
import { readFileSync, lstatSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fail, bytesDigest, validatePackage, validateLocalConfig, createPlan, applyPlan, safeSummary } from './live1-public-sample-lib.mjs';

const LOCAL = resolve(fileURLToPath(new URL('../.local/', import.meta.url)));
function localPath(path) {
  if (typeof path !== 'string' || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) fail('TASK_LOCAL_JSON_REQUIRED');
  const absolute = resolve(path), location = relative(LOCAL, absolute);
  if (!location || location === '..' || location.startsWith('..' + sep) || extname(absolute).toLowerCase() !== '.json') fail('TASK_LOCAL_JSON_REQUIRED');
  return absolute;
}
function readJson(path, limit = 2 * 1024 * 1024) {
  const absolute = localPath(path), stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || realpathSync(absolute).toLowerCase() !== absolute.toLowerCase()) fail('LOCAL_JSON_TYPE_OR_SIZE_INVALID');
  const bytes = readFileSync(absolute);
  return { value: JSON.parse(bytes.toString('utf8')), sha: bytesDigest(bytes), path: absolute };
}
function newPath(path, taskOnly = true) {
  const absolute = taskOnly ? localPath(path) : resolve(path);
  if (extname(absolute).toLowerCase() !== '.json' || realpathSync(dirname(absolute)).toLowerCase() !== dirname(absolute).toLowerCase()) fail('OUTPUT_PATH_INVALID');
  try { lstatSync(absolute); fail('OUTPUT_ALREADY_EXISTS'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (!taskOnly) {
    const reportRoot = resolve(fileURLToPath(new URL('../docs/verification/', import.meta.url))), location = relative(reportRoot, absolute);
    if (!location || location.startsWith('..') || location.includes(sep) || !/^live1-sample-[a-zA-Z0-9_.-]+\.json$/.test(location)) fail('SAFE_REPORT_PATH_INVALID');
  }
  return absolute;
}
export async function runCli(args = process.argv.slice(2)) {
  let db;
  try {
    if (args.length === 1 && args[0] === '--help') {
      process.stdout.write('Usage: node scripts/live1-public-sample.mjs package.json --config .local/live1-sample-results/connection.json --plan .local/live1-sample-results/plan.json [--report docs/verification/live1-sample-plan.json]\nDefault: read-only local plan (plan contains before/write values; keep it in .local). Apply: add --apply --expected-plan-digest <sha256> --acknowledge-local-write; --plan must name the existing reviewed plan. Config: {databaseUrl OR databaseUrlEnv:"DATABASE_URL",actorId,connectionMode?:"loopback"|"compose-local"}. Compose mode additionally requires --acknowledge-local-compose and a Linux container, db:3306, NODE_ENV=test; uses /app Prisma. Credentials are never printed. No schema, aliases, catalog, account or financial changes.\n');
      return 0;
    }
    if (!args[0] || args[0].startsWith('-') || process.env.NODE_ENV === 'production') fail('LOCAL_INVOCATION_REQUIRED');
    const options = {};
    for (let index = 1; index < args.length; index++) {
      const key = args[index];
      if (Object.prototype.hasOwnProperty.call(options, key)) fail('CLI_ARGUMENTS_INVALID');
      if (['--apply', '--acknowledge-local-write', '--acknowledge-local-compose'].includes(key)) options[key] = true;
      else if (['--config', '--plan', '--report', '--expected-plan-digest'].includes(key) && args[index + 1] && !args[index + 1].startsWith('-')) options[key] = args[++index];
      else fail('CLI_ARGUMENTS_INVALID');
    }
    if (!options['--config'] || !options['--plan'] || !options['--apply'] && (options['--expected-plan-digest'] || options['--acknowledge-local-write'])) fail('CLI_ARGUMENTS_INVALID');
    if (options['--apply'] && (!options['--acknowledge-local-write'] || !/^[a-f0-9]{64}$/.test(options['--expected-plan-digest'] ?? ''))) fail('EXPLICIT_APPLY_CONTRACT_REQUIRED');
    const source = readJson(args[0]); validatePackage(source.value);
    const configFile = readJson(options['--config'], 16384), config = validateLocalConfig(configFile.value, { environment: process.env, allowCompose: options['--acknowledge-local-compose'] === true, inContainer: process.platform === 'linux' && existsSync('/.dockerenv') });
    if (config.connectionMode === 'compose-local' && process.env.NODE_ENV !== 'test') fail('COMPOSE_ONESHOT_TEST_MODE_REQUIRED');
    if (options['--acknowledge-local-compose'] && config.connectionMode !== 'compose-local') fail('UNEXPECTED_COMPOSE_ACK');
    if (configFile.path === source.path) fail('INPUT_PATHS_MUST_DIFFER');
    const planPath = options['--apply'] ? localPath(options['--plan']) : newPath(options['--plan']);
    const reportPath = options['--report'] ? newPath(options['--report'], false) : null;
    if ([source.path, configFile.path].includes(planPath)) fail('INPUT_PATHS_MUST_DIFFER');
    const existing = options['--apply'] ? readJson(planPath).value : null;
    const require = createRequire(config.connectionMode === 'compose-local' ? '/app/package.json' : new URL('../backend/package.json', import.meta.url)), { PrismaClient } = require('@prisma/client');
    db = new PrismaClient({ datasources: { db: { url: config.url } }, log: [], errorFormat: 'minimal' });
    let summary;
    if (options['--apply']) {
      const result = await applyPlan(db, source.value, existing, { ...config, packageSHA: source.sha, expectedPlanDigest: options['--expected-plan-digest'] });
      summary = safeSummary(existing, 'applied-local-public-fields-only', { passed: true, ...result });
    } else {
      const plan = await createPlan(db, source.value, { ...config, packageSHA: source.sha });
      writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      summary = safeSummary(plan, 'read-only-local-plan', { passed: true });
    }
    const output = JSON.stringify(summary, null, 2) + '\n';
    if (reportPath) writeFileSync(reportPath, output, { flag: 'wx', mode: 0o600 });
    process.stdout.write(output);
    return 0;
  } catch (error) {
    // Raw driver/Prisma/JSON/file errors can include data or credentials; never print them.
    process.stdout.write(JSON.stringify({ schemaVersion: 1, tool: 'live1-public-sample-v1', passed: false, error: { code: typeof error?.safeCode === 'string' ? error.safeCode : 'LOCAL_SAMPLE_OPERATION_FAILED' }, deploymentReady: false }) + '\n');
    return 1;
  } finally { if (db) await db.$disconnect().catch(() => {}); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = await runCli();
