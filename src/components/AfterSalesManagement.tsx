import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LifeBuoy, RefreshCw, Search } from 'lucide-react';
import { afterSalesApi, AfterSalesCase, BusinessPage, CaseEvent, caseActions, caseStatuses, caseTypes } from '../api/afterSales';
import { ApiError } from '../api/session';
import { readinessId } from '../api/shopReadiness';
import { useShopStore } from '../stores/shop';
import { useConfirmation } from './Confirmation';
import OperationalPage from './OperationalPage';
import { operations } from '../config/operations';
import type { ResourceQuery } from '../api/resources';

const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm disabled:opacity-50';
const button = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-40';
const date = (value: string) => new Date(value).toLocaleString('zh-CN');
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
const refundLabels: Record<string, string> = { NONE: '尚未执行', IN_FLIGHT: '请求处理中', PENDING: '渠道处理中', RETRYABLE: '可同步 / 重试', SUCCEEDED: '退款成功', FAILED: '退款失败' };
function refundStatus(item: AfterSalesCase) {
  if (item.refundMode !== 'PAY_AT_STORE') return refundLabels[item.refundState] ?? item.refundState;
  if (item.offlineRefundRecordedCents != null) return '线下退款已登记';
  if (item.booking.paymentStatus === 'REFUNDED' || item.booking.refundedCents > 0) return '付款与退款记录待核实';
  return '线下退款未登记';
}

const transitionActions = ['ACCEPT', 'WAIT_FOR_CUSTOMER', 'RESUME', 'REJECT', 'RESOLVE'];
const transitionsRequiringReason = new Set(['WAIT_FOR_CUSTOMER', 'REJECT', 'RESOLVE']);
const eventLabels = new Map([
  ['CREATED', '工单已创建'],
  ['CLAIMED', '工单已接手'],
  ['CLAIM', '工单已接手'],
  ['NOTE', '已添加备注'],
  ['ACCEPT', '已受理申请'],
  ['WAIT_FOR_CUSTOMER', '已请求顾客补充'],
  ['RESUME', '已继续处理'],
  ['REJECT', '已驳回申请'],
  ['RESOLVE', '工单已解决'],
  ['WITHDRAW', '申请已撤回'],
  ['REFUND_REQUESTED', '已提交退款请求'],
  ['REFUND_PENDING', '退款处理中'],
  ['REFUND_RETRYABLE', '退款待同步或重试'],
  ['REFUND_SUCCEEDED', '退款成功'],
  ['REFUND_FAILED', '退款失败'],
  ['REFUND_RECONCILIATION_REQUIRED', '退款结果待核实'],
  ['REFUND_CHECKED', '已核对退款记录'],
]);

export function CaseEventEntry({ event }: { event: CaseEvent }) {
  const label = eventLabels.get(event.kind) ?? (event.kind.startsWith('REFUND_') ? '退款状态已更新' : '工单记录已更新');
  const isInternal = event.visibility === 'INTERNAL';
  return (
    <li className="border-l-2 border-teal-100 pl-4">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
        <time>{date(event.createdAt)}</time>
        <span>{event.actorRole === 'CUSTOMER' ? '顾客' : event.actorRole === 'ADMIN' ? '平台' : '门店'}{event.actorId ? ' #' + event.actorId : ''}</span>
        <span className={isInternal ? 'text-amber-700' : 'text-teal-700'}>{isInternal ? '内部备注' : '顾客可见'}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-700">{label}</p>
      {event.toStatus && event.toStatus !== event.fromStatus && <p className="mt-2 text-xs font-medium text-teal-700">{caseStatuses[event.toStatus] ?? event.toStatus}</p>}
      {event.content && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{event.content}</p>}
    </li>
  );
}

export default function AfterSalesManagement({ initialQuery, onClearOrderFilter }: { initialQuery?: ResourceQuery; onClearOrderFilter?: () => void }) {
  const { currentStoreId } = useShopStore();
  const [tab, setTab] = useState<'cases' | 'records'>('cases');
  const [page, setPage] = useState(1), [status, setStatus] = useState(''), [type, setType] = useState('');
  const [orderFilter, setOrderFilter] = useState(() => {
    const shopId = String(initialQuery?.shopId ?? '');
    const bookingId = String(initialQuery?.bookingId ?? '');
    return readinessId(shopId) && readinessId(bookingId) ? { shopId, bookingId } : undefined;
  });
  const bookingId = orderFilter?.shopId === String(currentStoreId) ? orderFilter.bookingId : undefined;
  const [bookingNo, setBookingNo] = useState('');
  const [bookingDraft, setBookingDraft] = useState('');
  const [bookingSearchError, setBookingSearchError] = useState('');
  const [data, setData] = useState<BusinessPage<AfterSalesCase> | null>(null), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null), [reload, setReload] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(''); setData(null);
    afterSalesApi.list({ page, pageSize: 20, shopId: currentStoreId, bookingId, bookingNo, status, type }, abort.signal)
      .then(value => { if (!abort.signal.aborted) setData(value); }).catch(e => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [page, status, type, currentStoreId, bookingId, bookingNo, reload]);
  function searchByBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const number = bookingDraft.trim();
    if (number.length > 30 || /[\u0000-\u001f\u007f]/.test(number)) {
      setBookingSearchError('请输入有效的预约编号，最多 30 个字符。');
      return;
    }
    setBookingDraft(number);
    setBookingSearchError('');
    if (orderFilter) onClearOrderFilter?.();
    setOrderFilter(undefined);
    setBookingNo(number);
    setPage(1);
    setReload(value => value + 1);
  }
  function resetFilters() {
    setBookingDraft('');
    setBookingSearchError('');
    if (orderFilter) onClearOrderFilter?.();
    setOrderFilter(undefined);
    setBookingNo('');
    setStatus('');
    setType('');
    setPage(1);
    setReload(value => value + 1);
  }
  if (selected) return <CaseDetail key={selected} id={selected} onBack={() => { setSelected(null); setReload(x => x + 1); }} />;
  return <div className="space-y-5">
    <div><h1 className="page-heading flex items-center gap-2"><LifeBuoy className="h-6 w-6 text-teal-700" />售后服务</h1><p className="page-description">跟进顾客提交的工单。工单进度与实际退款分别记录。</p></div>
    <div className="flex gap-2 border-b border-slate-200 pb-3">{[['cases', '售后工单'], ['records', '退款订单记录']].map(([id, label]) => <button key={id} type="button" className={tab === id ? 'rounded-lg bg-teal-700 px-4 py-2 text-sm text-white' : button} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</div>
    {tab === 'records' ? <OperationalPage config={operations['post-sales']} initialQuery={initialQuery} /> : <section className="surface-panel overflow-hidden">
      <form onSubmit={searchByBooking} className="border-b border-slate-100 p-4">
        <p className="mb-3 text-sm leading-6 text-slate-600">请顾客登录后在对应预约中提交售后申请。电话或到店反馈若无法通过顾客账号提交，请先线下留档。</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-[1_1_14rem] text-xs text-slate-500">
            <span>预约编号</span>
            <input
              name="bookingNo"
              className={input + ' mt-1'}
              placeholder="输入完整预约编号"
              value={bookingDraft}
              aria-invalid={bookingSearchError ? true : undefined}
              aria-describedby={bookingSearchError ? 'after-sales-booking-search-error' : undefined}
              onChange={event => { setBookingDraft(event.target.value); setBookingSearchError(''); }}
            />
          </label>
          <label className="text-xs text-slate-500">
            工单状态
            <select className={input + ' mt-1'} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
              <option value="">全部状态</option>
              {Object.entries(caseStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            问题类型
            <select className={input + ' mt-1'} value={type} onChange={e => { setType(e.target.value); setPage(1); }}>
              <option value="">全部类型</option>
              {Object.entries(caseTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white">
            <Search className="mr-1 inline h-4 w-4" />查询
          </button>
          <button type="button" className={button} onClick={resetFilters}>重置</button>
          <button type="button" disabled={loading} className={button} onClick={() => setReload(x => x + 1)}>
            <RefreshCw className="mr-1 inline h-4 w-4" />刷新
          </button>
        </div>
        {bookingId && <p className="mt-2 text-xs font-medium text-teal-700">当前仅显示来源订单的售后工单。重置可查看这家门店的全部工单。</p>}
        {bookingSearchError && <p id="after-sales-booking-search-error" role="alert" className="mt-2 text-xs text-red-700">{bookingSearchError}</p>}
      </form>
      {error && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p role="status" className="p-8 text-sm text-slate-500">正在读取工单…</p> : error ? null : !data?.items.length ? <div className="p-10 text-center text-sm text-slate-500">{bookingId && !status && !type ? '该预约暂无售后工单。' : '当前范围内暂无售后工单。'}</div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['工单 / 订单', '门店与服务', '类型', '进度', '申请金额', '更新时间', '操作'].map(h => <th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.items.map(item => <tr key={item.id}><td className="px-4 py-4"><p className="font-medium text-slate-800">#{item.id}</p><p className="mt-1 text-xs text-slate-500">{item.booking.bookingNo}</p></td><td className="px-4 py-4"><p>{item.booking.shopName}</p><p className="mt-1 text-xs text-slate-500">{item.booking.serviceName}</p></td><td className="whitespace-nowrap px-4 py-4">{caseTypes[item.type] ?? item.type}</td><td className="px-4 py-4"><span className="whitespace-nowrap rounded-md bg-teal-50 px-2 py-1 text-xs text-teal-800">{caseStatuses[item.status] ?? item.status}</span>{item.type === 'REFUND' && <p className="mt-2 text-xs text-slate-500">{refundStatus(item)}</p>}</td><td className="whitespace-nowrap px-4 py-4">{item.requestedAmountCents == null ? '—' : money(item.requestedAmountCents, item.currency)}</td><td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{date(item.updatedAt)}</td><td className="px-4 py-4"><button className="whitespace-nowrap font-medium text-teal-700" onClick={() => setSelected(item.id)}>查看与处理</button></td></tr>)}</tbody></table></div>}
      {data && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">共 {data.total} 条 · 第 {page} 页</span><div className="flex gap-2"><button className={button} disabled={loading || page <= 1} onClick={() => setPage(x => x - 1)}>上一页</button><button className={button} disabled={loading || page * data.pageSize >= data.total} onClick={() => setPage(x => x + 1)}>下一页</button></div></div>}
    </section>}
  </div>;
}

function CaseDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const confirm = useConfirmation();
  const [item, setItem] = useState<AfterSalesCase | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [content, setContent] = useState(''), [visibility, setVisibility] = useState('INTERNAL');
  const [action, setAction] = useState(''), [reason, setReason] = useState('');
  const [events, setEvents] = useState<CaseEvent[]>([]), [eventPage, setEventPage] = useState(1), [eventTotal, setEventTotal] = useState(0);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    afterSalesApi.detail(id, abort.signal).then(value => { if (!abort.signal.aborted) setItem(value); }).catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [id, reload]);
  useEffect(() => {
    const abort = new AbortController();
    afterSalesApi.events(id, eventPage, abort.signal).then(value => { if (!abort.signal.aborted) { setEvents(value.items); setEventTotal(value.total); } }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [id, reload, eventPage]);
  const reasonRequired = transitionsRequiringReason.has(action);
  const actions = item?.allowedActions ?? [];
  const decisions = transitionActions.filter(value => actions.includes(value));
  async function back() {
    const dirty = Boolean(content.trim() || reason.trim());
    if (!busy && (!dirty || await confirm({ title: '离开工单', message: '当前文字尚未提交，离开后将清空。', confirmLabel: '离开' }))) onBack();
  }
  async function write(kind: 'notes' | 'transition' | 'claim' | 'refund' | 'reconcile') {
    if (!item || lock.current) return;
    if (kind === 'notes' && !content.trim()) { setError('请填写沟通内容。'); return; }
    const publicReason = reason.trim();
    if (kind === 'transition' && (!decisions.includes(action) || (reasonRequired && !publicReason))) {
      setError('请选择处理决定并填写所需的公开说明。');
      return;
    }
    if (kind === 'refund' && !await confirm({ title: '执行或同步退款', message: `申请退款 ${money(item.requestedAmountCents ?? 0, item.currency)}。系统会向订单原收款渠道提交或同步同一笔退款；以渠道实际结果为准。`, confirmLabel: '继续', tone: 'danger' })) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let payload: Record<string, unknown> = {};
      if (kind === 'notes') payload = { content: content.trim(), visibility };
      if (kind === 'transition') payload = { action, ...(publicReason && { reason: publicReason }) };
      const result = await afterSalesApi.write(item, kind, payload);
      if (!mounted.current) return;
      setItem(result);
      if (kind === 'notes' || !result.allowedActions.includes('NOTE')) setContent('');
      if (kind === 'transition') { setAction(''); setReason(''); }
      setEventPage(1); setReload(x => x + 1); setNotice(kind === 'reconcile' ? '原退款记录已重新核实，未确认状态仍保持待处理。' : kind === 'refund' ? '退款请求已处理，请查看渠道状态。' : '工单已更新。');
    } catch (e) { if (mounted.current) { setError(e instanceof Error ? e.message : '操作失败'); if (e instanceof ApiError && e.status === 409) setReload(x => x + 1); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const offlineRefund = item?.type === 'REFUND' && item.refundMode === 'PAY_AT_STORE';
  const activeCase = item && !['RESOLVED', 'REJECTED', 'WITHDRAWN'].includes(item.status);

  return <div className="space-y-5"><button disabled={busy} onClick={back} className="flex items-center gap-2 text-sm font-medium text-teal-700 disabled:opacity-40"><ArrowLeft className="h-4 w-4" />返回工单列表</button>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="rounded-xl bg-teal-50 p-4 text-sm text-teal-800">{notice}</p>}
    {loading && !item ? <p className="text-sm text-slate-500">正在加载详情…</p> : item && <>
      <section className="surface-panel p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-teal-700">售后工单 #{item.id}</p><h1 className="mt-2 text-xl font-semibold text-slate-900">{caseTypes[item.type]} · {caseStatuses[item.status]}</h1><p className="mt-2 text-sm text-slate-500">{item.booking.shopName} · {item.booking.serviceName} · {item.booking.bookingNo}</p></div><button className={button} disabled={busy || loading} onClick={() => setReload(x => x + 1)}>刷新状态</button></div><p className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{item.reason}</p><div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-3"><p>预约：{item.booking.localDate ?? '历史日期'} {item.booking.localStartTime ?? ''}<span className="mt-1 block text-xs text-slate-400">{item.booking.timezone ?? '时区未记录'}</span></p><p>实付：{money(item.booking.paidCents, item.booking.currency)}<span className="mt-1 block">已退：{money(item.booking.refundedCents, item.booking.currency)}</span></p><p>处理人：{item.assignedToId ? '#' + item.assignedToId : '待接手'}{item.type === 'REFUND' && <span className="mt-1 block">申请 {money(item.requestedAmountCents ?? 0, item.currency)} · {refundStatus(item)}</span>}</p></div></section>
      {offlineRefund && (item.offlineRefundRecordedCents != null || activeCase) && (
        <section className="surface-panel p-5 text-sm leading-6 text-slate-600">
          <h2 className="font-semibold text-slate-800">到店付款退款</h2>
          {item.offlineRefundRecordedCents != null ? (
            <p>实际登记金额 {money(item.offlineRefundRecordedCents, item.currency)}</p>
          ) : item.booking.paymentStatus === 'REFUNDED' || item.booking.refundedCents > 0 ? (
            <p>此预约的付款与退款记录需要核实。请与门店核对实际收退款凭证。</p>
          ) : (
            <p>请门店在实际退款后从预约详情登记退款。登记后可刷新工单核对金额。</p>
          )}
        </section>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)]"><section className="surface-panel p-5"><h2 className="font-semibold text-slate-800">处理记录</h2><ol className="mt-4 space-y-4">{events.map(event => <CaseEventEntry key={event.id} event={event} />)}</ol><div className="mt-5 flex items-center justify-between text-xs text-slate-500"><span>共 {eventTotal} 条 · 第 {eventPage} 页</span><div className="flex gap-2"><button className={button} disabled={eventPage <= 1} onClick={() => setEventPage(x => x - 1)}>上一页</button><button className={button} disabled={eventPage * 30 >= eventTotal} onClick={() => setEventPage(x => x + 1)}>下一页</button></div></div></section>
      <section className="surface-panel space-y-4 p-5"><h2 className="font-semibold text-slate-800">跟进与处理</h2>{actions.includes('CLAIM') && <button className={button} disabled={busy || loading} onClick={() => write('claim')}>接手工单</button>}{actions.includes('REFUND') && <button className="block w-full rounded-lg bg-teal-700 px-4 py-3 text-sm text-white disabled:opacity-40" disabled={busy || loading} onClick={() => write('refund')}>执行 / 同步原路退款</button>}{actions.includes('RECONCILE') && <div className="space-y-2"><button className={button + ' w-full'} disabled={busy || loading} onClick={() => write('reconcile')}>重新核实原退款记录</button><p className="text-xs leading-5 text-slate-500">只查询原渠道记录；结果未知时继续保留待处理状态，不另发新退款。</p></div>}{actions.includes('NOTE') ? <><textarea className={input + ' min-h-32'} maxLength={2000} value={content} disabled={busy} onChange={e => setContent(e.target.value)} placeholder="填写备注内容" aria-label="备注内容" /><div className="flex flex-wrap gap-2"><select className={input} disabled={busy} value={visibility} onChange={e => setVisibility(e.target.value)} aria-label="备注可见范围"><option value="INTERNAL">内部备注 · 顾客不可见</option><option value="PUBLIC">公开回复 · 顾客可见</option></select><button className={button} disabled={busy || loading || !content.trim()} onClick={() => write('notes')}>添加{visibility === 'INTERNAL' ? '内部备注' : '公开回复'}</button></div></> : <p className="text-sm leading-6 text-slate-500">{['RESOLVED', 'REJECTED', 'WITHDRAWN'].includes(item.status) ? '此工单已结束，处理记录保留。' : '接手后可跟进工单。'}</p>}
      {decisions.length > 0 && <div className="space-y-3 border-t border-slate-100 pt-4">
        <select className={input} value={decisions.includes(action) ? action : ''} disabled={busy} onChange={event => setAction(event.target.value)} aria-label="处理决定">
          <option value="">选择处理决定</option>
          {decisions.map(value => <option key={value} value={value}>{caseActions[value]}</option>)}
        </select>
        {decisions.includes(action) && <label className="block space-y-1 text-sm text-slate-600">
          <span>处理说明（顾客可见，{reasonRequired ? '必填' : '选填'}）</span>
          <textarea className={input + ' min-h-24'} maxLength={2000} required={reasonRequired} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
        </label>}
        {decisions.includes('RESOLVE') && item.type === 'REFUND' && item.refundState === 'SUCCEEDED' && <p className="text-xs leading-5 text-slate-500">{offlineRefund ? '已核对线下退款记录。' : '退款已成功。'}提交解决说明后可结束工单。</p>}
        <button type="button" className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm text-white disabled:opacity-40" disabled={busy || loading || !decisions.includes(action) || (reasonRequired && !reason.trim())} onClick={() => write('transition')}>
          {busy ? '正在提交…' : '提交处理决定'}
        </button>
      </div>}</section></div>
    </>}
  </div>;
}
