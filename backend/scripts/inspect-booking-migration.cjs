'use strict';
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
async function main() {
  const shops = await db.shop.findMany({ select: { id:true, name:true, businessHours:true, studioProfile:true, timezone:true, therapists:{select:{id:true,isActive:true}}, shopServices:{select:{id:true,name:true,isActive:true,participantCount:true,requiredStaffCount:true,description:true,durationMin:true,variants:{select:{id:true,durationMin:true,isActive:true,priceCents:true}}}} } });
  const hours = new Map(), samples = [], special = new Map(), duration = new Map();
  for (const shop of shops) {
    const legacy=shop.studioProfile?.legacyImport;
    const key=JSON.stringify({raw:legacy?.rawBusinessHours?.monday, fallback:legacy?.legacyDefaultHours});
    hours.set(key,(hours.get(key)||0)+1);
    if(!Object.values(shop.businessHours||{}).some(x=>Array.isArray(x)?x.some(i=>!i.closed&&i.open&&i.close):x?.open&&x?.close&&!x.closed)&&samples.length<8) samples.push({id:shop.id,name:shop.name,legacy:legacy?.rawBusinessHours,defaults:legacy?.legacyDefaultHours});
    for(const service of shop.shopServices) {
      if(/coupl|four.?hand|4.?hand|情侣|四手|双人/i.test(service.name)) special.set(service.name,(special.get(service.name)||0)+1);
      for(const v of service.variants) duration.set(v.durationMin,(duration.get(v.durationMin)||0)+1);
    }
  }
  console.log(JSON.stringify({shops:shops.length,hours:[...hours].sort((a,b)=>b[1]-a[1]).slice(0,18),samples,special:[...special],durations:[...duration].sort((a,b)=>a[0]-b[0])},(_,v)=>typeof v==='bigint'?String(v):v,2));
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1;});
