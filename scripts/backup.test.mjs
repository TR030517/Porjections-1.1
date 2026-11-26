import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {ROOT,MEDIA_SCRIPT,canonical,hash,validateConfig,validateTarget,repositoryMigrations,normalizeCreateTableCharset,captureSnapshot,captureAccountInvariants,validSnapshotGrant,validSnapshotCopy,validSnapshotProvision,verifyMediaAssets,requireStopped,requireMediaMount,requireRestoreDatabaseTarget,backupBundle,validateBundle,restoreBundle} from './backup-lib.mjs';
import * as backupDiagnostics from './backup-lib.mjs';

const config={schemaVersion:2,db:{container:'synthetic-db',database:'synthetic_source'},writers:['synthetic-api','synthetic-web'],media:{driver:'local',container:'synthetic-source',directory:'/app/media'}};
const target={schemaVersion:2,container:'synthetic-target',directory:'/app/media'};
const key='00000000-0000-0000-0000-000000000001.webp',bytes=Buffer.from('synthetic sanitized object'),file={key,bytes:bytes.length,sha256:hash(bytes)};
const json=rows=>rows.map(row=>JSON.stringify(row)).join('\n');
async function fixture({migrationCount=18,media=true,mutateAfterDump=false,failImport=false,migrationFlags=[true,false],restoredDdl='same'}={}){
 const repo=await repositoryMigrations(),calls=[],state={dumped:false,created:false,account:false,targetFiles:[],writes:0};
 const asset={id:key.slice(0,-5),status:'BOUND',driver:'local',namespace:'a'.repeat(64),...file};
 const tables=media?['_prisma_migrations','users','media_assets']:['_prisma_migrations','users'];
 const adapter={
  async inspect(container){if(config.writers.includes(container))return{running:false,mounts:[]};return{running:true,composeProject:'massajoy2-phase5-a1b2c3d4',composeService:'db',mounts:[{Destination:'/app/media',Type:'volume',Name:container===target.container?'synthetic-target-vol':'synthetic-source-vol',Source:container===target.container?'/vol-target':'/vol-source',RW:container===target.container}]};},
  async query(sql,options={}){
   calls.push({sql,database:options.database,restricted:!!options.restricted});
   if(sql.startsWith('CREATE DATABASE')){state.created=true;return'';}if(sql.startsWith('CREATE USER')){state.account=true;return'';}if(sql.startsWith('GRANT '))return'';if(sql.startsWith('DROP USER')){state.account=false;return'';}
   if(sql.includes('FROM information_schema.tables'))return json(tables.map(name=>[name,'BASE TABLE','InnoDB']));
   if(sql.includes('information_schema.routines'))return'0';
   if(sql.includes('SELECT JSON_ARRAY(migration_name'))return json(repo.slice(0,migrationCount).map(row=>[row.name,row.sha256,...migrationFlags]));
   if(sql.includes('FROM information_schema.columns'))return json([['id','bigint','NO',null,'',null,'',null],['payload','varchar(20)','YES',null,'','utf8mb4_unicode_ci','','utf8mb4'],['isPublic','tinyint(1)','NO','0','',null,'',null]]);
   if(sql.startsWith('SHOW CREATE TABLE'))return sql+' (`payload` varchar(20) '+(options.restricted&&restoredDdl==='redundant-charset'?'CHARACTER SET utf8mb4 ':'')+'COLLATE '+(options.restricted&&restoredDdl==='different-collation'?'utf8mb4_bin':'utf8mb4_unicode_ci')+') DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
   if(sql.startsWith('SELECT COUNT(*) FROM `'))return'1';
   if(sql.startsWith('SELECT SHA2'))return hash(sql+(mutateAfterDump&&state.dumped&&!options.restricted?'changed':''));
   if(sql.includes('information_schema.key_column_usage'))return'';
   if(sql.startsWith('SELECT JSON_ARRAY(id,status'))return media?json([[asset.id,asset.status,asset.driver,asset.namespace,asset.key,asset.sha256,asset.bytes]]):'';
   if(sql.includes('MANAGED_'))throw Error('Unexpected SQL');
   if(sql.startsWith('SELECT COUNT(*) FROM users u LEFT JOIN media_assets')||sql.startsWith('SELECT COUNT(*) FROM shops s JOIN JSON_TABLE'))return'0';
   throw Error('Unexpected synthetic SQL');
  },
  async dump(path){await fs.writeFile(path,gzipSync('SYNTHETIC SQL ONLY'),{flag:'wx',mode:0o600});state.dumped=true;},
  async import(){if(failImport)throw Error('Synthetic import failure');},
  async mediaList(mediaConfig){return mediaConfig.container===target.container?structuredClone(state.targetFiles):media?[file]:[];},
  async mediaRead(_media,_key,path){await fs.writeFile(path,bytes,{flag:'wx',mode:0o600});},
  async mediaWrite(_target,_key,path){state.writes++;assert.deepEqual(await fs.readFile(path),bytes);state.targetFiles.push({...file});},
 };
 return{adapter,state,calls,asset};
}
async function withBundle(work,options={}){
 const path=join(ROOT,'.local/backups/phase5-unit-'+randomBytes(6).toString('hex')),f=await fixture(options);
 try{const c=options.media===false?{...config,media:{driver:'none'}}:config;const result=await backupBundle(c,{adapter:f.adapter,directory:path,acknowledged:true});await work({path,f,c,result});}finally{await fs.rm(path,{recursive:true,force:true});await fs.rm(path+'.partial',{recursive:true,force:true});}
}

test('backup publication failure preserves its first filesystem code and protected partial without publishing',async t=>{
 const path=join(ROOT,'.local/backups/phase5-unit-'+randomBytes(6).toString('hex')),f=await fixture(),rename=fs.rename;
 const injected=Object.assign(Error('Synthetic private source path and password must not be public'),{code:'EPERM',path:'SYNTHETIC_PRIVATE_SOURCE',dest:'SYNTHETIC_PRIVATE_DESTINATION'});
 t.mock.method(fs,'rename',async(from,to)=>{if(to===path)throw injected;return rename(from,to);});
 try{
  await assert.rejects(backupBundle(config,{adapter:f.adapter,directory:path,acknowledged:true}),error=>{
   assert.equal(error.message,'BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED');assert.equal(error.stage,'BUNDLE_PUBLISH');assert.equal(error.causeCode,'EPERM');
   assert.equal(Object.hasOwn(error,'cause'),false);assert.doesNotMatch(JSON.stringify(error),/password|SYNTHETIC_PRIVATE|source path/);return true;
  });
  await assert.rejects(fs.access(path));assert.equal((await fs.stat(path+'.partial')).isDirectory(),true);
  await assert.rejects(validateBundle(path+'.partial'),/BUNDLE_MUST_BE_COMPLETE/);
 }finally{t.mock.restoreAll();await fs.rm(path+'.partial',{recursive:true,force:true});}
});

test('backup diagnostics distinguish dump and media failures without leaking unknown adapter errors',async()=>{
 for(const[method,stage]of[['dump','DATABASE_DUMP'],['mediaRead','MEDIA_COPY']]){
  const path=join(ROOT,'.local/backups/phase5-unit-'+randomBytes(6).toString('hex')),f=await fixture();
  f.adapter[method]=async()=>{throw Object.assign(Error('<html>SYNTHETIC_PRIVATE_PASSWORD</html>'),{code:'SYNTHETIC_PRIVATE_TOKEN',path:'SYNTHETIC_PRIVATE_PATH'});};
  try{
   await assert.rejects(backupBundle(config,{adapter:f.adapter,directory:path,acknowledged:true}),error=>{
    assert.equal(error.message,'BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED');assert.equal(error.stage,stage);assert.equal(error.causeCode,'UNKNOWN_BACKUP_FAILURE');
    assert.doesNotMatch(JSON.stringify(error),/SYNTHETIC_PRIVATE|html/);return true;
   });
   await assert.rejects(fs.access(path));assert.equal((await fs.stat(path+'.partial')).isDirectory(),true);
  }finally{await fs.rm(path+'.partial',{recursive:true,force:true});}
 }
});

test('backup source drift keeps the deliberate invariant failure distinct from filesystem publication failure',async()=>{
 const path=join(ROOT,'.local/backups/phase5-unit-'+randomBytes(6).toString('hex')),f=await fixture({mutateAfterDump:true});
 try{
  await assert.rejects(backupBundle(config,{adapter:f.adapter,directory:path,acknowledged:true}),error=>{
   assert.equal(error.message,'BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED');assert.equal(error.stage,'SOURCE_RECHECK');assert.equal(error.causeCode,'SOURCE_CHANGED_DURING_BACKUP');return true;
  });
  await assert.rejects(fs.access(path));assert.equal((await fs.stat(path+'.partial')).isDirectory(),true);
 }finally{await fs.rm(path+'.partial',{recursive:true,force:true});}
});

test('backup CLI diagnostic projection emits only fixed codes and never serializes raw causes',async()=>{
 assert.equal(typeof backupDiagnostics.backupErrorDetails,'function');
 const path=join(ROOT,'.local/backups/phase5-unit-'+randomBytes(6).toString('hex')),f=await fixture();
 f.adapter.dump=async()=>{throw Object.assign(Error('LOCAL_CONTAINER_STREAM_FAILED'),{cause:Error('SYNTHETIC_PRIVATE_NESTED_SQL')});};
 try{
  await assert.rejects(backupBundle(config,{adapter:f.adapter,directory:path,acknowledged:true}),error=>{
   assert.deepEqual(backupDiagnostics.backupErrorDetails(error),{code:'BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED',stage:'DATABASE_DUMP',causeCode:'LOCAL_CONTAINER_STREAM_FAILED'});return true;
  });
  assert.deepEqual(backupDiagnostics.backupErrorDetails(Object.assign(Error('SYNTHETIC_PRIVATE_PASSWORD'),{stage:'DATABASE_DUMP',causeCode:'EPERM'})),{code:'BACKUP_INVOCATION_OR_OPERATION_FAILED'});
  assert.deepEqual(backupDiagnostics.backupErrorDetails(Object.assign(Error('BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED'),{stage:'SYNTHETIC_PRIVATE_STAGE',causeCode:'SYNTHETIC_PRIVATE_CODE'})),{code:'BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED'});
 }finally{await fs.rm(path+'.partial',{recursive:true,force:true});}
});

test('task config rejects system schemas, executable/container paths, credentials and unsupported S3',()=>{
 assert.equal(validateConfig(structuredClone(config)).db.database,'synthetic_source');
 assert.equal(validateTarget(structuredClone(target)).container,target.container);
 for(const change of [c=>c.db.database='mysql',c=>c.db.container='db; unsafe',c=>c.db.password='must-not-be-read',c=>c.media.directory='/app/../data',c=>c.media.driver='s3',c=>c.writers.push(c.db.container)]){const c=structuredClone(config);change(c);assert.throws(()=>validateConfig(c));}
});
test('listed writers must actually be stopped and source helper mount must be read-only',async()=>{
 await assert.rejects(requireStopped(config,{inspect:async()=>({running:true})}),/WRITERS_MUST_BE_STOPPED/);
 await assert.rejects(requireMediaMount(config.media,{inspect:async()=>({running:true,mounts:[{Destination:'/app/media',Type:'volume',Name:'x',RW:true}]})}),/READONLY/);
 const a=await requireMediaMount(config.media,{inspect:async()=>({running:true,mounts:[{Destination:'/app/media',Type:'volume',Name:'x',Source:'/x',RW:false}]})});
 const b=await requireMediaMount({container:'other',directory:'/different'}, {inspect:async()=>({running:true,mounts:[{Destination:'/different',Type:'volume',Name:'x',Source:'/x',RW:true}]})},true);
 assert.equal(a.identity,b.identity,'same volume remains the same target even with a different mount path');
});
test('restore database target is an explicitly labelled isolated phase5 DB, never the existing local stack',async()=>{
 await assert.rejects(requireRestoreDatabaseTarget('massajoy2-local-db-1',{inspect:async()=>({running:true,composeProject:'massajoy2-local',composeService:'db'})}),/ISOLATED_PHASE5/);
 await assert.rejects(requireRestoreDatabaseTarget('phase5-api',{inspect:async()=>({running:true,composeProject:'massajoy2-phase5-a1b2c3d4',composeService:'api'})}),/ISOLATED_PHASE5/);
 assert.equal((await requireRestoreDatabaseTarget(config.db.container,(await fixture()).adapter)).project,'massajoy2-phase5-a1b2c3d4');
});
for(const count of[8,18,22,23])test(`actual ${count}-migration schema is captured dynamically without requiring later tables`,async()=>{
 const f=await fixture({migrationCount:count,media:count>=18});const snapshot=await captureSnapshot(f.adapter,{database:config.db.database});
 assert.equal(snapshot.migrations.length,count);assert.equal(snapshot.tables.length,count>=18?3:2);assert.ok(snapshot.tables.every(row=>row.structureDigest.length===64&&row.rowDigest.length===64));assert.ok(f.calls.some(row=>row.sql.includes('OCTET_LENGTH')&&row.sql.includes('`isPublic`')));
});
test('MySQL JSON boolean migration completion flags are accepted, unfinished or rolled-back flags rejected',async()=>{
 for(const flags of[[true,false],[1,0]]){const f=await fixture({migrationFlags:flags});assert.equal((await captureSnapshot(f.adapter,{database:config.db.database})).migrations.length,18);}
 for(const flags of[[false,false],[true,true],[0,0],[1,1],['true','false']]){const f=await fixture({migrationFlags:flags});await assert.rejects(captureSnapshot(f.adapter,{database:config.db.database}),/APPLIED_MIGRATIONS_DO_NOT_MATCH/);}
});
test('DDL canonicalization removes only redundant unquoted column charset, preserving strings and real structure',()=>{
 const source="CREATE TABLE `x` (`text` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci' COMMENT 'escaped\\\' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci') DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
 const redundant=source.replace('varchar(100) COLLATE','varchar(100) CHARACTER SET utf8mb4 COLLATE');assert.equal(normalizeCreateTableCharset(redundant),source);
 assert.equal(normalizeCreateTableCharset("'double'' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'"),"'double'' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'");
 for(const changed of[source.replace("DEFAULT '","DEFAULT 'changed "),source.replace('unicode_ci','bin'),source.replace('DEFAULT CHARSET=utf8mb4','DEFAULT CHARSET=latin1'),source+' KEY `ix` (`text`)',source+' CONSTRAINT `fk` FOREIGN KEY (`text`) REFERENCES `other` (`text`)'])assert.notEqual(normalizeCreateTableCharset(changed),normalizeCreateTableCharset(source));
});
test('restore accepts equivalent SHOW CREATE charset rendering but refuses a real collation change',async()=>{
 await withBundle(async({path,result,f})=>{const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});assert.equal(restored.passed,true);},{restoredDdl:'redundant-charset'});
 await withBundle(async({path,result,f})=>{const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});assert.equal(restored.passed,false);assert.equal(restored.error.code,'RESTORED_DATABASE_CONTENT_MISMATCH');assert.equal(restored.sourceUnchanged,true);assert.equal(f.state.writes,0);},{restoredDdl:'different-collation'});
});
test('managed files require byte/hash correspondence, no orphan or in-flight asset, and a local store',()=>{
 const asset={status:'BOUND',driver:'local',...file},snapshot={media:[asset]};verifyMediaAssets(snapshot,[file],'local');
 for(const files of[[],[{...file,sha256:'0'.repeat(64)}],[{...file,key:key.replace('0001.webp','0002.webp')}],[file,file]])assert.throws(()=>verifyMediaAssets(snapshot,files,'local'));
 assert.throws(()=>verifyMediaAssets(snapshot,[],'none'),/STORAGE_REQUIRED/);assert.throws(()=>verifyMediaAssets({media:[{...asset,driver:'s3'}]},[file],'local'),/MIXED/);
});

test('snapshot includes price-menu images in shop media reference validation', async () => {
 const {adapter}=await fixture();
 const query=adapter.query;
 let brokenReferences='0';
 adapter.query=async(sql,options)=>{
  if(!sql.startsWith('SELECT COUNT(*) FROM shops s JOIN JSON_TABLE'))return query(sql,options);
  assert.ok(sql.includes("'$.priceMenu[*].items[*].imageUrl'"));
  return brokenReferences;
 };
 assert.equal((await captureSnapshot(adapter,{database:config.db.database})).invariants.mediaReferenceErrors,0);
 brokenReferences='1';
 await assert.rejects(captureSnapshot(adapter,{database:config.db.database}),/MANAGED_SHOP_REFERENCE_INVALID/);
});
test('local media helper scans exact bytes and rejects unmanifested filenames without Docker',async()=>{
 const path=join(ROOT,'.local/backups/phase5-helper-unit-'+randomBytes(6).toString('hex'));await fs.mkdir(path,{recursive:true});
 try{await fs.writeFile(join(path,key),bytes);let result=spawnSync(process.execPath,['-e',MEDIA_SCRIPT,'list',path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),[file]);await fs.writeFile(join(path,'unexpected.txt'),'synthetic');result=spawnSync(process.execPath,['-e',MEDIA_SCRIPT,'list',path],{encoding:'utf8'});assert.notEqual(result.status,0);}finally{await fs.rm(path,{recursive:true,force:true});}
});
test('backup is explicit, keeps DB+media together and validates bundle bytes offline',async()=>{
 const f=await fixture();await assert.rejects(backupBundle(config,{adapter:f.adapter}),/ACK_REQUIRED/);assert.equal(f.calls.length,0);
 await withBundle(async({path,result})=>{const valid=await validateBundle(path,result.bundleDigest);assert.equal(valid.manifest.media.files.length,1);assert.equal(valid.manifest.snapshot.migrations.length,18);assert.equal(result.deploymentReady,false);assert.equal(result.mediaFiles,1);});
});
test('source change during backup rejects completion and retains only protected partial',async()=>{
 const path=join(ROOT,'.local/backups/phase5-unit-'+randomBytes(6).toString('hex')),f=await fixture({mutateAfterDump:true});
 try{await assert.rejects(backupBundle(config,{adapter:f.adapter,directory:path,acknowledged:true}),/BACKUP_INCOMPLETE/);await assert.rejects(fs.access(path));assert.equal((await fs.stat(path+'.partial')).isDirectory(),true);}finally{await fs.rm(path+'.partial',{recursive:true,force:true});}
});
test('dump and media tampering fail offline before any restore adapter call',async()=>{
 await withBundle(async({path,result,f})=>{await fs.appendFile(join(path,'database.sql.gz'),'tamper');await assert.rejects(restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true}),/DATABASE_DIGEST_MISMATCH/);assert.equal(f.state.created,false);});
 await withBundle(async({path,result,f})=>{await fs.appendFile(join(path,'media',key),'tamper');await assert.rejects(restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true}),/MEDIA_DIGEST_MISMATCH/);assert.equal(f.state.created,false);});
});
test('restore needs trusted digest, exact source and new empty distinct media target',async()=>{
 await withBundle(async({path,result,f})=>{
  await assert.rejects(restoreBundle(config,path,{adapter:f.adapter,target,acknowledged:true}),/DIGEST_REQUIRED/);
  f.state.targetFiles=[file];await assert.rejects(restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true}),/TARGET_MUST_BE_EMPTY/);assert.equal(f.state.created,false);
 });
});
test('new-target restore validates all rows/structure/media and drops only its temporary account',async()=>{
 await withBundle(async({path,result,f})=>{
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});assert.equal(restored.passed,true);assert.equal(restored.sourceUnchanged,true);assert.equal(restored.temporaryAccountRemoved,true);assert.match(restored.database,/^mj2_restore_[a-f0-9]{8}$/);assert.equal(f.state.writes,1);assert.ok(f.calls.some(row=>row.restricted));assert.ok(!f.calls.some(row=>/DROP DATABASE|DELETE FROM|UPDATE /.test(row.sql)));assert.equal(f.state.account,false);
 });
});
test('restore import failure retains isolated targets, removes temporary account and verifies source',async()=>{
 await withBundle(async({path,result,f})=>{const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});assert.equal(restored.passed,false);assert.equal(restored.sourceUnchanged,true);assert.equal(restored.databaseCreated,true);assert.equal(restored.temporaryAccountRemoved,true);assert.equal(f.state.account,false);assert.equal(f.state.writes,0);},{failImport:true});
});

test('restore diagnostics keep an explicit three-key null shape after success',async()=>{
 await withBundle(async({path,result,f})=>{
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,true);assert.equal(Object.hasOwn(restored,'error'),false);assert.equal(restored.temporaryAccountRemoved,true);assert.equal(restored.sourceUnchanged,true);
  assert.deepEqual(restored.diagnostics,{operationErrorCode:null,accountCleanupErrorCode:null,sourceVerificationErrorCode:null});
 });
});

test('restore diagnostics sanitize unknown operation errors and hostile message getters',async()=>{
 for(const hostileGetter of [false,true])await withBundle(async({path,result,f})=>{
  let password;
  f.adapter.import=async(_path,_database,restricted)=>{password=restricted.password;if(hostileGetter)throw{get message(){throw Error('SYNTHETIC_PRIVATE_GETTER_SQL');}};throw Object.assign(Error('SELECT SYNTHETIC_PRIVATE_SQL; password='+password),{path:'SYNTHETIC_PRIVATE_PATH',cause:Error('SYNTHETIC_PRIVATE_CAUSE')});};
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.deepEqual(restored.error,{code:'NEW_TARGET_RESTORE_FAILED'});assert.equal(restored.temporaryAccountRemoved,true);assert.equal(restored.sourceUnchanged,true);assert.equal(f.state.account,false);
  assert.deepEqual(restored.diagnostics,{operationErrorCode:'NEW_TARGET_RESTORE_FAILED',accountCleanupErrorCode:null,sourceVerificationErrorCode:null});
  assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_PRIVATE|SELECT |password=/);assert.equal(JSON.stringify(restored).includes(password),false);
 });
});

test('restore diagnostics preserve an allowlisted operation code without reclassifying it',async()=>{
 await withBundle(async({path,result,f})=>{
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.deepEqual(restored.error,{code:'RESTORED_DATABASE_CONTENT_MISMATCH'});assert.equal(restored.temporaryAccountRemoved,true);assert.equal(restored.sourceUnchanged,true);assert.equal(f.state.writes,0);
  assert.deepEqual(restored.diagnostics,{operationErrorCode:'RESTORED_DATABASE_CONTENT_MISMATCH',accountCleanupErrorCode:null,sourceVerificationErrorCode:null});
 },{restoredDdl:'different-collation'});
});

test('restore diagnostics retain simultaneous operation cleanup and source failures under legacy top priority',async()=>{
 await withBundle(async({path,result,f})=>{
  const query=f.adapter.query,inspect=f.adapter.inspect;let failedImport=false,drops=0;
  f.adapter.import=async()=>{failedImport=true;throw Error('SYNTHETIC_PRIVATE_IMPORT_SQL');};
  f.adapter.query=async(sql,options)=>{if(sql.startsWith('DROP USER')){drops++;throw Error('SYNTHETIC_PRIVATE_DROP_PASSWORD');}return query(sql,options);};
  f.adapter.inspect=async container=>failedImport&&config.writers.includes(container)?{running:true}:inspect(container);
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.deepEqual(restored.error,{code:'SOURCE_UNCHANGED_VERIFICATION_FAILED'});assert.equal(restored.databaseCreated,true);assert.equal(restored.temporaryAccountRemoved,false);assert.equal(restored.sourceUnchanged,false);assert.equal(drops,1);assert.equal(f.state.account,true);
  assert.deepEqual(restored.diagnostics,{operationErrorCode:'NEW_TARGET_RESTORE_FAILED',accountCleanupErrorCode:'TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED',sourceVerificationErrorCode:'SOURCE_UNCHANGED_VERIFICATION_FAILED'});
  assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_PRIVATE|SQL|PASSWORD/);
 });
});

test('restore diagnostics report cleanup failure after a matching import without inventing an operation failure',async()=>{
 await withBundle(async({path,result,f})=>{
  const query=f.adapter.query;
  f.adapter.query=async(sql,options)=>{if(sql.startsWith('DROP USER'))throw Error('SYNTHETIC_PRIVATE_DROP_AFTER_SUCCESS');return query(sql,options);};
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.deepEqual(restored.error,{code:'TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED'});assert.equal(restored.rowsAndStructureMatch,true);assert.equal(restored.mediaBytesMatch,true);assert.equal(restored.temporaryAccountRemoved,false);assert.equal(restored.sourceUnchanged,true);
  assert.deepEqual(restored.diagnostics,{operationErrorCode:null,accountCleanupErrorCode:'TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED',sourceVerificationErrorCode:null});
  assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_PRIVATE/);
 });
});

test('restore diagnostics report resumed source writers after success without losing confirmed account cleanup',async()=>{
 await withBundle(async({path,result,f})=>{
  const query=f.adapter.query,inspect=f.adapter.inspect;let afterDrop=false;
  f.adapter.query=async(sql,options)=>{const answer=await query(sql,options);if(sql.startsWith('DROP USER'))afterDrop=true;return answer;};
  f.adapter.inspect=async container=>afterDrop&&config.writers.includes(container)?{running:true}:inspect(container);
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.deepEqual(restored.error,{code:'SOURCE_UNCHANGED_VERIFICATION_FAILED'});assert.equal(restored.rowsAndStructureMatch,true);assert.equal(restored.temporaryAccountRemoved,true);assert.equal(restored.sourceUnchanged,false);assert.equal(f.state.account,false);
  assert.deepEqual(restored.diagnostics,{operationErrorCode:null,accountCleanupErrorCode:null,sourceVerificationErrorCode:'SOURCE_UNCHANGED_VERIFICATION_FAILED'});
 });
});

test('lost CREATE USER response verifies its exact restricted identity before cleanup',async()=>{
 await withBundle(async({path,result,f})=>{
  const query=f.adapter.query;let attempted,probes=0,drops=0;
  f.adapter.query=async(sql,options)=>{
   if(sql.startsWith('CREATE USER')){const match=/^CREATE USER '([^']+)'@'localhost' IDENTIFIED BY '([^']+)'/.exec(sql);assert(match);attempted={user:match[1],password:match[2]};await query(sql,options);throw Error('SYNTHETIC_PRIVATE_LOST_RESPONSE');}
   if(sql==='SELECT CURRENT_USER();'){probes++;assert.equal(options.database,'information_schema');assert.deepEqual(options.restricted,attempted);return attempted.user+'@localhost';}
   if(sql.startsWith('DROP USER')){drops++;assert.equal(sql,"DROP USER IF EXISTS '"+attempted.user+"'@'localhost';");}
   return query(sql,options);
  };
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.equal(restored.error.code,'NEW_TARGET_RESTORE_FAILED');assert.equal(restored.temporaryAccountRemoved,true);assert.equal(restored.sourceUnchanged,true);assert.equal(f.state.account,false);assert.equal(probes,1);assert.equal(drops,1);assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_PRIVATE|password|mj2_restore_.*@localhost/);
 });
});

for(const identity of ['probe-refused','foreign-user'])test(`unknown CREATE USER result never deletes an unverified account (${identity})`,async()=>{
 await withBundle(async({path,result,f})=>{
  const query=f.adapter.query;let probes=0,drops=0;
  f.adapter.query=async(sql,options)=>{
   if(sql.startsWith('CREATE USER'))throw Error('SYNTHETIC_PRIVATE_EXISTING_ACCOUNT_OR_LOST_REPLY');
   if(sql==='SELECT CURRENT_USER();'){probes++;assert.equal(options.database,'information_schema');assert(options.restricted);if(identity==='probe-refused')throw Error('SYNTHETIC_PRIVATE_AUTH_REFUSED');return'foreign-account@localhost';}
   if(sql.startsWith('DROP USER'))drops++;
   return query(sql,options);
  };
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.equal(restored.error.code,'TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED');assert.equal(restored.temporaryAccountRemoved,false);assert.equal(restored.sourceUnchanged,true);assert.equal(probes,1);assert.equal(drops,0);assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_PRIVATE|foreign-account|password/);
  assert.deepEqual(restored.diagnostics,{operationErrorCode:'NEW_TARGET_RESTORE_FAILED',accountCleanupErrorCode:'TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED',sourceVerificationErrorCode:null});
 });
});

for(const response of ['rejected','lost-after-delete'])test(`verified temporary account DROP failure stays explicit (${response})`,async()=>{
 await withBundle(async({path,result,f})=>{
  const query=f.adapter.query;let drops=0;
  f.adapter.query=async(sql,options)=>{if(sql.startsWith('DROP USER')){drops++;if(response==='lost-after-delete')await query(sql,options);throw Error('SYNTHETIC_PRIVATE_DROP_FAILURE');}return query(sql,options);};
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.equal(restored.error.code,'TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED');assert.equal(restored.temporaryAccountRemoved,false);assert.equal(restored.sourceUnchanged,true);assert.equal(f.state.account,response!=='lost-after-delete');assert.equal(drops,1);assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_PRIVATE|password/);
 });
});

test('restore failure before CREATE USER does not probe or delete an unattempted account',async()=>{
 await withBundle(async({path,result,f})=>{
  const query=f.adapter.query;let accountCalls=0;
  f.adapter.query=async(sql,options)=>{if(sql.startsWith('CREATE DATABASE'))throw Error('SYNTHETIC_PRIVATE_DATABASE_REFUSAL');if(sql.startsWith('CREATE USER')||sql.startsWith('DROP USER')||sql==='SELECT CURRENT_USER();')accountCalls++;return query(sql,options);};
  const restored=await restoreBundle(config,path,{adapter:f.adapter,target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,false);assert.equal(restored.error.code,'NEW_TARGET_RESTORE_FAILED');assert.equal(restored.databaseCreated,false);assert.equal(restored.temporaryAccountRemoved,true);assert.equal(restored.sourceUnchanged,true);assert.equal(accountCalls,0);assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_PRIVATE|password/);
  assert.deepEqual(restored.diagnostics,{operationErrorCode:'NEW_TARGET_RESTORE_FAILED',accountCleanupErrorCode:null,sourceVerificationErrorCode:null});
 });
});
test('cross-server clone uses only the destination adapter for CREATE/import/account cleanup',async()=>{
 await withBundle(async({path,result,f})=>{
  const destination=await fixture(),restored=await restoreBundle(config,path,{adapter:f.adapter,targetAdapter:destination.adapter,targetDbContainer:'isolated-target-db',target,expectedDigest:result.bundleDigest,acknowledged:true});
  assert.equal(restored.passed,true);assert.equal(f.state.created,false);assert.equal(destination.state.created,true);assert.ok(!f.calls.some(row=>/CREATE DATABASE|CREATE USER|GRANT |DROP USER/.test(row.sql)));assert.ok(destination.calls.filter(row=>/CREATE DATABASE|CREATE USER|GRANT |DROP USER/.test(row.sql)).every(row=>row.database==='information_schema'));
 });
});
test('old eight-migration no-media bundle restores without inventing a media volume',async()=>{
 await withBundle(async({path,result,f,c})=>{const restored=await restoreBundle(c,path,{adapter:f.adapter,expectedDigest:result.bundleDigest,acknowledged:true});assert.equal(restored.passed,true);assert.equal(restored.migrations,8);assert.equal(restored.mediaFiles,0);},{migrationCount:8,media:false});
});
test('default backup CLI is offline and legacy env invocation is refused without reading it',()=>{
 const result=spawnSync(process.execPath,[join(ROOT,'scripts/backup.mjs')],{encoding:'utf8'});assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).databaseAccessed,false);
 const refused=spawnSync(process.execPath,[join(ROOT,'scripts/backup.mjs'),'.env.release','--acknowledge-business-data'],{encoding:'utf8'});assert.equal(refused.status,1);assert.doesNotMatch(refused.stderr,/password|token|\.env.release/i);
});

const operationId='11111111-1111-4111-8111-111111111111';
const copyRow=()=>[operationId,'1','2','3','HOURS','copy-history-key','a'.repeat(64),{operationId,status:'APPLIED',kind:'HOURS',created:0,skipped:0,sourceShopId:'2',targetShopId:'3'}];
const menuCopyRow=()=>{const row=copyRow();row[4]='PRICE_MENU';row[7]={...row[7],kind:'PRICE_MENU',created:1,groups:1,omittedManagedImages:0};return row;};
const provisionRow=()=>[operationId,'1','2','4','provision-history-key','b'.repeat(64),'APPLIED'];
test('grant snapshots preserve revoked empty permissions and reject malformed or escalating permission sets',()=>{
 assert.equal(validSnapshotGrant(['2','3','ACTIVE',['BOOKINGS_READ','SETTLEMENT_RECORD']]),true);
 assert.equal(validSnapshotGrant(['2','3','REVOKED',[]]),true);
 assert.equal(validSnapshotGrant(['2','3','REVOKED',['CATALOG_MANAGE','COPY_CONFIG']]),true);
 for(const row of [['2','2','ACTIVE',['BOOKINGS_READ']],['2','3','ACTIVE',[]],['2','3','ACTIVE',['BOOKINGS_READ','BOOKINGS_READ']],['2','3','ACTIVE',['bookings_read']],['2','3','ACTIVE',['SETTLEMENT_RECORD']],['2','3','ACTIVE',['COPY_CONFIG']],['2','3','ACTIVE',{BOOKINGS_READ:true}],['2','3','OTHER',['BOOKINGS_READ']]])assert.equal(validSnapshotGrant(row),false);
});
test('copy APPLIED result must bind every immutable ID and kind to its columns, with a valid request hash',()=>{
 assert.equal(validSnapshotCopy(copyRow()),true);
 for(const [key,value] of [['operationId','22222222-2222-4222-8222-222222222222'],['sourceShopId','99'],['targetShopId','99'],['kind','CATALOG'],['status','PENDING'],['created',-1],['skipped','0']]){const row=copyRow();row[7][key]=value;assert.equal(validSnapshotCopy(row),false);}
 const hashMismatch=copyRow();hashMismatch[6]='malformed';assert.equal(validSnapshotCopy(hashMismatch),false);
 const selfCopy=copyRow();selfCopy[3]='2';selfCopy[7].targetShopId='2';assert.equal(validSnapshotCopy(selfCopy),false);
});
test('display-menu copy receipts preserve item counts and require bounded groups, omitted images and zero skips',()=>{
 assert.equal(validSnapshotCopy(menuCopyRow()),true);
 const empty=menuCopyRow();Object.assign(empty[7],{created:0,groups:0});assert.equal(validSnapshotCopy(empty),true);
 const maximum=menuCopyRow();Object.assign(maximum[7],{created:1000,groups:100,omittedManagedImages:1000});assert.equal(validSnapshotCopy(maximum),true);
 for(const [key,value] of [['created',-1],['created',1001],['created',1.5],['skipped',1],['skipped','0'],['groups',undefined],['groups',-1],['groups',101],['groups','1'],['groups',1.5],['omittedManagedImages',undefined],['omittedManagedImages',-1],['omittedManagedImages',2],['omittedManagedImages','0'],['omittedManagedImages',0.5],['kind','CATALOG'],['operationId','22222222-2222-4222-8222-222222222222'],['sourceShopId','99'],['targetShopId','99'],['status','PENDING']]){
  const row=menuCopyRow();row[7][key]=value;assert.equal(validSnapshotCopy(row),false,`${key}=${value}`);
 }
 const unknown=menuCopyRow();unknown[4]='OTHER';unknown[7].kind='OTHER';assert.equal(validSnapshotCopy(unknown),false);
});
const addOnCopyRow=()=>{const row=copyRow();row[4]='ADD_ONS';Object.assign(row[7],{kind:'ADD_ONS',created:1,skipped:2});return row;};
test('add-on copy snapshot receipts preserve zero and bounded create/skip counts without extending old kinds',()=>{
 assert.equal(validSnapshotCopy(addOnCopyRow()),true);
 for(const [created,skipped] of [[0,0],[0,500],[500,0],[250,250]]){const row=addOnCopyRow();Object.assign(row[7],{created,skipped});assert.equal(validSnapshotCopy(row),true);}
 for(const [key,value] of [['created',501],['created',-1],['created',1.5],['created','1'],['skipped',500],['skipped',-1],['skipped','0'],['kind','CATALOG'],['sourceShopId','99'],['status','UNKNOWN'],['isActive',true],['groups',1]]){const row=addOnCopyRow();row[7][key]=value;assert.equal(validSnapshotCopy(row),false,`${key}=${value}`);}
 assert.equal(validSnapshotCopy(copyRow()),true);assert.equal(validSnapshotCopy(menuCopyRow()),true);
});
test('provision history accepts successful creation and credential-save states with nullable-contact account IDs',()=>{
 assert.equal(validSnapshotProvision(provisionRow()),true);
 const credentials=provisionRow();credentials[6]='CREDENTIALS_APPLIED';assert.equal(validSnapshotProvision(credentials),true);
 const dottedKey=provisionRow();dottedKey[4]='provision.history:key';assert.equal(validSnapshotProvision(dottedKey),true);
 for(const [index,value] of [[0,'not-uuid'],[1,'0'],[4,'short'],[5,'not-hash'],[6,'PENDING'],[6,'FAILED']]){const row=provisionRow();row[index]=value;assert.equal(validSnapshotProvision(row),false);}
});
function accountMetadataFixture(overrides={}){
 const values={SNAPSHOT_ACCOUNT_BINDINGS:'0',SNAPSHOT_ACCOUNT_GRANT_REFERENCES:'0',SNAPSHOT_ACCOUNT_GRANTS:json([['2','3','ACTIVE',['BOOKINGS_READ']],['3','2','REVOKED',[]]]),SNAPSHOT_AUTH_IDENTITY_COLLATION:'2',SNAPSHOT_AUTH_IDENTITY_OWNERSHIP:'0',SNAPSHOT_AUTH_IDENTITIES:json([['GOOGLE','Synthetic-Case-Sensitive-Subject']]),SNAPSHOT_SOCIAL_CHALLENGES:json([['APPLE','c'.repeat(64)]]),SNAPSHOT_EMAIL_CHALLENGES:json([['d'.repeat(64),'SENT',5],['e'.repeat(64),'FAILED',0]]),SNAPSHOT_EMAIL_THROTTLES:json([[5]]),SNAPSHOT_COPY_REFERENCES:'0',SNAPSHOT_COPY_OPERATIONS:json([copyRow()]),SNAPSHOT_PROVISION_REFERENCES:'0',SNAPSHOT_PROVISION_AUDIT:'0',SNAPSHOT_PROVISION_OPERATIONS:json([provisionRow()]),...overrides};
 const calls=[];return{calls,query:async sql=>{calls.push(sql);const tag=sql.match(/^\/\* (SNAPSHOT_[A-Z_]+) \*\//)?.[1];if(!Object.hasOwn(values,tag))throw Error('Unexpected account metadata SQL');return values[tag];}};
}
const accountTables=new Set(['shop_login_bindings','shop_account_grants','auth_provider_identities','social_login_challenges','email_login_challenges','email_login_throttles','copy_config_operations','account_provision_operations','audit_logs']);
test('backup account invariants accept mixed old and add-on copy history and reject malformed new receipts',async()=>{
 const valid=accountMetadataFixture({SNAPSHOT_COPY_OPERATIONS:json([copyRow(),menuCopyRow(),addOnCopyRow()])});
 assert.equal((await captureAccountInvariants(valid.query,accountTables)).copyOperationErrors,0);
 const row=addOnCopyRow();row[7].skipped=500;
 const invalid=accountMetadataFixture({SNAPSHOT_COPY_OPERATIONS:json([row])});
 await assert.rejects(captureAccountInvariants(invalid.query,accountTables),error=>error.message==='COPY_OPERATION_RESULT_INVALID');
});
test('read-only backup invariants accept valid display-menu history and reject a corrupt receipt with a safe error',async()=>{
 const valid=accountMetadataFixture({SNAPSHOT_COPY_OPERATIONS:json([copyRow(),menuCopyRow()])});
 assert.equal((await captureAccountInvariants(valid.query,accountTables)).copyOperationErrors,0);
 assert.ok(valid.calls.every(sql=>/^\/\* SNAPSHOT_[A-Z_]+ \*\/ SELECT /.test(sql)));
 const row=menuCopyRow();row[7].omittedManagedImages=2;
 const invalid=accountMetadataFixture({SNAPSHOT_COPY_OPERATIONS:json([row])});
 await assert.rejects(captureAccountInvariants(invalid.query,accountTables),error=>error.message==='COPY_OPERATION_RESULT_INVALID');
});
test('account invariants are read-only and do not reinterpret historical status permissions or financial owners',async()=>{
 const f=accountMetadataFixture(),result=await captureAccountInvariants(f.query,accountTables);
 assert.ok(Object.keys(result).length>=10);assert.ok(Object.values(result).every(value=>value===0));
 assert.ok(f.calls.every(sql=>/^\/\* SNAPSHOT_[A-Z_]+ \*\/ SELECT /.test(sql)));
 assert.ok(f.calls.every(sql=>!/FOR UPDATE|owner_id|\.status\s*=\s*'ACTIVE'|role\s*=\s*'ADMIN'/i.test(sql)));
 const bindings=f.calls.find(sql=>sql.includes('SNAPSHOT_ACCOUNT_BINDINGS'));assert.match(bindings,/LEFT JOIN users u/);assert.doesNotMatch(bindings,/deleted_at|owner_id|status/);
 const copy=f.calls.find(sql=>sql.includes('SNAPSHOT_COPY_REFERENCES'));assert.match(copy,/LEFT JOIN users actor/);assert.match(copy,/LEFT JOIN shops source/);assert.match(copy,/LEFT JOIN shops target/);
 const provision=f.calls.find(sql=>sql.includes('SNAPSHOT_PROVISION_REFERENCES'));assert.doesNotMatch(provision,/shop_login_bindings|role|status/);
 const audit=f.calls.find(sql=>sql.includes('SNAPSHOT_PROVISION_AUDIT'));assert.match(audit,/a\.operator_id<>o\.actor_id/);assert.match(audit,/a\.target_id<>o\.shop_id/);
});
test('provider identity account ownership and exact ASCII binary collation cannot be silently accepted',async()=>{
 for(const [tag,value,code] of [['SNAPSHOT_AUTH_IDENTITY_COLLATION','1','AUTH_IDENTITY_COLLATION_INVALID'],['SNAPSHOT_AUTH_IDENTITY_OWNERSHIP','1','AUTH_IDENTITY_OWNERSHIP_INVALID'],['SNAPSHOT_AUTH_IDENTITIES',json([['GOOGLE','contains space']]),'AUTH_IDENTITY_SUBJECT_INVALID'],['SNAPSHOT_AUTH_IDENTITIES',json([['google','subject']]),'AUTH_IDENTITY_SUBJECT_INVALID']]){const f=accountMetadataFixture({[tag]:value});await assert.rejects(captureAccountInvariants(f.query,accountTables),error=>error.message===code);}
});
test('orphan copy or provision links and malformed immutable snapshots produce fixed error codes only',async()=>{
 for(const [tag,value,code] of [['SNAPSHOT_COPY_REFERENCES','1','COPY_OPERATION_REFERENCE_INVALID'],['SNAPSHOT_PROVISION_REFERENCES','1','ACCOUNT_PROVISION_REFERENCE_INVALID'],['SNAPSHOT_PROVISION_AUDIT','1','ACCOUNT_PROVISION_AUDIT_INVALID'],['SNAPSHOT_ACCOUNT_BINDINGS','1','ACCOUNT_LOGIN_BINDING_INVALID'],['SNAPSHOT_COPY_OPERATIONS',json([[...copyRow().slice(0,7),{...copyRow()[7],targetShopId:'99'}]]),'COPY_OPERATION_RESULT_INVALID'],['SNAPSHOT_PROVISION_OPERATIONS',json([[...provisionRow().slice(0,6),'FAILED']]),'ACCOUNT_PROVISION_OPERATION_INVALID']]){const f=accountMetadataFixture({[tag]:value});await assert.rejects(captureAccountInvariants(f.query,accountTables),error=>error.message===code&&!error.message.includes('99'));}
});
test('a successful provisioning history remains valid without its former current binding or retained audit row',async()=>{
 const f=accountMetadataFixture(),result=await captureAccountInvariants(f.query,new Set(['account_provision_operations']));
 assert.equal(result.accountProvisionErrors,0);assert.equal(result.accountProvisionReferenceErrors,0);
 assert.ok(f.calls.every(sql=>!sql.includes('shop_login_bindings')&&!sql.includes('audit_logs')));
});
test('email and social challenge snapshots preserve consumed-at history while rejecting malformed hashes and attempt counts',async()=>{
 for(const [tag,value,code] of [['SNAPSHOT_SOCIAL_CHALLENGES',json([['APPLE','raw-secret']]),'SOCIAL_CHALLENGE_INVALID'],['SNAPSHOT_EMAIL_CHALLENGES',json([['d'.repeat(64),'SENT',6]]),'EMAIL_CHALLENGE_INVALID'],['SNAPSHOT_EMAIL_CHALLENGES',json([['d'.repeat(64),'DELIVERED',0]]),'EMAIL_CHALLENGE_INVALID'],['SNAPSHOT_EMAIL_THROTTLES',json([[6]]),'EMAIL_THROTTLE_INVALID']]){const f=accountMetadataFixture({[tag]:value});await assert.rejects(captureAccountInvariants(f.query,accountTables),error=>error.message===code);}
});
test('older snapshots without account tables retain exactly their prior invariant shape',async()=>{
 let calls=0;assert.deepEqual(await captureAccountInvariants(async()=>{calls++;return'';},new Set(['users','shops'])),{});assert.equal(calls,0);
});
