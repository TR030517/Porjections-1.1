'use strict';
// Read-only by default. Applies only to the explicitly isolated 1,335-store local dataset.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { hash } = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { IMPORT_SOURCE, legacyLoginName, plainText, randomStorePassword } = require('./import-legacy-stores.cjs');
const VERSION = 2, SCHEMA = 'mj2_store_migration_84cec1e6', ROOT = path.resolve(__dirname, '../..');
const DEFAULT_ENV = path.join(ROOT, '.local/legacy-store-import-20261105/preview.env');
const DEFAULT_SQL = path.join(ROOT, '.local/legacy-store-import-20261105/source-without-platform-stats.sql');
const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
function record(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new Error('Malformed retained store profile'); } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function targetUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Local migration DATABASE_URL is required'); }
  if (url.protocol !== 'mysql:' || !['localhost','127.0.0.1'].includes(url.hostname) || url.port !== '33090'
    || url.pathname !== '/' + SCHEMA || !url.username || !url.password || url.search || url.hash) throw new Error('Target must be loopback:33090/' + SCHEMA);
  return url.toString();
}
function loadEnvironment(file) {
  return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    return match ? [[match[1],match[2].replace(/^(['"])(.*)\1$/,'$2')]] : [];
  }));
}
function sqlValues(input) {
  const rows = []; let row = null, token = '', quoted = false, string = false;
  const finish = () => { row.push(string ? token : token.trim() === 'NULL' ? null : token.trim()); token = ''; string = false; };
  for (let i=0;i<input.length;i++) {
    const c=input[i];
    if (quoted) {
      if(c==='\\') { const next=input[++i]; token+=({0:'\0',n:'\n',r:'\r',t:'\t',b:'\b',Z:'\x1a'})[next]??next; }
      else if(c==="'"&&input[i+1]==="'") {token+="'";i++;}
      else if(c==="'") quoted=false;
      else token+=c;
    } else if(c==="'") {quoted=true;string=true;if(!token.trim())token='';}
    else if(c==='('&&row===null)row=[];
    else if(c===','&&row!==null)finish();
    else if(c===')'&&row!==null){finish();rows.push(row);row=null;}
    else if(row!==null)token+=c;
  }
  if(quoted||row!==null)throw new Error('Incomplete merchant SQL row');
  return rows;
}
function sourceRows(sql) {
  const block=/CREATE TABLE \x60merchant\x60\s*\(([\s\S]*?)\)\s*ENGINE/i.exec(sql);
  if(!block)throw new Error('Retained SQL has no merchant schema');
  const columns=[...block[1].matchAll(/^\s*\x60([^\x60]+)\x60\s/gm)].map(m=>m[1]);
  const wanted=['id','name','account','contact_name','email','phone'];
  const positions=Object.fromEntries(wanted.map(key=>[key,columns.indexOf(key)]));
  if(wanted.some(key=>positions[key]<0))throw new Error('Missing source identity fields');
  const rows=[];
  for(const insert of sql.matchAll(/^INSERT INTO \x60merchant\x60 VALUES ([\s\S]*?);(?:\r?\n|$)/gm))for(const values of sqlValues(insert[1])){
    if(values.length!==columns.length)throw new Error('Merchant row/schema mismatch');
    const row=Object.fromEntries(wanted.map(key=>[key,values[positions[key]]]));
    if(plainText(row.name,200))rows.push(row);
  }
  if(!rows.length||new Set(rows.map(row=>String(row.id))).size!==rows.length)throw new Error('Empty or duplicate source identities');
  return rows;
}
function importedShortName(shop,name,id) {
  if(shop.shortName)return shop.shortName;
  const stem=plainText(name,200).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'legacy-store';
  return stem+'-'+id;
}
async function buildPlan(db,rows) {
  const [shops,aliases,users]=await Promise.all([
    db.shop.findMany({include:{loginBinding:{include:{user:true}}},orderBy:{id:'asc'}}),
    db.shopAlias.findMany({where:{OR:[{kind:'LEGACY_STORE_ID',source:IMPORT_SOURCE},{kind:'LEGACY_ID',source:'massajoy1'},{kind:'SHORT_NAME',source:'massajoy'}]}}),
    db.user.findMany({select:{id:true,loginName:true,email:true,role:true}}),
  ]);
  const sources=new Map(rows.map(r=>[String(r.id),r])), key=(kind,source,value)=>kind+':'+source+':'+value;
  const aliasMap=new Map(aliases.map(a=>[key(a.kind,a.source,a.value),a]));
  const emails=new Map(users.filter(u=>u.email).map(u=>[u.email.toLowerCase(),String(u.id)]));
  const logins=new Map(users.filter(u=>u.loginName).map(u=>[u.loginName,String(u.id)]));
  const shortNames=new Map(shops.filter(s=>s.shortName).map(s=>[s.shortName,String(s.id)]));
  const historicalOwners=new Set(shops.map(s=>String(s.ownerId)));
  const entries=[],blockers=[],summary={totalShops:shops.length,matchedShops:0,accountsToCreate:0,accountsToUpdate:0,accountsAlreadyMigrated:0,passwordsToGenerate:0,accountsToSuspend:0,emailReady:0,emailMissingOrShared:0,aliasesToCreate:0,aliasesToReactivate:0,preservePublicationStatus:true};
  for(const shop of shops){
    const shopId=String(shop.id),profile=record(shop.studioProfile),legacy=record(profile.legacyImport);
    const mapping=aliases.filter(a=>String(a.shopId)===shopId&&a.kind==='LEGACY_STORE_ID'&&a.source===IMPORT_SOURCE&&a.isActive);
    if(mapping.length!==1||!sources.has(mapping[0].value)){blockers.push({shopId,code:'SOURCE_MAPPING_MISSING_OR_AMBIGUOUS'});continue;}
    const sourceId=mapping[0].value,row=sources.get(sourceId),bound=shop.loginBinding?.user;
    if(bound&&(bound.role!=='MERCHANT'||bound.deletedAt)){blockers.push({shopId,code:'BOUND_ACCOUNT_NOT_SAFE_MERCHANT'});continue;}
    // Never repurpose or suspend an account holding historical ownership.
    const existing=bound&&!historicalOwners.has(String(bound.id))?bound:null,existingId=existing?String(existing.id):null;
    const complete=existing&&legacy.accountMigrationVersion===VERSION&&legacy.independentAccountId===existingId&&BCRYPT.test(existing.passwordHash??'');
    const shortName=importedShortName(shop,row.name,sourceId);
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shortName)||shortName.length<3||shortName.length>100||shortNames.has(shortName)&&shortNames.get(shortName)!==shopId){blockers.push({shopId,code:'SHORT_NAME_INVALID_OR_CONFLICT'});continue;}
    const desired=[];
    for(const [kind,source,value]of [['SHORT_NAME','massajoy',shortName],['LEGACY_ID','massajoy1',sourceId]]){
      const prior=aliasMap.get(key(kind,source,value));
      if(prior&&String(prior.shopId)!==shopId){blockers.push({shopId,code:'RESERVED_ALIAS_CONFLICT'});continue;}
      desired.push({kind,source,value,action:!prior?'CREATE':prior.isActive?'KEEP':'REACTIVATE'});
      if(!prior)summary.aliasesToCreate++;else if(!prior.isActive)summary.aliasesToReactivate++;
    }
    let loginName=existing?.loginName;
    if(!loginName){
      const base=legacyLoginName(row.account,sourceId);loginName=base;
      for(let n=1;logins.has(loginName)&&logins.get(loginName)!==existingId;n++){if(n>999)throw new Error('No free independent identifier');loginName=base.slice(0,60)+'-'+n;}
    }
    logins.set(loginName,existingId??'new:'+shopId);
    const candidates=[...new Set([existing?.email,row.account,...(Array.isArray(profile.emails)?profile.emails:[]),row.email].filter(v=>typeof v==='string').flatMap(v=>v.split(/[;,\n]/)).map(v=>plainText(v,255).toLowerCase()).filter(v=>EMAIL.test(v)))];
    const email=candidates.find(v=>!emails.has(v)||emails.get(v)===existingId)??null;
    if(email)emails.set(email,existingId??'new:'+shopId);
    entries.push({shopId,sourceId,ownerId:String(shop.ownerId),status:shop.status,profile,bindingUserId:bound?String(bound.id):null,existingId,
      existingHash:existing?.passwordHash??null,existingStatus:existing?.status??null,existingEmail:existing?.email??null,
      shortName,setShortName:!shop.shortName,loginName,email,name:plainText(existing?.name||row.contact_name||row.name,100),generatePassword:!complete,aliases:desired});
    summary.matchedShops++;summary[existing?'accountsToUpdate':'accountsToCreate']++;
    if(complete)summary.accountsAlreadyMigrated++;else summary.passwordsToGenerate++;
    if(!existing||existing.status!=='SUSPENDED')summary.accountsToSuspend++;
    summary[email?'emailReady':'emailMissingOrShared']++;
  }
  return {summary,blockers,entries,digest:crypto.createHash('sha256').update(json(entries)).digest('hex')};
}
function protectedCredentialFile(filename) {
  const local=path.join(ROOT,'.local')+path.sep,resolved=path.resolve(filename);
  if(!resolved.startsWith(local)||fs.existsSync(resolved))throw new Error('Credentials require a new file inside project .local');
  const directory=path.dirname(resolved);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(process.platform==='win32'){
    const user=execFileSync('whoami.exe',[],{encoding:'utf8'}).trim();
    execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',user+':(OI)(CI)F'],{stdio:'ignore'});
  }else fs.chmodSync(directory,0o700);
  const fd=fs.openSync(resolved,'wx',0o600);
  return{append(value){fs.writeSync(fd,json(value)+'\n');fs.fsyncSync(fd);},close(){fs.closeSync(fd);},path:resolved};
}
async function applyPlan(db,rows,digest,credentials,deps={}) {
  return db.$transaction(async tx=>{
    await tx.$queryRawUnsafe('SELECT id FROM shops ORDER BY id FOR UPDATE');
    const plan=await buildPlan(tx,rows);
    if(plan.blockers.length||plan.digest!==digest)throw new Error('Stale or blocked migration plan');
    const generated=new Map();
    for(const e of plan.entries)if(e.generatePassword){
      const password=(deps.makePassword??randomStorePassword)();
      if(!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8}$/.test(password))throw new Error('Generated password policy failed');
      generated.set(e.shopId,await(deps.makeHash??(p=>hash(p,12)))(password));
      credentials.append({shopId:e.shopId,legacyStoreId:e.sourceId,loginEmail:e.email,loginName:e.loginName,initialPassword:password,loginEnabled:false});
    }
    // Flush all generated credentials before the transaction's first write.
    for(const e of plan.entries){
      const data={loginName:e.loginName,email:e.email,name:e.name,role:'MERCHANT',status:'SUSPENDED',...(generated.has(e.shopId)?{passwordHash:generated.get(e.shopId)}:{})};
      const account=e.existingId?await tx.user.update({where:{id:BigInt(e.existingId),role:'MERCHANT'},data}):await tx.user.create({data});
      if(e.bindingUserId!==String(account.id))await tx.shopLoginBinding.upsert({where:{shopId:BigInt(e.shopId)},create:{shopId:BigInt(e.shopId),userId:account.id,createdById:BigInt(e.ownerId),reason:'Massajoy1.0 independent account migration; login disabled'},update:{userId:account.id,reason:'Massajoy1.0 independent account migration; login disabled'}});
      await tx.authSession.updateMany({where:{userId:account.id,revokedAt:null},data:{revokedAt:new Date()}});
      for(const a of e.aliases)if(a.action!=='KEEP')await tx.shopAlias.upsert({where:{kind_source_value:{kind:a.kind,source:a.source,value:a.value}},create:{shopId:BigInt(e.shopId),kind:a.kind,source:a.source,value:a.value},update:{isActive:true}});
      await tx.shop.update({where:{id:BigInt(e.shopId)},data:{...(e.setShortName?{shortName:e.shortName}:{}),studioProfile:{...e.profile,legacyImport:{...record(e.profile.legacyImport),source:IMPORT_SOURCE,sourceShopId:e.sourceId,accountMigrated:true,accountMigrationVersion:VERSION,independentAccountId:String(account.id),loginEnabled:false,emailNeedsReview:!e.email}}}});
    }
    return{...plan.summary,generatedCredentialCount:generated.size,statusesChanged:0};
  },{maxWait:30000,timeout:900000,isolationLevel:'Serializable'});
}
async function main(){
  if(process.env.NODE_ENV==='production')throw new Error('Local migration only');
  const args=process.argv.slice(2),arg=key=>args.find(v=>v.startsWith(key+'='))?.slice(key.length+1);
  const env=loadEnvironment(arg('--env-file')||DEFAULT_ENV),url=targetUrl(env.DATABASE_URL);
  const rows=sourceRows(fs.readFileSync(arg('--source-sql')||DEFAULT_SQL,'utf8'));
  const db=new PrismaClient({datasources:{db:{url}}});let credentials;
  try{
    const identity=await db.$queryRawUnsafe('SELECT DATABASE() AS name');
    if(identity[0]?.name!==SCHEMA)throw new Error('Database identity mismatch');
    const plan=await buildPlan(db,rows);
    if(!args.includes('--apply')){console.log(json({mode:'dry-run',schema:SCHEMA,...plan.summary,blockers:plan.blockers,digest:plan.digest}));return;}
    if(!args.includes('--acknowledge-local-only')||!arg('--expected-digest'))throw new Error('Apply needs acknowledgement and expected digest');
    credentials=protectedCredentialFile(arg('--credentials-file')||path.join(ROOT,'.local/store-account-credentials','migration-'+Date.now()+'.jsonl'));
    const result=await applyPlan(db,rows,arg('--expected-digest'),credentials);
    credentials.append({migrationCommitted:true,completedAt:new Date().toISOString(),generatedCredentialCount:result.generatedCredentialCount});
    console.log(json({mode:'apply',schema:SCHEMA,...result,credentialsFile:credentials.path}));
  }finally{credentials?.close();await db.$disconnect();}
}
if(require.main===module)main().catch(()=>{console.error('Local store-account migration stopped. No credentials were logged; review the read-only plan or protected credential file.');process.exitCode=1;});
module.exports={VERSION,targetUrl,sourceRows,sqlValues,importedShortName,buildPlan,applyPlan,protectedCredentialFile};

