import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMenuCatalog } from './menuCatalog';

test('catalog lookup preserves exact shop and parent IDs, encodes names and only sends no-store reads', async () => {
  const original = globalThis.fetch, calls: Array<{ url: string; method: string; cache?: RequestCache; body: unknown }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init?.method ?? 'GET', cache: init?.cache, body: init?.body }); return Response.json({ items: [] }); };
  try {
    await getMenuCatalog('9007199254740997', { kind: 'variant', serviceId: '9007199254740999', q: 'Body & $60', page: 2, pageSize: 25 });
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url, 'http://localhost');
    assert.equal(url.pathname, '/api/v1/reservation-admin/shops/9007199254740997/menu-catalog');
    assert.equal(url.searchParams.get('serviceId'), '9007199254740999'); assert.equal(url.searchParams.get('q'), 'Body & $60');
    assert.equal(url.searchParams.get('page'), '2'); assert.equal(calls[0].method, 'GET'); assert.equal(calls[0].cache, 'no-store'); assert.equal(calls[0].body, undefined);
  } finally { globalThis.fetch = original; }
});
test('invalid or incomplete directory scopes never fall back to a different shop or send requests', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  const query = { kind: 'service' as const, q: '', page: 1, pageSize: 25 };
  try {
    for (const id of ['0', '../1', '9223372036854775808', 9007199254740992]) assert.throws(() => getMenuCatalog(id, query));
    assert.throws(() => getMenuCatalog('5', { ...query, kind: 'variant' }));
    assert.throws(() => getMenuCatalog('5', { ...query, pageSize: 51 }));
    assert.throws(() => getMenuCatalog('5', { ...query, q: 'x'.repeat(101) }));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
