import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadBannerMedia } from '../api/bannerMedia';
import { BannerDraftSession, type BannerMedia, type BannerMediaTransport } from './bannerDraft';

const firstId = '00000000-0000-4000-8000-000000000001', secondId = '00000000-0000-4000-8000-000000000002';
const media = (id = firstId): BannerMedia => ({ id, fileUrl: `/api/v1/upload/media/${id}/file`, scope: 'BANNER', shopId: null, purpose: 'banner', status: 'STAGED', mimeType: 'image/webp', sizeBytes: 32, width: 1200, height: 450, expiresAt: '2099-01-01T00:00:00Z' });
const image = (value = 1) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, value])], 'synthetic.png', { type: 'image/png' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const calls: { kind: string; id?: string; key?: string }[] = [];
  const transport: BannerMediaTransport = {
    upload: async (_file, key) => { calls.push({ kind: 'upload', key }); return media(); },
    confirm: async id => { calls.push({ kind: 'confirm', id }); return media(id); },
    abandon: async id => { calls.push({ kind: 'abandon', id }); },
  };
  return { calls, transport };
}

test('banner file transport authenticates the exact platform scope without a shop ID or JSON content type', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/upload/media');
    assert.equal(options?.credentials, 'include');
    assert.equal(new Headers(options?.headers).get('Content-Type'), null);
    const form = options?.body as FormData;
    assert.ok(form instanceof FormData);
    assert.deepEqual([...form.keys()].sort(), ['file', 'purpose', 'requestKey', 'scope']);
    assert.equal(form.get('scope'), 'BANNER'); assert.equal(form.get('purpose'), 'banner');
    assert.equal(form.get('requestKey'), 'stable-banner-key'); assert.ok(form.get('file') instanceof File);
    return Response.json({ item: media() });
  };
  try { assert.equal((await uploadBannerMedia(image(), 'stable-banner-key')).id, firstId); }
  finally { globalThis.fetch = original; }
});

test('an uncertain upload retries the same file and key, while a different file receives a new key', async () => {
  const { calls, transport } = fixture(); let fail = true;
  transport.upload = async (_file, key) => { calls.push({ kind: 'upload', key }); if (fail) { fail = false; throw new Error('Synthetic network failure'); } return media(); };
  const session = new BannerDraftSession(transport);
  await assert.rejects(session.upload(image()));
  assert.equal(await session.upload(image()), media().fileUrl);
  assert.equal(calls[0].key, calls[1].key);
  await session.upload(image(2));
  assert.notEqual(calls[0].key, calls.filter(call => call.kind === 'upload').at(-1)!.key);
  await session.dispose();
});

test('closing while upload is pending cleans its late identity without confirming or applying it', async () => {
  const { calls, transport } = fixture(), response = deferred<BannerMedia>(), entered = deferred<void>();
  transport.upload = async () => { entered.resolve(); return response.promise; };
  const session = new BannerDraftSession(transport), pending = session.upload(image());
  const rejected = assert.rejects(pending, /编辑已关闭/);
  await entered.promise; await session.dispose(); response.resolve(media()); await rejected;
  assert.deepEqual(calls, [{ kind: 'abandon', id: firstId }]);
});

test('a late confirmation stays isolated from a replacement editor and its saved image', async () => {
  const previous = fixture(), current = fixture(), response = deferred<BannerMedia>(), entered = deferred<void>();
  previous.transport.confirm = async () => { entered.resolve(); return response.promise; };
  current.transport.upload = async () => media(secondId);
  const oldSession = new BannerDraftSession(previous.transport), oldPending = oldSession.upload(image());
  const rejected = assert.rejects(oldPending, /编辑已关闭/);
  await entered.promise; await oldSession.dispose();
  const nextSession = new BannerDraftSession(current.transport);
  assert.equal(await nextSession.upload(image(2)), media(secondId).fileUrl);
  await nextSession.saved(media(secondId).fileUrl);
  response.resolve(media()); await rejected; await nextSession.dispose();
  assert.deepEqual(previous.calls.filter(call => call.kind === 'abandon'), [{ kind: 'abandon', id: firstId }]);
  assert.deepEqual(current.calls.filter(call => call.kind === 'abandon'), []);
});

test('saving the returned URL preserves its image and cleans only unused files from that draft', async () => {
  const { calls, transport } = fixture(); let count = 0;
  transport.upload = async () => media(count++ ? secondId : firstId);
  const session = new BannerDraftSession(transport);
  await session.upload(image()); await session.upload(image(2));
  assert.equal(await session.saved(media().fileUrl), 0); await session.dispose();
  assert.deepEqual(calls.filter(call => call.kind === 'abandon'), [{ kind: 'abandon', id: secondId }]);
});

test('foreign scopes and malformed routes are rejected without deleting another resource’s media', async () => {
  for (const item of [
    { ...media(), scope: 'SHOP', shopId: '7', purpose: 'cover' },
    { ...media(), scope: 'AVATAR', purpose: 'avatar' },
    { ...media(), fileUrl: '/uploads/not-a-managed-image.png' },
    { ...media(), shopId: '7' },
  ]) {
    const { calls, transport } = fixture(); transport.upload = async () => item as unknown as BannerMedia;
    const session = new BannerDraftSession(transport);
    await assert.rejects(session.upload(image())); await session.dispose();
    assert.equal(calls.filter(call => call.kind === 'abandon').length, 0);
  }
});

test('failed confirmation retains its owned staged file for retryable cleanup and bound conflicts are preserved', async () => {
  const { calls, transport } = fixture(); let mode = 'failure';
  transport.confirm = async () => { throw new Error('Synthetic failed integrity check'); };
  transport.abandon = async id => { calls.push({ kind: 'abandon', id }); throw Object.assign(new Error('Synthetic cleanup response'), { status: mode === 'failure' ? 503 : 409 }); };
  const session = new BannerDraftSession(transport);
  await assert.rejects(session.upload(image()));
  assert.equal(await session.cleanup(), 1); mode = 'bound';
  assert.equal(await session.cleanup(), 0); await session.dispose();
  assert.equal(calls.filter(call => call.kind === 'abandon').length, 2);
});

test('confirmation cannot substitute a different asset and expired staging never reaches the draft', async () => {
  const first = fixture(); first.transport.confirm = async () => media(secondId);
  const session = new BannerDraftSession(first.transport);
  await assert.rejects(session.upload(image()), /不匹配/); await session.dispose();
  assert.deepEqual(first.calls.filter(call => call.kind === 'abandon'), [{ kind: 'abandon', id: firstId }]);
  const second = fixture(); second.transport.upload = async () => ({ ...media(), expiresAt: '2000-01-01T00:00:00Z' });
  const expired = new BannerDraftSession(second.transport);
  await assert.rejects(expired.upload(image()), /无法核对/); await expired.dispose();
  assert.deepEqual(second.calls, [{ kind: 'abandon', id: firstId }]);
});
