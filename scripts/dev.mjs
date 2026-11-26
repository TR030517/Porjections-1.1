import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';

const root=fileURLToPath(new URL('../',import.meta.url));
const configured=process.argv.find(value=>value.startsWith('--env-file='))?.slice(11);
// Prefer this project's full migration dataset over the old five-store sample.
const envFile=path.resolve(root,configured || (existsSync(path.join(root,'.local/legacy-store-import-20261105/preview.env'))
  ? '.local/legacy-store-import-20261105/preview.env' : 'backend/.env.local'));
if(!existsSync(envFile)) throw new Error('Create backend/.env.local or pass --env-file=<local API env file>.');
const database=readFileSync(envFile,'utf8').match(/^DATABASE_URL\s*=\s*["']?([^\r\n"']+)/m)?.[1];
if(!database) throw new Error('The selected API env file has no DATABASE_URL.');
const dbUrl=new URL(database);
console.log(`API source runtime; database ${dbUrl.hostname}:${dbUrl.port}/${dbUrl.pathname.slice(1)} (credentials hidden).`);
await Promise.all([3000,3002,3004,8002].map(port=>new Promise((resolve,reject)=>{
  const server=net.createServer();server.once('error',()=>reject(new Error(`Port ${port} is already in use; stop that project process first.`)));
  server.listen(port,'127.0.0.1',()=>server.close(resolve));
})));
if(!existsSync(path.join(root,'customer-app/build/web/index.html'))) throw new Error('Customer web assets are missing. Run npm run customer:update before starting the preview.');
const children=[];let stopping=false;
function stop(code=0){
  if(stopping)return;stopping=true;process.exitCode=code;
  for(const child of children) {
    if(process.platform==='win32') spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
    else child.kill('SIGTERM');
  }
}
function start(cwd,args) {
  const child=spawn(process.execPath,args,{cwd,stdio:'inherit',windowsHide:true});children.push(child);
  child.once('error',error=>{console.error(error.message);stop(1);});
  child.once('exit',code=>{if(!stopping)stop(code??1);});
  return child;
}
process.once('SIGINT',()=>stop());process.once('SIGTERM',()=>stop());
start(path.join(root,'backend'),[`--env-file=${envFile}`,'--require','ts-node/register/transpile-only','src/main.ts']);
// Start browser entry points only after the source API is ready, so their
// initial session refresh cannot race database/API startup.
const deadline=Date.now()+30000;
let apiReady=false;
while(!stopping&&Date.now()<deadline) {
  try { const response=await fetch('http://127.0.0.1:8002/api/v1/health',{signal:AbortSignal.timeout(1000)});apiReady=response.ok;await response.body?.cancel();if(apiReady)break; }
  catch {}
  await new Promise(resolve=>setTimeout(resolve,250));
}
if(!apiReady) {console.error('Source API did not become ready; browser entry points were not started.');stop(1);}
if(!stopping)for(const [cwd,args] of [
  [root,['node_modules/vite/bin/vite.js']],
  [path.join(root,'merchant-web'),['node_modules/vite/bin/vite.js']],
  [root,['scripts/customer-preview.mjs']],
]) {
  start(cwd,args);
}
if(!stopping) {
  console.log('Admin http://127.0.0.1:3000/admin/ | Merchant http://127.0.0.1:3002/merchant/ | Customer http://127.0.0.1:3004/');
  console.log('After customer source edits, run npm run customer:update to refresh the live Flutter preview assets.');
}
