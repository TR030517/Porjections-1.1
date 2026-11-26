// Creates and destroys only its own random labelled loopback MySQL. Credentials
// stay in child environment; reports/logs never contain passwords, tokens or rows.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), backend = path.join(root, 'backend');
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--acknowledge-isolated-account-jwt-check') { console.log('Explicit --acknowledge-isolated-account-jwt-check required; creates only a new labelled disposable loopback MySQL and tests real JWT/cookies.'); process.exit(2); }
const suffix = crypto.randomBytes(4).toString('hex'), name = 'massajoy2-account-jwt-' + suffix, database = 'mj2_test_account_jwt_' + suffix;
const taskLabel = 'account-followup-real-jwt-isolated', password = crypto.randomBytes(32).toString('hex'), rootPassword = crypto.randomBytes(32).toString('hex');
const systemEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['path', 'systemroot', 'windir', 'temp', 'tmp', 'pathext', 'comspec', 'userprofile', 'appdata', 'localappdata'].includes(key.toLowerCase())));
const reportFile = path.join(root, 'docs/verification/account-followup-jwt-2026-10-28.json');
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'fail', deploymentReady: false, realJwtOrCookiesTested: true, identityOrGuardOverrides: false, target: 'new disposable labelled MySQL, dynamic loopback port, random empty schema', externalProviderCalls: 0, envFilesRead: false, checks: [], cleanup: { attempted: false, passed: false } };
let created = false, tempDir;
function run(binary, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, argv, { cwd: backend, env: systemEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); let out = '', size = 0;
    child.stdout.on('data', bytes => { size += bytes.length; if (size > 8 * 1024 * 1024) child.kill(); else out += bytes; }); child.stderr.resume();
    const timer = setTimeout(() => child.kill(), options.timeout ?? 180000); timer.unref();
    child.once('error', () => { clearTimeout(timer); reject(Error('JWT_ISOLATED_COMMAND_FAILED')); });
    child.once('close', code => { clearTimeout(timer); code === 0 && size <= 8 * 1024 * 1024 ? resolve(out.trim()) : reject(Error('JWT_ISOLATED_COMMAND_FAILED')); });
  });
}
// Generated Prisma runtimes may probe env paths even with DATABASE_URL set.
// In the child, make .env files invisible and reject any direct attempted read.
const noEnvReads = `const fs=require('node:fs'),path=require('node:path');const isEnv=p=>typeof p==='string'&&/^\\.env(?:\\.|$)/i.test(path.basename(p));const exists=fs.existsSync,read=fs.readFileSync;fs.existsSync=function(p){return isEnv(p)?false:exists.apply(this,arguments)};fs.readFileSync=function(p){if(isEnv(p))throw Error('ENV_FILE_READ_FORBIDDEN');return read.apply(this,arguments)};`;
(async () => {
  if (fs.existsSync(reportFile)) throw Error('JWT_REPORT_EXISTS_ARCHIVE_BEFORE_RERUN');
  try {
    await run('docker', ['run', '--pull=never', '-d', '--name', name, '--label', 'massajoy.task=' + taskLabel, '-p', '127.0.0.1::3306', '-e', 'MYSQL_ROOT_PASSWORD', '-e', 'MYSQL_DATABASE', '-e', 'MYSQL_USER', '-e', 'MYSQL_PASSWORD', 'mysql:8.4'], { env: { ...systemEnv, MYSQL_ROOT_PASSWORD: rootPassword, MYSQL_DATABASE: database, MYSQL_USER: 'jwtcheck', MYSQL_PASSWORD: password } }); created = true;
    const port = (await run('docker', ['port', name, '3306/tcp'])).match(/^127\.0\.0\.1:(\d+)$/)?.[1]; if (!port) throw Error('JWT_LOOPBACK_MAPPING_REQUIRED');
    let ready = false;
    for (let i = 0; i < 90; i++) { try { await run('docker', ['exec', name, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping --silent --host=127.0.0.1 --user=root'], { timeout: 5000 }); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); } }
    if (!ready) throw Error('JWT_DISPOSABLE_MYSQL_NOT_READY');
    const url = `mysql://jwtcheck:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...systemEnv, DATABASE_URL: url, NODE_ENV: 'test', JWT_SECRET: crypto.randomBytes(48).toString('base64url'), CORS_ORIGINS: 'https://account-jwt.example.invalid', PAYMENT_PROVIDER: 'disabled', PAYMENT_EXTERNAL_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled', NOTIFICATION_WORKER_ENABLED: 'false', FCM_ENABLED: 'false', MASSAJOY_ACCOUNT_JWT_DISPOSABLE: 'fresh-container-only' };
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mj2-account-jwt-'));
    await fsp.cp(path.join(backend, 'prisma'), path.join(tempDir, 'prisma'), { recursive: true, filter: source => !/^\.env(?:\.|$)/i.test(path.basename(source)) });
    const migrationFiles = (await fsp.readdir(path.join(tempDir, 'prisma/migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory());
    if (migrationFiles.length !== 23) throw Error('JWT_EXPECTED_TWENTYTHREE_MIGRATIONS');
    await run(process.execPath, [path.join(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(tempDir, 'prisma/schema.prisma')], { env, cwd: tempDir, timeout: 300000 });
    const worker = noEnvReads + `require(${JSON.stringify(path.join(backend, 'node_modules/ts-node'))}).register({project:${JSON.stringify(path.join(backend, 'tsconfig.json'))},transpileOnly:true});const checks=[];(async()=>{try{const result=await require(${JSON.stringify(path.join(__dirname, 'account-jwt-http.cjs'))}).runAccountJwt({check:async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,50}$/.test(error.code)?error.code:'JWT_HTTP_ASSERTION_FAILED'});throw Error('JWT_HTTP_CHECK_FAILED');}}});console.log('JWT_RESULT:'+JSON.stringify({passed:true,checks,result}));}catch{console.log('JWT_RESULT:'+JSON.stringify({passed:false,checks,error:'JWT_HTTP_WORKFLOW_FAILED'}));}})();`;
    // Return the structured result even for an expected assertion failure; raw
    // Nest/Prisma output is deliberately discarded, never copied to the report.
    const output = await run(process.execPath, ['-e', worker], { env, cwd: tempDir, timeout: 180000 });
    const resultLine = output.split(/\r?\n/).find(line => line.startsWith('JWT_RESULT:')); if (!resultLine) throw Error('JWT_RESULT_CONTRACT_FAILED');
    const result = JSON.parse(resultLine.slice('JWT_RESULT:'.length)); report.checks = result.checks; report.migrations = 23;
    if (!result.passed) throw Error('JWT_HTTP_WORKFLOW_FAILED');
    report.fixtureCounts = { users: result.result.syntheticUsers, shops: result.result.syntheticShops };
    report.status = 'pass_for_isolated_real_jwt_cookie_controller_scope';
  } catch (error) { report.error = /^[A-Z0-9_]{4,100}$/.test(error?.message ?? '') ? error.message : 'JWT_ISOLATED_RUN_FAILED'; process.exitCode = 1; }
  finally {
    if (created) {
      report.cleanup.attempted = true;
      try {
        const label = await run('docker', ['inspect', '--format', '{{index .Config.Labels "massajoy.task"}}', name]);
        if (label !== taskLabel || !/^massajoy2-account-jwt-[a-f0-9]{8}$/.test(name)) throw Error('JWT_CLEANUP_OWNERSHIP_REQUIRED');
        await run('docker', ['rm', '-f', '-v', name]); report.cleanup.passed = true;
      } catch { report.cleanup.error = 'JWT_DISPOSABLE_CLEANUP_FAILED'; report.status = 'fail'; process.exitCode = 1; }
    }
    if (tempDir && path.dirname(tempDir) === os.tmpdir() && /^mj2-account-jwt-/.test(path.basename(tempDir))) await fsp.rm(tempDir, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString(); report.passed = report.status.startsWith('pass_') && report.cleanup.passed;
    report.counts = { pass: report.checks.filter(check => check.passed).length, fail: report.checks.filter(check => !check.passed).length };
    report.boundaries = ['Real in-process Nest HTTP bound only to loopback; no browser or native app acceptance.', 'No Google/Apple/SMTP/FCM/SMS/payment provider configured or contacted.', 'Secure cookie production branch checked on the isolated app; not a production deployment or TLS acceptance.'];
    await fsp.mkdir(path.dirname(reportFile), { recursive: true }); await fsp.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, passed: report.passed, counts: report.counts, cleanup: report.cleanup, report: 'docs/verification/account-followup-jwt-2026-10-28.json' }));
  }
})().catch(() => { console.error('JWT_ISOLATED_REPORT_FAILED_WITHOUT_SENSITIVE_OUTPUT'); process.exitCode = 1; });
