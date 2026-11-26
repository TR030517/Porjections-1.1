import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Exercise the component's handlers/effects with controlled requests. This is
// a Node state/transport regression harness, not a browser or layout test.
const source = readFileSync(new URL('../src/components/CouponManagement.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const flush = async () => { for (let i = 0; i < 3; i += 1) await new Promise(setImmediate); };
const coupon = (id, extra = {}) => ({ id: String(id), type: 'general', name: `Coupon ${id}`, amount: 10.25, threshold: 50.75, description: '', startDate: '2026-11-01', endDate: '2026-12-01', status: '正常', updateDate: '2026-10-27', claimedCount: 0, ...extra });
function* nodes(value) {
  if (Array.isArray(value)) { for (const child of value) yield* nodes(child); }
  else if (value && typeof value === 'object' && value.props) { yield value; yield* nodes(value.props.children); }
}
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null || typeof value === 'boolean' ? '' : String(value);
function harness({ manager = false, shopId = '42' } = {}) {
  const hooks = [], requests = [], mutations = [];
  let tree, cursor, scheduled = false, disposed = false, currentShop = shopId;
  const schedule = () => { if (!scheduled && !disposed) { scheduled = true; queueMicrotask(() => { scheduled = false; if (!disposed) render(); }); } };
  const effects = [];
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[slot].value, value => { const next = typeof value === 'function' ? value(hooks[slot].value) : value; if (!Object.is(next, hooks[slot].value)) { hooks[slot].value = next; schedule(); } }];
    },
    useEffect(callback, dependencies) {
      const slot = cursor++, previous = hooks[slot];
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
        hooks[slot] = { dependencies, cleanup: previous?.cleanup };
        effects.push(() => { hooks[slot].cleanup?.(); hooks[slot].cleanup = callback(); });
      }
    },
  };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const api = {
    listResourcePage(resource, query, signal) { return new Promise((resolve, reject) => { requests.push({ resource, query: JSON.parse(JSON.stringify(query)), signal, resolve, reject }); }); },
    async createResource(resource, payload) { mutations.push({ method: 'POST', resource, payload }); return coupon(900, { ...payload, merchantName: 'Server-resolved shop' }); },
    async updateResource(resource, id, payload) { mutations.push({ method: 'PATCH', resource, id, payload }); return coupon(id, payload); },
    async deleteResource(resource, id) { mutations.push({ method: 'DELETE', resource, id }); },
  };
  const modules = {
    react, 'react/jsx-runtime': runtime, 'lucide-react': new Proxy({}, { get: (_, key) => String(key) }),
    'motion/react': { motion: { tr: 'motion.tr', div: 'motion.div' }, AnimatePresence: 'AnimatePresence' },
    '../lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') }, '../api/resources': api,
    '../stores/authStore': { useAuthStore: () => ({ isStoreManager: manager }) },
    '../stores/shop': { useShopStore: () => ({ currentStoreId: currentShop }) },
    './Confirmation': { useConfirmation: () => async () => true },
  };
  const module = { exports: {} };
  new Script(compiled).runInNewContext({ module, exports: module.exports, require: name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, AbortController, Error });
  function render() { cursor = 0; tree = module.exports.default(); while (effects.length) effects.shift()(); }
  render();
  const find = predicate => { const found = [...nodes(tree)].find(predicate); assert.ok(found, 'Expected control was not rendered'); return found; };
  return {
    requests, mutations,
    get text() { return text(tree); },
    input(id, value) { find(node => node.props.id === id).props.onChange({ target: { value } }); },
    button(label) { return find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label)); },
    click(label) { const button = this.button(label); assert.ok(!button.props.disabled, `Disabled: ${label}`); return button.props.onClick(); },
    field(id) { return find(node => node.props.id === id); },
    search() { return find(node => node.type === 'form' && node.props.id !== 'coupon-form').props.onSubmit({ preventDefault() {} }); },
    submit() { return find(node => node.props.id === 'coupon-form').props.onSubmit({ preventDefault() {} }); },
    reply(index, items, total) { const request = requests[index]; request.resolve({ items, total, page: request.query.page, pageSize: request.query.pageSize }); },
    changeShop(id) { currentShop = id; render(); },
    dispose() { disposed = true; hooks.forEach(hook => hook.cleanup?.()); },
  };
}

test('server totals and later pages remain available beyond 500 coupons without fetching stores', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  assert.deepEqual(ui.requests[0].query, { scope: 'general', search: '', page: 1, pageSize: 25 });
  ui.reply(0, [coupon(1)], 612); await flush();
  assert.match(ui.text, /共 612 条/); assert.match(ui.text, /第 1 \/ 25 页/);
  ui.click('下一页优惠券'); await flush();
  assert.equal(ui.requests[1].query.page, 2);
  ui.reply(1, [coupon(501)], 612); await flush();
  assert.match(ui.text, /Coupon 501/); assert.match(ui.text, /共 612 条/);
  assert.ok(ui.requests.every(request => request.resource === 'coupons'));
});

test('search is submitted, page size resets paging, and reset clears server filters', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.reply(0, [coupon(1)], 600); await flush();
  ui.click('下一页优惠券'); await flush(); ui.reply(1, [coupon(26)], 600); await flush();
  ui.input('coupon-search', '  Holiday  '); await flush(); assert.equal(ui.requests.length, 2);
  ui.search(); await flush(); assert.equal(ui.requests[2].query.search, 'Holiday'); assert.equal(ui.requests[2].query.page, 1);
  ui.reply(2, [coupon(590)], 120); await flush();
  ui.input('coupon-page-size', '100'); await flush(); assert.equal(ui.requests[3].query.pageSize, 100); assert.equal(ui.requests[3].query.page, 1);
  ui.reply(3, [coupon(590)], 120); await flush();
  ui.click('重置'); await flush(); assert.equal(ui.requests[4].query.search, ''); assert.equal(ui.requests[4].query.scope, 'general');
});

test('scope/store changes cancel old requests and late responses cannot replace current rows', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  ui.click('商家优惠券'); await flush(); assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.requests[1].query.scope, 'merchant'); assert.equal(ui.requests[1].query.shopId, '42');
  ui.reply(1, [coupon(700, { type: 'merchant', merchantName: 'Current shop' })], 700); await flush();
  ui.reply(0, [coupon(1, { name: 'STALE GENERAL' })], 1); await flush(); assert.doesNotMatch(ui.text, /STALE GENERAL/); assert.match(ui.text, /Current shop/);
  ui.click('下一页优惠券'); await flush();
  ui.changeShop('999'); await flush(); assert.equal(ui.requests[2].signal.aborted, true); assert.equal(ui.requests[3].query.page, 1); assert.equal(ui.requests[3].query.shopId, '999');
  ui.reply(3, [coupon(999, { type: 'merchant', merchantName: 'New shop' })], 1); await flush();
  ui.requests[2].reject(new Error('STALE ERROR')); await flush(); assert.doesNotMatch(ui.text, /STALE ERROR|Current shop/); assert.match(ui.text, /New shop/);
});

test('short links are submitted directly and server-resolved merchant names are used', async t => {
  const ui = harness({ manager: true }); t.after(() => ui.dispose()); ui.reply(0, [], 0); await flush(); ui.click('新增优惠券'); await flush();
  for (const [id, value] of [['coupon-name', 'New coupon'], ['coupon-merchant-link', 'store-after-500'], ['coupon-amount', '10.25'], ['coupon-start-date', '2026-11-01'], ['coupon-end-date', '2026-12-01']]) ui.input(id, value);
  await flush(); await ui.submit(); await flush();
  assert.equal(ui.mutations[0].payload.merchantShortLink, 'store-after-500'); assert.equal('merchantName' in ui.mutations[0].payload, false);
  assert.ok(ui.requests.every(request => request.resource === 'coupons'));
  ui.reply(1, [coupon(900, { type: 'merchant', merchantName: 'Server-resolved shop', merchantShortLink: 'store-after-500' })], 601); await flush();
  assert.match(ui.text, /Server-resolved shop/); assert.match(ui.text, /共 601 条/);
});

test('claimed terms stay locked and an emptied last page returns to the remaining page', async t => {
  const ui = harness({ manager: true }); t.after(() => ui.dispose());
  const claimed = coupon(1, { type: 'merchant', merchantShortLink: 'owned-shop', merchantName: 'Owned', claimedCount: 2 });
  ui.reply(0, [claimed], 26); await flush(); ui.click('编辑'); await flush();
  for (const id of ['coupon-merchant-link', 'coupon-amount', 'coupon-threshold', 'coupon-start-date', 'coupon-end-date']) assert.equal(ui.field(id).props.disabled, true);
  assert.equal(ui.field('coupon-name').props.disabled, undefined); assert.match(ui.text, /已领取 2 张/);
  ui.click('取消'); await flush(); ui.click('下一页优惠券'); await flush(); ui.reply(1, [], 25); await flush();
  assert.equal(ui.requests[2].query.page, 1); ui.reply(2, [claimed], 25); await flush(); assert.match(ui.text, /第 1 \/ 1 页/);
});

test('a claimed perpetual coupon can be renamed without resubmitting locked terms', async t => {
  const ui = harness({ manager: true }); t.after(() => ui.dispose());
  const claimed = coupon(77, { type: 'merchant', merchantShortLink: 'owned-shop', merchantName: 'Owned', claimedCount: 3, endDate: '' });
  ui.reply(0, [claimed], 1); await flush(); ui.click('编辑'); await flush();
  assert.equal(ui.field('coupon-end-date').props.disabled, true);
  assert.equal(ui.field('coupon-end-date').props.value, '');
  ui.input('coupon-name', ' Renamed perpetual coupon '); ui.input('coupon-description', ' Updated instructions ');
  await flush(); await ui.submit(); await flush();
  assert.equal(ui.mutations.length, 1);
  assert.equal(ui.mutations[0].method, 'PATCH'); assert.equal(ui.mutations[0].id, '77');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.mutations[0].payload)), { name: 'Renamed perpetual coupon', description: 'Updated instructions', status: '正常' });
});

test('an unclaimed coupon accepts a same-day validity period while rejecting missing or reversed dates', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  ui.reply(0, [coupon(88, { claimedCount: 0 })], 1); await flush(); ui.click('编辑'); await flush();
  assert.equal(ui.field('coupon-end-date').props.disabled, false);
  ui.input('coupon-start-date', '2026-11-02'); ui.input('coupon-end-date', ''); await flush(); await ui.submit(); await flush();
  assert.equal(ui.mutations.length, 0);
  ui.input('coupon-end-date', '2026-11-01'); await flush(); await ui.submit(); await flush();
  assert.equal(ui.mutations.length, 0);
  ui.input('coupon-end-date', '2026-11-02'); await flush(); await ui.submit(); await flush();
  assert.equal(ui.mutations.length, 1); assert.equal(ui.mutations[0].method, 'PATCH');
  assert.equal(ui.mutations[0].payload.startDate, '2026-11-02'); assert.equal(ui.mutations[0].payload.endDate, '2026-11-02');
  assert.equal(ui.mutations[0].payload.amount, 10.25);
});
