/** Public intake semantics with a serialized, rollback-capable in-memory store.
 * These tests exercise service decisions; MySQL lock behavior is verified by
 * the separate isolated HTTP runner, not claimed by this substitute. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PublicIntakeService } from './public-intake.service';
import { ConflictException } from '@nestjs/common';
import { intakeDigest, intakeEmptyHours, INTAKE_MAX_BYTES, parseIntakePackage } from './public-intake.validation';

const actor={id:'1',role:'ADMIN'}, other={id:'2',role:'ADMIN'};
const hours=()=>Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d=>[d,[{start:'09:00',end:'21:00'}]]));
const row=(id='11')=>({sourceEntity:'merchant',sourceId:String(1000+Number(id)),targetShopId:id,match:{name:`Synthetic ${id}`,shortName:`Synthetic${id}`},sourceUrls:['https://app.asianmassagebook.com/admin#/merchant/index'],description:'Verified public description',businessHours:hours(),rawCatalog:[]});
const packet=(...rows:any[])=>({schemaVersion:1,sourceSystem:'massajoy1',batchId:'synthetic-intake',capturedAt:'2026-10-28T00:00:00Z',shops:rows.length?rows:[row()]});
const target=(id:bigint)=>({id,name:`Synthetic ${id}`,shortName:`Synthetic${id}`,address:`Synthetic address ${id}`,description:null,businessHours:null,deletedAt:null,status:'PENDING',ownerId:900n,timezone:null,phone:null,loginBinding:null,updatedAt:new Date('2026-10-01T00:00:00Z')});
const copy=<T>(value:T):T=>structuredClone(value);
function fixture(){
  const shops=new Map<bigint,any>([11n,12n,13n].map(id=>[id,target(id)])),users=new Map<bigint,any>([1n,2n].map(id=>[id,{id,role:'ADMIN',status:'ACTIVE',deletedAt:null}]));
  const audits:any[]=[],locks:any[]=[],writes:any[]=[];let queue=Promise.resolve(),failAudit=false;
  const db:any={
    $queryRaw:jest.fn(async (query:any)=>{locks.push({table:query.strings.join('').includes('FROM shops')?'shops':'users',id:query.values[0]});return [];}),
    user:{findFirst:jest.fn(async ({where}:any)=>{const u=users.get(where.id);return u&&u.role===where.role&&u.status===where.status&&u.deletedAt===where.deletedAt?{id:u.id}:null;})},
    shop:{findUnique:jest.fn(async ({where}:any)=>copy(shops.get(where.id)??null)),update:jest.fn(async ({where,data}:any)=>{writes.push(copy({id:where.id,data}));const next={...shops.get(where.id),...copy(data),updatedAt:new Date()};shops.set(where.id,next);return copy(next);})},
    booking:{findMany:jest.fn(async()=>[])},bookingResourceLock:{findMany:jest.fn(async()=>[])},therapist:{findMany:jest.fn(async()=>[])},
    auditLog:{findMany:jest.fn(async ({where}:any)=>audits.filter(a=>a.operatorId===where.operatorId&&a.action===where.action&&a.targetType===where.targetType&&a.targetId===where.targetId&&a.detail.requestKeyHash===where.detail.equals).slice(-2).reverse().map(a=>({detail:copy(a.detail)}))),
      create:jest.fn(async ({data}:any)=>{if(failAudit)throw Error('Synthetic audit failure');audits.push(copy(data));return data;})},
  };
  db.$transaction=(work:any)=>{const pending=queue.then(async()=>{const beforeShops=copy(shops),beforeAudit=copy(audits),beforeWrites=copy(writes);try{return await work(db);}catch(e){shops.clear();for(const [id,s]of beforeShops)shops.set(id,s);audits.splice(0,audits.length,...beforeAudit);writes.splice(0,writes.length,...beforeWrites);throw e;}});queue=pending.catch(()=>undefined);return pending;};
  return {db,shops,users,audits,locks,writes,service:new PublicIntakeService(db),failAudit:()=>{failAudit=true;}};
}
const code=async(pending:Promise<any>,expected:string)=>{try{await pending;throw Error('Expected rejection');}catch(e:any){expect(e.getResponse?.().publicIntakeCode).toBe(expected);}};

describe('public intake package boundary',()=>{
  test('accepts the existing public 1.0 export without importing its raw catalog',()=>{
    const sample=JSON.parse(readFileSync(resolve(__dirname,'../../../..','data/exports/massajoy1-public-sample-2026-10-28.json'),'utf8'));
    const parsed=parseIntakePackage(sample);expect(parsed.sources).toHaveLength(1);expect(parsed.sources[0].issues).toEqual([]);expect(parsed.sources[0].rawCatalogItems).toBe(1);expect(parsed.sources[0].warnings.some(i=>i.code==='CATALOG_NOT_IMPORTED')).toBe(true);expect(parsed.sources[0].businessHours?.monday).toEqual({open:'09:00',close:'21:00',closed:false});
  });
  test('rejects top-level extras, oversized packets and impossible capture dates',()=>{
    expect(()=>parseIntakePackage({...packet(),actorId:'2'})).toThrow();expect(()=>parseIntakePackage(packet({...row(),description:'a'.repeat(INTAKE_MAX_BYTES)}))).toThrow();expect(()=>parseIntakePackage({...packet(),capturedAt:'2026-02-30T00:00:00Z'})).toThrow();
  });
  test('marks every duplicate source or target rather than silently choosing one',()=>{
    for(const rows of [[row(),{...row('12'),sourceId:row().sourceId}],[row(),{...row('12'),targetShopId:'11'}]])expect(parseIntakePackage(packet(...rows)).sources.every(s=>s.issues.some(i=>i.code==='DUPLICATE_MAPPING'))).toBe(true);
  });
  test.each(['ownerId','password','customerRecords','__proto__'])('rejects sensitive or prototype key %s inside otherwise ignored catalog',key=>{
    const bad=JSON.parse(`{"${key}":"never keep this"}`);expect(parseIntakePackage(packet({...row(),rawCatalog:[bad]})).sources[0].issues[0].code).toBe('SHOP_SHAPE_INVALID');
  });
  test('requires evidence, numeric actual source ID and at least one filled importable field',()=>{
    const empty:any={...row(),sourceId:'',sourceUrls:[],description:' '};delete empty.businessHours;const source=parseIntakePackage(packet(empty)).sources[0];expect(source.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['SOURCE_ID_INVALID','SOURCE_EVIDENCE_INVALID','NO_IMPORTABLE_FIELDS']));
    const template:any={...row(),description:''};delete template.businessHours;expect(parseIntakePackage(packet(template)).sources[0].issues.map(i=>i.code)).toContain('NO_IMPORTABLE_FIELDS');
  });
  test('compares recognized merchant detail IDs exactly and accepts generic legacy evidence', () => {
    const sourceId = '9007199254740997';
    const validUrls = [
      'https://app.asianmassagebook.com/admin#/merchant/index',
      'https://app.asianmassagebook.com/merchant#/merchant/setting',
      'https://app.asianmassagebook.com/admin/#/merchants/0009007199254740997',
      'https://app.asianmassagebook.com/admin/#/merchant/9007199254740997/',
    ];
    const matching = parseIntakePackage(packet({ ...row(), sourceId, sourceUrls: validUrls })).sources[0];
    expect(matching.issues).toEqual([]);
    expect(matching.sourceUrls).toEqual(validUrls);
    const wrongUrl = 'https://app.asianmassagebook.com/admin/#/merchants/9007199254740998';
    const foreignUrl = 'https://example.invalid/admin/#/merchants/9007199254740997';
    const mismatched = parseIntakePackage(packet({ ...row(), sourceId, sourceUrls: [...validUrls.slice(0, 2), wrongUrl, foreignUrl] })).sources[0];
    expect(mismatched.issues).toEqual([
      expect.objectContaining({ code: 'SOURCE_EVIDENCE_INVALID' }),
      expect.objectContaining({ code: 'SOURCE_MERCHANT_MISMATCH', field: 'sourceUrls', message: expect.stringContaining('#9007199254740998') }),
    ]);
    expect(mismatched.sourceUrls).toEqual([...validUrls.slice(0, 2), wrongUrl]);
  });
  test('requires seven days and ordered nonoverlapping valid periods',()=>{
    for(const replacement of [{mon:[]},{...hours(),mon:[{start:'09:00',end:'08:00'}]},{...hours(),mon:[{start:'09:00',end:'12:00'},{start:'11:00',end:'13:00'}]},{...hours(),mon:[{start:'23:00',end:'24:00'}]}]) expect(parseIntakePackage(packet({...row(),businessHours:replacement})).sources[0].issues.map(i=>i.code)).toContain('HOURS_INVALID');
  });
  test('all-closed configured hours are existing business data, only exact legacy empty placeholder counts empty',()=>{
    const closed=Object.fromEntries(Object.keys(hours()).map(d=>[d,[]]));expect(parseIntakePackage(packet({...row(),businessHours:closed})).sources[0].issues.map(i=>i.code)).toContain('HOURS_INVALID');
    expect(intakeEmptyHours({monday:{closed:true}})).toBe(false);expect(intakeEmptyHours({})).toBe(true);expect(intakeEmptyHours(Object.fromEntries(['周一','周二','周三','周四','周五','周六','周日'].map(d=>[d,{open:false,start:'',end:''}])))).toBe(true);
  });
});

describe('public intake transaction and authority',()=>{
  test('shows the actual destination and blocks the whole batch when one source link names a different merchant', async () => {
    const f = fixture();
    const wrongUrl = 'https://app.asianmassagebook.com/admin/#/merchants/1012';
    const input = packet({ ...row(), sourceUrls: [wrongUrl], match: { name: 'Wrong name in package', shortName: 'wrong-short-name' } }, row('12'));
    const result = await f.service.preview(actor, input);
    expect(result).toMatchObject({ canApply: false, previewToken: null, summary: { invalidShops: 1, readyShops: 1 } });
    expect(result.shops[0]).toMatchObject({
      status: 'INVALID',
      sourceUrls: [wrongUrl],
      currentTarget: { name: 'Synthetic 11', shortName: 'Synthetic11', address: 'Synthetic address 11' },
      issues: expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_MERCHANT_MISMATCH' })]),
    });
    expect(f.writes).toEqual([]);
  });
  test('rechecks source evidence at submit even when a preview was signed before stricter validation', async () => {
    const f = fixture();
    const input = packet(row('12'), { ...row(), sourceUrls: ['https://app.asianmassagebook.com/admin/#/merchants/1012'] });
    const oldPreviewToken = f.service['sign']({
      version: 1,
      actor: actor.id,
      packageDigest: intakeDigest(input),
      expires: Date.now() + 60_000,
      snapshots: ['12', '11'].map(id => ({ id, digest: intakeDigest(f.shops.get(BigInt(id))) })),
    });
    await code(f.service.apply(actor, input, oldPreviewToken, 'old-mismatched-preview'), 'PACKAGE_HAS_INVALID_SHOPS');
    expect(f.writes).toEqual([]);
    expect(f.audits).toEqual([]);
  });
  test('previews safe per-field differences, keeps existing values, reports missing publishing setup without publishing',async()=>{
    const f=fixture();f.shops.get(11n).description='Existing public description';const p=await f.service.preview(actor,packet({...row(),timezone:'America/New_York',phone:'+12025550100',rawCatalog:[{id:'123',priceCents:5000}]}));
    expect(p.canApply).toBe(true);expect(p.shops[0].fields.map(s=>s.state)).toEqual(['KEEP_EXISTING','FILL']);expect(p.shops[0].missing.map(m=>m.key)).toEqual(expect.arrayContaining(['timezone','contact','address']));expect(p.shops[0].missing.some(m=>['coordinates','loginAccount'].includes(m.key))).toBe(false);expect(p.summary.keptFields).toBe(1);expect(f.writes).toEqual([]);
  });
  test('fills only the two allowed fields and keeps ownership, timezone, account, status and prices untouched; audit excludes uploaded values',async()=>{
    const f=fixture(),input=packet(),p=await f.service.preview(actor,input),before=copy(f.shops.get(11n));const r=await f.service.apply(actor,input,p.previewToken,'fill-empty-key');
    expect(r.summary).toEqual({shops:1,changedShops:1,changedFields:2,unchangedShops:0});expect(Object.keys(f.writes[0].data).sort()).toEqual(['businessHours','description']);expect(f.shops.get(11n)).toMatchObject({status:before.status,ownerId:before.ownerId,timezone:before.timezone,phone:before.phone,loginBinding:null});
    expect(f.locks).toEqual([{table:'shops',id:11n},{table:'users',id:1n}]);expect(JSON.stringify(f.audits[0].detail)).not.toContain('Verified public description');expect(JSON.stringify(f.audits[0].detail)).not.toContain('fill-empty-key');expect(f.audits).toHaveLength(1);
    expect((await f.service.preview(actor,input)).canApply).toBe(false);
  });
  test('keeps an all-closed target configuration while filling its empty description',async()=>{
    const f=fixture(),closed={monday:{closed:true}};f.shops.get(11n).businessHours=closed;const input=packet(),p=await f.service.preview(actor,input);expect(p.shops[0].fields[1].state).toBe('KEEP_EXISTING');await f.service.apply(actor,input,p.previewToken,'keep-closed-hours');expect(f.writes[0].data).toEqual({description:row().description});expect(f.shops.get(11n).businessHours).toEqual(closed);
  });
  test('invalid match/duplicate batches cannot obtain an applicable token',async()=>{
    const f=fixture();for(const input of [packet({...row(),match:{...row().match,name:'Wrong shop'}}),packet(row(),row())]){const p=await f.service.preview(actor,input);expect(p.canApply).toBe(false);expect(p.previewToken).toBeNull();expect(p.summary.invalidShops).toBeGreaterThan(0);}
  });
  test('rechecks the whole batch before writes; change to later record or unrelated field invalidates all',async()=>{
    const f=fixture(),input=packet(row('12'),row()),p=await f.service.preview(actor,input);f.shops.get(12n).phone='Changed after preview';await code(f.service.apply(actor,input,p.previewToken,'batch-stale-key'),'TARGET_CHANGED');expect(f.writes).toEqual([]);expect(f.audits).toEqual([]);expect(f.locks.map(l=>l.id)).toEqual([11n,12n,1n]);
  });
  test('hours intake rechecks bookings created after preview before any shop in the batch is written',async()=>{
    const f=fixture(),input=packet(row(),row('12'));
    f.shops.get(12n).timezone='UTC';
    const preview=await f.service.preview(actor,input),before=copy([...f.shops]);
    // Bookings are deliberately outside the profile digest: creation can happen
    // after preview, so only the current reservation fence can protect the order.
    const booking={id:100n,shopId:12n,status:'CONFIRMED',paymentStatus:'UNPAID',paidCents:0,deletedAt:null,holdExpiresAt:null,
      startTime:new Date('2040-10-24T21:00:00Z'),endTime:new Date('2040-10-24T22:00:00Z')};
    f.db.booking={findMany:jest.fn(async({where}:any)=>where.shopId===12n?[booking]:[])};
    f.db.bookingResourceLock={findMany:jest.fn(async()=>[])};
    await expect(f.service.apply(actor,input,preview.previewToken,'hours-live-booking-key')).rejects.toThrow(ConflictException);
    expect([...f.shops]).toEqual(before);expect(f.db.shop.update).not.toHaveBeenCalled();expect(f.audits).toEqual([]);
  });
  test.each(['SINGLE','COUPLE','FOUR_HANDS','PLAN'])('safe imported hours retain the full existing %s appointment unchanged',async kind=>{
    const f=fixture(),input=packet();f.shops.get(11n).timezone='UTC';
    const startTime=new Date('2040-10-24T20:00:00Z'),endTime=new Date('2040-10-24T21:00:00Z');
    const booking={id:100n,shopId:11n,reservationKind:kind==='PLAN'?'PLAN':'SINGLE',participantCountSnapshot:kind==='COUPLE'?2:1,
      requiredStaffCountSnapshot:kind==='COUPLE'||kind==='FOUR_HANDS'?2:1,durationMin:60,startTime,endTime,
      items:kind==='PLAN'?[{id:101n,bookingId:100n,participantIndex:1,sequence:1,offsetMin:0,requiredStaffCountSnapshot:1,
        durationMin:60,staffBufferMin:0,roomBufferMin:0,startAtUtc:startTime,endAtUtc:endTime}]:[]};
    const before=copy(booking),preview=await f.service.preview(actor,input);
    f.db.booking.findMany.mockResolvedValue([booking]);
    await expect(f.service.apply(actor,input,preview.previewToken,'safe-hours-'+kind)).resolves.toMatchObject({summary:{changedShops:1}});
    expect(booking).toEqual(before);expect(f.shops.get(11n).businessHours.wednesday).toEqual({open:'09:00',close:'21:00',closed:false});
    expect(f.db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({shopId:11n,deletedAt:null,
      status:{in:['PENDING','CONFIRMED']},endTime:{gt:expect.any(Date)}})}));
  });
  test('hours intake protects a SHOP therapist cleanup even after its service has completed',async()=>{
    const f=fixture(),input=packet();f.shops.get(11n).timezone='UTC';
    const lock={resourceType:'THERAPIST',resourceId:8n,startAtUtc:new Date('2040-10-24T20:45:00Z'),endAtUtc:new Date('2040-10-24T21:15:00Z')};
    const preview=await f.service.preview(actor,input),before=copy(lock);
    f.db.bookingResourceLock.findMany.mockResolvedValue([lock]);f.db.therapist.findMany.mockResolvedValue([{id:8n,scheduleMode:'SHOP'}]);
    await expect(f.service.apply(actor,input,preview.previewToken,'cleanup-protected-key')).rejects.toThrow('收尾缓冲');
    expect(f.db.shop.update).not.toHaveBeenCalled();expect(f.audits).toEqual([]);expect(lock).toEqual(before);
    expect(f.db.bookingResourceLock.findMany.mock.calls[0][0].where).toMatchObject({shopId:11n,status:'ACTIVE',endAtUtc:{gt:expect.any(Date)}});
  });
  test.each(['CUSTOM','ROOM'])('hours intake preserves independent %s cleanup without inventing a shop-hours conflict',async resource=>{
    const f=fixture(),input=packet();f.shops.get(11n).timezone='UTC';
    const lock={resourceType:resource==='ROOM'?'ROOM':'THERAPIST',resourceId:8n,startAtUtc:new Date('2040-10-24T20:00:00Z'),endAtUtc:new Date('2040-10-24T21:15:00Z')};
    const booking={startTime:lock.startAtUtc,endTime:new Date('2040-10-24T21:00:00Z')},before=copy({lock,booking});
    const preview=await f.service.preview(actor,input);
    f.db.booking.findMany.mockResolvedValue([booking]);f.db.bookingResourceLock.findMany.mockResolvedValue([lock]);
    f.db.therapist.findMany.mockResolvedValue([{id:8n,scheduleMode:'CUSTOM'}]);
    await expect(f.service.apply(actor,input,preview.previewToken,'independent-'+resource)).resolves.toMatchObject({summary:{changedShops:1}});
    expect({lock,booking}).toEqual(before);
  });
  test('description-only intake does not acquire a reservation conflict from unchanged schedules',async()=>{
    const f=fixture(),source:any=row();delete source.businessHours;const input=packet(source),preview=await f.service.preview(actor,input);
    await expect(f.service.apply(actor,input,preview.previewToken,'description-no-schedule-key')).resolves.toMatchObject({summary:{changedFields:1}});
    expect(f.db.booking.findMany).not.toHaveBeenCalled();expect(f.db.bookingResourceLock.findMany).not.toHaveBeenCalled();
    expect(f.writes[0].data).toEqual({description:source.description});
  });
  test('audit storage failure rolls back both shops and receipt',async()=>{
    const f=fixture(),input=packet(row(),row('12')),p=await f.service.preview(actor,input),before=intakeDigest([...f.shops]);f.failAudit();await expect(f.service.apply(actor,input,p.previewToken,'audit-fail-key')).rejects.toThrow('Synthetic audit failure');expect(intakeDigest([...f.shops])).toEqual(before);expect(f.audits).toEqual([]);expect(f.writes).toEqual([]);
  });
  test('binds preview to actor, package and signature; expires before first apply',async()=>{
    const f=fixture(),input=packet(),p=await f.service.preview(actor,input);await code(f.service.apply(other,input,p.previewToken,'other-actor-key'),'PREVIEW_MISMATCH');await code(f.service.apply(actor,{...input,batchId:'different'},p.previewToken,'other-packet-key'),'PREVIEW_MISMATCH');await code(f.service.apply(actor,input,p.previewToken!.slice(0,-4)+'AAAA','tampered-key'),'PREVIEW_INVALID');
    const now=jest.spyOn(Date,'now').mockReturnValue(Date.now()+16*60000);try{await code(f.service.apply(actor,input,p.previewToken,'expired-key'),'PREVIEW_EXPIRED');}finally{now.mockRestore();}expect(f.writes).toEqual([]);
  });
  test.each([{role:'MERCHANT'},{status:'DISABLED'},{deletedAt:new Date()}])('inactive/deleted/demoted admins cannot use any intake operation (%p)',async changed=>{
    const f=fixture(),input=packet(),p=await f.service.preview(actor,input);Object.assign(f.users.get(1n),changed);for(const pending of [f.service.preview(actor,input),f.service.apply(actor,input,p.previewToken,'revoked-key'),f.service.result(actor,'revoked-key'),f.service.resolve(actor,'revoked-key',p.packageDigest)]) await expect(pending).rejects.toThrow('管理员账户不可用');expect(f.writes).toEqual([]);
  });
  test('serializes same actor requests: one mutation and receipt, durable replays even with expired token or changed target',async()=>{
    const f=fixture(),input=packet(),p=await f.service.preview(actor,input),results=await Promise.all([1,2].map(()=>f.service.apply(actor,input,p.previewToken,'concurrent-key')));expect(results.map(r=>r.replayed).sort()).toEqual([false,true]);expect(f.writes).toHaveLength(1);expect(f.audits).toHaveLength(1);
    f.shops.get(11n).description='Subsequent edit';const replay=await f.service.apply(actor,input,'expired-or-unavailable-token','concurrent-key');expect(replay.operationId).toBe(results[0].operationId);expect(replay.replayed).toBe(true);expect(await f.service.result(other,'concurrent-key')).toEqual({found:false});expect(await f.service.result(actor,'concurrent-key')).toMatchObject({found:true,state:'APPLIED',receipt:{operationId:replay.operationId}});
    await code(f.service.apply(actor,{...input,batchId:'different'},null,'concurrent-key'),'REQUEST_KEY_REUSED');expect(f.writes).toHaveLength(1);
  });
  test('resolve after apply returns original applied receipt, adds no new audit, and conflicts on a different digest',async()=>{
    const f=fixture(),input=packet(),p=await f.service.preview(actor,input),applied=await f.service.apply(actor,input,p.previewToken,'resolve-after-key');const resolved=await f.service.resolve(actor,'resolve-after-key',p.packageDigest);expect(resolved).toMatchObject({found:true,state:'APPLIED',receipt:{operationId:applied.operationId}});await code(f.service.resolve(actor,'resolve-after-key',intakeDigest({different:true})),'REQUEST_KEY_REUSED');expect(f.audits).toHaveLength(1);
  });
  test('resolve before delayed apply establishes a terminal fence and repeated resolve is stable',async()=>{
    const f=fixture(),input=packet(),p=await f.service.preview(actor,input);expect(await f.service.result(actor,'resolve-before-key')).toEqual({found:false});const resolved=await f.service.resolve(actor,'resolve-before-key',p.packageDigest);expect(resolved).toMatchObject({found:true,state:'NOT_APPLIED'});expect(await f.service.resolve(actor,'resolve-before-key',p.packageDigest)).toEqual(resolved);expect(await f.service.result(actor,'resolve-before-key')).toEqual(resolved);await code(f.service.apply(actor,input,p.previewToken,'resolve-before-key'),'REQUEST_CLOSED');expect(f.writes).toEqual([]);expect(f.audits).toHaveLength(1);
    const next=await f.service.preview(actor,input);await f.service.apply(actor,input,next.previewToken,'new-after-resolve-key');expect(f.writes).toHaveLength(1);
  });
  test('concurrent apply and resolve settle into one terminal outcome under the same actor mutex',async()=>{
    for(const resolveFirst of [false,true]){const f=fixture(),input=packet(),p=await f.service.preview(actor,input),apply=()=>f.service.apply(actor,input,p.previewToken,'race-terminal-key'),end=()=>f.service.resolve(actor,'race-terminal-key',p.packageDigest);const outcomes=await Promise.allSettled(resolveFirst?[end(),apply()]:[apply(),end()]);const settled:any=await f.service.result(actor,'race-terminal-key');expect(settled.state).toBe(resolveFirst?'NOT_APPLIED':'APPLIED');expect(f.audits).toHaveLength(1);expect(f.writes).toHaveLength(resolveFirst?0:1);expect(outcomes.filter(o=>o.status==='rejected')).toHaveLength(resolveFirst?1:0);}
  });
});
