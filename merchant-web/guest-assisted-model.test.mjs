import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';
let vite, api, createModel, client, voucher;
before(async () => { vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' }); api = await vite.ssrLoadModule('/src/api/bookings.ts'); createModel = (await vite.ssrLoadModule('/src/pages/bookings/guestBookingModel.ts')).createGuestBookingModel; client = (await vite.ssrLoadModule('/src/api/client.ts')).default; voucher = (await vite.ssrLoadModule('/src/pages/bookings/GuestAssistedBookingModal.tsx')).guestBookingVoucher; });
after(async () => { await vite?.close(); });
const input = (patch = {}) => ({ guestSource: 'PHONE', contact: { name: 'Synthetic caller', phone: '+12025550101', email: null }, serviceId: '8', variantId: '9', date: '2035-11-10', startTime: '10:00', preferredTherapistIds: ['12'], ...patch });
const command = (patch = {}) => ({ ...input(), requestKey: '11111111-1111-4111-8111-111111111111', quoteHash: 'a'.repeat(64), quoteExpiresAt: new Date(Date.now() + 300000).toISOString(), ...patch });
const receipt = (request, patch = {}) => ({ shopId: '7', requestKey: request.requestKey, outcome: 'COMMITTED', result: { bookingId: '42', bookingNo: 'MJ-SYNTHETIC-42' }, ...patch });
const quote = request => ({ quoteHash: 'a'.repeat(64), quoteExpiresAt: new Date(Date.now() + 300000).toISOString(), totalCents: 7500, currency: 'usd', durationMin: 60, timezone: 'America/Los_Angeles', localDate: request.date, localStartTime: request.startTime, requestedTherapistIds: request.preferredTherapistIds, assignedTherapistIds: ['12'] });
const storage = () => { const entries = new Map(); return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };

test('first guest snapshots normalize international contact, accept no email and never accept account/verified/payment authority', () => {
  assert.deepEqual(api.normalizeGuestContact({ name: ' Zoë 李明 ', phone: '+44 (20) 7946-0958', email: null }), { name: 'Zoë 李明', phone: '+442079460958', email: null });
  assert.equal(api.normalizeGuestContact({ ...input().contact, email: ' Guest@Example.Test ' }).email, 'guest@example.test');
  for (const patch of [{ name: '' }, { name: 'X\nY' }, { name: 'a'.repeat(101) }, { phone: '2025550101' }, { phone: '+01234567' }, { phone: '+12025550101ext2' }, { email: 'invalid' }, { email: 'a\n@example.test' }]) assert.throws(() => api.checkedGuestInput(input({ contact: { ...input().contact, ...patch } })));
  const checked = api.checkedGuestInput(input({ customerId: '99', paymentMode: 'ONLINE', emailVerified: true }));
  for (const field of ['customerId', 'paymentMode', 'emailVerified']) assert.equal(field in checked, false);
  assert.throws(() => api.checkedGuestInput(input({ date: '2035-02-31' })));
});

test('quote and committed receipt reject a foreign shop/key, changed requested therapist or local time before releasing original command', () => {
  assert.equal(api.requireGuestQuote(quote(input()), input()).totalCents, 7500);
  for (const patch of [{ requestedTherapistIds: [] }, { assignedTherapistIds: ['13'] }, { localDate: '2035-11-11' }, { localStartTime: '11:00' }, { timezone: 'invalid' }]) assert.throws(() => api.requireGuestQuote({ ...quote(input()), ...patch }, input()));
  assert.equal(api.requireGuestOperation(receipt(command()), '7', command()).result.bookingId, '42');
  for (const patch of [{ shopId: '8' }, { requestKey: crypto.randomUUID() }, { result: { bookingId: '42', bookingNo: 'bad\nnumber' } }]) assert.throws(() => api.requireGuestOperation(receipt(command(), patch), '7', command()));
  assert.throws(() => api.requireGuestOperation({ shopId: '7', requestKey: command().requestKey, outcome: 'NOT_FOUND' }, '7', command(), true));
});

test('real adapters use guest-only creation, explicit therapist slots and empty-body locked reconciliation without any account lookup', async () => {
  const old = client.defaults.adapter, calls = [], request = command();
  client.defaults.adapter = async config => { calls.push(config); const data = config.url.endsWith('quote') ? quote(input()) : config.url === '/merchant/shops/7/assisted-slots' ? { date: input().date, timezone: 'America/Los_Angeles', durationMin: 60, slots: [{ time: '10:00', available: true }] } : config.url.endsWith('/reconcile') ? { shopId: '7', requestKey: request.requestKey, outcome: 'NOT_EXECUTED' } : receipt(request); return { config, data, status: 200, statusText: 'OK', headers: {} }; };
  try {
    await api.quoteGuestBooking('7', input()); await api.createGuestBooking('7', request); await api.getGuestBookingSlots('7', input()); await api.queryGuestBooking('7', request); await api.reconcileGuestBooking('7', request);
    assert.deepEqual(JSON.parse(calls[1].data), request); assert.equal(calls[2].params.preferredTherapistIds, '12'); assert.equal('shopId' in calls[2].params, false); assert.equal(calls[4].method, 'post'); assert.deepEqual(JSON.parse(calls[4].data), {});
    assert.equal(calls.some(call => call.url.includes('customers') || call.url.includes('/auth')), false);
  } finally { client.defaults.adapter = old; }
});

test('one frozen request survives timeout/remount, query NOT_FOUND stays locked and only a server fence permits original draft recovery', async () => {
  const saved = storage(), gate = deferred(), writes = [], original = command();
  let model = createModel('1', '7', () => true, { storage: saved, submit: async (_shop, value) => { writes.push(value); return gate.promise; } });
  const write = model.execute(original); await model.execute(command({ requestKey: crypto.randomUUID() })); original.contact.name = 'Changed outside model';
  assert.equal(writes.length, 1); assert.equal(writes[0].contact.name, 'Synthetic caller'); gate.reject(new Error('timeout')); await write; model.dispose();
  model = createModel('1', '7', () => true, { storage: saved, query: async (_shop, value) => ({ shopId: '7', requestKey: value.requestKey, outcome: 'NOT_FOUND' }), reconcile: async (_shop, value) => ({ shopId: '7', requestKey: value.requestKey, outcome: 'NOT_EXECUTED' }) });
  assert.equal(model.resumeDraft(), false); await model.query(); assert.equal(model.resumeDraft(), false); assert.equal(model.getSnapshot().pending.command.requestKey, writes[0].requestKey);
  await model.reconcile(); assert.equal(model.getSnapshot().pending.notExecuted, true); assert.equal(model.resumeDraft(), true); assert.equal(saved.entries.size, 0);
});

test('committed recovery remains a stable receipt through refresh until acknowledged, never emits a second create or a confirm action', async () => {
  const saved = storage(), writes = [];
  let model = createModel('1', '7', () => true, { storage: saved, submit: async (_shop, value) => { writes.push(value); return receipt(value); } });
  await model.execute(command()); assert.equal(saved.entries.size, 1); assert.equal(model.getSnapshot().receipt.result.bookingNo, 'MJ-SYNTHETIC-42'); model.dispose();
  model = createModel('1', '7', () => true, { storage: saved, submit: async (_shop, value) => { writes.push(value); return receipt(value); } });
  assert.equal(model.getSnapshot().receipt.result.bookingId, '42'); await model.execute(command({ requestKey: crypto.randomUUID() })); assert.equal(writes.length, 1); assert.equal(model.acknowledge(), true); assert.equal(saved.entries.size, 0);
});

test('actor/shop revocation and unmount ignore late success but retain recoverable original PII and release network lock', async () => {
  const saved = storage(), gate = deferred(); let allowed = true;
  const model = createModel('1', '7', () => allowed, { storage: saved, submit: async () => gate.promise });
  const write = model.execute(command()); allowed = false; gate.resolve(receipt(command())); await write;
  assert.equal(model.getSnapshot().receipt, null); assert.equal(model.getSnapshot().busy, false); assert.equal(saved.entries.size, 1);
  assert.equal(createModel('2', '7', () => true, { storage: saved }).getSnapshot().pending, null); assert.equal(createModel('1', '8', () => true, { storage: saved }).getSnapshot().pending, null);
  allowed = true; model.dispose(); const resumed = createModel('1', '7', () => true, { storage: saved, reconcile: async (_shop, value) => receipt(value) }); await resumed.reconcile(); assert.ok(resumed.getSnapshot().receipt);
});

test('expired quote, failed storage and damaged saved commands fail closed without POST; failure while saving receipt retains unknown request', async () => {
  const saved = storage(), writes = [], submit = async (_shop, value) => { writes.push(value); return receipt(value); };
  const model = createModel('1', '7', () => true, { storage: saved, submit }); await model.execute(command({ quoteExpiresAt: '2000-01-01T00:00Z' })); assert.equal(writes.length, 0);
  const broken = createModel('1', '7', () => true, { storage: { ...saved, setItem() { throw new Error('blocked'); } }, submit }); await broken.execute(command()); assert.equal(writes.length, 0);
  saved.setItem('massajoy2:guest-assisted-booking:1:7', '{broken'); const corrupt = createModel('1', '7', () => true, { storage: saved, submit }); await corrupt.execute(command()); assert.equal(corrupt.getSnapshot().corrupt, true); assert.equal(saved.entries.size, 1); assert.equal(writes.length, 0);
  saved.entries.clear(); let saves = 0;
  const lostReceipt = createModel('1', '7', () => true, { storage: { ...saved, setItem(key, value) { if (++saves === 2) throw new Error('full'); saved.setItem(key, value); } }, submit }); await lostReceipt.execute(command()); assert.equal(writes.length, 1); assert.ok(lostReceipt.getSnapshot().pending); assert.equal(lostReceipt.getSnapshot().receipt, null);
});

test('safe voucher includes stable reference and offline/pending semantics, excluding contacts, account links and opaque operation key', () => {
  const text = voucher(receipt(command()), 'Synthetic shop'); assert.match(text, /MJ-SYNTHETIC-42/); assert.match(text, /pending shop confirmation/); assert.match(text, /Pay at store/);
  for (const secret of ['Synthetic caller', '+12025550101', 'customerId', command().requestKey, '/bookings/42', '@']) assert.equal(text.includes(secret), false);
});
