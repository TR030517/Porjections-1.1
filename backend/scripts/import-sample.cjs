// Explicit opt-in. Only sanitized public store/region fixtures enter isolated local databases.
const { PrismaClient }=require('@prisma/client');
const fs=require('node:fs'); const path=require('node:path');
async function main(){
  const url=new URL(process.env.DATABASE_URL || '');
  if(!['127.0.0.1','localhost','db'].includes(url.hostname) || !/^\/(?:mj2_test_[a-zA-Z0-9_]+|massajoy2_local)$/.test(url.pathname) || process.env.NODE_ENV==='production') throw Error('Sample import is restricted to an isolated local test database');
  const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/massajoy1-sample.json'),'utf8'));
  const apply=process.argv.includes('--apply');
  if(!apply){console.log(JSON.stringify({mode:'dry-run',stores:source.stores?.length ?? 0,regions:source.regions?.length ?? 0,excluded:['users','serviceOrders','payments'],shopStatus:'PENDING'}));return;}
  const prisma=new PrismaClient();
  try {
    if(await prisma.shop.count() || await prisma.region.count()) throw Error('Import requires empty stores and regions; it never overwrites business data');
    const actor=await prisma.user.findFirst({where:{role:'ADMIN',status:'ACTIVE'}});if(!actor)throw Error('Bootstrap an admin first');
    await prisma.$transaction(async tx=>{
      const owner=await tx.user.create({data:{phone:'+15550009999',name:'Sanitized fixture owner (no login credentials)',role:'MERCHANT',status:'ACTIVE'}});
      const ids=new Map();
      for(const region of source.regions || []) if(region.kind==='state') {const r=await tx.region.create({data:{kind:'state',english:region.english,chinese:region.chinese,abbr:region.abbr || '',status:region.status || '启用',sort:region.sort || 100}});ids.set(String(region.id),r.id);}
      for(const region of source.regions || []) if(region.kind==='city') {const parentId=ids.get(String(region.parentId ?? region.stateId));if(!parentId)throw Error('Fixture city parent missing');await tx.region.create({data:{kind:'city',parentId,english:region.english,chinese:region.chinese,abbr:region.abbr || '',zipCode:region.zipCode || '',status:region.status || '启用',sort:region.sort || 100}});}
      for(const shop of source.stores || []) {
        const created=await tx.shop.create({data:{ownerId:owner.id,name:shop.name,shortName:shop.shortName,phone:'',address:shop.address || '',city:shop.city || '',state:shop.state || '',zipCode:shop.zipCode || '',latitude:0,longitude:0,category:'MIXED',status:'PENDING',studioProfile:{subtitle:shop.subtitle || '',sampleSource:'Massajoy1.0 public read-only sample',phones:[],emails:[],features:{onlineBooking:false,onlinePayment:false,reviews:false,membershipCard:false}}}});
        const profile=await tx.merchantProfile.create({data:{userId:owner.id,shopId:created.id}});
        await tx.auditLog.create({data:{action:'MERCHANT_PROFILE_CREATED',targetType:'MerchantProfile',targetId:profile.id,operatorId:actor.id,detail:{source:'sanitized-local-sample',shopId:String(created.id),ownerId:String(owner.id),balanceCents:0,externalPaymentsEnabled:false}}});
      }
      await tx.auditLog.create({data:{action:'IMPORT_SANITIZED_SAMPLE',targetType:'SAMPLE',targetId:owner.id,operatorId:actor.id,detail:{source:'massajoy1-sample.json',ordersImported:false,usersImported:false}}});
    });
    console.log('Sanitized stores and regions imported as drafts. No users, orders or payments imported.');
  }finally{await prisma.$disconnect();}
}
main().catch(e=>{console.error(e.message.startsWith('Invalid URL')?'Invalid DATABASE_URL':e.message);process.exitCode=1;});
