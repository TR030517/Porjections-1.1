import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promises as fs} from 'node:fs';
import {ROOT,readTask,readCredentialTarget,validateBundle,restoreBundle,restoreErrorCode} from './backup-lib.mjs';

export async function runRestore(args=process.argv.slice(2)) {
 try {
  if(!args.length||args.length===1&&args[0]==='--help'){console.log('Offline verify: node scripts/restore-check.mjs --bundle .local/backups/<bundle>\nNew-target drill: add --config .local/source.json --restore-db-container <isolated-phase5-db> --media-target-config .local/new-media.json --credential-target-config .local/new-vault.json --expected-bundle-digest <sha256> --acknowledge-local-restore\nVersion 3 requires a new credential directory and an external recovery key; version 2 does not include credentials. No .env input, source mutation, reuse or automatic target deletion.');return 0;}
  const options={};for(let i=0;i<args.length;i++){const key=args[i];if(Object.hasOwn(options,key))throw Error();if(key==='--acknowledge-local-restore')options[key]=true;else if(['--bundle','--config','--restore-db-container','--media-target-config','--credential-target-config','--expected-bundle-digest'].includes(key)&&args[i+1]&&!args[i+1].startsWith('-'))options[key]=args[++i];else throw Error();}
  if(!options['--bundle'])throw Error('LOCAL_SNAPSHOT_BUNDLE_REQUIRED');
  if(!options['--acknowledge-local-restore']) {
   if(options['--config']||options['--restore-db-container']||options['--media-target-config']||options['--credential-target-config'])throw Error('RESTORE_CONFIG_WITHOUT_ACKNOWLEDGEMENT');
   const{manifest}=await validateBundle(options['--bundle'],options['--expected-bundle-digest']);console.log(JSON.stringify({passed:true,mode:'offline-bundle-verification',bundleDigest:manifest.bundleDigest,tables:manifest.snapshot.tables.length,migrations:manifest.snapshot.migrations.length,mediaFiles:manifest.media.files.length,credentialVaultIncluded:manifest.schemaVersion===3,credentialCiphertextVerified:manifest.schemaVersion===3,credentialsAuthenticated:false,databaseAccessed:false,mediaTargetAccessed:false,credentialTargetAccessed:false,deploymentReady:false},null,2));return 0;
  }
  if(!options['--config']||!options['--expected-bundle-digest'])throw Error('EXPLICIT_NEW_TARGET_RESTORE_ACK_AND_DIGEST_REQUIRED');
  const config=await readTask(options['--config']),target=options['--media-target-config']?await readTask(options['--media-target-config'],true):undefined,credentialTarget=options['--credential-target-config']?await readCredentialTarget(options['--credential-target-config']):undefined;
  const result=await restoreBundle(config,options['--bundle'],{target,credentialTarget,expectedDigest:options['--expected-bundle-digest'],acknowledged:true,...(options['--restore-db-container']?{targetDbContainer:options['--restore-db-container']}:{})});
  const folder=resolve(ROOT,'.local/restore-reports');await fs.mkdir(folder,{recursive:true,mode:0o700});const report=resolve(folder,(result.database??'refused')+'-'+Date.now()+'.json');await fs.writeFile(report,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...result,report:report.slice(ROOT.length+1).replaceAll('\\','/')},null,2));return result.passed?0:1;
 }catch(error){const code=restoreErrorCode(error);console.error(JSON.stringify({passed:false,error:{code},deploymentReady:false}));return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))process.exitCode=await runRestore();
