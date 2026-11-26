import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { getGiftOrder, getGiftOrders, getGiftSalesPolicy, recordGiftSale, saveGiftSalesPolicy, type GiftOrder, type GiftPage, type GiftSaleMethod, type GiftSalesPolicy } from '../../api/gifts';
import { isCurrentShop } from '../../hooks/useShopId';
import { errorMessage, money } from '../../utils/feedback';
import { giftTimestamp } from '../../utils/giftTime';

const statuses:Record<string,string>={PENDING:'待到店付款',PAID:'已登记付款',CANCELLED:'已取消',REFUNDED:'已登记退款'};
const methods:Record<GiftSaleMethod,string>={CASH:'现金',EXTERNAL_CARD:'在系统外已完成的刷卡付款',OTHER:'其他实际付款方式'};
type EvidenceForm={method:GiftSaleMethod;reference?:string;reason:string;ack:boolean};
export default function GiftOrdersPanel({shopId,onBusyChange}:{shopId:string;onBusyChange:(value:boolean)=>void}) {
  const [result,setResult]=useState<GiftPage<GiftOrder>|null>(null),[policy,setPolicy]=useState<GiftSalesPolicy|null>(null);
  const [page,setPage]=useState(1),[filters,setFilters]=useState<{status?:string;userId?:string}>({}),[reload,setReload]=useState(0);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState<GiftOrder|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState(''),[action,setAction]=useState<'receipts'|'refunds'|null>(null);
  const [filterForm]=Form.useForm(),[form]=Form.useForm<EvidenceForm>(),[modal,modalContext]=Modal.useModal();
  const mounted=useRef(true),locked=useRef(false),requests=useRef(new Set<AbortController>()),version=useRef(0),request=useRef<{fingerprint:string;key:string}|null>(null);
  const current=()=>mounted.current&&isCurrentShop(shopId);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;requests.current.forEach(item=>item.abort());onBusyChange(false);};},[onBusyChange]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setResult(null);setPolicy(null);setError('');
    Promise.all([getGiftOrders(shopId,{page,pageSize:25,...filters},controller.signal),getGiftSalesPolicy(shopId,controller.signal)]).then(([orders,policy])=>{if(!controller.signal.aborted&&current()){if(!orders.items.length&&page>Math.max(1,orders.totalPages)){setPage(Math.max(1,orders.totalPages));return;}setResult(orders);setPolicy(policy);}}).catch(error=>{if(!controller.signal.aborted&&current())setError(errorMessage(error));}).finally(()=>{if(!controller.signal.aborted&&current())setLoading(false);});return()=>controller.abort();
  },[shopId,page,filters,reload]);
  async function loadDetail(id:string) {const ownVersion=++version.current,controller=new AbortController();requests.current.add(controller);setDetailLoading(true);setDetailError('');
    try{const row=await getGiftOrder(shopId,id,controller.signal);if(current()&&!controller.signal.aborted&&ownVersion===version.current)setSelected(row);}
    catch(error){if(current()&&!controller.signal.aborted&&ownVersion===version.current)setDetailError(errorMessage(error));}
    finally{requests.current.delete(controller);if(current()&&ownVersion===version.current)setDetailLoading(false);}
  }
  async function mutate<T>(run:(signal:AbortSignal)=>Promise<T>,done:(value:T)=>void) {
    if(locked.current||!current())return;locked.current=true;setBusy(true);onBusyChange(true);setError('');setDetailError('');setNotice('');const controller=new AbortController();requests.current.add(controller);
    try{const value=await run(controller.signal);if(current()&&!controller.signal.aborted)done(value);}
    catch(error){if(current()&&!controller.signal.aborted){setError(errorMessage(error));setDetailError(errorMessage(error)+'保持原请求不变重试时会使用同一请求键；修改前请先核对记录。');}}
    finally{requests.current.delete(controller);locked.current=false;if(current()){setBusy(false);onBusyChange(false);}}
  }
  function close(){if(locked.current)return;++version.current;setSelected(null);setAction(null);setDetailError('');setDetailLoading(false);}
  return <div className="merchant-page">{modalContext}
    <Card title="到店付礼品销售"><div style={{marginBottom:16}}><Button disabled={!policy||loading||busy} onClick={async()=>{if(!policy)return;const enabled=!policy.payAtStoreEnabled;
      if(!await modal.confirm({title:enabled?'开启到店付礼品订单？':'停止接收新礼品订单？',content:enabled?'顾客可创建未付款订单。请在实际收齐全部款项后登记收款并发放权益。':'现有订单与已发权益保持有效。',okText:enabled?'启用':'停用'}))return;
      if(current())await mutate(signal=>saveGiftSalesPolicy(shopId,enabled,signal),row=>{setPolicy(row);setNotice('服务器已保存本店销售规则。');});
    }}>{policy?policy.payAtStoreEnabled?'已启用·停止新销售':'已停用·开启销售':'正在加载规则'}</Button></div>
      <Typography.Paragraph>线上礼品付款尚未启用，此规则仅用于本店。登记收款不会向银行卡扣款，登记退款不会转账；免费赠送另行处理。</Typography.Paragraph>
    </Card>
    {error&&<Alert type="error" showIcon title={error} action={<Button disabled={busy} onClick={()=>setReload(value=>value+1)}>刷新</Button>} />}{notice&&<Alert type="success" showIcon title={notice} />}
    <Card><Form form={filterForm} layout="inline" className="merchant-inline-form" disabled={busy} onFinish={values=>{setFilters({status:values.status,userId:values.userId?.trim()||undefined});setPage(1);}}>
      <Form.Item name="status"><Select aria-label="礼品订单状态" placeholder="全部订单状态" allowClear style={{minWidth:210}} options={Object.entries(statuses).map(([value,label])=>({value,label}))} /></Form.Item><Form.Item name="userId" rules={[{pattern:/^[1-9]\d*$/,message:'请填写正整数顾客编号。'}]}><Input aria-label="礼品订单顾客编号" placeholder="完整顾客编号" allowClear /></Form.Item><Form.Item><Space wrap><Button type="primary" htmlType="submit">应用</Button><Button onClick={()=>{filterForm.resetFields();setFilters({});setPage(1);}}>重置</Button><Button onClick={()=>setReload(value=>value+1)}>刷新</Button></Space></Form.Item>
    </Form></Card>
    <Table<GiftOrder> rowKey="id" loading={loading} dataSource={result?.items??[]} scroll={{x:1050}} pagination={{current:page,pageSize:25,total:result?.total??0,showSizeChanger:false,onChange:setPage,showTotal:total=>`${total}笔订单`}} columns={[
      {title:'订单／产品',render:(_,row)=><><strong>{row.productTitleSnapshot||'历史快照不完整'}</strong><p className="merchant-secondary merchant-id">{row.orderNo}</p></>},
      {title:'顾客',dataIndex:'userId'},{title:'原始金额',render:(_,row)=>money(row.amountCents,row.currency)},{title:'已付／已退',render:(_,row)=><>{money(row.paidCents,row.currency)}<br/><span className="merchant-secondary">已退 {money(row.refundedCents,row.currency)}</span></>},
      {title:'状态',render:(_,row)=><Tag>{statuses[row.status]??row.status}</Tag>},{title:'创建时间（门店）',render:(_,row)=>giftTimestamp(row.createdAt,row.timezone)},
      {title:'操作',render:(_,row)=><Button disabled={busy} onClick={()=>{setSelected(row);setAction(null);void loadDetail(row.id);}}>详情／处理</Button>},
    ]} />
    <Modal open={!!selected} title="礼品购买订单" footer={null} width={760} maskClosable={false} closable={!busy} keyboard={!busy} onCancel={close} destroyOnHidden>
      <div className="merchant-modal-stack">{detailError&&<Alert type="error" showIcon title={detailError} />}{detailLoading?<Spin />:selected&&<>
        <Descriptions column={{xs:1,sm:2}} bordered items={[
          {key:'order',label:'订单',children:selected.orderNo},{key:'product',label:'产品',children:selected.productTitleSnapshot||'未提供'},
          {key:'user',label:'顾客编号',children:selected.userId},{key:'status',label:'状态',children:statuses[selected.status]??selected.status},
          {key:'amount',label:'原始金额',children:money(selected.amountCents,selected.currency)},{key:'paid',label:'已付',children:money(selected.paidCents,selected.currency)},
          {key:'refund',label:'已退',children:money(selected.refundedCents,selected.currency)},{key:'right',label:'权益',children:<span className="merchant-id">{selected.entitlementId||'尚未发放'}</span>},
          {key:'uses',label:'购买规则快照',children:`${selected.useTimesSnapshot??'—'}次 · 发放后${selected.expireDaysSnapshot??'—'}天`},
        ]} />
        {selected.paymentMethod==='LEGACY'&&<Alert type="warning" title="历史付款方式" description="该订单不可再登记新收款；如允许，请由顾客取消后重新下单。" />}
        {([['收款记录',selected.receipts],['退款',selected.refunds]] as const).map(([title,rows])=><Card key={title} size="small" title={title}>{!(rows??[]).length?<Typography.Text type="secondary">暂无记录</Typography.Text>:(rows??[]).map(row=><div key={row.id} style={{marginBottom:16}}><strong>{money(row.amountCents,selected.currency)} · {methods[row.method]??row.method}</strong><p className="merchant-secondary">{giftTimestamp(row.createdAt,selected.timezone)} · 操作人编号 #{row.operatorId}</p>{row.reference&&<p className="merchant-id">参考编号： {row.reference}</p>}<Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>顾客可见备注： {row.reason}</Typography.Paragraph></div>)}</Card>)}
        {!action?<Space wrap><Button disabled={busy} onClick={()=>void loadDetail(selected.id)}>刷新详情</Button>{selected.allowedActions.recordReceipt&&<Button type="primary" disabled={busy} onClick={()=>{setAction('receipts');request.current=null;form.resetFields();}}>登记实际全额收款</Button>}{selected.allowedActions.recordRefund&&<Button danger disabled={busy} onClick={()=>{setAction('refunds');request.current=null;form.resetFields();}}>登记实际全额退款</Button>}</Space>:<Card title={`${action==='receipts'?'实际收款':'实际退款'} · ${money(selected.amountCents,selected.currency)}`}>
          <Alert type="warning" showIcon title="登记已实际收到或退还的款项" description="此操作不会向银行卡扣款或发起退款。退款须为完全未使用的已购权益，并退还原全额。备注与参考编号对顾客可见，请勿填写银行卡或私密信息。" />
          <Form form={form} layout="vertical" disabled={busy} initialValues={{method:'CASH',ack:false}} onValuesChange={()=>{request.current=null;}} onFinish={async values=>{
            if(!action||!values.ack||!values.reason.trim()||!current())return;const kind=action,payload={amountCents:selected.amountCents,method:values.method,reference:values.reference?.trim()||undefined,reason:values.reason.trim()},fingerprint=JSON.stringify({shopId,id:selected.id,kind,...payload});
            if(!request.current||request.current.fingerprint!==fingerprint)request.current={fingerprint,key:crypto.randomUUID()};
            if(!await modal.confirm({title:kind==='receipts'?'确认已实际收到全额付款？':'确认已实际完成全额退款？',content:`${money(payload.amountCents,selected.currency)}. ${kind==='receipts'?'服务器仅会发放一次已购权益。':'未使用权益将被作废，不会发起支付渠道退款。'}`,okText:kind==='receipts'?'登记已完成收款':'登记已完成退款',okButtonProps:{danger:kind==='refunds'}}))return;
            if(current())await mutate(signal=>recordGiftSale(shopId,selected.id,kind,{...payload,requestKey:request.current!.key},signal),row=>{setSelected(row);setAction(null);request.current=null;setNotice('服务器已确认交易记录。');setReload(value=>value+1);});
          }}>
            <Form.Item name="method" label="实际方式" rules={[{required:true}]}><Select options={Object.entries(methods).map(([value,label])=>({value,label}))} /></Form.Item><Form.Item name="reference" label="参考编号（可选）" rules={[{max:100}]}><Input maxLength={100} /></Form.Item><Form.Item name="reason" label="顾客可见说明" rules={[{required:true,whitespace:true,max:500}]}><Input.TextArea rows={3} maxLength={500} /></Form.Item><Form.Item name="ack" valuePropName="checked" rules={[{validator:(_,value)=>value===true?Promise.resolve():Promise.reject(new Error('请确认付款已实际发生。'))}]}><Checkbox>已核对订单与顾客，且全额收款或退款已实际发生。</Checkbox></Form.Item><Space wrap><Button type="primary" htmlType="submit" loading={busy}>核对并登记</Button><Button disabled={busy} onClick={()=>setAction(null)}>放弃本次操作</Button></Space>
          </Form>
        </Card>}
      </>}</div>
    </Modal>
  </div>;
}
