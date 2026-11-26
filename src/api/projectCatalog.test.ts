import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProjectCatalog } from './projectCatalog';
test('project directory transport is a cancellable no-store explicit shop read, not a full reservation configuration lookup', async () => {
  const original = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async (url, options) => { calls.push(String(url)); assert.equal(options?.cache, 'no-store'); assert.equal(options?.body, undefined); assert.equal(options?.signal?.aborted, false); return Response.json({ items: [] }); };
  try { await getProjectCatalog('5', { search: '', status: 'inactive', serviceId: '9007199254740993', page: 1, pageSize: 1 }, new AbortController().signal); assert.match(calls[0], /shops\/5\/project-catalog/); assert.doesNotMatch(calls[0], /\/config/); }
  finally { globalThis.fetch = original; }
});
