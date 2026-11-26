import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scope=join(root,'.local','restore-failure-repair-20261113');
// Every docker spawn is replaced inside a fresh child by a real, local Node
// stdin consumer. This exercises production stream lifecycles without Docker,
// a database, secrets, or process-global mocks leaking to sibling tests.
const child=String.raw`
import assert from 'node:assert/strict';
import fs,{promises as fsp} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {Readable} from 'node:stream';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const [root,work,bundle,mode]=process.argv.slice(1),spawn=cp.spawn,read=fs.createReadStream;
let spawned=0;
const received=join(work,'received.sql');
const consumer=mode==='early-exit'?"process.exit(0)":"const fs=require('node:fs');const chunks=[];process.stdin.on('data',b=>chunks.push(b));process.stdin.on('end',()=>fs.writeFileSync(process.argv[1],Buffer.concat(chunks)));";
cp.spawn=(name,args,options)=>{assert.equal(name,'docker');spawned++;return spawn(process.execPath,['-e',consumer,received],options);};
syncBuiltinESMExports();
const lib=await import(pathToFileURL(join(root,'scripts/backup-lib.mjs')));
const config={schemaVersion:2,db:{container:'synthetic-stream-db',database:'synthetic_stream_source'},writers:[],media:{driver:'none'}};
const repo=await lib.repositoryMigrations(),sql=Buffer.from("SELECT 'synthetic café';\nSELECT 2;\n"),calls=[];
let account=false,restrictedUser,restrictedPassword,importStarted=false,source;
const adapter={
 async inspect(){return{running:true,composeProject:'massajoy2-phase5-a1b2c3d4',composeService:'db',mounts:[]};},
 async query(statement,options={}){
  calls.push(statement);
  if(statement.startsWith('CREATE DATABASE'))return'';
  if(statement.startsWith('CREATE USER')){const m=/^CREATE USER '([^']+)'@'localhost' IDENTIFIED BY '([^']+)'/.exec(statement);restrictedUser=m[1];restrictedPassword=m[2];account=true;return'';}
  if(statement.startsWith('GRANT '))return'';
  if(statement.startsWith('DROP USER')){assert.equal(statement,"DROP USER IF EXISTS '"+restrictedUser+"'@'localhost';");account=false;return'';}
  if(statement.includes('FROM information_schema.tables'))return JSON.stringify(['_prisma_migrations','BASE TABLE','InnoDB'])+'\n'+JSON.stringify(['users','BASE TABLE','InnoDB']);
  if(statement.includes('information_schema.routines'))return'0';
  if(statement.includes('SELECT JSON_ARRAY(migration_name'))return repo.slice(0,8).map(row=>JSON.stringify([row.name,row.sha256,true,false])).join('\n');
  if(statement.includes('FROM information_schema.columns'))return JSON.stringify(['id','bigint','NO',null,'',null,'',null]);
  if(statement.startsWith('SHOW CREATE TABLE'))return statement+' (id bigint NOT NULL)';
  if(statement.startsWith('SELECT COUNT(*) FROM '+String.fromCharCode(96)))return'1';
  if(statement.startsWith('SELECT SHA2'))return lib.hash(statement);
  if(statement.includes('information_schema.key_column_usage'))return'';
  throw Error('Unexpected synthetic statement');
 },
 async dump(path){await fsp.writeFile(path,gzipSync(sql),{flag:'wx',mode:0o600});},
 async import(path,database,restricted){
  importStarted=true;
  assert.equal(restricted.user,restrictedUser);assert.equal(restricted.password,restrictedPassword);
  fs.createReadStream=(location,...args)=>{
   if(location!==path)return read(location,...args);
   if(mode==='missing')return read(join(work,'SYNTHETIC_PRIVATE_MISSING.sql.gz'));
   if(mode==='read-failure')return source=new Readable({read(){this.destroy(Object.assign(Error('SYNTHETIC_PRIVATE_READ_FAILURE'),{code:'EIO'}));}});
   if(mode==='bad-gzip')return source=Readable.from([Buffer.from('SYNTHETIC_PRIVATE_NOT_GZIP')]);
   if(mode==='early-exit')return source=new Readable({read(){this.push(gzipSync(Buffer.alloc(65536,65)));}});
   return read(location,...args);
  };
  syncBuiltinESMExports();
  try{await lib.createDockerAdapter(config).import(path,database,restricted);}
  finally{fs.createReadStream=read;syncBuiltinESMExports();if(source)assert.equal(source.destroyed,true);}
 },
};
try{
 const backup=await lib.backupBundle(config,{adapter,directory:bundle,acknowledged:true});
 const restored=await lib.restoreBundle(config,bundle,{adapter,expectedDigest:backup.bundleDigest,acknowledged:true});
 assert(importStarted);assert.equal(spawned,1);assert.equal(account,false);assert.equal(restored.temporaryAccountRemoved,true);assert.equal(restored.sourceUnchanged,true);assert.equal(calls.filter(s=>s.startsWith('DROP USER')).length,1);
 assert.equal(restored.passed,mode==='success');
 if(mode==='success')assert.deepEqual(await fsp.readFile(received),Buffer.concat([Buffer.from(restrictedPassword+"\nSET time_zone='+00:00';\n"),sql]));
 else assert.deepEqual(restored.error,{code:'LOCAL_CONTAINER_OPERATION_FAILED'});
 assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC_PRIVATE|password|received.sql|café/);
 console.log(JSON.stringify({passed:true,mode,defaultAdapter:true,realLocalChild:true,dockerInvocations:0,temporaryAccountRemoved:true,sourceUnchanged:true}));
}finally{await fsp.rm(bundle,{recursive:true,force:true});await fsp.rm(bundle+'.partial',{recursive:true,force:true});}
`;

for(const mode of ['missing','read-failure','bad-gzip','success','early-exit'])test(`default Docker import safely handles ${mode} and runs restore account cleanup`,async()=>{
 await fs.mkdir(scope,{recursive:true});
 const suffix=randomBytes(8).toString('hex'),work=join(scope,'stream-fixture-'+suffix),bundle=join(root,'.local','backups','restore-failure-stream-'+suffix);
 await fs.mkdir(work,{recursive:false,mode:0o700});
 try{
  const result=spawnSync(process.execPath,['--input-type=module','-e',child,root,work,bundle,mode],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  assert.equal(result.error,undefined,result.error?.code);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
  const receipt=JSON.parse(result.stdout.trim());assert.equal(receipt.passed,true);assert.equal(receipt.mode,mode);assert.equal(receipt.dockerInvocations,0);assert.equal(result.stderr,'');
 }finally{
  // Paths are absolute, generated under these exact test roots, and never
  // sourced from a directory enumeration or passed to another shell.
  assert.equal(dirname(work),scope);assert.equal(dirname(bundle),join(root,'.local','backups'));
  await fs.rm(work,{recursive:true,force:true});await fs.rm(bundle,{recursive:true,force:true});await fs.rm(bundle+'.partial',{recursive:true,force:true});
 }
});
