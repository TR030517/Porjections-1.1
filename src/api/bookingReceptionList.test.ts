import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listResourcePage } from './resources';

test('platform booking rows retain saved participant/variant names after a live catalog rename without changing amounts or dates', async () => {
  const originalFetch = globalThis.fetch;
  const row = { id: '9', service: { name: 'Renamed live catalog' }, serviceName: 'Renamed live catalog', durationKind: 'TIMED', durationMin: 60, reservedDurationMin: 60, totalCents: 16001, paidCents: 0, startTime: '2030-01-01T10:00:00Z', items: [
    { id: '11', participantIndex: 2, sequence: 1, serviceNameSnapshot: 'Original massage', variantNameSnapshot: 'Second 60' },
    { id: '10', participantIndex: 1, sequence: 1, serviceNameSnapshot: 'Original massage', variantNameSnapshot: 'First 60' },
  ] };
  const before = structuredClone(row);
  globalThis.fetch = async () => Response.json({ items: [row], total: 1, page: 1, pageSize: 25 });
  try {
    const response = await listResourcePage<typeof row>('service-orders');
    assert.equal(response.items[0].serviceName, '顾客 1 · 第 1 段：Original massage · First 60；顾客 2 · 第 1 段：Original massage · Second 60');
    for (const key of ['totalCents', 'paidCents', 'startTime'] as const) assert.equal(response.items[0][key], row[key]);
    assert.deepEqual(response.items[0].items, row.items); assert.deepEqual(row, before);
  } finally { globalThis.fetch = originalFetch; }
});
test('only legacy rows without service segments may use the current platform service name', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ items: [{ id: '9', durationMin: 60, serviceName: 'Legacy name', items: [] }], total: 1 });
  try { assert.equal((await listResourcePage<{ serviceName: string }>('service-orders')).items[0].serviceName, 'Legacy name'); }
  finally { globalThis.fetch = originalFetch; }
});
