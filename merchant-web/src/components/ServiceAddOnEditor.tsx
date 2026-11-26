import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Card,Empty,Form,Input,InputNumber,Modal,Space,Switch,Tag,Typography} from 'antd';
import {saveServiceAddOn,disableServiceAddOn,type ReservationService,type ServiceAddOn} from '../api/reservations';
import {currentShopAllows,isCurrentShop,useShopId} from '../hooks/useShopId';
import {useAuthStore} from '../stores/authStore';
import {useMerchantDraftProtection} from './MerchantDraftGuard';
import {errorMessage,money} from '../utils/feedback';
import {EMPTY_PROJECT_EDITOR,type ProjectEditorState} from '../utils/projectWorkspace';

interface Values{name:string;description:string;price:string;isActive:boolean;sortOrder:number;}
function priceCents(raw:string){
  if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(raw))throw Error('价格须填写美元金额，最多两位小数。');
  const [whole,fraction='']=raw.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(cents>10000000)throw Error('价格不得超过100000美元。');return cents;
}
export default function ServiceAddOnEditor({shopId,service,onSaved,disabled=false,beforeWrite,onLifecycleChange}:{shopId:string;service:ReservationService;onSaved:()=>void|Promise<void>;disabled?:boolean;beforeWrite?:()=>boolean;onLifecycleChange?:(state:ProjectEditorState)=>void}){
  const {refreshing,error:accessError}=useShopId(),actorId=useAuthStore(state=>state.merchant?.id);
  const [form]=Form.useForm<Values>(),[modal,context]=Modal.useModal();
  const [editing,setEditing]=useState<ServiceAddOn|null|undefined>(),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
  const alive=useRef(true),locked=useRef(false),uncertainRef=useRef(false);
  const markUncertain=(value:boolean)=>{uncertainRef.current=value;setUncertain(value);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{setEditing(undefined);setDirty(false);uncertainRef.current=false;setUncertain(false);setError('');},[actorId,shopId,service.id]);
  const sameIdentity=()=>alive.current&&useAuthStore.getState().merchant?.id===actorId&&isCurrentShop(shopId);
  const current=()=>sameIdentity()&&currentShopAllows(shopId,'CATALOG_MANAGE')&&!disabled;
  const canEdit=!refreshing&&!accessError&&current()&&!uncertain;
  useEffect(()=>{onLifecycleChange?.({dirty,busy:busy||editing!==undefined,unknown:uncertain});},[dirty,busy,editing,uncertain,onLifecycleChange]);
  useEffect(()=>()=>{onLifecycleChange?.(EMPTY_PROJECT_EDITOR);},[onLifecycleChange]);
  useMerchantDraftProtection(shopId,dirty,busy,()=>locked.current||uncertainRef.current);
  const open=(row:ServiceAddOn|null)=>{if(!current()||locked.current||uncertainRef.current||beforeWrite&&!beforeWrite())return;form.resetFields();form.setFieldsValue(row?{name:row.name,description:row.description??'',price:(row.priceCents/100).toFixed(2),isActive:row.isActive,sortOrder:row.sortOrder}:{name:'',description:'',price:'',isActive:false,sortOrder:0});setEditing(row);setDirty(false);markUncertain(false);setError('');};
  const close=async()=>{
    if(locked.current)return;
    const needsReconciliation=uncertainRef.current;
    if((dirty||needsReconciliation)&&!await modal.confirm({title:needsReconciliation?'关闭并刷新核对保存结果？':'放弃尚未保存的附加项目？',content:needsReconciliation?'此前请求结果尚未确认，请先在列表核对，不要重复新增。':'当前输入尚未保存。',okText:needsReconciliation?'刷新核对':'放弃',cancelText:'继续编辑'}))return;
    if(!sameIdentity())return;
    if(uncertainRef.current){locked.current=true;setBusy(true);try{await onSaved();if(sameIdentity()){markUncertain(false);setEditing(undefined);setDirty(false);setError('');}}catch(cause){if(sameIdentity())setError(errorMessage(cause));}finally{locked.current=false;if(alive.current)setBusy(false);}}
    else{setEditing(undefined);setDirty(false);}
  };
  const save=async()=>{
    if(locked.current||!current()||uncertainRef.current||editing===undefined||beforeWrite&&!beforeWrite())return;
    locked.current=true;setBusy(true);setError('');let submitted=false,persisted=false;
    try{
      const values=await form.validateFields();
      const payload:Omit<ServiceAddOn,'id'|'serviceId'>={name:values.name.trim(),description:values.description?.trim()||null,priceCents:priceCents(values.price),currency:'usd',isActive:values.isActive,sortOrder:values.sortOrder};
      if(!current()||beforeWrite&&!beforeWrite())return;
      submitted=true;await saveServiceAddOn(shopId,service.id,payload,editing?.id);persisted=true;
      if(!sameIdentity())return;await onSaved();
      if(sameIdentity()){setDirty(false);setEditing(undefined);}
    }catch(cause:any){if(sameIdentity()){setError(submitted?errorMessage(cause):cause instanceof Error?cause.message:'请核对附加项目名称、价格和排序。');if(submitted&&(persisted||!cause?.response?.status||cause.response.status>=500||cause.response.status===408))markUncertain(true);}}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  };
  const disable=async(row:ServiceAddOn)=>{
    if(locked.current||!current()||uncertainRef.current||beforeWrite&&!beforeWrite()||!await modal.confirm({title:'停用这个附加项目？',content:'顾客不能再选取；已有订单继续保留原名称和价格，不会改变预约金额。',okText:'停用',cancelText:'取消'})||!current()||uncertainRef.current||beforeWrite&&!beforeWrite())return;
    locked.current=true;setBusy(true);setError('');let persisted=false;try{await disableServiceAddOn(shopId,row.id);persisted=true;if(sameIdentity())await onSaved();}catch(cause:any){if(sameIdentity()){setError(errorMessage(cause));if(persisted||!cause?.response?.status||cause.response.status>=500||cause.response.status===408)markUncertain(true);}}finally{locked.current=false;if(alive.current)setBusy(false);}
  };
  return <Card title="附加项目 · 只加价，不加时" extra={<Button disabled={!canEdit||busy||(service.addOns?.length??0)>=50} onClick={()=>open(null)}>新增附加项目</Button>}>
    {context}{!currentShopAllows(shopId,'CATALOG_MANAGE')&&<Alert style={{marginBottom:12}} type="info" showIcon title="附加项目名称、价格与启停由服务目录权限维护；当前账号仅可查看。" />}{uncertain&&editing===undefined&&<Alert type="warning" showIcon title="附加项目操作结果尚未确认" action={<Button disabled={busy} onClick={()=>void close()}>刷新并核对原操作</Button>} />}<Typography.Paragraph type="secondary">每项仅附属于这个主服务。顾客为每位参与人、每段主服务分别选择，不自动乘人数；不额外占用技师或房间。优惠券只抵主服务。</Typography.Paragraph>
    {error&&editing===undefined&&<Alert type="error" showIcon title={error} style={{marginBottom:12}} />}
    {(service.addOns??[]).length?<div className="merchant-resource-list">{service.addOns!.map(row=><article key={row.id} className="merchant-resource-row"><div><Space wrap><strong>{row.name}</strong><Tag color={row.isActive?'cyan':'default'}>{row.isActive?'已启用':'已停用'}</Tag></Space><p>{money(row.priceCents,row.currency)} · 每位客人的本主项目一次 · 不加时</p>{row.description&&<p>{row.description}</p>}</div><Space><Button disabled={!canEdit||busy} onClick={()=>open(row)}>编辑</Button><Button danger disabled={!canEdit||busy||!row.isActive} onClick={()=>void disable(row)}>停用</Button></Space></article>)}</div>:<Empty description="暂无在线附加项目。展示价目中的附加项目需在这里明确配置后，顾客才能选择。" />}
    <Modal open={editing!==undefined} title={editing?'编辑附加项目':'新增附加项目'} onCancel={()=>void close()} closable={!busy} maskClosable={false} destroyOnHidden footer={<Space><Button disabled={busy} onClick={()=>void close()}>关闭</Button><Button type="primary" loading={busy} disabled={!canEdit||uncertain} onClick={()=>void save()}>保存附加项目</Button></Space>}>
      <Form form={form} layout="vertical" preserve={false} onValuesChange={()=>setDirty(true)} disabled={!canEdit||busy}>
        <Form.Item name="name" label="附加项目名称" rules={[{required:true,whitespace:true,max:100}]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="price" label="价格（美元）" rules={[{required:true}]}><Input inputMode="decimal" placeholder="例如10.00，免费项目明确填写0" /></Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea maxLength={1000} rows={2} /></Form.Item>
        <Form.Item name="sortOrder" label="排序" rules={[{required:true,type:'integer',min:0,max:10000}]}><InputNumber min={0} max={10000} precision={0} /></Form.Item>
        <Form.Item name="isActive" label="启用供顾客选择" valuePropName="checked"><Switch /></Form.Item>
      </Form>
      {error&&<Alert type="error" showIcon title={error} />}{uncertain&&<Alert style={{marginTop:12}} type="warning" showIcon title="保存结果尚未确认" description="请关闭并刷新列表核对，本窗口不会重复新增。" />}
    </Modal>
  </Card>;
}
