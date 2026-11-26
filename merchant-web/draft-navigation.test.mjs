import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createMemoryRouter } from 'react-router-dom';

const options = { server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a dirty draft requires an explicit discard, while save/upload locks forbid leaving without offering discard', async () => {
  const server = await createServer(options);
  try {
    const { createDraftLeaveController } = await server.ssrLoadModule('/src/utils/draftLeave.ts');
    let scope = { actorId: 'actor-1', shopId: 'shop-1' };
    const draft = { ...scope, dirty: false, busy: false }, controller = createDraftLeaveController(() => scope);
    controller.register('settings', () => draft);
    let confirmations = 0, busyWarnings = 0;
    const confirm = async () => { confirmations++; return false; }, warnBusy = () => busyWarnings++;
    assert.equal(await controller.request(confirm, warnBusy), true);
    draft.dirty = true;
    assert.equal(await controller.request(confirm, warnBusy), false); assert.equal(confirmations, 1);
    assert.equal(await controller.request(async () => true, warnBusy), true);
    draft.busy = true;
    assert.equal(await controller.request(confirm, warnBusy), false); assert.equal(confirmations, 1); assert.equal(busyWarnings, 1);
    scope = { actorId: 'actor-2', shopId: 'shop-1' };
    assert.equal(controller.snapshot().dirty, false, 'an old account draft never blocks or authorizes the new actor');
    scope = { actorId: 'actor-1', shopId: 'shop-2' };
    assert.equal(controller.snapshot().busy, false, 'an unrelated shop lock is not reused');
  } finally { await server.close(); }
});

test('pending discard confirmations cannot authorize another scope, a new form lifetime or a write that starts while confirming', async () => {
  const server = await createServer(options);
  try {
    const { createDraftLeaveController } = await server.ssrLoadModule('/src/utils/draftLeave.ts');
    let scope = { actorId: 'actor-1', shopId: 'shop-1' };
    const draft = { ...scope, dirty: true, busy: false }, controller = createDraftLeaveController(() => scope);
    const read = () => draft; let unregister = controller.register('form', read), resolve;
    const confirm = () => new Promise(done => { resolve = done; });
    let request = controller.request(confirm, () => {});
    assert.equal(await controller.request(async () => true, () => {}), false, 'a second navigation cannot reuse the open confirmation');
    scope = { actorId: 'actor-2', shopId: 'shop-1' }; resolve(true); assert.equal(await request, false);
    scope = { actorId: 'actor-1', shopId: 'shop-1' };
    request = controller.request(confirm, () => {}); unregister(); unregister = controller.register('form', () => draft);
    resolve(true); assert.equal(await request, false, 'a remounted form needs its own confirmation');
    request = controller.request(confirm, () => {}); draft.busy = true; resolve(true); assert.equal(await request, false);
    unregister();
  } finally { await server.close(); }
});

test('the data router blocks menu/shop changes and browser backward/forward until the same transition is confirmed', async () => {
  const server = await createServer(options);
  const router = createMemoryRouter([{ path: '*', element: null }], { initialEntries: ['/settings?shopId=1', '/price-menu?shopId=1', '/price-menu?shopId=2'], initialIndex: 1 });
  try {
    const { createDraftLeaveController } = await server.ssrLoadModule('/src/utils/draftLeave.ts');
    const scope = { actorId: 'actor-1', shopId: '1' }, draft = { ...scope, dirty: true, busy: false };
    const controller = createDraftLeaveController(() => scope); controller.register('menu-with-paste', () => draft);
    router.getBlocker('merchant-draft', () => { const value = controller.snapshot(); return value.dirty || value.busy; });
    await router.navigate(-1); await tick();
    assert.equal(router.state.location.pathname, '/price-menu'); assert.equal(router.state.blockers.get('merchant-draft').state, 'blocked');
    router.state.blockers.get('merchant-draft').reset(); await tick();
    assert.equal(router.state.location.search, '?shopId=1');
    await router.navigate(1); await tick();
    assert.equal(router.state.location.search, '?shopId=1', 'forward cannot change the selected shop before confirmation');
    assert.equal(await controller.request(async () => true, () => {}), true);
    router.state.blockers.get('merchant-draft').proceed(); await tick();
    assert.equal(router.state.location.search, '?shopId=2');
    await router.navigate('/settings?shopId=2'); await tick();
    assert.equal(router.state.location.pathname, '/price-menu', 'sidebar and Link navigations share the same blocker');
    router.state.blockers.get('merchant-draft').reset();
  } finally { router.dispose(); await server.close(); }
});
