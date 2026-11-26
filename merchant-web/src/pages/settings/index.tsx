import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Space, Spin, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { updateShopProfile, type MyShop } from '../../api/merchant';
import { currentShopAllows, isCurrentShop, useShopId } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import { abandonShopMedia, confirmShopMedia, previewShopMedia, uploadShopMedia } from '../../api/media';
import { MediaDraftSession, type MediaPurpose } from '../../../../src/utils/mediaDraft';
import { hasShopPermission } from '../../utils/shopPermissions';
import { errorMessage } from '../../utils/feedback';
import ShopMediaField, { mediaLines, safeShopImage } from './ShopMediaField';
import { useMerchantDraftProtection } from '../../components/MerchantDraftGuard';
import StoreOrderEmailReadiness from '../../components/StoreOrderEmailReadiness';
import OrderEmailSettings from '../../components/OrderEmailSettings';
import { storeOrderEmailsFromDraft } from '../../../../src/utils/storeOrderEmail';

interface SettingsValues {shopName:string;nameEn:string;phone:string;emails:string;address:string;city:string;state:string;zipCode:string;description:string;logoUrl:string;bannerUrl:string;gallery:string;}
function valuesFromShop(shop:MyShop):SettingsValues {
  const profile=(shop as MyShop&{studioProfile?:Record<string,unknown>}).studioProfile??{};
  const pick=(key:'logoUrl'|'bannerUrl',fallback:string|null|undefined)=>Object.hasOwn(shop,key)?shop[key]??'':Object.hasOwn(profile,key)?typeof profile[key]==='string'?profile[key] as string:'':fallback??'';
  const gallery=Object.hasOwn(shop,'gallery')?shop.gallery??[]:Object.hasOwn(profile,'gallery')?Array.isArray(profile.gallery)?profile.gallery.filter((item):item is string=>typeof item==='string'):[]:shop.media?.galleryUrls??[];
  return {shopName:shop.name,nameEn:shop.nameEn??'',phone:shop.phone??'',emails:Array.isArray(shop.emails)?shop.emails.filter((value):value is string=>typeof value==='string').join('\n'):'',address:shop.address??'',city:shop.city??'',state:shop.state??'',zipCode:shop.zipCode??'',description:shop.description??'',logoUrl:pick('logoUrl',shop.media?.logoUrl),bannerUrl:pick('bannerUrl',shop.media?.coverUrl),gallery:gallery.join('\n')};
}
function profileChanges(values:SettingsValues,saved:SettingsValues,emailsKnown:boolean):Parameters<typeof updateShopProfile>[1] {
  const fields=(draft:SettingsValues)=>({name:draft.shopName.trim(),nameEn:draft.nameEn?.trim()??'',phone:draft.phone?.trim()??'',address:draft.address?.trim()??'',city:draft.city?.trim()??'',state:draft.state?.trim()??'',zipCode:draft.zipCode?.trim()??'',description:draft.description??'',logoUrl:draft.logoUrl?.trim()??'',bannerUrl:draft.bannerUrl?.trim()??'',gallery:mediaLines(draft.gallery??'')});
  const next=fields(values),previous=fields(saved);
  // A same-shop refresh may update untouched fields while this draft remains open.
  const changes=Object.fromEntries(Object.entries(next).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(previous[key as keyof typeof previous]))) as Parameters<typeof updateShopProfile>[1];
  if(emailsKnown&&values.emails!==saved.emails)changes.emails=storeOrderEmailsFromDraft(values.emails??'');
  return changes;
}
function checkedProfile(shop:MyShop,shopId:string,emailsKnown:boolean):SettingsValues {
  const invalid=()=>new Error('无法核对门店资料的完整保存结果，请保留草稿并重新读取核对。');
  if(!shop||String(shop.id)!==shopId||typeof shop.name!=='string'||!shop.name.trim())throw invalid();
  for(const field of ['nameEn','phone','address','city','state','zipCode','description'] as const){if(!Object.hasOwn(shop,field)||shop[field]!==null&&typeof shop[field]!=='string')throw invalid();}
  if(emailsKnown&&(!Array.isArray(shop.emails)||shop.emails.some(value=>typeof value!=='string')))throw invalid();
  if(!Object.hasOwn(shop,'logoUrl')||shop.logoUrl!==null&&typeof shop.logoUrl!=='string'||!Object.hasOwn(shop,'bannerUrl')||shop.bannerUrl!==null&&typeof shop.bannerUrl!=='string'||!Array.isArray(shop.gallery)||shop.gallery.some(value=>typeof value!=='string'))throw invalid();
  return valuesFromShop(shop);
}
interface ProfileRecovery {draft:SettingsValues;changes:ReturnType<typeof profileChanges>;emailsKnown:boolean;}
interface ProfileReview {shop:MyShop;saved:SettingsValues;draft:SettingsValues;differences:(keyof SettingsValues)[];}
const profileLabels:Record<keyof SettingsValues,string>={shopName:'门店名称',nameEn:'英文名称',phone:'电话',emails:'公开联系邮箱',address:'地址',city:'城市',state:'州',zipCode:'邮政编码',description:'门店简介',logoUrl:'门店标志',bannerUrl:'封面图片',gallery:'门店相册'};
function recoverDraft(next:SettingsValues,recovery:ProfileRecovery):SettingsValues {
  const draft={...next};
  for(const key of Object.keys(recovery.changes)){
    const field=(key==='name'?'shopName':key) as keyof SettingsValues;
    if(Object.hasOwn(recovery.draft,field))Object.assign(draft,{[field]:recovery.draft[field]});
  }
  return draft;
}
export default function SettingsPage(){
  const {shopId,shop,loading,refreshing,error,retry,updateShop,reloadShop}=useShopId();const identity=useAuthStore(state=>state.merchant?.id);
  if(loading)return <div style={{padding:64,textAlign:'center'}}><Spin size="large" /></div>;
  if(!shopId||!shop)return error?<Alert type="error" showIcon title={error} action={<Button onClick={()=>void retry()}>重试</Button>} />:<Alert type="info" showIcon title="请选择已授权门店。" />;
  return <SettingsForm key={shopId+':'+identity} shop={shop} accessReady={!refreshing&&!error} updateShop={updateShop} reloadShop={reloadShop} />;
}
function SettingsForm({shop,accessReady,updateShop,reloadShop}:{shop:MyShop;accessReady:boolean;updateShop:(shop:MyShop)=>void;reloadShop:(shopId:string)=>Promise<MyShop>}) {
  const canManage=accessReady&&hasShopPermission(shop,'SHOP_SETTINGS_MANAGE'),actorId=useAuthStore(state=>state.merchant?.id);
  const shopId=shop.id,[form]=Form.useForm<SettingsValues>(),[modal,context]=Modal.useModal();
  const [params]=useSearchParams(),emailsKnown=Array.isArray(shop.emails);
  const [saved,setSaved]=useState(()=>valuesFromShop(shop)),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[uploading,setUploading]=useState(false),[discarding,setDiscarding]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[unknown,setUnknown]=useState(false),[review,setReview]=useState<ProfileReview|null>(null);
  const alive=useRef(true),locked=useRef(false),unknownRef=useRef(false),recovery=useRef<ProfileRecovery|null>(null),reviewRef=useRef<ProfileReview|null>(null);
  const [media] = useState(() => new MediaDraftSession(shopId, {
    upload: (file, purpose, key) => uploadShopMedia(shopId, file, purpose, key),
    confirm: confirmShopMedia,
    preview: previewShopMedia,
    abandon: abandonShopMedia,
  }));
  const markUnknown=(value:boolean)=>{unknownRef.current=value;setUnknown(value);};
  const showReview=(value:ProfileReview|null)=>{reviewRef.current=value;setReview(value);};
  const current=()=>alive.current&&actorId===useAuthStore.getState().merchant?.id&&isCurrentShop(shopId);
  useEffect(() => {
    alive.current = true;
    media.activate();
    return () => {
      alive.current = false;
      // The server may still be binding staged media from a dispatched save.
      if (recovery.current) media.releasePreviews();
      else void media.dispose();
    };
  }, [media]);
  useEffect(()=>{if(params.get('focus')==='order-email'&&canManage)document.getElementById(`order-email-heading-${shopId}`)?.focus();},[params,canManage,shopId]);
  const busy=saving||uploading||discarding;
  useEffect(()=>{if(dirty||busy||locked.current||unknownRef.current)return;const next=valuesFromShop(shop);form.setFieldsValue(next);setSaved(next);},[shop,form,dirty,busy]);
  useMerchantDraftProtection(shopId,dirty,busy,()=>locked.current||unknownRef.current);
  const upload=async(file:File,purpose:MediaPurpose)=>{if(locked.current||unknownRef.current||!current()||!canManage||!currentShopAllows(shopId,'SHOP_SETTINGS_MANAGE'))throw new Error('当前门店不可编辑。');locked.current=true;setUploading(true);setNotice('');try{const url=await media.upload(file,purpose);if(!current())throw new Error('所选门店已切换，文件未应用。');return url;}finally{locked.current=false;if(current())setUploading(false);}};
  const validateImage=(_:unknown,value:string)=>!value?.trim()||safeShopImage(value)?Promise.resolve():Promise.reject(new Error('请使用不含登录凭据的HTTPS地址，或服务器返回的完整受管图片地址。'));
  async function save(values:SettingsValues){
    if(locked.current||unknownRef.current||!current()||!canManage||!currentShopAllows(shopId,'SHOP_SETTINGS_MANAGE'))return;locked.current=true;setSaving(true);setError('');setNotice('');
    let submitted=false,persisted=false;
    try{const changes=profileChanges(values,saved,emailsKnown);recovery.current={draft:{...values},changes,emailsKnown};
      let updated=shop;if(Object.keys(changes).length){submitted=true;updated=await updateShopProfile(shopId,changes);persisted=true;}
      if(!current())return;const next=checkedProfile(updated,shopId,emailsKnown),remaining=profileChanges(values,next,emailsKnown);
      if(Object.keys(changes).some(key=>Object.hasOwn(remaining,key)))throw new Error('保存回执与提交的门店资料不一致，请重新读取核对，不要重复保存。');
      form.setFieldsValue(next);setSaved(next);setDirty(false);updateShop(updated);const failures=await media.saved([next.logoUrl,next.bannerUrl,...mediaLines(next.gallery)]);if(current()){recovery.current=null;setNotice(failures?'设置已保存，部分未使用的临时文件仍待清理；放弃草稿或离开页面时将重试。':'门店设置已保存，上传图片已关联到保存资料。');}
    }catch(cause){if(current()){const status=(cause as {response?:{status?:number}})?.response?.status;if(submitted&&(persisted||!status||status===408||status>=500))markUnknown(true);else recovery.current=null;setError(errorMessage(cause));}}finally{locked.current=false;if(current())setSaving(false);}
  }
  async function reconcile(){
    const pending=recovery.current;if(locked.current||!unknownRef.current||!pending||!current())return;
    locked.current=true;setSaving(true);setError('');setNotice('');showReview(null);
    try{const updated=await reloadShop(shopId);if(!current())return;const next=checkedProfile(updated,shopId,pending.emailsKnown),draft=recoverDraft(next,pending),differences=Object.keys(profileChanges(draft,next,pending.emailsKnown)).map(key=>(key==='name'?'shopName':key) as keyof SettingsValues);
      // A read of old values cannot prove that a timed-out PATCH will never
      // commit. Keep its fence and uploaded draft until explicit review ends.
      if(differences.length){showReview({shop:updated,saved:next,draft,differences});return;}
      const failures=await media.saved([next.logoUrl,next.bannerUrl,...mediaLines(next.gallery)]);if(!current())return;
      form.setFieldsValue(next);setSaved(next);setDirty(false);updateShop(updated);recovery.current=null;markUnknown(false);
      setNotice(failures?'已核对保存结果，部分未使用的暂存图片仍待清理。':'已核对保存结果，门店资料已保存。');
    }catch(cause){if(current())setError(errorMessage(cause));}finally{locked.current=false;if(current())setSaving(false);}
  }
  async function finishReview(){
    const inspected=reviewRef.current,pending=recovery.current;if(locked.current||!unknownRef.current||!inspected||!pending||!current())return;
    locked.current=true;setSaving(true);
    try{if(!await modal.confirm({title:'已核对，结束本次操作？',content:'当前读回资料尚未与提交内容一致，不能据此确定原请求没有保存；原请求仍可能稍后生效。确认后只解除本次核对，保留修改草稿，不会自动再次保存。请核对最新资料后再决定后续操作。',okText:'结束核对并保留草稿',cancelText:'继续核对'})||!current()||reviewRef.current!==inspected||recovery.current!==pending)return;
      form.setFieldsValue(inspected.draft);setSaved(inspected.saved);setDirty(true);updateShop(inspected.shop);recovery.current=null;showReview(null);markUnknown(false);setError('');setNotice('已结束本次核对，未匹配的修改保留为草稿，未重复提交。原请求仍可能稍后生效，请核对最新门店资料后再决定是否保存。');
    }finally{locked.current=false;if(current())setSaving(false);}
  }
  return <div className="merchant-page">{context}<Typography.Title level={4}>门店设置</Typography.Title>
    <Alert type="info" showIcon title={`门店时区：${shop.timezone||'尚未设置'}`} description={<span>发布与预约开关由平台管理；营业时间、场地和员工排班需要预约设置权限。 {hasShopPermission(shop,'RESERVATION_CONFIG') && <Link to="/reservations?tab=hours">打开预约设置</Link>} 图片先暂存，保存设置后才会正式关联。</span>} />
    {error&&<Alert type="error" showIcon title={error} description="当前草稿已保留。" />}{notice&&<Alert type="success" showIcon title={notice} />}
    {unknown&&<Alert type="warning" showIcon title="门店资料保存结果尚未确认" description="草稿已保留，暂不能重复保存、切换门店或退出。请重新读取当前资料核对；此操作不会再次提交修改。" action={<Button disabled={busy} onClick={reconcile}>刷新并核对保存结果</Button>} />}
    {unknown&&review&&<Card title="服务器资料与提交草稿尚未一致" style={{marginTop:16}}><Typography.Paragraph>以下是最近一次读回的差异。原请求仍可能稍后生效，当前继续保留保存锁；重新读取不会重复保存。</Typography.Paragraph><dl>{review.differences.map(field=><div key={field} style={{marginBottom:12,overflowWrap:'anywhere'}}><dt><strong>{profileLabels[field]}</strong></dt><dd style={{whiteSpace:'pre-wrap'}}>服务器：{review.saved[field]||'（空）'}</dd><dd style={{whiteSpace:'pre-wrap'}}>草稿：{review.draft[field]||'（空）'}</dd></div>)}</dl><Button disabled={busy} onClick={finishReview}>已核对，结束本次操作</Button></Card>}
    {!canManage&&<Alert type="warning" showIcon title={accessReady?'当前账号没有本店资料编辑权限，草稿保留为只读。':'正在核对权限或刷新失败，草稿保留，暂不可保存。'} />}
    {hasShopPermission(shop, 'SHOP_SETTINGS_MANAGE') ? <OrderEmailSettings shopId={shopId} disabled={!canManage || busy || unknown} /> : <StoreOrderEmailReadiness shop={shop} available={accessReady} />}
    <Form form={form} layout="vertical" initialValues={saved} disabled={busy||unknown||!canManage} onValuesChange={()=>{if(locked.current||unknownRef.current||!current())return;setDirty(true);setNotice('');}} onFinish={save}>
      <Card title="门店资料" extra={hasShopPermission(shop, 'CATALOG_MANAGE') && <Link to={`/price-menu?shopId=${encodeURIComponent(shopId)}`}>维护价目与预约项目</Link>}><Form.Item name="shopName" label="门店名称" rules={[{required:true,whitespace:true}]}><Input /></Form.Item><Form.Item name="nameEn" label="英文名称"><Input /></Form.Item><Form.Item name="phone" label="电话"><Input /></Form.Item><Form.Item name="emails" label="公开联系邮箱" extra={emailsKnown?"每行一条，最多 5 条；这些地址会展示给顾客。预约通知收件人请在上方专用设置中验证，不修改账号登录邮箱。":"当前接口尚未提供邮箱资料，请刷新后再编辑；不会用空值覆盖原邮箱。"} rules={[{validator:(_,value:string)=>{if(!emailsKnown)return Promise.resolve();try{storeOrderEmailsFromDraft(value??'');return Promise.resolve();}catch(cause){return Promise.reject(cause);}}}]}><Input.TextArea id="store-order-emails" rows={2} disabled={busy||unknown||!canManage||!emailsKnown} placeholder="orders@example.com" /></Form.Item><Form.Item name="address" label="地址"><Input.TextArea rows={2} /></Form.Item><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:16}}><Form.Item name="city" label="城市"><Input /></Form.Item><Form.Item name="state" label="州"><Input /></Form.Item><Form.Item name="zipCode" label="邮政编码"><Input /></Form.Item></div><Form.Item name="description" label="门店简介" extra="仅填写门店介绍。项目名称、价格、时长和预约开关请在“项目与价目”统一维护。"><Input.TextArea rows={4} /></Form.Item></Card>
      <Card title="门店标志" style={{marginTop:20}}><Form.Item name="logoUrl" rules={[{validator:validateImage}]}><ShopMediaField purpose="logo" disabled={busy||unknown||!canManage} upload={upload} previewUrls={media.previewUrls} /></Form.Item></Card>
      <Card title="封面图片" style={{marginTop:20}}><Form.Item name="bannerUrl" rules={[{validator:validateImage}]}><ShopMediaField purpose="cover" disabled={busy||unknown||!canManage} upload={upload} previewUrls={media.previewUrls} /></Form.Item></Card>
      <Card title="门店相册·按保存顺序展示" style={{marginTop:20}}><Form.Item name="gallery" rules={[{validator:(_,value:string)=>{const urls=mediaLines(value??'');return urls.length<=20&&urls.every(url=>!!safeShopImage(url))?Promise.resolve():Promise.reject(new Error('最多填写20个有效图片地址。'));}}]}><ShopMediaField purpose="gallery" disabled={busy||unknown||!canManage} upload={upload} previewUrls={media.previewUrls} /></Form.Item></Card>
      <Space wrap style={{marginTop:20}}><Button type="primary" htmlType="submit" loading={saving} disabled={busy||unknown||!canManage}>保存设置</Button><Button disabled={busy||unknown||!canManage} loading={discarding} onClick={async()=>{if(locked.current||unknownRef.current||!current())return;if(dirty&&!await modal.confirm({title:'放弃尚未保存的门店修改？',content:'已保存资料保留，本草稿中尚未关联的上传文件将被清理。',okText:'放弃草稿'}))return;if(locked.current||unknownRef.current||!current())return;locked.current=true;setDiscarding(true);setError('');try{if(await media.cleanup())throw new Error('部分暂存图片未能清理，请重试；已保存的图片保持不变。');if(current()){form.setFieldsValue(saved);setDirty(false);setNotice('已放弃未保存的修改。');}}catch(error){if(current())setError(errorMessage(error));}finally{locked.current=false;if(current())setDiscarding(false);}}}>放弃未保存修改</Button><Typography.Text type="secondary">{unknown?'保存结果待核对':uploading?'正在上传并验证图片…':dirty?'有未保存修改':'与已保存门店资料一致'}</Typography.Text></Space>
    </Form>
  </div>;
}
