import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import React, { act } from 'react';
import { Grid, Modal } from 'antd';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { createServer } from 'vite';

// The two old editors/PATCH shop transport were retired. Exercise the real
// merchant shell, single workspace, command journal and receipt/readback API.
const revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64), selectionRevision = 'c'.repeat(64);
const imageUrl = '/api/v1/upload/media/00000000-0000-4000-8000-000000000001/file';
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const all = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate));
  if (!React.isValidElement(tree)) return [];
  return [...(predicate(tree) ? [tree] : []), ...all([tree.props.children, tree.props.extra, tree.props.action, tree.props.footer], predicate)];
};
const find = (tree, predicate) => all(tree, predicate)[0];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : React.isValidElement(tree) ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const service = shopId => ({ id: '51', shopId, name: 'Saved service ' + shopId, nameEn: null, description: 'Saved description', category: 'MASSAGE', isActive: true,
  durationKind: 'TIMED', durationMin: 60, priceCents: 8000, priceBasis: 'PER_SESSION', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null,
  staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0, hasVariants: true, variantCount: 1, addOnCount: 0, selectionRevision, preview: null,
  variants: [{ id: '61', serviceId: '51', name: 'Standard', durationMin: 60, priceCents: 8000, priceBasis: 'PER_SESSION', currency: 'USD', isActive: true, sortOrder: 0, preview: null }], addOns: [] });
const snapshot = shopId => ({ shopId, service: service(shopId), priceMenuRevision: revision, selectionRevision, canManageCatalog: true, canConfigurePolicy: true,
  priceMenu: [{ category: 'Massage', items: [{ id: 'display-a', name: 'Custom title', priceText: '', imageUrl, isVisible: true,
    booking: { serviceId: '51', variantId: '61' }, pricing: { kind: 'TIMED', baseName: 'Saved service ' + shopId, durationMin: 60, priceCents: 8000, titleMode: 'CUSTOM' } }] }] });
const makeShop = id => ({ id, name: 'Synthetic shop ' + id, timezone: 'America/Los_Angeles', priceMenu: snapshot(id).priceMenu, priceMenuRevision: revision,
  permissions: ['CATALOG_MANAGE', 'RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true });
const receipt = (shopId, command, overrides = {}) => ({ operationId: 'synthetic-operation', action: command.action, shopId, idempotencyKey: command.idempotencyKey,
  outcome: 'COMMITTED', serviceId: command.action === 'SAVE_SERVICE_WORKSPACE' ? command.serviceId ?? '52' : null,
  idMap: { variants: {}, addOns: {}, displays: {} }, priceMenuRevision: nextRevision, selectionRevision: command.action === 'SAVE_SERVICE_WORKSPACE' ? selectionRevision : null,
  requiredPermissions: ['CATALOG_MANAGE'], changes: { serviceFields: [], policyFields: [], variantIds: [], addOnIds: [], displayIds: [], layout: false }, warnings: [], ...overrides });

async function harness(run) {
  const globals = ['window', 'document', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal, oldBreakpoint = Grid.useBreakpoint;
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null, getElementById() { return null; } };
  const storage = new Map(), sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage }; document.defaultView = window;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  for (const [key, value] of Object.entries({ window, document, sessionStorage, requestAnimationFrame: fn => { fn(0); return 1; }, cancelAnimationFrame() {}, HTMLInputElement: class {}, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const confirmations = [], warnings = [], writes = [], reads = [], logouts = [], receiptReads = [], reconciles = [];
  let confirm = async () => true, saveHandler, snapshotHandler, receiptHandler, reconcileHandler, tree, layoutTree, root, router, auth, context, workspaceProps, formatPriceMenuTitle;
  let shops = ['5', '6'].map(makeShop), states = Object.fromEntries(['5', '6'].map(id => [id, snapshot(id)]));
  const operations = new Map();
  const commit = (id, command) => {
    const next = structuredClone(states[id]); next.priceMenuRevision = nextRevision;
    const ack = receipt(id, command);
    if (command.action === 'REMOVE_MENU_DISPLAY') next.priceMenu.forEach(group => { group.items = group.items.filter(item => item.id !== command.itemId); });
    if (command.action === 'SAVE_SERVICE_WORKSPACE') {
      if (!command.serviceId) { next.service = { ...service(id), id: '52', variants: [], addOns: [], hasVariants: false, variantCount: 0 }; ack.serviceId = '52'; }
      Object.assign(next.service, command.service, command.policy);
      for (const [kind, rows] of [['variants', command.variants], ['addOns', command.addOns]]) for (const row of rows ?? []) {
        if (row.id) Object.assign(next.service[kind].find(item => item.id === row.id), row.changes);
        else { const assigned = String((kind === 'variants' ? 70 : 90) + next.service[kind].length); ack.idMap[kind][row.tempKey] = assigned;
          next.service[kind].push({ id: assigned, serviceId: next.service.id, priceBasis: 'PER_SESSION', currency: 'USD', preview: null, ...row.changes }); }
      }
      next.service.variantCount = next.service.variants.length; next.service.addOnCount = next.service.addOns.length; next.service.hasVariants = next.service.variantCount > 0;
      for (const row of command.displays ?? []) {
        if (row.id) Object.assign(next.priceMenu.flatMap(group => group.items).find(item => item.id === row.id), row.changes);
        else { const assigned = 'created-' + row.tempKey; ack.idMap.displays[row.tempKey] = assigned;
          const targetId = row.target.kind === 'VARIANT' ? row.target.id ?? ack.idMap.variants[row.target.tempKey] : undefined;
          const variant = next.service.variants.find(item => item.id === targetId), group = row.group?.index ?? 0;
          const { titleMode = 'AUTO', ...displayChanges } = row.changes;
          const pricing = { kind: 'TIMED', baseName: next.service.name, durationMin: variant?.durationMin ?? 60, priceCents: variant?.priceCents ?? 8000, titleMode };
          next.priceMenu[group].items.push({ id: assigned, priceText: '', ...displayChanges, name: titleMode === 'AUTO' ? formatPriceMenuTitle(pricing) : displayChanges.name,
            booking: { serviceId: next.service.id, ...(targetId ? { variantId: targetId } : {}) }, pricing }); }
      }
    }
    states[id] = next; operations.set(id + ':' + command.idempotencyKey, ack); return structuredClone(ack);
  };
  Modal.useModal = () => [{ confirm: options => { confirmations.push(options); return confirm(options); }, info: options => { warnings.push(options); } }, null];
  Grid.useBreakpoint = () => ({ lg: true });
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') { reads.push(config.url); return response(structuredClone(shops)); }
    if (config.url === '/auth/logout') { logouts.push(config); return response({ success: true }); }
    const catalog = config.url.match(/^\/reservation-admin\/shops\/(5|6)\/project-catalog\?(.*)$/);
    if (catalog) { const query = Object.fromEntries(new URLSearchParams(catalog[2])); query.page = Number(query.page); query.pageSize = Number(query.pageSize);
      reads.push(config.url); const rows = [states[catalog[1]].service].filter(Boolean);
      return response({ ...query, shopId: catalog[1], total: rows.length, hasMore: false, canManageCatalog: true, canConfigurePolicy: true, items: structuredClone(rows) }); }
    const match = config.url.match(/^\/reservation-admin\/shops\/(5|6)\/service-workspace-actions(?:\/(.*))?$/);
    assert.ok(match, 'unexpected request (old PATCH shop must never be used): ' + config.url);
    const [, id, resource] = match;
    if (resource === 'snapshot') { reads.push(config.url); const value = snapshotHandler ? await snapshotHandler(id, config.params?.serviceId) : structuredClone(states[id]);
      return response(config.params?.serviceId ? value : { ...value, service: null, selectionRevision: null }); }
    if (!resource) { assert.equal(config.method, 'post'); assert.ok(storage.size, 'journal must be durable before a write'); const command = JSON.parse(config.data);
      writes.push({ id, command }); return response(saveHandler ? await saveHandler(id, command) : commit(id, command)); }
    if (resource.endsWith('/reconcile')) { const key = resource.slice(0, -10); assert.equal(config.method, 'post'); reconciles.push({ id, key });
      return response(reconcileHandler ? await reconcileHandler(id, key) : receipt(id, writes.at(-1).command, { outcome: 'NOT_EXECUTED', action: null, serviceId: null, selectionRevision: null })); }
    assert.equal(config.method, 'get'); receiptReads.push({ id, key: resource }); if (receiptHandler) return response(await receiptHandler(id, resource));
    const stored = operations.get(id + ':' + resource); if (!stored) throw Object.assign(Error('Synthetic missing receipt'), { response: { status: 404 } }); return response(structuredClone(stored));
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    ({ formatPriceMenuTitle } = await server.ssrLoadModule('/@fs/' + fileURLToPath(new URL('../src/utils/priceMenuPricing.ts', import.meta.url)).replaceAll('\\', '/')));
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const MerchantLayout = (await server.ssrLoadModule('/src/layouts/MerchantLayout.tsx')).default;
    const PriceMenuPage = (await server.ssrLoadModule('/src/pages/price-menu/index.tsx')).default;
    const layout = MerchantLayout(), MerchantWorkspace = layout.props.children.type;
    function WorkspaceProbe({ component: Component, props }) { workspaceProps = props; tree = Component(props); return null; }
    function FormProbe({ component: Component, props }) { const form = Component(props), workspace = find(form, node => node.props.api && node.props.scopeKey);
      return workspace ? React.createElement(WorkspaceProbe, { key: workspace.key, component: workspace.type, props: workspace.props }) : null; }
    function PageProbe() { const page = PriceMenuPage(); return typeof page?.type === 'function' && page.props.updateShop ? React.createElement(FormProbe, { key: page.key, component: page.type, props: page.props }) : null; }
    function ShellProbe() { context = useShopId(); layoutTree = MerchantWorkspace(); return useLocation().pathname === '/price-menu' ? React.createElement(PageProbe) : null; }
    auth.getState().setAuth('synthetic-1', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(layout.type, null, React.createElement(ShellProbe)) }], { initialEntries: ['/price-menu?shopId=5&view=inventory&pane=metadata&serviceId=51'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const control = (predicate, source = tree) => { const node = find(source, predicate); assert.ok(node, 'expected real workspace control'); return node.props; };
    const button = label => control(node => node.type === 'button' && text(node).trim() === label);
    const removeDisplay = id => control(node => node.props.row?.id === id && typeof node.props.onRemove === 'function').onRemove;
    const field = (label, index = 0) => { const wrapper = all(tree, node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === label)[index];
      assert.ok(wrapper, 'workspace field: ' + label); return control(node => ['input', 'textarea', 'select'].includes(String(node.type)), wrapper.props.children); };
    const header = predicate => control(predicate, layoutTree);
    await run({ writes, reads, logouts, confirmations, warnings, storage, receiptReads, reconciles, button, field, control, router, auth,
      click: label => act(async () => { button(label).onClick(); }), change: (value, label = '服务名称 *', index = 0) => act(async () => { field(label, index).onChange({ target: { value } }); }),
      save: () => act(async () => { button('保存当前服务').onClick(); }), recover: () => act(async () => { button('查询原保存回执').onClick(); }),
      switchShop: id => act(async () => { header(node => node.props['aria-label'] === '已授权门店').onChange(id); }),
      logout: () => act(async () => { await header(node => node.props.children === '退出登录').onClick(); }), logoutHandler: () => header(node => node.props.children === '退出登录').onClick, actor: id => act(async () => { auth.getState().setAuth('synthetic-' + id, { id, role: 'ADMIN' }); }),
      refresh: () => act(async () => { await context.reloadShop(context.shopId); }), removal: id => act(async () => { removeDisplay(id)(); }), removeDisplay,
      setSave: next => { saveHandler = next; }, setRead: next => { snapshotHandler = next; }, setReceipt: next => { receiptHandler = next; }, setReconcile: next => { reconcileHandler = next; }, setConfirm: next => { confirm = next; },
      state: id => states[id ?? context.shopId], setState: (id, state) => { states[id] = state; }, commit, setShops: next => { shops = next; }, shops: () => structuredClone(shops), tree: () => tree, props: () => workspaceProps, shell: () => context,
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal; Grid.useBreakpoint = oldBreakpoint;
    previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('uncertain command blocks same-turn repeats, captured callbacks and real switch/logout',()=>harness(async h=>{
 await h.change('Submitted');const save=h.button('保存当前服务').onClick,discard=h.button('放弃本次修改').onClick,change=h.field('服务名称 *').onChange,p=deferred();h.setSave(()=>p.promise);
 await act(async()=>{save();save();});assert.equal(h.writes.length,1);await h.switchShop('6');await h.logout();assert.equal(h.logouts.length,0);
 await act(async()=>{p.reject(Error('Lost response'));});assert.equal(h.button('放弃本次修改').disabled,true);
 await act(async()=>{discard();save();change({target:{value:'Stale'}});});assert.equal(h.writes.length,1);assert.equal(h.field('服务名称 *').value,'Submitted');
 const confirms=h.confirmations.length;await h.switchShop('6');await h.logout();assert.match(h.router.state.location.search,/shopId=5/);assert.equal(h.logouts.length,0);assert.equal(h.confirmations.length,confirms);assert.ok(h.warnings.length>=4);
}));

test('malformed readback retains draft/media and matching original receipt recovery is read-only',()=>harness(async h=>{
 await h.change('Saved but response lost');h.setSave((id,c)=>{const ack=h.commit(id,c);h.setRead(()=>({shopId:id}));return ack;});await h.save();assert.equal(h.writes.length,1);assert.equal(h.field('服务名称 *').value,'Saved but response lost');
 await h.logout();assert.equal(h.logouts.length,0);assert.equal(h.state().priceMenu[0].items[0].imageUrl,imageUrl);h.setRead(undefined);const reads=h.reads.filter(path=>path.endsWith('/snapshot')).length;await h.recover();assert.equal(h.reads.filter(path=>path.endsWith('/snapshot')).length,reads+1);assert.equal(h.writes.length,1);assert.equal(h.storage.size,0,text(h.tree()));assert.equal(h.button('保存当前服务').disabled,true);await h.switchShop('6');assert.match(h.router.state.location.search,/shopId=6/);
}));

test('mismatching committed readback requires explicit adoption without overwriting later server data or media/IDs',()=>harness(async h=>{
 await h.change('Desired');h.setSave((id,c)=>{const ack=h.commit(id,c);h.state(id).service.name='Later server edit';return ack;});await h.save();assert.equal(h.writes.length,1);assert.equal(h.field('服务名称 *').value,'Desired');assert.ok(find(h.tree(),n=>n.props['aria-label']==='已提交保存与当前资料对比'));await h.logout();assert.equal(h.logouts.length,0);
 await h.click('放弃本地草稿，采用当前已保存资料');assert.equal(h.field('服务名称 *').value,'Later server edit');assert.equal(h.writes.length,1);assert.equal(h.storage.size,0,text(h.tree()));assert.equal(h.state().priceMenu[0].items[0].imageUrl,imageUrl);assert.deepEqual(h.state().priceMenu[0].items[0].booking,{serviceId:'51',variantId:'61'});assert.equal(h.shell().shop.priceMenu[0].items[0].imageUrl,imageUrl);
}));

test('definite revision rejection preserves editable draft and conflict until explicit latest-baseline selection',()=>harness(async h=>{
 await h.change('Conflict');h.setSave(()=>{throw Object.assign(Error('Conflict'),{response:{status:409,data:{code:'PRICE_MENU_CHANGED'}}});});await h.save();assert.equal(h.writes.length,1);assert.equal(h.field('服务名称 *').value,'Conflict');assert.equal(h.button('保存当前服务').disabled,true);assert.equal(find(h.tree(),n=>n.type==='button'&&text(n)==='查询原保存回执'),undefined);
 h.setConfirm(async()=>false);await h.switchShop('6');assert.match(h.router.state.location.search,/shopId=5/);assert.equal(h.confirmations.length,1);await h.click('放弃修改并载入最新基线');await h.click('继续编辑');assert.equal(h.field('服务名称 *').value,'Conflict');await h.click('放弃修改并载入最新基线');await h.click('放弃修改并继续');assert.equal(h.field('服务名称 *').value,'Saved service 5');assert.equal(h.writes.length,1);
}));

test('same-actor permission refresh retains unknown and late old-actor writes/receipt reads cannot replace current drafts',()=>harness(async h=>{
 await h.change('Actor 1');const p=deferred();h.setSave(()=>p.promise);await h.save();await h.actor('2');await act(async()=>{p.resolve(receipt('5',h.writes[0].command));});assert.equal(h.field('服务名称 *').value,'Saved service 5');
 await h.change('Actor 2');h.setSave(()=>{throw Error('Lost response');});await h.save();h.setShops(h.shops().map(s=>s.id==='5'?{...s,permissions:['RESERVATION_CONFIG']}:s));await h.refresh();assert.equal(h.field('服务名称 *').value,'Actor 2');await h.logout();assert.equal(h.logouts.length,0);
 h.setShops(h.shops().map(s=>({...s,permissions:['CATALOG_MANAGE','RESERVATION_CONFIG']})));await h.refresh();const reading=deferred();h.setReceipt(()=>reading.promise);await h.recover();await h.actor('3');await act(async()=>{reading.resolve(receipt('5',h.writes.at(-1).command));});assert.equal(h.field('服务名称 *').value,'Saved service 5');assert.equal(h.writes.length,2);
}));

test('foreign, missing-key, malformed and valid-shaped stale success receipts all remain unresolved',()=>harness(async h=>{
 const bad=[r=>({...r,shopId:'6'}),r=>({...r,idempotencyKey:'other'}),r=>({...r,priceMenuRevision:undefined}),r=>({...r,serviceId:'99'}),r=>r];
 for(const [i,alter]of bad.entries()){if(i)await h.actor(String(i+1));await h.change('Requested '+i);h.setSave((id,c)=>alter(receipt(id,c)));await h.save();assert.equal(h.field('服务名称 *').value,'Requested '+i);assert.equal(h.button('放弃本次修改').disabled,true);await h.logout();assert.equal(h.logouts.length,0);assert.equal(h.writes.length,i+1);}
}));

test('new service settles verified server-assigned service/variant/display identities and preserves existing media',()=>harness(async h=>{
 await h.click('＋ 新增服务');await h.change('Created');await h.change('60 min','规格名称 *');await h.change('85.25','价格（USD）*');await h.click('创建服务');assert.equal(h.writes.length,1);assert.equal(h.writes[0].command.action,'SAVE_SERVICE_WORKSPACE');assert.equal(h.writes[0].command.variants[0].changes.priceCents,8525);assert.equal(h.storage.size,0,text(h.tree()));assert.equal(h.field('服务名称 *').value,'Created');assert.equal(h.field('价格（USD）*').value,'85.25');assert.equal(h.button('保存当前服务').disabled,true);assert.equal(h.state().priceMenu[0].items[0].imageUrl,imageUrl);assert.equal(h.state().priceMenu[0].items[1].booking.serviceId,'52');await h.logout();assert.equal(h.logouts.length,1);
}));

test('new enabled sibling keeps inactive saved variants and recovers lost materialization without another POST',()=>harness(async h=>{
 h.state().service.isActive=false;h.state().service.variants[0].isActive=false;await h.click('重新载入');await h.click('＋ 添加规格');await h.change('90 min','规格名称 *',1);await h.change('90','预约占用分钟 *',1);await h.change('95.00','价格（USD）*',1);h.setSave((id,c)=>{h.commit(id,c);throw Error('Lost materialization reply');});await h.save();assert.equal(h.writes.length,1);assert.equal(h.state().service.variants[0].isActive,false);assert.equal(h.state().service.isActive,false);assert.equal(h.button('放弃本次修改').disabled,true);await h.recover();assert.equal(h.writes.length,1);assert.equal(h.storage.size,0,text(h.tree()));assert.equal(h.field('规格名称 *',1).value,'90 min');assert.equal(h.state().priceMenu[0].items[0].imageUrl,imageUrl);
}));

test('retained removal cannot replace later dirty, busy or unknown single-service draft',()=>harness(async h=>{
 const remove=h.removeDisplay('display-a');await h.change('Keep');await act(async()=>{remove();});assert.equal(find(h.tree(),n=>n.props.label==='确认永久移除展示位置'),undefined);assert.equal(h.field('服务名称 *').value,'Keep');const p=deferred();h.setSave(()=>p.promise);await h.save();await act(async()=>{remove();});await act(async()=>{p.reject(Error('Unknown'));remove();});assert.equal(h.writes.length,1);assert.equal(h.field('服务名称 *').value,'Keep');
}));

test('retained discard/reload controls cannot bypass newer edits or read over their draft',()=>harness(async h=>{
 await h.change('Earlier');const discard=h.button('放弃本次修改').onClick,reload=h.button('重新载入').onClick;await h.change('Newer');const reads=h.reads.length;await act(async()=>{discard();reload();});assert.equal(h.reads.length,reads);assert.equal(h.field('服务名称 *').value,'Newer');assert.equal(find(h.tree(),n=>n.props['aria-label']==='未保存的服务修改'),undefined);assert.equal(h.writes.length,0);
}));

test('pending shell leave confirmation cannot outlive an intervening busy/unknown command',()=>harness(async h=>{
 await h.change('Keep during confirmation');const p=deferred();h.setConfirm(()=>p.promise);let leaving;await act(async()=>{leaving=h.logoutHandler()();});assert.equal(h.confirmations.length,1);h.setSave(()=>{throw Error('Lost reply');});await h.save();await act(async()=>{p.resolve(true);await leaving;});assert.equal(h.logouts.length,0);assert.equal(h.field('服务名称 *').value,'Keep during confirmation');assert.equal(h.writes.length,1);
}));

test('old shop/actor field, removal and save callbacks cannot edit or write the new workspace',()=>harness(async h=>{
 await h.change('Old shop');const change=h.field('服务名称 *').onChange,save=h.button('保存当前服务').onClick,remove=h.removeDisplay('display-a');await h.switchShop('6');await h.click('编辑');await act(async()=>{change({target:{value:'Stale'}});save();remove();});assert.equal(h.writes.length,0);assert.equal(h.field('服务名称 *').value,'Saved service 6');const oldChange=h.field('服务名称 *').onChange,oldSave=h.button('保存当前服务').onClick;await h.actor('2');await h.click('编辑');await act(async()=>{oldChange({target:{value:'Stale actor'}});oldSave();});assert.equal(h.writes.length,0);assert.equal(h.field('服务名称 *').value,'Saved service 6');await h.change('Current');await h.save();assert.equal(h.writes.length,1);assert.equal(h.writes[0].id,'6');assert.equal(h.state().service.name,'Current');
}));

test('last display removal survives lost response and settles only by matching read-only original receipt recovery',()=>harness(async h=>{
 await h.removal('display-a');assert.ok(find(h.tree(),n=>n.props.label==='确认永久移除展示位置'));h.setSave((id,c)=>{h.commit(id,c);throw Error('Lost removal reply');});await h.click('确认永久移除');assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].command,{action:'REMOVE_MENU_DISPLAY',idempotencyKey:h.writes[0].command.idempotencyKey,expectedPriceMenuRevision:revision,itemId:'display-a',confirm:true});assert.equal(h.state().priceMenu[0].items.length,0);assert.equal(h.state().service.id,'51');await h.logout();assert.equal(h.logouts.length,0);const reads=h.reads.filter(path=>path.endsWith('/snapshot')).length;await h.recover();assert.equal(h.reads.filter(path=>path.endsWith('/snapshot')).length,reads+1);assert.equal(h.writes.length,1);assert.equal(h.storage.size,0,text(h.tree()));assert.deepEqual(h.shell().shop.priceMenu,[{category:'Massage',items:[]}]);await h.switchShop('6');assert.match(h.router.state.location.search,/shopId=6/);
}));

