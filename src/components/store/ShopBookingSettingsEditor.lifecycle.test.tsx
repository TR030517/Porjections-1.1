import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession } from '../../api/session';
import ShopBookingSettingsEditor from './ShopBookingSettingsEditor';
import type { BusinessLifecycle } from './businessScope';
import type { ReservationShopBookingSettings } from '../../api/reservations';
import { ConfirmationProvider } from '../Confirmation';

type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node;
  return predicate(node) ? node : find(node.props.children, predicate);
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('admin settings lifecycle preserves date drafts, confirms saves, and fences unknown results and previous shops', async () => {
  // Render the actual editor hooks and inspect its returned React controls. No
  // host elements are mounted and every request below is a synthetic response.
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const previousFetch = globalThis.fetch;
  const documentSurface: Record<string, unknown> = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const windowSurface = { document: documentSurface, HTMLIFrameElement: class {}, event: undefined, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  documentSurface.defaultView = windowSurface;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: documentSurface, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowSurface });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentSurface });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let identity = { id: '7', role: 'ADMIN', name: 'Synthetic settings admin' };
  const original: ReservationShopBookingSettings = { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2026-12-31', endDate: '2027-01-02' }] };
  const shops: Record<string, ReservationShopBookingSettings> = { '5': structuredClone(original), '6': { minimumNoticeMinutes: 60, closedPeriods: [] } };
  let revision='b'.repeat(64);
  const writes: { shopId: string; value: ReservationShopBookingSettings }[] = [];
  let patch: ((shopId: string, value: ReservationShopBookingSettings) => Promise<Response>) | undefined;
  let read: ((shopId: string) => Promise<Response>) | undefined;
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    const shopId = path.match(/\/reservation-admin\/shops\/(5|6)\/booking-settings$/)?.[1];
    assert.ok(shopId, `unexpected request: ${path}`);
    if (options?.method === 'PATCH') {
      const { expectedSettingsHash, ...value } = JSON.parse(String(options.body)); assert.equal(expectedSettingsHash, revision); writes.push({ shopId, value });
      if (patch) return patch(shopId, value);
      shops[shopId] = structuredClone(value);
      return Response.json({ item: { shopId, bookingSettings: value, bookingSettingsHash: revision } });
    }
    return read ? read(shopId) : Response.json({ shopId, bookingSettings: shops[shopId], bookingSettingsHash: revision });
  };
  clearSession();
  let tree: unknown, confirmation: unknown, state: BusinessLifecycle = { dirty: false, busy: false, unknown: false };
  let props = { shopId: '5', timezone: 'America/Los_Angeles', phone: '202-555-0144', disabled: false };
  const lifecycle = (value: BusinessLifecycle) => { state = value; };
  function Probe() { tree = ShopBookingSettingsEditor({ ...props, onLifecycleChange: lifecycle }); return null; }
  function SilentConfirmation({ children }: { children: React.ReactNode }) { const provider = ConfirmationProvider({ children }); confirmation = provider; return React.cloneElement(provider, {}, children); }
  function SignedIn() { return useAuthStore().user ? <SilentConfirmation><Probe /></SilentConfirmation> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const control = (predicate: (node: Node) => boolean) => { const found = find(tree, predicate); assert.ok(found, 'expected control is present'); return found; };
  const notice = () => control(node => node.type === 'input' && node.props.type === 'number');
  const button = (label: string) => control(node => node.type === 'button' && node.props.children === label);
  const changeNotice = (value: string) => act(async () => { notice().props.onChange({ target: { value } }); });
  const save = () => act(async () => { button('保存预约规则').props.onClick(); });
  try {
    await render();
    assert.equal(notice().props.value, '12'); assert.equal(notice().props.disabled, false);
    assert.deepEqual(state, { dirty: false, busy: false, unknown: false });
    assert.equal(writes.length, 0, 'initial reads never write default rules');
    assert.ok(find(tree, node => node.props.lang === 'en' && node.props.children.includes('Dec 31, 2026 to Jan 2, 2027')));

    await changeNotice('0.5');
    assert.equal(state.dirty, true);
    await save();
    assert.deepEqual(writes[0], { shopId: '5', value: { ...original, minimumNoticeMinutes: 30 } });
    assert.equal(state.dirty, false);
    // Calendar dates are never converted to the machine's or store's UTC day.
    assert.deepEqual(shops['5'].closedPeriods, original.closedPeriods);

    await changeNotice('0.001'); await save();
    assert.equal(writes.length, 1, 'fractional minutes are rejected before PATCH');
    assert.equal(state.dirty, true);
    await changeNotice('24');
    patch = async () => Response.json({ message: '闭店日期范围内已有有效预约' }, { status: 409 });
    await save();
    assert.deepEqual(state, { dirty: true, busy: false, unknown: false });
    const beforeConflictReload=writes.length; await save(); assert.equal(writes.length,beforeConflictReload,'stale drafts must be reloaded before another write');
    revision='c'.repeat(64);
    shops['5']={...shops['5'],closedPeriods:[{startDate:'2026-11-20',endDate:'2026-11-20'},...shops['5'].closedPeriods]};
    await act(async()=>{ button('重读最新规则并保留草稿').props.onClick(); });
    assert.equal(notice().props.value,'24','version refresh keeps the original draft');
    assert.ok(find(tree,node=>node.type==='p'&&Array.isArray(node.props.children)&&node.props.children.includes('2026-11-20')),'the latest server closure is displayed for manual merging');
    assert.ok(find(tree,node=>node.type==='input'&&node.props['aria-label']==='闭店第1段开始日期'&&node.props.value==='2026-12-31'),'the original closure draft is preserved instead of silently replaced');
    await save(); assert.equal(writes.length,beforeConflictReload,'a readback must not rebase the old draft onto the new hash');
    await act(async()=>{button('合并最新闭店日期').props.onClick();});
    assert.ok(find(tree,node=>node.type==='input'&&node.props['aria-label']==='闭店第1段开始日期'&&node.props.value==='2026-11-20'),'explicit merge retains the newly closed date');
    assert.equal(notice().props.value, '24', 'a definite rejection retains the editable draft');

    patch = async () => { throw new TypeError('Synthetic interrupted response'); };
    await save();
    assert.deepEqual(state, { dirty: true, busy: false, unknown: true });
    assert.deepEqual(writes.at(-1)?.value.closedPeriods,shops['5'].closedPeriods,'new hash is submitted only after retaining latest closures');
    const pendingWrites = writes.length; await save(); assert.equal(writes.length, pendingWrites, 'unknown outcome cannot be automatically resubmitted');
    await act(async () => { button('只读重新载入并核对').props.onClick(); });
    assert.equal(writes.length, pendingWrites, 'recovery is a GET, never another PATCH');
    assert.deepEqual(state, { dirty: true, busy: false, unknown: true }, 'a GET of old rules must not silently acknowledge a write that may still finish');
    assert.equal(notice().props.value, '24', 'the exact submitted notice and closure draft survive read-only recovery');
    assert.ok(find(tree, node => node.props['aria-label'] === '最新已保存预约规则'));
    await save(); assert.equal(writes.length, pendingWrites, 'a readback alone cannot reopen the PATCH path');
    await act(async () => { button('已核对，结束本次操作').props.onClick(); });
    const review = find(confirmation, node => node.type === 'button' && node.props.children === '已核对，结束本次操作'); assert.ok(review);
    await act(async () => { review.props.onClick(); });
    assert.deepEqual(state, { dirty: false, busy: false, unknown: false }); assert.equal(notice().props.value, '0.5');

    const late = deferred<Response>(); patch = async () => late.promise;
    await changeNotice('36'); await save(); assert.equal(state.busy, true);
    props = { ...props, shopId: '6', timezone: 'Pacific/Honolulu' }; await render();
    assert.equal(notice().props.value, '1');
    await act(async () => { late.resolve(Response.json({ item: { shopId: '5', bookingSettings: { ...original, minimumNoticeMinutes: 2160 }, bookingSettingsHash: revision } })); });
    assert.equal(notice().props.value, '1', 'the previous shop save receipt cannot replace this shop rules');
    assert.deepEqual(state, { dirty: false, busy: false, unknown: false });

    const lateRead = deferred<Response>(); read = async () => lateRead.promise;
    props = { ...props, shopId: '5' }; await render();
    assert.equal(state.busy, true);
    await act(async () => { identity = { ...identity, role: 'CUSTOMER' }; clearSession(); });
    await act(async () => { lateRead.resolve(Response.json({ shopId: '5', bookingSettings: original, bookingSettingsHash: revision })); });
    assert.equal(writes.length, pendingWrites + 1, 'revoking the admin session triggers no rule write');
    assert.deepEqual(state, { dirty: false, busy: false, unknown: false }, 'unmount clears the obsolete editor lifecycle');
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
