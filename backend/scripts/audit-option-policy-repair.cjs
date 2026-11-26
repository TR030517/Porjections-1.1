'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PrismaClient}=require('@prisma/client');
const ROOT=path.resolve(__dirname,'../..'),db=new PrismaClient();
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x);
const strip=profile=>(profile.priceMenu||[]).map(g=>({...g,items:(g.items||[]).map(({booking,...item})=>item)}));
async function main(){
 const files=process.argv.slice(2);if(!files.length||files.some(file=>!/^before-\d+\.json$/.test(file)))throw Error('Expected backup filenames');
 const plans=files.map(file=>JSON.parse(fs.readFileSync(path.join(ROOT,'.local/option-policy-repair',file),'utf8')));
 const evidence={shops:0,variants:0,menuItems:0,stableMenuContent:true,stableVariantIdentities:true,stablePricesAndDurations:true,correctResourceAllocations:true,candidates:{}};
 for(const plan of plans)for(const row of plan.plans){
  const shop=await db.shop.findUniqueOrThrow({where:{id:BigInt(row.shopId)},include:{shopServices:{include:{variants:true}},therapists:{where:{isActive:true},select:{id:true}}}});
  assert.equal(shop.status,'APPROVED');assert.deepEqual(strip(shop.studioProfile),strip(row.beforeProfile));evidence.shops++;
  const services=new Map(shop.shopServices.map(s=>[String(s.id),s])),variants=new Map(shop.shopServices.flatMap(s=>s.variants).map(v=>[String(v.id),v]));
  for(const action of row.actions)for(const group of action.groups)for(const old of group.variants){
   const variant=variants.get(old.id);assert.ok(variant);
   for(const key of ['name','durationMin','priceCents','currency','sortOrder'])assert.equal(variant[key],old.before[key]);
   assert.equal(variant.isActive,old.after.isActive);evidence.variants++;
   const service=services.get(String(variant.serviceId));assert.ok(service);
   assert.equal(service.requiredStaffCount,group.data.requiredStaffCount);assert.equal(service.participantCount,group.data.participantCount);
   const items=(shop.studioProfile.priceMenu||[]).flatMap(g=>g.items||[]).filter(i=>i.id==='legacy-price-'+old.sourceId);
   assert.equal(items.length,1);const item=items[0];evidence.menuItems++;
   if(group.policy){assert.equal(String(item.booking.serviceId),String(service.id));assert.equal(String(item.booking.variantId),String(variant.id));}
   else assert.equal(item.booking,undefined);
   const type=group.key==='COUPLE'?'couple':group.key==='FOUR_HANDS'?'fourHands':null;
   if(type&&!evidence.candidates[type]&&shop.studioProfile.features?.onlineBooking&&service.isActive&&variant.isActive&&shop.timezone&&shop.therapists.length>=2&&Object.values(shop.businessHours||{}).some(d=>(Array.isArray(d)?d:[d]).some(v=>v&&!v.closed&&v.open&&v.close))){
    evidence.candidates[type]={type,shopId:String(shop.id),serviceId:String(service.id),variantId:String(variant.id),timezone:shop.timezone,priceCents:variant.priceCents,participantCount:service.participantCount,requiredStaffCount:service.requiredStaffCount};
   }
  }
 }
 assert.equal(await db.shop.count({where:{status:'APPROVED',deletedAt:null}}),1335);
 fs.writeFileSync(path.join(ROOT,'.local/qa16-option-policy-evidence.json'),json(evidence));console.log(json(evidence));
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1;});
