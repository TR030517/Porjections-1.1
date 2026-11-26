'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {tableRows}=require('./lib/legacy-sql.cjs');
const {recoverHours,bookingPolicy,validOption}=require('./lib/legacy-booking.cjs');
const ROOT=path.resolve(__dirname,'../..'),VERSION='legacy-booking-repair-v1';
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v);
const sha=value=>crypto.createHash('sha256').update(json(value)).digest('hex');
const openHours=hours=>Object.values(hours||{}).some(day=>(Array.isArray(day)?day:[day]).some(row=>row&&!row.closed&&row.open&&row.close));
async function buildPlan(db,sql,enableReady) {
  const projects=new Map(tableRows(sql,'pro_project').map(row=>[String(row.id),row]));
  const prices=new Map(tableRows(sql,'pro_price').map(row=>[String(row.id),row]));
  const shops=await db.shop.findMany({orderBy:{id:'asc'},include:{therapists:{select:{isActive:true}},shopServices:{include:{variants:true}}}});
  if(shops.length!==1335||shops.some(shop=>!shop.studioProfile?.legacyImport?.sourceShopId))throw new Error('Expected exactly 1335 imported shops');
  const plans=[],summary={shops:shops.length,hoursRepaired:0,daysRecovered:0,serviceUpdates:0,variantUpdates:0,coupleServices:0,fourHandsServices:0,ambiguousServices:0,invalidVariants:0,readyShops:0,onlineBookingEnabled:0,missingHours:0,missingStaff:0,missingTimezone:0,alreadyRepaired:0};
  for(const shop of shops) {
    const profile=shop.studioProfile,legacy=profile.legacyImport;
    if(legacy.bookingRepair?.version===VERSION){summary.alreadyRepaired++;continue;}
    const recovered=recoverHours(shop.businessHours,legacy.rawBusinessHours);
    const serviceSources=new Map();
    for(const group of profile.priceMenu||[])for(const item of group.items||[]) {
      const priceId=/^legacy-price-(\d+)$/.exec(item.id||'')?.[1];
      if(!priceId||!item.booking?.serviceId)continue;
      const price=prices.get(priceId),project=price&&projects.get(String(price.pid));
      if(!project||String(project.mch_id)!==String(legacy.sourceShopId))throw new Error('Source shop/project mismatch');
      const key=String(item.booking.serviceId),old=serviceSources.get(key);
      if(old&&String(old.id)!==String(project.id))throw new Error('Ambiguous service source');
      serviceSources.set(key,project);
    }
    const services=[];let activeChoices=0;
    for(const service of shop.shopServices) {
      const source=serviceSources.get(String(service.id));if(!source)continue;
      // Names are retained unchanged by the importer. A renamed service is an
      // administrator edit and is intentionally excluded from bulk repair.
      if(service.name!==String(source.name||'').replace(/<\/?[^>]+>/g,' ').replace(/\s+/g,' ').trim())continue;
      const policy=bookingPolicy(service.name),sourceActive=Number(source.status)===1&&!Number(source.delete_time);
      const variantUpdates=service.variants.map(variant=>({id:variant.id,before:{isActive:variant.isActive,priceBasis:variant.priceBasis},after:{isActive:sourceActive&&!!policy&&validOption(variant),priceBasis:'PER_BOOKING'}}));
      const active=sourceActive&&!!policy&&(variantUpdates.length?variantUpdates.some(row=>row.after.isActive):validOption(service));
      if(active)activeChoices++;
      if(!policy)summary.ambiguousServices++;
      else if(policy.mode==='COUPLE')summary.coupleServices++;
      else if(policy.mode==='FOUR_HANDS')summary.fourHandsServices++;
      summary.invalidVariants+=service.variants.filter(row=>!validOption(row)).length;
      const after={isActive:active,priceBasis:'PER_BOOKING',...(policy?{participantCount:policy.participantCount,requiredStaffCount:policy.requiredStaffCount}:{} )};
      const before=Object.fromEntries(Object.keys(after).map(key=>[key,service[key]]));
      const variants=variantUpdates.filter(row=>json(row.before)!==json(row.after));
      if(json(before)!==json(after)||variants.length)services.push({id:service.id,before,after,variants});
    }
    const hasHours=openHours(recovered.hours),hasStaff=shop.therapists.some(row=>row.isActive),hasTimezone=!!shop.timezone;
    const ready=hasHours&&hasStaff&&hasTimezone&&activeChoices>0;
    if(ready)summary.readyShops++;if(!hasHours)summary.missingHours++;if(!hasStaff)summary.missingStaff++;if(!hasTimezone)summary.missingTimezone++;
    const enable=enableReady&&ready&&profile.features?.onlineBooking!==true;
    const nextProfile={...profile,features:{...profile.features,...(enable?{onlineBooking:true}:{})},legacyImport:{...legacy,bookingRepair:{version:VERSION,daysRecovered:recovered.repaired,missingDays:recovered.missing,onlineBookingEnabled:enable,ambiguousServices:services.filter(row=>!bookingPolicy(shop.shopServices.find(s=>s.id===row.id)?.name)).map(row=>String(row.id))}}};
    plans.push({shopId:shop.id,updatedAt:shop.updatedAt,beforeHours:shop.businessHours,afterHours:recovered.hours,beforeProfile:profile,afterProfile:nextProfile,services});
    if(recovered.repaired){summary.hoursRepaired++;summary.daysRecovered+=recovered.repaired;}
    summary.serviceUpdates+=services.filter(row=>json(row.before)!==json(row.after)).length;
    summary.variantUpdates+=services.reduce((n,row)=>n+row.variants.length,0);if(enable)summary.onlineBookingEnabled++;
  }
  return {plans,summary,digest:sha(plans)};
}
async function main() {
  const args=new Set(process.argv.slice(2)),url=new URL(process.env.DATABASE_URL||'');
  if(process.env.NODE_ENV==='production'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='33090'||url.pathname!=='/mj2_store_migration_84cec1e6')throw new Error('Only the known local migration database is allowed');
  const sql=fs.readFileSync(path.join(ROOT,'.local/legacy-store-import-20261105/source-without-platform-stats.sql'),'utf8');
  const db=new PrismaClient();try{
    const plan=await buildPlan(db,sql,args.has('--enable-ready-shops'));
    if(!args.has('--apply')){console.log(json({mode:'dry-run',...plan.summary,digest:plan.digest}));return;}
    if(!args.has('--acknowledge-local-only')||!args.has('--expected-digest='+plan.digest))throw new Error('Apply needs local acknowledgement and the current plan digest');
    const directory=path.join(ROOT,'.local/booking-migration-repair');fs.mkdirSync(directory,{recursive:true});
    const backup=path.join(directory,'before-'+Date.now()+'.json');fs.writeFileSync(backup,json(plan),{flag:'wx',mode:0o600});
    const admin=await db.user.findFirst({where:{role:'ADMIN',status:'ACTIVE',deletedAt:null},select:{id:true}});if(!admin)throw new Error('Local administrator missing');
    await db.$transaction(async tx=>{
      for(const row of plan.plans) {
        await tx.$queryRaw`SELECT id FROM shops WHERE id=${row.shopId} FOR UPDATE`;
        const current=await tx.shop.findUniqueOrThrow({where:{id:row.shopId}});
        if(current.updatedAt.getTime()!==row.updatedAt.getTime()||json(current.studioProfile)!==json(row.beforeProfile)||json(current.businessHours)!==json(row.beforeHours))throw new Error('Concurrent shop edit; no changes applied');
        const reservations=await tx.booking.count({where:{shopId:row.shopId,deletedAt:null,status:{in:['PENDING','CONFIRMED']}}});
        if(reservations)throw new Error('Shop has live reservations; bulk repair cannot alter its rules');
        for(const service of row.services) {
          const changed=await tx.shopService.updateMany({where:{id:service.id,shopId:row.shopId,...service.before},data:service.after});
          if(changed.count!==1)throw new Error('Concurrent service edit');
          for(const variant of service.variants){const change=await tx.shopServiceVariant.updateMany({where:{id:variant.id,serviceId:service.id,...variant.before},data:variant.after});if(change.count!==1)throw new Error('Concurrent option edit');}
        }
        await tx.shop.update({where:{id:row.shopId},data:{businessHours:row.afterHours,studioProfile:row.afterProfile}});
        await tx.auditLog.create({data:{operatorId:admin.id,targetType:'SHOP',targetId:row.shopId,action:'UPDATE',detail:{source:VERSION,daysRecovered:row.afterProfile.legacyImport.bookingRepair.daysRecovered,services:row.services.length,externalProviderCalls:0}}});
      }
    },{timeout:600000,maxWait:30000});
    console.log(json({mode:'applied',...plan.summary,backup:path.relative(ROOT,backup),preservedPublicationStatuses:true}));
  }finally{await db.$disconnect();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={buildPlan,VERSION};
