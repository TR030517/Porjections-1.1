const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json'),transpileOnly:true});
const {PrismaClient}=require('@prisma/client');
const results=[];
async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name);}
(async()=>{
  const url=new URL(process.env.DATABASE_URL||'');
  if(process.env.MASSAJOY_PHASE4_DISPOSABLE!=='fresh-container-only'||url.hostname!=='127.0.0.1'||url.pathname!=='/massajoy2_phase4_check')throw Error('Disposable SQL target guard rejected');
  const db=new PrismaClient({datasources:{db:{url:String(url)}}});
  try{
    await db.$connect();assert.equal(await db.user.count(),0);
    await check('all eighteen migrations apply to a newly created empty MySQL',async()=>assert.equal((await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')).length,18));
    const owner=await db.user.create({data:{phone:'TEST-PHASE4-OWNER',role:'MERCHANT'}}),customer=await db.user.create({data:{phone:'TEST-PHASE4-CUSTOMER'}});
    const shop=await db.shop.create({data:{ownerId:owner.id,name:'Phase4 synthetic shop',shortName:'phase4-shop',phone:'TEST-ONLY',address:'Synthetic',city:'Test',state:'NY',zipCode:'00000',latitude:1,longitude:1,category:'MIXED',status:'APPROVED',timezone:'UTC'}});
    await require('./phase4-content.cjs').runContent(db,{check,owner,customer,shop});
    await require('./phase4-media.cjs').runMedia(db,{check,owner,customer,shop});
    await fs.writeFile(path.join(__dirname,'../../docs/verification/phase4-business-mysql-2026-10-28.json'),JSON.stringify({verifiedAt:new Date().toISOString(),target:'new disposable business test database only',migrations:18,results},null,2));
    console.log(`Completed ${results.length} source-service business SQL checks.`);
  }finally{await db.$disconnect();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
