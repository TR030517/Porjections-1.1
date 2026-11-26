import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { RELEASE_ROUTES, releaseOrigin, runReleaseHttpSmoke } from './release-http-smoke.mjs';

const html = '<!doctype html><html><head><base href="/"><link rel="stylesheet" href="assets/main.css"></head><body><script src="flutter_bootstrap.js"></script><script src="assets/main.js"></script></body></html>';
async function fixture(t, patch = () => null) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    const custom = patch(req, requests);
    const respond = ({ status = 200, type = 'text/html', cache = 'no-cache', body = html, headers = {} } = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': cache, ...headers }); res.end(body);
    };
    if (custom) return respond(custom);
    if (req.url === '/api/v1/health') return respond({ type: 'application/json', cache: 'no-store', body: JSON.stringify({ status: 'healthy', app: 'Massajoy2.0', version: '2.0.0', timestamp: new Date().toISOString() }) });
    if (['/admin', '/merchant'].includes(req.url)) return respond({ status: 308, body: '', headers: { location: req.url + '/' } });
    if (RELEASE_ROUTES.includes(req.url)) return respond();
    if (req.url === '/manifest.json') return respond({ type: 'application/json', body: '{"name":"Massajoy"}' });
    if (req.url.endsWith('.css')) return respond({ type: 'text/css', body: 'body { color: black; }' });
    if (req.url.endsWith('.js')) return respond({ type: 'application/javascript', body: '/* bounded synthetic asset */' });
    return respond({ status: 404, body: 'missing' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}

test('origin guard requires an explicit loopback candidate and rejects protected main services or hidden URL credentials', () => {
  assert.equal(releaseOrigin('http://127.0.0.1:8088'), 'http://127.0.0.1:8088');
  for (const value of [undefined, 'https://127.0.0.1:8088', 'http://localhost:8088', 'http://example.invalid:8088', 'http://127.0.0.1', 'http://u:secret@127.0.0.1:8088', 'http://127.0.0.1:3000', 'http://127.0.0.1:3002', 'http://127.0.0.1:3004', 'http://127.0.0.1:8002', 'http://127.0.0.1:33090', 'http://127.0.0.1:8088/admin/', 'http://127.0.0.1:8088/?a=1', 'http://127.0.0.1:8088/#x']) assert.throws(() => releaseOrigin(value), { code: 'ISOLATED_LOOPBACK_ORIGIN_REQUIRED' });
});

test('candidate checks every public entry, refresh and same-origin asset using only GET, and verifies exact slash redirects', async t => {
  const { origin, requests } = await fixture(t);
  const report = await runReleaseHttpSmoke({ origin });
  assert.equal(report.status, 'pass');
  assert.equal(report.failure, undefined);
  assert.equal(requests.every(r => r.method === 'GET'), true);
  for (const path of RELEASE_ROUTES) assert.equal(requests.filter(r => r.path === path).length, 2, path);
  for (const path of ['/admin', '/merchant']) assert.equal(report.checks.some(c => c.path === path && c.kind === 'slash-redirect' && c.status === 308), true);
  assert.equal(report.checks.filter(c => c.kind === 'asset').length, 6);
  assert.match(report.scope, /not browser business/);
});

test('a 200 health response with a failed database contract is rejected without leaking its body', async t => {
  const { origin } = await fixture(t, req => req.url === '/api/v1/health' ? { type: 'application/json', cache: 'no-store', body: '{"status":"unhealthy","secret":"DO_NOT_SERIALIZE"}' } : null);
  const report = await runReleaseHttpSmoke({ origin });
  assert.equal(report.status, 'fail'); assert.equal(report.failure.code, 'INVALID_HEALTH_CONTRACT');
  assert.equal(JSON.stringify(report).includes('DO_NOT_SERIALIZE'), false);
});

test('health must be no-store and HTML must revalidate rather than accepting a cached candidate', async t => {
  for (const [target, expected] of [['/api/v1/health', 'HEALTH_CACHE_MUST_BE_NO_STORE'], ['/', 'HTML_MUST_REVALIDATE']]) {
    const { origin } = await fixture(t, req => req.url === target ? { cache: 'public, max-age=86400', type: target === '/' ? 'text/html' : 'application/json', body: target === '/' ? html : '{}' } : null);
    const report = await runReleaseHttpSmoke({ origin });
    assert.equal(report.status, 'fail'); assert.equal(report.failure.code, expected);
  }
});

test('missing public information deep route cannot pass just because the root entry works', async t => {
  const { origin } = await fixture(t, req => req.url === '/privacy' ? { status: 404, body: 'not found' } : null);
  const report = await runReleaseHttpSmoke({ origin });
  assert.equal(report.status, 'fail'); assert.deepEqual(report.failure, { path: '/privacy', kind: 'route', code: 'UNEXPECTED_HTTP_STATUS' });
});

test('refresh must return the same frozen entry rather than a changed or unavailable app', async t => {
  const { origin } = await fixture(t, (req, requests) => req.url === '/terms' && requests.filter(r => r.path === '/terms').length === 2 ? { body: html.replace('<body>', '<body>changed') } : null);
  const report = await runReleaseHttpSmoke({ origin });
  assert.equal(report.failure.code, 'REFRESH_MUST_RETURN_SAME_FROZEN_HTML');
});

test('redirects are not followed and must target the same application slash route', async t => {
  const { origin, requests } = await fixture(t, req => req.url === '/admin' ? { status: 308, headers: { location: '/unexpected-target' }, body: '' } : null);
  const report = await runReleaseHttpSmoke({ origin });
  assert.equal(report.failure.code, 'INVALID_SLASH_REDIRECT');
  assert.equal(requests.some(r => r.path === '/unexpected-target'), false);
});

test('cross-origin assets or base URLs are refused before requesting a foreign resource', async t => {
  for (const [body, code] of [
    [html.replace('src="assets/main.js"', 'src="https://external.invalid/leak.js"'), 'SAME_ORIGIN_ASSET_REQUIRED'],
    [html.replace('href="/"', 'href="https://external.invalid/"'), 'SAME_ORIGIN_BASE_REQUIRED'],
  ]) {
    const { origin, requests } = await fixture(t, req => req.url === '/' ? { body } : null);
    const report = await runReleaseHttpSmoke({ origin });
    assert.equal(report.failure.code, code); assert.equal(requests.some(r => r.path.includes('leak')), false);
  }
});

test('SPA HTML fallback cannot pass as a JavaScript or CSS static resource, even with a false MIME', async t => {
  for (const [type, code] of [['text/html', 'UNEXPECTED_CONTENT_TYPE'], ['application/javascript', 'STATIC_ASSET_RETURNED_HTML_OR_EMPTY']]) {
    const { origin } = await fixture(t, req => req.url === '/assets/main.js' ? { type, body: html } : null);
    const report = await runReleaseHttpSmoke({ origin });
    assert.equal(report.failure.code, code); assert.equal(report.failure.path, '/assets/main.js');
  }
});

test('a redirect on an asset is not followed or mistaken for a valid bundle', async t => {
  const { origin, requests } = await fixture(t, req => req.url === '/main.dart.js' ? { status: 302, headers: { location: '/' }, body: '' } : null);
  const report = await runReleaseHttpSmoke({ origin });
  assert.equal(report.failure.code, 'UNEXPECTED_HTTP_STATUS'); assert.equal(report.failure.path, '/main.dart.js');
  assert.equal(requests.filter(r => r.path === '/').length, 2);
});

test('relative assets honor the customer base path on a nested shop link', async t => {
  const { origin, requests } = await fixture(t);
  const report = await runReleaseHttpSmoke({ origin });
  assert.equal(report.status, 'pass'); assert.equal(requests.some(r => r.path === '/s/flutter_bootstrap.js'), false);
});

test('oversized responses and malformed manifests fail with a bounded sanitized result', async t => {
  const { origin } = await fixture(t, req => req.url === '/manifest.json' ? { type: 'application/json', body: '{bad-secret-json' } : null);
  const report = await runReleaseHttpSmoke({ origin });
  assert.equal(report.failure.code, 'INVALID_CUSTOMER_MANIFEST'); assert.equal(JSON.stringify(report).includes('bad-secret'), false);
  const large = await fixture(t, req => req.url === '/api/v1/health' ? { type: 'application/json', headers: { 'content-length': '25000001' }, body: '{}' } : null);
  const oversized = await runReleaseHttpSmoke({ origin: large.origin });
  assert.equal(oversized.failure.code, 'RESPONSE_TOO_LARGE_OR_INVALID_LENGTH');
});
