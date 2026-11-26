import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('merchant upload, confirmation, private preview and cleanup use their dedicated endpoints',async()=>{
  const previous=axios.defaults.adapter,calls=[];
  const preview = new Blob(['synthetic preview'], { type: 'image/webp' });
  axios.defaults.adapter = async config => {
    calls.push(config);
    const data = config.method === 'get' ? preview : config.method === 'delete' ? { abandoned: true } : { item: { id: 'synthetic' } };
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  let auth;
  try {
    const api = await vite.ssrLoadModule('/src/api/media.ts');
    ({ useAuthStore: auth } = await vite.ssrLoadModule('/src/stores/authStore.ts'));
    auth.getState().setAuth('synthetic-merchant', { id: '5', role: 'MERCHANT' });
    await api.uploadShopMedia('9007199254740993',new File(['synthetic'],'test.png'),'cover','stable-request');
    await api.confirmShopMedia('exact-id');
    assert.equal(await api.previewShopMedia('exact-id'), preview);
    await api.abandonShopMedia('exact-id');
    assert.ok(calls[0].data instanceof FormData);assert.equal(calls[0].data.get('shopId'),'9007199254740993');assert.equal(calls[0].data.get('scope'),'SHOP');assert.equal(calls[0].data.get('purpose'),'cover');assert.equal(calls[0].data.get('requestKey'),'stable-request');
    assert.deepEqual(calls.map(config => [config.url, config.method]), [
      ['/upload/media', 'post'],
      ['/upload/media/exact-id/confirm', 'post'],
      ['/upload/media/exact-id/preview', 'get'],
      ['/upload/media/exact-id', 'delete'],
    ]);
    assert.equal(calls[2].responseType, 'blob');
    assert.equal(calls[2].headers.get('Accept'), 'image/webp');
    assert.equal(calls[2].headers.get('Authorization'), 'Bearer synthetic-merchant');
  } finally {
    auth?.getState().logout();
    axios.defaults.adapter=previous;
    await vite.close();
  }
});

test('shop images display the private draft preview while retaining the canonical form address', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { default: ShopMediaField } = await vite.ssrLoadModule('/src/pages/settings/ShopMediaField.tsx');
    const canonical = '/api/v1/upload/media/00000000-0000-4000-8000-000000000001/file';
    const publicImage = 'https://example.test/published.webp';
    const preview = 'blob:https://example.test/synthetic-preview';
    const render = previewUrls => renderToStaticMarkup(React.createElement(ShopMediaField, {
      purpose: 'gallery', value: `${canonical}\n${publicImage}`, disabled: false, previewUrls,
      upload: async () => ({ url: canonical }),
    }));
    const draft = render(new Map([[canonical, preview]]));
    assert.ok(draft.includes(`src="${preview}"`));
    assert.ok(!draft.includes(`src="${canonical}"`));
    assert.ok(draft.includes(`src="${publicImage}"`));
    assert.ok(draft.includes(`>${canonical}\n${publicImage}</textarea>`));
    assert.ok(render(new Map()).includes(`src="${canonical}"`));
  } finally {
    await vite.close();
  }
});
test('merchant profile explicitly saves and clears the same top-level media fields as Studio',async()=>{
  const previous=axios.defaults.adapter,calls=[];
  axios.defaults.adapter=async config=>{calls.push(config);return {config,data:{id:'7'},status:200,statusText:'OK',headers:{}};};
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  try{const api=await vite.ssrLoadModule('/src/api/merchant.ts');const draft={name:'Synthetic shop',logoUrl:'',bannerUrl:'',gallery:[]};await api.updateShopProfile('7',draft);assert.equal(calls[0].url,'/merchant/shops/7');assert.deepEqual(JSON.parse(calls[0].data),draft);}
  finally{axios.defaults.adapter=previous;await vite.close();}
});

test('merchant media confirmation preserves a typed terminal upload outcome', async () => {
  const previous = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    const data = { code: 'SHOP_MEDIA_UPLOAD_TERMINAL', message: 'Previous upload expired' };
    throw new axios.AxiosError(data.message, 'ERR_BAD_REQUEST', config, undefined, { config, data, status: 409, statusText: 'Conflict', headers: {} });
  };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { confirmShopMedia } = await vite.ssrLoadModule('/src/api/media.ts');
    await assert.rejects(confirmShopMedia('expired-id'), error => error.response.status === 409 && error.response.data.code === 'SHOP_MEDIA_UPLOAD_TERMINAL');
  } finally {
    axios.defaults.adapter = previous;
    await vite.close();
  }
});
