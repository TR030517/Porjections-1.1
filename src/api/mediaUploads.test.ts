import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abandonShopMedia, confirmShopMedia, previewShopMedia, uploadShopMedia } from './mediaUploads';
test('platform media upload sends exact multipart ownership fields with session credentials and no JSON content type',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/v1/upload/media');assert.equal(options?.credentials,'include');assert.equal(new Headers(options?.headers).get('Content-Type'),null);const form=options?.body as FormData;assert.ok(form instanceof FormData);assert.deepEqual([...form.keys()].sort(),['file','purpose','requestKey','scope','shopId']);assert.equal(form.get('shopId'),'9007199254740993');assert.equal(form.get('scope'),'SHOP');assert.equal(form.get('purpose'),'gallery');assert.equal(form.get('requestKey'),'stable-request-key');assert.ok(form.get('file') instanceof File);return Response.json({item:{id:'synthetic'}});};
  try{assert.equal((await uploadShopMedia('9007199254740993',new File(['synthetic'],'test.png'),'gallery','stable-request-key')).id,'synthetic');}finally{globalThis.fetch=original;}
});
test('confirm stages rather than saves and cancellation requires acknowledged deletion',async()=>{
  const original=globalThis.fetch,calls:{url:string;method:string;body:unknown}[]=[];let success=true;
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),method:options?.method??'GET',body:options?.body});return Response.json(options?.method==='DELETE'?{abandoned:success}:{item:{id:'exact-id'}});};
  try{assert.equal((await confirmShopMedia('exact-id')).id,'exact-id');await abandonShopMedia('exact-id');assert.deepEqual(calls,[{url:'/api/v1/upload/media/exact-id/confirm',method:'POST',body:'{}'},{url:'/api/v1/upload/media/exact-id',method:'DELETE',body:undefined}]);success=false;await assert.rejects(abandonShopMedia('exact-id'),/无法确认/);}finally{globalThis.fetch=original;}
});

test('private media preview requests a non-cached WebP and preserves HTTP errors', async () => {
  const original = globalThis.fetch;
  let available = true;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/upload/media/exact-id/preview');
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.cache, 'no-store');
    assert.equal(new Headers(options?.headers).get('Accept'), 'image/webp');
    return available
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } })
      : Response.json({ message: 'Image not found' }, { status: 404 });
  };
  try {
    const preview = await previewShopMedia('exact-id');
    assert.equal(preview.type, 'image/webp');
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), new Uint8Array([1, 2, 3]));
    available = false;
    await assert.rejects(previewShopMedia('exact-id'), { status: 404 });
  } finally {
    globalThis.fetch = original;
  }
});

test('platform media requests carry the typed upload outcome through the session client', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 'SHOP_MEDIA_UPLOAD_TERMINAL', message: 'Previous upload expired' }, { status: 409 });
  try {
    await assert.rejects(confirmShopMedia('expired-id'), { status: 409, code: 'SHOP_MEDIA_UPLOAD_TERMINAL' });
  } finally {
    globalThis.fetch = original;
  }
});
