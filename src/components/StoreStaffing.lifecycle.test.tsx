import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import StoreStaffing from './StoreStaffing';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession } from '../api/session';
import type { StaffingSnapshot } from '../utils/shopStaffing';
import type { BusinessLifecycle } from './store/businessScope';

type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node;
  return predicate(node) ? node : find(node.props.children, predicate);
}
function snapshot(): StaffingSnapshot {
  return { shopId: '5', activeCount: 1, revision: 'a'.repeat(64), serviceAccessMode: 'SHOP_ALL', canManageStaff: true, canManageExceptions: true,
    therapists: [{ id: '80', shopId: '5', name: 'Synthetic original name', avatarUrl: null, title: null, bio: null, gender: null, yearsExp: 0, sortOrder: 0, isActive: true, scheduleMode: 'SHOP' }] };
}
async function withStaffing(mode: 'failed' | 'stale' | 'matching', run: (ui: {
  tree(): unknown; control(predicate: (node: Node) => boolean): Node; state(): BusinessLifecycle;
  changed(): number; writes(): number; recover(): void; submit(): Promise<void>;
}) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  let tree: unknown, state: BusinessLifecycle = { dirty: false, busy: false, unknown: false }, changed = 0, writes = 0, recover = false;
  const value = snapshot(), identity = { id: '7', role: 'ADMIN', name: 'Synthetic staffing admin' };
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    if (path.includes('/studio/stores?')) return Response.json({ items: [{ id: '5', name: 'Synthetic shop' }], total: 1, page: 1, pageSize: 1 });
    if (path.endsWith('/reservation-admin/shops/5/staffing')) {
      if (writes && !recover && mode === 'failed') throw new TypeError('Synthetic readback unavailable');
      const result = structuredClone(value);
      if (writes && (recover || mode === 'matching')) { result.therapists[0].name = 'Synthetic changed name'; result.revision = 'b'.repeat(64); }
      return Response.json(result);
    }
    assert.ok(path.endsWith('/merchant/therapists/80'), path); assert.equal(options?.method, 'PATCH'); writes++;
    return Response.json({ ...value.therapists[0], ...JSON.parse(String(options?.body)) });
  };
  clearSession();
  function Probe() { tree = StoreStaffing({ shopId: '5', embedded: true, onStoreList() {}, onBack() {}, onReservations() {}, onLifecycleChange: next => { state = next; }, onChanged: () => { changed++; } }); return null; }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const control = (predicate: (node: Node) => boolean) => { const result = find(tree, predicate); assert.ok(result, 'expected staffing control exists'); return result; };
  try {
    await act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
    const team = control(node => typeof node.type === 'function' && node.type.name === 'TechnicianTeam');
    await act(async () => { team.props.onEdit(team.props.rows[0]); });
    await act(async () => { control(node => node.type === 'input' && node.props.value === 'Synthetic original name').props.onChange({ target: { value: 'Synthetic changed name' } }); });
    await run({ tree: () => tree, control, state: () => state, changed: () => changed, writes: () => writes, recover: () => { recover = true; },
      submit: () => act(async () => { control(node => node.type === 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} }); }),
    });
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

for (const mode of ['failed', 'stale'] as const) test(`a ${mode} staffing readback after a profile receipt retains its original draft and prevents repeat PATCH`, async () => {
  await withStaffing(mode, async ui => {
    await ui.submit();
    assert.equal(ui.state().unknown, true, 'the attempted personnel refresh must be verified before closing the editor');
    assert.equal(ui.changed(), 0, 'an unverified personnel refresh must not announce completion to sibling editors');
    assert.equal(ui.control(node => node.type === 'input' && node.props.value === 'Synthetic changed name').props.value, 'Synthetic changed name');
    await ui.submit(); assert.equal(ui.writes(), 1);
    ui.recover();
    await act(async () => { ui.control(node => node.type === 'button' && node.props.children === '只读核对原修改').props.onClick(); });
    assert.equal(ui.writes(), 1); assert.equal(ui.changed(), 1); assert.equal(ui.state().unknown, false);
    assert.equal(find(ui.tree(), node => node.props.role === 'dialog'), undefined);
  });
});

test('a matching personnel readback completes one profile update and unlocks staffing normally', async () => {
  await withStaffing('matching', async ui => {
    const submit = ui.control(node => node.type === 'form').props.onSubmit;
    await act(async () => { submit({ preventDefault() {}, stopPropagation() {} }); submit({ preventDefault() {}, stopPropagation() {} }); });
    assert.equal(ui.writes(), 1); assert.equal(ui.changed(), 1); assert.equal(ui.state().unknown, false);
    assert.equal(find(ui.tree(), node => node.props.role === 'dialog'), undefined);
  });
});
