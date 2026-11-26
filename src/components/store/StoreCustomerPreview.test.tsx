import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { register } from 'node:module';
import { blankDraft } from './storeModel';

// The preview now shares a stylesheet; Node checks markup, browser checks layout.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('/PriceMenuPreview.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreCustomerPreview } = await import('./StoreCustomerPreview');

test('customer profile preview renders private media locally and keeps the canonical draft URL', () => {
  const draft = blankDraft();
  const canonical = '/api/v1/upload/media/00000000-0000-4000-8000-000000000001/file';
  const objectUrl = 'blob:https://admin.example.test/ephemeral';
  draft.logoUrl = canonical;
  draft.bannerUrl = canonical;
  draft.gallery = canonical + '\nhttps://images.example.test/public.webp';
  const working = renderToStaticMarkup(<StoreCustomerPreview draft={draft} saved={false} previewUrls={new Map([[canonical, objectUrl]])} />);
  assert.equal(working.split('src="' + objectUrl + '"').length - 1, 3);
  assert.ok(working.includes('src="https://images.example.test/public.webp"'));
  assert.match(working, /alt="Store logo"[^>]+object-contain/);
  assert.match(working, /alt="Store cover"[^>]+object-cover/);
  assert.equal(draft.logoUrl, canonical);
  const saved = renderToStaticMarkup(<StoreCustomerPreview draft={draft} saved />);
  assert.equal(saved.split('src="' + canonical + '"').length - 1, 3);
  assert.ok(!saved.includes(objectUrl));
});

test('customer preview renders an English independent price menu without mixing it into about text', () => {
  const draft = blankDraft();
  draft.about = 'A calm neighborhood studio.';
  draft.onlineBooking = true;
  draft.priceMenu = [{ category: 'Massage', items: [{
    name: 'Deep tissue', priceText: 'From $80 / 60 min', description: 'Call to confirm.',
    bookingEnabled: true, bookingAvailable: true, booking: { serviceId: '3', variantId: '4' },
  }] }];
  const html = renderToStaticMarkup(<StoreCustomerPreview draft={draft} saved={false} />);
  assert.match(html, /lang="en"/); assert.match(html, /aria-label="Price menu"/);
  assert.match(html, /From \$80 \/ 60 min/); assert.match(html, /About the store/);
  const about = html.split('aria-label="Store introduction"')[1].split('</section>')[0];
  assert.match(about, /A calm neighborhood studio\./); assert.doesNotMatch(about, /Deep tissue|\$80/);
  assert.doesNotMatch(html, /顾客资料预览|门店介绍待补充|每周营业时间/);
  assert.doesNotMatch(html, /Book now/);
  assert.match(html, /Online booking.*Enabled in settings/);
});

test('preview shows all valid public contact actions, with a fixed map target and no legacy or arbitrary link fallback', () => {
  const draft = blankDraft();
  draft.address = '12 Main St #3'; draft.city = 'Test City'; draft.state = 'NY'; draft.zipCode = '10002';
  draft.phones = '+1 202-555-0144\n202-555-0145'; draft.emails = 'front@example.test\nshop+book@example.test';
  draft.mapShareUrl = 'https://unrelated.example.test/redirect';
  const html = renderToStaticMarkup(<StoreCustomerPreview draft={draft} saved />);
  assert.match(html, /href="tel:\+12025550144"/); assert.match(html, /href="tel:2025550145"/);
  assert.match(html, /href="mailto:front@example.test"/); assert.match(html, /href="mailto:shop\+book@example.test"/);
  assert.match(html, /https:\/\/www.google.com\/maps\/search\/\?api=1/); assert.match(html, /noopener noreferrer/);
  assert.doesNotMatch(html, /unrelated.example.test/);
  draft.phones = ''; draft.emails = ''; draft.address = '';
  const empty = renderToStaticMarkup(<StoreCustomerPreview draft={draft} saved />);
  assert.match(empty, /Phone not provided/); assert.match(empty, /Email not provided/);
  assert.doesNotMatch(empty, /href="tel:|href="mailto:|Open in Google Maps/);
});
