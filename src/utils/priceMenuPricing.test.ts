import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatPriceMenuTitle,normalizePriceMenuPricing,type PriceMenuPricing} from './priceMenuPricing';
const timed:PriceMenuPricing={kind:'TIMED',baseName:'Body Massage',durationMin:30,priceCents:5000,titleMode:'AUTO'};
test('structured values produce complete titles without parsing their text',()=>{
  assert.equal(formatPriceMenuTitle(timed),'30 min Body Massage $50');
  assert.equal(formatPriceMenuTitle({...timed,durationMin:60,priceCents:8000}),'60 min Body Massage $80');
  assert.equal(formatPriceMenuTitle({...timed,kind:'PER_SESSION',durationMin:null}),'Body Massage $50 / session');
  assert.equal(formatPriceMenuTitle({...timed,kind:'VARIABLE',durationMin:null}),'Body Massage $50 · Duration varies');
  assert.equal(formatPriceMenuTitle({...timed,kind:'ADD_ON',baseName:'Essential Oil',durationMin:null,priceCents:1050}),'Essential Oil +$10.5 · Add-on');
});
test('incomplete editor values do not invent money or minutes and cannot pass the save boundary',()=>{
  assert.equal(formatPriceMenuTitle({...timed,priceCents:null}),'Body Massage');
  for(const patch of [{priceCents:null},{durationMin:null},{priceCents:'5000'},{priceCents:50.5},{durationMin:0},{durationMin:1.5},{priceCents:-1},{unknown:true}])assert.throws(()=>normalizePriceMenuPricing({...timed,...patch}));
});
test('non-timed kinds require explicit absent duration and strict source preservation',()=>{
  for(const kind of ['PER_SESSION','VARIABLE','ADD_ON'] as const){assert.throws(()=>normalizePriceMenuPricing({...timed,kind}));assert.equal(normalizePriceMenuPricing({...timed,kind,durationMin:null}).durationMin,null);}
  const legacySource={name:'  Old label  ',priceText:'From $50'};
  assert.deepEqual(normalizePriceMenuPricing({...timed,legacySource}).legacySource,legacySource);
  for(const legacySource of [null,{}, {name:'x',priceText:'y',private:true}])assert.throws(()=>normalizePriceMenuPricing({...timed,legacySource}));
});
