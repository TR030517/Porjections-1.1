'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {tableRows}=require('./lib/legacy-sql.cjs');
const {bookingPolicy,optionBookingPolicy,validOption}=require('./lib/legacy-booking.cjs');
const ROOT=path.resolve(__dirname,'../..'),VERSION='legacy-option-policy-v2';
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v);
const hash=value=>crypto.createHash('sha256').update(json(value)).digest('hex');
const plain=(value,max=200)=>String(value||'').replace(/<\/?[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const cents=value=>Math.round(Number(value)*100);
const serviceFields=['name','nameEn','category','durationKind','durationMin','priceCents','priceBasis','participantCount','requiredStaffCount','requiredRoomType','staffBufferMin','roomBufferMin','description','isActive','sortOrder'];
const pick=(row,keys)=>Object.fromEntries(keys.map(k=>[k,row[k]]));
const variantFields=['serviceId','name','durationMin','priceCents','priceBasis','currency','isActive','sortOrder'];
const labels={SINGLE:'Single Massage',COUPLE:'Couple Massage',FOUR_HANDS:'Four Hands Massage',DISPLAY_ONLY:'Display Only'};
function expectedVariant(source,variant,parent,sourceActive){return sourceActive&&!!bookingPolicy(parent)&&validOption(variant);}
async function buildPlan(db,sql){
  const projects=tableRows(sql,'pro_project'),prices=tableRows(sql,'pro_price');
  const categories=new Map(tableRows(sql,'pro_cate').map(r=>[String(r.id),plain(r.name)]));
  const pricesByProject=new Map();for(const row of prices){const key=String(row.pid);if(!pricesByProject.has(key))pricesByProject.set(key,[]);pricesByProject.get(key).push(row);}
  const shops=await db.shop.findMany({orderBy:{id:'asc'},include:{shopServices:{include:{variants:{orderBy:{id:'asc'}},_count:{select:{bookings:true,bookingItems:true,addOns:true}}}}}});
  if(shops.length!==1335||shops.some(s=>!s.studioProfile?.legacyImport?.sourceShopId))throw Error('Expected the 1335 imported shops');
  const plans=[],skipped=[],summary={shops:1335,affectedShops:0,serviceGroups:0,newServices:0,movedVariants:0,changedAllocations:0,displayOnlyOptions:0,recoveredBookableOptions:0};
  for(const shop of shops){
    if(shop.studioProfile.legacyImport.optionPolicyRepair?.version===VERSION)continue;
    if(shop.studioProfile.legacyImport.bookingRepair?.version!=='legacy-booking-repair-v1')continue;
    const sourceShopId=String(shop.studioProfile.legacyImport.sourceShopId),actions=[];
    const sourceProjects=projects.filter(p=>String(p.mch_id)===sourceShopId);
    for(const service of shop.shopServices){
      const possible=sourceProjects.filter(p=>plain(p.name)===service.name);
      if(possible.length!==1)continue;
      const source=possible[0],sourcePrices=pricesByProject.get(String(source.id))||[],sourceActive=Number(source.status)===1&&!Number(source.delete_time);
      const parent=[service.name,...String(source.cid||'').split(',').map(id=>categories.get(id.trim())).filter(Boolean)].join(' ');
      const optionSources=new Map(),used=new Set();let mismatch=false;
      for(const variant of service.variants){
        const linkedIds=(shop.studioProfile.priceMenu||[]).flatMap(g=>g.items||[])
          .filter(i=>String(i.booking?.serviceId)===String(service.id)&&String(i.booking?.variantId)===String(variant.id))
          .map(i=>/^legacy-price-(\d+)$/.exec(i.id||'')?.[1]);
        if(linkedIds.length>1||linkedIds.some(id=>!id)){mismatch=true;break;}
        const matches=sourcePrices.filter(p=>(!linkedIds.length||String(p.id)===linkedIds[0])&&plain(p.name,100)===variant.name&&Number(p.minute)===variant.durationMin&&cents(p.price)===variant.priceCents&&!used.has(String(p.id)));
        if(matches.length!==1){mismatch=true;break;}used.add(String(matches[0].id));optionSources.set(String(variant.id),matches[0]);
      }
      if(mismatch||!service.variants.length)continue;
      const groups=new Map();
      for(const variant of service.variants){
        const raw=optionSources.get(String(variant.id)),policy=optionBookingPolicy(plain(raw.name),parent),key=policy?.mode||'DISPLAY_ONLY';
        if(!groups.has(key))groups.set(key,{key,policy,variants:[]});
        groups.get(key).variants.push({id:variant.id,sourceId:String(raw.id),before:pick(variant,variantFields),updatedAt:variant.updatedAt,after:{isActive:sourceActive&&!!policy&&validOption(variant),priceBasis:'PER_BOOKING'}});
      }
      const oldPolicy=bookingPolicy(service.name),oldActive=sourceActive&&!!oldPolicy&&service.variants.some(validOption);
      const needs=groups.size>1||[...groups.values()].some(g=>(g.policy&&(g.policy.participantCount!==service.participantCount||g.policy.requiredStaffCount!==service.requiredStaffCount))||g.variants.some(v=>v.before.isActive!==v.after.isActive)||(g.key==='DISPLAY_ONLY'&&g.variants.some(v=>(shop.studioProfile.priceMenu||[]).some(group=>(group.items||[]).some(i=>String(i.booking?.variantId)===String(v.id))))));
      if(!needs)continue;
      const oldCounts=oldPolicy||{participantCount:1,requiredStaffCount:1};
      const importedBase=service.variants.some(v=>v.durationMin===service.durationMin&&v.priceCents===service.priceCents)
        ||(service.durationMin===Math.min(...service.variants.map(v=>v.durationMin))&&service.priceCents===Math.min(...service.variants.map(v=>v.priceCents)));
      // Only unchanged v1 imports can be regrouped. Historical orders and extras
      // keep their original service/variant identity and are never rewritten.
      if(service.durationKind!=='TIMED'||service.priceBasis!=='PER_BOOKING'||service.requiredRoomType||service.staffBufferMin||service.roomBufferMin||!importedBase||service.isActive!==oldActive||service.participantCount!==oldCounts.participantCount||service.requiredStaffCount!==oldCounts.requiredStaffCount||service.variants.some(v=>v.isActive!==expectedVariant(optionSources.get(String(v.id)),v,service.name,sourceActive))||service._count.bookings||service._count.bookingItems||service._count.addOns){skipped.push({shopId:shop.id,serviceId:service.id,reason:'Edited configuration or existing booking/add-on references'});continue;}
      const ordered=[...groups.values()].sort((a,b)=>Number(b.key===(oldPolicy?.mode||'SINGLE'))-Number(a.key===(oldPolicy?.mode||'SINGLE'))||Number(a.key==='DISPLAY_ONLY')-Number(b.key==='DISPLAY_ONLY'));
      for(let index=0;index<ordered.length;index++){
        const group=ordered[index],base=group.variants.find(v=>v.after.isActive)||group.variants[0];
        group.data={...pick(service,serviceFields),name:index===0?service.name:(service.name+' · '+labels[group.key]).slice(0,200),durationMin:base.before.durationMin,priceCents:base.before.priceCents,priceBasis:'PER_BOOKING',participantCount:group.policy?.participantCount??1,requiredStaffCount:group.policy?.requiredStaffCount??1,isActive:group.variants.some(v=>v.after.isActive)};
        if(group.policy&&(group.policy.participantCount!==service.participantCount||group.policy.requiredStaffCount!==service.requiredStaffCount))summary.changedAllocations+=group.variants.length;
        if(!group.policy)summary.displayOnlyOptions+=group.variants.length;
        summary.recoveredBookableOptions+=group.variants.filter(v=>!v.before.isActive&&v.after.isActive).length;
        if(index)summary.movedVariants+=group.variants.length;
      }
      actions.push({serviceId:service.id,before:pick(service,serviceFields),updatedAt:service.updatedAt,groups:ordered});summary.serviceGroups+=ordered.length;summary.newServices+=ordered.length-1;
    }
    if(actions.length)plans.push({shopId:shop.id,updatedAt:shop.updatedAt,beforeProfile:shop.studioProfile,actions});
  }
  summary.affectedShops=plans.length;return{version:VERSION,summary,plans,skipped,digest:hash(plans)};
}
async function applyPlan(db,plan){
  const directory=path.join(ROOT,'.local/option-policy-repair');fs.mkdirSync(directory,{recursive:true});
  const backup=path.join(directory,'before-'+Date.now()+'.json');fs.writeFileSync(backup,json(plan),{flag:'wx',mode:0o600});
  const admin=await db.user.findFirst({where:{role:'ADMIN',status:'ACTIVE',deletedAt:null},select:{id:true}});if(!admin)throw Error('Local administrator missing');
  await db.$transaction(async tx=>{
    for(const row of plan.plans){
      await tx.$queryRaw`SELECT id FROM shops WHERE id=${row.shopId} FOR UPDATE`;
      const current=await tx.shop.findUniqueOrThrow({where:{id:row.shopId}});
      if(current.updatedAt.getTime()!==row.updatedAt.getTime()||json(current.studioProfile)!==json(row.beforeProfile))throw Error('Concurrent shop edit');
      if(await tx.booking.count({where:{shopId:row.shopId,status:{in:['PENDING','CONFIRMED']},deletedAt:null}}))throw Error('Live bookings prevent regrouping');
      const profile=structuredClone(row.beforeProfile);
      for(const action of row.actions){
        const service=await tx.shopService.findUniqueOrThrow({where:{id:action.serviceId},include:{variants:true,_count:{select:{bookings:true,bookingItems:true,addOns:true}}}});
        if(service.updatedAt.getTime()!==action.updatedAt.getTime()||json(pick(service,serviceFields))!==json(action.before)||service._count.bookings||service._count.bookingItems||service._count.addOns||service.variants.length!==action.groups.reduce((n,g)=>n+g.variants.length,0))throw Error('Concurrent service or order edit');
        for(let index=0;index<action.groups.length;index++){
          const group=action.groups[index];
          const target=index?await tx.shopService.create({data:{shopId:row.shopId,...group.data}}):await tx.shopService.update({where:{id:action.serviceId},data:group.data});
          for(const variant of group.variants){
            const changed=await tx.shopServiceVariant.updateMany({where:{id:variant.id,updatedAt:variant.updatedAt,...variant.before},data:{serviceId:target.id,...variant.after}});if(changed.count!==1)throw Error('Concurrent price option edit');
            for(const menu of profile.priceMenu||[])for(const item of menu.items||[]){
              if(item.id!=='legacy-price-'+variant.sourceId)continue;
              if(item.booking&&String(item.booking.variantId)!==String(variant.id))throw Error('Price-menu option identity conflict');
              if(group.policy)item.booking={...item.booking,serviceId:String(target.id),variantId:String(variant.id)};else delete item.booking;
            }
          }
        }
      }
      profile.legacyImport.optionPolicyRepair={version:VERSION,services:row.actions.length};
      await tx.shop.update({where:{id:row.shopId},data:{studioProfile:profile}});
      await tx.auditLog.create({data:{operatorId:admin.id,targetType:'SHOP',targetId:row.shopId,action:'UPDATE',detail:{source:VERSION,services:row.actions.length,externalProviderCalls:0}}});
    }
  },{timeout:600000,maxWait:30000});return path.relative(ROOT,backup);
}
async function main(){
  const args=new Set(process.argv.slice(2)),url=new URL(process.env.DATABASE_URL||'');
  if(process.env.NODE_ENV==='production'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='33090'||url.pathname!=='/mj2_store_migration_84cec1e6')throw Error('Only the known local migration database is allowed');
  const sql=fs.readFileSync(path.join(ROOT,'.local/legacy-store-import-20261105/source-without-platform-stats.sql'),'utf8');
  const db=new PrismaClient();try{
    const plan=await buildPlan(db,sql);let backup;
    if(args.has('--apply')){if(!args.has('--acknowledge-local-only')||!args.has('--expected-digest='+plan.digest))throw Error('Apply requires local acknowledgement and exact digest');backup=await applyPlan(db,plan);}
    console.log(json({mode:args.has('--apply')?'applied':'dry-run',...plan.summary,digest:plan.digest,skipped:plan.skipped,backup,...(args.has('--details')?{changes:plan.plans.flatMap(p=>p.actions.map(a=>({shopId:p.shopId,serviceId:a.serviceId,name:a.before.name,groups:a.groups.map(g=>({mode:g.key,variants:g.variants.map(v=>v.before.name)}))})))}:{})}));
  }finally{await db.$disconnect();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={buildPlan,applyPlan};
