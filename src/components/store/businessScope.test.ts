import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessIdentity, createBusinessFence } from './businessScope';

test('a header filter change cannot replace the explicit store of an open editor', () => {
  let header = '12';
  const editor = createBusinessFence(() => businessIdentity('7', '9007199254740993', header));
  const pending = editor.capture();
  header = '13'; editor.sync();
  assert.equal(pending(), true);
  assert.equal(businessIdentity('7', '9007199254740993', header), '7:9007199254740993');
  const page = createBusinessFence(() => businessIdentity('7', undefined, header));
  const pagePending = page.capture(); header = '14'; page.sync();
  assert.equal(pagePending(), false);
});

test('actor replacement, logout and disposal invalidate prior writes even after returning to the same actor', () => {
  let actor: string | null = '7';
  const fence = createBusinessFence(() => businessIdentity(actor, '12', '13'));
  const old = fence.capture(); actor = null; fence.sync(); actor = '7'; fence.sync();
  assert.equal(old(), false);
  const next = fence.capture(); actor = '8'; fence.sync();
  assert.equal(next(), false);
  const active = fence.capture(); fence.dispose(); assert.equal(active(), false);
});

test('reconnecting a scope admits the first new read without reviving pre-cleanup responses', () => {
  let actor: string | null = '7';
  const fence = createBusinessFence(() => businessIdentity(actor, '12', '13'));
  const firstMount = fence.capture();
  fence.dispose();
  assert.equal(firstMount(), false);
  fence.activate();
  const reconnected = fence.capture();
  assert.equal(reconnected(), true, 'the descendant read after layout reconnect is ready immediately');
  assert.equal(firstMount(), false, 'StrictMode reconnect must not admit the old response');
  actor = '8'; fence.sync();
  assert.equal(reconnected(), false, 'account replacement still invalidates the new read');
});

test('render events reconnect for the same identity without reviving async work or retired identities', () => {
  let actor: string | null = '7', shop = '12';
  const fence = createBusinessFence(() => businessIdentity(actor, shop, null));
  const event = fence.captureEvent(), read = fence.capture();
  fence.dispose(); assert.equal(event(), false); assert.equal(read(), false);
  fence.activate(); assert.equal(event(), true); assert.equal(read(), false);
  shop = '13'; fence.sync(); shop = '12'; fence.sync(); assert.equal(event(), false);
  const beforeLogout = fence.captureEvent(); actor = null; fence.sync(); actor = '7'; fence.sync(); assert.equal(beforeLogout(), false);
  const beforeUnmount = fence.captureEvent(); fence.dispose(); assert.equal(beforeUnmount(), false);
});
