import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { test } from 'node:test';
import { MEDIA_MAX_BYTES, MediaDraftSession, ShopMediaUploadRecoveryError, inspectMediaFile, verifyStagedMedia, type MediaDraftTransport, type StagedMedia } from './mediaDraft';

const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',shop='9007199254740993';
const item=(extra:Partial<StagedMedia>={}):StagedMedia=>({id,fileUrl:`/api/v1/upload/media/${id}/file`,scope:'SHOP',shopId:shop,purpose:'logo',status:'STAGED',mimeType:'image/webp',sizeBytes:10,width:1,height:1,expiresAt:'2031-01-01T00:00:00Z',...extra});
const image=()=>new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2])],'synthetic.png',{type:'image/png'});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {resolve,promise};};
function transport(){const calls:{kind:string;id?:string;key?:string}[]=[];const api:MediaDraftTransport={upload:async(_file,purpose,key)=>{calls.push({kind:'upload',key});return item({purpose});},confirm:async id=>{calls.push({kind:'confirm',id});return item();},abandon:async id=>{calls.push({kind:'abandon',id});return {abandoned:true};}};return {calls,api};}

test('invalid, empty, mislabeled and oversized image files fail before requesting an upload',async()=>{
  for(const file of [new File([],'empty.png',{type:'image/png'}),new File(['not an image'],'fake.png',{type:'image/png'}),new File([await image().arrayBuffer()],'fake.jpg',{type:'image/jpeg'}),new File([new Uint8Array(MEDIA_MAX_BYTES+1)],'large.png',{type:'image/png'})])await assert.rejects(inspectMediaFile(file));
  assert.equal((await inspectMediaFile(image())).mime,'image/png');
});
test('upload and confirmation return only a real staged server URL without binding or saving a shop',async()=>{
  const {calls,api}=transport(),session=new MediaDraftSession(shop,api);assert.equal((await session.upload(image(),'logo')).url,item().fileUrl);assert.deepEqual(calls.map(value=>value.kind),['upload','confirm']);assert.match(calls[0].key!,/^[a-z0-9-]{36}$/i);
});

test('private preview retries the same upload and the object URL is revoked after binding', async () => {
  const { calls, api } = transport();
  const webp = new Blob([new Uint8Array(10)], { type: 'image/webp' });
  let corrupt = true;
  api.preview = async mediaId => {
    calls.push({ kind: 'preview', id: mediaId });
    return corrupt ? webp.slice(0, 1, webp.type) : webp;
  };
  const session = new MediaDraftSession(shop, api);
  const canonical = item().fileUrl;
  await assert.rejects(session.upload(image(), 'logo'), /暂存图片预览无法核对/);
  assert.equal(session.previewUrls.size, 0);
  corrupt = false;
  assert.equal((await session.upload(image(), 'logo')).url, canonical);
  assert.equal((await session.upload(image(), 'logo')).url, canonical);
  const url = session.previewUrls.get(canonical)!;
  assert.match(url, /^blob:/);
  assert.equal(resolveObjectURL(url)?.size, webp.size);
  assert.equal(calls.filter(call => call.kind === 'upload').length, 1);
  assert.deepEqual(calls.filter(call => call.kind === 'preview'), [
    { kind: 'preview', id }, { kind: 'preview', id },
  ]);
  assert.equal(await session.saved([canonical]), 0);
  assert.equal(session.previewUrls.size, 0);
  assert.equal(resolveObjectURL(url), undefined);
  assert.equal(calls.some(call => call.kind === 'abandon'), false);
});

test('a late private preview is discarded when the operator leaves the shop', async () => {
  const { calls, api } = transport();
  const waiting = deferred<Blob>();
  const entered = deferred<void>();
  api.preview = async () => { entered.resolve(); return waiting.promise; };
  const session = new MediaDraftSession(shop, api);
  const rejected = assert.rejects(session.upload(image(), 'logo'), /编辑已关闭/);
  await entered.promise;
  await session.dispose();
  waiting.resolve(new Blob([new Uint8Array(10)], { type: 'image/webp' }));
  await rejected;
  assert.equal(session.previewUrls.size, 0);
  assert.deepEqual(calls.filter(call => call.kind === 'abandon'), [{ kind: 'abandon', id }]);
});
test('an uncertain unchanged upload retries with the same key, while different bytes get a new key',async()=>{
  const {calls,api}=transport();let fail=true;api.upload=async(file,purpose,key)=>{calls.push({kind:'upload',key});if(fail){fail=false;throw new Error('Synthetic timeout');}return item({purpose});};
  const session=new MediaDraftSession(shop,api);await assert.rejects(session.upload(image(),'logo'));await session.upload(image(),'logo');assert.equal(calls[0].key,calls[1].key);
  await session.saved([item().fileUrl]);await session.upload(image(),'logo');assert.notEqual(calls[0].key,[...calls].reverse().find(value=>value.kind==='upload')!.key);
});
test('pending and uncoded conflicts reuse the original key until the API confirms a terminal failure', async () => {
  const { calls, api } = transport();
  const failures = [
    { status: 409, code: 'SHOP_MEDIA_UPLOAD_PENDING' },
    { response: { status: 503, data: {} }, code: 'SHOP_MEDIA_UPLOAD_TERMINAL' },
    { response: { status: 503, data: { code: 'SHOP_MEDIA_UPLOAD_TERMINAL' } } },
  ];
  const originalUpload = api.upload;
  api.upload = async (file, purpose, key) => {
    const result = await originalUpload(file, purpose, key);
    if (failures.length) throw Object.assign(new Error('Synthetic upload failure'), failures.shift());
    return result;
  };
  const session = new MediaDraftSession(shop, api);
  await assert.rejects(session.upload(image(), 'logo'), { restart: false });
  await assert.rejects(session.upload(image(), 'logo'), /Synthetic upload failure/);
  await assert.rejects(session.upload(image(), 'logo'), error => error instanceof ShopMediaUploadRecoveryError && error.restart);
  assert.deepEqual(calls.map(call => call.kind), ['upload', 'upload', 'upload']);
  assert.equal(new Set(calls.map(call => call.key)).size, 1);
  assert.equal((await session.upload(image(), 'logo')).url, item().fileUrl);
  assert.notEqual(calls[3].key, calls[0].key);
});
test('a restarted upload replaces only the expired URL already returned for its original file', async () => {
  const { calls, api } = transport();
  const original = item({ purpose: 'gallery' });
  const fresh = item({ purpose: 'gallery', id: other, fileUrl: `/api/v1/upload/media/${other}/file` });
  let expired = false;
  api.upload = async (_file, _purpose, key) => {
    calls.push({ kind: 'upload', key });
    return expired ? fresh : original;
  };
  api.confirm = async id => {
    if (id === other) return fresh;
    if (expired) throw Object.assign(new Error('Synthetic expiry'), { status: 409, code: 'SHOP_MEDIA_UPLOAD_TERMINAL' });
    return original;
  };
  const session = new MediaDraftSession(shop, api);
  assert.deepEqual(await session.upload(image(), 'gallery'), { url: original.fileUrl });
  expired = true;
  await assert.rejects(session.upload(image(), 'gallery'), { restart: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(await session.upload(image(), 'gallery'), { url: fresh.fileUrl, replacesUrl: original.fileUrl });
  assert.notEqual(calls[0].key, calls[1].key);
  assert.equal(await session.saved([fresh.fileUrl]), 0);
  assert.deepEqual(calls.filter(call => call.kind === 'abandon'), [{ kind: 'abandon', id }]);
});
test('an explicit successful save preserves bound media and deletes only this draft’s unused staged uploads',async()=>{
  const {calls,api}=transport();api.upload=async(_file,purpose)=>item(purpose==='logo'?{purpose}:{id:other,fileUrl:`/api/v1/upload/media/${other}/file`,purpose});api.confirm=async value=>item(value===id?{}:{id:other,fileUrl:`/api/v1/upload/media/${other}/file`,purpose:'cover'});
  const session=new MediaDraftSession(shop,api);await session.upload(image(),'logo');await session.upload(image(),'cover');assert.equal(await session.saved([item().fileUrl]),0);assert.deepEqual(calls,[{kind:'abandon',id:other}]);await session.dispose();assert.equal(calls.length,1);
});
test('failed confirmation retains the exact owned staged ID for cancellation cleanup',async()=>{
  const {calls,api}=transport();api.confirm=async()=>{throw new Error('Synthetic integrity failure');};const session=new MediaDraftSession(shop,api);await assert.rejects(session.upload(image(),'logo'));assert.equal(await session.cleanup(),0);assert.equal(calls.find(value=>value.kind==='abandon')?.id,id);
});
test('late upload completion after unmount abandons its own object and cannot apply a URL or confirm it',async()=>{
  const {calls,api}=transport(),waiting=deferred<StagedMedia>(),entered=deferred<void>();api.upload=async()=>{entered.resolve();return waiting.promise;};const session=new MediaDraftSession(shop,api),pending=session.upload(image(),'logo');const rejected=assert.rejects(pending,/编辑已关闭/);await entered.promise;await session.dispose();waiting.resolve(item());await rejected;assert.deepEqual(calls,[{kind:'abandon',id}]);
});
test('late confirmation after unmount never applies to a replacement shop',async()=>{
  const {calls,api}=transport(),waiting=deferred<StagedMedia>(),entered=deferred<void>();api.confirm=async()=>{entered.resolve();return waiting.promise;};const session=new MediaDraftSession(shop,api),pending=session.upload(image(),'logo');const rejected=assert.rejects(pending,/编辑已关闭/);await entered.promise;await session.dispose();waiting.resolve(item());await rejected;assert.deepEqual(calls.filter(value=>value.kind==='abandon'),[{kind:'abandon',id}]);
});
test('foreign-shop or arbitrary relative upload results are rejected without deleting unrelated media',async()=>{
  for(const wrong of [item({shopId:'other'}),item({fileUrl:'/arbitrary.png'}),item({sizeBytes:MEDIA_MAX_BYTES+1})]){
    const {calls,api}=transport();api.upload=async()=>wrong;const session=new MediaDraftSession(shop,api);await assert.rejects(session.upload(image(),'logo'));await session.dispose();if(wrong.shopId!==shop||wrong.fileUrl==='/arbitrary.png')assert.equal(calls.filter(value=>value.kind==='abandon').length,0);
  }
  assert.throws(()=>verifyStagedMedia(item({width:8193}),shop));
});
test('bound-conflict cleanup never erases saved media and failed cleanup can be retried',async()=>{
  const {calls,api}=transport();let mode='failure';api.abandon=async id=>{calls.push({kind:'abandon',id});throw Object.assign(new Error('Synthetic failure'),{status:mode==='bound'?409:503});};const session=new MediaDraftSession(shop,api);await session.upload(image(),'logo');assert.equal(await session.cleanup(),1);mode='bound';assert.equal(await session.cleanup(),0);assert.equal(await session.cleanup(),0);assert.equal(calls.filter(value=>value.kind==='abandon').length,2);
});
test('React StrictMode effect reactivation leaves the current editor able to upload',async()=>{
  const {api}=transport(),session=new MediaDraftSession(shop,api);await session.dispose();session.activate();assert.equal((await session.upload(image(),'logo')).url,item().fileUrl);
});
