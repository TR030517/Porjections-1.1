import { publicServiceView } from './shop-public-profile';
import { ShopsService } from '../modules/shops/shops.service';
import { ServicesService } from '../modules/services/services.service';

const service=(kind:unknown='TIMED')=>({id:10n,shopId:1n,name:'Synthetic primary',durationMin:60,durationKind:kind,priceCents:6000,isActive:true,participantCount:1,variants:[]});
describe('public duration kind and reservation block projection',()=>{
  test.each(['TIMED','PER_SESSION','VARIABLE'])('projects %s and inherited variant blocks without copying arbitrary fields',durationKind=>{
    const source={...service(durationKind),secret:'must not appear',_count:{variants:3},variants:[{id:11n,serviceId:10n,name:'Short',durationMin:30,priceCents:3500,currency:'usd',isActive:true,internal:'hidden'},{id:12n,serviceId:10n,durationMin:0},{id:13n,serviceId:10n,durationMin:241}]};
    const result=publicServiceView(source);expect(result).toMatchObject({durationKind,reservedDurationMin:60,durationMin:60,hasVariants:true});
    expect(result.variants).toHaveLength(1);expect(result.variants[0]).toMatchObject({durationKind,reservedDurationMin:30,durationMin:30});
    expect(result).not.toHaveProperty('secret');expect(result.variants[0]).not.toHaveProperty('internal');
  });
  test('legacy missing kind is TIMED and an explicit invalid kind never silently downgrades',()=>{
    const old:any=service();delete old.durationKind;expect(publicServiceView(old).durationKind).toBe('TIMED');
    for(const durationKind of [null,'UNKNOWN',0,{}])expect(()=>publicServiceView(service(durationKind))).toThrow('服务类型无法核对');
  });
  test('a malformed service policy is hidden without breaking the public shop service list',async()=>{
    const publicShop={id:1n,status:'APPROVED',deletedAt:null,loginBinding:{userId:2n,user:{id:2n,role:'MERCHANT',status:'ACTIVE',deletedAt:null,loginName:'synthetic-merchant',passwordHash:'$2b$10$'+'a'.repeat(53)}}};
    const db:any={$queryRaw:async()=>[{id:1n}],shop:{findFirst:async()=>publicShop,findUnique:async()=>publicShop},therapist:{count:async()=>2},shopService:{findMany:async()=>[service('PER_SESSION'),service(null),{...service('VARIABLE'),durationMin:0}]}};
    const rows=await new ShopsService(db).getShopServices('1');expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({durationKind:'PER_SESSION',reservedDurationMin:60});
  });
  test('the general public service list shares the same validity filter and includes active add-on definitions',async()=>{
    const valid={...service('VARIABLE'),shop:{id:1n,name:'Synthetic shop'},addOns:[{id:3n,serviceId:10n,name:'Oil',priceCents:1000,currency:'usd',isActive:true}]};
    const findMany=jest.fn(async(_args:any)=>[valid,{...valid,durationKind:null},{...valid,durationMin:4},{...valid,durationMin:241}]);
    const rows=await new ServicesService({$queryRaw:async()=>[{id:1n}],shopService:{findMany}} as any).listServices({shopId:'1'});
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({durationKind:'VARIABLE',reservedDurationMin:60,addOns:[{id:'3',priceCents:1000}]});
    expect(findMany.mock.calls[0][0].include.addOns.where).toEqual({isActive:true});
  });
  test.each([{durationKind:null},{durationMin:0},{durationMin:241}])('general single-service entry refuses invalid reservation policy %p',async patch=>{
    const row={...service(),...patch,therapistServices:[],shop:{id:1n,name:'Synthetic shop'}};
    await expect(new ServicesService({$queryRaw:async()=>[{id:1n}],shopService:{findFirst:async()=>row}} as any).getService('10')).rejects.toMatchObject({status:404});
  });
});
