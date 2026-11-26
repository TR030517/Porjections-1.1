/** Real HTTP acceptance. Exclusively the existing root-owned synthetic 50920 stack. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateThreeEndSecrets } from './three-end-http.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TARGET = 'http://127.0.0.1:50920', PROJECT = 'massajoy2-three-end-49605b07';
const DATABASE = 'massajoy2_three_end_49605b07', MARKER = '49605b07';
const STATE = '.local/three-end-state.json', FIXTURE = '.local/intake-results/fixture.json';
const PRIVATE = '.local/three-end-49605b07/three-end-secrets.json';
const REPORT = 'docs/verification/public-intake-http-2026-10-28.json';
const BASE = '/admin/public-intake', ACK = '--acknowledge-public-intake-synthetic';
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
class Failure extends Error { constructor(code, status, apiCode) { super(code); Object.assign(this, { code, status, apiCode }); } }
const need = (ok, code) => { if (!ok) throw new Failure(code); };
const same = (a, b, code) => need(canonical(a) === canonical(b), code);
const copy = value => structuredClone(value);
const safeError = error => ({ code: error instanceof Failure ? error.code : 'INTAKE_HTTP_ASSERTION_FAILED',
  ...(error instanceof Failure && error.status ? { httpStatus: error.status } : {}),
  ...(error instanceof Failure && /^[A-Z_]{3,80}$/.test(error.apiCode ?? '') ? { publicIntakeCode: error.apiCode } : {}) });
async function privateJson(file) {
  const absolute = path.join(ROOT, file), stat = await fs.lstat(absolute);
  need(stat.isFile() && !stat.isSymbolicLink() && await fs.realpath(absolute) === absolute, 'REGULAR_EXPECTED_LOCAL_FILE_REQUIRED');
  return JSON.parse(await fs.readFile(absolute, 'utf8'));
}
function docker(args, input) {
  const result = spawnSync('docker', args, { cwd: ROOT, input, encoding: 'utf8', timeout: 60000,
    windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  need(!result.error && result.status === 0, 'SCOPED_SYNTHETIC_DOCKER_READ_FAILED');
  try { return JSON.parse(result.stdout); } catch { throw new Failure('SCOPED_SYNTHETIC_DOCKER_JSON_INVALID'); }
}
function inspect(service) {
  need(['api', 'web', 'db'].includes(service), 'SYNTHETIC_SERVICE_REQUIRED');
  const value = docker(['inspect', '--format', '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"ports":{{json .NetworkSettings.Ports}}}', `${PROJECT}-${service}-1`]);
  need(value.project === PROJECT && value.service === service && value.running && value.health === 'healthy'
    && /^[a-f0-9]{64}$/.test(value.id) && /^sha256:[a-f0-9]{64}$/.test(value.image), 'HEALTHY_EXACT_SYNTHETIC_IDENTITY_REQUIRED');
  const ports = Object.entries(value.ports ?? {}).flatMap(([port, rows]) => (rows ?? []).map(row => ({ port, ...row })));
  need(service === 'web' ? ports.length === 1 && ports[0].port === '80/tcp' && ports[0].HostIp === '127.0.0.1'
    && ports[0].HostPort === '50920' : ports.length === 0, 'ONLY_SYNTHETIC_50920_PORT_ALLOWED');
  return value;
}
// All raw rows and connection secrets stay inside the exact synthetic API container.
// The host receives table/structure hashes and only the three explicitly synthetic
// description/hours projections. New audit rows are exempted only by actual receipts.
const snapshotProbe = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const args=JSON.parse(fs.readFileSync(0,'utf8')),p=new PrismaClient({log:[]});
function must(ok){if(!ok)throw Error('GUARD');}
function norm(v){if(typeof v==='bigint')return v.toString();if(v instanceof Date)return v.toISOString();if(Buffer.isBuffer(v))return {buffer:v.toString('hex')};if(Array.isArray(v))return v.map(norm);if(v&&typeof v==='object'){if(typeof v.toJSON==='function')return norm(v.toJSON());return Object.fromEntries(Object.keys(v).sort().map(k=>[k,norm(v[k])]));}return v;}
const text=v=>JSON.stringify(norm(v)),hash=v=>crypto.createHash('sha256').update(text(v)).digest('hex');
(async()=>{
 const u=new URL(process.env.DATABASE_URL);must(u.protocol==='mysql:'&&u.hostname==='db'&&['','3306'].includes(u.port)&&u.pathname==='/massajoy2_three_end_49605b07');
 must(process.env.NODE_ENV==='test'&&process.env.THREE_END_SYNTHETIC_ONLY==='49605b07'&&process.env.PAYMENT_PROVIDER==='disabled'&&process.env.PAYMENT_EXTERNAL_ENABLED!=='true'&&process.env.FCM_ENABLED!=='true'&&process.env.NOTIFICATION_WORKER_ENABLED!=='true');
 must(args.database==='massajoy2_three_end_49605b07'&&args.shops.length===3&&args.shops.map(x=>x.kind).join(',')==='blank,conflict,stale'&&/^[a-f0-9]{8}$/.test(args.suffix));
 const result=await p.$transaction(async tx=>{
  const db=await tx.$queryRawUnsafe('SELECT DATABASE() AS name');must(db[0].name===args.database);
  const originals=await tx.shop.findMany({where:{id:{in:args.shops.map(x=>BigInt(x.id))}}});must(originals.length===3);
  for(const f of args.shops){const s=originals.find(x=>String(x.id)===f.id);must(s&&s.name===f.name&&s.shortName===f.shortName&&s.status==='PENDING'&&s.deletedAt===null&&s.name.startsWith('Synthetic Intake ')&&s.shortName==='intake-'+args.suffix+'-'+f.kind);}
  const tables=await tx.$queryRawUnsafe('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\'BASE TABLE\' ORDER BY TABLE_NAME');
  const columns=await tx.$queryRawUnsafe('SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');
  const indexes=await tx.$queryRawUnsafe('SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX');
  const summaries=[],structures=[],seenSessions=[],seenAudit=[];
  for(const {name} of tables){must(/^[a-zA-Z0-9_]+$/.test(name));let rows=await tx.$queryRawUnsafe('SELECT * FROM \x60'+name+'\x60');const total=rows.length;
   const ddl=await tx.$queryRawUnsafe('SHOW CREATE TABLE \x60'+name+'\x60');must(ddl.length===1);structures.push({name,ddl:hash(String(ddl[0]['Create Table']).replace(/AUTO_INCREMENT=\d+/g,'AUTO_INCREMENT=<counter>'))});
   if(name==='shops')rows=rows.map(row=>args.shops.some(f=>f.id===String(row.id))?Object.fromEntries(Object.entries(row).filter(([key])=>!['description','business_hours','updated_at'].includes(key))):row);
   if(name==='auth_sessions')rows=rows.filter(row=>{const session=args.sessions.find(x=>x.id===row.id);if(!session)return true;must(String(row.user_id)===session.userId&&(!args.requireRevoked||row.revoked_at!==null)&&new Date(row.created_at).getTime()>=args.startedAt-2000);seenSessions.push(row.id);return false;});
   if(name==='audit_logs')rows=rows.filter(row=>{let d=row.detail;if(typeof d==='string')d=JSON.parse(d);const expected=args.audit.find(a=>a.state==='APPLIED'?d?.receipt?.operationId===a.operationId:d?.state==='NOT_APPLIED'&&d.packageDigest===a.packageDigest&&d.resolvedAt===a.resolvedAt);if(!expected)return true;
    must(row.action==='PUBLIC_INTAKE_APPLY'&&row.target_type==='PUBLIC_INTAKE'&&String(row.target_id)===args.actorId&&String(row.operator_id)===args.actorId&&d.version===1&&/^[a-f0-9]{64}$/.test(d.requestKeyHash)&&new Date(row.created_at).getTime()>=args.startedAt-2000);
    const forbidden=v=>v&&typeof v==='object'&&(Array.isArray(v)?v.some(forbidden):Object.entries(v).some(([k,c])=>/password|secret|token|cookie|credential|description|businessHours|rawCatalog|sourceUrls|requestKey$|incoming|current/i.test(k)||forbidden(c)));must(!forbidden(d));
    if(expected.state==='APPLIED'){must(d.receipt.status==='APPLIED'&&d.packageDigest===expected.packageDigest&&d.receipt.packageDigest===expected.packageDigest);must(d.receipt.shops.every(s=>args.shops.some(f=>f.id===s.targetShopId)&&s.changedFields.every(x=>['description','businessHours'].includes(x))));}
    seenAudit.push(expected.state==='APPLIED'?expected.operationId:'NOT_APPLIED:'+expected.resolvedAt);return false;});
   summaries.push({name,total,protectedRows:rows.length,digest:hash(rows.map(text).sort())});
  }
  must(seenSessions.length===args.sessions.length&&new Set(seenSessions).size===seenSessions.length&&seenAudit.length===args.audit.length&&new Set(seenAudit).size===seenAudit.length);
  return{schemaDigest:hash({columns,indexes,structures}),tables:summaries,protectedDigest:hash(summaries.map(({name,protectedRows,digest})=>({name,protectedRows,digest}))),allowedAuthSessions:seenSessions.length,allowedReceiptRows:seenAudit.length,
   shops:originals.map(s=>({id:String(s.id),description:s.description,businessHours:s.businessHours,updatedAt:s.updatedAt})).sort((a,b)=>Number(a.id)-Number(b.id))};
 },{isolationLevel:'RepeatableRead',maxWait:5000,timeout:30000});
 console.log(JSON.stringify(norm(result)));
})().catch(()=>{process.exitCode=1}).finally(()=>p.$disconnect());
`;

export async function runPublicIntakeHttp() {
  const report = { schemaVersion: 1, target: TARGET, project: PROJECT, environmentMarker: 'THREE_END_SYNTHETIC_ONLY',
    startedAt: new Date().toISOString(), status: 'fail', passed: false, deploymentReady: false, checks: [],
    verification: 'REAL_HTTP_REAL_AUTH_AND_CONTAINER_LOCAL_DATABASE_HASHES', externalProviderCalls: 0,
    boundaries: ['Only the root-owned synthetic 50920 database. Existing 8088 and production are never addressed.',
      'Only three new synthetic PENDING shops may change description, businessHours and updatedAt. The fourth browser fixture is protected.',
      'Only this runner auth sessions and receipt-identified public-intake audit additions are exempted from full table-row hashes.',
      'Real invalid signatures and target drift are tested; clock expiry is covered by unit tests, not forged expired tokens.',
      'No identity override, provider request, catalog import, migration, seed, image restart or direct business database mutation.'] };
  const sessions = {}, audit = []; let state, fixture, secrets, containers, before, handle, previous = 0, requests = 0;
  const startedAt = Date.now(), prefix = 'intake-http-' + randomUUID().slice(0, 8);
  const key = suffix => `${prefix}-${suffix}`;
  async function check(name, action) {
    try { const evidence = await action(); report.checks.push({ name, status: 'pass', ...(evidence ? { evidence } : {}) }); }
    catch (error) { report.checks.push({ name, status: 'fail', ...safeError(error) }); throw error; }
  }
  async function raw(route, { method = 'GET', account, body, concurrent = false } = {}) {
    need(route.startsWith('/auth/') || route.startsWith(BASE + '/') || ['/health', '/payments/config', '/auth/customer/config'].includes(route), 'ONLY_AUTH_INTAKE_AND_SAFE_CONFIG_ROUTES_ALLOWED');
    need(!route.includes('\\') && !route.includes('?') && !route.includes('#'), 'FIXED_API_ROUTE_REQUIRED');
    const url = new URL('/api/v1' + route, TARGET); need(url.origin === TARGET, 'SYNTHETIC_HTTP_ORIGIN_REQUIRED');
    if (!concurrent) { const pause = 700 - (Date.now() - previous); if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause)); }
    previous = Date.now(); requests++;
    const token = account ? sessions[account]?.token : null; if (account) need(token, 'REAL_ROLE_SESSION_REQUIRED');
    let response; try { response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(40000), headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); } catch { throw new Failure('SYNTHETIC_HTTP_UNAVAILABLE'); }
    const bytes = Buffer.from(await response.arrayBuffer()); need(bytes.length <= 2_000_000, 'HTTP_RESPONSE_TOO_LARGE');
    let data; try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Failure('HTTP_JSON_RESPONSE_REQUIRED', response.status); }
    return { status: response.status, data, cache: response.headers.get('cache-control') };
  }
  function expect(result, status) { if (result.status !== status) throw new Failure('UNEXPECTED_HTTP_STATUS', result.status, result.data?.publicIntakeCode); return result.data; }
  function apiError(result, status, code) { expect(result, status); need(result.data?.publicIntakeCode === code, 'EXPECTED_SAFE_API_ERROR_CODE'); }
  const post = (route, body, account = 'admin', extra = {}) => raw(route, { method: 'POST', body, account, ...extra });
  async function preview(value) { const result = await post(BASE + '/preview', { package: value }); need(result.cache?.includes('no-store'), 'PREVIEW_MUST_NOT_CACHE'); return expect(result, 200); }
  async function apply(value, view, requestKey, extra = {}) {
    const result = await post(BASE + '/apply', { package: value, previewToken: view.previewToken, requestKey }, 'admin', extra);
    need(result.cache?.includes('no-store'), 'APPLY_MUST_NOT_CACHE'); return expect(result, 200);
  }
  const snapshot = (requireRevoked = false) => docker(['exec', '-i', `${PROJECT}-api-1`, 'node', '-e', snapshotProbe], JSON.stringify({
    database: DATABASE, suffix: fixture.suffix, shops: fixture.shops.slice(0, 3), startedAt,
    sessions: Object.values(sessions).map(s => ({ id: s.sid, userId: s.userId })), actorId: sessions.admin?.userId ?? '', audit, requireRevoked,
  }));
  const addReceipt = receipt => { if (!audit.some(a => a.operationId === receipt.operationId)) audit.push({ state: 'APPLIED', operationId: receipt.operationId, packageDigest: receipt.packageDigest }); };
  let mainPackage, mainView, mainReceipt, fenced, stalePackage, staleView, guardSnapshot;
  try {
    await fs.mkdir(path.join(ROOT, 'docs/verification'), { recursive: true });
    try { handle = await fs.open(path.join(ROOT, REPORT), 'wx', 0o600); } catch { throw new Failure('NEW_EXCLUSIVE_REPORT_REQUIRED'); }
    await check('isolation.exact_synthetic_stack_fixture_and_all_table_baseline', async () => {
      state = await privateJson(STATE); fixture = await privateJson(FIXTURE);
      need(state.project === PROJECT && state.database === DATABASE && state.origin === TARGET
        && path.resolve(ROOT, state.secretsFile) === path.join(ROOT, PRIVATE), 'EXACT_SYNTHETIC_STATE_REQUIRED');
      need(fixture.passed === true && fixture.database === DATABASE && fixture.origin === TARGET && /^[a-f0-9]{8}$/.test(fixture.suffix)
        && fixture.shops?.length === 4 && fixture.shops.map(s => s.kind).join(',') === 'blank,conflict,stale,browser'
        && fixture.shops.map(s => s.id).join(',') === '3,4,5,6', 'EXACT_FOUR_SYNTHETIC_FIXTURES_REQUIRED');
      need(fixture.shops.every(s => /^[1-9]\d*$/.test(s.id) && s.name === `Synthetic Intake ${s.kind} ${fixture.suffix}`
        && s.shortName === `intake-${fixture.suffix}-${s.kind}`), 'SYNTHETIC_FIXTURE_IDENTITIES_REQUIRED');
      secrets = validateThreeEndSecrets(await privateJson(PRIVATE), TARGET);
      containers = Object.fromEntries(['db', 'api', 'web'].map(service => [service, inspect(service)]));
      before = snapshot();
      const empty = v => v == null || canonical(v) === '{}';
      need(before.shops[0].description == null && empty(before.shops[0].businessHours)
        && before.shops[1].description === 'Existing synthetic description' && empty(before.shops[1].businessHours)
        && before.shops[2].description == null && empty(before.shops[2].businessHours), 'FRESH_UNMODIFIED_INTAKE_FIXTURES_REQUIRED');
      need(expect(await raw('/health'), 200).status === 'healthy' && expect(await raw('/payments/config'), 200).enabled === false, 'SAFE_SYNTHETIC_HEALTH_REQUIRED');
      const config = expect(await raw('/auth/customer/config'), 200);
      need(['google', 'apple', 'emailOtp'].every(p => config[p]?.enabled === false), 'EXTERNAL_IDENTITY_MUST_REMAIN_DISABLED');
      return { tables: before.tables.length, allowedSyntheticTargets: 3, protectedBrowserFixture: true, apiImage: containers.api.image, webImage: containers.web.image };
    });
    const source = (kind, value = {}) => {
      const shop = fixture.shops.find(s => s.kind === kind);
      return { sourceEntity: 'merchant', sourceId: String(900000 + Number(shop.id)), targetShopId: shop.id,
        match: { name: shop.name, shortName: shop.shortName }, sourceUrls: ['https://app.asianmassagebook.com/merchant#/merchant/setting'], ...value };
    };
    const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, [{ start: '09:00', end: '21:00' }]]));
    const pack = (suffix, shops) => ({ schemaVersion: 1, sourceSystem: 'massajoy1', batchId: key(suffix), capturedAt: new Date(startedAt).toISOString(), shops });
    const incoming = 'Synthetic public profile ' + fixture.suffix;
    mainPackage = pack('main', [source('blank', { description: incoming, businessHours: hours,
      rawCatalog: [{ sourceProjectId: '999001', name: 'Synthetic evidence only', currency: null, priceBasis: null, variants: [{ name: 'Synthetic 30 min', rawPrice: '50.00', durationMinutes: 30 }] }] }),
    source('conflict', { description: 'Different incoming synthetic description', businessHours: hours })]);
    await check('authentication.real_admin_merchant_customer_staff_sessions', async () => {
      for (const [name, role] of [['admin', 'ADMIN'], ['merchant', 'MERCHANT'], ['customer', 'CUSTOMER'], ['staff', 'STAFF']]) {
        const credential = secrets[name], route = name === 'customer' ? '/auth/customer/password/login' : '/auth/login';
        const body = name === 'customer' ? { email: credential.identifier, password: credential.password } : { identifier: credential.identifier, password: credential.password };
        const result = expect(await raw(route, { method: 'POST', body }), 200);
        need(result.user?.role === role && typeof result.accessToken === 'string' && typeof result.refreshToken === 'string', 'REAL_LOGIN_ROLE_CONTRACT');
        let claims; try { claims = JSON.parse(Buffer.from(result.accessToken.split('.')[1], 'base64url').toString('utf8')); } catch { throw new Failure('REAL_JWT_SESSION_ID_REQUIRED'); }
        need(/^[a-f0-9-]{36}$/.test(claims.sid ?? '') && claims.sub === result.user.id, 'REAL_JWT_SESSION_ID_REQUIRED');
        sessions[name] = { token: result.accessToken, refresh: result.refreshToken, sid: claims.sid, userId: result.user.id };
      }
      return { realLogins: 4, identityOverrides: false, browserCookieJarUsed: false };
    });
    await check('authorization.all_four_intake_routes_reject_non_admin_roles', async () => {
      for (const account of [null, 'merchant', 'customer', 'staff']) for (const [route, body] of [
        [BASE + '/preview', { package: mainPackage }], [BASE + '/apply', { package: mainPackage, previewToken: 'invalid.signature', requestKey: key('deny') }],
        [BASE + '/resolve', { requestKey: key('deny'), packageDigest: sha(mainPackage) }], [BASE + '/result/' + key('deny'), undefined],
      ]) expect(await raw(route, { method: body === undefined ? 'GET' : 'POST', body, account }), account ? 403 : 401);
      return { deniedRequests: 16 };
    });
    await check('validation.invalid_schema_fields_identity_duplicates_and_hours_fail_closed', async () => {
      apiError(await post(BASE + '/preview', { package: { ...mainPackage, sourceSystem: 'massajoy15' } }), 400, 'PACKAGE_CONTRACT_INVALID');
      apiError(await post(BASE + '/preview', { package: { ...mainPackage, extra: 'reject' } }), 400, 'PACKAGE_CONTRACT_INVALID');
      const cases = [
        { ...copy(mainPackage), shops: [{ ...copy(mainPackage.shops[0]), ownerId: '1' }] },
        { ...copy(mainPackage), shops: [{ ...copy(mainPackage.shops[0]), match: { ...mainPackage.shops[0].match, name: 'Wrong synthetic match' } }] },
        { ...copy(mainPackage), shops: [copy(mainPackage.shops[0]), copy(mainPackage.shops[0])] },
        { ...copy(mainPackage), shops: [{ ...copy(mainPackage.shops[0]), businessHours: { ...hours, mon: [{ start: '12:00', end: '11:00' }] } }] },
      ];
      for (const value of cases) { const view = await preview(value); need(!view.canApply && view.previewToken === null && view.summary.invalidShops > 0, 'INVALID_ROW_MUST_BLOCK_ENTIRE_BATCH'); }
      const noWrite = snapshot(); same(noWrite.protectedDigest, before.protectedDigest, 'VALIDATION_CHANGED_PROTECTED_ROWS');
      same(noWrite.shops, before.shops, 'INVALID_REQUEST_CHANGED_SHOPS');
      return { invalidPackages: 6, wholeBatchBlocked: true };
    });
    await check('preview.fill_existing_keep_raw_catalog_warning_and_no_mutation', async () => {
      mainView = await preview(mainPackage);
      need(mainView.canApply && mainView.summary.fillFields === 3 && mainView.summary.keptFields === 1 && mainView.summary.rawCatalogItems === 1
        && typeof mainView.previewToken === 'string' && Date.parse(mainView.expiresAt) > Date.now(), 'PREVIEW_FILL_KEEP_COUNTS');
      need(mainView.shops[0].issues.some(i => i.code === 'CATALOG_NOT_IMPORTED')
        && mainView.shops[1].fields.find(f => f.field === 'description')?.state === 'KEEP_EXISTING', 'KEEP_OR_RAW_CATALOG_WARNING_MISSING');
      same(snapshot().shops, before.shops, 'PREVIEW_CHANGED_SHOPS');
      return { fillFields: 3, keptFields: 1, rawCatalogEvidenceOnly: true, sourceTimezoneAndPriceBasisNotInferred: true };
    });
    await check('preview.invalid_signature_is_rejected_without_writes', async () => {
      const [payload, signature] = mainView.previewToken.split('.');
      const invalid = payload + '.' + (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1);
      apiError(await post(BASE + '/apply', { package: mainPackage, previewToken: invalid, requestKey: key('bad-signature') }), 400, 'PREVIEW_INVALID');
      same(snapshot().shops, before.shops, 'INVALID_SIGNATURE_CHANGED_SHOPS');
    });
    await check('recovery.absent_result_resolve_fence_rejects_delayed_apply', async () => {
      const requestKey = key('closed');
      same(expect(await raw(BASE + '/result/' + requestKey, { account: 'admin' }), 200), { found: false }, 'UNKNOWN_RESULT_MUST_NOT_INFER_FAILURE');
      fenced = expect(await post(BASE + '/resolve', { requestKey, packageDigest: mainView.packageDigest }), 200);
      need(fenced.found && fenced.state === 'NOT_APPLIED' && fenced.packageDigest === mainView.packageDigest, 'ABSENT_RESOLVE_MUST_WRITE_TERMINAL_FENCE');
      audit.push({ state: 'NOT_APPLIED', packageDigest: fenced.packageDigest, resolvedAt: fenced.resolvedAt });
      same(expect(await post(BASE + '/resolve', { requestKey, packageDigest: mainView.packageDigest }), 200), fenced, 'RESOLVE_FENCE_MUST_REPLAY');
      apiError(await post(BASE + '/apply', { package: mainPackage, previewToken: mainView.previewToken, requestKey }), 409, 'REQUEST_CLOSED');
      same(expect(await raw(BASE + '/result/' + requestKey, { account: 'admin' }), 200), fenced, 'GET_MUST_RETURN_TERMINAL_FENCE');
      same(snapshot().shops, before.shops, 'TERMINAL_FENCE_CHANGED_SHOPS');
      return { absentMeansUnknown: true, durableFence: true, delayedApplyBlocked: true };
    });
    await check('atomicity.real_target_drift_blocks_entire_multi_shop_batch', async () => {
      const combined = pack('stale-batch', [source('blank', { description: 'Must remain unfilled after stale batch' }), source('stale', { description: 'Original stale incoming' })]);
      const oldView = await preview(combined); need(oldView.canApply && oldView.summary.fillFields === 2, 'FRESH_ATOMIC_PREVIEW_REQUIRED');
      stalePackage = pack('stale-winner', [source('stale', { description: 'Synthetic winning value ' + fixture.suffix })]); staleView = await preview(stalePackage);
      const won = await apply(stalePackage, staleView, key('stale-winner')); addReceipt(won);
      need(won.summary.changedFields === 1 && won.summary.changedShops === 1, 'SINGLE_REAL_DRIFT_WRITE_REQUIRED');
      apiError(await post(BASE + '/apply', { package: combined, previewToken: oldView.previewToken, requestKey: key('stale-loser') }), 409, 'TARGET_CHANGED');
      const after = snapshot(); same(after.shops[0], before.shops[0], 'STALE_MULTI_BATCH_PARTIALLY_WROTE_FIRST_SHOP');
      need(after.shops[2].description === stalePackage.shops[0].description, 'STALE_BATCH_OVERWROTE_WINNING_VALUE');
      return { realIndependentApplyCreatedDrift: true, multiShopRollback: true };
    });
    await check('apply.same_key_concurrent_requests_commit_one_receipt_and_three_fields', async () => {
      const requestKey = key('main');
      const outcomes = await Promise.allSettled([apply(mainPackage, mainView, requestKey, { concurrent: true }), apply(mainPackage, mainView, requestKey, { concurrent: true })]);
      const successes = outcomes.filter(x => x.status === 'fulfilled').map(x => x.value); successes.forEach(addReceipt);
      if (outcomes.some(x => x.status === 'rejected')) throw outcomes.find(x => x.status === 'rejected').reason;
      need(successes.length === 2 && successes[0].operationId === successes[1].operationId && successes.filter(x => x.replayed === false).length === 1
        && successes.filter(x => x.replayed === true).length === 1, 'CONCURRENT_KEY_MUST_COMMIT_EXACTLY_ONCE');
      mainReceipt = successes[0]; need(mainReceipt.summary.changedFields === 3 && mainReceipt.summary.changedShops === 2, 'COMMITTED_FILL_COUNTS');
      const saved = snapshot(); need(saved.shops[0].description === mainPackage.shops[0].description && saved.shops[1].description === 'Existing synthetic description', 'FILL_KEEP_NOT_PERSISTED');
      need(saved.shops[0].businessHours?.monday?.open === '09:00' && saved.shops[1].businessHours?.monday?.close === '21:00', 'NORMALIZED_HOURS_NOT_PERSISTED');
      guardSnapshot = saved;
      return { concurrentResponses: 2, committedOperations: 1, changedFields: 3, keptExistingDescription: true };
    });
    await check('idempotency.replay_ignores_old_preview_and_changed_payload_is_rejected', async () => {
      const replay = await apply(mainPackage, { previewToken: 'invalid.signature' }, key('main'));
      need(replay.replayed && replay.operationId === mainReceipt.operationId, 'COMMITTED_REPLAY_MUST_PRECEDE_PREVIEW_VALIDATION');
      const changed = { ...copy(mainPackage), batchId: key('other-package') };
      apiError(await post(BASE + '/apply', { package: changed, previewToken: mainView.previewToken, requestKey: key('main') }), 409, 'REQUEST_KEY_REUSED');
      same(snapshot().shops, guardSnapshot.shops, 'REPLAY_OR_DIFFERENT_PAYLOAD_WROTE_SHOPS');
    });
    await check('recovery.committed_get_and_resolve_return_identical_original_receipt', async () => {
      const result = expect(await raw(BASE + '/result/' + key('main'), { account: 'admin' }), 200);
      need(result.found && result.state === 'APPLIED' && result.receipt.operationId === mainReceipt.operationId, 'COMMITTED_RESULT_NOT_FOUND');
      const resolved = expect(await post(BASE + '/resolve', { requestKey: key('main'), packageDigest: mainView.packageDigest }), 200);
      same(resolved, result, 'RESOLVE_MUST_RETURN_COMMITTED_RESULT');
      apiError(await post(BASE + '/resolve', { requestKey: key('main'), packageDigest: sha({ synthetic: 'different' }) }), 409, 'REQUEST_KEY_REUSED');
    });
    await check('repeat.preview_unchanged_keep_and_invalid_all_closed_source_does_not_overwrite', async () => {
      const repeated = await preview(mainPackage);
      need(!repeated.canApply && repeated.previewToken === null && repeated.summary.fillFields === 0
        && repeated.summary.unchangedFields === 3 && repeated.summary.keptFields === 1, 'REPEAT_PREVIEW_MUST_HAVE_NO_WRITES');
      const closed = pack('closed-hours', [source('conflict', { businessHours: Object.fromEntries(Object.keys(hours).map(d => [d, []])) })]);
      const closedView = await preview(closed);
      need(!closedView.canApply && closedView.summary.invalidShops === 1 && closedView.shops[0].issues.some(i => i.code === 'HOURS_INVALID'), 'ALL_CLOSED_SOURCE_MUST_BE_REJECTED_WITHOUT_WRITES');
      same(snapshot().shops, guardSnapshot.shops, 'UNCHANGED_PREVIEW_MUTATED_SHOPS');
      return { unchangedFields: 3, existingValuesRetained: true, repeatApplyNotOffered: true };
    });
  } catch (error) { report.error = safeError(error); }
  finally {
    if (before) {
      await check('preservation.logout_and_all_other_table_rows_schema_catalog_and_browser_fixture_unchanged', async () => {
        for (const [name, session] of Object.entries(sessions)) {
          const route = name === 'customer' ? '/auth/customer/logout' : '/auth/logout';
          expect(await raw(route, { method: 'POST', body: { refreshToken: session.refresh } }), 200);
        }
        const after = snapshot(true); same(after.schemaDigest, before.schemaDigest, 'SCHEMA_CHANGED');
        same(after.protectedDigest, before.protectedDigest, 'NON_ALLOWLISTED_ROWS_CHANGED');
        for (const service of ['db', 'api', 'web']) { const final = inspect(service); need(final.id === containers[service].id && final.image === containers[service].image, 'SYNTHETIC_CONTAINER_CHANGED_DURING_TEST'); }
        report.databaseEvidence = { tables: before.tables.length, sourceSchemaDigest: before.schemaDigest, finalSchemaDigest: after.schemaDigest,
          beforeProtectedRowsDigest: before.protectedDigest, afterProtectedRowsDigest: after.protectedDigest,
          allProtectedRowsUnchanged: true, allowedNewAuthSessions: after.allowedAuthSessions, allowedNewReceiptRows: after.allowedReceiptRows,
          allowedShopFields: ['description', 'businessHours', 'updatedAt'], serviceCatalogAndAllOtherShopsUnchanged: true, browserFixtureUntouched: true };
        return { protectedTables: before.tables.length, receipts: after.allowedReceiptRows, authSessionsRevoked: after.allowedAuthSessions, noCatalogImport: true };
      }).catch(error => { report.error ??= safeError(error); });
    }
    report.finishedAt = new Date().toISOString(); report.requestCount = requests;
    report.counts = { pass: report.checks.filter(x => x.status === 'pass').length, fail: report.checks.filter(x => x.status === 'fail').length };
    report.passed = !report.error && report.counts.fail === 0 && report.counts.pass === 13;
    report.status = report.passed ? 'pass_for_synthetic_public_profile_intake_scope' : 'fail';
    if (handle) { try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n'); } finally { await handle.close(); } }
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    need(process.argv.length === 3 && process.argv[2] === ACK, 'EXPLICIT_FIXED_SYNTHETIC_ACK_REQUIRED');
    const report = await runPublicIntakeHttp();
    console.log(JSON.stringify({ passed: report.passed, status: report.status, checks: report.counts, requestCount: report.requestCount, report: REPORT,
      ...(report.error ? { error: report.error } : {}) })); process.exitCode = report.passed ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ passed: false, ...safeError(error) })); process.exitCode = 1; }
}
