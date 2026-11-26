/** Standalone bounded real consumer for the phase5 test container (NODE_ENV=test disables app timers). */
const path=require('node:path');
module.exports.runPhase5HttpWorker=async function runPhase5HttpWorker({acknowledge,durationMs=180000,compiledRoot=path.resolve('dist')}){
 if(acknowledge!=='PHASE5_SYNTHETIC_ONLY'||!Number.isSafeInteger(durationMs)||durationMs<1000||durationMs>300000)throw Error('PHASE5_WORKER_GUARD');
 const {PrismaClient}=require('@prisma/client'),db=new PrismaClient();let fcm;
 try{
  const [{name}]=await db.$queryRawUnsafe('SELECT DATABASE() AS name');if(name!=='massajoy2_phase5_http')throw Error('PHASE5_DATABASE_GUARD');
  const rows=await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');if(rows.length!==18)throw Error('PHASE5_MIGRATION_GUARD');
  const {FcmService}=require(path.join(compiledRoot,'modules/notifications/fcm.service.js'));
  const {NotificationWorker}=require(path.join(compiledRoot,'modules/notifications/notification-worker.service.js'));
  fcm=new FcmService(db);if(fcm.config().enabled)throw Error('PHASE5_EXTERNAL_PROVIDER_MUST_BE_DISABLED');
  const worker=new NotificationWorker(db,fcm),until=Date.now()+durationMs;
  while(Date.now()<until){await worker.runOnce();await new Promise(resolve=>setTimeout(resolve,1000));}
  worker.onModuleDestroy();return{completed:true,realDurableWorker:true,externalProviders:false};
 }finally{if(fcm)await fcm.onModuleDestroy();await db.$disconnect();}
};
