import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const npm=process.platform==='win32'?'npm.cmd':'npm';
const commands=[['admin types','.', ['run','typecheck']],['admin build','.', ['run','build']],['merchant build','merchant-web',['run','build']],['API types','backend',['run','typecheck']],['API build','backend',['run','build']]];
const results=[];
for(const [name,cwd,args] of commands){const result=spawnSync(npm,args,{cwd,shell:process.platform==='win32',stdio:'inherit',windowsHide:true});results.push({name,passed:result.status===0});if(result.status!==0)break;}
mkdirSync('docs/verification',{recursive:true});writeFileSync('docs/verification/build-check.json',JSON.stringify({at:new Date().toISOString(),results,scope:'Node builds only. Flutter, integration, dependency audit and Docker checks are separate.'},null,2)+'\n');
process.exitCode=results.length===commands.length&&results.every(r=>r.passed)?0:1;
