import React, { useState, useEffect } from 'react';
import { Search, Plus, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

import { listResourcePage, createResource, updateResource, deleteResource, ResourceId } from '../api/resources';

import { useAuthStore } from '../stores/authStore';
import { useShopStore } from '../stores/shop';
import { useConfirmation } from './Confirmation';

interface Coupon {
  id: ResourceId;
  type: 'general' | 'merchant';
  name: string;
  amount: number; // e.g., 10
  threshold: number; // e.g., 50
  description: string;
  startDate: string;
  endDate: string;
  status: '正常' | '关闭';
  updateDate: string;
  claimedCount?: number;
  totalQuantity?: number;
  perUserLimit?: number;
  configuredPerUserLimit?: number;
  // Merchant specific
  merchantShortLink?: string;
  merchantName?: string;
}

export default function CouponManagement() {
  const { isStoreManager } = useAuthStore();
  const { currentStoreId } = useShopStore();
  const confirm = useConfirmation();
  const [pageResult, setPageResult] = useState<{ key: string; items: Coupon[]; total: number } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [formError, setFormError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'general' | 'merchant'>(isStoreManager ? 'merchant' : 'general');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const scope = isStoreManager ? 'merchant' : activeTab;
  const shopId = scope === 'merchant' ? currentStoreId ?? undefined : undefined;
  const scopeKey = JSON.stringify([scope, shopId ?? null]);
  const [pageState, setPageState] = useState({ scopeKey, page: 1 });
  const page = pageState.scopeKey === scopeKey ? pageState.page : 1;
  const setPage = (nextPage: number) => setPageState({ scopeKey, page: nextPage });
  const queryKey = JSON.stringify([scopeKey, search, page, pageSize, reloadKey]);
  const currentResult = pageResult?.key === queryKey ? pageResult : null;
  const coupons = currentResult?.items ?? [];
  const total = currentResult?.total ?? 0;
  const requestError = loadError?.key === queryKey ? loadError.message : '';
  const loading = !currentResult && !requestError;
  const error = requestError || actionError;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const termsLocked = (editingCoupon?.claimedCount ?? 0) > 0;
  const historicalLimit = editingCoupon?.configuredPerUserLimit ?? editingCoupon?.perUserLimit ?? 1;

  // Form states
  const [formType, setFormType] = useState<'general' | 'merchant'>(isStoreManager ? 'merchant' : 'general');
  const [formName, setFormName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formThreshold, setFormThreshold] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formStatus, setFormStatus] = useState<'正常' | '关闭'>('正常');

  const [merchantShortLink, setMerchantShortLink] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setActionError('');
    listResourcePage<Coupon>('coupons', { scope, search, page, pageSize, shopId }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > lastPage) {
        setPageState({ scopeKey, page: lastPage });
        return;
      }
      setPageResult({ key: queryKey, items: result.items, total: result.total });
    }).catch((err) => {
      if (!controller.signal.aborted) setLoadError({ key: queryKey, message: err instanceof Error ? err.message : '加载优惠券失败' });
    });
    return () => controller.abort();
  }, [queryKey, scopeKey, scope, search, page, pageSize, shopId]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchText.trim());
    setPage(1);
    setReloadKey(key => key + 1);
  };

  const handleReset = () => {
    setSearchText('');
    setSearch('');
    setActiveTab(isStoreManager ? 'merchant' : 'general');
    setPage(1);
    setReloadKey(key => key + 1);
  };

  const handleOpenAdd = () => {
    setFormError('');
    setEditingCoupon(null);
    setFormType(scope);
    setFormName('');
    setFormAmount('');
    setFormThreshold('');
    setFormDescription('');
    setFormStartDate('');
    setFormEndDate('');
    setFormStatus('正常');
    setMerchantShortLink('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (coupon: Coupon) => {
    setFormError('');
    setEditingCoupon(coupon);
    setFormType(coupon.type);
    setFormName(coupon.name);
    setFormAmount(coupon.amount.toString());
    setFormThreshold(coupon.threshold ? coupon.threshold.toString() : '');
    setFormDescription(coupon.description);
    setFormStartDate(coupon.startDate);
    setFormEndDate(coupon.endDate);
    setFormStatus(coupon.status);

    setMerchantShortLink(coupon.merchantShortLink ?? '');
    setIsModalOpen(true);
  };

  const handleDelete = async (id: ResourceId) => {
    if (busy || !await confirm({ title: '停用优惠券', message: '优惠券将停止发放，历史领取记录保留。是否继续？', confirmLabel: '停用' })) return;
    setBusy(true);
    setActionError('');
    try {
      await deleteResource('coupons', id);
      setReloadKey(key => key + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '停用优惠券失败');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleStatus = async (id: ResourceId) => {
    const coupon = coupons.find(item => item.id === id);
    if (!coupon || busy) return;
    setBusy(true);
    setActionError('');
    try {
      await updateResource<Coupon>('coupons', id, { status: coupon.status === '正常' ? '关闭' : '正常' });
      setReloadKey(key => key + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '更新优惠券状态失败');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError('');
    const amount = Number(formAmount);
    const threshold = formThreshold.trim() === '' ? 0 : Number(formThreshold);
    if (!formName.trim()) {
      setFormError('请输入优惠券名称。');
      return;
    }
    if (!termsLocked && (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(threshold) || threshold < 0)) {
      setFormError('请输入券名、正数优惠金额和不小于 0 的使用门槛。');
      return;
    }
    if (!termsLocked && formType === 'merchant' && !merchantShortLink.trim()) {
      setFormError('请输入关联商家短链。');
      return;
    }
    if (!termsLocked && (!formStartDate || !formEndDate || formEndDate < formStartDate)) {
      setFormError('请选择有效期，结束日期不得早于开始日期。');
      return;
    }
    const payload = {
      name: formName.trim(),
      description: formDescription.trim(),
      status: formStatus,
      ...(!termsLocked ? {
        type: formType,
        amount,
        threshold,
        perUserLimit: 1,
        startDate: formStartDate,
        endDate: formEndDate,
        ...(formType === 'merchant' ? { merchantShortLink: merchantShortLink.trim() } : {}),
      } : {}),
    };
    setBusy(true);
    try {
      const saved = editingCoupon
        ? await updateResource<Coupon>('coupons', editingCoupon.id, payload)
        : await createResource<Coupon>('coupons', payload);
      setActiveTab(saved.type);
      if (!editingCoupon) {
        setSearchText('');
        setSearch('');
        setPage(1);
      }
      setReloadKey(key => key + 1);
      setIsModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存优惠券失败');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#48a1a1] focus:ring-2 focus:ring-[#48a1a1]/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';
  const labelClass = 'mb-2 block text-[13px] font-medium text-slate-600';

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">优惠券管理</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">管理优惠券，设置优惠金额、适用商家和有效期限。已领取记录保留在客户券包中。</p>
        </div>
        <button disabled={loading || busy || !!error} onClick={handleOpenAdd} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#48a1a1] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#3d8b8b]">
          <Plus className="h-4 w-4" />新增优惠券
        </button>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button type="button" disabled={loading || busy} onClick={() => setReloadKey(key => key + 1)} className="rounded-lg border border-red-200 px-3 py-2">重新加载</button></div>}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist" aria-label="优惠券类型">
        {(isStoreManager ? ['merchant'] as const : ['general', 'merchant'] as const).map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setPage(1); }} role="tab" aria-selected={scope === tab} className={cn('rounded-lg px-4 py-2.5 text-sm font-medium transition', scope === tab ? 'bg-[#eaf5f4] text-[#2e7d7d]' : 'text-slate-500 hover:bg-white hover:text-slate-800')}>
            {tab === 'general' ? '通用优惠券' : '商家优惠券'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200/80 bg-white p-5">
        <div className="min-w-0 max-w-xl flex-[1_1_280px]">
          <label htmlFor="coupon-search" className={labelClass}>搜索优惠券</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="coupon-search" type="search" maxLength={100} placeholder="输入优惠券名称" value={searchText} onChange={(e) => setSearchText(e.target.value)} className={cn(inputClass, 'pl-10')} />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-[#48a1a1] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3d8b8b]">查询</button>
        <button type="button" onClick={handleReset} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">重置</button>
        <p className="py-2.5 text-[13px] text-slate-500" aria-live="polite">{loading || requestError ? '等待查询结果' : `共 ${total} 张优惠券`}</p>
      </form>

      {busy && !isModalOpen && <p role="status" className="text-sm text-slate-500">正在更新优惠券…</p>}
      <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white">
        <div className="overflow-x-auto">
          <table className={cn('w-full text-left text-sm', scope === 'merchant' ? 'min-w-[1220px]' : 'min-w-[1050px]')} aria-busy={loading}>
            <thead className="border-b border-slate-100 bg-slate-50/70 text-[13px] text-slate-500">
              <tr>
                <th className="px-5 py-4 font-medium">ID</th>
                <th className="px-5 py-4 font-medium">优惠券名称</th>
                {scope === 'merchant' && <th className="px-5 py-4 font-medium">适用商家</th>}
                <th className="px-5 py-4 font-medium">优惠金额</th>
                <th className="px-5 py-4 font-medium">使用门槛</th>
                <th className="px-5 py-4 font-medium">有效时间</th>
                <th className="px-5 py-4 font-medium">状态</th>
                <th className="px-5 py-4 font-medium">更新日期</th>
                <th className="px-5 py-4 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[13px] text-slate-600">
              {loading ? (
                <tr><td colSpan={scope === 'merchant' ? 9 : 8} className="px-5 py-16 text-center text-sm text-slate-500">正在加载优惠券…</td></tr>
              ) : requestError ? (
                <tr><td colSpan={scope === 'merchant' ? 9 : 8} className="px-5 py-16 text-center text-sm text-slate-500">优惠券加载失败，请重试。</td></tr>
              ) : coupons.length === 0 ? (
                <tr><td colSpan={scope === 'merchant' ? 9 : 8} className="px-5 py-16 text-center text-sm text-slate-400">暂无匹配的优惠券，可调整搜索或新增优惠券。</td></tr>
              ) : coupons.map((row, idx) => (
                <motion.tr key={row.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx, 8) * 0.03 }} className="hover:bg-slate-50/60">
                  <td className="px-5 py-4 font-mono text-slate-400">{row.id}</td>
                  <td className="min-w-[220px] px-5 py-4"><p className="font-medium text-slate-800">{row.name}</p>{row.description && <p className="mt-1.5 max-w-xs text-xs leading-5 text-slate-500">{row.description}</p>}<p className="mt-1 text-xs text-slate-400">每人限领 1 张{(row.configuredPerUserLimit ?? row.perUserLimit ?? 1) > 1 ? `（历史配置 ${row.configuredPerUserLimit ?? row.perUserLimit}，当前实际限领 1 张）` : ''}</p></td>
                  {scope === 'merchant' && <td className="min-w-[160px] px-5 py-4"><p className="text-slate-700">{row.merchantName || '未提供门店名称'}</p><p className="mt-1.5 font-mono text-xs text-slate-400">{row.merchantShortLink || '—'}</p></td>}
                  <td className="whitespace-nowrap px-5 py-4 font-semibold text-[#2e7d7d]">${row.amount}</td>
                  <td className="whitespace-nowrap px-5 py-4">{row.threshold > 0 ? `满 $${row.threshold}` : '无门槛'}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-xs leading-6 text-slate-500"><p>{row.startDate}</p><p>至 {row.endDate}</p></td>
                  <td className="whitespace-nowrap px-5 py-4"><button type="button" disabled={busy} onClick={() => handleToggleStatus(row.id)} aria-label={`${row.status === '正常' ? '关闭' : '启用'}优惠券：${row.name}`} aria-pressed={row.status === '正常'} className={cn('rounded-lg px-3 py-2 text-xs font-medium transition', row.status === '正常' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>{row.status}</button></td>
                  <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500">{row.updateDate}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-right"><div className="flex justify-end gap-2"><button disabled={busy} onClick={() => handleOpenEdit(row)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-[#2e7d7d] hover:bg-[#f0f9f8]">编辑</button><button disabled={busy} onClick={() => handleDelete(row.id)} className="rounded-lg px-3 py-2 text-[13px] text-slate-500 hover:bg-rose-50 hover:text-rose-600">停用</button></div></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-5 py-4 text-[13px] text-slate-500">
          <span>{loading || requestError ? '—' : total > 0 ? `共 ${total} 条 · 显示 ${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + coupons.length} 条` : '共 0 条'}</span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2" htmlFor="coupon-page-size">每页<select id="coupon-page-size" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700">{[25, 50, 100].map(size => <option key={size} value={size}>{size} 条</option>)}</select></label>
            <span>{loading || requestError ? `第 ${page} 页` : `第 ${page} / ${totalPages} 页`}</span>
            <button type="button" aria-label="上一页优惠券" disabled={loading || busy || page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" aria-label="下一页优惠券" disabled={loading || busy || !!requestError || page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" role="dialog" aria-modal="true" aria-labelledby="coupon-modal-title">
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
                <div><h3 id="coupon-modal-title" className="text-lg font-semibold text-slate-900">{editingCoupon ? '编辑优惠券' : '新增优惠券'}</h3><p className="mt-1.5 text-[13px] text-slate-500">填写优惠内容和使用规则。</p></div>
                <button disabled={busy} onClick={() => setIsModalOpen(false)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700" aria-label="关闭优惠券设置"><X className="h-5 w-5" /></button>
              </div>
              <form onSubmit={handleSubmit} id="coupon-form" className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-7">
                <section className="space-y-5">
                  <h4 className="text-sm font-semibold text-slate-900">基本信息</h4>
                  {!editingCoupon && <fieldset><legend className={labelClass}>优惠券类型</legend><div className="flex flex-wrap gap-3">{(isStoreManager ? ['merchant'] as const : ['general', 'merchant'] as const).map(type => <button key={type} type="button" onClick={() => setFormType(type)} aria-pressed={formType === type} className={cn('rounded-lg border px-4 py-2.5 text-sm transition', formType === type ? 'border-[#48a1a1]/30 bg-[#eaf5f4] text-[#2e7d7d]' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>{type === 'general' ? '通用优惠券' : '商家优惠券'}</button>)}</div></fieldset>}
                  {editingCoupon && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] leading-6 text-slate-600">{termsLocked ? `已领取 ${editingCoupon.claimedCount} 张：优惠金额、使用门槛、归属商家和有效期已锁定。` : '优惠券一旦被领取，优惠金额、使用门槛、归属商家和有效期将锁定。'} 停用后停止发放，客户券包中的历史记录保留；保存以服务器校验为准。</p>}
                  <div><label htmlFor="coupon-name" className={labelClass}>优惠券名称 <span className="text-rose-500">*</span></label><input id="coupon-name" type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className={inputClass} placeholder="例如：新人体验代金券" required /></div>
                  {formType === 'merchant' && (
                    <div className="space-y-4 rounded-xl border border-[#48a1a1]/20 bg-[#f5faf9] p-4">
                      <div><label htmlFor="coupon-merchant-link" className={labelClass}>商家短链 <span className="text-rose-500">*</span></label><input id="coupon-merchant-link" type="text" maxLength={100} disabled={termsLocked} value={merchantShortLink} onChange={(e) => setMerchantShortLink(e.target.value)} className={inputClass} placeholder="输入实际门店短链" required /></div>
                      {editingCoupon?.merchantName && merchantShortLink.trim() === editingCoupon.merchantShortLink && <p className="text-[13px] text-[#2e7d7d]">当前关联：{editingCoupon.merchantName}</p>}
                      <p className="text-xs leading-5 text-slate-500">保存时核对门店短链及账户权限；门店名称以保存结果为准。</p>
                    </div>
                  )}
                </section>
                <section className="space-y-5 border-t border-slate-100 pt-6">
                  <h4 className="text-sm font-semibold text-slate-900">优惠规则</h4>
                  <div><label htmlFor="coupon-per-user-limit" className={labelClass}>每人限领数量</label><input id="coupon-per-user-limit" type="number" value={1} readOnly className={inputClass} aria-describedby="coupon-per-user-help" /><p id="coupon-per-user-help" className="mt-2 text-xs leading-5 text-slate-500">当前每位顾客对同一优惠券最多领取 1 张，与券发行总量分别管理。{historicalLimit > 1 ? ` 此券历史配置为 ${historicalLimit} 张，当前实际限领仍为 1 张；不代表顾客曾领取多张。${termsLocked ? '已有领取记录，本次保留历史规则记录。' : '保存后将明确设为 1 张。'}` : ''}</p></div>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div><label htmlFor="coupon-amount" className={labelClass}>优惠金额（美元）<span className="text-rose-500">*</span></label><input id="coupon-amount" type="number" disabled={termsLocked} value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className={inputClass} placeholder="例如：10" required min="0.01" step="0.01" /></div>
                    <div><label htmlFor="coupon-threshold" className={labelClass}>使用门槛（美元）</label><input id="coupon-threshold" type="number" disabled={termsLocked} value={formThreshold} onChange={(e) => setFormThreshold(e.target.value)} className={inputClass} placeholder="例如：50" min="0" step="0.01" /><p className="mt-2 text-xs text-slate-500">留空或填 0 为无门槛</p></div>
                  </div>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2"><div><label htmlFor="coupon-start-date" className={labelClass}>开始日期</label><input id="coupon-start-date" type="date" disabled={termsLocked} required value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} className={inputClass} /></div><div><label htmlFor="coupon-end-date" className={labelClass}>结束日期</label><input id="coupon-end-date" type="date" disabled={termsLocked} required min={formStartDate || undefined} value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} className={inputClass} /></div></div>
                  <div><label htmlFor="coupon-description" className={labelClass}>使用说明</label><textarea id="coupon-description" rows={3} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className={inputClass} placeholder="使用限制或其他备注" /></div>
                  <fieldset><legend className={labelClass}>状态</legend><div className="flex flex-wrap gap-6 text-sm text-slate-700">{(['正常', '关闭'] as const).map(status => <label key={status} className="flex min-h-10 cursor-pointer items-center gap-2"><input type="radio" name="couponStatus" checked={formStatus === status} onChange={() => setFormStatus(status)} className="h-4 w-4 accent-[#48a1a1]" />{status}</label>)}</div></fieldset>
                </section>
                {formError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
              </form>
              <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-7"><button type="button" disabled={busy} onClick={() => setIsModalOpen(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">取消</button><button type="submit" disabled={busy} form="coupon-form" className="rounded-lg bg-[#48a1a1] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#3d8b8b]">{busy ? '正在保存…' : '保存优惠券'}</button></div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
