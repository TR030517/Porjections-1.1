import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { tsImport } from 'tsx/esm/api';

// Executes the actual workspace handlers/effects with controlled transport and
// minimal hooks/DOM stubs. This is a Node regression harness, not browser,
// accessibility, layout or native form-validation acceptance.
const model = await tsImport('../src/components/store/storeModel.ts', import.meta.url);
// Compile pure dependencies in the same controlled realm; the frontend imports
// the timezone helper across the backend's CommonJS package boundary.
const helperCache = new Map();
function loadHelper(path, parent = import.meta.url) {
  const url = new URL(/\.(?:ts|json)$/.test(path) ? path : path + '.ts', parent);
  if (helperCache.has(url.href)) return helperCache.get(url.href);
  if (url.pathname.endsWith('.json')) {
    const value = JSON.parse(readFileSync(url, 'utf8'));
    helperCache.set(url.href, value);
    return value;
  }
  const module = { exports: {} };
  helperCache.set(url.href, module.exports);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Script(code, { filename: url.pathname }).runInNewContext({ module, exports: module.exports,
    require: name => { assert.ok(name.startsWith('.'), `Unexpected helper import ${name}`); return loadHelper(name, url); },
    Error, AbortController, AbortSignal, DOMException, Headers, FormData, URL, structuredClone,
  });
  return module.exports;
}
const helpers = {};
for (const [name, path] of [
  ['../../utils/storeTimezones', '../src/utils/storeTimezones.ts'],
  ['./storeTimezoneDraft', '../src/components/store/storeTimezoneDraft.ts'],
  ['../../utils/mediaDraft', '../src/utils/mediaDraft.ts'],
  ['../../utils/storeAccountStatus', '../src/utils/storeAccountStatus.ts'],
  ['../../utils/shopBranding', '../src/utils/shopBranding.ts'],
  ['../../utils/serviceWorkspaceProfile', '../src/utils/serviceWorkspaceProfile.ts'],
]) helpers[name] = loadHelper(path);
const source = readFileSync(new URL('../src/components/store/StoreWorkspace.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const flush = async () => { for (let i = 0; i < 3; i += 1) await new Promise(setImmediate); };
const copy = value => JSON.parse(JSON.stringify(value));
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function store(overrides = {}) {
  return {
    id: '9007199254740993', ownerId: '9007199254740995', name: 'Existing studio', shortName: 'existing-studio', subtitle: '',
    status: 'APPROVED', timezone: 'America/New_York', phones: ['+1-555-0100'], emails: [],
    businessHours: { ...model.emptyHours(), '周一': { open: true, start: '09:00', end: '18:00' } },
    address: 'Test Street', city: 'Sample City', state: 'NY', zipCode: '10001', latitude: 40.7, longitude: -74,
    logo: '', logoUrl: '', bannerUrl: '', gallery: [], videoUrl: '', about: 'Saved introduction', tags: [], mapShareUrl: '',
    priceMenu: [], priceMenuRevision: 'a'.repeat(64),
    features: { onlineBooking: true, onlinePayment: false, reviews: true, membershipCard: false },
    publicationReady: true, publicationChecklist: [{ key: 'owner', label: '有效的商家所有者', complete: true }],
    ...overrides,
  };
}

function* nodes(value) {
  if (Array.isArray(value)) { for (const child of value) yield* nodes(child); }
  else if (value && typeof value === 'object' && value.props) { yield value; yield* nodes(value.props.children); }
}
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null || typeof value === 'boolean' ? '' : String(value);

function harness({ item = store(), manager = false } = {}) {
  const hooks = [], effects = [], mutations = [], confirmations = [], savedCalls = [], navigationCalls = [], listeners = new Map();
  let currentItem = item, tree, cursor = 0, scheduled = false, disposed = false, closeCalls = 0;
  const schedule = () => {
    if (!scheduled && !disposed) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; if (!disposed) render(); });
    }
  };
  const dependenciesChanged = (previous, dependencies) => !previous || !dependencies
    || dependencies.length !== previous.dependencies?.length
    || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]));
  const memo = (compute, dependencies) => {
    const slot = cursor++;
    if (dependenciesChanged(hooks[slot], dependencies)) hooks[slot] = { value: compute(), dependencies };
    return hooks[slot].value;
  };
  const effect = (callback, dependencies) => {
    const slot = cursor++, previous = hooks[slot];
    if (dependenciesChanged(previous, dependencies)) {
      hooks[slot] = { dependencies, cleanup: previous?.cleanup };
      effects.push(() => { hooks[slot].cleanup?.(); hooks[slot].cleanup = callback(); });
    }
  };
  const react = {
    useMemo: memo,
    useCallback: (callback, dependencies) => memo(() => callback, dependencies),
    useState(initial) {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[slot].value, value => {
        const next = typeof value === 'function' ? value(hooks[slot].value) : value;
        if (!Object.is(next, hooks[slot].value)) { hooks[slot].value = next; schedule(); }
      }];
    },
    useRef(initial) {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { current: initial };
      return hooks[slot];
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const jsx = (type, props) => {
    if (typeof type === 'string' && props?.ref && typeof props.ref === 'object') {
      props.ref.current = { isConnected: true, focus() {}, querySelectorAll: () => [], getClientRects: () => [{}] };
    }
    return { type, props };
  };
  const mutate = (method, resource, id, payload) => new Promise((resolve, reject) => {
    mutations.push({ method, resource, id, payload: copy(payload), resolve, reject });
  });
  const capture = () => {
    const shopId = currentItem?.id;
    return () => !disposed && currentItem?.id === shopId;
  };
  const modules = {
    ...helpers,
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': new Proxy({}, { get: (_, key) => String(key) }),
    '../../api/resources': {
      updateResource: (resource, id, payload) => mutate('PATCH', resource, id, payload),
      createResource: (resource, payload) => mutate('POST', resource, undefined, payload),
      listResourcePage: async () => { throw new Error('Nested business-list requests are outside this handler harness.'); },
    },
    '../Confirmation': { useConfirmation: () => options => new Promise(resolve => confirmations.push({ options: copy(options), resolve })) },
    '../ResourcePicker': { default: 'ResourcePicker', __esModule: true },
    './StoreCustomerPreview': { default: 'StoreCustomerPreview', __esModule: true },
    './StoreMediaEditor': { default: 'StoreMediaEditor', __esModule: true },
    './StoreHoursEditor': { default: 'StoreHoursEditor', __esModule: true },
    ...Object.fromEntries(['StoreTimezonePicker', 'StorePublicLink', 'StoreAddressAutocomplete', 'StoreReadiness', 'StoreBusinessSettings', 'StoreAccountCredentials', 'StoreOrderEmailSettingsAdmin', 'StoreServiceWorkspace', 'ShopBookingSettingsEditor'].map(name => ['./' + name, { default: name, __esModule: true }])),
    '../../api/session': { subscribeSession: () => () => {}, ApiError },
    '../../api/mediaUploads': { abandonShopMedia: async () => {}, confirmShopMedia: async () => {}, uploadShopMedia: async () => { throw new Error('Uploads are outside this handler harness.'); } },
    '../../api/projectCatalog': {},
    '../../api/reservations': {},
    './businessScope': { EMPTY_BUSINESS_LIFECYCLE: { dirty: false, busy: false, unknown: false }, useBusinessScope: shopId => ({ shopId, actorId: '17', capture, captureEvent: capture }) },
    './storeModel': model,
  };
  const module = { exports: {} };
  new Script(compiled, { filename: 'StoreWorkspace.handler-test.cjs' }).runInNewContext({
    module, exports: module.exports,
    require: name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; },
    Error, AbortController, structuredClone,
    document: { activeElement: { isConnected: true, focus() {} } },
    window: {
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    },
    requestAnimationFrame: callback => { queueMicrotask(() => { if (!disposed) callback(0); }); return 1; },
  });
  function render() {
    cursor = 0;
    tree = module.exports.default({
      item: currentItem, isStoreManager: manager,
      initialSection: 'basic',
      onClose: () => { closeCalls += 1; },
      onSaved: saved => { savedCalls.push(saved); currentItem = saved; schedule(); },
      onNavigateStore: (view, selected) => navigationCalls.push({ view, item: selected }),
    });
    while (effects.length) effects.shift()();
  }
  render();
  const find = predicate => {
    const found = [...nodes(tree)].find(predicate);
    assert.ok(found, 'Expected workspace control was not rendered');
    return found;
  };
  return {
    mutations, confirmations, savedCalls, navigationCalls,
    get closeCalls() { return closeCalls; },
    get text() { return text(tree); },
    get dirtyUnloadGuard() { return listeners.has('beforeunload'); },
    field(id) { return find(node => node.props.id === id); },
    input(id, value) { this.field(id).props.onChange({ target: { value } }); },
    button(label) { return find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label)); },
    click(label) { const button = this.button(label); assert.ok(!button.props.disabled, `Disabled: ${label}`); return button.props.onClick(); },
    tab(id) { const tab = this.field('store-tab-' + id); assert.ok(!tab.props.disabled); return tab.props.onClick(); },
    submit() { const target = {}; return this.field('store-workspace-form').props.onSubmit({ target, currentTarget: target, preventDefault() {} }); },
    preview() { return find(node => node.type === 'StoreCustomerPreview').props; },
    component(name) { return find(node => node.type === name).props; },
    dispose() { disposed = true; hooks.forEach(hook => hook.cleanup?.()); },
  };
}

test('a definitive PATCH rejection preserves the editable draft and dirty guard without saved or close callbacks', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  ui.input('store-name', 'Unsaved studio name'); await flush();
  const completion = ui.submit(); await flush();
  assert.equal(ui.mutations.length, 1);
  assert.equal(ui.mutations[0].method, 'PATCH'); assert.equal(ui.mutations[0].resource, 'stores');
  assert.equal(ui.mutations[0].id, '9007199254740993');
  assert.equal(ui.mutations[0].payload.name, 'Unsaved studio name');
  ui.mutations[0].reject(new ApiError('Server rejected this change', 422)); await completion; await flush();
  assert.equal(ui.field('store-name').props.value, 'Unsaved studio name');
  assert.match(ui.text, /Server rejected this change/); assert.match(ui.text, /有未保存的修改/);
  assert.equal(ui.dirtyUnloadGuard, true);
  assert.equal(ui.savedCalls.length, 0); assert.equal(ui.closeCalls, 0);
  assert.equal(ui.button('保存门店资料').props.disabled, false);
});

test('PATCH success adopts the returned server profile, marks it saved and keeps the studio open', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  ui.input('store-name', '  Requested name  '); await flush();
  const completion = ui.submit(); await flush();
  assert.equal(ui.mutations[0].payload.name, 'Requested name');
  const saved = store({ name: 'Server canonical name', about: 'Server canonical introduction', phones: ['+1-555-0199'] });
  ui.mutations[0].resolve(saved); await completion; await flush();
  assert.equal(ui.field('store-name').props.value, 'Server canonical name');
  assert.equal(ui.field('store-about').props.value, 'Server canonical introduction');
  assert.equal(ui.field('store-phones').props.value, '+1-555-0199');
  assert.equal(ui.savedCalls.length, 1); assert.equal(ui.savedCalls[0], saved);
  assert.equal(ui.closeCalls, 0); assert.equal(ui.dirtyUnloadGuard, false);
  assert.equal(ui.preview().saved, true); assert.equal(ui.preview().draft.name, 'Server canonical name');
  assert.match(ui.text, /与已保存资料一致/); assert.match(ui.text, /门店资料已保存/);
  ui.click('关闭'); await flush();
  assert.equal(ui.confirmations.length, 0); assert.equal(ui.closeCalls, 1);
});

test('cancelling dirty-close confirmation leaves the draft, dialog and save action available', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  ui.input('store-about', 'A draft that must not be lost'); await flush();
  ui.click('关闭门店工作室'); await flush();
  assert.equal(ui.confirmations.length, 1); assert.equal(ui.closeCalls, 0);
  assert.match(ui.confirmations[0].options.message, /未保存/);
  ui.confirmations[0].resolve(false); await flush();
  assert.equal(ui.closeCalls, 0); assert.equal(ui.field('store-about').props.value, 'A draft that must not be lost');
  assert.equal(ui.dirtyUnloadGuard, true); assert.equal(ui.button('关闭').props.disabled, false);
  assert.equal(ui.mutations.length, 0);
});

test('embedded project, technician and booking settings retain the exact shop and unsaved store draft', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  ui.input('store-name', 'Unsaved before navigation'); await flush();
  ui.tab('price-menu'); await flush();
  assert.equal(ui.component('StoreServiceWorkspace').shopId, '9007199254740993');
  ui.tab('business'); await flush();
  assert.equal(ui.component('StoreBusinessSettings').item.id, '9007199254740993');
  ui.tab('hours'); await flush();
  assert.equal(ui.component('ShopBookingSettingsEditor').shopId, '9007199254740993');
  assert.equal(ui.confirmations.length, 0); assert.equal(ui.navigationCalls.length, 0); assert.equal(ui.closeCalls, 0);
  assert.equal(ui.preview().draft.name, 'Unsaved before navigation');
  assert.equal(ui.dirtyUnloadGuard, true);
  assert.equal(ui.savedCalls.length, 0); assert.equal(ui.mutations.length, 0);
});

test('a required field on a hidden tab is still rejected by the real payload builder without transport', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  ui.input('store-name', ' '); await flush(); ui.tab('brand'); await flush();
  assert.equal(ui.field('store-tab-brand').props['aria-selected'], true);
  await ui.submit(); await flush();
  assert.equal(ui.mutations.length, 0); assert.equal(ui.savedCalls.length, 0); assert.equal(ui.closeCalls, 0);
  assert.match(ui.text, /请填写门店名称与唯一短链/);
  assert.equal(ui.field('store-tab-basic').props['aria-selected'], true);
  assert.equal(ui.field('store-name').props.value, ' '); assert.equal(ui.dirtyUnloadGuard, true);
});

test('a mismatched server record cannot overwrite the current shop or mark its draft saved', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  ui.input('store-subtitle', 'Keep this pending edit'); await flush();
  const completion = ui.submit(); await flush();
  ui.mutations[0].resolve(store({ id: '99', name: 'Another shop' })); await completion; await flush();
  assert.match(ui.text, /保存结果未知/);
  assert.equal(ui.field('store-subtitle').props.value, 'Keep this pending edit');
  assert.equal(ui.field('store-name').props.value, 'Existing studio');
  assert.equal(ui.savedCalls.length, 0); assert.equal(ui.closeCalls, 0); assert.equal(ui.dirtyUnloadGuard, true);
  assert.equal(ui.button('保存门店资料').props.disabled, true);
  assert.equal(ui.button('只读核对保存结果').props.disabled, false);
  await ui.submit(); await flush();
  assert.equal(ui.mutations.length, 1);
});
