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
const config = (): ReservationConfig => ({ shopId: '5', timezone: 'America/Los_Angeles', paymentPolicy: { payAtStoreEnabled: true }, services: [], rooms: [], therapists: [{ id: '8', shopId: '5', name: 'Synthetic therapist', isActive: true, scheduleMode: 'SHOP', serviceIds: [], shifts: [], timeOff: [] }] });
type Mutation = (path: string, body: Record<string, unknown>, value: ReservationConfig) => Response | Promise<Response>;

async function withSettings(value: ReservationConfig, resourcesOnly: boolean, mutate: Mutation, run: (ui: {
  tree(): unknown; editor(): Node; section(title: string): Node; button(label: string, confirmation?: boolean): Node;
  lifecycle(): BusinessLifecycle; changed(): number; writes: string[];
  edit(fields: Record<string, string | boolean>): Promise<void>; submit(): Promise<void>;
}) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } }; doc.defaultView = win;
  for (const [key, content] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value: content });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic reservation admin' };
  let tree: unknown, confirmation: unknown, changed = 0, lifecycle: BusinessLifecycle = { dirty: false, busy: false, unknown: false };
  const writes: string[] = [];
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    assert.match(path, /\/reservation-admin\/shops\/5\//);
    if (path.endsWith('/config')) return Response.json(value);
    writes.push(path);
    return mutate(path, JSON.parse(String(options?.body ?? '{}')), value);
  };
  clearSession();
  function Probe() { tree = ReservationSettings({ explicitShopId: '5', embedded: true, resourcesOnly, initialTab: 'therapists', initialTherapistId: '8', onBack() {}, onManageQualifications() {}, onChanged: () => { changed++; }, onLifecycleChange: next => { lifecycle = next; } }); return null; }
  function SilentConfirmation({ children }: { children: React.ReactNode }) { const provider = ConfirmationProvider({ children }); confirmation = provider; return React.cloneElement(provider, {}, children); }
  function SignedIn() { return useAuthStore().user ? <SilentConfirmation><Probe /></SilentConfirmation> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const control = (surface: unknown, predicate: (node: Node) => boolean) => { const result = find(surface, predicate); assert.ok(result, 'expected reservation control exists'); return result; };
  const editor = () => control(tree, node => typeof node.type === 'function' && node.type.name === 'ReservationEditor');
  try {
    await act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
    await run({
      tree: () => tree, editor, section: title => control(tree, node => typeof node.type === 'function' && node.type.name === 'Section' && node.props.title === title),
      button: (label, dialog = false) => control(dialog ? confirmation : tree, node => node.type === 'button' && text(node).trim() === label),
      lifecycle: () => lifecycle, changed: () => changed, writes,
      edit: fields => act(async () => { editor().props.setEditor((previous: any) => ({ ...previous, form: { ...previous.form, ...fields } })); }),
      submit: () => act(async () => { editor().props.onSave({ preventDefault() {}, stopPropagation() {} }); }),
    });
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('a success ID followed by a stale exception readback preserves its draft and blocks retries', async () => {
  await withSettings(config(), true, () => Response.json({ item: { id: '21' } }), async ui => {
    await act(async () => { ui.section('休假 / 临时离岗').props.button.props.onClick(); });
    await ui.edit({ startLocal: '2026-12-31T20:00', endLocal: '2027-01-01T10:00', reason: 'Synthetic pending absence' });
    await ui.submit();
    assert.equal(ui.lifecycle().unknown, true, 'a syntactically valid old configuration is not proof of this save');
    assert.equal(ui.editor().props.editor.form.reason, 'Synthetic pending absence');
    assert.equal(ui.changed(), 0, 'siblings must not receive a completed-save notification');
    assert.doesNotMatch(text(ui.tree()), /已保存，并已重新读取服务器设置/);
    await ui.submit(); assert.equal(ui.writes.length, 1, 'an unresolved save cannot create the same absence twice');
  });
});

test('a schedule receipt cannot clear the editor when the fresh configuration still has the old mode', async () => {
  await withSettings(config(), true, () => Response.json({ item: { id: '8', scheduleMode: 'CUSTOM' } }), async ui => {
    await act(async () => { ui.section('排班方式').props.button.props.onClick(); });
    await ui.edit({ scheduleMode: 'CUSTOM' }); await ui.submit();
    assert.equal(ui.lifecycle().unknown, true);
    assert.equal(ui.editor().props.editor.form.scheduleMode, 'CUSTOM');
    assert.equal(ui.changed(), 0); await ui.submit(); assert.equal(ui.writes.length, 1);
  });
});

test('a deletion success cannot announce completion while its exception remains in the refreshed configuration', async () => {
  const value = config();
  value.therapists[0].timeOff.push({ id: '21', therapistId: '8', startAtUtc: '2027-01-01T04:00:00.000Z', endAtUtc: '2027-01-01T18:00:00.000Z', reason: 'Synthetic absence' });
  await withSettings(value, true, () => Response.json({ success: true }), async ui => {
    const remove = ui.button('删除').props.onClick;
    await act(async () => { remove(); remove(); });
    await act(async () => { ui.button('删除时段', true).props.onClick(); });
    assert.equal(ui.lifecycle().unknown, true);
    assert.equal(ui.changed(), 0); assert.doesNotMatch(text(ui.tree()), /阻断时段已删除/);
    await act(async () => { remove(); }); assert.equal(ui.writes.length, 1);
  });
});

test('payment policy completion requires the submitted policy in the readback', async () => {
  await withSettings(config(), false, () => Response.json({ paymentPolicy: { payAtStoreEnabled: false } }), async ui => {
    const panel = find(ui.tree(), node => typeof node.type === 'function' && node.type.name === 'PaymentPolicyPanel'); assert.ok(panel);
    await act(async () => { void panel.props.onSave(false); });
    await act(async () => { ui.button('保存政策', true).props.onClick(); });
    assert.equal(ui.lifecycle().unknown, true);
    assert.equal(ui.changed(), 0); assert.doesNotMatch(text(ui.tree()), /付款政策已保存/);
    await act(async () => { void panel.props.onSave(false); }); assert.equal(ui.writes.length, 1);
  });
});

test('a matching exception readback completes once and does not leave the editor locked', async () => {
  await withSettings(config(), true, (_path, body, value) => {
    value.therapists[0].timeOff.push({ id: '21', therapistId: '8', startAtUtc: String(body.startAtUtc), endAtUtc: String(body.endAtUtc), reason: body.reason as string | null });
    return Response.json({ item: { id: '21' } });
  }, async ui => {
    await act(async () => { ui.section('休假 / 临时离岗').props.button.props.onClick(); });
    await ui.edit({ startLocal: '2026-12-31T20:00', endLocal: '2027-01-01T10:00', reason: 'Synthetic confirmed absence' });
    const submit = ui.editor().props.onSave;
    await act(async () => { submit({ preventDefault() {}, stopPropagation() {} }); submit({ preventDefault() {}, stopPropagation() {} }); });
    assert.equal(ui.writes.length, 1); assert.equal(ui.changed(), 1);
    assert.equal(ui.lifecycle().unknown, false); assert.equal(ui.lifecycle().dirty, false);
    assert.equal(find(ui.tree(), node => typeof node.type === 'function' && node.type.name === 'ReservationEditor'), undefined);
    assert.match(text(ui.tree()), /技师休假已保存/);
    assert.equal(ui.section('休假 / 临时离岗').props.button.props.disabled, false);
  });
});
