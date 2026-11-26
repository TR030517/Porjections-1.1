import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ReservationSettings from './ReservationSettings';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession } from '../api/session';
import { ConfirmationProvider } from './Confirmation';
import type { ReservationConfig } from '../types/reservations';
import type { BusinessLifecycle } from './store/businessScope';

type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node;
  return predicate(node) ? node : find(node.props.children, predicate) ?? find(node.props.recovery, predicate);
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const config = (shopId: string): ReservationConfig => ({ shopId, timezone: 'America/Los_Angeles', paymentPolicy: { payAtStoreEnabled: true }, services: [], rooms: [], therapists: [{ id: '8', shopId, name: 'Synthetic therapist', isActive: true, scheduleMode: 'SHOP', serviceIds: [], shifts: [], timeOff: [] }] });

test('a layout variant link locates only its exact row after loading, repeats on request, and never opens a write', async () => {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic reservation admin' };
  const value = config('5');
  value.services = ['7', '8'].map(id => ({ id, shopId: '5', name: 'Synthetic service ' + id, isActive: true, durationMin: 60, durationKind: 'TIMED', priceCents: 9500, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0,
    variants: [1, 2].map(index => ({ id: Number(id) * 10 + index, serviceId: id, name: 'Variant ' + id + index, durationMin: 30 * index, priceCents: 9500 * index, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true, sortOrder: index })) }));
  let tree: unknown, serviceId = '7', variantId: string | undefined = '72', focusRevision = 1, reads = 0, mountRevision = 0, focusPending = true;
  const focuses: string[] = [], scrolls: string[] = [], pending = deferred<void>();
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    assert.match(path, /\/reservation-admin\/shops\/5\/config$/);
    assert.ok(!options?.method || options.method === 'GET', 'locating a row must not write');
    reads++; if (reads <= 2) await pending.promise; return Response.json(value);
  };
  clearSession();
  function Probe() {
    tree = ReservationSettings({ explicitShopId: '5', embedded: true, serviceOnly: true, initialServiceId: serviceId, initialVariantId: variantId, variantFocusRevision: focusRevision, variantFocusPending: focusPending, onBack() {}, onManageQualifications() {} });
    const row = find(tree, node => node.type === 'tr' && !!node.props['aria-label']);
    // Probe renders the component tree without a DOM; attach the row ref as React's commit would.
    if (row) { const label = row.props['aria-label']; row.props.ref.current = { focus() { focuses.push(label); }, scrollIntoView() { scrolls.push(label); } }; }
    return null;
  }
  function SilentConfirmation({ children }: { children: React.ReactNode }) { const provider = ConfirmationProvider({ children }); return React.cloneElement(provider, {}, children); }
  function SignedIn() { return useAuthStore().user ? <SilentConfirmation><Probe key={mountRevision} /></SilentConfirmation> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  try {
    await render(); assert.equal(focuses.length, 0, 'wait for the exact service configuration');
    await act(async () => { pending.resolve(); });
    assert.deepEqual(focuses, ['当前定位规格：Variant 72']); assert.deepEqual(scrolls, focuses);
    const target = find(tree, node => node.type === 'tr' && node.props['aria-label'] === '当前定位规格：Variant 72'); assert.ok(target); assert.equal(target.props.tabIndex, -1);
    assert.equal(find(tree, node => typeof node.type === 'function' && node.type.name === 'ReservationEditor'), undefined, 'navigation does not open an edit or draft');
    await render(); assert.equal(focuses.length, 1, 'ordinary rerenders do not steal focus');
    focusPending = false; mountRevision++; await render(); assert.equal(focuses.length, 1, 'a parent-consumed request cannot steal focus after a configuration refresh remount');
    focusPending = true;
    focusRevision++; await render(); assert.equal(focuses.length, 2, 'the same layout link can be used again');
    variantId = '71'; focusRevision++; await render(); assert.equal(focuses.at(-1), '当前定位规格：Variant 71');
    variantId = '999'; focusRevision++; await render(); assert.equal(focuses.length, 3, 'an absent variant never falls back to another row');
    serviceId = '8'; variantId = '72'; focusRevision++; await render(); assert.equal(focuses.length, 3, 'a variant from the previous service cannot be selected in the next service');
    variantId = '82'; focusRevision++; await render(); assert.equal(focuses.at(-1), '当前定位规格：Variant 82'); assert.deepEqual(scrolls, focuses);
    variantId = undefined; await render(); assert.equal(find(tree, node => node.type === 'tr' && !!node.props['aria-label']), undefined);
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});

test('exception writes retain unknown outcomes until explicit read and review, and do not repeat or leak across shops', async () => {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic reservation admin' };
  let tree: unknown, confirmation: unknown, shopId = '5', revision = 0, lifecycle: BusinessLifecycle = { dirty: false, busy: false, unknown: false }, changed = 0;
  let records: Record<string, ReservationConfig> = { '5': config('5'), '6': config('6') };
  let readError = false;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let write: (body: Record<string, unknown>) => Promise<Response> = async body => {
    records['5'].therapists[0].timeOff = [{ id: '21', therapistId: '8', startAtUtc: String(body.startAtUtc), endAtUtc: String(body.endAtUtc), reason: String(body.reason) }];
    throw new TypeError('Synthetic lost response after commit');
  };
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    const match = path.match(/\/reservation-admin\/shops\/(5|6)\/(config|time-off)$/); assert.ok(match, path);
    if (match[2] === 'config') { if (readError) throw new TypeError('Synthetic read unavailable'); return Response.json(records[match[1]]); }
    assert.equal(options?.method, 'POST'); const body = JSON.parse(String(options?.body)); writes.push({ path, body }); return write(body);
  };
  clearSession();
  function Probe() { tree = ReservationSettings({ explicitShopId: shopId, revision, embedded: true, resourcesOnly: true, initialTab: 'therapists', initialTherapistId: '8', onBack() {}, onManageQualifications() {}, onLifecycleChange: value => { lifecycle = value; }, onChanged: () => { changed++; } }); return null; }
  function SilentConfirmation({ children }: { children: React.ReactNode }) { const provider = ConfirmationProvider({ children }); confirmation = provider; return React.cloneElement(provider, {}, children); }
  function SignedIn() { return useAuthStore().user ? <SilentConfirmation><Probe /></SilentConfirmation> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const control = (predicate: (node: Node) => boolean) => { const result = find(tree, predicate); assert.ok(result, 'expected reservation control exists'); return result; };
  const section = (title: string) => control(node => typeof node.type === 'function' && node.type.name === 'Section' && node.props.title === title);
  const editor = () => control(node => typeof node.type === 'function' && node.type.name === 'ReservationEditor');
  const button = (label: string) => control(node => node.type === 'button' && text(node).trim() === label);
  const open = () => act(async () => { section('休假 / 临时离岗').props.button.props.onClick(); });
  const edit = () => act(async () => { editor().props.setEditor((previous: any) => ({ ...previous, form: { ...previous.form, startLocal: '2026-12-31T20:00', endLocal: '2027-01-01T10:00', reason: 'Synthetic time off' } })); });
  const submit = () => act(async () => { editor().props.onSave({ preventDefault() {}, stopPropagation() {} }); });
  try {
    await render(); await open(); await edit(); await submit();
    assert.equal(writes.length, 1); assert.equal(writes[0].body.startAtUtc, '2027-01-01T04:00:00.000Z'); assert.equal(writes[0].body.endAtUtc, '2027-01-01T18:00:00.000Z');
    assert.equal(lifecycle.unknown, true, 'a lost response can follow a committed exception and must block repetition');
    await submit(); assert.equal(writes.length, 1); assert.equal(changed, 0);
    revision++; await render(); assert.equal(lifecycle.unknown, true); assert.equal(editor().props.editor.form.reason, 'Synthetic time off', 'a sibling save cannot clear the unresolved operation or draft');
    readError = true; await act(async () => { button('只读重新载入并核对').props.onClick(); });
    assert.equal(lifecycle.unknown, true); assert.equal(writes.length, 1); assert.equal(button('已核对，结束本次操作').props.disabled, true);
    readError = false; await act(async () => { button('只读重新载入并核对').props.onClick(); });
    assert.equal(lifecycle.unknown, true, 'a read must not silently acknowledge an uncertain operation');
    assert.equal(writes.length, 1); assert.equal(editor().props.editor.form.reason, 'Synthetic time off');
    assert.match(text(editor().props.recovery), /2026-12-31 20:00/); assert.match(text(editor().props.recovery), /Synthetic time off/);
    await act(async () => { button('已核对，结束本次操作').props.onClick(); });
    const accept = find(confirmation, node => node.type === 'button' && text(node) === '已核对，结束本次操作'); assert.ok(accept);
    await act(async () => { accept.props.onClick(); }); assert.equal(lifecycle.unknown, false); assert.equal(writes.length, 1); assert.equal(changed, 1, 'explicit review refreshes sibling staffing without retrying the write');

    await open(); await edit(); const pending = deferred<Response>(); write = async () => pending.promise;
    const staleSubmit = editor().props.onSave;
    await act(async () => { staleSubmit({ preventDefault() {}, stopPropagation() {} }); staleSubmit({ preventDefault() {}, stopPropagation() {} }); });
    assert.equal(writes.length, 2, 'rapid submissions share one synchronous mutation lock');
    shopId = '6'; await render(); assert.equal(lifecycle.unknown, false);
    await act(async () => { pending.resolve(Response.json({ item: { id: '22' } })); });
    assert.equal(changed, 1, 'a previous shop write cannot claim success in the next shop');
    assert.equal(section('休假 / 临时离岗').props.button.props.disabled, false, 'the new shop cannot stay locked by a retired save');
    await act(async () => { staleSubmit({ preventDefault() {}, stopPropagation() {} }); }); assert.equal(writes.length, 2, 'retired editor callbacks cannot write');
    await open(); await edit(); write = async () => Response.json({ error: { code: 'CONFLICT', message: '休假时段与已有预约冲突' } }, { status: 409 }); await submit();
    assert.equal(writes.length, 3); assert.equal(lifecycle.unknown, false); assert.equal(editor().props.editor.form.reason, 'Synthetic time off'); assert.match(editor().props.error, /已有预约冲突/);
    readError = true; write = async () => Response.json({ item: { id: '23' } }); await submit();
    assert.equal(writes.length, 4); assert.equal(lifecycle.unknown, true, 'a confirmed write followed by failed readback cannot be submitted again');
    assert.equal(editor().props.editor.form.reason, 'Synthetic time off', 'the editor and exact submitted input remain visible after failed post-save readback');
    assert.match(editor().props.error, /保存结果待核对/); assert.equal(changed, 1, 'failed readback cannot announce a completed save');
    await submit(); assert.equal(writes.length, 4); assert.ok(button('只读重新载入并核对'));
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});

test('exception deletion confirms once and cannot report a retired shop refresh as current success', async () => {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic reservation admin' };
  let tree: unknown, confirmation: unknown, shopId = '5', changed = 0;
  const records: Record<string, ReservationConfig> = { '5': config('5'), '6': config('6') };
  for (const row of Object.values(records)) row.therapists[0].timeOff = [{ id: '21', therapistId: '8', startAtUtc: '2027-01-01T04:00:00.000Z', endAtUtc: '2027-01-01T18:00:00.000Z', reason: 'Synthetic time off' }];
  let reads: ((id: string) => Promise<Response>) | undefined, deletes = 0;
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    const match = path.match(/\/reservation-admin\/shops\/(5|6)\/(config|time-off\/21)$/); assert.ok(match, path);
    if (match[2] === 'config') return reads ? reads(match[1]) : Response.json(records[match[1]]);
    assert.equal(options?.method, 'DELETE'); deletes++; records[match[1]].therapists[0].timeOff = []; return Response.json({ success: true });
  };
  clearSession();
  function Probe() { tree = ReservationSettings({ explicitShopId: shopId, embedded: true, resourcesOnly: true, initialTab: 'therapists', initialTherapistId: '8', onBack() {}, onManageQualifications() {}, onChanged: () => { changed++; } }); return null; }
  function SilentConfirmation({ children }: { children: React.ReactNode }) { const provider = ConfirmationProvider({ children }); confirmation = provider; return React.cloneElement(provider, {}, children); }
  function SignedIn() { return useAuthStore().user ? <SilentConfirmation><Probe /></SilentConfirmation> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const button = (label: string, surface = tree) => { const result = find(surface, node => node.type === 'button' && text(node).trim() === label); assert.ok(result, label); return result; };
  try {
    await render(); const lateRead = deferred<Response>(); reads = async id => id === '5' ? lateRead.promise : Response.json(records[id]);
    const staleRemove = button('删除').props.onClick;
    await act(async () => { staleRemove(); staleRemove(); }); assert.equal(deletes, 0, 'no mutation before confirmation');
    await act(async () => { button('删除时段', confirmation).props.onClick(); }); assert.equal(deletes, 1, 'rapid delete clicks share one confirmation and write');
    shopId = '6'; await render(); await act(async () => { lateRead.resolve(Response.json(records['5'])); });
    assert.equal(changed, 0, 'the previous shop readback must not notify current-shop success');
    assert.doesNotMatch(text(tree), /阻断时段已删除/);
    await act(async () => { staleRemove(); }); assert.equal(deletes, 1, 'retired deletion callbacks cannot open a new mutation');
    assert.equal(button('删除').props.disabled, false, 'a retired mutation cannot keep the new shop locked');
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});
