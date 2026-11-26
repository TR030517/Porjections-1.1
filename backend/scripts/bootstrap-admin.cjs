// Run once per new environment. Password is read from stdin, never an argument or log.
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const { createInterface } = require('node:readline');
const { Writable } = require('node:stream');
const { validRolePassword } = require('./lib/password-policy.cjs');
async function readPassword() {
  if(!process.stdin.isTTY) {
    let value='';for await(const chunk of process.stdin){value+=chunk;if(value.length>200)throw Error('Password too long');}
    return value.replace(/\r?\n$/,'');
  }
  process.stdout.write('Administrator password (hidden): ');
  const muted=new Writable({write(_chunk,_encoding,done){done();}});
  const input=createInterface({input:process.stdin,output:muted,terminal:true});
  let answered=false;
  input.once('SIGINT',()=>input.close());
  try {
    return await new Promise((resolve,reject)=>{
      input.once('close',()=>{if(!answered)reject(Error('Cancelled'));});
      input.question('',value=>{answered=true;resolve(value);});
    });
  } finally {input.close();process.stdout.write('\n');}
}
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const email=(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const phone=process.env.ADMIN_PHONE || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Set ADMIN_EMAIL and ADMIN_PHONE (E.164)');
  let password=await readPassword();
  if(!validRolePassword(password,'ADMIN')) throw new Error('Password must be 12–72 UTF-8 bytes without NUL or line breaks');
  const prisma=new PrismaClient();
  try {
    if(await prisma.user.findFirst({where:{OR:[{email},{phone}]}})) throw new Error('Account exists; bootstrap never overwrites credentials');
    const passwordHash=await hash(password,12);
    await prisma.$transaction(async tx=>{
      const admin=await tx.user.create({data:{email,phone,name:process.env.ADMIN_NAME || 'Administrator',passwordHash,role:'ADMIN',status:'ACTIVE'}});
      for(const [key,value,description] of [['site_name','Massajoy','站点名称'],['support_email','','客服邮箱（未配置）'],['support_phone','','客服电话（未配置）']]) {
        await tx.platformConfig.upsert({where:{key},create:{key,value,description,isPublic:true},update:{}});
      }
      await tx.auditLog.create({data:{action:'CLI_BOOTSTRAP_ADMIN',targetType:'USER',targetId:admin.id,operatorId:admin.id,detail:{method:'stdin',secretsLogged:false}}});
    });
    console.log('Administrator created. No credentials were logged.');
  } finally { password=''; await prisma.$disconnect(); }
}
if (require.main === module) main().catch(()=>{console.error('Bootstrap failed: verify inputs, database connectivity and account uniqueness.');process.exitCode=1;});
module.exports = { main };
