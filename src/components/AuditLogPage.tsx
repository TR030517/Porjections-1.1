import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList, Link, RefreshCw, Search, X } from 'lucide-react';
import { AUDIT_ACTIONS, AUDIT_TARGETS, AuditFilters, AuditLogItem, AuditLogPage as AuditPage, auditActionLabel, auditQuery, auditTargetLabel, listAuditLogs, safeAuditSummary } from '../api/auditLogs';
import type { ResourceQuery } from '../api/resources';
import { locationPage, locationPageSize, safeAdminLocation } from '../utils/adminLocation';

const emptyFilters: AuditFilters = { targetType: '', action: '', targetId: '', operatorId: '', startDate: '', endDate: '' };
const inputClass = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 disabled:opacity-40';
export function auditUtc(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace('Z', ' UTC') : '—';
}

function AuditDetail({ item, onClose }: { item: AuditLogItem; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); }; }, []);
  const lines = safeAuditSummary(item.detail);
  return <dialog ref={dialog} aria-modal="true" aria-labelledby="audit-detail-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_24px)] max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-900/40">
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 p-5"><h2 id="audit-detail-title" className="text-lg font-semibold">操作记录详情</h2><button type="button" autoFocus aria-label="关闭审计详情" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"><X className="h-5 w-5" /></button></div>
    <div className="space-y-5 p-5"><dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm"><dt className="text-slate-500">记录 ID</dt><dd className="break-all">{item.id}</dd><dt className="text-slate-500">操作时间</dt><dd className="break-words">{auditUtc(item.createdAt)}</dd><dt className="text-slate-500">操作动作</dt><dd>{auditActionLabel(item.action)}<span className="mt-1 block break-all text-xs text-slate-500">{item.action}</span></dd><dt className="text-slate-500">目标实体</dt><dd>{auditTargetLabel(item.targetType)}<span className="mt-1 block break-all text-xs text-slate-500">{item.targetType} · #{item.targetId}</span></dd><dt className="text-slate-500">操作者 ID</dt><dd className="break-all">{item.operatorId}</dd></dl>
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="mb-3 text-sm font-medium">安全摘要</h3>{lines.length ? <ul className="space-y-2 text-sm leading-6 text-slate-600">{lines.map(line => <li key={line} className="break-words">{line}</li>)}</ul> : <p className="text-sm text-slate-500">此记录没有可展示的安全摘要。</p>}</section>
      <p className="text-xs leading-6 text-slate-500">仅展示允许公开的字段名称和状态摘要；原因原文、联系方式及其他原始内容不在此展示。</p>
    </div>
  </dialog>;
}

export default function AuditLogPage({ initialQuery, onQueryChange }: { initialQuery?: ResourceQuery; onQueryChange?: (query: ResourceQuery) => void } = {}) {
  const [initial] = useState(() => safeAdminLocation('audit-logs', initialQuery).query);
  const initialFilters = Object.fromEntries(Object.keys(emptyFilters).map(key => [key, String(initial[key] ?? '')])) as AuditFilters;
  const [draft, setDraft] = useState<AuditFilters>(initialFilters);
  const [filters, setFilters] = useState<AuditFilters>(initialFilters);
  const [page, setPage] = useState(() => locationPage(initial.page)), [limit, setLimit] = useState(() => locationPageSize(initial.limit, [20, 50, 100], 20));
  const [result, setResult] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [formError, setFormError] = useState('');
  const [refresh, setRefresh] = useState(0), [selected, setSelected] = useState<AuditLogItem | null>(null);
  const [linkNotice, setLinkNotice] = useState('');
  useEffect(() => { onQueryChange?.({ ...filters, page, limit }); }, [filters, page, limit, onQueryChange]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setResult(null); setSelected(null);
    listAuditLogs(filters, page, limit, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '审计记录加载失败，请重试。');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, limit, refresh]);
  const change = (key: keyof AuditFilters, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try { auditQuery(draft, 1, limit); setFormError(''); setPage(1); setFilters({ ...draft }); }
    catch (err) { setFormError(err instanceof Error ? err.message : '请检查筛选条件。'); }
  };
  const reset = () => { setDraft({ ...emptyFilters }); setFilters({ ...emptyFilters }); setPage(1); setFormError(''); };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setLinkNotice('已复制当前已提交筛选的链接。'); }
    catch { setLinkNotice('未能复制，请从浏览器地址栏复制当前链接。'); }
  };
  const totalPages = result?.meta.totalPages ?? 0;
  return <div className="app-page">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-heading">操作审计</h1><p className="page-description">查询已记录的管理操作。仅管理员可访问，时间与日期筛选均按 UTC 显示。</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={copyLink} className={buttonClass}><Link className="h-4 w-4" />复制查询链接</button><button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className={buttonClass}><RefreshCw className="h-4 w-4" />刷新记录</button></div></div>
    {linkNotice && <p role="status" className="text-sm text-slate-600">{linkNotice}</p>}
    <form onSubmit={submit} className="surface-panel space-y-5 p-5 sm:p-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="min-w-0 space-y-2 text-sm text-slate-600"><span className="block">目标类型</span><input list="audit-target-options" maxLength={50} value={draft.targetType} onChange={event => change('targetType', event.target.value)} className={inputClass} placeholder="全部类型，或输入类型代码" /><datalist id="audit-target-options">{Object.entries(AUDIT_TARGETS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</datalist></label>
      <label className="min-w-0 space-y-2 text-sm text-slate-600"><span className="block">操作动作</span><input list="audit-action-options" maxLength={100} value={draft.action} onChange={event => change('action', event.target.value)} className={inputClass} placeholder="全部动作，或输入动作代码" /><datalist id="audit-action-options">{Object.entries(AUDIT_ACTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</datalist></label>
      <label className="min-w-0 space-y-2 text-sm text-slate-600"><span className="block">实体 ID</span><input inputMode="numeric" maxLength={19} value={draft.targetId} onChange={event => change('targetId', event.target.value)} className={inputClass} placeholder="完整 ID，精确匹配" /></label>
      <label className="min-w-0 space-y-2 text-sm text-slate-600"><span className="block">操作者 ID</span><input inputMode="numeric" maxLength={19} value={draft.operatorId} onChange={event => change('operatorId', event.target.value)} className={inputClass} placeholder="完整 ID，精确匹配" /></label>
      <label className="min-w-0 space-y-2 text-sm text-slate-600"><span className="block">开始日期（UTC，含当日）</span><input type="date" min="1000-01-01" max="9999-12-31" value={draft.startDate} onChange={event => change('startDate', event.target.value)} className={inputClass} /></label>
      <label className="min-w-0 space-y-2 text-sm text-slate-600"><span className="block">结束日期（UTC，含当日）</span><input type="date" min="1000-01-01" max="9999-12-31" value={draft.endDate} onChange={event => change('endDate', event.target.value)} className={inputClass} /></label>
    </div><div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4"><p className="text-xs leading-6 text-slate-500">目标与动作按代码精确筛选；下拉建议同时提供中文名称。留空表示全部。</p><div className="flex gap-2"><button type="button" onClick={reset} className={buttonClass}>重置</button><button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white"><Search className="h-4 w-4" />查询</button></div></div>{formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}</form>
    {error && <div role="alert" className="surface-panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-red-700"><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)} className={buttonClass}>重试</button></div>}
    <section aria-label="审计记录列表" aria-busy={loading} className="surface-panel overflow-hidden"><div className="overflow-x-auto"><table className="min-w-[1000px] text-left"><thead><tr><th>时间（UTC）</th><th>操作动作</th><th>目标实体</th><th>操作者 ID</th><th>安全摘要</th><th>操作</th></tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={6} className="py-12 text-center text-slate-500" role="status">正在加载审计记录…</td></tr> : error ? <tr><td colSpan={6} className="py-12 text-center text-slate-500">数据尚未加载，请重试。</td></tr> : !result?.items.length ? <tr><td colSpan={6} className="py-12 text-center text-slate-500"><ClipboardList className="mx-auto mb-3 h-7 w-7 text-slate-400" />没有符合筛选条件的操作记录。</td></tr> : result.items.map(item => {
      const summary = safeAuditSummary(item.detail);
      return <tr key={item.id} className="hover:bg-slate-50"><td className="whitespace-nowrap text-slate-600">{auditUtc(item.createdAt)}<span className="mt-1 block text-xs text-slate-400">记录 #{item.id}</span></td><td><span className="font-medium text-slate-800">{auditActionLabel(item.action)}</span><span className="mt-1 block break-all text-xs text-slate-500">{item.action}</span></td><td><span className="text-slate-700">{auditTargetLabel(item.targetType)}</span><span className="mt-1 block break-all text-xs text-slate-500">{item.targetType} · #{item.targetId}</span></td><td className="break-all text-slate-600">{item.operatorId}</td><td className="max-w-sm"><p className="line-clamp-2 text-slate-500">{summary.join('；') || '无可展示的安全摘要'}</p></td><td><button type="button" onClick={() => setSelected(item)} className="min-h-10 text-sm font-medium text-teal-700">查看详情</button></td></tr>;
    })}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 p-5 text-sm text-slate-500"><span>{result ? `共 ${result.meta.total} 条 · 第 ${page} / ${Math.max(1, totalPages)} 页` : '—'}</span><div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2">每页<select aria-label="每页审计记录数" value={limit} onChange={event => { setLimit(Number(event.target.value)); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2 py-1">{[20, 50, 100].map(value => <option key={value} value={value}>{value} 条</option>)}</select></label><button type="button" aria-label="上一页审计记录" disabled={loading || Boolean(error) || page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-lg border border-slate-200 p-2.5 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="下一页审计记录" disabled={loading || Boolean(error) || !result || page >= totalPages || page >= 100000} onClick={() => setPage(value => value + 1)} className="rounded-lg border border-slate-200 p-2.5 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div></section>
    {selected && <AuditDetail item={selected} onClose={() => setSelected(null)} />}
  </div>;
}
