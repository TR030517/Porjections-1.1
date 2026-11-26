// Local snapshot v2. Business bytes stay in protected bundle files; diagnostics are fixed codes only.
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {promises as fs,createReadStream,createWriteStream} from 'node:fs';
import {resolve,relative,sep,isAbsolute,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable,compose} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {CREDENTIAL_BACKUP_CODES,validateCredentialVaultConfig,validateCredentialTargetConfig,captureCredentialVault,writeCredentialArchive,validateCredentialArchive,openCredentialArchive,prepareCredentialTarget,restoreCredentialVault,verifyCredentialVaultReferences} from './credential-backup.mjs';

export const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const CONTAINER=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const IDENTIFIER=/^[a-z_][a-z0-9_]{0,63}$/;
const SQL_IDENTIFIER=/^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HASH=/^[a-f0-9]{64}$/;
const MEDIA_KEY=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;
const SYSTEM_DATABASES=new Set(['mysql','information_schema','performance_schema','sys']);
const fail=code=>{throw new Error(code);};
// Retain only fixed diagnostics. Raw adapter/SQL/filesystem errors may contain
// credentials or business paths and must not become an Error.cause or CLI text.
const BACKUP_CODES=new Set(`ACCOUNT_GRANT_PERMISSIONS_INVALID ACCOUNT_GRANT_REFERENCE_INVALID ACCOUNT_LOGIN_BINDING_INVALID ACCOUNT_PROVISION_AUDIT_INVALID ACCOUNT_PROVISION_OPERATION_INVALID ACCOUNT_PROVISION_REFERENCE_INVALID APPLIED_MIGRATIONS_DO_NOT_MATCH_REPOSITORY_PREFIX AUTH_IDENTITY_COLLATION_INVALID AUTH_IDENTITY_OWNERSHIP_INVALID AUTH_IDENTITY_SUBJECT_INVALID BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED BUNDLE_ALREADY_EXISTS BUNDLE_MUST_BE_IN_LOCAL_BACKUPS COPY_OPERATION_REFERENCE_INVALID COPY_OPERATION_RESULT_INVALID CROSS_DATABASE_FOREIGN_KEY_UNSUPPORTED EMAIL_CHALLENGE_INVALID EMAIL_THROTTLE_INVALID EXPLICIT_STOPPED_SOURCE_BACKUP_ACK_REQUIRED FOREIGN_KEY_OWNERSHIP_INVALID INVALID_BACKUP_TASK_CONFIG INVALID_CONTAINER_METADATA INVALID_DATABASE_METADATA INVALID_MEDIA_CONFIG INVALID_MEDIA_FILE_MANIFEST INVALID_MEDIA_KEY INVALID_TASK_JSON LEDGER_OWNERSHIP_INVALID LOCAL_CONTAINER_OPERATION_FAILED LOCAL_CONTAINER_STREAM_FAILED MANAGED_AVATAR_REFERENCE_INVALID MANAGED_MEDIA_STORAGE_REQUIRED MANAGED_SHOP_REFERENCE_INVALID MEDIA_CHANGED_DURING_COPY MEDIA_FILE_ROW_MISMATCH MEDIA_HAS_IN_FLIGHT_OR_INVALID_ASSETS MEDIA_HELPER_UNAVAILABLE MEDIA_SCAN_FAILED MIGRATION_FILE_UNAVAILABLE MIGRATION_MANIFEST_EMPTY NON_CANONICAL_SNAPSHOT PUSH_SESSION_OWNERSHIP_INVALID READONLY_MEDIA_SOURCE_MOUNT_REQUIRED REFERENCED_MEDIA_FILE_MISSING S3_CONSISTENT_SNAPSHOT_UNSUPPORTED S3_OR_MIXED_STORAGE_SNAPSHOT_UNSUPPORTED SOCIAL_CHALLENGE_INVALID SOURCE_CHANGED_DURING_BACKUP SOURCE_WRITERS_MUST_BE_STOPPED STORED_DATABASE_OBJECTS_UNSUPPORTED TASK_JSON_MUST_BE_LOCAL_IGNORED_FILE UNSAFE_BACKUP_PARENT_DIRECTORY UNSAFE_LOCAL_FILE UNSUPPORTED_DATABASE_COLUMN UNSUPPORTED_DATABASE_TABLE_KIND UNSUPPORTED_SQL_IDENTIFIER`.split(' '));
const BACKUP_SYSTEM_CODES=new Set(['EACCES','EPERM','EBUSY','ENOENT','EEXIST','ENOSPC','EMFILE','ENFILE','EIO','ENOTDIR','EISDIR','ENOTEMPTY','EROFS','EXDEV','ERR_STREAM_PREMATURE_CLOSE','ERR_STREAM_DESTROYED','ABORT_ERR']);
for(const code of CREDENTIAL_BACKUP_CODES)BACKUP_CODES.add(code);
for(const code of ['CREDENTIAL_SOURCE_REQUIRED','CREDENTIAL_SOURCE_DOES_NOT_MATCH_BUNDLE','CREDENTIAL_ARCHIVE_DATABASE_MISMATCH','CREDENTIAL_TARGET_NOT_EXPECTED'])BACKUP_CODES.add(code);
const BACKUP_STAGES=new Set(['DATABASE_DUMP','MEDIA_COPY','CREDENTIAL_COPY','SOURCE_RECHECK','DUMP_DIGEST','MANIFEST_WRITE','BUNDLE_PUBLISH']);
class BackupIncompleteError extends Error{
 constructor(stage,error){
  super('BACKUP_INCOMPLETE_PROTECTED_PARTIAL_RETAINED');
  this.stage=BACKUP_STAGES.has(stage)?stage:'UNKNOWN';this.causeCode='UNKNOWN_BACKUP_FAILURE';
  try{if(BACKUP_SYSTEM_CODES.has(error?.code))this.causeCode=error.code;else if(BACKUP_CODES.has(error?.message))this.causeCode=error.message;}catch{}
 }
}
export function backupErrorDetails(error){
 let code='BACKUP_INVOCATION_OR_OPERATION_FAILED';try{if(BACKUP_CODES.has(error?.message))code=error.message;}catch{}
 return{code,...(error instanceof BackupIncompleteError?{stage:error.stage,causeCode:error.causeCode}:{})};
}
const RESTORE_CODES=new Set([...BACKUP_CODES,...`BUNDLE_DATABASE_DIGEST_MISMATCH BUNDLE_DIGEST_NOT_TRUSTED BUNDLE_MANIFEST_DIGEST_MISMATCH BUNDLE_MEDIA_DIGEST_MISMATCH BUNDLE_MUST_BE_COMPLETE_LOCAL_BACKUP BUNDLE_SNAPSHOT_DIGEST_MISMATCH BUNDLE_UNDECLARED_FILE BUNDLE_UNDECLARED_MEDIA_FILE EXPLICIT_NEW_TARGET_RESTORE_ACK_AND_DIGEST_REQUIRED INVALID_BUNDLE_MANIFEST INVALID_MEDIA_TARGET_CONFIG INVALID_RESTORE_DB_CONTAINER INVALID_ROW_DIGEST_STREAM INVALID_TABLE_COUNT ISOLATED_PHASE5_RESTORE_DB_REQUIRED MEDIA_RESTORE_TARGET_MUST_BE_EMPTY MEDIA_TARGET_CANNOT_BE_SOURCE NEW_WRITABLE_MEDIA_TARGET_REQUIRED RESTORED_DATABASE_CONTENT_MISMATCH RESTORED_MEDIA_CONTENT_MISMATCH SOURCE_CONFIG_DOES_NOT_MATCH_BUNDLE STOPPED_SOURCE_NO_LONGER_MATCHES_BUNDLE UNEXPECTED_MEDIA_TARGET UNSAFE_BUNDLE_DIRECTORY UNSAFE_MEDIA_BUNDLE_DIRECTORY LOCAL_SNAPSHOT_BUNDLE_REQUIRED RESTORE_CONFIG_WITHOUT_ACKNOWLEDGEMENT`.split(' ')]);
for(const code of ['EXPLICIT_LOST_SOURCE_RESTORE_ACK_AND_DIGEST_REQUIRED','INVALID_LOST_SOURCE_RESTORE_CONFIG','RESTORE_DATABASE_TARGET_CANNOT_BE_SOURCE','ISOLATED_PHASE5_MEDIA_TARGET_REQUIRED','LOST_SOURCE_RESTORE_REPORT_MUST_BE_LOCAL','LOST_SOURCE_RESTORE_REPORT_ALREADY_EXISTS','LOST_SOURCE_RESTORE_REPORT_WRITE_FAILED'])RESTORE_CODES.add(code);
export function restoreErrorCode(error,fallback='RESTORE_INVOCATION_OR_OPERATION_FAILED'){let message;try{message=error?.message;}catch{}return RESTORE_CODES.has(message)?message:fallback;}
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
export function canonical(value){if(value===null||['string','boolean'].includes(typeof value))return JSON.stringify(value);if(typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return fail('NON_CANONICAL_SNAPSHOT');}
export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
const qi=value=>{if(!SQL_IDENTIFIER.test(value))fail('UNSUPPORTED_SQL_IDENTIFIER');return '`'+value+'`';};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
export function validateConfig(input){
 if(!keys(input,['schemaVersion','db','writers','media','credentialVault'])||input.schemaVersion!==2||!keys(input.db,['container','database'])||!CONTAINER.test(input.db.container)||!IDENTIFIER.test(input.db.database)||SYSTEM_DATABASES.has(input.db.database)||!Array.isArray(input.writers)||input.writers.length>20||input.writers.some(value=>!CONTAINER.test(value))||new Set(input.writers).size!==input.writers.length||input.writers.includes(input.db.container))fail('INVALID_BACKUP_TASK_CONFIG');
 const media=input.media;
 if(!media||media.driver==='s3')fail('S3_CONSISTENT_SNAPSHOT_UNSUPPORTED');
 if(media.driver==='none'){if(!keys(media,['driver']))fail('INVALID_MEDIA_CONFIG');}
 else if(media.driver!=='local'||!keys(media,['driver','container','directory'])||!CONTAINER.test(media.container)||typeof media.directory!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(media.directory)||media.directory.includes('/../')||media.directory.endsWith('/..')||media.directory==='/'||media.directory.endsWith('/')||media.directory.includes('//'))fail('INVALID_MEDIA_CONFIG');
 if(own(input,'credentialVault'))validateCredentialVaultConfig(input.credentialVault,ROOT);
 return input;
}
export function validateTarget(input){if(!keys(input,['schemaVersion','container','directory'])||input.schemaVersion!==2)fail('INVALID_MEDIA_TARGET_CONFIG');validateConfig({schemaVersion:2,db:{container:'validation-db',database:'validation_db'},writers:[],media:{driver:'local',container:input.container,directory:input.directory}});return input;}
async function regular(path,max){const stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max||resolve(await fs.realpath(path)).toLowerCase()!==resolve(path).toLowerCase())fail('UNSAFE_LOCAL_FILE');return stat;}
export async function readTask(path,target=false){const location=resolve(path),part=relative(join(ROOT,'.local'),location);if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part)||!location.endsWith('.json'))fail('TASK_JSON_MUST_BE_LOCAL_IGNORED_FILE');await regular(location,16384);let input;try{input=JSON.parse(await fs.readFile(location,'utf8'));}catch{return fail('INVALID_TASK_JSON');}return target?validateTarget(input):validateConfig(input);}
export async function readCredentialTarget(path){const location=resolve(path),part=relative(join(ROOT,'.local'),location);if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part)||!location.endsWith('.json'))fail('TASK_JSON_MUST_BE_LOCAL_IGNORED_FILE');await regular(location,16384);let input;try{input=JSON.parse(await fs.readFile(location,'utf8'));}catch{return fail('INVALID_TASK_JSON');}return validateCredentialTargetConfig(input,ROOT);}
export async function fileDigest(path){const digest=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){digest.update(chunk);bytes+=chunk.length;}return{sha256:digest.digest('hex'),bytes};}
async function capture(args,input,{max=256*1024*1024}={}){
 const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let bytes=0,output=[];const timeout=setTimeout(()=>child.kill(),180000);timeout.unref();child.once('close',()=>clearTimeout(timeout));
 child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>max)child.kill();else output.push(chunk);});child.stderr.resume();
 const exit=new Promise((done,reject)=>{child.once('error',()=>reject(Error('DOCKER_COMMAND_UNAVAILABLE')));child.once('close',code=>code===0&&bytes<=max?done():reject(Error('LOCAL_CONTAINER_OPERATION_FAILED')));});
 const results=await Promise.allSettled([pipeline(input??Readable.from([]),child.stdin),exit]);if(results.some(result=>result.status==='rejected'))fail('LOCAL_CONTAINER_OPERATION_FAILED');return Buffer.concat(output);
}
async function streamCommand(args,input,...outputs){
 const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});const timeout=setTimeout(()=>child.kill(),600000);timeout.unref();child.once('close',()=>clearTimeout(timeout));child.stderr.resume();
 const exit=new Promise((done,reject)=>{child.once('error',()=>reject(Error('DOCKER_COMMAND_UNAVAILABLE')));child.once('close',code=>code===0?done():reject(Error('LOCAL_CONTAINER_OPERATION_FAILED')));});
 const results=await Promise.allSettled([pipeline(input??Readable.from([]),child.stdin),pipeline(child.stdout,...outputs),exit]);if(results.some(result=>result.status==='rejected'))fail('LOCAL_CONTAINER_STREAM_FAILED');
}
export const MEDIA_SCRIPT=String.raw`const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto'),s=require('node:stream/promises');(async()=>{const[mode,root,key]=process.argv.slice(1),real=await fs.promises.realpath(root);if(real!==p.resolve(root))throw Error();const re=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;if(mode==='list'){const files=[];for(const name of(await fs.promises.readdir(root)).sort()){if(!re.test(name))throw Error();const file=p.join(root,name),stat=await fs.promises.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8388608)throw Error();const h=c.createHash('sha256');for await(const b of fs.createReadStream(file,{flags:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW}))h.update(b);files.push({key:name,bytes:stat.size,sha256:h.digest('hex')});}process.stdout.write(JSON.stringify(files));}else{if(!re.test(key))throw Error();const file=p.join(root,key);if(mode==='read')await s.pipeline(fs.createReadStream(file,{flags:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW}),process.stdout);else if(mode==='write')await s.pipeline(process.stdin,fs.createWriteStream(file,{flags:'wx',mode:384}));else throw Error();}})().catch(()=>process.exitCode=1);`;
export function createDockerAdapter(config){
 validateConfig(config);
 const sqlArgs=(database,restricted)=>['exec','-i',config.db.container,'sh','-c',restricted?
  'IFS= read -r task_password || exit 1; export MYSQL_PWD="$task_password"; unset task_password; exec mysql --binary-mode=1 --local-infile=0 --default-character-set=utf8mb4 --batch --raw --skip-column-names -u "$1" --database "$2"':
  'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --binary-mode=1 --local-infile=0 --default-character-set=utf8mb4 --batch --raw --skip-column-names -u root --database "$1"','sh',...(restricted?[restricted.user,database]:[database])];
 return{
  async inspect(container){const raw=await capture(['inspect','--format','{"running":{{json .State.Running}},"mounts":{{json .Mounts}},"composeProject":{{json (index .Config.Labels "com.docker.compose.project")}},"composeService":{{json (index .Config.Labels "com.docker.compose.service")}}}',container],null,{max:1024*1024});try{return JSON.parse(raw);}catch{return fail('INVALID_CONTAINER_METADATA');}},
  async query(sql,{database=config.db.database,restricted}={}){const prefix=restricted?restricted.password+'\n':'';return(await capture(sqlArgs(database,restricted),Readable.from([prefix+"SET time_zone='+00:00';\n"+sql]))).toString('utf8').trimEnd();},
  async dump(path){const args=['exec','-i',config.db.container,'sh','-c','export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump -u root --single-transaction --quick --hex-blob --skip-comments --skip-dump-date --skip-add-drop-table --skip-add-locks --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 "$1"','sh',config.db.database];await streamCommand(args,null,createGzip(),createWriteStream(path,{flags:'wx',mode:0o600}));},
  async import(path,database,restricted){const input=Readable.from((async function*(){yield restricted.password+'\n';yield "SET time_zone='+00:00';\n";yield*compose(createReadStream(path),createGunzip());})());await capture(sqlArgs(database,restricted),input,{max:1024*1024});},
  async mediaList(media){try{return JSON.parse(await capture(['exec','-i',media.container,'node','-e',MEDIA_SCRIPT,'list',media.directory],null,{max:8*1024*1024}));}catch{return fail('MEDIA_SCAN_FAILED');}},
  async mediaRead(media,key,path){if(!MEDIA_KEY.test(key))fail('INVALID_MEDIA_KEY');await streamCommand(['exec','-i',media.container,'node','-e',MEDIA_SCRIPT,'read',media.directory,key],null,createWriteStream(path,{flags:'wx',mode:0o600}));},
  async mediaWrite(media,key,path){if(!MEDIA_KEY.test(key))fail('INVALID_MEDIA_KEY');await capture(['exec','-i',media.container,'node','-e',MEDIA_SCRIPT,'write',media.directory,key],createReadStream(path),{max:1024});},
 };
}
export async function requireStopped(config,adapter){for(const writer of config.writers){const state=await adapter.inspect(writer);if(state.running!==false)fail('SOURCE_WRITERS_MUST_BE_STOPPED');}}
export async function requireMediaMount(media,adapter,writable=false){const state=await adapter.inspect(media.container);if(state.running!==true||!Array.isArray(state.mounts))fail('MEDIA_HELPER_UNAVAILABLE');const mount=state.mounts.find(row=>row.Destination===media.directory);if(!mount||!['volume','bind'].includes(mount.Type)||mount.RW!==writable)fail(writable?'NEW_WRITABLE_MEDIA_TARGET_REQUIRED':'READONLY_MEDIA_SOURCE_MOUNT_REQUIRED');return{type:mount.Type,identity:hash([mount.Type,mount.Name??null,mount.Source??null])};}
export async function requireRestoreDatabaseTarget(container,adapter){if(!CONTAINER.test(container))fail('INVALID_RESTORE_DB_CONTAINER');const state=await adapter.inspect(container);if(state.running!==true||!/^massajoy2-phase5-[a-f0-9]{8}$/.test(state.composeProject??'')||state.composeService!=='db')fail('ISOLATED_PHASE5_RESTORE_DB_REQUIRED');return{container,project:state.composeProject};}
function jsonRows(text){if(!text)return[];return text.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return fail('INVALID_DATABASE_METADATA');}});}
const ACCOUNT_PERMISSIONS=['BOOKINGS_READ','BOOKINGS_MANAGE','SETTLEMENT_RECORD','REFUNDS_MANAGE','RESERVATION_CONFIG','FINANCE_READ','SHOP_SETTINGS_MANAGE','CATALOG_MANAGE','COPY_CONFIG'];
const ACCOUNT_ID=/^[1-9]\d{0,18}$/;
const OPERATION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REQUEST_KEY=/^[A-Za-z0-9:_-]{8,100}$/;
const PROVISION_KEY=/^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/;
const accountId=value=>typeof value==='string'&&ACCOUNT_ID.test(value)&&BigInt(value)<=9223372036854775807n;
// Pure checks deliberately use no current ACTIVE status, role of a historical
// operator, ownerId fallback or current grant lookup. Revocation is history.
export function validSnapshotGrant(row){
 if(!Array.isArray(row)||row.length!==4)return false;const[source,target,status,permissions]=row;
 if(!accountId(source)||!accountId(target)||source===target||!['ACTIVE','REVOKED'].includes(status)||!Array.isArray(permissions)||permissions.length>ACCOUNT_PERMISSIONS.length||new Set(permissions).size!==permissions.length||permissions.some(value=>!ACCOUNT_PERMISSIONS.includes(value))||status==='ACTIVE'&&!permissions.length)return false;
 if(['BOOKINGS_MANAGE','SETTLEMENT_RECORD','REFUNDS_MANAGE'].some(value=>permissions.includes(value))&&!permissions.includes('BOOKINGS_READ'))return false;
 return !permissions.includes('COPY_CONFIG')||permissions.includes('SHOP_SETTINGS_MANAGE')||permissions.includes('CATALOG_MANAGE');
}
export function validSnapshotCopy(row){
 if(!Array.isArray(row)||row.length!==8)return false;const[id,actor,source,target,kind,key,requestHash,result]=row;
 const valid=typeof id==='string'&&OPERATION_ID.test(id)&&accountId(actor)&&accountId(source)&&accountId(target)&&source!==target&&['HOURS','CATALOG','PRICE_MENU','ADD_ONS'].includes(kind)&&typeof key==='string'&&REQUEST_KEY.test(key)&&typeof requestHash==='string'&&HASH.test(requestHash)&&object(result)&&result.operationId===id&&result.sourceShopId===source&&result.targetShopId===target&&result.kind===kind&&result.status==='APPLIED'&&Number.isSafeInteger(result.created)&&result.created>=0&&Number.isSafeInteger(result.skipped)&&result.skipped>=0;
 if(!valid)return false;
 // New configuration-only receipts have exactly seven fields and count add-ons,
 // including skips. Preserve legacy-kind rules without reinterpreting history.
 if(kind==='ADD_ONS')return result.created<=500&&result.skipped<=500&&result.created+result.skipped<=500&&Object.keys(result).length===7&&Object.keys(result).every(key=>['operationId','sourceShopId','targetShopId','kind','status','created','skipped'].includes(key));
 // Display-menu copies count source items, including an empty-menu replacement;
 // they never create booking services or skip rows. Keep these limits aligned
 // with AccountCopyService.receipt without reinterpreting legacy copy records.
 return kind!=='PRICE_MENU'||result.created<=1000&&result.skipped===0&&Number.isSafeInteger(result.groups)&&result.groups>=0&&result.groups<=100&&Number.isSafeInteger(result.omittedManagedImages)&&result.omittedManagedImages>=0&&result.omittedManagedImages<=result.created;
}
export function validSnapshotProvision(row){
 if(!Array.isArray(row)||row.length!==7)return false;const[id,actor,shop,user,key,requestHash,status]=row;
 return typeof id==='string'&&OPERATION_ID.test(id)&&accountId(actor)&&accountId(shop)&&accountId(user)&&typeof key==='string'&&PROVISION_KEY.test(key)&&typeof requestHash==='string'&&HASH.test(requestHash)&&['APPLIED','CREDENTIALS_APPLIED'].includes(status);
}
/** Metadata stays in memory; only zero-error counters enter public diagnostics.
 * FK traversal separately covers every declared relation. Copy operation IDs
 * have no FKs, so they also need explicit left joins here. */
export async function captureAccountInvariants(query,names){
 const invariants={};
 const zero=async(sql,code,key)=>{if(await query(sql)!=='0')fail(code);invariants[key]=0;};
 if(names.has('shop_login_bindings'))await zero("/* SNAPSHOT_ACCOUNT_BINDINGS */ SELECT COUNT(*) FROM shop_login_bindings b LEFT JOIN shops s ON s.id=b.shop_id LEFT JOIN users u ON u.id=b.user_id LEFT JOIN users creator ON creator.id=b.created_by_id WHERE s.id IS NULL OR u.id IS NULL OR creator.id IS NULL OR u.role<>'MERCHANT';",'ACCOUNT_LOGIN_BINDING_INVALID','accountBindingErrors');
 if(names.has('shop_account_grants')){
  await zero('/* SNAPSHOT_ACCOUNT_GRANT_REFERENCES */ SELECT COUNT(*) FROM shop_account_grants g LEFT JOIN shops source ON source.id=g.source_shop_id LEFT JOIN shops target ON target.id=g.target_shop_id LEFT JOIN users creator ON creator.id=g.created_by_id LEFT JOIN users updater ON updater.id=g.updated_by_id LEFT JOIN users revoker ON revoker.id=g.revoked_by_id WHERE source.id IS NULL OR target.id IS NULL OR creator.id IS NULL OR updater.id IS NULL OR (g.revoked_by_id IS NOT NULL AND revoker.id IS NULL);','ACCOUNT_GRANT_REFERENCE_INVALID','accountGrantReferenceErrors');
  const rows=jsonRows(await query('/* SNAPSHOT_ACCOUNT_GRANTS */ SELECT JSON_ARRAY(CAST(source_shop_id AS CHAR),CAST(target_shop_id AS CHAR),status,permissions) FROM shop_account_grants ORDER BY id;'));
  if(rows.some(row=>!validSnapshotGrant(row)))fail('ACCOUNT_GRANT_PERMISSIONS_INVALID');invariants.accountGrantErrors=0;
 }
 if(names.has('auth_provider_identities')){
  const columns=await query("/* SNAPSHOT_AUTH_IDENTITY_COLLATION */ SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='auth_provider_identities' AND column_name IN ('provider','subject') AND character_set_name='ascii' AND collation_name='ascii_bin';");
  if(columns!=='2')fail('AUTH_IDENTITY_COLLATION_INVALID');
  await zero("/* SNAPSHOT_AUTH_IDENTITY_OWNERSHIP */ SELECT COUNT(*) FROM auth_provider_identities i LEFT JOIN users u ON u.id=i.user_id WHERE u.id IS NULL OR u.role<>'CUSTOMER';",'AUTH_IDENTITY_OWNERSHIP_INVALID','authIdentityOwnershipErrors');
  const rows=jsonRows(await query('/* SNAPSHOT_AUTH_IDENTITIES */ SELECT JSON_ARRAY(provider,subject) FROM auth_provider_identities ORDER BY id;'));
  if(rows.some(row=>!Array.isArray(row)||row.length!==2||!['GOOGLE','APPLE'].includes(row[0])||typeof row[1]!=='string'||!/^[\x21-\x7e]{1,255}$/.test(row[1])))fail('AUTH_IDENTITY_SUBJECT_INVALID');invariants.authIdentityErrors=0;
 }
 if(names.has('social_login_challenges')){const rows=jsonRows(await query('/* SNAPSHOT_SOCIAL_CHALLENGES */ SELECT JSON_ARRAY(provider,nonce_hash) FROM social_login_challenges ORDER BY id;'));if(rows.some(row=>!Array.isArray(row)||row.length!==2||!['GOOGLE','APPLE'].includes(row[0])||!HASH.test(row[1])))fail('SOCIAL_CHALLENGE_INVALID');invariants.socialChallengeErrors=0;}
 if(names.has('email_login_challenges')){const rows=jsonRows(await query('/* SNAPSHOT_EMAIL_CHALLENGES */ SELECT JSON_ARRAY(code_hash,delivery_state,attempts) FROM email_login_challenges ORDER BY id;'));if(rows.some(row=>!Array.isArray(row)||row.length!==3||!HASH.test(row[0])||!['PENDING','SENT','FAILED'].includes(row[1])||!Number.isSafeInteger(row[2])||row[2]<0||row[2]>5))fail('EMAIL_CHALLENGE_INVALID');invariants.emailChallengeErrors=0;}
 if(names.has('email_login_throttles')){const rows=jsonRows(await query('/* SNAPSHOT_EMAIL_THROTTLES */ SELECT JSON_ARRAY(send_count) FROM email_login_throttles ORDER BY email;'));if(rows.some(row=>!Array.isArray(row)||row.length!==1||!Number.isSafeInteger(row[0])||row[0]<0||row[0]>5))fail('EMAIL_THROTTLE_INVALID');invariants.emailThrottleErrors=0;}
 if(names.has('copy_config_operations')){
  await zero('/* SNAPSHOT_COPY_REFERENCES */ SELECT COUNT(*) FROM copy_config_operations o LEFT JOIN users actor ON actor.id=o.actor_id LEFT JOIN shops source ON source.id=o.source_shop_id LEFT JOIN shops target ON target.id=o.target_shop_id WHERE actor.id IS NULL OR source.id IS NULL OR target.id IS NULL;','COPY_OPERATION_REFERENCE_INVALID','copyOperationReferenceErrors');
  const rows=jsonRows(await query('/* SNAPSHOT_COPY_OPERATIONS */ SELECT JSON_ARRAY(id,CAST(actor_id AS CHAR),CAST(source_shop_id AS CHAR),CAST(target_shop_id AS CHAR),kind,idempotency_key,request_hash,result) FROM copy_config_operations ORDER BY id;'));
  if(rows.some(row=>!validSnapshotCopy(row)))fail('COPY_OPERATION_RESULT_INVALID');invariants.copyOperationErrors=0;
 }
 if(names.has('account_provision_operations')){
  // The immutable successful creation may outlive an unbind/rebind. Its present
  // binding and current roles/statuses are not evidence of its historical truth.
  await zero('/* SNAPSHOT_PROVISION_REFERENCES */ SELECT COUNT(*) FROM account_provision_operations o LEFT JOIN users actor ON actor.id=o.actor_id LEFT JOIN users login ON login.id=o.user_id LEFT JOIN shops shop ON shop.id=o.shop_id WHERE actor.id IS NULL OR login.id IS NULL OR shop.id IS NULL;','ACCOUNT_PROVISION_REFERENCE_INVALID','accountProvisionReferenceErrors');
  if(names.has('audit_logs'))await zero("/* SNAPSHOT_PROVISION_AUDIT */ SELECT COUNT(*) FROM audit_logs a JOIN account_provision_operations o ON BINARY JSON_UNQUOTE(JSON_EXTRACT(a.detail,'$.operationId'))=BINARY o.id WHERE BINARY a.action=BINARY 'SHOP_LOGIN_CREATED_AND_BOUND' AND (a.operator_id<>o.actor_id OR a.target_id<>o.shop_id OR a.target_type<>'SHOP_ACCOUNT' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.detail,'$.loginUserId')),'')<>CAST(o.user_id AS CHAR));",'ACCOUNT_PROVISION_AUDIT_INVALID','accountProvisionAuditErrors');
  const rows=jsonRows(await query('/* SNAPSHOT_PROVISION_OPERATIONS */ SELECT JSON_ARRAY(id,CAST(actor_id AS CHAR),CAST(shop_id AS CHAR),CAST(user_id AS CHAR),idempotency_key,request_hash,status) FROM account_provision_operations ORDER BY id;'));
  if(rows.some(row=>!validSnapshotProvision(row)))fail('ACCOUNT_PROVISION_OPERATION_INVALID');invariants.accountProvisionErrors=0;
 }
 return invariants;
}
export async function repositoryMigrations(){const path=join(ROOT,'backend/prisma/migrations'),result=[];for(const entry of(await fs.readdir(path,{withFileTypes:true})).filter(row=>row.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){if(!/^\d{12}_[a-z0-9_]+$/.test(entry.name))continue;const file=join(path,entry.name,'migration.sql');try{result.push({name:entry.name,...await fileDigest(file)});}catch{return fail('MIGRATION_FILE_UNAVAILABLE');}}if(!result.length)fail('MIGRATION_MANIFEST_EMPTY');return result;}
// SHOW CREATE can add an explicit column CHARACTER SET after a dump/import even
// when its following COLLATE and information_schema definition are unchanged.
// Remove only that redundant token sequence outside SQL quoted tokens. Defaults,
// comments, table options and genuine charset/collation/index/FK changes stay bound.
export function normalizeCreateTableCharset(ddl){
 let result='',quote=null;
 for(let i=0;i<ddl.length;){const c=ddl[i];if(quote){result+=c;i++;if(c==='\\'&&i<ddl.length){result+=ddl[i++];continue;}if(c===quote){if(ddl[i]===quote)result+=ddl[i++];else quote=null;}continue;}
  if(c==="'"||c==='"'||c==='`'){quote=c;result+=c;i++;continue;}
  const redundant=ddl.slice(i).match(/^ CHARACTER SET ([A-Za-z0-9_]+)(?= COLLATE \1_[A-Za-z0-9_]+\b)/);if(redundant){i+=redundant[0].length;continue;}result+=c;i++;
 }
 return result;
}

// This is an explicitly separate disaster-recovery protocol. In particular it
// never constructs a source adapter or claims to have checked a lost source.
// Keep restoreBundle's stopped-writer/source-recheck protocol unchanged.
export async function restoreLostSourceBundle(path,options={}){
 if(!keys(options,['targetDbContainer','target','credentialTarget','expectedDigest','sourceUnavailableAcknowledged','targetAdapter']))fail('INVALID_LOST_SOURCE_RESTORE_CONFIG');
 const{targetDbContainer,target,credentialTarget,expectedDigest,sourceUnavailableAcknowledged=false,targetAdapter}=options;
 if(sourceUnavailableAcknowledged!==true||!HASH.test(expectedDigest??''))fail('EXPLICIT_LOST_SOURCE_RESTORE_ACK_AND_DIGEST_REQUIRED');
 const{root,manifest}=await validateBundle(path,expectedDigest);
 if(typeof targetDbContainer!=='string'||!CONTAINER.test(targetDbContainer))fail('INVALID_RESTORE_DB_CONTAINER');
 if(!CONTAINER.test(manifest.source?.container??'')||manifest.media.driver==='local'&&!HASH.test(manifest.media.mountIdentity??''))fail('INVALID_BUNDLE_MANIFEST');
 if(targetDbContainer===manifest.source.container)fail('RESTORE_DATABASE_TARGET_CANNOT_BE_SOURCE');
 let vault;
 if(manifest.schemaVersion===3){
  await prepareCredentialTarget(credentialTarget,ROOT,undefined,root);
  vault=await openCredentialArchive(join(root,'credentials.enc'),manifest.credentialVault,credentialTarget,ROOT);
 }else if(credentialTarget)fail('CREDENTIAL_TARGET_NOT_EXPECTED');
 // Even the default adapter is bound only to the destination. All snapshot and
 // receipt queries after import use its temporary, database-scoped account.
 const destination=targetAdapter??createDockerAdapter({schemaVersion:2,db:{container:targetDbContainer,database:'restore_control'},writers:[],media:{driver:'none'}});
 const destinationInfo=await requireRestoreDatabaseTarget(targetDbContainer,destination);
 if(manifest.media.driver==='local'){
  validateTarget(target);
  const mediaInfo=await destination.inspect(target.container);
  if(mediaInfo.composeProject!==destinationInfo.project||mediaInfo.composeService!=='media')fail('ISOLATED_PHASE5_MEDIA_TARGET_REQUIRED');
  const targetMount=await requireMediaMount(target,destination,true);
  if(targetMount.identity===manifest.media.mountIdentity)fail('MEDIA_TARGET_CANNOT_BE_SOURCE');
  if((await destination.mediaList(target)).length)fail('MEDIA_RESTORE_TARGET_MUST_BE_EMPTY');
 }else if(target)fail('UNEXPECTED_MEDIA_TARGET');
 const database='mj2_restore_'+randomBytes(4).toString('hex'),user='mj2_restore_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex'),restricted={user,password};
 let accountCreateAttempted=false,accountConfirmed=false,created=false,result,error;
 const diagnostics={operationErrorCode:null,accountCleanupErrorCode:null,sourceVerificationErrorCode:null};
 try{
  await destination.query('CREATE DATABASE '+qi(database)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',{database:'information_schema'});created=true;
  const grant=database.replaceAll('_','\\_');accountCreateAttempted=true;
  await destination.query("CREATE USER '"+user+"'@'localhost' IDENTIFIED BY '"+password+"';",{database:'information_schema'});accountConfirmed=true;
  await destination.query("GRANT ALL PRIVILEGES ON `"+grant+"`.* TO '"+user+"'@'localhost';",{database:'information_schema'});
  await destination.import(join(root,'database.sql.gz'),database,restricted);
  const restored=await captureSnapshot(destination,{database,restricted});
  if(restored.digest!==manifest.snapshot.digest)fail('RESTORED_DATABASE_CONTENT_MISMATCH');
  if(vault)await requireCredentialReceipts(vault,restored,destination,database,restricted);
  if(manifest.media.driver==='local'){
   for(const file of manifest.media.files)await destination.mediaWrite(target,file.key,join(root,'media',file.key));
   const restoredFiles=await destination.mediaList(target);
   if(canonical(restoredFiles)!==canonical(manifest.media.files))fail('RESTORED_MEDIA_CONTENT_MISMATCH');
   verifyMediaAssets(restored,restoredFiles,'local');
  }
  if(vault){const recovered=await restoreCredentialVault(vault,credentialTarget,ROOT);if(recovered.digest!==vault.digest)fail('CREDENTIAL_SOURCE_DOES_NOT_MATCH_BUNDLE');}
  result={passed:true,database,restoreTarget:destinationInfo,bundleDigest:manifest.bundleDigest,tables:restored.tables.length,migrations:restored.migrations.length,mediaFiles:manifest.media.files.length,rowsAndStructureMatch:true,mediaBytesMatch:true,credentialVaultIncluded:!!vault,credentialFiles:vault?.filesCount??0,credentialBytesMatch:!!vault,scope:'Pinned bundle recovery into a new isolated database, empty independent media mount and (version 3) new credential directory. Original JWT_SECRET and independent recovery key remain external. No application started or provider reconciliation.',deploymentReady:false};
 }catch(failure){error=diagnostics.operationErrorCode=restoreErrorCode(failure,'NEW_TARGET_RESTORE_FAILED');}
 finally{
  let accountRemoved=!accountCreateAttempted;
  if(accountCreateAttempted){
   if(!accountConfirmed){try{accountConfirmed=await destination.query('SELECT CURRENT_USER();',{database:'information_schema',restricted})===user+'@localhost';}catch{}}
   if(accountConfirmed){try{await destination.query("DROP USER IF EXISTS '"+user+"'@'localhost';",{database:'information_schema'});accountRemoved=true;}catch{error=diagnostics.accountCleanupErrorCode='TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED';}}
   else error=diagnostics.accountCleanupErrorCode='TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED';
  }
  result={...(result??{}),passed:!error,recoveryMode:'bundle-based',sourceAccessed:false,sourceUnchanged:null,temporaryAccountRemoved:accountRemoved,databaseCreated:created,diagnostics,...(created?{database}:{}),...(error?{error:{code:error}}:{}),deploymentReady:false};
 }
 return result;
}
export async function captureSnapshot(adapter,{database,restricted}={}){
 const query=sql=>adapter.query(sql,{...(database?{database}:{}),...(restricted?{restricted}:{})});
 const tables=jsonRows(await query("SELECT JSON_ARRAY(TABLE_NAME,TABLE_TYPE,ENGINE) FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY TABLE_NAME;"));
 if(!tables.length||tables.some(([name,type,engine])=>!IDENTIFIER.test(name)||type!=='BASE TABLE'||engine!=='InnoDB'))fail('UNSUPPORTED_DATABASE_TABLE_KIND');
 const objects=await query('SELECT (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema=DATABASE())+(SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE())+(SELECT COUNT(*) FROM information_schema.events WHERE event_schema=DATABASE());');if(objects!=='0')fail('STORED_DATABASE_OBJECTS_UNSUPPORTED');
 const repo=await repositoryMigrations(),applied=jsonRows(await query('SELECT JSON_ARRAY(migration_name,checksum,finished_at IS NOT NULL,rolled_back_at IS NOT NULL) FROM _prisma_migrations ORDER BY migration_name;'));
 if(!applied.length||applied.some((row,index)=>![true,1].includes(row[2])||![false,0].includes(row[3])||row[0]!==repo[index]?.name||row[1]!==repo[index]?.sha256))fail('APPLIED_MIGRATIONS_DO_NOT_MATCH_REPOSITORY_PREFIX');
 const schema=[];
 for(const[name]of tables){
  const columns=jsonRows(await query(`SELECT JSON_ARRAY(COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME,GENERATION_EXPRESSION,CHARACTER_SET_NAME) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='${name}' ORDER BY ORDINAL_POSITION;`));
  if(!columns.length||columns.some(row=>!SQL_IDENTIFIER.test(row[0])))fail('UNSUPPORTED_DATABASE_COLUMN');
  const ddl=normalizeCreateTableCharset(await query('SHOW CREATE TABLE '+qi(name)+';')),count=await query('SELECT COUNT(*) FROM '+qi(name)+';');if(!/^\d+$/.test(count))fail('INVALID_TABLE_COUNT');
  const parts=columns.filter(row=>!String(row[4]).includes('VIRTUAL GENERATED')).map(([column])=>`IF(${qi(column)} IS NULL,'N',CONCAT('V',OCTET_LENGTH(CAST(${qi(column)} AS BINARY)),':',HEX(CAST(${qi(column)} AS BINARY))))`);
  const raw=await query(`SELECT SHA2(CONCAT_WS('|',${parts.join(',')}),256) AS row_digest FROM ${qi(name)} ORDER BY row_digest;`);
  const rows=raw?raw.split('\n'):[];if(rows.length!==Number(count)||rows.some(value=>!HASH.test(value)))fail('INVALID_ROW_DIGEST_STREAM');
  schema.push({table:name,rows:count,structureDigest:hash({ddl,columns}),rowDigest:hash(rows.join('\n'))});
 }
 const foreign=jsonRows(await query('SELECT JSON_ARRAY(CONSTRAINT_NAME,TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,REFERENCED_TABLE_SCHEMA) FROM information_schema.key_column_usage WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;'));
 const groups=new Map();for(const row of foreign){if(row.slice(1,5).some(value=>!SQL_IDENTIFIER.test(value))||row[5]!==database&&database)fail('CROSS_DATABASE_FOREIGN_KEY_UNSUPPORTED');const key=row[1]+':'+row[0];groups.set(key,[...(groups.get(key)??[]),row]);}
 for(const group of groups.values()){const first=group[0],joinSql=group.map(row=>`c.${qi(row[2])}=p.${qi(row[4])}`).join(' AND '),notNull=group.map(row=>`c.${qi(row[2])} IS NOT NULL`).join(' AND ');if(await query(`SELECT COUNT(*) FROM ${qi(first[1])} c LEFT JOIN ${qi(first[3])} p ON ${joinSql} WHERE ${notNull} AND p.${qi(first[4])} IS NULL;`)!=='0')fail('FOREIGN_KEY_OWNERSHIP_INVALID');}
 const names=new Set(tables.map(row=>row[0])),invariants={foreignKeys:groups.size,...await captureAccountInvariants(query,names)};
 if(names.has('merchant_profiles')){const bad=await query("SELECT COUNT(*) FROM merchant_profiles p LEFT JOIN shops s ON s.id=p.shop_id LEFT JOIN users u ON u.id=p.user_id WHERE s.id IS NULL OR u.id IS NULL OR p.user_id<>s.owner_id OR u.role<>'MERCHANT';");if(bad!=='0')fail('LEDGER_OWNERSHIP_INVALID');invariants.ledgerOwnershipErrors=0;}
 if(names.has('push_devices')){const bad=await query('SELECT COUNT(*) FROM push_devices d LEFT JOIN auth_sessions a ON a.id=d.auth_session_id WHERE a.id IS NULL OR a.user_id<>d.user_id;');if(bad!=='0')fail('PUSH_SESSION_OWNERSHIP_INVALID');invariants.pushOwnershipErrors=0;}
 let media=[];
 if(names.has('media_assets')){
  media=jsonRows(await query('SELECT JSON_ARRAY(id,status,storage_driver,storage_namespace,object_key,content_hash,size_bytes) FROM media_assets ORDER BY id;')).map(([id,status,driver,namespace,key,sha256,bytes])=>({id,status,driver,namespace,key,sha256,bytes}));
  if(media.some(row=>!MEDIA_KEY.test(row.key)||row.key!==row.id+'.webp'||!HASH.test(row.namespace)||!HASH.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>8388608||!['STAGED','BOUND','ABANDONED','DELETED'].includes(row.status)))fail('MEDIA_HAS_IN_FLIGHT_OR_INVALID_ASSETS');
  const avatar=await query("SELECT COUNT(*) FROM users u LEFT JOIN media_assets m ON u.avatar_url=CONCAT('/api/v1/upload/media/',m.id,'/file') WHERE u.avatar_url LIKE '/api/v1/upload/media/%' AND (m.id IS NULL OR m.scope<>'AVATAR' OR m.owner_id<>u.id OR m.status<>'BOUND');");if(avatar!=='0')fail('MANAGED_AVATAR_REFERENCE_INVALID');
  const shop=await query(`SELECT COUNT(*) FROM shops s JOIN JSON_TABLE(JSON_MERGE_PRESERVE(
    JSON_ARRAY(JSON_UNQUOTE(JSON_EXTRACT(s.studio_profile,'$.logoUrl')),JSON_UNQUOTE(JSON_EXTRACT(s.studio_profile,'$.bannerUrl'))),
    COALESCE(JSON_EXTRACT(s.studio_profile,'$.gallery'),JSON_ARRAY()),
    COALESCE(JSON_EXTRACT(s.studio_profile,'$.priceMenu[*].items[*].imageUrl'),JSON_ARRAY())
   ),'$[*]' COLUMNS(url VARCHAR(500) PATH '$' NULL ON EMPTY)) links
   LEFT JOIN media_assets m ON BINARY links.url=BINARY CONCAT('/api/v1/upload/media/',m.id,'/file')
   WHERE BINARY links.url LIKE BINARY '/api/v1/upload/media/%'
   AND (m.id IS NULL OR m.scope<>'SHOP' OR NOT (m.shop_id <=> s.id) OR m.status<>'BOUND');`);
  if(shop!=='0')fail('MANAGED_SHOP_REFERENCE_INVALID');
  invariants.mediaReferenceErrors=0;
 }
 const snapshot={migrations:applied.map(row=>({name:row[0],sha256:row[1]})),tables:schema,invariants,media};return{...snapshot,digest:hash(snapshot)};
}
export function verifyMediaAssets(snapshot,files,driver){
 if(!Array.isArray(files)||files.some(row=>!keys(row,['key','bytes','sha256'])||!MEDIA_KEY.test(row.key)||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>8388608||!HASH.test(row.sha256))||new Set(files.map(row=>row.key)).size!==files.length)fail('INVALID_MEDIA_FILE_MANIFEST');
 const assets=snapshot.media,required=assets.filter(row=>['STAGED','BOUND'].includes(row.status));if(driver==='none'){if(assets.some(row=>row.status!=='DELETED')||files.length)fail('MANAGED_MEDIA_STORAGE_REQUIRED');return;}
 if(assets.some(row=>row.status!=='DELETED'&&row.driver!=='local'))fail('S3_OR_MIXED_STORAGE_SNAPSHOT_UNSUPPORTED');
 const byKey=new Map(assets.map(row=>[row.key,row]));for(const file of files){const row=byKey.get(file.key);if(!row||row.status==='DELETED'||row.driver!=='local'||row.sha256!==file.sha256||row.bytes!==file.bytes)fail('MEDIA_FILE_ROW_MISMATCH');}
 for(const row of required)if(!files.some(file=>file.key===row.key))fail('REFERENCED_MEDIA_FILE_MISSING');
}
async function requireCredentialReceipts(vault,snapshot,adapter,database,restricted){
 if(!snapshot.tables.some(row=>row.table==='account_provision_operations'))return;
 const rows=jsonRows(await adapter.query("/* SNAPSHOT_CREDENTIAL_RECEIPTS */ SELECT JSON_ARRAY(id,CAST(shop_id AS CHAR),CAST(user_id AS CHAR)) FROM account_provision_operations WHERE status='CREDENTIALS_APPLIED' ORDER BY id;",{database,...(restricted?{restricted}:{})}));
 verifyCredentialVaultReferences(vault,{operations:rows.map(([id,shopId,userId])=>({id,shopId,userId}))});
}
export async function backupBundle(config,{adapter=createDockerAdapter(config),directory,acknowledged=false}={}){
 validateConfig(config);if(!acknowledged)fail('EXPLICIT_STOPPED_SOURCE_BACKUP_ACK_REQUIRED');await requireStopped(config,adapter);
 const sourceMount=config.media.driver==='local'?await requireMediaMount(config.media,adapter):null;
 const before=await captureSnapshot(adapter,{database:config.db.database});const files=config.media.driver==='local'?await adapter.mediaList(config.media):[];verifyMediaAssets(before,files,config.media.driver);
 const vault=config.credentialVault?await captureCredentialVault(config.credentialVault,ROOT):null;
 if(vault)await requireCredentialReceipts(vault,before,adapter,config.db.database);
 const base=resolve(directory??join(ROOT,'.local/backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex'))),part=relative(join(ROOT,'.local/backups'),base);if(!part||part.startsWith('..')||isAbsolute(part))fail('BUNDLE_MUST_BE_IN_LOCAL_BACKUPS');
 const partial=base+'.partial';await fs.mkdir(dirname(base),{recursive:true,mode:0o700});if(resolve(await fs.realpath(dirname(base))).toLowerCase()!==dirname(base).toLowerCase())fail('UNSAFE_BACKUP_PARENT_DIRECTORY');try{await fs.lstat(base);fail('BUNDLE_ALREADY_EXISTS');}catch(error){if(error?.code!=='ENOENT')throw error;}await fs.mkdir(partial,{recursive:false,mode:0o700});await fs.mkdir(join(partial,'media'),{mode:0o700});
 let stage='DATABASE_DUMP';try{
  await adapter.dump(join(partial,'database.sql.gz'));
  stage='MEDIA_COPY';
  for(const file of files){const target=join(partial,'media',file.key);await adapter.mediaRead(config.media,file.key,target);if(canonical(await fileDigest(target))!==canonical({sha256:file.sha256,bytes:file.bytes}))fail('MEDIA_CHANGED_DURING_COPY');}
  stage='CREDENTIAL_COPY';
  const credentialVault=vault?await writeCredentialArchive(vault,join(partial,'credentials.enc'),config.credentialVault,ROOT,before.digest):null;
  stage='SOURCE_RECHECK';
  const after=await captureSnapshot(adapter,{database:config.db.database}),lastFiles=config.media.driver==='local'?await adapter.mediaList(config.media):[];await requireStopped(config,adapter);if(before.digest!==after.digest||canonical(files)!==canonical(lastFiles))fail('SOURCE_CHANGED_DURING_BACKUP');
  if(vault&&vault.sourceDigest!==(await captureCredentialVault(config.credentialVault,ROOT)).sourceDigest)fail('CREDENTIAL_BACKUP_SOURCE_CHANGED');
  stage='DUMP_DIGEST';
  const manifest={schemaVersion:vault?3:2,format:'massajoy-local-snapshot',createdAt:new Date().toISOString(),source:{database:config.db.database,container:config.db.container,writers:config.writers,stopped:true},snapshot:before,databaseDump:await fileDigest(join(partial,'database.sql.gz')),media:{driver:config.media.driver,mountIdentity:sourceMount?.identity??null,files},...(vault?{credentialVault}:{}),assurance:'Stopped listed writers, before/after source row/structure digests and local media byte verification. Version 3 additionally binds authenticated credential files and save receipts to this database snapshot; the independent recovery key and original JWT_SECRET remain external. No proof of unlisted external writers, provider balances or production readiness.',deploymentReady:false};manifest.bundleDigest=hash(manifest);
  stage='MANIFEST_WRITE';await fs.writeFile(join(partial,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});stage='BUNDLE_PUBLISH';await fs.rename(partial,base);return{passed:true,bundle:relative(ROOT,base).replaceAll('\\','/'),bundleDigest:manifest.bundleDigest,tables:before.tables.length,rows:before.tables.reduce((sum,row)=>sum+BigInt(row.rows),0n).toString(),migrations:before.migrations.length,mediaFiles:files.length,credentialVaultIncluded:!!vault,credentialFiles:vault?.filesCount??0,deploymentReady:false};
 }catch(error){throw new BackupIncompleteError(stage,error);}
}
export async function validateBundle(path,expectedDigest){
 const root=resolve(path),part=relative(join(ROOT,'.local/backups'),root);if(!part||part.startsWith('..')||isAbsolute(part)||root.endsWith('.partial'))fail('BUNDLE_MUST_BE_COMPLETE_LOCAL_BACKUP');const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||resolve(await fs.realpath(root)).toLowerCase()!==root.toLowerCase())fail('UNSAFE_BUNDLE_DIRECTORY');
 await regular(join(root,'manifest.json'),16*1024*1024);let manifest;try{manifest=JSON.parse(await fs.readFile(join(root,'manifest.json'),'utf8'));}catch{return fail('INVALID_BUNDLE_MANIFEST');}
 if(![2,3].includes(manifest.schemaVersion)||manifest.format!=='massajoy-local-snapshot'||!HASH.test(manifest.bundleDigest)||expectedDigest&&manifest.bundleDigest!==expectedDigest)fail('BUNDLE_DIGEST_NOT_TRUSTED');const unsigned={...manifest};delete unsigned.bundleDigest;if(hash(unsigned)!==manifest.bundleDigest)fail('BUNDLE_MANIFEST_DIGEST_MISMATCH');
 if(hash((({digest,...rest})=>rest)(manifest.snapshot))!==manifest.snapshot.digest)fail('BUNDLE_SNAPSHOT_DIGEST_MISMATCH');
 await regular(join(root,'database.sql.gz'),Number.MAX_SAFE_INTEGER);if(canonical(await fileDigest(join(root,'database.sql.gz')))!==canonical(manifest.databaseDump))fail('BUNDLE_DATABASE_DIGEST_MISMATCH');
 if(!['none','local'].includes(manifest.media?.driver))fail('S3_CONSISTENT_SNAPSHOT_UNSUPPORTED');verifyMediaAssets(manifest.snapshot,manifest.media.files,manifest.media.driver);
 const mediaRoot=join(root,'media'),mediaStat=await fs.lstat(mediaRoot);if(!mediaStat.isDirectory()||mediaStat.isSymbolicLink())fail('UNSAFE_MEDIA_BUNDLE_DIRECTORY');const present=(await fs.readdir(mediaRoot)).sort(),expected=manifest.media.files.map(row=>row.key).sort();if(canonical(present)!==canonical(expected))fail('BUNDLE_UNDECLARED_MEDIA_FILE');
 for(const row of manifest.media.files){await regular(join(mediaRoot,row.key),8388608);if(canonical(await fileDigest(join(mediaRoot,row.key)))!==canonical({bytes:row.bytes,sha256:row.sha256}))fail('BUNDLE_MEDIA_DIGEST_MISMATCH');}
 if(manifest.schemaVersion===3){if(manifest.credentialVault?.databaseDigest!==manifest.snapshot.digest)fail('CREDENTIAL_ARCHIVE_DATABASE_MISMATCH');await validateCredentialArchive(join(root,'credentials.enc'),manifest.credentialVault);}else if(own(manifest,'credentialVault'))fail('INVALID_CREDENTIAL_ARCHIVE');
 if(canonical((await fs.readdir(root)).sort())!==canonical(['database.sql.gz','manifest.json','media',...(manifest.schemaVersion===3?['credentials.enc']:[])].sort()))fail('BUNDLE_UNDECLARED_FILE');return{root,manifest};
}
export async function restoreBundle(config,path,{adapter=createDockerAdapter(config),targetAdapter,targetDbContainer=config.db.container,target,credentialTarget,expectedDigest,acknowledged=false}={}){
 validateConfig(config);if(!acknowledged||!HASH.test(expectedDigest??''))fail('EXPLICIT_NEW_TARGET_RESTORE_ACK_AND_DIGEST_REQUIRED');const{root,manifest}=await validateBundle(path,expectedDigest);await requireStopped(config,adapter);
 if(config.db.database!==manifest.source.database||config.media.driver!==manifest.media.driver)fail('SOURCE_CONFIG_DOES_NOT_MATCH_BUNDLE');const before=await captureSnapshot(adapter,{database:config.db.database});if(before.digest!==manifest.snapshot.digest)fail('STOPPED_SOURCE_NO_LONGER_MATCHES_BUNDLE');
 let vault,sourceVault;
 if(manifest.schemaVersion===3){
  if(!config.credentialVault)fail('CREDENTIAL_SOURCE_REQUIRED');
  await prepareCredentialTarget(credentialTarget,ROOT,config.credentialVault,root);
  vault=await openCredentialArchive(join(root,'credentials.enc'),manifest.credentialVault,credentialTarget,ROOT);
  sourceVault=await captureCredentialVault(config.credentialVault,ROOT);
  if(sourceVault.digest!==vault.digest)fail('CREDENTIAL_SOURCE_DOES_NOT_MATCH_BUNDLE');
  await requireCredentialReceipts(vault,before,adapter,config.db.database);
 }else if(credentialTarget)fail('CREDENTIAL_TARGET_NOT_EXPECTED');
 const destination=targetAdapter??(targetDbContainer===config.db.container?adapter:createDockerAdapter({...config,db:{...config.db,container:targetDbContainer}}));const destinationInfo=await requireRestoreDatabaseTarget(targetDbContainer,destination);
 let targetMount;if(manifest.media.driver==='local'){validateTarget(target);targetMount=await requireMediaMount(target,adapter,true);const sourceMount=await requireMediaMount(config.media,adapter);if(targetMount.identity===sourceMount.identity)fail('MEDIA_TARGET_CANNOT_BE_SOURCE');if((await adapter.mediaList(target)).length)fail('MEDIA_RESTORE_TARGET_MUST_BE_EMPTY');}else if(target)fail('UNEXPECTED_MEDIA_TARGET');
 const database='mj2_restore_'+randomBytes(4).toString('hex'),user='mj2_restore_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex'),restricted={user,password};let accountCreateAttempted=false,accountConfirmed=false,created=false,result,error;
 // Keep all fixed failure codes without changing the legacy top-level priority.
 // Null means no failure was recorded, not that a phase necessarily ran.
 const diagnostics={operationErrorCode:null,accountCleanupErrorCode:null,sourceVerificationErrorCode:null};
 try{
  // No reuse/drop/IF NOT EXISTS: a name collision cannot overwrite any existing database.
  await destination.query('CREATE DATABASE '+qi(database)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',{database:'information_schema'});created=true;
  const grant=database.replaceAll('_','\\_');accountCreateAttempted=true;await destination.query("CREATE USER '"+user+"'@'localhost' IDENTIFIED BY '"+password+"';",{database:'information_schema'});accountConfirmed=true;await destination.query("GRANT ALL PRIVILEGES ON `"+grant+"`.* TO '"+user+"'@'localhost';",{database:'information_schema'});
  await destination.import(join(root,'database.sql.gz'),database,restricted);
  const restored=await captureSnapshot(destination,{database,restricted});if(restored.digest!==manifest.snapshot.digest)fail('RESTORED_DATABASE_CONTENT_MISMATCH');
  if(manifest.media.driver==='local'){for(const file of manifest.media.files)await adapter.mediaWrite(target,file.key,join(root,'media',file.key));const restoredFiles=await adapter.mediaList(target);if(canonical(restoredFiles)!==canonical(manifest.media.files))fail('RESTORED_MEDIA_CONTENT_MISMATCH');verifyMediaAssets(restored,restoredFiles,'local');}
  if(vault){const recovered=await restoreCredentialVault(vault,credentialTarget,ROOT);if(recovered.digest!==vault.digest)fail('CREDENTIAL_SOURCE_DOES_NOT_MATCH_BUNDLE');}
  result={passed:true,database,restoreTarget:destinationInfo,bundleDigest:manifest.bundleDigest,tables:restored.tables.length,migrations:restored.migrations.length,mediaFiles:manifest.media.files.length,rowsAndStructureMatch:true,mediaBytesMatch:true,credentialVaultIncluded:!!vault,credentialFiles:vault?.filesCount??0,credentialBytesMatch:!!vault,scope:'New isolated database, new empty local media target and (version 3) new credential directory only; source retained. Original JWT_SECRET and independent recovery key must be retained separately. No application started or external provider reconciliation.',deploymentReady:false};
 }catch(failure){error=diagnostics.operationErrorCode=restoreErrorCode(failure,'NEW_TARGET_RESTORE_FAILED');}
 finally{
  let accountRemoved=!accountCreateAttempted;
  if(accountCreateAttempted){
   // CREATE USER may commit before its reply is lost. Prove ownership using
   // this attempt's random password; a matching name alone cannot authorize
   // deleting an account that may already have belonged to somebody else.
   if(!accountConfirmed){try{accountConfirmed=await destination.query('SELECT CURRENT_USER();',{database:'information_schema',restricted})===user+'@localhost';}catch{}}
   if(accountConfirmed){try{await destination.query("DROP USER IF EXISTS '"+user+"'@'localhost';",{database:'information_schema'});accountRemoved=true;}catch{error=diagnostics.accountCleanupErrorCode='TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED';}}
   else error=diagnostics.accountCleanupErrorCode='TEMPORARY_RESTORE_ACCOUNT_CLEANUP_FAILED';
  }
  let sourceUnchanged=false;try{await requireStopped(config,adapter);sourceUnchanged=(await captureSnapshot(adapter,{database:config.db.database})).digest===before.digest;if(config.media.driver==='local')sourceUnchanged=sourceUnchanged&&canonical(await adapter.mediaList(config.media))===canonical(manifest.media.files);if(sourceVault)sourceUnchanged=sourceUnchanged&&(await captureCredentialVault(config.credentialVault,ROOT)).sourceDigest===sourceVault.sourceDigest;}catch{}if(!sourceUnchanged)error=diagnostics.sourceVerificationErrorCode='SOURCE_UNCHANGED_VERIFICATION_FAILED';
  result={...(result??{}),passed:!error,temporaryAccountRemoved:accountRemoved,sourceUnchanged,databaseCreated:created,diagnostics,...(created?{database}:{}),...(error?{error:{code:error}}:{}),deploymentReady:false};
 }
 return result;
}
