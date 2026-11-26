'use strict';
const {PrismaClient}=require('@prisma/client');const fs=require('node:fs');const path=require('node:path');
const db=new PrismaClient();
async function main(){
  const orders=await db.booking.findMany({where:{notes:{startsWith:'LOCAL_QA_16:'}},include:{items:true,resourceLocks:true},orderBy:{id:'asc'}});
  const evidence=[];
  for(const b of orders){
    const mail=await db.notificationOutbox.findMany({where:{bookingId:b.id,channel:'EMAIL'},select:{id:true,status:true,topic:true,lastErrorCode:true,acceptedCount:true}});
    const captured=mail.filter(m=>fs.existsSync(path.resolve(__dirname,'../../.local/order-email-capture',m.id+'.json')));
    evidence.push({id:String(b.id),bookingNo:b.bookingNo,status:b.status,priceCents:b.priceCents,totalCents:b.totalCents,paymentMode:b.paymentMode,timezone:b.bookingTimezone,participants:b.participantCountSnapshot,staff:b.requiredStaffCountSnapshot,items:b.items.map(i=>({participantIndex:i.participantIndex,therapistId:i.assignedTherapistId?String(i.assignedTherapistId):null})),resourceLocks:b.resourceLocks.map(l=>({type:l.resourceType,id:String(l.resourceId),status:l.status,start:l.startAtUtc,end:l.endAtUtc})),mail,captured:captured.length});
  }
  fs.writeFileSync(path.resolve(__dirname,'../../.local/qa16-order-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1;});
