import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {createRequire} from 'node:module';
import {basename,dirname,join,resolve} from 'node:path';
import {runInThisContext} from 'node:vm';
import {gzipSync} from 'node:zlib';
import {ROOT,backupBundle,hash,repositoryMigrations,restoreLostSourceBundle,restoreErrorCode} from './backup-lib.mjs';
import {runRestoreFromBundle} from './restore-from-bundle.mjs';

const local=join(ROOT,'.local'),backups=join(local,'backups');
const targetDb='lost-source-unit-target-db',project='massajoy2-phase5-a1b2c3d4';
const mediaTarget={schemaVersion:2,container:'lost-source-unit-target-media',directory:'/app/media'};
const key='00000000-0000-0000-0000-000000000001.webp';
const mediaBytes=Buffer.from('SYNTHETIC LOSS-RECOVERY MEDIA');
const mediaFile={key,bytes:mediaBytes.length,sha256:hash(mediaBytes)};
const rows=values=>values.map(value=>JSON.stringify(value)).join('\n');
const vaultParts=['.local','store-account-credentials','vault'];

async function loadVault(appRoot){
 const part=join('backend','scripts','lib','merchant-credential-vault.cjs'),filename=join(appRoot,part),source=await fs.readFile(join(ROOT,part),'utf8'),module={exports:{}};
 const run=runInThisContext(`(function(require,module,__dirname,process){\n${source}\n})`,{filename});
 run(createRequire(filename),module,dirname(filename),{platform:process.platform,env:{}});return module.exports;
}
async function removeOwned(path,parent,name){
 assert.equal(resolve(path),join(parent,name));
 const stat=await fs.lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(!stat)return;assert.equal(stat.isSymbolicLink(),false);
 assert.equal((await fs.realpath(path)).toLowerCase(),resolve(path).toLowerCase());
 await fs.rm(path,{recursive:true});
}
async function fixture(t,{media=true,credentials=false}={}){
 await fs.mkdir(backups,{recursive:true,mode:0o700});
 const scope=await fs.mkdtemp(join(local,'lost-source-unit-')),bundle=join(backups,basename(scope));
 t.after(async()=>{for(const path of [bundle,bundle+'.partial'])await removeOwned(path,backups,basename(path));await removeOwned(scope,local,basename(scope));});
 const config={schemaVersion:2,db:{container:'lost-source-unit-source-db',database:'lost_source_unit_source'},writers:['lost-source-unit-source-api'],media:media?{driver:'local',container:'lost-source-unit-source-media',directory:'/app/media'}:{driver:'none'}};
 let credentialTarget,current,previous,receipt,operationId,sourceApp;
 if(credentials){
  sourceApp=join(scope,'source-app');const recoveryKeyFile=join(scope,'recovery-key.bin');
  await fs.writeFile(recoveryKeyFile,randomBytes(32),{flag:'wx',mode:0o600});
  config.credentialVault={directory:join(sourceApp,...vaultParts),recoveryKeyFile};
  credentialTarget={schemaVersion:1,directory:join(scope,'target-app',...vaultParts),recoveryKeyFile};
  await fs.mkdir(dirname(credentialTarget.directory),{recursive:true,mode:0o700});
  const vault=await loadVault(sourceApp);operationId=randomUUID();
  receipt={userId:'17001',shopId:'17000',version:hash('synthetic operation version')};
  current={userId:receipt.userId,shopId:receipt.shopId,passwordHash:'$2b$12$'+'A'.repeat(53),password:'SYNTHETIC_LOSS_RECOVERY_CURRENT',operationId};
  previous={...current,passwordHash:'$2b$12$'+'B'.repeat(53),password:'SYNTHETIC_LOSS_RECOVERY_PREVIOUS',operationId:null};
  vault.writeMerchantCredential(previous);vault.writeMerchantCredential(current);vault.writeMerchantCredentialReceipt({operationId,...receipt});
 }
 const migrations=await repositoryMigrations();
 const receiptRow=credentials?[operationId,'17002',receipt.shopId,receipt.userId,'synthetic-loss-recovery-operation',hash('synthetic request'),'CREDENTIALS_APPLIED']:null;
 const tables=['_prisma_migrations','users',...(credentials?['account_provision_operations','shops']:[]),...(media?['media_assets']:[])].sort();
 const asset={id:key.slice(0,-5),status:'BOUND',driver:'local',namespace:'a'.repeat(64),...mediaFile};
 const sourceState={gone:false,calls:0},state={queries:[],inspected:[],imported:false,account:false,targetFiles:[],mediaWrites:0};
 function adapter(source){return{
  async inspect(container){
   if(source){sourceState.calls++;assert.equal(sourceState.gone,false,'lost source must not be accessed');if(config.writers.includes(container))return{running:false};assert.equal(container,config.media.container);}
   else{state.inspected.push(container);assert.ok([targetDb,mediaTarget.container].includes(container),'only destination containers may be inspected');}
   return{running:true,composeProject:project,composeService:container===mediaTarget.container?'media':'db',mounts:[{Destination:'/app/media',Type:'volume',Name:source?'lost-source-original-media':'lost-source-new-media',Source:source?'/original-media':'/new-media',RW:!source}]};
  },
  async query(sql,options={}){
   if(source){sourceState.calls++;assert.equal(sourceState.gone,false,'lost source must not be queried');}else state.queries.push({sql,...options});
   if(/^(CREATE DATABASE|CREATE USER|GRANT |DROP USER)/.test(sql)){assert.equal(source,false);if(sql.startsWith('CREATE USER'))state.account=true;if(sql.startsWith('DROP USER'))state.account=false;return'';}
   if(sql==='SELECT CURRENT_USER();')return options.restricted.user+'@localhost';
   if(!source){assert.ok(options.restricted,'all restored snapshot/receipt queries must use scoped credentials');assert.match(options.database,/^mj2_restore_[a-f0-9]{8}$/);}
   if(sql.includes('FROM information_schema.tables'))return rows(tables.map(name=>[name,'BASE TABLE','InnoDB']));
   if(sql.includes('information_schema.routines'))return'0';
   if(sql.startsWith('SELECT JSON_ARRAY(migration_name'))return rows(migrations.map(({name,sha256})=>[name,sha256,true,false]));
   if(sql.includes('FROM information_schema.columns'))return rows([['id','bigint','NO',null,'',null,'',null]]);
   if(sql.startsWith('SHOW CREATE TABLE'))return `${sql} (id bigint NOT NULL)`;
   if(sql.startsWith('SELECT COUNT(*) FROM `'))return sql.includes('`_prisma_migrations`')?String(migrations.length):'1';
   if(sql.startsWith('SELECT SHA2'))return sql.includes('`_prisma_migrations`')?migrations.map(row=>row.sha256).sort().join('\n'):sql.includes('`account_provision_operations`')?hash(receiptRow):hash(sql);
   if(sql.includes('information_schema.key_column_usage'))return'';
   if(sql.startsWith('/* SNAPSHOT_PROVISION_REFERENCES */'))return'0';
   if(sql.startsWith('/* SNAPSHOT_PROVISION_OPERATIONS */'))return rows([receiptRow]);
   if(sql.startsWith('/* SNAPSHOT_CREDENTIAL_RECEIPTS */'))return rows([[receiptRow[0],receiptRow[2],receiptRow[3]]]);
   if(sql.startsWith('SELECT JSON_ARRAY(id,status'))return rows([[asset.id,asset.status,asset.driver,asset.namespace,asset.key,asset.sha256,asset.bytes]]);
   if(sql.startsWith('SELECT COUNT(*) FROM users u LEFT JOIN media_assets')||sql.startsWith('SELECT COUNT(*) FROM shops s JOIN JSON_TABLE'))return'0';
   throw Error('UNEXPECTED_SYNTHETIC_SQL');
  },
  async dump(path){assert.equal(source,true);await fs.writeFile(path,gzipSync('SYNTHETIC SQL ONLY'),{flag:'wx',mode:0o600});},
  async import(_path,database,restricted){assert.equal(source,false);assert.match(database,/^mj2_restore_[a-f0-9]{8}$/);assert.match(restricted.user,/^mj2_restore_[a-f0-9]{16}$/);assert.match(restricted.password,/^[a-f0-9]{64}$/);state.imported=true;},
  async mediaList(value){if(source){sourceState.calls++;assert.equal(sourceState.gone,false);assert.equal(value.container,config.media.container);return[mediaFile];}assert.equal(value.container,mediaTarget.container);return structuredClone(state.targetFiles);},
  async mediaRead(_value,_key,path){assert.equal(source,true);await fs.writeFile(path,mediaBytes,{flag:'wx',mode:0o600});},
  async mediaWrite(value,fileKey,path){assert.equal(source,false);assert.equal(value.container,mediaTarget.container);assert.equal(fileKey,key);assert.deepEqual(await fs.readFile(path),mediaBytes);state.mediaWrites++;state.targetFiles.push({...mediaFile});},
 };}
 const source=adapter(true),destination=adapter(false);
 const backed=await backupBundle(config,{adapter:source,directory:bundle,acknowledged:true});
 sourceState.gone=true;const sourceCalls=sourceState.calls;
 const options={targetDbContainer:targetDb,...(media?{target:mediaTarget}:{}),...(credentials?{credentialTarget}:{}),expectedDigest:backed.bundleDigest,sourceUnavailableAcknowledged:true,targetAdapter:destination};
 return{scope,bundle,config,state,sourceState,sourceCalls,sourceApp,current,previous,receipt,operationId,destination,credentialTarget,options,restore:overrides=>restoreLostSourceBundle(bundle,{...options,...overrides})};
}
function assertNoDatabaseWrites(f){assert.equal(f.state.imported,false);assert.equal(f.state.queries.length,0);assert.equal(f.state.mediaWrites,0);assert.equal(f.sourceState.calls,f.sourceCalls);}
async function rewriteManifest(f,edit){const path=join(f.bundle,'manifest.json'),{bundleDigest,...manifest}=JSON.parse(await fs.readFile(path,'utf8'));await edit(manifest);manifest.bundleDigest=hash(manifest);await fs.writeFile(path,JSON.stringify(manifest));f.options.expectedDigest=manifest.bundleDigest;return manifest;}

test('lost-source v2 restores DB and independent media without any source access or false source assurance',async t=>{
 const f=await fixture(t);const result=await f.restore();
 assert.equal(result.passed,true);assert.equal(result.recoveryMode,'bundle-based');assert.equal(result.sourceAccessed,false);assert.equal(result.sourceUnchanged,null);assert.equal(result.deploymentReady,false);assert.equal(result.temporaryAccountRemoved,true);assert.equal(result.databaseCreated,true);assert.equal(result.rowsAndStructureMatch,true);assert.equal(result.mediaFiles,1);assert.equal(result.mediaBytesMatch,true);
 assert.equal(f.state.mediaWrites,1);assert.equal(f.state.account,false);assert.equal(f.sourceState.calls,f.sourceCalls);assert.deepEqual(new Set(f.state.inspected),new Set([targetDb,mediaTarget.container]));
 assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_LOSS_RECOVERY|IDENTIFIED BY|passwordHash/);
});
test('lost-source requires explicit boolean acknowledgement and separately pinned digest before touching target',async t=>{
 const f=await fixture(t);for(const overrides of [{sourceUnavailableAcknowledged:false},{sourceUnavailableAcknowledged:1},{expectedDigest:undefined},{expectedDigest:'a'.repeat(63)}])await assert.rejects(f.restore(overrides),/EXPLICIT_LOST_SOURCE_RESTORE_ACK_AND_DIGEST_REQUIRED/);assertNoDatabaseWrites(f);assert.deepEqual(f.state.inspected,[]);
});
test('lost-source rejects source config/adapter options and untrusted digest before destination inspection',async t=>{
 const f=await fixture(t);for(const overrides of [{sourceConfig:f.config},{adapter:f.destination}])await assert.rejects(f.restore(overrides),/INVALID_LOST_SOURCE_RESTORE_CONFIG/);await assert.rejects(f.restore({expectedDigest:'0'.repeat(64)}),/BUNDLE_DIGEST_NOT_TRUSTED/);assertNoDatabaseWrites(f);assert.deepEqual(f.state.inspected,[]);
});
test('lost-source refuses the original DB container even if it could bear isolated labels',async t=>{const f=await fixture(t);await assert.rejects(f.restore({targetDbContainer:f.config.db.container}),/RESTORE_DATABASE_TARGET_CANNOT_BE_SOURCE/);assertNoDatabaseWrites(f);assert.deepEqual(f.state.inspected,[]);});
test('lost-source refuses non-phase5 or non-db destinations before writes',async t=>{
 const f=await fixture(t),inspect=f.destination.inspect;for(const metadata of [{composeProject:'massajoy2-local'},{composeService:'api'},{running:false}]){f.destination.inspect=async container=>({...await inspect(container),...metadata});await assert.rejects(f.restore(),/ISOLATED_PHASE5_RESTORE_DB_REQUIRED/);}assertNoDatabaseWrites(f);
});
test('lost-source refuses cross-project or non-media empty writable helper',async t=>{
 const f=await fixture(t),inspect=f.destination.inspect;for(const metadata of [{composeProject:'massajoy2-local'},{composeService:'api'}]){f.destination.inspect=async container=>({...await inspect(container),...(container===mediaTarget.container?metadata:{})});await assert.rejects(f.restore(),/ISOLATED_PHASE5_MEDIA_TARGET_REQUIRED/);}assertNoDatabaseWrites(f);
});
test('lost-source rejects the original media mount from manifest without inspecting vanished source',async t=>{
 const f=await fixture(t),inspect=f.destination.inspect;f.destination.inspect=async container=>{const info=await inspect(container);if(container===mediaTarget.container)info.mounts[0]={...info.mounts[0],Name:'lost-source-original-media',Source:'/original-media'};return info;};await assert.rejects(f.restore(),/MEDIA_TARGET_CANNOT_BE_SOURCE/);assertNoDatabaseWrites(f);
});
test('lost-source refuses nonempty or readonly media targets before database creation',async t=>{
 const f=await fixture(t);f.state.targetFiles.push({...mediaFile});await assert.rejects(f.restore(),/MEDIA_RESTORE_TARGET_MUST_BE_EMPTY/);f.state.targetFiles=[];const inspect=f.destination.inspect;f.destination.inspect=async container=>{const info=await inspect(container);if(container===mediaTarget.container)info.mounts[0].RW=false;return info;};await assert.rejects(f.restore(),/NEW_WRITABLE_MEDIA_TARGET_REQUIRED/);assertNoDatabaseWrites(f);
});
test('lost-source requires a valid recorded source mount identity, never invents source evidence',async t=>{const f=await fixture(t);await rewriteManifest(f,manifest=>{manifest.media.mountIdentity=null;});await assert.rejects(f.restore(),/INVALID_BUNDLE_MANIFEST/);assertNoDatabaseWrites(f);});
test('lost-source v2 with no media restores and rejects unexpected target vault/media configuration',async t=>{
 const f=await fixture(t,{media:false});await assert.rejects(f.restore({target:mediaTarget}),/UNEXPECTED_MEDIA_TARGET/);await assert.rejects(f.restore({credentialTarget:{}}),/CREDENTIAL_TARGET_NOT_EXPECTED/);assertNoDatabaseWrites(f);const result=await f.restore();assert.equal(result.passed,true);assert.equal(result.mediaFiles,0);assert.equal(result.credentialVaultIncluded,false);
});
test('lost-source retains failed new DB and always removes confirmed temporary account without source recheck',async t=>{
 const f=await fixture(t);f.destination.import=async()=>{throw Error('SYNTHETIC_PRIVATE_PASSWORD_AND_PATH');};const result=await f.restore();assert.equal(result.passed,false);assert.equal(result.error.code,'NEW_TARGET_RESTORE_FAILED');assert.equal(result.databaseCreated,true);assert.equal(result.temporaryAccountRemoved,true);assert.equal(result.sourceAccessed,false);assert.equal(result.sourceUnchanged,null);assert.equal(f.state.account,false);assert.equal(f.state.mediaWrites,0);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE/);assert.equal(f.sourceState.calls,f.sourceCalls);
});
test('lost-source preserves both operation and account-cleanup failures as fixed codes',async t=>{
 const f=await fixture(t),query=f.destination.query;f.destination.import=async()=>{throw Error('SYNTHETIC_PRIVATE_IMPORT');};f.destination.query=async(sql,options)=>{if(sql.startsWith('DROP USER'))throw Error('SYNTHETIC_PRIVATE_DROP');return query(sql,options);};const result=await f.restore();assert.equal(result.error.code,'TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED');assert.equal(result.diagnostics.operationErrorCode,'NEW_TARGET_RESTORE_FAILED');assert.equal(result.diagnostics.accountCleanupErrorCode,result.error.code);assert.equal(result.temporaryAccountRemoved,false);assert.equal(result.sourceUnchanged,null);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE/);
});
test('lost-source recovers CREATE USER reply loss only after restricted ownership proof',async t=>{
 const f=await fixture(t),query=f.destination.query;f.destination.query=async(sql,options)=>{const result=await query(sql,options);if(sql.startsWith('CREATE USER'))throw Error('SYNTHETIC_PRIVATE_REPLY_LOST');return result;};const result=await f.restore();assert.equal(result.passed,false);assert.equal(result.temporaryAccountRemoved,true);assert.equal(f.state.account,false);assert.equal(f.state.queries.filter(row=>row.sql==='SELECT CURRENT_USER();'&&row.restricted).length,1);
});
test('lost-source never drops an unconfirmed temporary account when ownership cannot be established',async t=>{
 const f=await fixture(t),query=f.destination.query;f.destination.query=async(sql,options)=>{if(sql.startsWith('CREATE USER')||sql==='SELECT CURRENT_USER();')throw Error('SYNTHETIC_PRIVATE_FAILURE');return query(sql,options);};const result=await f.restore();assert.equal(result.temporaryAccountRemoved,false);assert.equal(result.error.code,'TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED');assert.equal(f.state.queries.some(row=>row.sql.startsWith('DROP USER')),false);
});
test('lost-source detects restored content mismatch before copying media',async t=>{
 const f=await fixture(t),query=f.destination.query;f.destination.query=async(sql,options)=>sql.startsWith('SELECT SHA2')&&sql.includes('`users`')?hash('wrong restored rows'):query(sql,options);const result=await f.restore();assert.equal(result.passed,false);assert.equal(result.error.code,'RESTORED_DATABASE_CONTENT_MISMATCH');assert.equal(result.temporaryAccountRemoved,true);assert.equal(f.state.mediaWrites,0);
});
test('lost-source v3 recovers real encrypted current/history/receipts after deleting original vault',async t=>{
 const f=await fixture(t,{credentials:true});await removeOwned(f.sourceApp,f.scope,'source-app');const result=await f.restore();assert.equal(result.passed,true);assert.equal(result.credentialFiles,4);assert.equal(result.credentialBytesMatch,true);assert.equal(result.sourceAccessed,false);assert.equal(result.sourceUnchanged,null);assert.equal(f.sourceState.calls,f.sourceCalls);
 const vault=await loadVault(join(f.scope,'target-app'));assert.equal(vault.readMerchantCredential(f.current).password,f.current.password);assert.equal(vault.readMerchantCredential(f.previous).password,f.previous.password);assert.deepEqual(vault.readMerchantCredentialReceipt(f.operationId),f.receipt);
 assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_LOSS_RECOVERY|JWT_SECRET.*restored/);
});
test('lost-source v3 authenticates archive using independent recovery key before inspecting DB',async t=>{
 const f=await fixture(t,{credentials:true});const wrong=join(f.scope,'wrong-key.bin');await fs.writeFile(wrong,randomBytes(32),{flag:'wx',mode:0o600});await assert.rejects(f.restore({credentialTarget:{...f.credentialTarget,recoveryKeyFile:wrong}}),/CREDENTIAL_ARCHIVE_DECRYPTION_FAILED/);assertNoDatabaseWrites(f);assert.deepEqual(f.state.inspected,[]);
});
test('lost-source v3 validates receipt references against restored DB before publishing vault or media',async t=>{
 const f=await fixture(t,{credentials:true}),query=f.destination.query;f.destination.query=async(sql,options)=>{if(sql.startsWith('/* SNAPSHOT_CREDENTIAL_RECEIPTS */')){assert.ok(options.restricted);return rows([[f.operationId,'99999',f.receipt.userId]]);}return query(sql,options);};const result=await f.restore();assert.equal(result.passed,false);assert.equal(result.error.code,'CREDENTIAL_DATABASE_REFERENCE_MISSING');assert.equal(result.temporaryAccountRemoved,true);assert.equal(f.state.imported,true);assert.equal(f.state.mediaWrites,0);await assert.rejects(fs.lstat(f.credentialTarget.directory),{code:'ENOENT'});
});
test('lost-source v3 refuses existing credential directory without mutation',async t=>{
 const f=await fixture(t,{credentials:true});await fs.mkdir(f.credentialTarget.directory);await assert.rejects(f.restore(),/CREDENTIAL_TARGET_ALREADY_EXISTS/);assertNoDatabaseWrites(f);assert.deepEqual(f.state.inspected,[]);
});

async function captureCli(t,args){const output=[],errors=[];t.mock.method(console,'log',value=>output.push(value));t.mock.method(console,'error',value=>errors.push(value));try{const exit=await runRestoreFromBundle(args);return{exit,output,errors,result:JSON.parse(output.at(-1)??errors.at(-1))};}finally{t.mock.restoreAll();}}
test('lost-source CLI rejects source config and missing acknowledgement with sanitized local failure receipts',async t=>{
 for(const args of [['--config','SYNTHETIC_PRIVATE_CONFIG'],['--bundle','SYNTHETIC_PRIVATE_BUNDLE']]){
  const got=await captureCli(t,args);assert.equal(got.exit,1);assert.equal(got.result.sourceAccessed,false);assert.equal(got.result.sourceUnchanged,null);assert.equal(got.result.deploymentReady,false);assert.match(got.result.report,/^\.local\/restore-reports\//);assert.doesNotMatch(JSON.stringify(got),/SYNTHETIC_PRIVATE/);
  const path=join(ROOT,got.result.report),{report,...expected}=got.result;try{assert.deepEqual(JSON.parse(await fs.readFile(path,'utf8')),expected);}finally{await fs.unlink(path);}
 }
});
test('lost-source CLI preflights unsafe or existing report before destination access and preserves original receipt',async t=>{
 const f=await fixture(t,{media:false}),report=join(local,'restore-reports','lost-source-existing-'+randomBytes(6).toString('hex')+'.json');await fs.mkdir(dirname(report),{recursive:true});await fs.writeFile(report,'ORIGINAL FAILURE RECEIPT',{flag:'wx'});t.after(()=>fs.unlink(report));
 for(const path of [join(ROOT,'outside-local.json'),join(f.bundle,'forbidden-report.json'),join(f.scope,'new-vault','report.json'),report]){const got=await captureCli(t,['--bundle',f.bundle,'--target-db-container',targetDb,'--expected-bundle-digest',f.options.expectedDigest,'--acknowledge-source-unavailable','--report',path]);assert.equal(got.exit,1);assert.match(got.result.error.code,/LOST_SOURCE_RESTORE_REPORT_(MUST_BE_LOCAL|ALREADY_EXISTS)/);assert.equal(got.result.sourceUnchanged,null);await fs.unlink(join(ROOT,got.result.report));}
 await assert.rejects(fs.lstat(join(f.bundle,'forbidden-report.json')),{code:'ENOENT'});await assert.rejects(fs.lstat(join(f.scope,'new-vault')),{code:'ENOENT'});
 assert.equal(await fs.readFile(report,'utf8'),'ORIGINAL FAILURE RECEIPT');assertNoDatabaseWrites(f);
});
test('lost-source diagnostics reject unknown adapter errors and malicious message getters',()=>{assert.equal(restoreErrorCode(Error('SYNTHETIC_PRIVATE_PASSWORD')),'RESTORE_INVOCATION_OR_OPERATION_FAILED');assert.equal(restoreErrorCode(Object.defineProperty({},'message',{get(){throw Error('secret');}})),'RESTORE_INVOCATION_OR_OPERATION_FAILED');});
