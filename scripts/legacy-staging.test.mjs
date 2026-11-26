import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {planLegacyStaging,sourceMappingId,canonicalJson,exactMoney} from './legacy-staging-plan.mjs';
import {importLegacyStaging,guardStagingDatabase,validateStagingUrl} from './legacy-staging.mjs';
const source=JSON.parse(readFileSync(new URL('./fixtures/legacy-staging-synthetic.json',import.meta.url),'utf8'));
const clone=()=>structuredClone(source),codes=input=>planLegacyStaging(input).report.issueCounts;
const plan=input=>{const result=planLegacyStaging(input);assert.equal(result.report.stagingEligible,true,JSON.stringify(result.report.issues));return result.plan;};
const options=p=>({acknowledgeStagingOnly:true,expectedDigest:p.packageDigest});

// Transaction-composition double only. MySQL behavior is exercised by the separate root-owned disposable runner.
function fakeDb({name='mj2_legacy_staging_a1b2c3d4',businessRows=0,failInsert=0,displayDefaults='none'}={}){
  let state={batches:[],entities:[]},reads=[],writes=0;
  const model=s=>({
    $queryRawUnsafe:async (sql,...values)=>{
      reads.push(sql);
      if(sql==='SELECT DATABASE() AS database_name')return[{database_name:name}];
      if(sql.startsWith('SELECT TABLE_NAME'))return['_prisma_migrations','legacy_staging_batches','legacy_staging_entities','users','platform_configs'].map(table_name=>({table_name,table_type:'BASE TABLE'}));
      if(sql.startsWith('SELECT migration_name'))return[{migration_name:'202610280017_legacy_staging',finished_at:new Date(),rolled_back_at:null}];
      if(sql.includes('COUNT(*)')&&sql.includes('`users`'))return[{row_count:BigInt(businessRows)}];
      if(sql.includes('FROM platform_configs'))return[{row_count:displayDefaults==='none'?0n:displayDefaults==='partial'?2n:3n,invalid_count:displayDefaults==='unknown'?1n:0n}];
      if(sql.startsWith('SELECT COUNT(*) AS row_count FROM legacy_staging_entities'))return[{row_count:BigInt(s.entities.length)}];
      if(sql==='SELECT id FROM legacy_staging_batches')return s.batches.map(({id})=>({id}));
      if(sql.startsWith('SELECT id,singleton'))return structuredClone(s.batches);
      if(sql.startsWith('SELECT id,batch_id'))return structuredClone(s.entities).sort((a,b)=>a.id<b.id?-1:1);
      throw Error('Unexpected synthetic SQL read');
    },
    $executeRawUnsafe:async(sql,...v)=>{
      writes++;if(failInsert&&writes===failInsert)throw Error('Synthetic transaction failure');
      if(sql.startsWith('INSERT INTO legacy_staging_batches')){s.batches.push({id:v[0],singleton:1,plan_digest:v[1],source_system:v[2],dataset_kind:v[3],summary:JSON.parse(v[4])});return 1;}
      if(sql.startsWith('INSERT INTO legacy_staging_entities')){s.entities.push({id:v[0],batch_id:v[1],source_system:v[2],source_table:v[3],source_id:v[4],kind:v[5],shop_key:v[6],payload:JSON.parse(v[7]),payload_digest:v[8]});return 1;}
      throw Error('Unexpected synthetic SQL write');
    },
  });
  const db={$queryRawUnsafe:(...args)=>model(state).$queryRawUnsafe(...args),$transaction:async(work,settings)=>{assert.equal(settings.isolationLevel,'ReadCommitted');const staged=structuredClone(state),result=await work(model(staged));state=staged;return result;}};
  return{db,state:()=>state,reads:()=>reads,writes:()=>writes,change:fn=>fn(state)};
}
test('explicit namespace mapping preserves leading zeros, BigInt-sized IDs and separate administrator namespace',()=>{
  const input=clone(),before=canonicalJson(input),p=plan(input);
  assert.equal(canonicalJson(input),before);assert.equal(p.entities.length,13);
  assert.notEqual(sourceMappingId('Massajoy1.0',{table:'users',id:'0007'}),sourceMappingId('Massajoy1.0',{table:'sys_manager',id:'0007'}));
  assert.notEqual(sourceMappingId('Massajoy1.0',{table:'users',id:'0007'}),sourceMappingId('Massajoy1.0',{table:'users',id:'7'}));
  assert.notEqual(sourceMappingId('Massajoy1.0',{table:'users',id:'0007'}),sourceMappingId('Massajoy1.5',{table:'users',id:'0007'}));
  assert.ok(p.entities.some(e=>e.sourceId==='9007199254740993'));assert.ok(p.entities.every(e=>/^[a-f0-9]{64}$/.test(e.id)));
});
test('plan and package digests are deterministic across row/object order and original text is preserved',()=>{
  const a=clone(),b=JSON.parse(JSON.stringify(a,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));
  for(const key of Object.keys(b))if(Array.isArray(b[key]))b[key].reverse();
  const first=plan(a),second=plan(b);assert.equal(first.packageDigest,second.packageDigest);assert.equal(first.planDigest,second.planDigest);
  assert.deepEqual(first.reconciliation,second.reconciliation);assert.equal(first.entities.find(e=>e.kind==='historicalBookings').payload.amounts.total.original,'57.35');
  const money=first.reconciliation.byShopCurrency.find(row=>row.currency==='usd');
  assert.equal(money.historicalTotalCents,'5735');assert.equal(money.historicalTipCents,'185');assert.equal(money.paymentCents,'5735');assert.equal(money.refundCents,'1000');assert.equal(money.unusedUses,'5');
});
test('integer-cent normalization is exact, declared and never rounded',()=>{
  for(const value of [{original:'57.35',unit:'major',cents:5735},{original:'5735',unit:'minor',cents:5735},{original:'0.1',unit:'major',cents:10}])assert.notEqual(exactMoney(value),null);
  for(const value of [{original:'57.355',unit:'major',cents:5736},{original:'57.35',unit:'major',cents:5700},{original:57.35,unit:'major',cents:5735},{original:'05735',unit:'minor',cents:5735},{original:'57.35',unit:'unknown',cents:5735},{original:'1e3',unit:'minor',cents:1000}])assert.equal(exactMoney(value),null);
});
test('different explicit historical currencies remain separate with no exchange conversion',()=>{
  const input=JSON.parse(JSON.stringify(clone()).replaceAll('"usd"','"eur"')),p=plan(input);
  const row=p.reconciliation.byShopCurrency.find(r=>r.currency==='eur');assert.equal(row.historicalTotalCents,'5735');assert.equal(p.entities.find(e=>e.kind==='services').payload.currency,'eur');
});
for(const [label,change,expected]of[
  ['duplicate source',x=>x.identities.push(structuredClone(x.identities[0])),'DUPLICATE_SOURCE_ID'],
  ['orphan owner',x=>x.shops[0].owner.id='missing','ORPHAN_SOURCE_REFERENCE'],
  ['numeric old ID',x=>x.shops[0].source.id=3740,'EXPLICIT_SOURCE_ID_REQUIRED'],
  ['missing historical timezone',x=>x.historicalBookings[0].timezone=null,'HISTORICAL_TIMEZONE_REQUIRED'],
  ['ambiguous offset',x=>x.historicalBookings[0].startAt='2031-05-01T10:00:00','EXPLICIT_TIMESTAMP_REQUIRED'],
  ['incorrect DST offset',x=>x.historicalBookings[0].startAt='2031-05-01T10:00:00-05:00','TIMEZONE_OFFSET_MISMATCH'],
  ['unfinished booking',x=>x.historicalBookings[0].status='PENDING','ENUM_OR_SEMANTICS_UNMAPPED'],
  ['future terminal booking',x=>x.source.exportedAt='2031-04-29T12:00:00Z','NON_HISTORICAL_BOOKING_UNSUPPORTED'],
  ['shared receipt',x=>x.historicalPayments[0].ownership='PLATFORM_SHARED','ENUM_OR_SEMANTICS_UNMAPPED'],
  ['unknown funds',x=>x.historicalPayments[0].provider='unknown','ENUM_OR_SEMANTICS_UNMAPPED'],
  ['unknown or unsupported decimal currency',x=>x.historicalBookings[0].currency='jpy','CURRENCY_REQUIRED_NO_CONVERSION'],
  ['pending refund',x=>x.historicalPayments[1].status='RETRYABLE','ENUM_OR_SEMANTICS_UNMAPPED'],
  ['future settlement',x=>x.historicalPayments[1].occurredAt='2031-05-03T12:00:00Z','FUTURE_SETTLEMENT_UNSUPPORTED'],
  ['shared receipt across rights',x=>x.unusedEntitlements[0].funding.evidenceDigest=x.historicalPayments[0].evidenceDigest,'DUPLICATE_SETTLEMENT_EVIDENCE'],
  ['future-issued rights',x=>x.unusedEntitlements[0].issuedAt='2031-05-03T10:00:00-04:00','FUTURE_ENTITLEMENT_UNSUPPORTED'],
  ['wrong expiry status',x=>x.unusedEntitlements[0].status='EXPIRED','ENTITLEMENT_EXPIRY_STATUS_CONFLICT'],
  ['amount text mismatch',x=>x.historicalPayments[0].amount.original='57.36','EXACT_MONEY_REQUIRED'],
  ['paid ledger mismatch',x=>x.historicalPayments[0].amount={unit:'minor',original:'5734',cents:5734},'HISTORICAL_LEDGER_UNBALANCED'],
  ['part-used rights',x=>x.unusedEntitlements[0].remainingUses=4,'PART_USED_ENTITLEMENT_UNSUPPORTED'],
  ['unknown domain',x=>x.source.unsupportedDomains=['wallet'],'UNSUPPORTED_DOMAIN_PRESENT'],
])test(`blocks ${label} without dropping the record`,()=>{const input=clone();change(input);const result=planLegacyStaging(input);assert.equal(result.plan,null);assert.ok(result.report.issueCounts[expected]);});
test('cross-shop qualification/payment/entitlement references never follow shared-owner assumptions',()=>{
  const input=clone(),other=structuredClone(input.shops[0]);other.source.id='second-shop';other.shortName='second-shop';input.shops.push(other);
  input.therapists[0].shop=other.source;input.historicalPayments[0].shop=other.source;input.unusedEntitlements[0].shop=other.source;
  assert.ok(codes(input).CROSS_SHOP_OR_AMBIGUOUS_OWNERSHIP);
});
test('malformed nested data and sensitive unknown fields produce fixed safe issues, never raw values',()=>{
  const input=clone();input.identities[0].password='SYNTHETIC_SECRET_MUST_NOT_PRINT';input.shops[0].owner=null;input.historicalPayments[0].owner={table:'users',id:'missing'};
  const result=planLegacyStaging(input);assert.equal(result.plan,null);const serialized=JSON.stringify(result.report);
  assert.doesNotMatch(serialized,/SYNTHETIC_SECRET|password|9007199254740993|anon_owner|Synthetic staging/);assert.ok(result.report.summary.blockers>0);
});
test('raw preflight v1 and undeclared redaction are not silently upgraded',()=>{
  const old=JSON.parse(readFileSync(new URL('./fixtures/legacy-preflight-valid.json',import.meta.url),'utf8'));
  assert.equal(planLegacyStaging(old).plan,null);const input=clone();input.source.piiRemoved=false;assert.ok(codes(input).REDACTION_DECLARATION_REQUIRED);
});
test('staging URL must name a new loopback staging database; never a production/current schema',()=>{
  const good='mysql://synthetic:synthetic@127.0.0.1:3339/mj2_legacy_staging_a1b2c3d4';assert.equal(validateStagingUrl(good).database,'mj2_legacy_staging_a1b2c3d4');
  for(const bad of [good.replace('127.0.0.1','db.example.test'),good.replace('a1b2c3d4','wrong'),good.replace('mj2_legacy_staging_a1b2c3d4','massajoy2'),good+'?schema=live',good.replace('mysql:','https:')])assert.throws(()=>validateStagingUrl(bad));
});
test('connected-target mismatch is rejected before any business-table read or write',async()=>{
  const f=fakeDb({name:'massajoy2'});await assert.rejects(guardStagingDatabase(f.db),/DISPOSABLE_STAGING/);assert.equal(f.reads().length,1);assert.equal(f.writes(),0);
});
test('only zero or exact migration018 public display defaults are permitted in an otherwise empty staging database',async()=>{
  for(const displayDefaults of ['none','exact'])await guardStagingDatabase(fakeDb({displayDefaults}).db);
  for(const displayDefaults of ['partial','unknown'])await assert.rejects(guardStagingDatabase(fakeDb({displayDefaults}).db),/DISPLAY_DEFAULTS_NOT_CANONICAL/);
  const exact=fakeDb({displayDefaults:'exact'}),p=plan(clone());await importLegacyStaging(exact.db,clone(),options(p));assert.equal(exact.state().entities.length,13);
});
test('nonempty business table, absent acknowledgement and stale digest cannot mutate staging',async()=>{
  const f=fakeDb({businessRows:1}),p=plan(clone());await assert.rejects(importLegacyStaging(f.db,clone(),options(p)),/NOT_EMPTY/);assert.equal(f.writes(),0);
  const clean=fakeDb();await assert.rejects(importLegacyStaging(clean.db,clone(),{}),/ACK/);await assert.rejects(importLegacyStaging(clean.db,clone(),{acknowledgeStagingOnly:true,expectedDigest:'0'.repeat(64)}),/DIGEST/);assert.equal(clean.reads().length,0);
});
test('transaction failure leaves no batch/entities, then exact package imports and replays without duplicates',async()=>{
  const p=plan(clone()),failed=fakeDb({failInsert:4});await assert.rejects(importLegacyStaging(failed.db,clone(),options(p)),/Synthetic transaction failure/);assert.deepEqual(failed.state(),{batches:[],entities:[]});
  const f=fakeDb(),first=await importLegacyStaging(f.db,clone(),options(p)),before=f.writes(),again=await importLegacyStaging(f.db,clone(),options(p));
  assert.equal(first.replayed,false);assert.equal(again.replayed,true);assert.equal(again.liveImported,false);assert.equal(again.verified,true);assert.equal(f.writes(),before);assert.equal(f.state().entities.length,13);
});
test('changed package cannot replace a source identity and tampered rows/summaries fail replay reconciliation',async()=>{
  const input=clone(),p=plan(input),f=fakeDb();await importLegacyStaging(f.db,input,options(p));
  const changed=clone();changed.services[0].displayLabel='Changed fact';await assert.rejects(importLegacyStaging(f.db,changed,options(plan(changed))),/ANOTHER_STAGING/);
  f.change(s=>{s.entities[0].payload={changed:true};});await assert.rejects(importLegacyStaging(f.db,input,options(p)),/CONTENT_MISMATCH/);
  const summary=fakeDb();await importLegacyStaging(summary.db,input,options(p));summary.change(s=>{s.batches[0].summary.counts.identities=0;});await assert.rejects(importLegacyStaging(summary.db,input,options(p)),/BATCH_MISMATCH/);
});
test('CLI offline mode writes safe new reports without implicit DB access or input changes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'massajoy-staging-test-')),cli=fileURLToPath(new URL('./legacy-staging.mjs',import.meta.url));
  try{const input=join(dir,'input.json'),output=join(dir,'report.json'),bytes=JSON.stringify(clone());writeFileSync(input,bytes);
    const result=spawnSync(process.execPath,[cli,input,'--report',output],{encoding:'utf8',env:{...process.env,DATABASE_URL:'DO_NOT_READ_A_SECRET_URL'}});
    assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.stagingEligible,true);assert.equal(report.liveImportImplemented,false);assert.equal(readFileSync(input,'utf8'),bytes);
    assert.doesNotMatch(result.stdout,/DO_NOT_READ|anon_owner|9007199254740993|Synthetic staging/);
    const same=spawnSync(process.execPath,[cli,input,'--report',output],{encoding:'utf8'});assert.equal(same.status,1);assert.doesNotMatch(same.stdout,/input.json|report.json/);
    const noApply=spawnSync(process.execPath,[cli,input,'--database-url-file','DO-NOT-READ.json'],{encoding:'utf8'});assert.equal(noApply.status,1);
    const remote=spawnSync(process.execPath,[cli,'https://example.invalid/raw.json'],{encoding:'utf8'});assert.equal(remote.status,1);assert.doesNotMatch(remote.stdout,/example.invalid/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
