import { BookingService } from './booking.service';
import { allocate, preferredIds } from './availability';
import { servicePrice } from './booking-plan';

const date='2035-01-01',day=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(`${date}T12:00:00Z`).getUTCDay()];
function fixture(){
  const shop:any={id:1n,timezone:'UTC',businessHours:{[day]:{open:'09:00',close:'18:00'}}};
  const row:any={id:7n,shopId:1n,isActive:true,name:'Four hands',durationKind:'TIMED',durationMin:60,priceCents:10001,priceBasis:'PER_BOOKING',participantCount:1,requiredStaffCount:2,requiredRoomType:'SINGLE',staffBufferMin:10,roomBufferMin:5,variants:[]};
  const staff:any[]=['8','9'].map(id=>({id:BigInt(id),scheduleMode:'SHOP',shifts:[],timeOff:[]}));
  const room:any={id:10n,maintenance:[]};const locks:any[]=[];
  const db:any={shop:{findUnique:jest.fn(async()=>shop)},shopService:{findUnique:jest.fn(async()=>row)},therapist:{findMany:jest.fn(async()=>staff)},
    shopRoom:{findMany:jest.fn(async()=>[room])},shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock:{findMany:jest.fn(async()=>locks)},booking:{findMany:jest.fn(async()=>[])}};
  const service=Object.create(BookingService.prototype) as any;
  const context=(extra:any={})=>service.context(db,{shopId:'1',serviceId:'7',date,...extra},undefined,undefined,true);
  return {shop,row,staff,room,locks,db,service,context};
}
describe('actual booking context guest/staff and inherited schedule policies',()=>{
  test('four hands need two staff preferences but only one guest room space and one package charge',async()=>{
    const f=fixture(),c=await f.context({preferredTherapistIds:['8','9']});
    expect(c).toMatchObject({count:1,staffCount:2,preferred:['8','9']});
    expect(f.db.shopRoom.findMany.mock.calls[0][0].where.capacity).toEqual({gte:1});
    expect(f.db.therapist.findMany.mock.calls[0][0].where).toEqual({shopId:1n,isActive:true});
    expect(allocate(c.allocation,new Date(`${date}T09:00:00Z`),c.preferred)?.therapistIds).toEqual(['8','9']);
    expect(servicePrice(c.unitPrice,c.count,c.priceBasis)).toBe(10001);
    expect(()=>preferredIds({preferredTherapistIds:['8','8']},2)).toThrow();
  });
  test('loads only active SHOP intervals for this store into the real shared context',async()=>{
    const f=fixture(),startAtUtc=new Date(`${date}T09:30:00Z`),endAtUtc=new Date(`${date}T10:00:00Z`);
    f.db.shopCalendarBlock.findMany=jest.fn(async()=>[{startAtUtc,endAtUtc}]);
    const c=await f.context();
    expect(f.db.shopCalendarBlock.findMany.mock.calls[0][0]).toMatchObject({where:{shopId:1n,scope:'SHOP',status:'ACTIVE'},select:{startAtUtc:true,endAtUtc:true}});
    expect(c.allocation.shopBlocks).toEqual([{start:startAtUtc,end:endAtUtc}]);
    expect(allocate(c.allocation,new Date(`${date}T09:00:00Z`),[])).toBeNull();
  });
  test('explicit CUSTOM disabled shifts never fall back to store opening',async()=>{
    const f=fixture();f.staff[1].scheduleMode='CUSTOM';f.staff[1].shifts=[{weekday:new Date(`${date}T12:00:00Z`).getUTCDay(),startMin:540,endMin:1080,isActive:false}];
    const c=await f.context();expect(allocate(c.allocation,new Date(`${date}T09:00:00Z`),[])).toBeNull();
  });
  test('couples reserve two guest places and preserve an explicit whole-package price',async()=>{
    const f=fixture();Object.assign(f.row,{participantCount:2,requiredStaffCount:2,requiredRoomType:'COUPLE'});
    const c=await f.context();expect(f.db.shopRoom.findMany.mock.calls[0][0].where).toMatchObject({roomType:'COUPLE',capacity:{gte:2}});
    expect(servicePrice(c.unitPrice,c.count,c.priceBasis)).toBe(10001);
  });
  test.each([1,2])('two-staff services with %i guests need no room when none is configured',async participantCount=>{
    const f=fixture();Object.assign(f.row,{participantCount,requiredStaffCount:2,requiredRoomType:null});
    const c=await f.context();
    expect(f.db.shopRoom.findMany).not.toHaveBeenCalled();
    expect(c.allocation).toMatchObject({count:participantCount,staffCount:2,needsRoom:false,rooms:[]});
    expect(allocate(c.allocation,new Date(`${date}T09:00:00Z`),[])).toMatchObject({therapistIds:['8','9'],roomId:null});
    f.staff.pop();
    expect(allocate((await f.context()).allocation,new Date(`${date}T09:00:00Z`),[])).toBeNull();
  });
  test.each(['SINGLE','FOOT_SEAT'])('an explicitly incompatible %s room still rejects a couple policy',async requiredRoomType=>{
    const f=fixture();Object.assign(f.row,{participantCount:2,requiredStaffCount:2,requiredRoomType});
    await expect(f.context()).rejects.toThrow('Service reservation policy needs configuration');
  });
  test('an explicit couple room remains necessary and cannot be bypassed when absent or occupied',async()=>{
    const f=fixture();Object.assign(f.row,{participantCount:2,requiredStaffCount:2,requiredRoomType:'COUPLE'});
    f.db.shopRoom.findMany.mockResolvedValueOnce([]);
    expect(allocate((await f.context()).allocation,new Date(`${date}T09:00:00Z`),[])).toBeNull();
    f.locks.push({resourceType:'ROOM',resourceId:10n,startAtUtc:new Date(`${date}T09:00:00Z`),endAtUtc:new Date(`${date}T10:05:00Z`)});
    expect(allocate((await f.context()).allocation,new Date(`${date}T09:00:00Z`),[])).toBeNull();
  });
  test('reschedule context uses stored guest/staff/price snapshots after the live policy changes',async()=>{
    const f=fixture();Object.assign(f.row,{participantCount:2,requiredStaffCount:2,requiredRoomType:'COUPLE',priceCents:20000});
    const c=await f.service.context(f.db,{shopId:'1',serviceId:'7',date},11n,{durationKind:'TIMED',duration:60,unitPrice:10001,count:1,staffCount:2,staffBuffer:10,roomBuffer:5,roomType:'SINGLE',currency:'usd',priceBasis:'PER_BOOKING'},true);
    expect(c).toMatchObject({count:1,staffCount:2,unitPrice:10001,roomType:'SINGLE'});
    expect(f.db.bookingResourceLock.findMany.mock.calls[0][0].where.bookingId).toEqual({not:11n});
    expect(allocate(c.allocation,new Date(`${date}T09:00:00Z`),[])?.therapistIds).toHaveLength(2);
  });
});
