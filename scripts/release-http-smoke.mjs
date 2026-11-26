import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_ROUTES = Object.freeze([
  '/', '/admin/', '/admin/?module=store-list', '/merchant/', '/merchant/login',
  '/merchant/price-menu?shopId=1', '/privacy', '/terms', '/support', '/feedback',
  '/s/ci-unavailable-shop',
]);
const MAX_BYTES = 25_000_000;
const MAX_ASSETS = 100;
const PROTECTED_PORTS = new Set(['3000', '3002', '3004', '8002', '33090']);
const SCOPE = 'GET-only isolated release-image HTTP transport, SPA/static routing and response contracts; not browser business, TLS, real-device performance or production acceptance.';

class SmokeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireCondition(value, code) { if (!value) throw new SmokeFailure(code); }
export function releaseOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new SmokeFailure('ISOLATED_LOOPBACK_ORIGIN_REQUIRED'); }
  requireCondition(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port
    && !PROTECTED_PORTS.has(url.port) && !url.username && !url.password && url.pathname === '/'
    && !url.search && !url.hash, 'ISOLATED_LOOPBACK_ORIGIN_REQUIRED');
  return url.origin;
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function safeCode(error) { return error instanceof SmokeFailure ? error.code : 'HTTP_REQUEST_FAILED'; }

export async function runReleaseHttpSmoke({ origin, timeoutMs = 15_000 } = {}) {
  origin = releaseOrigin(origin);
  requireCondition(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60_000, 'INVALID_REQUEST_TIMEOUT');
  const report = { schemaVersion: 1, scope: SCOPE, origin, startedAt: new Date().toISOString(), status: 'fail', checks: [] };
  let current = { path: '/api/v1/health', kind: 'health' };
  async function read(route, kind, mime, expectedStatus = 200) {
    current = { path: route, kind };
    const url = new URL(route, origin);
    requireCondition(url.origin === origin && !url.username && !url.password && !url.hash, 'SAME_ORIGIN_RESOURCE_REQUIRED');
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    requireCondition(response.status === expectedStatus, 'UNEXPECTED_HTTP_STATUS');
    const contentType = response.headers.get('content-type') || '';
    if (mime) requireCondition(mime.test(contentType), 'UNEXPECTED_CONTENT_TYPE');
    const length = response.headers.get('content-length');
    if (length !== null) requireCondition(/^\d+$/.test(length) && Number(length) <= MAX_BYTES, 'RESPONSE_TOO_LARGE_OR_INVALID_LENGTH');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body || []) {
      bytes += chunk.byteLength;
      requireCondition(bytes <= MAX_BYTES, 'RESPONSE_TOO_LARGE_OR_INVALID_LENGTH');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    report.checks.push({ path: route, kind, status: response.status, bytes, contentType,
      cacheControl: response.headers.get('cache-control') || '', statusVerified: true });
    return { response, body, text: body.toString('utf8') };
  }
  try {
    const health = await read('/api/v1/health', 'health', /application\/json/i);
    requireCondition(/(?:^|,)\s*no-store\b/i.test(health.response.headers.get('cache-control') || ''), 'HEALTH_CACHE_MUST_BE_NO_STORE');
    let body; try { body = JSON.parse(health.text); } catch { throw new SmokeFailure('INVALID_HEALTH_JSON'); }
    requireCondition(body?.status === 'healthy' && body.app === 'Massajoy2.0' && body.version === '2.0.0'
      && typeof body.timestamp === 'string' && Number.isFinite(Date.parse(body.timestamp)), 'INVALID_HEALTH_CONTRACT');
    const assets = new Set(['/flutter_bootstrap.js', '/flutter.js', '/main.dart.js', '/manifest.json']);
    for (const route of RELEASE_ROUTES) {
      const first = await read(route, 'route', /text\/html/i);
      requireCondition(/<html[\s>]/i.test(first.text), 'EXPECTED_FRONTEND_HTML');
      requireCondition(/\b(?:no-cache|no-store)\b/i.test(first.response.headers.get('cache-control') || ''), 'HTML_MUST_REVALIDATE');
      const refreshed = await read(route, 'refresh', /text\/html/i);
      requireCondition(sha256(first.body) === sha256(refreshed.body), 'REFRESH_MUST_RETURN_SAME_FROZEN_HTML');
      const baseHref = first.text.match(/<base\b[^>]*\bhref=["']([^"']+)["']/i)?.[1];
      const base = new URL(baseHref || route, origin);
      requireCondition(base.origin === origin && !base.username && !base.password, 'SAME_ORIGIN_BASE_REQUIRED');
      for (const match of first.text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
        const asset = new URL(match[1].replaceAll('&amp;', '&'), base);
        if (!/\.(?:js|css)$/i.test(asset.pathname)) continue;
        requireCondition(asset.origin === origin && !asset.username && !asset.password && !asset.hash, 'SAME_ORIGIN_ASSET_REQUIRED');
        assets.add(asset.pathname + asset.search);
        requireCondition(assets.size <= MAX_ASSETS, 'TOO_MANY_STATIC_ASSETS');
      }
    }
    for (const route of ['/admin', '/merchant']) {
      const redirect = await read(route, 'slash-redirect', null, 308);
      requireCondition(new URL(redirect.response.headers.get('location') || '', origin).href === origin + route + '/', 'INVALID_SLASH_REDIRECT');
    }
    for (const asset of assets) {
      const pathname = new URL(asset, origin).pathname;
      const mime = pathname.endsWith('.json') ? /application\/json/i
        : pathname.endsWith('.css') ? /text\/css/i : /(?:java|ecma)script/i;
      const resource = await read(asset, 'asset', mime);
      requireCondition(resource.body.length > 0 && !/^\s*(?:<!doctype\s+html\b|<html\b)/i.test(resource.text), 'STATIC_ASSET_RETURNED_HTML_OR_EMPTY');
      if (pathname.endsWith('.json')) {
        try { requireCondition(JSON.parse(resource.text)?.name?.includes('Massajoy'), 'INVALID_CUSTOMER_MANIFEST'); }
        catch (error) { if (error instanceof SmokeFailure) throw error; throw new SmokeFailure('INVALID_CUSTOMER_MANIFEST'); }
      }
    }
    report.status = 'pass';
  } catch (error) {
    // Do not serialize response bodies, exceptions, headers, cookies or tokens.
    report.failure = { ...current, code: safeCode(error) };
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node scripts/release-http-smoke.mjs --origin http://127.0.0.1:8088 --report .local/ci-image-results/container-smoke.json\nGET-only loopback candidate check; never starts Docker or reads account credentials.');
    return;
  }
  requireCondition(args.length === 4 && args[0] === '--origin' && args[2] === '--report' && args[3].length > 0, 'EXPLICIT_ORIGIN_AND_REPORT_REQUIRED');
  const report = await runReleaseHttpSmoke({ origin: args[1] });
  const destination = path.resolve(args[3]);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`Release HTTP smoke: ${report.status}; ${report.checks.length} transport checks. Sanitized report written.`);
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(safeCode(error)); process.exitCode = 1; });
}
