import { ShopReadinessService, READINESS_LIMITS } from './shop-readiness.service';

const actor={id:'1',role:'ADMIN'};
function fixture(){
  const shop:any={id:11n,name:'Synthetic',status:'PENDING',deletedAt:null,shortName:'synthetic',timezone:'America/New_York',phone:'+12025550149',address:'Synthetic',city:'Synthetic',state:'NY',latitude:40.7,longitude:-73.9,businessHours:{monday:{open:'09:00',close:'18:00'}},studioProfile:{},description:'English description',loginBinding:{user:{id:7n,role:'MERCHANT',status:'ACTIVE',deletedAt:null,loginName:'synthetic-login',passwordHash:'$2b$04$'+'A'.repeat(53),email:'private@example.invalid',phone:'+15550001234'}}};
  const data:Record<string,any[]>={services:[],variants:[],therapists:[],qualifications:[],shifts:[],rooms:[],images:[]};
  let operator:any={id:1n};const order:string[]=[];
  const tx:any={user:{findFirst:jest.fn(async()=>{order.push('admin');return operator;}),findMany:jest.fn(async()=>[{id:7n}])},shop:{findFirst:jest.fn(async()=>{order.push('shop');return shop;})},$queryRaw:jest.fn(()=>{throw Error('No raw SQL permitted');}),$executeRaw:jest.fn(()=>{throw Error('No writes permitted');})};
  const models={services:'shopService',variants:'shopServiceVariant',therapists:'therapist',shifts:'therapistShift',rooms:'shopRoom',images:'shopImage'};
  tx.therapistService={findMany:jest.fn(()=>{throw Error('Legacy mappings must not gate readiness');})};
  for(const [resource,model]of Object.entries(models)) tx[model]={findMany:jest.fn(async({where,take}:any)=>{
    order.push(resource);let rows=data[resource];
    if(resource==='therapists')rows=rows.filter(row=>row.shopId===where.shopId&&(!where.isActive||row.isActive===true));
    if(resource==='shifts')rows=rows.filter(row=>(!where.isActive||row.isActive===true)&&where.therapistId.in.includes(row.therapistId)&&data.therapists.some(person=>person.id===row.therapistId&&person.shopId===where.therapist.shopId&&person.isActive===true));
    return rows.slice(0,take);
  }),create:jest.fn(()=>{throw Error('No mutations permitted');}),update:jest.fn(()=>{throw Error('No mutations permitted');})};
  const db:any={$transaction:jest.fn(async(work:any,_options:any)=>work(tx)),user:{findFirst:jest.fn(()=>{throw Error('No outside snapshot reads');})}};
  return {shop,data,tx,db,models,order,service:new ShopReadinessService(db),operator:(value:any)=>{operator=value;}};
}
describe('bounded read-only shop diagnostics service',()=>{
  test('one RepeatableRead snapshot performs only bounded exact-shop reads and redacts credentials/contact details',async()=>{
    const f=fixture(),r=await f.service.get(actor,'11');
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'RepeatableRead',maxWait:10000,timeout:15000});
    expect(f.tx.user.findFirst).toHaveBeenCalledWith({where:{id:1n,role:'ADMIN',status:'ACTIVE',deletedAt:null},select:{id:true}});
    expect(f.tx.shop.findFirst.mock.calls[0][0].where).toEqual({id:11n,deletedAt:null});
    for(const [resource,model]of Object.entries(f.models))expect(f.tx[model].findMany.mock.calls[0][0].take).toBe(READINESS_LIMITS[resource as keyof typeof READINESS_LIMITS]+1);
    expect(f.tx.shopService.findMany.mock.calls[0][0].where).toEqual({shopId:11n});
    expect(f.tx.shopServiceVariant.findMany.mock.calls[0][0].where).toEqual({service:{shopId:11n}});
    expect(f.tx.therapistService.findMany).not.toHaveBeenCalled();
    expect(f.tx.therapistShift.findMany.mock.calls[0][0].where).toEqual({therapistId:{in:[]},isActive:true,therapist:{shopId:11n,isActive:true}});
    expect(f.tx.therapist.findMany.mock.calls[0][0].where).toEqual({shopId:11n,isActive:true});
    for(const model of ['shopRoom','shopImage'])expect(f.tx[model].findMany.mock.calls[0][0].where).toEqual({shopId:11n});
    expect(f.order.slice(0,2)).toEqual(['admin','shop']);expect(r.shop).toEqual({id:'11',name:'Synthetic',status:'PENDING'});expect(r.access.loginReady).toBe(true);expect(r.summary.activeServices).toBe(0);
    const json=JSON.stringify(r);for(const secret of ['passwordHash','$2b$04$','private@example.invalid','+15550001234'])expect(json).not.toContain(secret);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();expect(f.tx.$executeRaw).not.toHaveBeenCalled();expect(f.db.user.findFirst).not.toHaveBeenCalled();
    for(const model of Object.values(f.models)){expect(f.tx[model].create).not.toHaveBeenCalled();expect(f.tx[model].update).not.toHaveBeenCalled();}
  });
  test.each(['MERCHANT','STAFF','CUSTOMER'])('rejects %s before starting a transaction',async role=>{
    const f=fixture();await expect(f.service.get({id:'1',role},'11')).rejects.toThrow('仅公司管理员');expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  test('live revoked ADMIN and missing/deleted shops fail rather than generating an empty success',async()=>{
    const f=fixture();f.operator(null);await expect(f.service.get(actor,'11')).rejects.toThrow('管理员账户不可用');expect(f.tx.shop.findFirst).not.toHaveBeenCalled();
    f.operator({id:1n});f.tx.shop.findFirst.mockResolvedValue(null);await expect(f.service.get(actor,'11')).rejects.toThrow('门店不存在或已删除');expect(f.tx.shopService.findMany).not.toHaveBeenCalled();
  });
  test.each(['0','01','-1','1e1','9223372036854775808'])('rejects noncanonical/out-of-range shop ID %s',async shopId=>{
    const f=fixture();await expect(f.service.get(actor,shopId)).rejects.toThrow('shopId必须');expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  test.each(Object.keys(READINESS_LIMITS))('rejects excess %s clearly without partial green results',async resource=>{
    const f=fixture(),limit=READINESS_LIMITS[resource as keyof typeof READINESS_LIMITS];f.data[resource]=Array.from({length:limit+1},()=>({}));
    if(resource==='therapists')f.data.therapists=Array.from({length:limit+1},(_,index)=>({id:BigInt(index+30),shopId:11n,isActive:true,scheduleMode:'SHOP'}));
    if(resource==='shifts'){f.data.therapists=[{id:30n,shopId:11n,isActive:true,scheduleMode:'CUSTOM'}];f.data.shifts=Array.from({length:limit+1},(_,index)=>({id:BigInt(index+40),therapistId:30n,isActive:true,weekday:1,startMin:540,endMin:1080}));}
    try{await f.service.get(actor,'11');throw Error('Expected excess rejection');}catch(error:any){expect(error.getResponse?.()).toMatchObject({shopReadinessCode:'CONFIGURATION_TOO_LARGE',resource});}
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();expect(f.tx.$executeRaw).not.toHaveBeenCalled();
  });
  test('1000 retained people and unused historical shifts cannot hide valid active shop and legacy-personal calendars',async()=>{
    const f=fixture();
    f.data.services=[{id:20n,shopId:11n,name:'Synthetic couple',isActive:true,durationKind:'TIMED',durationMin:60,priceCents:20001,priceBasis:'PER_BOOKING',participantCount:2,requiredStaffCount:2,requiredRoomType:null,staffBufferMin:0,roomBufferMin:0}];
    f.data.therapists=[...Array.from({length:998},(_,index)=>({id:BigInt(index+100),shopId:11n,isActive:false,scheduleMode:'CUSTOM'})),
      {id:30n,shopId:11n,isActive:true,scheduleMode:'SHOP'},{id:31n,shopId:11n,isActive:true,scheduleMode:null}];
    f.data.shifts=[...Array.from({length:READINESS_LIMITS.shifts+1},(_,index)=>({id:BigInt(index+100),therapistId:index%2?100n:30n,isActive:true,weekday:1,startMin:0,endMin:1440})),
      {id:40n,therapistId:31n,isActive:true,weekday:1,startMin:540,endMin:1080},
      {id:41n,therapistId:31n,isActive:false,weekday:1,startMin:0,endMin:1440}];
    const before=structuredClone(f.data),r=await f.service.get(actor,'11');
    expect(r.services[0].checks.find(row=>row.key==='staff')?.state).toBe('PASS');
    expect(r.services[0].checks.find(row=>row.key==='shifts')?.state).toBe('PASS');
    expect(await f.tx.therapist.findMany.mock.results[0].value).toHaveLength(2);
    expect(await f.tx.therapistShift.findMany.mock.results[0].value).toHaveLength(1);
    expect(f.tx.therapistShift.findMany.mock.calls[0][0].where).toEqual({therapistId:{in:[31n]},isActive:true,therapist:{shopId:11n,isActive:true}});
    expect(f.data).toEqual(before);expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    for(const model of Object.values(f.models)){expect(f.tx[model].create).not.toHaveBeenCalled();expect(f.tx[model].update).not.toHaveBeenCalled();}
  });
  test('foreign and disabled personal shifts cannot make an active custom calendar ready',async()=>{
    const f=fixture();f.data.services=[{id:20n,shopId:11n,name:'Synthetic',isActive:true,durationKind:'TIMED',durationMin:60,priceCents:8000,priceBasis:'PER_BOOKING',participantCount:1,requiredStaffCount:1,requiredRoomType:null,staffBufferMin:0,roomBufferMin:0}];
    f.data.therapists=[{id:30n,shopId:11n,isActive:true,scheduleMode:'CUSTOM'},{id:31n,shopId:12n,isActive:true,scheduleMode:'CUSTOM'},{id:32n,shopId:11n,isActive:false,scheduleMode:'CUSTOM'}];
    f.data.shifts=[{id:40n,therapistId:30n,isActive:false,weekday:1,startMin:540,endMin:1080},{id:41n,therapistId:31n,isActive:true,weekday:1,startMin:540,endMin:1080},{id:42n,therapistId:32n,isActive:true,weekday:1,startMin:540,endMin:1080}];
    const r=await f.service.get(actor,'11');expect(r.services[0].checks.find(row=>row.key==='staff')?.state).toBe('PASS');expect(r.services[0].checks.find(row=>row.key==='shifts')?.state).toBe('ATTENTION');
    expect(await f.tx.therapistShift.findMany.mock.results[0].value).toEqual([]);
  });
  test('shared numeric login ambiguity blocks login readiness while publication stays independent',async()=>{
    const f=fixture();Object.assign(f.shop.loginBinding.user,{loginName:'12345',email:null,phone:null});f.tx.user.findMany.mockResolvedValue([{id:7n},{id:8n}]);
    const r=await f.service.get(actor,'11');expect(r.access.loginReady).toBe(false);expect(r.publication.ready).toBe(true);expect(r.publication.checks.some(check=>check.key==='loginAccount')).toBe(false);expect(r.access.checks.find(check=>check.key==='loginReady')?.state).toBe('ATTENTION');expect(f.tx.user.findMany).toHaveBeenCalledWith({where:{OR:[{loginName:'12345'},{phone:'12345'}]},take:2,select:{id:true}});
  });
});
