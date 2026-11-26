import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Dashboard from './Dashboard';
import { clearSession } from '../api/session';
import { acceptExplicitLogin, logoutIntent } from '../api/logoutIntent';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { ADMIN_ALL_STORES_SCOPE } from '../utils/adminLocation';
import type { ViewId } from '../types';
import type { ResourceQuery } from '../api/resources';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);

type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node;
  return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}

test('dashboard order queues and appointment total navigate with the all-authorized-stores scope', async () => {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const previousFetch = globalThis.fetch;
  let tree: unknown;
  const calls: Array<{ view: ViewId; query?: ResourceQuery }> = [];
  const actor = { id: '7', role: 'ADMIN', name: 'Synthetic administrator' };
  const summary = {
    counts: { stores: 2, users: 0, serviceOrders: 1, coupons: 0, regions: 0, giftCards: 0 },
    workQueues: { pendingShops: 0, pendingBookings: 0, confirmedBookings: 1, confirmedPaidBookings: 0, refundingBookings: 0 },
    storeStatuses: { published: 2, suspended: 0 },
    paymentProvider: 'disabled',
  };
  const document: Record<string, any> = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
  const window = { document, HTMLIFrameElement: class {} };
  document.defaultView = window;
  for (const [key, value] of [['window', window], ['document', document], ['IS_REACT_ACT_ENVIRONMENT', true]] as const) Object.defineProperty(globalThis, key, { configurable: true, value });
  globalThis.fetch = async input => {
    const path = new URL(String(input), 'http://synthetic.test').pathname;
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'synthetic-token', user: actor });
    if (path.endsWith('/auth/me')) return Response.json(actor);
    if (path.endsWith('/studio/summary')) return Response.json(summary);
    throw new Error('Unexpected dashboard request: ' + path);
  };
  clearSession(); assert.equal(acceptExplicitLogin(logoutIntent()), true);
  function Screen() {
    const { user, loading } = useAuthStore();
    return user && !loading ? <DashboardProbe /> : null;
  }
  function DashboardProbe() { tree = Dashboard({ onNavigate: (view, query) => calls.push({ view, query }) }); return null; }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => { root.render(<AuthProvider><Screen /></AuthProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const queueButton = (label: string) => find(tree, node => node.type === 'button' && text(node).includes(label));
    for (const label of ['门店待审核', '待确认预约', '待到店服务', '退款处理中']) {
      const button = queueButton(label);
      assert.ok(button, `dashboard must render ${label}`);
      await act(async () => { button.props.onClick(); });
      assert.equal(calls.at(-1)?.query?.shopScope, ADMIN_ALL_STORES_SCOPE, `${label} uses the all-authorized-stores scope`);
    }
    const metric = find(tree, node => node.type === 'button' && node.props['aria-label'] === '查看预约总数');
    assert.ok(metric);
    await act(async () => { metric.props.onClick(); });
    assert.equal(calls.at(-1)?.view, 'service-orders');
    assert.equal(calls.at(-1)?.query?.shopScope, ADMIN_ALL_STORES_SCOPE);
  } finally {
    await act(async () => root.unmount()); clearSession(); globalThis.fetch = previousFetch;
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
