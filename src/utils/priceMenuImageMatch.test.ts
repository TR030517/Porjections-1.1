import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchPriceMenuImage, parsePriceMenuStepCents} from './priceMenuImageMatch';
import {PRICE_MENU_GALLERY} from './priceMenuGallery';

test('specific item image takes precedence over a broad group; duration and dollar wording retain subject match', () => {
  assert.equal(matchPriceMenuImage('Body Massage', '30 Min Hot Stone Massage $50')?.key, 'hot-stone');
  assert.equal(matchPriceMenuImage('Body Massage', '足底按摩')?.key, 'foot-reflexology');
  assert.equal(matchPriceMenuImage('Foot Massage', 'Deep Tissue Massage')?.key, 'deep-tissue');
});
test('unmatched wording stays blank, names are required, and every selected image belongs to the finite gallery', () => {
  assert.equal(matchPriceMenuImage('Unknown category', 'My custom treatment'), null);
  assert.equal(matchPriceMenuImage('Body Massage', ''), null);
  for (const name of ['Body Massage', 'Head Massage', 'Facial', 'Cupping', 'Couples Massage']) {
    const image = matchPriceMenuImage('Body Massage', name);
    assert.ok(image && PRICE_MENU_GALLERY.some(entry => entry.key === image.key && entry.url === image.url));
  }
});
test('known subjects without assets never borrow another treatment image from their category', () => {
  for (const [category, name] of [['Traditional Treatments','Acupuncture'],['Traditional Treatments','Moxibustion'],['Add-ons','Hot Compress'],['Body Massage','My custom treatment']]) {
    assert.equal(matchPriceMenuImage(category, name), null, name);
  }
  assert.equal(matchPriceMenuImage('Traditional Treatments','Cupping')?.key,'cupping');
  assert.equal(matchPriceMenuImage('Add-ons','Essential Oil')?.key,'aromatherapy');
});
test('price-step decimal parsing preserves cents exactly and rejects ambiguous or out-of-bound input', () => {
  assert.equal(parsePriceMenuStepCents('0'), 0); assert.equal(parsePriceMenuStepCents('0.01'), 1);
  assert.equal(parsePriceMenuStepCents('10.10'), 1010); assert.equal(parsePriceMenuStepCents('999999.99'), 99999999);
  for (const raw of ['','-1','1e2','01','1.001','1000000','$10','NaN',' 10 ']) assert.throws(() => parsePriceMenuStepCents(raw));
});
