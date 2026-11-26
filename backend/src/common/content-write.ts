import { Prisma } from '@prisma/client';
import { numericId } from '../modules/payment/money';
import { requireBannerAdministrator, withBannerMediaRetry } from './managed-media';

/** Dedicated legacy admin routes follow the same atomic safe audit rule as Studio. */
export function contentWrite<T extends {id:bigint}>(db:any, kind:'ANNOUNCEMENT'|'BANNER', id:bigint|undefined, actor:string,
  action:string, work:(tx:any)=>Promise<T>) {
  const operatorId=numericId(actor);
  return withBannerMediaRetry<T>(kind==='BANNER',()=>db.$transaction(async(tx:any)=>{
    if(kind==='BANNER')await requireBannerAdministrator(tx,{id:actor,role:'ADMIN'});
    if (id) {
      if(kind==='ANNOUNCEMENT') await tx.$queryRaw(Prisma.sql`SELECT id FROM announcements WHERE id=${id} FOR UPDATE`);
      else await tx.$queryRaw(Prisma.sql`SELECT id FROM home_banners WHERE id=${id} FOR UPDATE`);
    }
    const row=await work(tx);
    await tx.auditLog.create({data:{operatorId,targetType:kind,targetId:row.id,action,detail:{contentRecorded:true}}});
    return row;
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted}));
}
