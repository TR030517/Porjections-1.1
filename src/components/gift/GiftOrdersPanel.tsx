import { useEffect, useRef, useState } from "react";
import { getGiftOrder, getGiftSalesPolicy, listGiftOrders, newGiftRequestKey, recordGiftSale, setGiftSalesPolicy, type GiftOrder, type GiftOrderStatus, type GiftPage, type GiftSaleMethod, type GiftSalesPolicy } from "../../api/giftCards";
import { useConfirmation } from "../Confirmation";
import { useAuthStore } from "../../stores/authStore";
import { giftTimestamp } from "../../utils/giftTimestamp";

const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm";
const button = "rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm disabled:opacity-50";
const primary = "rounded-lg bg-[#287c7c] px-4 py-2.5 text-sm text-white disabled:opacity-50";
const statuses: Record<GiftOrderStatus,string> = { PENDING:"待到店付款", PAID:"已登记收款", CANCELLED:"已取消", REFUNDED:"已登记退款" };
const methods: Record<GiftSaleMethod,string> = { CASH:"现金", EXTERNAL_CARD:"店外已完成刷卡", OTHER:"其他实际方式" };
function money(value:number,currency:string) { return Number.isSafeInteger(value) && /^[a-z]{3}$/i.test(currency) ? `${currency.toUpperCase()} ${(value/100).toFixed(2)}` : "金额未提供"; }
const message = (error:unknown) => error instanceof Error ? error.message : "请求未完成，请重试。";

export default function GiftOrdersPanel({shopId,onBusyChange}:{shopId:string;onBusyChange:(value:boolean)=>void}) {
  const {user} = useAuthStore();
  const identity = useRef(user?.id), alive = useRef(true), locked = useRef(false), requests = useRef(new Set<AbortController>());
  const activeIdentity=useRef(user?.id);activeIdentity.current=user?.id;
  const [policy,setPolicy] = useState<GiftSalesPolicy|null>(null), [result,setResult] = useState<GiftPage<GiftOrder>|null>(null);
  const [loading,setLoading] = useState(true), [error,setError] = useState(""), [notice,setNotice] = useState(""), [busy,setBusy] = useState(false);
  const [page,setPage] = useState(1), [reload,setReload] = useState(0), [status,setStatus] = useState<GiftOrderStatus|"">(""), [customer,setCustomer] = useState("");
  const [filters,setFilters] = useState<{status:GiftOrderStatus|"";userId:string}>({status:"",userId:""});
  const [selected,setSelected] = useState<GiftOrder|null>(null), [detailLoading,setDetailLoading] = useState(false), [detailError,setDetailError] = useState("");
  const [action,setAction] = useState<"receipts"|"refunds"|null>(null), [method,setMethod] = useState<GiftSaleMethod>("CASH"), [reference,setReference] = useState(""), [reason,setReason] = useState(""), [ack,setAck] = useState(false);
  const request = useRef<{fingerprint:string;key:string}|null>(null), detailVersion=useRef(0), dialog=useRef<HTMLDialogElement>(null);
  const confirm = useConfirmation();
  const current = () => alive.current && identity.current === activeIdentity.current;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;requests.current.forEach(item=>item.abort());onBusyChange(false);};},[onBusyChange]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setResult(null);setPolicy(null);setError("");
    Promise.all([listGiftOrders(shopId,{page,pageSize:20,...filters},controller.signal),getGiftSalesPolicy(shopId,controller.signal)])
      .then(([orders,policy])=>{if(!controller.signal.aborted){if(!orders.items.length&&page>Math.max(1,orders.totalPages)){setPage(Math.max(1,orders.totalPages));return;}setResult(orders);setPolicy(policy);}})
      .catch(error=>{if(!controller.signal.aborted)setError(message(error));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[shopId,page,filters,reload]);
  useEffect(()=>{if(!selected)return;const element=dialog.current;const previous=document.activeElement as HTMLElement|null;element?.showModal();return()=>{element?.close();previous?.focus();};},[selected?.id]);
  async function loadDetail(id:string) { const version=++detailVersion.current, controller=new AbortController();requests.current.add(controller);setDetailLoading(true);setDetailError("");
    try {const row=await getGiftOrder(shopId,id,controller.signal);if(current()&&!controller.signal.aborted&&version===detailVersion.current)setSelected(row);}
    catch(error){if(current()&&!controller.signal.aborted&&version===detailVersion.current)setDetailError(message(error));}
    finally{requests.current.delete(controller);if(current()&&version===detailVersion.current)setDetailLoading(false);}
  }
  function close() {if(locked.current)return;++detailVersion.current;setSelected(null);setAction(null);setDetailError("");setDetailLoading(false);}
  async function mutate<T>(run:(signal:AbortSignal)=>Promise<T>,done:(value:T)=>void) {
    if(locked.current||!current())return;locked.current=true;setBusy(true);onBusyChange(true);setError("");setDetailError("");setNotice("");const controller=new AbortController();requests.current.add(controller);
    try{const value=await run(controller.signal);if(current()&&!controller.signal.aborted)done(value);}
    catch(error){if(current()&&!controller.signal.aborted){setError(message(error));setDetailError(message(error)+" 原样重试会使用同一请求；更改内容前请重载核对凭证。");}}
    finally{requests.current.delete(controller);locked.current=false;if(current()){setBusy(false);onBusyChange(false);}}
  }
  const changeBody=()=>{request.current=null;};
  return <div className="space-y-4">
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-900">本店礼品到店付政策</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">默认关闭。开启后顾客可创建本店到店付订单；只有登记已经实际完成的全额收款，系统才发放购买权益。线上支付仍未开放。</p></div>
      <button type="button" className={button} disabled={!policy||busy||loading} onClick={async()=>{if(!policy)return;const enabled=!policy.payAtStoreEnabled;if(!await confirm({title:enabled?"开启本店到店付销售？":"关闭本店新销售？",message:enabled?"门店需自行实际收款后再登记，不能把登记当作发起扣款。":"关闭只阻止新订单，不撤销现有订单或已发权益。",confirmLabel:enabled?"开启到店付":"关闭新销售",tone:"primary"}))return;await mutate(signal=>setGiftSalesPolicy(shopId,enabled,signal),value=>{setPolicy(value);setNotice("销售政策已由服务器保存。");});}}>{policy?policy.payAtStoreEnabled?"已开启 · 关闭新销售":"已关闭 · 开启到店付":"正在读取政策"}</button></div>
    </section>
    {notice&&<p role="status" className="rounded-xl bg-teal-50 p-4 text-sm text-teal-800">{notice}</p>}
    {error&&<div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error} <button className="underline" disabled={busy} onClick={()=>setReload(value=>value+1)}>重新加载</button></div>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <form className="flex flex-wrap items-end gap-3 p-5" onSubmit={event=>{event.preventDefault();setPage(1);setFilters({status,userId:customer.trim()});}}><fieldset disabled={busy} className="contents">
        <label className="min-w-44 text-sm">订单状态<select aria-label="礼品订单状态" className={input+" mt-2"} value={status} onChange={event=>setStatus(event.target.value as GiftOrderStatus|"")}><option value="">全部状态</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className="min-w-44 text-sm">顾客 ID<input className={input+" mt-2"} value={customer} pattern="[1-9][0-9]*" onChange={event=>setCustomer(event.target.value)} placeholder="精确账号 ID" /></label><button className={primary} type="submit">查询</button><button type="button" className={button} onClick={()=>{setStatus("");setCustomer("");setFilters({status:"",userId:""});setPage(1);}}>重置</button><button type="button" className={button} onClick={()=>setReload(value=>value+1)}>刷新</button>
      </fieldset></form>
      <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{["订单 / 产品","顾客","原价","已收 / 已退","状态","创建时间（门店）","操作"].map(label=><th key={label} className="px-5 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
        {result?.items.map(row=><tr key={row.id}><td className="px-5 py-4"><p>{row.productTitleSnapshot||"历史产品快照不完整"}</p><p className="mt-1 break-all text-xs text-slate-500">{row.orderNo}</p></td><td className="px-5 py-4">{row.userId}</td><td className="whitespace-nowrap px-5 py-4">{money(row.amountCents,row.currency)}</td><td className="whitespace-nowrap px-5 py-4">{money(row.paidCents,row.currency)}<br/><span className="text-slate-500">退 {money(row.refundedCents,row.currency)}</span></td><td className="px-5 py-4">{statuses[row.status]}</td><td className="px-5 py-4">{giftTimestamp(row.createdAt,row.timezone)}</td><td className="px-5 py-4"><button disabled={busy} type="button" className={button} onClick={()=>{setSelected(row);setAction(null);setDetailError("");void loadDetail(row.id);}}>查看 / 办理</button></td></tr>)}
        {(!result||!result.items.length)&&<tr><td colSpan={7} className="p-10 text-center text-slate-500">{loading?"正在读取礼品订单…":error?"列表暂不可用":"暂无符合条件的礼品订单"}</td></tr>}
      </tbody></table></div><div className="flex items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm"><span>共 {result?.total??0} 条 · 第 {page}/{Math.max(1,result?.totalPages??0)} 页</span><div className="flex gap-2"><button className={button} disabled={busy||loading||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</button><button className={button} disabled={busy||loading||page>=(result?.totalPages??0)} onClick={()=>setPage(value=>value+1)}>下一页</button></div></div>
    </section>
    {selected&&<dialog ref={dialog} aria-labelledby="gift-order-detail-title" onCancel={event=>{event.preventDefault();close();}} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 p-0 backdrop:bg-slate-900/40"><div className="space-y-5 p-5 sm:p-7">
      <header className="flex items-start justify-between gap-4"><div><h2 id="gift-order-detail-title" className="text-xl font-semibold">礼品订单详情</h2><p className="mt-1 break-all text-sm text-slate-500">{selected.orderNo}</p></div><button type="button" className={button} disabled={busy} onClick={close}>关闭</button></header>
      {detailError&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{detailError}</p>}
      {detailLoading?<p role="status">正在核对最新订单…</p>:<><div className="grid gap-4 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div>产品：{selected.productTitleSnapshot||"未提供"}<p className="mt-2">顾客 ID：{selected.userId}</p><p className="mt-2">状态：{statuses[selected.status]}</p><p className="mt-2">{selected.useTimesSnapshot??"—"} 次 · 发放后 {selected.expireDaysSnapshot??"—"} 天</p></div><div>原价：{money(selected.amountCents,selected.currency)}<p className="mt-2">已收：{money(selected.paidCents,selected.currency)}</p><p className="mt-2">已退：{money(selected.refundedCents,selected.currency)}</p><p className="mt-2 break-all">权益 ID：{selected.entitlementId||"尚未发放"}</p></div></div>
      {selected.paymentMethod==="LEGACY"&&<p className="text-sm text-amber-800">历史订单不可直接登记收款。请顾客在允许取消时取消后重新下单。</p>}
      {([['收款记录',selected.receipts],['退款记录',selected.refunds]] as const).map(([title,rows])=><section key={title}><h3 className="font-medium">{title}</h3>{!(rows??[]).length?<p className="mt-2 text-sm text-slate-500">暂无记录</p>:(rows??[]).map(row=><div key={row.id} className="mt-3 space-y-1 rounded-xl border border-slate-200 p-4 text-sm"><p>{money(row.amountCents,selected.currency)} · {methods[row.method]??row.method}</p><p className="text-slate-500">{giftTimestamp(row.createdAt,selected.timezone)} · 经办 ID {row.operatorId}</p>{row.reference&&<p className="break-all">参考号：{row.reference}</p>}<p className="whitespace-pre-wrap break-words">顾客可见说明：{row.reason}</p></div>)}</section>)}
      {!action?<div className="flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={()=>void loadDetail(selected.id)}>核对最新详情</button>{selected.allowedActions.recordReceipt&&<button className={primary} disabled={busy} onClick={()=>{setAction("receipts");setMethod("CASH");setReference("");setReason("");setAck(false);request.current=null;}}>登记已完成的全额收款</button>}{selected.allowedActions.recordRefund&&<button className={button} disabled={busy} onClick={()=>{setAction("refunds");setMethod("CASH");setReference("");setReason("");setAck(false);request.current=null;}}>登记已完成的全额退款</button>}</div>:<form className="space-y-4 rounded-xl border border-teal-200 bg-teal-50/40 p-4" onSubmit={async event=>{event.preventDefault();if(!ack||!reason.trim()||!action)return;const kind=action,payload={amountCents:selected.amountCents,method,reference:reference.trim()||undefined,reason:reason.trim()},fingerprint=JSON.stringify({shopId,id:selected.id,kind,...payload});if(!request.current||request.current.fingerprint!==fingerprint)request.current={fingerprint,key:newGiftRequestKey()};if(!await confirm({title:kind==="receipts"?"确认款项已实际收到？":"确认退款已在系统外实际完成？",message:`${money(payload.amountCents,selected.currency)}。${kind==="receipts"?"登记成功会一次发放购买权益。":"仅限完全未使用的购买权益，登记成功将作废权益；本操作不会发起渠道退款。"}`,confirmLabel:"确认登记",tone:kind==="refunds"?"danger":"primary"}))return;await mutate(signal=>recordGiftSale(shopId,selected.id,kind,{...payload,requestKey:request.current!.key},signal),row=>{setSelected(row);setAction(null);request.current=null;setNotice("服务器已确认登记结果。");setReload(value=>value+1);});}}>
        <h3 className="font-semibold">{action==="receipts"?"登记实际收款":"登记实际退款"} · {money(selected.amountCents,selected.currency)}</h3><p className="text-sm leading-6 text-slate-600">仅支持一次全额。此操作记录系统外已实际发生的款项，不会扣卡或发起退款。办理说明和参考号会向顾客展示，请勿填写卡号、联系方式等隐私。</p><fieldset disabled={busy} className="space-y-4"><label className="block text-sm">实际方式<select className={input+" mt-2"} value={method} onChange={event=>{setMethod(event.target.value as GiftSaleMethod);changeBody();}}>{Object.entries(methods).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="block text-sm">参考号（可选，最多 100 字）<input className={input+" mt-2"} maxLength={100} value={reference} onChange={event=>{setReference(event.target.value);changeBody();}} /></label><label className="block text-sm">顾客可见办理说明<textarea required maxLength={500} rows={3} className={input+" mt-2"} value={reason} onChange={event=>{setReason(event.target.value);changeBody();}} /></label><label className="flex gap-3 text-sm leading-6"><input type="checkbox" required checked={ack} onChange={event=>setAck(event.target.checked)} />我确认上述全额款项已实际{action==="receipts"?"收到":"退还"}，并核对了订单与顾客。</label><div className="flex flex-wrap gap-3"><button className={primary} type="submit" disabled={!reason.trim()||!ack}>确认并登记</button><button className={button} type="button" onClick={()=>setAction(null)}>放弃办理</button></div></fieldset>
      </form>}</>}
    </div></dialog>}
  </div>;
}
