import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,ValidationPipe} from '@nestjs/common';
import {ReservationsService} from './reservations.service';
import {serviceAddOnInput} from './service-addons';
import {CreateServiceAddOnDto} from './service-addon.dto';
const body=()=>({serviceId:'20',name:'Essential Oil',description:'Optional oil',priceCents:1000,currency:'usd',isActive:false,sortOrder:0});
function fixture(options:{bindingUserId?:bigint;grantPermissions?:string[]}={}){
  let state:any={rows:[],audits:[]};let failAudit=false;
  const db:any={$transaction:async(work:any)=>{const draft=structuredClone(state),tx:any={
    $queryRaw:async()=>[{id:10n}],
    user:{findFirst:async({where}:any)=>where.id===1n&&where.role==='MERCHANT'?{id:1n,role:'MERCHANT',status:'ACTIVE',deletedAt:null}:null},
    shop:{findFirst:async({where}:any)=>where.id===10n?{id:10n,ownerId:options.bindingUserId??1n,deletedAt:null,owner:{id:1n,role:'MERCHANT',status:'ACTIVE',deletedAt:null},loginBinding:{userId:options.bindingUserId??1n,user:{id:options.bindingUserId??1n,role:'MERCHANT',status:'ACTIVE',deletedAt:null}}}:null},
    shopAccountGrant:{findFirst:async({select}:any)=>options.grantPermissions?select?{sourceShopId:30n}:{sourceShopId:30n,permissions:options.grantPermissions,status:'ACTIVE'}:null},
    shopService:{findFirst:async({where}:any)=>where.id===20n&&where.shopId===10n?{id:20n,shopId:10n}:null},
    shopServiceAddOn:{count:async()=>draft.rows.length,findFirst:async({where}:any)=>draft.rows.find((r:any)=>r.id===where.id&&where.service.shopId===10n)??null,create:async({data}:any)=>{const row={id:BigInt(draft.rows.length+1),...data};draft.rows.push(row);return row;},update:async({where,data}:any)=>{const row=draft.rows.find((r:any)=>r.id===where.id);Object.assign(row,data);return row;}},
    auditLog:{create:async({data}:any)=>{if(failAudit)throw Error('Audit unavailable');draft.audits.push(data);}},
  };const result=await work(tx);state=draft;return result;}};
  return {service:new ReservationsService(db),state:()=>state,failAudit:()=>{failAudit=true;},fill:()=>{state.rows=Array.from({length:50},(_,i)=>({id:BigInt(i+1),serviceId:20n,...serviceAddOnInput(body())}));}};
}
describe('separate service add-on configuration',()=>{
  test('normal input is explicit USD fixed cents; HTML, coercion, negatives and duration fields are not valid pricing',async()=>{
    expect(serviceAddOnInput(body())).toEqual({name:'Essential Oil',description:'Optional oil',priceCents:1000,currency:'usd',isActive:false,sortOrder:0});
    for(const patch of [{name:'<b>Oil</b>'},{name:'x\nY'},{priceCents:'1000'},{priceCents:-1},{priceCents:0.5},{currency:'eur'},{isActive:'false'},{sortOrder:10001}])expect(()=>serviceAddOnInput({...body(),...patch})).toThrow(BadRequestException);
    const pipe=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true,transformOptions:{enableImplicitConversion:true}});
    for(const patch of [{priceCents:'1000'},{isActive:'false'},{durationMin:0},{quantity:2}])await expect(pipe.transform({...body(),...patch},{type:'body',metatype:CreateServiceAddOnDto})).rejects.toBeInstanceOf(BadRequestException);
  });
  test('creates only a configuration and audit, never a zero-duration primary or booking',async()=>{
    const f=fixture(),result=await f.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},body());
    expect(result.item).toMatchObject({id:'1',serviceId:'20',isActive:false,priceCents:1000});expect(f.state().rows).toHaveLength(1);expect(f.state().rows[0]).not.toHaveProperty('durationMin');expect(f.state().audits[0].targetType).toBe('SERVICE_ADDON');
  });
  test('only catalog permission can add or reprice customer-facing extras',async()=>{
    const reservationOnly=fixture({bindingUserId:9n,grantPermissions:['RESERVATION_CONFIG']});
    await expect(reservationOnly.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},body())).rejects.toBeInstanceOf(ForbiddenException);
    expect(reservationOnly.state().rows).toEqual([]);expect(reservationOnly.state().audits).toEqual([]);
    const catalogOnly=fixture({bindingUserId:9n,grantPermissions:['CATALOG_MANAGE']});
    await expect(catalogOnly.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},body())).resolves.toMatchObject({item:{name:'Essential Oil',priceCents:1000}});
    expect(catalogOnly.state().rows).toHaveLength(1);
  });
  test('wrong parent, unknown update fields and the service cap reject the entire transaction',async()=>{
    const f=fixture();await expect(f.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},{...body(),serviceId:'30'})).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},{...body(),durationMin:0})).rejects.toBeInstanceOf(BadRequestException);
    expect(f.state().rows).toHaveLength(0);f.fill();await expect(f.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},body())).rejects.toBeInstanceOf(ConflictException);
  });
  test('soft disable retains identity; audit failure rolls back both the change and audit',async()=>{
    const f=fixture();await f.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},{...body(),isActive:true});await f.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},{},'1',true);expect(f.state().rows).toHaveLength(1);expect(f.state().rows[0].isActive).toBe(false);
    f.failAudit();await expect(f.service.mutateAddOn('10',{id:'1',role:'MERCHANT'},{name:'Changed'},'1')).rejects.toThrow('Audit unavailable');expect(f.state().rows[0].name).toBe('Essential Oil');
  });
});
