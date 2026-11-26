import { bannerData } from './content-policy';
import { contentWrite } from './content-write';
import { mediaUrl, publicBannerImageAvailable, requireBannerAdministrator, syncBannerMedia, withBannerMediaRetry } from './managed-media';
import { BannerManageService } from '../modules/admin/banner-manage.service';
import { BannersService } from '../modules/banners/banners.service';
import { StudioService } from '../modules/studio/studio.service';
import { UploadService } from '../modules/upload/upload.service';

const first='00000000-0000-4000-8000-000000000001', second='00000000-0000-4000-8000-000000000002';
const actor={id:'1',role:'ADMIN'};
const image=(id=first,patch:Record<string,unknown>={})=>({id,owner_id:1n,scope:'BANNER',purpose:'banner',status:'STAGED',shop_id:null,shop_owner_id:null,expires_at:new Date(Date.now()+60000),...patch});
const query=(q:any)=>q.strings.join('');

function bindingFixture(rows:any[],references=0,activeAdmin=true) {
  const locks:string[]=[],writes:any[]=[];
  const tx:any={
    user:{findFirst:jest.fn(async()=>activeAdmin?{id:1n}:null)},
    homeBanner:{count:jest.fn(async()=>references)},
    $queryRaw:jest.fn(async(q:any)=>{
      const sql=query(q);
      if(sql.includes('FROM users')){locks.push('actor');return[{id:1n}];}
      if(sql.includes('FROM media_assets')){const id=q.values[0];locks.push(id);return rows.filter(row=>row.id===id);}
      return[];
    }),
    $executeRaw:jest.fn(async(q:any)=>{writes.push(q);return 1;}),
  };
  return{tx,locks,writes};
}

describe('platform banner media authorization and immutable upload targets',()=>{
  test.each(['MERCHANT','STAFF','CUSTOMER'])('rejects %s without consulting media',async role=>{
    const f=bindingFixture([]);
    await expect(requireBannerAdministrator(f.tx,{id:'1',role})).rejects.toThrow('administrator');
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  test('requires a locked, actually active ADMIN instead of trusting a JWT role',async()=>{
    const f=bindingFixture([],0,false);
    await expect(requireBannerAdministrator(f.tx,actor)).rejects.toThrow('Active platform');
    expect(f.locks).toEqual(['actor']);
    expect(f.tx.user.findFirst).toHaveBeenCalledWith({where:{id:1n,role:'ADMIN',status:'ACTIVE',deletedAt:null},select:{id:true}});
  });
  test('banner uploads reject a shop, another purpose and non-admin claims before decoding',async()=>{
    const service:any=new UploadService({}as any);service.storage={require:()=>undefined};
    const dto={scope:'BANNER',purpose:'banner',requestKey:'synthetic-123'};
    await expect(service.upload(actor,{...dto,shopId:'3'},null)).rejects.toThrow('upload target');
    await expect(service.upload(actor,{...dto,purpose:'logo'},null)).rejects.toThrow('upload target');
    await expect(service.upload({id:'2',role:'MERCHANT'},dto,null)).rejects.toThrow('administrator');
    await expect(service.upload(actor,{scope:'SHOP',shopId:'3',purpose:'banner',requestKey:'synthetic-123'},null)).rejects.toThrow('upload target');
  });
  test('banner confirm/abandon revalidate the real role and keep staged ownership private',async()=>{
    const rows=[image()];const f=bindingFixture(rows),service:any=new UploadService({}as any);
    f.tx.$queryRaw=jest.fn(async(q:any)=>query(q).includes('FROM media_assets')?rows:[]);
    await expect(service.owned(f.tx,{id:'2',role:'ADMIN'},first)).rejects.toThrow('Media not found');
    const disabled=bindingFixture(rows,0,false);disabled.tx.$queryRaw=f.tx.$queryRaw;
    await expect(service.owned(disabled.tx,actor,first)).rejects.toThrow('Active platform');
    rows[0]={...rows[0],status:'BOUND'};
    await expect(service.owned(f.tx,{id:'2',role:'ADMIN'},first)).resolves.toMatchObject({status:'BOUND'});
  });
});

describe('banner image transaction binding and last-reference release',()=>{
  test.each([{scope:'SHOP'},{scope:'AVATAR'},{purpose:'cover'},{shop_id:3n},{shop_owner_id:3n},{owner_id:2n},{status:'DELETING'},{status:'ABANDONED'},{expires_at:new Date(0)}])('rejects unavailable or foreign staged asset %s',async patch=>{
    const f=bindingFixture([image(first,patch)]);
    await expect(syncBannerMedia(f.tx,{actor,nextUrl:mediaUrl(first)})).rejects.toThrow('unavailable');
    expect(f.writes).toHaveLength(0);
  });
  test('binds owned unexpired staging, while an existing BOUND platform asset is reusable by another admin',async()=>{
    for(const row of [image(),image(first,{status:'BOUND',owner_id:2n,expires_at:new Date(0)})]) {
      const f=bindingFixture([row]);await syncBannerMedia(f.tx,{actor,nextUrl:mediaUrl(first)});
      expect(query(f.writes[0])).toContain("status='BOUND'");
    }
  });
  test('locks the old and new asset in ID order and retains a shared old image even for drafts',async()=>{
    const f=bindingFixture([image(first),image(second,{status:'BOUND'})],1);
    await syncBannerMedia(f.tx,{actor,previousUrl:mediaUrl(second),nextUrl:mediaUrl(first)});
    expect(f.locks).toEqual(['actor',first,second]);
    expect(f.writes).toHaveLength(1);
    expect(f.tx.homeBanner.count).toHaveBeenCalledWith({where:{imageUrl:mediaUrl(second)}});
  });
  test('releases only a last unreferenced image and never changes an asset from another scope',async()=>{
    const f=bindingFixture([image(first,{status:'BOUND'})]);
    await syncBannerMedia(f.tx,{actor,previousUrl:mediaUrl(first),nextUrl:'https://images.example.invalid/new.webp'});
    expect(query(f.writes[0])).toContain("status='ABANDONED'");
    const other=bindingFixture([image(first,{status:'BOUND',scope:'SHOP'})]);
    await syncBannerMedia(other.tx,{actor,previousUrl:mediaUrl(first),nextUrl:'https://images.example.invalid/new.webp'});
    expect(other.writes).toHaveLength(0);
  });
  test('image URLs accept only the exact managed namespace while external click targets remain HTTPS-only',()=>{
    expect(bannerData({title:'Synthetic',imageUrl:mediaUrl(first)}).imageUrl).toBe(mediaUrl(first));
    for(const targetValue of [mediaUrl(first),'http://example.invalid','javascript:alert(1)'])expect(()=>bannerData({title:'Synthetic',imageUrl:mediaUrl(first),targetType:'EXTERNAL_URL',targetValue})).toThrow('HTTPS');
    expect(()=>bannerData({title:'Synthetic',imageUrl:'/uploads/forged.webp'})).toThrow();
  });
});

describe('bounded retries and both atomic management write paths',()=>{
  test('retries only rolled-back database conflicts, at most three attempts',async()=>{
    const work=jest.fn().mockRejectedValueOnce({code:'P2034'}).mockRejectedValueOnce({code:'P2010',meta:{code:'1213'}}).mockResolvedValue('saved');
    await expect(withBannerMediaRetry(true,work)).resolves.toBe('saved');expect(work).toHaveBeenCalledTimes(3);
    const exhausted=jest.fn().mockRejectedValue({code:'P2034'});
    await expect(withBannerMediaRetry(true,exhausted)).rejects.toThrow('繁忙');expect(exhausted).toHaveBeenCalledTimes(3);
    const storage=jest.fn().mockRejectedValue(new Error('STORAGE_WRITE_FAILED'));
    await expect(withBannerMediaRetry(true,storage)).rejects.toThrow('STORAGE_WRITE_FAILED');expect(storage).toHaveBeenCalledTimes(1);
  });

  function writerFixture(auditFailure=false) {
    let state={banners:[]as any[],media:image(),audits:[]as any[]};const order:string[]=[];
    const db:any={$transaction:async(work:any)=>{
      const draft=structuredClone(state);
      const tx:any={
        user:{findFirst:async()=>({id:1n})},
        homeBanner:{
          findFirst:async({where}:any)=>draft.banners.find(row=>row.id===where.id),
          findUnique:async({where}:any)=>draft.banners.find(row=>row.id===where.id),
          create:async({data}:any)=>{const row={id:1n,clickCount:0,...data};draft.banners.push(row);return row;},
          update:async({where,data}:any)=>{const row=draft.banners.find(item=>item.id===where.id);Object.assign(row,data);return row;},
          count:async({where}:any)=>draft.banners.filter(row=>row.imageUrl===where.imageUrl).length,
        },
        auditLog:{create:async({data}:any)=>{if(auditFailure)throw Error('Synthetic audit failure');draft.audits.push(data);}},
        $queryRaw:async(q:any)=>{const sql=query(q);if(sql.includes('FROM users')){order.push('actor');return[{id:1n}];}if(sql.includes('FROM home_banners')){order.push('banner');return[];}if(sql.includes('FROM media_assets')){order.push('media');return[draft.media];}return[];},
        $executeRaw:async(q:any)=>{if(query(q).includes("status='BOUND'"))draft.media.status='BOUND';return 1;},
      };
      const result=await work(tx);state=draft;return result;
    }};
    return{db,state:()=>state,order};
  }
  test.each(['studio','legacy'])('%s atomically saves, binds and audits, and audit failure rolls all changes back',async kind=>{
    for(const fail of [false,true]) {
      const f=writerFixture(fail),dto={title:'Synthetic banner',imageUrl:mediaUrl(first)};
      const operation=kind==='studio'?new StudioService(f.db).save('banners',undefined,dto,actor):new BannerManageService(f.db).create(dto,'1');
      if(fail){await expect(operation).rejects.toThrow('audit failure');expect(f.state().banners).toHaveLength(0);expect(f.state().media.status).toBe('STAGED');}
      else {await operation;expect(f.state().banners[0].imageUrl).toBe(mediaUrl(first));expect(f.state().media.status).toBe('BOUND');expect(f.state().audits).toHaveLength(1);}
      expect(f.order[0]).toBe('actor');
    }
  });
  test('legacy write locks actor before an existing banner; audit cannot precede failed binding',async()=>{
    const f=writerFixture();
    await contentWrite(f.db,'BANNER',7n,'1','SYNTHETIC',async()=>({id:7n}));
    expect(f.order).toEqual(['actor','banner']);
  });
});

describe('public banner projection and garbage collection reference preservation',()=>{
  test('public managed banners require BOUND BANNER/banner assets; external HTTPS remains supported',async()=>{
    const findFirst=jest.fn().mockResolvedValue(null),db:any={mediaAsset:{findFirst}};
    expect(await publicBannerImageAvailable(db,'https://images.example.invalid/a.webp')).toBe(true);expect(findFirst).not.toHaveBeenCalled();
    expect(await publicBannerImageAvailable(db,mediaUrl(first))).toBe(false);
    expect(findFirst).toHaveBeenCalledWith({where:{id:first,scope:'BANNER',purpose:'banner',status:'BOUND',shopId:null,shopOwnerId:null},select:{id:true}});
    findFirst.mockResolvedValue({id:first});expect(await publicBannerImageAvailable(db,mediaUrl(first))).toBe(true);
  });
  test('public list and click hide unknown/staged/cross-scope managed references before analytics',async()=>{
    const active={...bannerData({title:'Synthetic',imageUrl:mediaUrl(first)}),id:1n,isActive:true,clickCount:0};
    const updateMany=jest.fn(),db:any={homeBanner:{findMany:async()=>[active],findFirst:async()=>active,updateMany},mediaAsset:{findFirst:async()=>null}};
    const service=new BannersService(db);expect(await service.getActiveBanners()).toEqual([]);await expect(service.recordClick('1')).rejects.toThrow('not found');expect(updateMany).not.toHaveBeenCalled();
  });
  test.each([0n,1n])('GC checks all banner references without publication filters (references %s)',async references=>{
    const row:any=image(first,{status:'ABANDONED',expires_at:new Date(0),storage_driver:'local',storage_namespace:'synthetic',object_key:first+'.webp'}),sql:string[]=[],writes:string[]=[];
    const tx:any={$queryRaw:async(q:any)=>{const text=query(q);sql.push(text);if(text.includes('FROM media_assets'))return[row];if(text.includes('total'))return[{total:references}];return[];},$executeRaw:async(q:any)=>{writes.push(query(q));return 1;}};
    const db:any={$queryRaw:async()=>[row],$transaction:async(work:any)=>work(tx),$executeRaw:async(q:any)=>{writes.push(query(q));return 1;}};
    const service:any=new UploadService(db),remove=jest.fn(async()=>undefined);service.storage={available:()=>true,driver:'local',namespace:'synthetic',remove};
    const result=await service.collectGarbage();
    expect(sql.find(text=>text.includes('total'))).toContain('FROM home_banners WHERE image_url=');
    expect(sql.find(text=>text.includes('total'))).not.toMatch(/is_active|start_at|end_at/);
    expect(sql.some(text=>/home_banners.*FOR UPDATE/.test(text))).toBe(false);
    if(references){expect(remove).not.toHaveBeenCalled();expect(writes.some(text=>text.includes("status='BOUND'"))).toBe(true);expect(result.deleted).toBe(0);}
    else {expect(remove).toHaveBeenCalledTimes(1);expect(result.deleted).toBe(1);}
  });
});
