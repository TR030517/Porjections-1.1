import {randomBytes} from 'node:crypto';import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
mkdirSync('.local',{recursive:true});const target='.local/compose.env';
if(existsSync(target)){console.log('Local environment already exists; secrets were preserved.');process.exit(0);}
const secret=()=>randomBytes(32).toString('hex');
writeFileSync(target,`RELEASE_TAG=2.0.0-rc13\nSITE_ADDRESS=:80\nPUBLIC_ORIGIN=http://127.0.0.1:8088\nTLS_EMAIL=local@example.invalid\nMYSQL_DATABASE=massajoy2_local\nMYSQL_ROOT_PASSWORD=${secret()}\nMYSQL_PASSWORD=${secret()}\nJWT_SECRET=${secret()}\nPAYMENT_PROVIDER=disabled\nPAYMENT_EXTERNAL_ENABLED=false\nPLATFORM_FEE_BPS=0\nBOOKING_HOLD_MINUTES=15\nNOTIFICATION_WORKER_ENABLED=true\nMEDIA_STORAGE_DRIVER=local\n`,{flag:'wx',mode:0o600});
console.log('Created .local/compose.env for loopback HTTP testing. Use compose.local.yaml together with compose.yaml.');
