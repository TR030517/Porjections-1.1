import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AccountSecurityDialog from './AccountSecurityDialog';
import { ApiError } from '../api/session';

type Element = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) return tree.map(node => find(node, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Element; return predicate(node) ? node : find(node.props.children, predicate);
}
function words(tree: unknown): string { return Array.isArray(tree) ? tree.map(words).join(' ') : React.isValidElement(tree) ? words((tree as Element).props.children) : typeof tree === 'string' ? tree : ''; }
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
async function harness(work: (controls: any) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const document: any = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const window = { document, HTMLIFrameElement: class {}, event: undefined }; document.defaultView = window;
  for (const [key, value] of Object.entries({ window, document, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  let tree: unknown, calls = 0, closed = 0, relogin = 0, operation: () => Promise<void> = async () => undefined;
  const root = createRoot(container as unknown as HTMLElement);
  function Probe() { tree = AccountSecurityDialog({ account: { id: '1', role: 'ADMIN', email: 'synthetic@example.invalid' }, sessionKey: 'session-first',
    changePassword: async input => { assert.deepEqual(input, { currentPassword: 'Synthetic-current', newPassword: 'Synthetic-new-pass' }); calls++; await operation(); }, onClose: () => { closed++; }, onReauthenticate: () => { relogin++; } }); return null; }
  const control = (predicate: (node: Element) => boolean) => { const result = find(tree, predicate); assert.ok(result); return result; };
  const field = (name: string) => control(node => node.type === 'input' && node.props.name === name);
  const edit = (name: string, value: string) => act(async () => { field(name).props.onChange({ target: { value } }); });
  const fill = async () => { await edit('currentPassword', 'Synthetic-current'); await edit('newPassword', 'Synthetic-new-pass'); await edit('confirmation', 'Synthetic-new-pass'); };
  const submit = () => control(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  let unmounted = false;
  try {
    await act(async () => root.render(<Probe />));
    await work({ field, edit, fill, submit, control, words: () => words(tree), setOperation: (next: () => Promise<void>) => { operation = next; },
      calls: () => calls, closed: () => closed, relogin: () => relogin, unmount: async () => { await act(async () => root.unmount()); unmounted = true; } });
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    keys.forEach((key, index) => { const value = previous[index]; if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('shared password dialog validates confirmation, blocks duplicate submits and retains failed draft without a success claim', async () => {
  await harness(async h => {
    assert.equal(h.field('currentPassword').props.autoComplete, 'current-password');
    assert.equal(h.field('newPassword').props.autoComplete, 'new-password');
    assert.equal(h.field('newPassword').props.type, 'password');
    await h.fill(); await h.edit('confirmation', 'mismatch'); await act(async () => h.submit());
    assert.equal(h.calls(), 0); assert.match(h.words(), /不一致/);
    await h.edit('confirmation', 'Synthetic-new-pass'); const pending = deferred<void>(); h.setOperation(() => pending.promise);
    let request: Promise<void>;
    await act(async () => { request = h.submit(); void h.submit(); });
    assert.equal(h.calls(), 1); assert.equal(h.field('currentPassword').props.disabled, true);
    await act(async () => { pending.reject(new ApiError('Wrong current password', 401, 'CURRENT_PASSWORD_INVALID')); await request!; });
    assert.equal(h.closed(), 0); assert.match(h.words(), /当前密码不正确/);
    assert.equal(h.field('currentPassword').props.value, ''); assert.equal(h.field('newPassword').props.value, 'Synthetic-new-pass');
    await h.edit('currentPassword', 'Synthetic-current'); h.setOperation(async () => undefined);
    await act(async () => h.submit()); assert.equal(h.calls(), 2); assert.equal(h.closed(), 1);
  });
});

test('ambiguous password reply blocks blind retries and offers explicit reauthentication', async () => {
  await harness(async h => {
    await h.fill(); h.setOperation(async () => { throw new ApiError('Synthetic transport loss'); });
    await act(async () => h.submit()); assert.match(h.words(), /无法确认密码是否已修改/); assert.equal(h.closed(), 0);
    await act(async () => h.submit()); assert.equal(h.calls(), 1);
    assert.equal(h.field('currentPassword').props.disabled, true);
    await act(async () => h.control((node: Element) => node.type === 'button' && words(node) === '重新登录核对').props.onClick());
    assert.equal(h.relogin(), 1);
  });
});

test('unmounted password dialog ignores its late response', async () => {
  await harness(async h => {
    const pending = deferred<void>(); h.setOperation(() => pending.promise); await h.fill(); let request: Promise<void>;
    await act(async () => { request = h.submit(); }); await h.unmount();
    await act(async () => { pending.resolve(); await request!; }); assert.equal(h.closed(), 0);
  });
});
