'use strict';
const {PrismaClient}=require('@prisma/client');
const fs=require('node:fs');const path=require('node:path');
const {bookingPolicy,optionBookingPolicy}=require('./lib/legacy-booking.cjs');
const db=new PrismaClient();
async function main(){
  const shops=await db.shop.findMany({include:{therapists:{select:{isActive:true}},loginBinding:{include:{user:{select:{status:true,passwordHash:true}}}},aliases:{where:{isActive:true}},shopServices:{include:{variants:true}}}});
  const summary={shops:shops.length,published:0,onlineBooking:0,missingHours:0,missingStaff:0,missingTimezone:0,independentBindings:0,disabledIndependentLogins:0,passwordsSet:0,shortAliases:0,legacyIdAliases:0,activeServices:0,activeVariants:0,specialServicesStillSingle:[],candidates:{}};
  for(const s of shops){
    if(s.status==='APPROVED'&&!s.deletedAt)summary.published++;
    const enabled=s.studioProfile?.features?.onlineBooking===true;
    if(enabled)summary.onlineBooking++;
    const staff=s.therapists.filter(t=>t.isActive).length;
    if(!staff)summary.missingStaff++;if(!s.timezone)summary.missingTimezone++;
    if(!Object.values(s.businessHours||{}).some(d=>(Array.isArray(d)?d:[d]).some(v=>v&&!v.closed&&v.open&&v.close)))summary.missingHours++;
    if(s.loginBinding){summary.independentBindings++;if(s.loginBinding.user.status==='SUSPENDED')summary.disabledIndependentLogins++;if(s.loginBinding.user.passwordHash)summary.passwordsSet++;}
    if(s.aliases.some(a=>a.kind==='SHORT_NAME'&&a.source==='massajoy'))summary.shortAliases++;
    if(s.aliases.some(a=>a.kind==='LEGACY_ID'&&a.source==='massajoy1'))summary.legacyIdAliases++;
    for(const service of s.shopServices){
      if(service.isActive)summary.activeServices++;
      summary.activeVariants+=service.variants.filter(v=>v.isActive).length;
      const options=service.variants.length?service.variants.filter(v=>v.isActive):[{name:service.name}];
      if(service.isActive&&options.some(v=>{const policy=service.variants.length?optionBookingPolicy(v.name,service.name):bookingPolicy(service.name);return policy&&(service.requiredStaffCount!==policy.requiredStaffCount||service.participantCount!==policy.participantCount);}))summary.specialServicesStillSingle.push({shopId:String(s.id),serviceId:String(service.id),name:service.name});
      const key=service.requiredStaffCount===2?(service.participantCount===2?'couple':'fourHands'):'single';
      if(enabled&&service.isActive&&staff>=service.requiredStaffCount&&!summary.candidates[key]){
        const variant=service.variants.find(v=>v.isActive);if(service.variants.length&&!variant)continue;
        summary.candidates[key]={shopId:String(s.id),serviceId:String(service.id),variantId:variant?String(variant.id):null,shortName:s.shortName,name:s.name,timezone:s.timezone,staff,durationMin:variant?.durationMin??service.durationMin,priceCents:variant?.priceCents??service.priceCents};
      }
    }
  }
  const filename=path.resolve(__dirname,'../../.local/qa16-repair-summary.json');fs.writeFileSync(filename,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1;});
