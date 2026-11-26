'use strict';
// Invoked only by the root's fresh, isolated account-batch runner. No connections or providers are created here.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
exports.runCustomerAuth = async function runCustomerAuth(db, { check }) {
  const [database] = await db.$queryRawUnsafe('SELECT DATABASE() AS name');
  assert.match(database.name, /^mj2_test_[a-z0-9_]+$/);
  const { CustomerAuthService } = require('../dist/modules/auth/customer-auth.service');
  const { AuthService } = require('../dist/modules/auth/auth.service');
  const { JwtService } = require('@nestjs/jwt');
  const { hash } = require('bcryptjs');
  const keys = ['NODE_ENV','AUTH_EMAIL_LOCAL_OTP','AUTH_GOOGLE_CLIENT_IDS'];
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  const prefix = 'qa'+randomUUID().replaceAll('-','');
  const emails = [prefix+'@example.invalid',prefix+'wrong@example.invalid',prefix+'owner@example.invalid',prefix+'social@example.invalid'];
  const challenges = [], users = [];
  Object.assign(process.env,{NODE_ENV:'test',AUTH_EMAIL_LOCAL_OTP:'true',AUTH_GOOGLE_CLIENT_IDS:'synthetic-client'});
  const jwt = new JwtService({secret:randomUUID()+randomUUID()});
  const auth = new AuthService(db,jwt), verified = new Map();
  const customer = new CustomerAuthService(db,auth,{verify:async (_provider,token)=>{assert(verified.has(token));return verified.get(token);}},{send:async()=>{}});
  const social = async (subject,email) => {
    const challenge=await customer.socialChallenge('GOOGLE');challenges.push(challenge.challengeId);
    const token=randomUUID();verified.set(token,{provider:'GOOGLE',subject,nonce:challenge.nonce,email,emailVerified:!!email});
    return {idToken:token,challengeId:challenge.challengeId};
  };
  try {
    await check('customer email challenge is durable and exactly one competing consume creates a session',async()=>{
      const sent=await customer.requestEmail(emails[0]);
      const stored=await db.emailLoginChallenge.findUniqueOrThrow({where:{id:sent.challengeId}});assert.notEqual(stored.codeHash,sent.devCode);
      const results=await Promise.allSettled([customer.verifyEmail(sent.challengeId,sent.devCode),customer.verifyEmail(sent.challengeId,sent.devCode)]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      const user=await db.user.findUniqueOrThrow({where:{email:emails[0]}});users.push(user.id);assert.equal(user.role,'CUSTOMER');assert.equal(user.phone,null);assert(user.emailVerifiedAt);
      assert.equal(await db.authSession.count({where:{userId:user.id}}),1);
    });
    await check('wrong email code attempts persist and the correct code cannot revive an exhausted challenge',async()=>{
      const sent=await customer.requestEmail(emails[1]),wrong=sent.devCode==='000000'?'111111':'000000';
      for(let n=0;n<5;n++)await assert.rejects(customer.verifyEmail(sent.challengeId,wrong));
      const row=await db.emailLoginChallenge.findUniqueOrThrow({where:{id:sent.challengeId}});assert.equal(row.attempts,5);assert(row.consumedAt);
      await assert.rejects(customer.verifyEmail(sent.challengeId,sent.devCode));assert.equal(await db.user.count({where:{email:emails[1]}}),0);
    });
    await check('management mailbox cannot be logged into or downgraded by customer email or password entry',async()=>{
      const password='Synthetic-only-password-'+randomUUID();
      const manager=await db.user.create({data:{email:emails[2],phone:null,role:'ADMIN',status:'ACTIVE',passwordHash:await hash(password,12)}});users.push(manager.id);
      await assert.rejects(customer.requestEmail(emails[2]));await assert.rejects(auth.passwordLogin(emails[2],password,'CUSTOMER'));
      const current=await db.user.findUniqueOrThrow({where:{id:manager.id}});assert.equal(current.role,'ADMIN');assert.equal(await db.authSession.count({where:{userId:manager.id}}),0);
      const input=await social(prefix+'-management-subject',emails[2]);await assert.rejects(customer.socialLogin('GOOGLE',input),/CUSTOMER_ACCOUNT_LINK_REQUIRED/);
      assert.equal(await db.authProviderIdentity.count({where:{userId:manager.id}}),0);
    });
    await check('concurrent stable provider subject remains one customer and one identity',async()=>{
      const first=await social(prefix+'-stable-subject',emails[3]),second=await social(prefix+'-stable-subject',emails[3]);
      const result=await Promise.allSettled([customer.socialLogin('GOOGLE',first),customer.socialLogin('GOOGLE',second)]);assert(result.some(x=>x.status==='fulfilled'));
      const matches=await db.authProviderIdentity.findMany({where:{provider:'GOOGLE',subject:prefix+'-stable-subject'},include:{user:true}});assert.equal(matches.length,1);assert.equal(matches[0].user.role,'CUSTOMER');users.push(matches[0].userId);
      assert.equal(await db.user.count({where:{email:emails[3]}}),1);
      const repeat=await social(prefix+'-stable-subject',emails[3]);const session=await customer.socialLogin('GOOGLE',repeat);assert.equal(session.user.id,String(matches[0].userId));
      await assert.rejects(customer.socialLogin('GOOGLE',repeat));
    });
    await check('matching customer email needs password reauthentication and explicit provider link',async()=>{
      const existing=await db.user.findUniqueOrThrow({where:{email:emails[0]}}),password='Synthetic-reauthentication-'+randomUUID();
      await db.user.update({where:{id:existing.id},data:{passwordHash:await hash(password,12)}});
      const input=await social(prefix+'-explicit-link',emails[0]);await assert.rejects(customer.socialLogin('GOOGLE',input),/CUSTOMER_ACCOUNT_LINK_REQUIRED/);
      await assert.rejects(customer.linkProvider(String(existing.id),'GOOGLE',{...input,password:'incorrect'}));
      const result=await customer.linkProvider(String(existing.id),'GOOGLE',{...input,password});assert.equal(result.linked,true);
      const identity=await db.authProviderIdentity.findUniqueOrThrow({where:{provider_subject:{provider:'GOOGLE',subject:prefix+'-explicit-link'}}});assert.equal(identity.userId,existing.id);
    });
    await check('passwordless email customer can explicitly link with a fresh proof bound to the same authenticated session',async()=>{
      const sent=await customer.requestEmail(emails[3]),session=await customer.verifyEmail(sent.challengeId,sent.devCode);
      assert.equal(typeof session.reauthToken,'string');const sid=jwt.verify(session.accessToken).sid;
      const input=await social(prefix+'-email-link',emails[3]);
      await assert.rejects(customer.linkProvider(session.user.id,'GOOGLE',{...input,reauthToken:session.reauthToken},'wrong-session'));
      const linked=await customer.linkProvider(session.user.id,'GOOGLE',{...input,reauthToken:session.reauthToken},sid);assert.equal(linked.linked,true);
      await assert.rejects(customer.socialLogin('GOOGLE',input));
    });
  } finally {
    // Exact random fixture ownership; no pre-existing rows are deleted.
    const remaining=await db.user.findMany({where:{email:{in:emails}},select:{id:true}});
    for(const user of remaining)if(!users.includes(user.id))users.push(user.id);
    await db.authProviderIdentity.deleteMany({where:{userId:{in:users}}});
    await db.authSession.deleteMany({where:{userId:{in:users}}});
    await db.user.deleteMany({where:{id:{in:users},email:{in:emails}}});
    await db.socialLoginChallenge.deleteMany({where:{id:{in:challenges}}});
    await db.emailLoginChallenge.deleteMany({where:{email:{in:emails}}});
    await db.emailLoginThrottle.deleteMany({where:{email:{in:emails}}});
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  }
};
