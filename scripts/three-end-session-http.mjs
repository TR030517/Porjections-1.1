/** Real auth-only HTTP acceptance on the root-owned synthetic deployment. */
import { readFile, lstat, writeFile } from 'node:fs/promises';
import { resolve, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposableOrigin } from './phase5-http-integration.mjs';
import { validateThreeEndSecrets } from './three-end-http.mjs';

class Failure extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }
const need = (value, code) => { if (!value) throw new Failure(code); };
const CUSTOMER = 'massajoy_customer_refresh', MANAGEMENT = 'massajoy_refresh';
const CUSTOMER_PATH = '/api/v1/auth/customer', MANAGEMENT_PATH = '/api/v1/auth';

export async function runSessionIsolation({ target, secrets, reportFile }) {
  target = disposableOrigin(target); validateThreeEndSecrets(secrets, target);
  try { await lstat(reportFile); throw new Failure('NEW_REPORT_REQUIRED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const checks = [], jar = new Map(), tokens = {}; let requestCount = 0, previousRequest = 0;
  const request = async (route, { body, token, browser = true, cookie, origin = target, site = 'same-origin' } = {}) => {
    need(route.startsWith('/auth/') || ['/health', '/payments/config'].includes(route), 'AUTH_ONLY_ROUTE_REQUIRED');
    const wait = 700 - (Date.now() - previousRequest); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    const path = '/api/v1' + route;
    const selectedCookies = cookie === undefined ? [...jar.entries()].filter(([, row]) => path === row.path || path.startsWith(row.path + '/')).map(([name, row]) => name + '=' + row.value).join('; ') : cookie;
    let response; previousRequest = Date.now(); requestCount++;
    try { response = await fetch(target + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(browser && origin ? { Origin: origin, 'Sec-Fetch-Site': site } : {}), ...(browser && selectedCookies ? { Cookie: selectedCookies } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) }); } catch { throw new Failure('AUTH_HTTP_UNAVAILABLE'); }
    let data; try { data = await response.json(); } catch { throw new Failure('AUTH_RESPONSE_NOT_JSON', response.status); }
    const setCookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
    for (const value of browser ? setCookies.filter(Boolean) : []) {
      const [pair, ...attributes] = value.split(';'), split = pair.indexOf('='), name = pair.slice(0, split), token = pair.slice(split + 1);
      need([CUSTOMER, MANAGEMENT].includes(name), 'UNEXPECTED_AUTH_COOKIE');
      const path = attributes.find(value => /^\s*path=/i.test(value))?.trim().slice(5);
      if (!token) jar.delete(name); else jar.set(name, { path, value: token });
    }
    return { status: response.status, data, setCookies: setCookies.filter(Boolean) };
  };
  const status = (result, expected) => { if (result.status !== expected) throw new Failure('AUTH_UNEXPECTED_STATUS', result.status); return result; };
  const cookie = (result, name, path) => {
    need(result.setCookies.length === 1 && result.setCookies[0].startsWith(name + '='), 'WRONG_COOKIE_NAMESPACE');
    need(result.setCookies[0].includes('Path=' + path + ';') && /;\s*HttpOnly(?:;|$)/i.test(result.setCookies[0]) && /;\s*SameSite=Strict(?:;|$)/i.test(result.setCookies[0]), 'COOKIE_SECURITY_OR_PATH_INVALID');
    need(!Object.hasOwn(result.data, 'refreshToken'), 'BROWSER_REFRESH_TOKEN_EXPOSED');
  };
  const me = async (token, expected = 200) => status(await request('/auth/me', { token }), expected);
  const check = async (name, action) => { try { await action(); checks.push({ name, status: 'pass' }); } catch (error) { checks.push({ name, status: 'fail', code: error instanceof Failure ? error.code : 'AUTH_ASSERTION_FAILED', ...(error.status ? { httpStatus: error.status } : {}) }); throw error; } };
  const report = { schemaVersion: 1, status: 'running', passed: false, deploymentReady: false, target, startedAt: new Date().toISOString(),
    scope: 'Actual auth-only fetch, same-origin cookie jar, real DB/JWT sessions on the new synthetic deployment; no business mutation.',
    externalProviderCalls: 0, checks };
  try {
    await check('runtime.healthy_and_external_payments_disabled', async () => {
      need(['ok', 'healthy'].includes(status(await request('/health'), 200).data.status), 'HEALTH_UNAVAILABLE');
      need(status(await request('/payments/config'), 200).data.enabled === false, 'PAYMENTS_MUST_REMAIN_DISABLED');
    });
    await check('management.username_login_uses_original_secure_cookie', async () => {
      const result = status(await request('/auth/login', { body: { identifier: secrets.admin.identifier, password: secrets.admin.password } }), 200);
      cookie(result, MANAGEMENT, MANAGEMENT_PATH); need(result.data.user.role === 'ADMIN', 'ADMIN_ROLE_MISMATCH'); tokens.admin = result.data.accessToken;
    });
    await check('customer.email_login_preserves_management_cookie_and_access', async () => {
      const saved = jar.get(MANAGEMENT)?.value;
      const result = status(await request('/auth/customer/password/login', { body: { email: secrets.customer.identifier, password: secrets.customer.password } }), 200);
      cookie(result, CUSTOMER, CUSTOMER_PATH); need(result.data.user.role === 'CUSTOMER' && result.data.user.id === secrets.fixture.customerId, 'CUSTOMER_IDENTITY_MISMATCH'); tokens.customer = result.data.accessToken;
      need(jar.get(MANAGEMENT)?.value === saved && jar.size === 2, 'CUSTOMER_OVERWROTE_MANAGEMENT_COOKIE'); await me(tokens.admin); await me(tokens.customer);
    });
    await check('customer_refresh_rotates_only_customer_and_retains_admin_session', async () => {
      const saved = jar.get(MANAGEMENT)?.value, oldCustomer = tokens.customer;
      const result = status(await request('/auth/customer/refresh', { body: {} }), 200); cookie(result, CUSTOMER, CUSTOMER_PATH);
      need(result.data.user.role === 'CUSTOMER' && jar.get(MANAGEMENT)?.value === saved, 'CUSTOMER_REFRESH_CHANGED_MANAGEMENT'); tokens.customer = result.data.accessToken;
      await me(oldCustomer, 401); await me(tokens.customer); await me(tokens.admin);
    });
    await check('management_refresh_retains_customer_access', async () => {
      const saved = jar.get(CUSTOMER)?.value, oldAdmin = tokens.admin;
      const result = status(await request('/auth/refresh', { body: {} }), 200); cookie(result, MANAGEMENT, MANAGEMENT_PATH);
      need(result.data.user.role === 'ADMIN' && jar.get(CUSTOMER)?.value === saved, 'MANAGEMENT_REFRESH_CHANGED_CUSTOMER'); tokens.admin = result.data.accessToken;
      tokens.adminCookie = MANAGEMENT + '=' + jar.get(MANAGEMENT).value;
      await me(oldAdmin, 401); await me(tokens.admin); await me(tokens.customer);
    });
    await check('customer_cookie_csrf_negative_paths_do_not_revoke_session', async () => {
      status(await request('/auth/customer/refresh', { body: {}, origin: null }), 403);
      status(await request('/auth/customer/logout', { body: {}, site: 'cross-site' }), 403); await me(tokens.customer); await me(tokens.admin);
    });
    await check('wrong_cookie_namespace_cannot_rotate_the_other_session', async () => {
      const managementOnly = MANAGEMENT + '=' + jar.get(MANAGEMENT).value, customerOnly = CUSTOMER + '=' + jar.get(CUSTOMER).value;
      status(await request('/auth/customer/refresh', { body: {}, cookie: managementOnly }), 401);
      status(await request('/auth/refresh', { body: {}, cookie: customerOnly }), 401); await me(tokens.admin); await me(tokens.customer);
    });
    await check('customer_logout_clears_only_customer_cookie_and_session', async () => {
      const saved = jar.get(MANAGEMENT)?.value;
      const result = status(await request('/auth/customer/logout', { body: {} }), 200);
      need(result.setCookies.length === 1 && result.setCookies[0].startsWith(CUSTOMER + '=') && !jar.has(CUSTOMER) && jar.get(MANAGEMENT)?.value === saved, 'CUSTOMER_LOGOUT_CHANGED_MANAGEMENT');
      await me(tokens.customer, 401); await me(tokens.admin);
    });
    await check('merchant_management_reload_does_not_rotate_new_customer', async () => {
      const merchant = status(await request('/auth/login', { body: { identifier: secrets.merchant.identifier, password: secrets.merchant.password } }), 200); cookie(merchant, MANAGEMENT, MANAGEMENT_PATH); tokens.merchant = merchant.data.accessToken;
      const customer = status(await request('/auth/customer/password/login', { body: { email: secrets.customer.identifier, password: secrets.customer.password } }), 200); cookie(customer, CUSTOMER, CUSTOMER_PATH); tokens.customer = customer.data.accessToken;
      const refreshed = status(await request('/auth/refresh', { body: {} }), 200); need(refreshed.data.user.role === 'MERCHANT', 'MERCHANT_REFRESH_WRONG_ROLE'); tokens.merchant = refreshed.data.accessToken;
      await me(tokens.customer); await me(tokens.merchant);
    });
    await check('native_customer_refresh_and_logout_compatibility', async () => {
      const login = status(await request('/auth/customer/password/login', { browser: false, body: { email: secrets.customer.identifier, password: secrets.customer.password } }), 200); need(typeof login.data.refreshToken === 'string', 'NATIVE_CUSTOMER_TOKEN_MISSING');
      const next = status(await request('/auth/customer/refresh', { browser: false, body: { refreshToken: login.data.refreshToken } }), 200); need(next.data.user.role === 'CUSTOMER' && typeof next.data.refreshToken === 'string', 'NATIVE_REFRESH_ROLE_INVALID');
      status(await request('/auth/customer/refresh', { browser: false, body: { refreshToken: login.data.refreshToken } }), 401);
      status(await request('/auth/customer/logout', { browser: false, body: { refreshToken: next.data.refreshToken } }), 200); await me(next.data.accessToken, 401);
    });
    await check('customer_native_endpoints_cannot_consume_management_token', async () => {
      const login = status(await request('/auth/login', { browser: false, body: { identifier: secrets.admin.identifier, password: secrets.admin.password } }), 200);
      for (const route of ['refresh', 'logout']) status(await request('/auth/customer/' + route, { browser: false, body: { refreshToken: login.data.refreshToken } }), 401);
      await me(login.data.accessToken);
      const next = status(await request('/auth/refresh', { browser: false, body: { refreshToken: login.data.refreshToken } }), 200); need(next.data.user.role === 'ADMIN', 'REJECTED_TOKEN_WAS_CONSUMED');
      status(await request('/auth/logout', { browser: false, body: { refreshToken: next.data.refreshToken } }), 200);
    });
    await check('auth_test_sessions_are_logged_out_without_business_writes', async () => {
      status(await request('/auth/customer/logout', { body: {} }), 200); await me(tokens.customer, 401);
      status(await request('/auth/logout', { body: {} }), 200); await me(tokens.merchant, 401);
      status(await request('/auth/logout', { body: {}, cookie: tokens.adminCookie }), 200); await me(tokens.admin, 401);
    });
    report.passed = true; report.status = 'pass_for_stated_auth_isolation_scope';
  } catch { report.status = 'fail'; }
  report.finishedAt = new Date().toISOString(); report.requestCount = requestCount;
  report.counts = { pass: checks.filter(value => value.status === 'pass').length, fail: checks.filter(value => value.status === 'fail').length };
  report.boundaries = ['No credential/token/cookie/account PII emitted or persisted in this report.', 'Only new auth sessions in the explicitly disposable synthetic deployment; no booking, money or configuration mutation.',
    'Local HTTP does not validate production TLS delivery; Secure in production is covered by the separate real Nest route contract test.', 'Successful completion explicitly logs out all sessions created by this runner; revoked session audit/history rows remain.'];
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return report;
}

async function main(args) {
  try {
    const options = {}; for (let index = 0; index < args.length; index++) {
      const key = args[index]; need(!Object.hasOwn(options, key), 'ARGUMENTS_INVALID');
      if (key === '--acknowledge-auth-only-synthetic') options[key] = true;
      else if (['--target', '--secrets-file', '--report'].includes(key) && args[index + 1]) options[key] = args[++index]; else throw new Failure('ARGUMENTS_INVALID');
    }
    need(options['--acknowledge-auth-only-synthetic'], 'EXPLICIT_ACK_REQUIRED');
    const root = resolve(fileURLToPath(new URL('../', import.meta.url))), privatePath = resolve(options['--secrets-file'] ?? ''), location = relative(resolve(root, '.local'), privatePath);
    need(location && !location.startsWith('..' + sep) && location !== '..' && basename(privatePath) === 'three-end-secrets.json', 'PRIVATE_SYNTHETIC_FILE_REQUIRED');
    const reportFile = resolve(options['--report'] ?? ''), reportName = relative(resolve(root, 'docs/verification'), reportFile);
    need(reportName && !reportName.includes(sep) && /^three-end-session-[a-zA-Z0-9_.-]+\.json$/.test(reportName), 'NEW_SAFE_REPORT_REQUIRED');
    const report = await runSessionIsolation({ target: options['--target'], secrets: JSON.parse(await readFile(privatePath, 'utf8')), reportFile });
    console.log(JSON.stringify({ passed: report.passed, counts: report.counts, requestCount: report.requestCount, report: 'docs/verification/' + reportName })); process.exitCode = report.passed ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ passed: false, code: error instanceof Failure ? error.code : 'AUTH_ISOLATION_FAILED_WITHOUT_SENSITIVE_OUTPUT' })); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));
