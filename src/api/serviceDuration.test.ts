import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResource, listResourcePage } from './resources';
import { getReservationConfig } from './reservations';

test('platform service transport preserves explicit session terms and blocks a contradictory successful receipt', async () => {
  const previous = globalThis.fetch, body = { name: 'Synthetic session', durationKind: 'PER_SESSION', durationMin: 90, priceCents: 8000, shopId: '5' };
  let wrong = false;
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(String(options?.body)), body);
    return Response.json({ item: { ...body, id: '8', reservedDurationMin: wrong ? 60 : 90 } });
  };
  try {
    const saved = await createResource<any>('services', body); assert.equal(saved.durationKind, 'PER_SESSION'); assert.equal(saved.reservedDurationMin, 90);
    wrong = true; await assert.rejects(createResource('services', body), /不一致/);
  } finally { globalThis.fetch = previous; }
});

test('platform service list/config validate explicit types and inherited aliases before the editor sees them', async () => {
  const previous = globalThis.fetch;
  let service: any = { id: '8', durationKind: 'VARIABLE', durationMin: 60, variants: [{ id: '9', durationMin: 90 }] };
  globalThis.fetch = async url => Response.json(String(url).includes('/config')
    ? { shopId: '5', paymentPolicy: { payAtStoreEnabled: false }, services: [service], therapists: [], rooms: [] }
    : { items: [service], total: 1, page: 1, pageSize: 25 });
  try {
    assert.equal((await listResourcePage<any>('services')).items[0].reservedDurationMin, 60);
    assert.equal((await getReservationConfig('5')).services[0].variants[0].durationKind, 'VARIABLE');
    service = { ...service, durationKind: null }; await assert.rejects(listResourcePage('services'), /类型/);
    service = { ...service, durationKind: 'PER_SESSION', variants: [{ durationMin: 90, durationKind: 'TIMED' }] }; await assert.rejects(getReservationConfig('5'), /不一致/);
  } finally { globalThis.fetch = previous; }
});

test('platform service writes reject client supplied read aliases and invalid kinds before transport', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected transport'); };
  try {
    for (const patch of [{ reservedDurationMin: 60 }, { durationMinutes: 60 }, { durationKind: null }, { durationKind: 'ADD_ON' }, { durationMin: 0 }]) {
      await assert.rejects(createResource('services', { name: 'Synthetic', durationMin: 60, ...patch }));
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});
