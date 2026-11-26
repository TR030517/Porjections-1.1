import React, { useEffect, useState } from 'react';
import { ArrowUpRight, ClipboardCheck, RefreshCw, Store } from 'lucide-react';
import { apiRequest } from '../api/session';
import { ResourceQuery } from '../api/resources';
import { ViewId } from '../types';
import { useAuthStore } from '../stores/authStore';
import { canAccessView } from '../permission';
import { ADMIN_ALL_STORES_SCOPE } from '../utils/adminLocation';

interface Summary {
  counts: Record<string, number>;
  workQueues: { pendingShops: number | null; pendingBookings: number; confirmedBookings: number; confirmedPaidBookings: number; refundingBookings: number };
  storeStatuses: { published: number; suspended: number };
  paymentProvider: string;
}
const metrics: { key: string; label: string; view: ViewId; query?: ResourceQuery }[] = [
  { key: 'stores', label: '门店总数', view: 'store-list' },
  { key: 'users', label: '顾客账户', view: 'user-list' },
  { key: 'serviceOrders', label: '预约总数', view: 'service-orders', query: { shopScope: ADMIN_ALL_STORES_SCOPE } },
  { key: 'coupons', label: '优惠券配置', view: 'coupon-management' },
  { key: 'regions', label: '地区', view: 'area-management' },
  { key: 'giftCards', label: '礼品卡产品配置', view: 'gift-card-management' },
];
export default function Dashboard({ onNavigate }: { onNavigate: (view: ViewId, query?: ResourceQuery) => void }) {
  const { currentRole } = useAuthStore();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    apiRequest<Summary>('/studio/summary', { signal: controller.signal }).then(result => {
      if (!result?.counts || !result.workQueues || !result.storeStatuses) throw new Error('统计数据格式无效，请刷新后重试。');
      if (!controller.signal.aborted) setSummary(result);
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '统计加载失败'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  const count = (value: number | null | undefined) => !loading && !error && typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';
  const queues: { key: keyof Summary['workQueues']; label: string; description: string; view: ViewId; query: ResourceQuery }[] = [
    { key: 'pendingShops', label: '门店待审核', description: '核对发布资料，记录审核决定。', view: 'store-application', query: { status: 'PENDING', shopScope: ADMIN_ALL_STORES_SCOPE } },
    { key: 'pendingBookings', label: '待确认预约', description: '预约状态为待确认，付款状态需分别核对。', view: 'service-orders', query: { status: 'PENDING', shopScope: ADMIN_ALL_STORES_SCOPE } },
    { key: 'confirmedBookings', label: '待到店服务', description: '已确认的预约，按约履约；款项与顾客线下处理，历史收款记录分别保留。', view: 'service-orders', query: { status: 'CONFIRMED', shopScope: ADMIN_ALL_STORES_SCOPE } },
    { key: 'refundingBookings', label: '退款处理中', description: '查看退款中的预约及实际已退金额。', view: 'post-sales', query: { status: 'REFUNDING', shopScope: ADMIN_ALL_STORES_SCOPE } },
  ];
  return <div className="app-page">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="page-heading">运营概览</h1><p className="page-description">当前账户有权管理的全部门店与业务记录，待办可直接进入对应队列。</p></div><button type="button" disabled={loading} onClick={() => setReload(value => value + 1)} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 disabled:opacity-50"><RefreshCw className="h-4 w-4" />刷新统计</button></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {loading && <p role="status" className="text-sm text-slate-500">正在加载统计…</p>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
      <section className="surface-panel overflow-hidden" aria-label="运营待办">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5"><ClipboardCheck className="h-5 w-5 text-teal-700" /><h2 className="font-semibold text-slate-800">运营待办</h2></div>
        <div className="divide-y divide-slate-100">{queues.filter(queue => canAccessView(currentRole, queue.view)).map(queue => <button key={queue.key} type="button" disabled={loading || Boolean(error)} onClick={() => onNavigate(queue.view, queue.query)} className="flex w-full items-center gap-4 px-6 py-5 text-left hover:bg-slate-50 disabled:opacity-60">
          <div className="min-w-0 flex-1"><h3 className="font-medium text-slate-800">{queue.label}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{queue.description}</p></div><span className="text-2xl font-semibold tabular-nums text-slate-900">{count(summary?.workQueues[queue.key])}</span><ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" />
        </button>)}</div>
      </section>
      <section className="surface-panel flex flex-col p-6" aria-label="门店发布状态">
        <div className="flex items-center gap-3"><Store className="h-5 w-5 text-teal-700" /><h2 className="font-semibold text-slate-800">门店发布状态</h2></div>
        <div className="mt-6 grid grid-cols-2 gap-4"><div><p className="text-sm text-slate-500">已发布</p><p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{count(summary?.storeStatuses.published)}</p></div><div><p className="text-sm text-slate-500">已停用</p><p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{count(summary?.storeStatuses.suspended)}</p></div></div>
        <p className="mt-5 text-xs leading-6 text-slate-500">待审核、已拒绝或已停用的门店不会出现在顾客公开列表。发布状态不代表此刻正在营业。</p>
        <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => onNavigate('store-list', { status: 'APPROVED' })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-teal-700">查看已发布门店</button>{canAccessView(currentRole, 'audit-logs') && <button type="button" onClick={() => onNavigate('audit-logs')} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">查看操作记录</button>}</div>
        {!loading && !error && summary?.paymentProvider === 'disabled' && <p className="mt-auto pt-6 text-xs leading-5 text-slate-500">在线收款未启用。订单金额、付款状态与退款金额仍分别显示。</p>}
      </section>
    </div>
    <section aria-label="数据总览" className="space-y-4"><h2 className="text-base font-semibold text-slate-800">数据总览</h2><div className="grid grid-cols-2 gap-4 lg:grid-cols-3">{metrics.map(metric => <div key={metric.key} className="surface-panel p-5"><p className="text-sm text-slate-500">{metric.label}</p><div className="mt-3 flex items-end justify-between gap-3"><p className="text-2xl font-semibold tabular-nums text-slate-900">{count(summary?.counts[metric.key])}</p>{canAccessView(currentRole, metric.view) && <button type="button" aria-label={'查看' + metric.label} onClick={() => onNavigate(metric.view, metric.query)} className="rounded-md p-1 text-slate-400 hover:text-teal-700"><ArrowUpRight className="h-4 w-4" /></button>}</div></div>)}</div><p className="text-xs leading-5 text-slate-500">记录数按当前权限范围统计；优惠券与礼品卡产品配置数不代表已售数量或收入。</p></section>
  </div>;
}
