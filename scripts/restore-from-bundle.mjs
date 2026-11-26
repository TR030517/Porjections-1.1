import {randomBytes} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,readTask,readCredentialTarget,restoreLostSourceBundle,restoreErrorCode} from './backup-lib.mjs';

const baseline={recoveryMode:'bundle-based',sourceAccessed:false,sourceUnchanged:null,deploymentReady:false};
const fail=code=>{throw Error(code);};
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
async function reportPath(requested){
 const folder=join(ROOT,'.local','restore-reports'),path=requested?resolve(requested):join(folder,'bundle-recovery-'+Date.now()+'-'+randomBytes(6).toString('hex')+'.json');
 const part=relative(folder,path);
 if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part)||!path.endsWith('.json')||part.split(/[\\/]/).some(name=>!name||/[\x00-\x1f:]/.test(name)||name.endsWith('.')||name.endsWith(' ')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)))fail('LOST_SOURCE_RESTORE_REPORT_MUST_BE_LOCAL');
 // Validate each parent before creating it. Never follow a junction/symlink or
 // overwrite an earlier receipt, including a failed attempt's receipt.
 let current=ROOT;
 for(const name of relative(ROOT,dirname(path)).split(sep)){
  current=join(current,name);
  try{await fs.mkdir(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await fs.lstat(current);
  if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(resolve(await fs.realpath(current)),resolve(current)))fail('LOST_SOURCE_RESTORE_REPORT_MUST_BE_LOCAL');
 }
 try{await fs.lstat(path);fail('LOST_SOURCE_RESTORE_REPORT_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
 return path;
}

export async function runRestoreFromBundle(args=process.argv.slice(2)){
 if(!args.length||args.length===1&&args[0]==='--help'){
  console.log('Lost-source recovery: node scripts/restore-from-bundle.mjs --bundle .local/backups/<bundle> --target-db-container <isolated-phase5-db> --expected-bundle-digest <sha256> --acknowledge-source-unavailable [--media-target-config .local/new-media.json] [--credential-target-config .local/new-vault.json] [--report .local/restore-reports/recovery.json]\nRequires a pinned bundle digest, an isolated destination, and (v3) an independent recovery key and new vault. No source configuration or source access. Reports must be new JSON files under .local/restore-reports/. Original JWT_SECRET remains external. Failed targets are retained; this does not certify deployment readiness.');return 0;
 }
 let result,report;
 try{
  const options={};
  for(let i=0;i<args.length;i++){
   const key=args[i];if(Object.hasOwn(options,key))fail('INVALID_LOST_SOURCE_RESTORE_CONFIG');
   if(key==='--acknowledge-source-unavailable')options[key]=true;
   else if(['--bundle','--target-db-container','--media-target-config','--credential-target-config','--expected-bundle-digest','--report'].includes(key)&&args[i+1]&&!args[i+1].startsWith('-'))options[key]=args[++i];
   else fail('INVALID_LOST_SOURCE_RESTORE_CONFIG');
  }
  // Refuse malformed acknowledgements before opening bundle/config files or
  // inspecting a destination. A report path is also preflighted before restore.
  if(options['--acknowledge-source-unavailable']!==true||!(/^[a-f0-9]{64}$/).test(options['--expected-bundle-digest']??''))fail('EXPLICIT_LOST_SOURCE_RESTORE_ACK_AND_DIGEST_REQUIRED');
  if(!options['--bundle'])fail('LOCAL_SNAPSHOT_BUNDLE_REQUIRED');
  report=await reportPath(options['--report']);
  const target=options['--media-target-config']?await readTask(options['--media-target-config'],true):undefined;
  const credentialTarget=options['--credential-target-config']?await readCredentialTarget(options['--credential-target-config']):undefined;
  result=await restoreLostSourceBundle(options['--bundle'],{targetDbContainer:options['--target-db-container'],target,credentialTarget,expectedDigest:options['--expected-bundle-digest'],sourceUnavailableAcknowledged:true});
 }catch(error){result={passed:false,...baseline,error:{code:restoreErrorCode(error)}};}
 try{
  report??=await reportPath();
  await fs.writeFile(report,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 }catch{
  result={...result,passed:false,error:{code:'LOST_SOURCE_RESTORE_REPORT_WRITE_FAILED'}};
  console.error(JSON.stringify(result));return 1;
 }
 console.log(JSON.stringify({...result,report:relative(ROOT,report).replaceAll('\\','/')},null,2));
 return result.passed?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))process.exitCode=await runRestoreFromBundle();
