import { announcementData, bannerData, contentInstant, contentPage, publicationState } from './content-policy';
import { publicSupport, PublicSupportController } from './public-support.controller';
import { AnnouncementsService } from '../modules/announcements/announcements.service';
import { BannersService } from '../modules/banners/banners.service';
import { StudioService } from '../modules/studio/studio.service';

const now = new Date('2026-10-28T12:00:00Z');
const announcement = { title:'Synthetic',content:'Plain text <script> is data',startAt:'2026-10-28T12:00:00Z' };
const banner = { title:'Synthetic',imageUrl:'https://images.example.invalid/synthetic.jpg' };
describe('publication, destination and public contact boundaries', () => {
  test('new announcements and banners default to draft, never silently publish', () => {
    expect(announcementData(announcement)).toMatchObject({isActive:false,type:'INFO',scope:'ALL'});
    expect(bannerData(banner)).toMatchObject({isActive:false,targetType:'NONE',targetValue:null});
  });
  test.each(['2026-02-30T12:00:00Z','2026-10-28T12:00','2026-10-28','2026-10-28T24:00:00Z','2026-10-28T12:60:00Z','2026-10-28T12:00:61Z'])('rejects invalid or timezone-ambiguous publication %s', value => expect(()=>contentInstant(value)).toThrow());
  test('explicit offset preserves the exact instant and updates retain original publication window', () => {
    expect(contentInstant('2026-10-28T08:00:00-04:00')).toEqual(now);
    const previous={...announcementData(announcement),endAt:new Date('2026-10-29T12:00:00Z'),isActive:true};
    expect(announcementData({title:'Changed'},previous)).toMatchObject({startAt:now,endAt:previous.endAt,isActive:true});
    expect(announcementData({endAt:null},previous).endAt).toBeNull();
    expect(()=>announcementData({...announcement,endAt:'2026-10-28T12:00:00Z'})).toThrow();
  });
  test('draft, scheduled, live and expired have distinct exact boundary states', () => {
    const row={isActive:true,startAt:now,endAt:new Date(+now+1000)};
    expect(publicationState({...row,isActive:false},now)).toBe('DRAFT');
    expect(publicationState(row,new Date(+now-1))).toBe('SCHEDULED');
    expect(publicationState(row,now)).toBe('LIVE');
    expect(publicationState(row,new Date(+now+1000))).toBe('EXPIRED');
  });
  test('banner destinations reject executable URLs, credentials, unknown category and forged analytics', () => {
    for(const targetValue of ['javascript:alert(1)','http://example.invalid','https://user:password@example.invalid']) expect(()=>bannerData({...banner,targetType:'EXTERNAL_URL',targetValue})).toThrow();
    expect(()=>bannerData({...banner,targetType:'CATEGORY',targetValue:'arbitrary legacy category'})).toThrow();
    expect(()=>bannerData({...banner,targetType:'NONE',targetValue:'unexpected'})).toThrow();
    expect(()=>bannerData({...banner,clickCount:999})).toThrow();
    expect(bannerData({...banner,targetType:'CATEGORY',targetValue:'MASSAGE'}).targetValue).toBe('MASSAGE');
  });
  test('unsafe legacy banner is hidden and a paused destination does not appear publicly', async () => {
    const active={...bannerData(banner),id:1n,isActive:true,clickCount:0};
    const db:any={$queryRaw:async()=>[],homeBanner:{findMany:async()=>[{...active,targetType:'EXTERNAL_URL',targetValue:'javascript:x'},{...active,id:2n,targetType:'SHOP_DETAIL',targetValue:'2'},active]},shop:{findFirst:async()=>null}};
    expect((await new BannersService(db).getActiveBanners()).map(row=>row.id)).toEqual(['1']);
  });
  test('announcement priority comes from explicit buckets and STAFF sees merchant scope', async () => {
    const findMany=jest.fn(async ({where}:any)=>[{id:1n,type:where.type,scope:'MERCHANTS'}]);
    const rows=await new AnnouncementsService({announcement:{findMany}} as any).getActiveAnnouncements('STAFF');
    expect(rows.map(row=>row.type)).toEqual(['URGENT','IMPORTANT','INFO']);
    expect(findMany.mock.calls.every(([query])=>query.where.scope.in.join(',')==='ALL,MERCHANTS')).toBe(true);
  });
  test('Studio uses the same publication rules and rejects merchant content writes', async () => {
    const service:any=new StudioService({} as any);
    await expect(service.data({},'content',{body:'Body',title:'Title',endAt:'2026-10-28T12:00:00Z',startAt:'2026-10-29T12:00:00Z'},undefined,{id:'1',role:'ADMIN'})).rejects.toThrow();
    await expect(service.data({},'content',{body:'Body',title:'Title'},undefined,{id:'1',role:'MERCHANT'})).rejects.toThrow();
  });
  test('public support ignores private keys and clears invalid/missing contacts', () => {
    expect(publicSupport([{key:'private_token',value:'should never leave server'},{key:'support_email',value:''},{key:'support_phone',value:'bad'}])).toEqual({siteName:'Massajoy',email:null,phone:null});
    expect(publicSupport([{key:'site_name',value:' Studio '},{key:'support_email',value:'help@example.invalid'},{key:'support_phone',value:'+1 (212) 555-0100'}])).toEqual({siteName:'Studio',email:'help@example.invalid',phone:'+1 (212) 555-0100'});
  });
  test.each([0,-1,1.1,'1x','1.0','10000001',true])('bounded content pagination rejects %s', input => expect(()=>contentPage(input,20,100)).toThrow());
});

test('public support query requires both exact safe keys and an explicitly public flag',async()=>{
  const findMany=jest.fn().mockResolvedValue([]);await new PublicSupportController({platformConfig:{findMany}} as any).get();
  expect(findMany).toHaveBeenCalledWith({where:{isPublic:true,key:{in:['site_name','support_email','support_phone']}},select:{key:true,value:true}});
});
