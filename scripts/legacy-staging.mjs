#!/usr/bin/env node
// Default is offline. Database access exists only behind explicit disposable staging guards.
import {readFileSync,lstatSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,extname,relative,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {canonicalJson,planLegacyStaging,stagingHash,stagingReconciliation} from './legacy-staging-plan.mjs';

export const STAGING_DATABASE = /^mj2_legacy_staging_[a-f0-9]{8}$/;
const LIMIT=32*1024*1024;
const TOOL_TABLES=new Set(['_prisma_migrations','legacy_staging_batches','legacy_staging_entities']);
const fail=code=>{throw new Error(code);};
export function validateStagingUrl(value){
  if(typeof value!=='string')return fail('STAGING_DATABASE_URL_INVALID');
  let url;try{url=new URL(value);}catch{return fail('STAGING_DATABASE_URL_INVALID');}
  if(url.protocol!=='mysql:'||url.hostname!=='127.0.0.1'||!url.port||!/^\d+$/.test(url.port)||Number(url.port)<1||Number(url.port)>65535||!url.username||!url.password||url.search||url.hash||!STAGING_DATABASE.test(url.pathname.slice(1)))fail('DISPOSABLE_STAGING_TARGET_REQUIRED');
  return {url:value,database:url.pathname.slice(1)};
}
/** Fails before enumerating business tables if the real connected schema is not the explicit staging target. */
export async function guardStagingDatabase(db){
  const names=await db.$queryRawUnsafe('SELECT DATABASE() AS database_name');
  const name=names[0]?.database_name;
  if(typeof name!=='string'||!STAGING_DATABASE.test(name))fail('DISPOSABLE_STAGING_TARGET_REQUIRED');
  const tables=await db.$queryRawUnsafe('SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()');
  if(!tables.some(t=>t.table_name==='legacy_staging_batches')||!tables.some(t=>t.table_name==='legacy_staging_entities')||!tables.some(t=>t.table_name==='_prisma_migrations'))fail('STAGING_MIGRATION_REQUIRED');
  const migrations=await db.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations');
  if(!migrations.some(m=>m.migration_name==='202610280017_legacy_staging'&&m.finished_at&&!m.rolled_back_at)||migrations.some(m=>!m.finished_at&&!m.rolled_back_at))fail('STAGING_MIGRATION_REQUIRED');
  for(const t of tables){
    if(typeof t.table_name!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(t.table_name)&&t.table_name!=='_prisma_migrations'||t.table_type!=='BASE TABLE')fail('UNSUPPORTED_STAGING_SCHEMA');
    if(TOOL_TABLES.has(t.table_name))continue;
    if(t.table_name==='platform_configs'){
      // Migration018 alone seeds these exact display defaults. Select counts, never unknown config values.
      const defaults=await db.$queryRawUnsafe('SELECT COUNT(*) AS row_count,COALESCE(SUM(CASE WHEN (`isPublic` = 1 AND BINARY `type` = ? AND ((BINARY `key` = ? AND BINARY `value` = ? AND BINARY `description` = ?) OR (BINARY `key` = ? AND BINARY `value` = ? AND BINARY `description` = ?) OR (BINARY `key` = ? AND BINARY `value` = ? AND BINARY `description` = ?))) THEN 0 ELSE 1 END),0) AS invalid_count FROM platform_configs',
        'STRING','site_name','Massajoy','Site display name','support_email','','Public customer support email','support_phone','','Public customer support phone');
      const count=BigInt(defaults[0]?.row_count??-1),invalid=BigInt(defaults[0]?.invalid_count??-1);
      if(![0n,3n].includes(count)||invalid!==0n)fail('STAGING_DISPLAY_DEFAULTS_NOT_CANONICAL');
      continue;
    }
    // Only a guarded disposable schema is inspected. No business row or value is selected.
    const counts=await db.$queryRawUnsafe(`SELECT COUNT(*) AS row_count FROM \`${t.table_name}\``);
    if(BigInt(counts[0]?.row_count??-1)!==0n)fail('STAGING_BUSINESS_TABLE_NOT_EMPTY');
  }
  return name;
}
function payload(value){if(typeof value==='string'){try{return JSON.parse(value);}catch{return fail('STAGING_PAYLOAD_CORRUPT');}}return value;}
export async function reconcileStaging(db,plan){
  const batches=await db.$queryRawUnsafe('SELECT id,singleton,plan_digest,source_system,dataset_kind,summary FROM legacy_staging_batches');
  if(batches.length!==1)fail('STAGING_BATCH_MISMATCH');
  const b=batches[0];
  if(b.id!==plan.packageDigest||Number(b.singleton)!==1||b.plan_digest!==plan.planDigest||b.source_system!==plan.sourceSystem||b.dataset_kind!==plan.datasetKind||canonicalJson(payload(b.summary))!==canonicalJson(plan.reconciliation))fail('STAGING_BATCH_MISMATCH');
  const entities=await db.$queryRawUnsafe('SELECT id,batch_id,source_system,source_table,source_id,kind,shop_key,payload,payload_digest FROM legacy_staging_entities ORDER BY id ASC');
  if(entities.length!==plan.entities.length)fail('STAGING_ENTITY_COUNT_MISMATCH');
  const preserved=[];
  for(let i=0;i<entities.length;i++){
    const actual=entities[i],expected=plan.entities[i],data=payload(actual.payload);
    if(actual.id!==expected.id||actual.batch_id!==plan.packageDigest||actual.source_system!==expected.sourceSystem||actual.source_table!==expected.sourceTable||actual.source_id!==expected.sourceId||actual.kind!==expected.kind||(actual.shop_key??null)!==expected.shopKey||actual.payload_digest!==expected.payloadDigest||stagingHash(data)!==expected.payloadDigest||canonicalJson(data)!==canonicalJson(expected.payload))fail('STAGING_ENTITY_CONTENT_MISMATCH');
    preserved.push({kind:actual.kind,shopKey:actual.shop_key??null,payload:data});
  }
  const reconciliation=stagingReconciliation(preserved);
  if(canonicalJson(reconciliation)!==canonicalJson(plan.reconciliation))fail('STAGING_RECONCILIATION_FAILED');
  return {matched:true,entities:entities.length,reconciliation};
}
/** No live model calls. Single batch insert is the unique concurrency fence; all preserved entities commit atomically. */
export async function importLegacyStaging(db,input,options={}){
  if(options.acknowledgeStagingOnly!==true)fail('EXPLICIT_STAGING_ACK_REQUIRED');
  const {report,plan}=planLegacyStaging(input);
  if(!plan)fail('STAGING_PACKAGE_BLOCKED');
  if(options.expectedDigest!==plan.packageDigest)fail('EXPECTED_PACKAGE_DIGEST_REQUIRED');
  await guardStagingDatabase(db);
  const run=async tx=>{
    await guardStagingDatabase(tx);
    const previous=await tx.$queryRawUnsafe('SELECT id FROM legacy_staging_batches');
    if(previous.length){if(previous.length!==1||previous[0].id!==plan.packageDigest)fail('ANOTHER_STAGING_PACKAGE_EXISTS');return {replayed:true,...await reconcileStaging(tx,plan)};}
    const orphan=await tx.$queryRawUnsafe('SELECT COUNT(*) AS row_count FROM legacy_staging_entities');
    if(BigInt(orphan[0]?.row_count??-1)!==0n)fail('STAGING_ORPHAN_ENTITIES_PRESENT');
    await tx.$executeRawUnsafe('INSERT INTO legacy_staging_batches (id,singleton,plan_digest,source_system,dataset_kind,summary) VALUES (?,1,?,?,?,?)',plan.packageDigest,plan.planDigest,plan.sourceSystem,plan.datasetKind,canonicalJson(plan.reconciliation));
    for(const entity of plan.entities)await tx.$executeRawUnsafe('INSERT INTO legacy_staging_entities (id,batch_id,source_system,source_table,source_id,kind,shop_key,payload,payload_digest) VALUES (?,?,?,?,?,?,?,?,?)',entity.id,plan.packageDigest,entity.sourceSystem,entity.sourceTable,entity.sourceId,entity.kind,entity.shopKey,canonicalJson(entity.payload),entity.payloadDigest);
    return {replayed:false,...await reconcileStaging(tx,plan)};
  };
  let result;
  try{result=await db.$transaction(run,{isolationLevel:'ReadCommitted',maxWait:10000,timeout:120000});}
  catch(error){
    const duplicate=error?.code==='P2002'||error?.code==='P2010'&&String(error.meta?.code)==='1062';
    if(!duplicate)throw error;
    // Concurrent identical package: verify, never silently accept another package or partial content.
    result=await db.$transaction(async tx=>{await guardStagingDatabase(tx);return {replayed:true,...await reconcileStaging(tx,plan)};},{isolationLevel:'ReadCommitted',maxWait:10000,timeout:120000});
  }
  return {...report,mode:'disposable-staging-preservation',stagingImported:true,liveImported:false,replayed:result.replayed,verified:result.matched,reconciliation:result.reconciliation};
}
function readLocalJson(path,max=LIMIT){
  if(typeof path!=='string'||/^[a-z][a-z0-9+.-]*:\/\//i.test(path)||extname(path).toLowerCase()!=='.json')fail('LOCAL_JSON_REQUIRED');
  const target=resolve(path),stat=lstatSync(target);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max||realpathSync(target).toLowerCase()!==target.toLowerCase())fail('LOCAL_FILE_TYPE_OR_SIZE_INVALID');
  return JSON.parse(readFileSync(target,'utf8'));
}
export async function runCli(args=process.argv.slice(2)){
  const safeFailure=()=>({schemaVersion:2,tool:'massajoy-legacy-staging',error:{code:'STAGING_INVOCATION_OR_OPERATION_FAILED'},liveImported:false,deploymentReady:false});
  let db;
  try{
    if(args.length===1&&args[0]==='--help'){process.stdout.write('Usage: node scripts/legacy-staging.mjs package.json [--report new.json]\nApply only: --apply --database-url-file .local/task-target.json --expected-digest <sha256> --acknowledge-staging-only\nOffline dry-run by default. Independent empty mj2_legacy_staging_<8hex> local MySQL only. No live import.\n');return 0;}
    if(!args[0]||args[0].startsWith('-'))fail('CLI_ARGUMENTS_INVALID');
    const inputPath=args[0],options={};
    for(let i=1;i<args.length;i++){
      const key=args[i];if(Object.hasOwn(options,key))fail('CLI_ARGUMENTS_INVALID');
      if(['--apply','--acknowledge-staging-only'].includes(key))options[key]=true;
      else if(['--report','--database-url-file','--expected-digest'].includes(key)&&args[i+1]&&!args[i+1].startsWith('-'))options[key]=args[++i];else fail('CLI_ARGUMENTS_INVALID');
    }
    if(options['--report']&&(resolve(options['--report'])===resolve(inputPath)||extname(options['--report'])!=='.json'||/^[a-z][a-z0-9+.-]*:\/\//i.test(options['--report'])))fail('REPORT_PATH_INVALID');
    if(options['--report']){
      const reportPath=resolve(options['--report']);
      try{lstatSync(reportPath);fail('REPORT_ALREADY_EXISTS');}catch(error){if(error?.code!=='ENOENT')throw error;}
      if(realpathSync(dirname(reportPath)).toLowerCase()!==dirname(reportPath).toLowerCase())fail('REPORT_PATH_INVALID');
    }
    const input=readLocalJson(inputPath),{report,plan}=planLegacyStaging(input);let result=report;
    if(options['--apply']){
      if(!plan||!options['--acknowledge-staging-only']||options['--expected-digest']!==plan.packageDigest||!options['--database-url-file'])fail('EXPLICIT_APPLY_CONTRACT_REQUIRED');
      const configPath=resolve(options['--database-url-file']),localRoot=resolve(fileURLToPath(new URL('../.local/',import.meta.url))),location=relative(localRoot,configPath);
      if(!location||location==='..'||location.startsWith('..'+sep)||resolve(inputPath)===configPath)fail('TASK_LOCAL_DATABASE_FILE_REQUIRED');
      if(options['--report']&&resolve(options['--report'])===configPath)fail('REPORT_PATH_INVALID');
      const config=readLocalJson(configPath,16384);
      if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).length!==1||!Object.hasOwn(config,'databaseUrl'))fail('DATABASE_FILE_INVALID');
      const target=validateStagingUrl(config.databaseUrl);
      const require=createRequire(new URL('../backend/package.json',import.meta.url)),{PrismaClient}=require('@prisma/client');
      db=new PrismaClient({datasources:{db:{url:target.url}},log:[]});
      result=await importLegacyStaging(db,input,{acknowledgeStagingOnly:true,expectedDigest:plan.packageDigest});
    }else if(options['--database-url-file']||options['--expected-digest']||options['--acknowledge-staging-only'])fail('APPLY_FLAGS_WITHOUT_APPLY');
    const output=JSON.stringify(result,null,2)+'\n';
    if(options['--report'])writeFileSync(options['--report'],output,{flag:'wx',mode:0o600});
    process.stdout.write(output);return plan?0:2;
  }catch{
    // Never serialize Prisma, file, URL, raw JSON or driver errors: they may contain secrets/PII.
    process.stdout.write(JSON.stringify(safeFailure())+'\n');return 1;
  }finally{if(db)await db.$disconnect().catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))process.exitCode=await runCli();
