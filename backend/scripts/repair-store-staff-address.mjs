import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { EXPECTED_DATABASE,localRepairUrl,planDigest } from './store-location-repair-plan.mjs';
import { canonical } from './provisional-store-completion-plan.mjs';
import { completionSelect,staffAddressRepairPlan,applyStaffAddressRepair } from './store-staff-address-repair-plan.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=new Set(process.argv.slice(2)), argument=prefix=>[...args].find(v=>v.startsWith(prefix))?.slice(prefix.length);
const json=value=>JSON.stringify(canonical(value),null,2)+'\n';
async function main() {
  const apply=args.has('--apply');
  if(apply!==args.has('--acknowledge-local-only')) throw Error('Apply requires explicit local-only flags');
  for(const arg of args) if(!['--apply','--acknowledge-local-only'].includes(arg)&&!['--expected-digest=','--report='].some(p=>arg.startsWith(p))) throw Error('Unknown argument');
  const report=argument('--report=')?path.resolve(argument('--report=')):null;
  if(report&&!report.toLowerCase().startsWith((path.join(root,'.local')+path.sep).toLowerCase())) throw Error('Reports must remain in project .local');
  const db=new PrismaClient({datasources:{db:{url:localRepairUrl(process.env.DATABASE_URL)}}});
  try {
    const actual=await db.$queryRaw`SELECT DATABASE() AS name`;
    if(actual[0]?.name!==EXPECTED_DATABASE) throw Error('Wrong database');
    const shops=await db.shop.findMany({select:completionSelect,orderBy:{id:'asc'}});
    if(shops.length!==1335||shops.some(s=>s.status!=='APPROVED'||s.deletedAt)) throw Error('Expected 1335 approved stores');
    const plan=staffAddressRepairPlan(shops), digest=planDigest(canonical(plan));
    const summary={mode:apply?'apply':'dry-run',database:EXPECTED_DATABASE,stores:shops.length,policy:plan.policy,digest,
      changedStores:plan.changes.length,staffAdded:plan.staffAdded,addressChanged:plan.addressChanged,provisionalStreets:plan.provisionalStreets,
      addresses:plan.changes.filter(c=>c.data.address).map(c=>({id:String(c.before.id),before:c.before.address,after:c.data.address,city:c.data.city??c.before.city}))};
    if(apply) {
      if(argument('--expected-digest=')!==digest) throw Error('Exact dry-run digest required');
      summary.backup=path.join(root,'.local','staff-address-before-'+digest+'.json');
      fs.writeFileSync(summary.backup,json({database:EXPECTED_DATABASE,digest,capturedAt:new Date().toISOString(),plan}),{flag:'wx',mode:0o600});
      summary.applied=await applyStaffAddressRepair(db,plan);
    }
    if(report) fs.writeFileSync(report,json({...summary,plan}),{mode:0o600});
    console.log(json(summary));
  } finally {await db.$disconnect();}
}
main().catch(error=>{console.error('Local staff/address repair failed: '+error.message);process.exitCode=1;});
