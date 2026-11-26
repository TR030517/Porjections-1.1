import assert from 'node:assert/strict';import test from 'node:test';import axios from 'axios';import {createServer} from 'vite';
test('booking detail keeps saved add-on prices and parent coordinates separately from primary service items',async()=>{
  const addon={id:'90',bookingItemId:'30',sourceAddOnId:'40',participantIndex:2,sequence:1,name:'Original Oil',unitPriceCents:1000,quantity:1,lineTotalCents:1000,currency:'usd'};
  let raw={id:'10',shopId:'5',durationMin:60,priceCents:9000,mainSubtotalCents:8000,addOnSubtotalCents:1000,addOns:[addon],items:[{id:'30',participantIndex:2,sequence:1,durationMin:60,priceCentsSnapshot:4000}],service:{name:'Changed current service',priceCents:999999}};
  axios.defaults.adapter=async config=>({config,data:raw,status:200,statusText:'OK',headers:{}});
  const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  try{const api=await server.ssrLoadModule('/src/api/bookings.ts');const result=await api.getBooking('10','5');assert.equal(result.addOns[0].name,'Original Oil');assert.equal(result.addOns[0].lineTotalCents,1000);assert.equal(result.mainSubtotalCents,8000);assert.equal(result.items.length,1);
    raw={...raw,addOnSubtotalCents:2000};await assert.rejects(api.getBooking('10','5'),/金额不一致/);
    raw={...raw,addOnSubtotalCents:1000,addOns:[{...addon,quantity:2}]};await assert.rejects(api.getBooking('10','5'),/快照无法核对/);
  }finally{await server.close();}
});
