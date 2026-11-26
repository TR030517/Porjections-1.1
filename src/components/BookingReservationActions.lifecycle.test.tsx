import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession } from '../api/session';
import { ConfirmationProvider } from './Confirmation';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: BookingReservationActions } = await import('./BookingReservationActions');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node; return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
const detail = (id: string, status = 'PENDING', cancelReason: string | null = null) => ({ id, shopId: '5', status, cancelReason, paymentStatus: 'UNPAID', durationMin: 60, durationKind: 'TIMED', currency: 'usd', startTime: '2099-11-08T18:00:00Z', endTime: '2099-11-08T19:00:00Z', timezone: 'America/Los_Angeles', priceCents: 10000, totalCents: 10000, paidCents: 0, refundedCents: 0, localDate: '2099-11-08', localStartTime: '10:00', holdExpiresAt: null, items: [], orderOnly: true, paymentMode: 'PAY_AT_STORE', onlinePaymentEnabled: false, pricingPolicy: 'PER_ORDER' });
const summary = (id: string, status = 'PENDING') => ({ bookingId: id, shopId: '5', status, paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', currency: 'usd', totalCents: 10000, paidCents: 0, refundedCents: 0, netPaidCents: 0, amountDueCents: 10000, entries: [], orderOnly: true, allowedActions: { confirm: status === 'PENDING', complete: status === 'CONFIRMED', cancel: status === 'PENDING' || status === 'CONFIRMED', recordReceipt: status === 'PENDING' || status === 'CONFIRMED', recordRefund: false } });
async function harness(initialId: string, run: (h: any) => Promise<void>) {
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const), previousFetch = globalThis.fetch;
  const doc: any = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const storage = new Map<string, string>();
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem(key: string) { return storage.get(key) ?? null; }, removeItem(key: string) { storage.delete(key); }, setItem(key: string, value: string) { storage.set(key, value); } } }; doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win }); Object.defineProperty(globalThis, 'document', { configurable: true, value: doc }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const h: any = { id: initialId, actor: { id: '7', role: 'ADMIN', name: 'Synthetic admin' }, status: 'PENDING', cancelReason: null, busy: false, dirty: false, unknown: false, updates: [], mutations: [], payloads: [], reconciles: [], keys: [], tree: null, dialog: null, readId: null, visible: true, Component: BookingReservationActions };
  h.write = async (_url: URL, options: RequestInit) => {
    h.status = 'CANCELLED';
    h.cancelReason = JSON.parse(String(options.body)).cancelReason;
    return Response.json(detail(h.id, h.status, h.cancelReason));
  };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://synthetic.test');
    if (url.pathname.endsWith('/auth/refresh') || url.pathname.endsWith('/auth/admin/refresh') || url.pathname.endsWith('/auth/login') || url.pathname.endsWith('/auth/admin/password/login')) return Response.json({ accessToken: 'synthetic-only', user: h.actor });
    if (url.pathname.endsWith('/auth/me')) return Response.json(h.actor);
    if (url.pathname.includes('/operations/')) {
      h.reconciles.push(url.pathname); return h.resolve(url, options);
    }
    if (options?.method && options.method !== 'GET') {
      h.mutations.push(url.pathname + url.search);
      h.payloads.push(options.body === undefined ? undefined : JSON.parse(String(options.body)));
      h.keys.push(new Headers(options.headers).get('Idempotency-Key'));
      return h.write(url, options);
    }
    const match = url.pathname.match(/\/bookings\/([^/]+)(.*)$/); assert.ok(match, 'only synthetic booking reads are allowed');
    if (match[2] === '/reschedule-slots') return Response.json({ date: url.searchParams.get('date'), timezone: 'America/Los_Angeles', slots: [{ time: '10:00', available: true }, { time: '11:00', available: true }] });
    if (match[2] === '/settlements') return Response.json(summary(match[1], h.status));
    if (h.read) return h.read(match[1]);
    return Response.json(detail(h.readId ?? match[1], h.status, h.cancelReason));
  };
  clearSession();
  function Probe() { h.tree = h.Component({ bookingId: h.id, scopeKey: 'shop:5', expectedShopId: '5', onUpdated: (value: unknown) => h.updates.push(value), onBusyChange: (v: boolean) => { h.busy = v; }, onDirtyChange: (v: boolean) => { h.dirty = v; }, onUnknownChange: (v: boolean) => { h.unknown = v; } } as any); return null; }
  function SignedIn() { h.auth = useAuthStore(); return h.auth.user && h.visible ? <Probe /> : null; }
  function Confirmation({ children }: { children: React.ReactNode }) { const provider = ConfirmationProvider({ children }); h.dialog = provider; return React.cloneElement(provider, {}, children); }
  const root = createRoot(container as unknown as HTMLElement);
  h.render = () => act(async () => { root.render(<StrictMode><AuthProvider><Confirmation><SignedIn /></Confirmation></AuthProvider></StrictMode>); });
  h.button = (label: string, tree = h.tree) => { const found = find(tree, node => node.type === 'button' && text(node).replace(/\s+/g, ' ').trim() === label); assert.ok(found, 'expected button: ' + label); return found; };
  h.click = (label: string) => act(async () => { void h.button(label).props.onClick(); });
  h.reasonField = () => find(h.dialog, node => node.type === 'textarea');
  h.fillReason = (value: string) => act(async () => {
    const field = h.reasonField(); assert.ok(field);
    field.props.onChange({ target: { value } });
  });
  h.confirmButton = () => {
    const dialog = find(h.dialog, node => node.props.role === 'alertdialog');
    assert.ok(dialog, 'confirmation is visible');
    const button = find(dialog, node => node.type === 'button' && text(node).trim() !== '取消');
    assert.ok(button);
    return button;
  };
  h.accept = async () => {
    if (h.reasonField()?.props.value === '') await h.fillReason('Synthetic cancellation');
    await act(async () => { h.confirmButton().props.onClick(); });
  };
  h.hasDialog = () => !!find(h.dialog, node => node.props.role === 'alertdialog');
  h.text = () => text(h.tree);
  h.resolve = async (url: URL) => Response.json({ bookingId: h.id, shopId: '5', requestKey: decodeURIComponent(url.pathname.split('/').at(-2)!), outcome: 'NOT_EXECUTED', action: null });
  try { await h.render(); await run(h); }
  finally { await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch; for (const [key, previous] of globals) { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); } }
}

test('admin confirmation owns the operation lock; an uncertain write freezes actions even after a read', async () => {
  await harness('841', async h => {
    const staleCancel = h.button('取消预约').props.onClick;
    h.write = async () => { throw new TypeError('synthetic lost response'); };
    await h.click('取消预约'); assert.equal(h.busy, true, 'parent must be busy while confirmation is open');
    await act(async () => { staleCancel(); }); assert.equal(h.hasDialog(), true);
    await h.accept(); assert.equal(h.mutations.length, 1); assert.equal(h.busy, false); assert.equal(h.unknown, true);
    await act(async () => { staleCancel(); }); assert.equal(h.hasDialog(), false, 'retired action cannot open another confirmation'); assert.equal(h.mutations.length, 1);
    assert.match(h.text(), /结果.*未确认|结果.*不明/);
    h.readId = 'wrong-order'; await h.click('只读核对订单及流水'); assert.equal(h.unknown, true); assert.equal(h.updates.length, 0); assert.match(h.text(), /不匹配/);
    h.readId = null; await h.click('只读核对订单及流水'); assert.equal(h.unknown, true, 'a read of old PENDING status does not prove the first request stopped'); assert.equal(h.updates.length, 1);
    assert.equal(h.button('取消预约').props.disabled, true); assert.equal(h.mutations.length, 1);
    assert.ok(JSON.parse(window.sessionStorage.getItem('massajoy.admin.unresolved-booking-operations.v1')!).includes(JSON.stringify(['5', '841'])), 'the unresolved order is retained across a refresh in this browser tab');
    h.id = '850'; await h.render(); assert.equal(h.button('取消预约').props.disabled, false, 'other orders remain operable');
    h.id = '841'; await h.render(); assert.equal(h.unknown, true); assert.equal(h.button('取消预约').props.disabled, true, 'returning to the unresolved order cannot clear its lock'); assert.equal(h.mutations.length, 1);
  });
});

test('retired order callbacks and delayed readbacks cannot operate on or publish a replacement order', async () => {
  await harness('842', async h => {
    const staleCancel = h.button('取消预约').props.onClick;
    await h.click('取消预约'); h.id = '843'; await h.render(); await h.accept(); assert.equal(h.mutations.length, 0, 'old confirmation cannot cancel the replacement order');
    assert.equal(h.busy, false, 'retired confirmation cannot leave the next order locked');
    await act(async () => { staleCancel(); }); assert.equal(h.hasDialog(), false);
    h.write = async (_url: URL, options: RequestInit) => {
      h.status = 'CANCELLED';
      h.cancelReason = JSON.parse(String(options.body)).cancelReason;
      return Response.json(detail('843', 'CANCELLED', h.cancelReason));
    };
    let finishRead: ((value: Response) => void) | undefined;
    await h.click('取消预约'); h.read = () => new Promise<Response>(resolve => { finishRead = resolve; }); await h.accept();
    assert.equal(h.busy, true); h.read = null; h.status = 'PENDING'; h.id = '844'; await h.render();
    await act(async () => { finishRead!(Response.json(detail('843', 'CANCELLED'))); });
    assert.equal(h.updates.length, 0); assert.equal(h.busy, false); assert.match(h.text(), /待确认/); assert.equal(h.button('取消预约').props.disabled, false);
  });
});

test('status receipts must match the requested order and transition; explicit rejection remains correctable', async () => {
  await harness('845', async h => {
    h.write = async () => Response.json({ message: '模拟订单冲突' }, { status: 409 });
    await h.click('取消预约'); await h.accept(); assert.equal(h.unknown, false); assert.match(h.text(), /模拟订单冲突/); assert.equal(h.button('取消预约').props.disabled, false); assert.equal(h.updates.length, 0);
    h.write = async () => Response.json(detail('different-id', 'CANCELLED'));
    await h.click('取消预约'); await h.accept(); assert.equal(h.unknown, true); assert.equal(h.updates.length, 0); assert.match(h.text(), /回执|不匹配/); assert.equal(h.button('取消预约').props.disabled, true);
  });
});

test('a concurrent status change blocks stale actions and refresh reads the actual cancellation reason', async () => {
  await harness('857', async h => {
    h.write = async () => {
      h.status = 'CANCELLED';
      h.cancelReason = '另一位管理员已取消预约';
      return Response.json({ code: 'BOOKING_STATUS_CHANGED', message: '预约状态已变化，请刷新订单后核对。' }, { status: 409 });
    };
    await h.click('取消预约');
    await h.fillReason('旧页面的取消原因');
    await h.accept();
    assert.equal(h.unknown, false);
    assert.equal(h.dirty, true);
    assert.equal(h.button('取消预约').props.disabled, true);
    assert.match(h.text(), /旧页面的取消原因/);
    assert.doesNotMatch(h.text(), /可再次尝试取消预约/);

    h.read = async () => Response.json({ message: '暂时无法读取订单' }, { status: 503 });
    await h.click('刷新订单');
    assert.match(h.text(), /旧页面的取消原因/);
    assert.equal(h.dirty, true);

    h.read = null;
    await h.click('刷新订单');
    assert.equal(h.mutations.length, 1);
    assert.equal(h.dirty, false);
    assert.match(h.text(), /已取消/);
    assert.equal(find(h.tree, node => node.type === 'button' && text(node) === '取消预约'), undefined);
  });
});

test('admin cancellation requires a labeled reason, keeps a rejected draft, and publishes the saved trimmed reason', async () => {
  await harness('856', async h => {
    const successfulWrite = h.write;
    h.write = async () => Response.json({ message: '模拟取消暂时被拒绝' }, { status: 409 });
    await h.click('取消预约');
    const field = h.reasonField();
    assert.equal(field?.props.required, true);
    assert.equal(field?.props.maxLength, 500);
    const label = find(h.dialog, node => node.type === 'label' && node.props.htmlFor === field?.props.id);
    assert.equal(text(label), '取消原因（必填）');
    const description = find(h.dialog, node => node.props.id === field?.props['aria-describedby']);
    assert.match(text(description), /顾客.*订单详情/);
    assert.equal(h.confirmButton().props.disabled, true);
    await h.fillReason('　   ');
    await act(async () => { h.confirmButton().props.onClick(); });
    assert.equal(h.mutations.length, 0);
    await h.fillReason('原'.repeat(501));
    assert.equal(h.confirmButton().props.disabled, true);
    await h.fillReason('　顾客来电改约　 ');
    assert.equal(h.confirmButton().props.disabled, false);
    await h.accept();
    assert.equal(h.unknown, false);
    assert.deepEqual(h.payloads, [{ cancelReason: '顾客来电改约' }]);
    assert.match(h.text(), /模拟取消暂时被拒绝/);
    assert.equal(h.dirty, true, 'a rejected reason protects the drawer as an unsaved draft');
    await h.click('取消预约');
    assert.equal(h.reasonField()?.props.value, '顾客来电改约');
    await act(async () => { h.button('取消', h.dialog).props.onClick(); });
    assert.equal(h.dirty, true, 'dismissing a retry confirmation keeps the retained reason');
    await h.click('清除取消原因草稿');
    assert.equal(h.dirty, false);
    assert.equal(h.mutations.length, 1, 'clearing the draft causes no write');
    await h.click('取消预约');
    assert.equal(h.reasonField()?.props.value, '');
    await h.fillReason('顾客来电改约');
    h.write = successfulWrite;
    await h.accept();
    assert.notEqual(h.keys[0], h.keys[1]);
    assert.deepEqual(h.payloads[1], h.payloads[0]);
    assert.equal(h.dirty, false, 'a successful cancellation clears the draft protection');
    assert.equal(h.updates.at(-1).status, 'CANCELLED');
    assert.equal(h.updates.at(-1).cancelReason, '顾客来电改约');
  });
});

test('first-time guest cancellation explains who can read the reason and how to notify the guest', async () => {
  await harness('857', async h => {
    h.read = async (id: string) => Response.json({
      ...detail(id, h.status, h.cancelReason),
      bookingSource: 'ASSISTED_GUEST',
      userId: null,
      guestSource: 'WALK_IN',
      contact: {
        recorded: true,
        version: 1,
        source: 'GUEST_ASSISTED',
        name: 'Synthetic walk-in',
        phone: '+12025550123',
        email: null,
        emailVerifiedAt: null,
      },
    });
    const refresh = find(h.tree, node => node.props['aria-label'] === '刷新订单及预约详情');
    assert.ok(refresh);
    await act(async () => { refresh.props.onClick(); });
    await h.click('取消预约');
    const field = h.reasonField();
    assert.ok(field);
    const description = find(h.dialog, node => node.props.id === field.props['aria-describedby']);
    assert.match(text(description), /取消原因将记录在订单中，供有权限的工作人员查看/);
    assert.match(text(description), /如需通知顾客，请拨打订单中的联系电话/);
    assert.doesNotMatch(text(description), /顾客和有权限的门店人员可在订单详情中读取/);
    await h.fillReason('　首次到店客来电取消　');
    await h.accept();
    assert.deepEqual(h.payloads, [{ cancelReason: '首次到店客来电取消' }]);
    assert.equal(h.updates.at(-1).status, 'CANCELLED');
    assert.equal(h.updates.at(-1).cancelReason, '首次到店客来电取消');
  });
});

test('accept and complete clicks publish only matching readbacks and reject retired snapshot callbacks', async () => {
  await harness('846', async h => {
    h.write = async (url: URL) => { h.status = url.searchParams.get('status'); return Response.json(detail(h.id, h.status)); };
    const oldAccept = h.button('确认订单预约').props.onClick;
    await h.click('确认订单预约'); await act(async () => { oldAccept(); }); await h.accept();
    assert.equal(h.mutations.length, 1); assert.equal(h.updates.at(-1).status, 'CONFIRMED');
    await act(async () => { oldAccept(); }); assert.equal(h.hasDialog(), false, 'a stale PENDING snapshot cannot accept the already confirmed order again');
    await h.click('确认完成服务'); assert.equal(h.busy, true); await h.accept();
    assert.equal(h.mutations.length, 2); assert.equal(h.updates.at(-1).status, 'COMPLETED'); assert.equal(h.busy, false); assert.equal(h.unknown, false);
    assert.deepEqual(h.payloads, [undefined, undefined]);
    assert.equal(find(h.tree, node => node.type === 'button' && text(node).trim() === '确认完成服务'), undefined);
  });
});

test('logout invalidates an old order callback synchronously before React renders a new actor', async () => {
  await harness('847', async h => {
    const staleCancel = h.button('取消预约').props.onClick;
    await act(async () => { clearSession(); staleCancel(); });
    assert.equal(h.hasDialog(), false); assert.equal(h.mutations.length, 0);
    h.actor = { id: '8', role: 'ADMIN', name: 'Other synthetic admin' };
    await act(async () => { await h.auth.login('synthetic-admin', 'synthetic-only'); });
    await act(async () => { staleCancel(); }); assert.equal(h.hasDialog(), false); assert.equal(h.mutations.length, 0);
    await h.click('取消预约'); await h.accept(); assert.equal(h.mutations.length, 1); assert.equal(h.updates.at(-1).id, '847');
  });
});

test('ledger submission locks before its confirmation and retains an uncertain draft without a second write', async () => {
  await harness('848', async h => {
    await h.click('登记已收到款项');
    const reason = find(h.tree, node => node.type === 'textarea'); assert.ok(reason);
    await act(async () => { reason.props.onChange({ target: { value: 'Synthetic received cash' } }); });
    const form = find(h.tree, node => node.type === 'form' && /真实原因/.test(text(node))); assert.ok(form);
    h.write = async () => { throw new TypeError('lost ledger receipt'); };
    await act(async () => { void form.props.onSubmit({ preventDefault() {} }); void form.props.onSubmit({ preventDefault() {} }); });
    assert.equal(h.busy, true); assert.equal(h.hasDialog(), true); await h.accept();
    assert.equal(h.mutations.length, 1); assert.equal(h.unknown, true); assert.equal(h.dirty, true);
    const kept = find(h.tree, node => node.type === 'textarea'); assert.equal(kept?.props.value, 'Synthetic received cash');
    const locked = find(h.tree, node => node.type === 'fieldset'); assert.equal(locked?.props.disabled, true);
    await act(async () => { void form.props.onSubmit({ preventDefault() {} }); }); assert.equal(h.hasDialog(), false); assert.equal(h.mutations.length, 1);
    await h.click('只读核对订单及流水'); assert.equal(h.unknown, true); assert.equal(h.dirty, true); assert.equal(find(h.tree, node => node.type === 'textarea')?.props.value, 'Synthetic received cash');
  });
});

test('a reschedule receipt must acknowledge the submitted shop calendar time', async () => {
  await harness('849', async h => {
    const time = find(h.tree, node => node.type === 'select'); assert.ok(time);
    await act(async () => { time.props.onChange({ target: { value: '11:00' } }); });
    const form = find(h.tree, node => node.type === 'form'); assert.ok(form);
    h.write = async () => Response.json(detail(h.id));
    await act(async () => { await form.props.onSubmit({ preventDefault() {} }); });
    assert.equal(h.mutations.length, 1); assert.equal(h.unknown, true); assert.equal(h.updates.length, 0); assert.match(h.text(), /改期回执/);
    assert.equal(find(h.tree, node => node.type === 'select')?.props.value, '11:00', 'unknown reschedule preserves the original submitted draft');
  });
});

test('a lost status response stores the exact submitting identity and key before dispatch, then safely resolves an unexecuted command', async () => {
  await harness('861', async h => {
    let rejectWrite: ((error: Error) => void) | undefined;
    h.write = async (_url: URL, options: RequestInit) => {
      const saved = JSON.parse(window.sessionStorage.getItem('massajoy.admin.booking-operation-attempts.v2')!)[JSON.stringify(['5', '861'])];
      assert.deepEqual(saved, { actorId: '7', shopId: '5', requestKey: new Headers(options.headers).get('Idempotency-Key'), action: 'STATUS:CANCELLED' });
      return new Promise<Response>((_, reject) => { rejectWrite = reject; });
    };
    await h.click('取消预约'); await h.accept(); assert.equal(h.busy, true);
    await act(async () => { rejectWrite!(new Error('synthetic lost response')); });
    assert.equal(h.unknown, true); assert.match(h.keys[0], /^[a-f\d-]{36}$/);
    await h.click('核对原操作结果'); assert.equal(h.busy, true); assert.equal(h.reconciles.length, 0, 'reconciliation requires explicit confirmation');
    await h.accept();
    assert.equal(h.reconciles.length, 1); assert.ok(h.reconciles[0].includes(h.keys[0]));
    assert.equal(h.mutations.length, 1, 'recovery never resubmits the original cancellation');
    assert.equal(h.unknown, false); assert.equal(h.button('取消预约').props.disabled, false);
    assert.match(h.text(), /原操作未执行，旧请求已失效/); assert.equal(h.updates.at(-1).status, 'PENDING');
    assert.equal(JSON.parse(window.sessionStorage.getItem('massajoy.admin.unresolved-booking-operations.v1')!).includes(JSON.stringify(['5', '861'])), false);
    await h.click('取消预约');
    assert.equal(h.reasonField()?.props.value, 'Synthetic cancellation');
  });
});

test('committed operation recovery validates the receipt and current snapshots before clearing a retained draft', async () => {
  await harness('862', async h => {
    h.write = async () => { throw new TypeError('lost response'); };
    await h.click('取消预约'); await h.accept();
    h.resolve = async () => Response.json({ bookingId: h.id, shopId: '5', requestKey: h.keys[0], outcome: 'COMMITTED', action: 'STATUS:CONFIRMED' });
    await h.click('核对原操作结果'); await h.accept();
    assert.equal(h.unknown, true); assert.match(h.text(), /核对回执不匹配/); assert.equal(h.updates.length, 0);
    h.resolve = async () => { h.status = 'CANCELLED'; return Response.json({ bookingId: h.id, shopId: '5', requestKey: h.keys[0], outcome: 'COMMITTED', action: 'STATUS:CANCELLED' }); };
    h.read = async () => Response.json({ message: '模拟读取暂时失败' }, { status: 503 });
    await h.click('核对原操作结果'); await h.accept();
    assert.equal(h.unknown, true); assert.match(h.text(), /继续保留草稿与只读状态/); assert.equal(h.updates.length, 0);
    h.read = null;
    await h.click('核对原操作结果'); await h.accept();
    assert.equal(h.unknown, false); assert.equal(h.updates.at(-1).status, 'CANCELLED'); assert.match(h.text(), /原操作执行完成/);
    assert.equal(h.mutations.length, 1);
  });
});

test('reopening and switching administrators cannot reconcile or discard another actor’s retained operation', async () => {
  await harness('863', async h => {
    h.write = async () => { throw new TypeError('lost response'); };
    await h.click('取消预约'); await h.accept();
    h.visible = false; await h.render(); h.visible = true; await h.render();
    assert.equal(h.unknown, true); assert.ok(h.button('核对原操作结果'));
    const oldResolve = h.button('核对原操作结果').props.onClick;
    h.actor = { id: '8', role: 'ADMIN', name: 'Other synthetic admin' };
    await act(async () => { await h.auth.login('synthetic-admin', 'synthetic-only'); });
    assert.equal(h.unknown, true); assert.match(h.text(), /提交原操作的管理员账号/);
    assert.equal(find(h.tree, node => node.type === 'button' && text(node).trim() === '核对原操作结果'), undefined);
    await act(async () => { oldResolve(); }); assert.equal(h.hasDialog(), false); assert.equal(h.reconciles.length, 0);
    assert.equal(h.button('取消预约').props.disabled, true);
    h.actor = { id: '7', role: 'ADMIN', name: 'Synthetic admin' };
    await act(async () => { await h.auth.login('synthetic-admin', 'synthetic-only'); });
    await h.click('核对原操作结果'); await h.accept(); assert.equal(h.unknown, false);
  });
});

test('a late reconciliation readback cannot unlock or publish a newly selected order', async () => {
  await harness('864', async h => {
    h.write = async () => { throw new TypeError('lost response'); };
    await h.click('取消预约'); await h.accept();
    let finishRead: ((response: Response) => void) | undefined;
    h.read = async () => new Promise<Response>(resolve => { finishRead = resolve; });
    await h.click('核对原操作结果'); await h.accept(); assert.equal(h.busy, true);
    h.read = null; h.id = '865'; await h.render();
    await act(async () => { finishRead!(Response.json(detail('864'))); });
    assert.equal(h.updates.length, 0); assert.equal(h.unknown, false); assert.equal(h.busy, false);
    assert.equal(h.button('取消预约').props.disabled, false);
    h.id = '864'; await h.render(); assert.equal(h.unknown, true, 'old scope keeps its marker until that order is actively reconciled');
    assert.equal(h.mutations.length, 1);
  });
});

test('legacy unkeyed unknown orders remain read-only and never invent a recoverable operation key', async () => {
  await harness('866', async h => {
    const legacy = JSON.stringify(['5', '867']);
    window.sessionStorage.setItem('massajoy.admin.unresolved-booking-operations.v1', JSON.stringify([legacy]));
    h.id = '867'; await h.render();
    assert.equal(h.unknown, true); assert.match(h.text(), /旧版无操作编号/);
    assert.equal(find(h.tree, node => node.type === 'button' && text(node).trim() === '核对原操作结果'), undefined);
    await h.click('只读核对订单及流水'); assert.equal(h.unknown, true); assert.equal(h.reconciles.length, 0); assert.equal(h.mutations.length, 0);
  });
});

test('a fresh module restores the exact operation from browser storage after the old view is destroyed', async () => {
  await harness('868', async h => {
    h.write = async () => { throw new TypeError('lost response'); };
    await h.click('取消预约'); await h.accept();
    const originalKey = h.keys[0]; h.visible = false; await h.render();
    h.Component = (await import(new URL('./BookingReservationActions.tsx?operation-storage-reload', import.meta.url).href)).default;
    h.visible = true; await h.render();
    assert.equal(h.unknown, true); assert.equal(h.button('取消预约').props.disabled, true);
    await h.click('核对原操作结果'); await h.accept();
    assert.equal(h.reconciles.length, 1); assert.ok(h.reconciles[0].includes(originalKey));
    assert.equal(h.unknown, false); assert.equal(h.mutations.length, 1);
  });
});
