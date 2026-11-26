import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {backupBundle,backupErrorDetails,readTask,repositoryMigrations} from './backup-lib.mjs';

export async function runBackup(args=process.argv.slice(2)) {
 try {
  if(!args.length||args.length===1&&['--plan','--help'].includes(args[0])) {
   const migrations=await repositoryMigrations();
   console.log(JSON.stringify({mode:'offline-plan',format:'massajoy-local-snapshot',schemaVersion:2,credentialBundleSchemaVersion:3,availableMigrations:migrations.map(row=>row.name),databaseAccessed:false,mediaAccessed:false,credentialVaultAccessed:false,usage:'node scripts/backup.mjs --config .local/task.json --acknowledge-business-data --acknowledge-writers-stopped [--output .local/backups/new-bundle]',scope:'Local-only stopped-writer DB and managed-media snapshot; optional credentialVault {directory,recoveryKeyFile,sourceKeyFile?} adds encrypted credentials and receipts as version 3. Preserve the independent recovery key and original JWT_SECRET separately. S3 blocked. Existing .env/compose invocation is intentionally not accepted.',deploymentReady:false},null,2));return 0;
  }
  const options={};for(let i=0;i<args.length;i++){const key=args[i];if(Object.hasOwn(options,key))throw Error();if(['--acknowledge-business-data','--acknowledge-writers-stopped'].includes(key))options[key]=true;else if(['--config','--output'].includes(key)&&args[i+1]&&!args[i+1].startsWith('-'))options[key]=args[++i];else throw Error();}
  if(!options['--config']||!options['--acknowledge-business-data']||!options['--acknowledge-writers-stopped'])throw Error('EXPLICIT_STOPPED_SOURCE_BACKUP_ACK_REQUIRED');
  const config=await readTask(options['--config']);const result=await backupBundle(config,{acknowledged:true,...(options['--output']?{directory:options['--output']}:{})});console.log(JSON.stringify(result,null,2));return 0;
 }catch(error){console.error(JSON.stringify({passed:false,error:backupErrorDetails(error),deploymentReady:false}));return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))process.exitCode=await runBackup();
