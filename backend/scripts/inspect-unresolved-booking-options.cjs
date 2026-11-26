'use strict';
const {PrismaClient}=require('@prisma/client');
const {validOption,bookingPolicy}=require('./lib/legacy-booking.cjs');
const {tableRows}=require('./lib/legacy-sql.cjs');
const fs=require('node:fs'),path=require('node:path');
const db=new PrismaClient();
async function main(){
 const sql=fs.readFileSync(path.resolve(__dirname,'../../.local/legacy-store-import-20261105/source-without-platform-stats.sql'),'utf8');
 const prices=new Map(tableRows(sql,'pro_price').map(r=>[String(r.id),r]));
 const shops=await db.shop.findMany({select:{id:true,studioProfile:true,shopServices:{include:{variants:true}}}});
 const rows=[];
 for(const shop of shops)for(const service of shop.shopServices){
  const invalid=service.variants.filter(v=>!validOption(v));if(!invalid.length&&bookingPolicy(service.name))continue;
  const linked=(shop.studioProfile?.priceMenu||[]).flatMap(g=>g.items||[]).filter(i=>String(i.booking?.serviceId)===String(service.id));
  rows.push({shopId:String(shop.id),serviceId:String(service.id),name:service.name,policy:bookingPolicy(service.name),invalid:invalid.map(v=>({id:String(v.id),name:v.name,durationMin:v.durationMin,priceCents:v.priceCents})),source:linked.map(i=>{const id=/^legacy-price-(\d+)$/.exec(i.id||'')?.[1],r=prices.get(id);return r?{id:r.id,keys:Object.keys(r),length:r.length,time:r.time,price:r.price,name:r.name}:null;})});
 }
 console.log(JSON.stringify(rows));
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e.message);process.exitCode=1;});
