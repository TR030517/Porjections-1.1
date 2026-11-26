import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptExplicitLogin, logoutIntent, markExplicitLogout } from './logoutIntent';
import { clearSession, currentManagementSessionKey, loginWithPassword, logoutSession, restoreSession } from './session';

const user = { id: '501', role: 'ADMIN' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(run: (calls: string[], setLogout: (fn: () => Promise<Response>) => void) => Promise<void>) {
  const descriptors = ['window','document'].map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)] as const), oldFetch = globalThis.fetch;
  const values = new Map<string,string>(), cookies = new Map<string,string>();
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{get cookie(){return [...cookies].map(([k,v])=>k+'='+v).join('; ');},set cookie(v:string){const pair=v.split(';')[0],at=pair.indexOf('=');if(v.includes('Max-Age=0'))cookies.delete(pair.slice(0,at));else cookies.set(pair.slice(0,at),pair.slice(at+1));}}});
  const calls:string[]=[];let logout=async()=>Response.json({message:'Unavailable'},{status:503});
  globalThis.fetch=async(input)=>{const path=String(input);calls.push(path);if(path.endsWith('/logout'))return logout();if(path.endsWith('/me'))return Response.json(user);return Response.json({accessToken:'synthetic-only',user});};
  acceptExplicitLogin(logoutIntent()); clearSession();
  try { await run(calls,fn=>{logout=fn;}); }
  finally { clearSession(); acceptExplicitLogin(logoutIntent()); globalThis.fetch=oldFetch;for(const [k,d]of descriptors){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);} }
}
test('failed logout blocks restoring the surviving cookie and explicit successful login reopens restoration',async()=>fixture(async(calls)=>{
  await loginWithPassword('synthetic','synthetic');await assert.rejects(logoutSession());assert.ok(logoutIntent());
  clearSession();const count=calls.length;assert.equal(await restoreSession(),null);assert.equal(calls.length,count,'no refresh of a surviving cookie');
  await loginWithPassword('synthetic','synthetic');assert.equal(logoutIntent(),null);clearSession();assert.equal((await restoreSession())?.id,user.id);
}));
test('a late logout receipt cannot clear a newer explicit login',async()=>fixture(async(_calls,setLogout)=>{
  await loginWithPassword('synthetic','synthetic');const gate=deferred<Response>();setLogout(()=>gate.promise);
  const old=logoutSession();await loginWithPassword('synthetic','synthetic');const identity=currentManagementSessionKey();gate.resolve(Response.json({ok:true}));await old;
  assert.equal(currentManagementSessionKey(),identity);assert.equal(logoutIntent(),null);
}));
test('a logout in another page prevents an earlier in-flight login from erasing its intent',async()=>fixture(async()=>{
  const original=globalThis.fetch,gate=deferred<Response>();globalThis.fetch=async(input,options)=>String(input).endsWith('/login')?gate.promise:original(input,options);
  const pending=loginWithPassword('synthetic','synthetic');const rejected=assert.rejects(pending);markExplicitLogout();gate.resolve(Response.json({accessToken:'synthetic-only',user}));await rejected;
  assert.ok(logoutIntent());assert.equal(currentManagementSessionKey(),null);
}));
test('a cross-page logout also fences an already pending refresh',async()=>fixture(async(calls)=>{
  const original=globalThis.fetch,gate=deferred<Response>();globalThis.fetch=async(input,options)=>String(input).endsWith('/refresh')?gate.promise:original(input,options);
  const restore=restoreSession();markExplicitLogout();gate.resolve(Response.json({accessToken:'synthetic-only',user}));
  assert.equal(await restore,null);assert.equal(currentManagementSessionKey(),null);assert.equal(calls.filter(p=>p.endsWith('/me')).length,0);
}));
test('cookie fallback preserves distinct logout tokens when localStorage is unavailable',async()=>fixture(async()=>{
  const get=window.localStorage.getItem;window.localStorage.getItem=()=>{throw Error('storage disabled');};
  try { assert.equal(logoutIntent(),null);markExplicitLogout();const first=logoutIntent();assert.ok(first);markExplicitLogout();assert.notEqual(logoutIntent(),first);assert.equal(acceptExplicitLogin(first),false);assert.equal(acceptExplicitLogin(logoutIntent()),true);assert.equal(logoutIntent(),null); }
  finally { window.localStorage.getItem=get; }
}));
