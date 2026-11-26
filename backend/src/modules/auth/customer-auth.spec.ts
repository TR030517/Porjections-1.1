import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { CustomerAuthService, emailCodeHash } from './customer-auth.service';
import { IdentityVerifier, identityConfig } from './identity-verifier';
import { EmailLoginDelivery, emailLoginConfig } from './email-login-delivery';
import { AuthService, hashToken } from './auth.service';
import { emailReauthProof, validEmailReauthProof } from './reauth-proof';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...createPublicKey(pair.privateKey).export({ format: 'jwk' }), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
class OfflineVerifier extends IdentityVerifier { protected async loadKeys() { return { keys: [jwk] }; } }
const envKeys = ['NODE_ENV','AUTH_LOCAL_OTP','AUTH_EMAIL_LOCAL_OTP','AUTH_EMAIL_PROVIDER','AUTH_EMAIL_API_KEY','AUTH_EMAIL_FROM','AUTH_GOOGLE_CLIENT_IDS','AUTH_GOOGLE_WEB_CLIENT_ID','AUTH_APPLE_CLIENT_IDS','AUTH_APPLE_WEB_CLIENT_ID','AUTH_APPLE_WEB_REDIRECT_URI','JWT_SECRET'];
const before = Object.fromEntries(envKeys.map(key => [key,process.env[key]]));
const claims = (patch: any = {}) => ({ iss: 'https://accounts.google.com', aud: 'synthetic-client', sub: 'stable-provider-subject', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300, nonce: 'n'.repeat(43), email: 'customer@example.invalid', email_verified: true, ...patch });
function token(payload: any, header: any = {}) {
  const h = Buffer.from(JSON.stringify({ alg:'RS256',kid:'synthetic-key',typ:'JWT',...header })).toString('base64url'), p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),pair.privateKey).toString('base64url');
}
beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env,{NODE_ENV:'test',AUTH_EMAIL_LOCAL_OTP:'true',AUTH_GOOGLE_CLIENT_IDS:'synthetic-client',AUTH_APPLE_CLIENT_IDS:'synthetic-apple',JWT_SECRET:'8h4JwQ9_v!R7mL2#sU5cP0@xA3zE6$kD'});
});
afterAll(() => { for (const key of envKeys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });

describe('official identity signature and claim boundaries (synthetic RSA, no network)', () => {
  test('accepts a signed allowlisted Google token with stable subject and verified email', async () => {
    expect(await new OfflineVerifier().verify('GOOGLE',token(claims()))).toMatchObject({provider:'GOOGLE',subject:'stable-provider-subject',email:'customer@example.invalid',emailVerified:true});
  });
  test('accepts Apple issuer and string email verification only with the Apple audience', async () => {
    expect(await new OfflineVerifier().verify('APPLE',token(claims({iss:'https://appleid.apple.com',aud:'synthetic-apple',email_verified:'true'})))).toMatchObject({provider:'APPLE',emailVerified:true});
  });
  test.each([
    ['wrong issuer',{iss:'https://attacker.invalid'}], ['wrong audience',{aud:'other-client'}], ['array audience',{aud:['synthetic-client']}],
    ['expired',{exp:1}], ['future issued',{iat:Math.floor(Date.now()/1000)+1000}], ['stale issued',{iat:1}],
    ['no nonce',{nonce:undefined}], ['empty subject',{sub:''}], ['wrong azp',{azp:'attacker'}], ['future nbf',{nbf:Math.floor(Date.now()/1000)+500}],
  ])('rejects %s',async (_name,patch) => { await expect(new OfflineVerifier().verify('GOOGLE',token(claims(patch)))).rejects.toThrow('Invalid identity claims'); });
  test.each([{alg:'none'},{alg:'HS256'},{kid:'missing'},{jku:'https://attacker.invalid/keys'},{crit:['injected']}])('rejects unsafe header %j',async header => {
    await expect(new OfflineVerifier().verify('GOOGLE',token(claims(),header))).rejects.toThrow();
  });
  test('does not use an unverified email and rejects modified signed claims',async () => {
    expect((await new OfflineVerifier().verify('GOOGLE',token(claims({email_verified:false})))).email).toBeUndefined();
    const parts = token(claims()).split('.'); parts[1]=Buffer.from(JSON.stringify(claims({sub:'changed'}))).toString('base64url');
    await expect(new OfflineVerifier().verify('GOOGLE',parts.join('.'))).rejects.toThrow('Invalid identity signature');
  });
  test('missing client configuration fails closed before any JWKS request',async () => {
    delete process.env.AUTH_GOOGLE_CLIENT_IDS;
    expect(identityConfig('GOOGLE').enabled).toBe(false);
    await expect(new OfflineVerifier().verify('GOOGLE','unused')).rejects.toThrow('not configured');
  });
  test('web configuration requires an allowlisted client and secure Apple redirect',() => {
    process.env.AUTH_APPLE_WEB_CLIENT_ID='synthetic-apple'; process.env.AUTH_APPLE_WEB_REDIRECT_URI='http://external.invalid/callback';
    expect(identityConfig('APPLE').webEnabled).toBe(false);
    process.env.AUTH_APPLE_WEB_REDIRECT_URI='https://site.invalid/callback'; expect(identityConfig('APPLE').webEnabled).toBe(true);
  });
});

function emailFixture() {
  let user: any = null, throttle: any = null, count = 0, queue = Promise.resolve(); const rows = new Map<string,any>();
  const db: any = {
    $queryRaw: async () => [],
    emailLoginThrottle: { upsert: async ({create}:any) => throttle ??= {...create}, findUniqueOrThrow: async () => throttle, update: async ({data}:any) => throttle={...throttle,...data} },
    emailLoginChallenge: {
      create: async ({data}:any) => { const row={...data,deliveryState:'PENDING',consumedAt:null,attempts:0};rows.set(row.id,row);return row; },
      findUnique: async ({where}:any) => rows.get(where.id) ?? null,
      update: async ({where,data}:any) => { const row=rows.get(where.id); const copy={...data}; if (copy.attempts?.increment) copy.attempts=row.attempts+copy.attempts.increment;Object.assign(row,copy);return row; },
      updateMany: async ({where,data}:any) => { let changed=0;for(const row of rows.values()){
        if(where.id && where.id!==row.id || where.email && where.email!==row.email || where.deliveryState && where.deliveryState!==row.deliveryState || where.consumedAt===null && row.consumedAt || where.expiresAt && row.expiresAt<=where.expiresAt.gt)continue;
        Object.assign(row,data); changed++;
      }return {count:changed}; },
    },
    user: { findUnique: async () => user, create: async ({data}:any) => user={...data,id:BigInt(++count),passwordHash:null}, update: async ({data}:any) => user={...user,...data} },
  };
  db.$transaction = (fn:any) => { const result=queue.then(()=>fn(db));queue=result.catch(()=>{});return result; };
  const auth={createCustomerSession:jest.fn(async (u:any)=>({user:{...u,id:String(u.id)}}))};
  const delivery={send:jest.fn(async()=>{})};
  const service=new CustomerAuthService(db,auth as any,new OfflineVerifier(),delivery as any);
  return {service,db,rows,auth,delivery,setUser:(u:any)=>user=u,allowResend:()=>{throttle.lastSentAt=new Date(0);},getUser:()=>user};
}
describe('persistent one-time email challenge and customer-only boundaries (transaction substitute)',()=>{
  test('email reauthentication proof is short-lived, user/session-bound, tamper-evident and not an access JWT',()=>{
    const now=Date.now(),proof=emailReauthProof('1','session-a',now);
    expect(proof.split('.')).toHaveLength(2);
    expect(validEmailReauthProof(proof,'1','session-a',now)).toBe(true);
    expect(validEmailReauthProof(proof,'2','session-a',now)).toBe(false);
    expect(validEmailReauthProof(proof,'1','session-b',now)).toBe(false);
    expect(validEmailReauthProof(proof,'1','session-a',now+300001)).toBe(false);
    expect(validEmailReauthProof(proof.slice(0,-3)+'abc','1','session-a',now)).toBe(false);
  });
  test('stores only domain-separated code hash; no phone or management role is manufactured',async()=>{
    const f=emailFixture(), sent=await f.service.requestEmail('CUSTOMER@example.invalid');
    expect(f.rows.get(sent.challengeId).codeHash).not.toBe(sent.devCode);
    expect(f.rows.get(sent.challengeId).codeHash).toBe(emailCodeHash(sent.challengeId,'customer@example.invalid',sent.devCode!));
    const result=await f.service.verifyEmail(sent.challengeId,sent.devCode!);expect(result.user.role).toBe('CUSTOMER');expect(f.getUser().phone).toBeNull();expect(f.getUser().emailVerifiedAt).toBeInstanceOf(Date);
    await expect(f.service.verifyEmail(sent.challengeId,sent.devCode!)).rejects.toThrow('Invalid email code');
  });
  test('current-account email verification proves the saved address without rotating identity',async()=>{
    const f=emailFixture();f.setUser({id:1n,email:'customer@example.invalid',emailVerifiedAt:null,role:'CUSTOMER',status:'ACTIVE',deletedAt:null});
    const sent=await f.service.requestEmail('customer@example.invalid');
    await expect(f.service.verifyCurrentEmail('1',sent.challengeId,sent.devCode!)).resolves.toEqual({verified:true});
    expect(f.getUser().emailVerifiedAt).toBeInstanceOf(Date);
    expect(f.auth.createCustomerSession).not.toHaveBeenCalled();
    await expect(f.service.verifyCurrentEmail('1',sent.challengeId,sent.devCode!)).rejects.toThrow('Invalid email code');
  });
  test('a valid code for another mailbox cannot verify the current customer',async()=>{
    const f=emailFixture();f.setUser({id:1n,email:'current@example.invalid',emailVerifiedAt:null,role:'CUSTOMER',status:'ACTIVE',deletedAt:null});
    const sent=await f.service.requestEmail('different@example.invalid');
    await expect(f.service.verifyCurrentEmail('1',sent.challengeId,sent.devCode!)).rejects.toThrow('Invalid email code');
    expect(f.getUser().emailVerifiedAt).toBeNull();expect(f.auth.createCustomerSession).not.toHaveBeenCalled();
  });
  test('two competing consumes yield one session; no second successful login',async()=>{
    const f=emailFixture(),sent=await f.service.requestEmail('customer@example.invalid');
    const result=await Promise.allSettled([f.service.verifyEmail(sent.challengeId,sent.devCode!),f.service.verifyEmail(sent.challengeId,sent.devCode!)]);
    expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(f.auth.createCustomerSession).toHaveBeenCalledTimes(1);
  });
  test('five wrong codes persist attempt consumption and correct code cannot bypass it',async()=>{
    const f=emailFixture(),sent=await f.service.requestEmail('customer@example.invalid');const wrong=sent.devCode==='000000'?'111111':'000000';
    for(let i=0;i<5;i++)await expect(f.service.verifyEmail(sent.challengeId,wrong)).rejects.toThrow();
    expect(f.rows.get(sent.challengeId).attempts).toBe(5);expect(f.rows.get(sent.challengeId).consumedAt).toBeInstanceOf(Date);
    await expect(f.service.verifyEmail(sent.challengeId,sent.devCode!)).rejects.toThrow();expect(f.auth.createCustomerSession).not.toHaveBeenCalled();
  });
  test('expiry, resend and per-mailbox limits remain effective',async()=>{
    const f=emailFixture(),first=await f.service.requestEmail('customer@example.invalid');
    await expect(f.service.requestEmail('customer@example.invalid')).rejects.toThrow('RATE_LIMITED');
    f.rows.get(first.challengeId).expiresAt=new Date(0);await expect(f.service.verifyEmail(first.challengeId,first.devCode!)).rejects.toThrow();
    f.allowResend();const next=await f.service.requestEmail('customer@example.invalid');expect(f.rows.get(first.challengeId).consumedAt).toBeInstanceOf(Date);
    expect(next.challengeId).not.toBe(first.challengeId);
  });
  test.each(['ADMIN','MERCHANT','STAFF'])('never signs in or downgrades an existing %s email',async role=>{
    const f=emailFixture();f.setUser({id:1n,email:'manager@example.invalid',role,status:'ACTIVE'});
    await expect(f.service.requestEmail('manager@example.invalid')).rejects.toThrow('unavailable');expect(f.delivery.send).not.toHaveBeenCalled();expect(f.getUser().role).toBe(role);
  });
  test('provider failure leaves code unusable and returns no secret provider error',async()=>{
    const f=emailFixture();f.delivery.send.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_CREDENTIAL'));
    await expect(f.service.requestEmail('customer@example.invalid')).rejects.toThrow('Email delivery is temporarily unavailable');
    expect([...f.rows.values()][0].deliveryState).toBe('FAILED');expect(f.auth.createCustomerSession).not.toHaveBeenCalled();
  });
  test('production never enables the development code path',()=>{
    process.env.NODE_ENV='production';expect(emailLoginConfig().enabled).toBe(false);expect(emailLoginConfig().devOnly).toBe(false);
    expect(new CustomerAuthService({} as any, {} as any, {} as any, {} as any).config()).toMatchObject({ passwordEnabled: true, passwordRegistrationEnabled: false });
  });
  test('customer password endpoint rejects manager before session creation; global management login remains separate',async()=>{
    const auth=new AuthService({user:{findMany:async()=>[{id:1n,role:'ADMIN',status:'ACTIVE',passwordHash:'not-a-real-hash'}]}} as any,{} as any);
    await expect(auth.passwordLogin('manager@example.invalid','password','CUSTOMER')).rejects.toThrow('Invalid credentials');
  });
  test('even explicitly enabled local phone OTP cannot authenticate a management account',async()=>{
    process.env.AUTH_LOCAL_OTP='true';
    const auth=new AuthService({user:{upsert:async()=>({id:1n,role:'ADMIN',status:'ACTIVE'})}} as any,{} as any);
    (auth as any).otpStore.set('+12025550100',{hash:hashToken('123456'),expires:Date.now()+10000,sent:Date.now(),attempts:0});
    await expect(auth.verifyOtp('+12025550100','123456')).rejects.toThrow('Customer account unavailable');
  });
});
