import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const TARGET = 'http://127.0.0.1:8088';
const ROOT = new URL('../', import.meta.url);
const LOGIN_FILE = new URL('.local/compose-review-login.json', ROOT);
const REPORT_FILE = new URL('docs/verification/compose-smoke.json', ROOT);
const COOKIE_NAME = 'massajoy_refresh';
const report = { schemaVersion: 1, target: TARGET, startedAt: new Date().toISOString(), status: 'blocked', checks: [] };

class CheckFailure extends Error {
  constructor(code, httpStatus, blocked = false) { super(code); this.code = code; this.httpStatus = httpStatus; this.blocked = blocked; }
}
function requireCondition(condition, code) { if (!condition) throw new CheckFailure(code); }
async function check(id, action, dependency = true) {
  if (!dependency) { report.checks.push({ id, status: 'blocked', code: 'DEPENDENCY_NOT_PASSED' }); return false; }
  try {
    const evidence = await action();
    report.checks.push({ id, status: 'pass', ...(evidence ? { evidence } : {}) });
    return true;
  } catch (error) {
    // Never serialize response bodies, thrown provider messages, cookies, tokens or identifiers.
    report.checks.push({ id, status: error instanceof CheckFailure && error.blocked ? 'blocked' : 'fail',
      code: error instanceof CheckFailure ? error.code : 'CHECK_FAILED',
      ...(error instanceof CheckFailure && Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}) });
    return false;
  }
}
function targetUrl(path) {
  const url = new URL(path, `${TARGET}/`);
  requireCondition(url.origin === TARGET && !url.username && !url.password && !url.hash, 'NONLOCAL_TARGET_REJECTED');
  return url;
}
async function request(path, { method = 'GET', body, token, cookie, browser = false, headers = {} } = {}) {
  const url = targetUrl(path);
  let response;
  try {
    response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}),
        ...(browser ? { Origin: TARGET, 'Sec-Fetch-Site': 'same-origin' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new CheckFailure('LOCAL_TARGET_UNREACHABLE_OR_TIMED_OUT', undefined, true); }
  const bytes = Buffer.from(await response.arrayBuffer());
  requireCondition(bytes.length <= 25000000, 'RESPONSE_TOO_LARGE');
  return { response, bytes, text: () => bytes.toString('utf8') };
}
function status(result, expected) {
  if (result.response.status !== expected) throw new CheckFailure('UNEXPECTED_HTTP_STATUS', result.response.status);
}
function json(result, expected = 200) {
  status(result, expected);
  requireCondition(/application\/json/i.test(result.response.headers.get('content-type') || ''), 'EXPECTED_JSON_RESPONSE');
  try { return JSON.parse(result.text()); } catch { throw new CheckFailure('INVALID_JSON_RESPONSE'); }
}
function cookies(result) {
  return typeof result.response.headers.getSetCookie === 'function' ? result.response.headers.getSetCookie() : [result.response.headers.get('set-cookie') || ''];
}
function refreshCookie(result) {
  const matching = cookies(result).filter(value => value.startsWith(`${COOKIE_NAME}=`));
  requireCondition(matching.length === 1, 'EXPECTED_ONE_REFRESH_COOKIE');
  const raw = matching[0];
  requireCondition(/;\s*HttpOnly(?:;|$)/i.test(raw) && /;\s*SameSite=Strict(?:;|$)/i.test(raw)
    && /;\s*Path=\/api\/v1\/auth(?:;|$)/i.test(raw), 'INVALID_REFRESH_COOKIE_FLAGS');
  const cookie = raw.split(';', 1)[0];
  requireCondition(cookie.length > COOKIE_NAME.length + 1, 'EMPTY_REFRESH_COOKIE');
  return cookie;
}
function noStore(result) { requireCondition(/(?:^|,)\s*no-store\b/i.test(result.response.headers.get('cache-control') || ''), 'SESSION_RESPONSE_MUST_NOT_BE_CACHED'); }
function sessionBody(data, expectedId) {
  requireCondition(data && typeof data.accessToken === 'string' && data.accessToken.length > 20
    && data.user?.role === 'ADMIN' && typeof data.user.id === 'string' && /^\d+$/.test(data.user.id)
    && !Object.hasOwn(data, 'refreshToken') && (!expectedId || data.user.id === expectedId), 'INVALID_BROWSER_ADMIN_SESSION');
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const SHOP_PERMISSIONS = ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE', 'RESERVATION_CONFIG', 'FINANCE_READ', 'SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'];
const SHOP_FIELDS = ['id', 'ownerId', 'name', 'nameEn', 'phone', 'address', 'city', 'state', 'zipCode', 'status', 'timezone', 'shopType', 'businessHours', 'description', 'createdAt', 'updatedAt', 'logoUrl', 'bannerUrl', 'gallery', 'media', 'isOwner', 'accessType', 'homeShopId', 'loginAccount', 'permissions'];
function safeMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return false;
  if (/^\/api\/v1\/upload\/media\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\/file$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
function safeJsonKeys(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || typeof value !== 'object') return true;
  return Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) => !/password|token|secret|credential|square|stripe|bank|session|authorization|cookie/i.test(key) && safeJsonKeys(item, depth + 1));
}
function safeAdminShop(item) {
  if (!exactKeys(item, SHOP_FIELDS) || !validId(item.id) || !validId(item.ownerId) || !safeJsonKeys(item)) return false;
  if (!['name', 'phone', 'address', 'city', 'state', 'zipCode'].every(key => typeof item[key] === 'string')
    || !['nameEn', 'timezone', 'description'].every(key => item[key] === null || typeof item[key] === 'string')
    || !['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].includes(item.status) || !['CERTIFIED', 'APPRENTICE'].includes(item.shopType)
    || !['createdAt', 'updatedAt'].every(key => typeof item[key] === 'string' && Number.isFinite(Date.parse(item[key])))
    || item.businessHours !== null && typeof item.businessHours !== 'object' || item.isOwner !== true || item.accessType !== 'ADMIN' || item.homeShopId !== null) return false;
  // Only the explicitly selected independent login identity is visible here.
  // Historical owner relations, contact objects, hashes and arbitrary profile
  // JSON remain outside the exact shop allowlist, even for company ADMIN.
  const login = item.loginAccount;
  if (login !== null && (!exactKeys(login, ['id', 'name', 'loginName', 'email', 'status']) || !validId(login.id)
    || !['name', 'loginName', 'email'].every(key => login[key] === null || typeof login[key] === 'string')
    || login.name !== null && login.name.length > 100 || login.loginName !== null && login.loginName.length > 64 || login.email !== null && login.email.length > 255
    || !['ACTIVE', 'SUSPENDED', 'DELETED'].includes(login.status))) return false;
  if (!Array.isArray(item.permissions) || item.permissions.length !== SHOP_PERMISSIONS.length || new Set(item.permissions).size !== SHOP_PERMISSIONS.length || !SHOP_PERMISSIONS.every(permission => item.permissions.includes(permission))) return false;
  const media = item.media;
  return exactKeys(media, ['logoUrl', 'coverUrl', 'galleryUrls', 'posterUrl']) && media.posterUrl === null
    && [media.logoUrl, media.coverUrl].every(url => url === null || safeMediaUrl(url))
    && Array.isArray(media.galleryUrls) && media.galleryUrls.length <= 20 && media.galleryUrls.every(safeMediaUrl)
    && item.logoUrl === (media.logoUrl ?? '') && item.bannerUrl === (media.coverUrl ?? '')
    && Array.isArray(item.gallery) && JSON.stringify(item.gallery) === JSON.stringify(media.galleryUrls);
}

async function frontend(id, prefix, deepPath) {
  let index;
  const loaded = await check(`${id}.index_and_assets`, async () => {
    index = await request(prefix);
    status(index, 200);
    requireCondition(/text\/html/i.test(index.response.headers.get('content-type') || '') && /<html\b/i.test(index.text()), 'EXPECTED_FRONTEND_HTML');
    const html = index.text();
    if (id === 'customer') requireCondition(/<base\b[^>]*href=["']\/["']/i.test(html), 'INVALID_CUSTOMER_BASE_PATH');
    const references = [];
    for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const value = /\b(?:src|href)=["']([^"']+)["']/i.exec(tag[0])?.[1];
      if (!value || /^<link\b/i.test(tag[0]) && !/\brel=["'](?:stylesheet|modulepreload)["']/i.test(tag[0])) continue;
      references.push(value);
    }
    if (id === 'customer') references.push('main.dart.js', 'flutter.js');
    requireCondition(references.length > 0, 'NO_FRONTEND_ASSETS_REFERENCED');
    const assets = [...new Set(references.map(value => {
      const url = new URL(value.replaceAll('&amp;', '&'), `${TARGET}${prefix}`);
      targetUrl(url.href);
      requireCondition(url.pathname.startsWith(prefix) && !url.search, 'INVALID_FRONTEND_ASSET_PATH');
      if (id !== 'customer') requireCondition(url.pathname.startsWith(`${prefix}assets/`), 'INVALID_VITE_ASSET_BASE');
      return `${url.pathname}${url.search}`;
    }))];
    for (const path of assets) {
      const asset = await request(path); status(asset, 200);
      requireCondition(asset.bytes.length > 0 && !/text\/html/i.test(asset.response.headers.get('content-type') || ''), 'ASSET_RESOLVED_TO_SPA_FALLBACK');
      const type = asset.response.headers.get('content-type') || '';
      requireCondition(path.endsWith('.css') ? /text\/css/i.test(type) : /(?:java|ecma)script/i.test(type), 'INVALID_ASSET_CONTENT_TYPE');
    }
    return { assetsChecked: assets.length };
  });
  await check(`${id}.spa_deep_url`, async () => {
    const deep = await request(deepPath); status(deep, 200);
    requireCondition(/text\/html/i.test(deep.response.headers.get('content-type') || '') && sha256(deep.bytes) === sha256(index.bytes), 'SPA_DEEP_URL_NOT_INDEX');
    return { matchesIndex: true };
  }, loaded);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node scripts/smoke-compose.mjs [--target http://127.0.0.1:8088]\nRequires ignored .local/compose-review-login.json with top-level email and password.\nWrites only sanitized results to docs/verification/compose-smoke.json. Exit: 0 pass, 1 fail, 2 blocked.');
    return;
  }
  const validArgs = args.length === 0 || args.length === 2 && args[0] === '--target' && args[1] === TARGET;
  if (!await check('preflight.fixed_local_target', async () => { requireCondition(validArgs, 'ONLY_FIXED_LOOPBACK_TARGET_ACCEPTED'); })) return finish();
  let credentials;
  const hasCredentials = await check('preflight.credentials', async () => {
    let data;
    try {
      const buffer = await readFile(LOGIN_FILE);
      if (buffer.length > 16384) throw new Error();
      data = JSON.parse(buffer.toString('utf8'));
    } catch { throw new CheckFailure('LOCAL_ADMIN_LOGIN_FILE_MISSING_OR_INVALID', undefined, true); }
    if (!data || typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)
      || typeof data.password !== 'string' || !data.password.length || Buffer.byteLength(data.password, 'utf8') > 72) {
      throw new CheckFailure('LOCAL_ADMIN_LOGIN_FIELDS_INVALID', undefined, true);
    }
    credentials = { identifier: data.email, password: data.password };
  });
  // Without the explicitly supplied account, do not pretend a partial deployment check is complete.
  if (!hasCredentials) return finish();

  await frontend('customer', '/', '/appointments/review-smoke');
  await frontend('admin', '/admin/', '/admin/stores/review-smoke');
  await frontend('merchant', '/merchant/', '/merchant/dashboard');
  for (const prefix of ['/admin', '/merchant']) await check(`${prefix.slice(1)}.slash_redirect`, async () => {
    const result = await request(prefix); status(result, 308);
    requireCondition(new URL(result.response.headers.get('location') || '', `${TARGET}/`).href === `${TARGET}${prefix}/`, 'INVALID_SUBAPP_REDIRECT');
  });
  await check('api.database_health', async () => {
    const data = json(await request('/api/v1/health'));
    requireCondition(data?.status === 'healthy' && data.app === 'Massajoy2.0' && data.version === '2.0.0' && Number.isFinite(Date.parse(data.timestamp)), 'INVALID_DATABASE_HEALTH_CONTRACT');
    return { healthy: true, contract: 'database connection and all release migrations are ready' };
  });
  await check('api.payment_disabled', async () => {
    const data = json(await request('/api/v1/payments/config'));
    requireCondition(data?.enabled === false && data.provider === 'disabled', 'PAYMENTS_MUST_REMAIN_DISABLED');
    return { enabled: false, provider: 'disabled' };
  });
  await check('auth.anonymous_studio_401', async () => status(await request('/api/v1/studio/summary'), 401));
  await check('auth.anonymous_merchant_401', async () => status(await request('/api/v1/merchant/shops'), 401));
  await check('auth.anonymous_notifications_config_401', async () => status(await request('/api/v1/notifications/config'), 401));
  await check('auth.invalid_bearer_401', async () => status(await request('/api/v1/studio/summary', { token: 'invalid-review-token' }), 401));

  let session = {}, loggedOut = false, studioStoreIds;
  const browserPost = (path, cookie, extra = {}) => request(path, { method: 'POST', body: {}, cookie, browser: true, ...extra });
  try {
    const loggedIn = await check('auth.admin_login_cookie', async () => {
      const result = await request('/api/v1/auth/login', { method: 'POST', body: credentials, browser: true });
      const data = json(result); session.cookie = refreshCookie(result); noStore(result); sessionBody(data);
      session.token = data.accessToken; session.userId = data.user.id;
      return { role: 'ADMIN', refreshInBody: false, httpOnly: true, sameSite: 'strict' };
    });
    await check('auth.direct_me_response', async () => {
      const data = json(await request('/api/v1/auth/me', { token: session.token }));
      requireCondition(data?.role === 'ADMIN' && data.id === session.userId, 'AUTH_ME_MUST_RETURN_CURRENT_USER');
    }, loggedIn);
    await check('notifications.authorized_config_disabled', async () => {
      const data = json(await request('/api/v1/notifications/config', { token: session.token }));
      requireCondition(data?.enabled === false && data.provider === 'fcm' && data.reason === 'PUSH_NOT_CONFIGURED', 'PUSH_MUST_REMAIN_DISABLED');
      requireCondition(exactKeys(data, ['enabled', 'provider', 'reason', 'inboxEnabled', 'worker']), 'PUSH_CONFIG_MUST_NOT_EXPOSE_CREDENTIAL_FIELDS');
      const worker = data.worker;
      requireCondition(exactKeys(worker, ['enabled', 'automaticRetries', 'leaseSeconds', 'externalDelivery', 'smsEnabled', 'smsReason']), 'NOTIFICATION_WORKER_CONFIG_HAS_UNEXPECTED_FIELDS');
      requireCondition(data.inboxEnabled === true && worker.enabled === true && worker.automaticRetries === 5 && worker.leaseSeconds === 120
        && worker.externalDelivery === 'PROVIDER_ACCEPTANCE_ONLY' && worker.smsEnabled === false && worker.smsReason === 'SMS_CONSENT_NOT_ESTABLISHED', 'INVALID_NOTIFICATION_INBOX_WORKER_CONTRACT');
      return { pushEnabled: false, provider: 'fcm', inboxEnabled: true, workerEnabled: true, smsEnabled: false };
    }, loggedIn);
    await check('studio.sample_counts', async () => {
      const summary = json(await request('/api/v1/studio/summary', { token: session.token }));
      requireCondition(summary?.counts?.stores === 5 && summary.counts.regions === 9, 'UNEXPECTED_STUDIO_SAMPLE_COUNTS');
      for (const [name, expected] of [['stores', 5], ['regions', 9]]) {
        const data = json(await request(`/api/v1/studio/${name}?page=1&pageSize=100`, { token: session.token }));
        requireCondition(data?.total === expected && Array.isArray(data.items) && data.items.length === expected && data.page === 1 && data.pageSize === 100, 'STUDIO_LIST_COUNTS_MUST_MATCH_SUMMARY');
        if (name === 'stores') {
          requireCondition(data.items.every(item => validId(item?.id)), 'INVALID_STUDIO_STORE_IDENTIFIERS');
          studioStoreIds = new Set(data.items.map(item => item.id));
          requireCondition(studioStoreIds.size === data.total, 'STUDIO_STORE_IDS_MUST_BE_UNIQUE_AND_COMPLETE');
        }
      }
      return { stores: 5, regions: 9 };
    }, loggedIn);
    await check('auth.admin_merchant_scope_matches_studio', async () => {
      const items = json(await request('/api/v1/merchant/shops', { token: session.token }));
      requireCondition(Array.isArray(items) && items.every(safeAdminShop), 'ADMIN_MERCHANT_SHOPS_MUST_USE_SAFE_PROJECTION');
      const ids = new Set(items.map(item => item.id));
      requireCondition(studioStoreIds instanceof Set && ids.size === items.length && ids.size === studioStoreIds.size
        && [...ids].every(id => studioStoreIds.has(id)), 'ADMIN_MERCHANT_SCOPE_MUST_MATCH_ALL_UNDELETED_STUDIO_STORES');
      return { shopsChecked: items.length, scopeMatchesStudio: true, identifiersEmitted: false };
    }, loggedIn && studioStoreIds instanceof Set);
    await check('auth.cookie_csrf_missing_origin_403', async () => status(await request('/api/v1/auth/refresh', { method: 'POST', body: {}, cookie: session.cookie }), 403), loggedIn);
    await check('auth.cookie_csrf_untrusted_origin_403', async () => status(await browserPost('/api/v1/auth/refresh', session.cookie, { headers: { Origin: 'https://untrusted.invalid', 'Sec-Fetch-Site': 'cross-site' } }), 403), loggedIn);
    await check('auth.cookie_csrf_cross_site_403', async () => status(await browserPost('/api/v1/auth/refresh', session.cookie, { headers: { Origin: TARGET, 'Sec-Fetch-Site': 'cross-site' } }), 403), loggedIn);
    const previous = { ...session };
    const refreshed = await check('auth.cookie_refresh_rotation', async () => {
      const result = await browserPost('/api/v1/auth/refresh', session.cookie);
      const data = json(result); const cookie = refreshCookie(result);
      session.cookie = cookie; noStore(result); sessionBody(data, previous.userId);
      requireCondition(cookie !== previous.cookie && data.accessToken !== previous.token, 'REFRESH_MUST_ROTATE_SESSION');
      session.token = data.accessToken;
      return { rotated: true, refreshInBody: false };
    }, loggedIn);
    await check('auth.rotated_refresh_replay_401', async () => status(await browserPost('/api/v1/auth/refresh', previous.cookie), 401), refreshed);
    await check('auth.rotated_access_rejected_401', async () => status(await request('/api/v1/auth/me', { token: previous.token }), 401), refreshed);
    await check('auth.refreshed_access_accepted', async () => {
      const data = json(await request('/api/v1/auth/me', { token: session.token }));
      requireCondition(data?.id === session.userId && data.role === 'ADMIN', 'REFRESHED_IDENTITY_MISMATCH');
    }, refreshed);
    loggedOut = await check('auth.logout_revokes_session', async () => {
      const result = await browserPost('/api/v1/auth/logout', session.cookie);
      requireCondition(json(result)?.success === true, 'LOGOUT_NOT_CONFIRMED'); noStore(result);
      requireCondition(cookies(result).some(value => value.startsWith(`${COOKIE_NAME}=;`) && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(value)), 'LOGOUT_MUST_CLEAR_COOKIE');
    }, loggedIn);
    await check('auth.logged_out_refresh_rejected_401', async () => status(await browserPost('/api/v1/auth/refresh', session.cookie), 401), loggedOut);
    await check('auth.logged_out_access_rejected_401', async () => status(await request('/api/v1/auth/me', { token: session.token }), 401), loggedOut && !!session.token);
  } finally {
    credentials = undefined;
    if (session.cookie && !loggedOut) await check('auth.cleanup_logout', async () => status(await browserPost('/api/v1/auth/logout', session.cookie), 200));
    session = {};
  }
  return finish();
}

async function finish() {
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const item of report.checks) counts[item.status]++;
  report.finishedAt = new Date().toISOString(); report.counts = counts;
  report.status = counts.fail ? 'fail' : counts.blocked ? 'blocked' : 'pass';
  await mkdir(new URL('docs/verification/', ROOT), { recursive: true });
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Compose smoke: ${report.status}; passed ${counts.pass}, failed ${counts.fail}, blocked ${counts.blocked}. Sanitized report: docs/verification/compose-smoke.json`);
  process.exitCode = report.status === 'pass' ? 0 : report.status === 'blocked' ? 2 : 1;
}

try { await main(); }
catch {
  report.checks.push({ id: 'runner', status: 'fail', code: 'RUNNER_FAILED_WITHOUT_SENSITIVE_OUTPUT' });
  try { await finish(); } catch { console.error('Compose smoke: unable to write the sanitized report.'); process.exitCode = 1; }
}
