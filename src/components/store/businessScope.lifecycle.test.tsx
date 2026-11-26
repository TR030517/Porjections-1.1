import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession } from '../../api/session';
import { acceptExplicitLogin, logoutIntent } from '../../api/logoutIntent';
import { useBusinessScope } from './businessScope';

test('StrictMode descendant reads start with an active business scope on both effect connections', async () => {
  // No host elements are rendered. A root/event surface is enough to exercise
  // React's actual layout/passive lifecycle without a browser or DOM package.
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const priorFetch = globalThis.fetch;
  const documentSurface: Record<string, unknown> = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const storage = new Map<string, string>();
  const windowSurface = { localStorage: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value) }, document: documentSurface, HTMLIFrameElement: class {}, event: undefined, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  documentSurface.defaultView = windowSurface;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: documentSurface, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowSurface });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const user = { id: '7', role: 'ADMIN', name: 'Test admin' };
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh') || path.endsWith('/auth/me'), 'only mocked session restoration is allowed');
    return Response.json(path.endsWith('/auth/me') ? user : { accessToken: 'test-only', user });
  };
  assert.equal(acceptExplicitLogin(logoutIntent()), true);
  clearSession();
  const admitted: boolean[] = [], captures: Array<() => boolean> = [];
  function Descendant({ capture }: { capture: () => () => boolean }) {
    useEffect(() => { const current = capture(); captures.push(current); admitted.push(current()); }, [capture]);
    return null;
  }
  function ScopedParent() {
    const scope = useBusinessScope('9007199254740993');
    return <Descendant capture={scope.capture} />;
  }
  function AuthenticatedProbe() { return useAuthStore().user ? <ScopedParent /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => { root.render(<StrictMode><AuthProvider><AuthenticatedProbe /></AuthProvider></StrictMode>); });
    assert.deepEqual(admitted, [true, true], 'StrictMode remount must not fail the first configuration read');
    assert.equal(captures[0](), false, 'the response captured before strict cleanup remains retired');
    assert.equal(captures[1](), true);
    await act(async () => { clearSession(); });
    assert.equal(captures[1](), false, 'logging out retires the reconnected read as well');
  } finally {
    await act(async () => { root.unmount(); });
    clearSession();
    assert.equal(acceptExplicitLogin(logoutIntent()), true);
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
