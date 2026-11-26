import React, { useEffect, useState } from 'react';
import { listResourcePage, ResourceName } from '../api/resources';

interface ReferenceItem { id: string | number; name?: string; title?: string; email?: string; status?: string; isActive?: boolean; }
export default function ResourcePicker({ resource, value, onChange, onSelect, multiple = false, shopId, disabled = false, required = false }: {
  resource: ResourceName; value: unknown; onChange: (value: string | string[]) => void; onSelect?: (item: ReferenceItem | undefined) => void; multiple?: boolean; shopId?: unknown; disabled?: boolean; required?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (disabled || (resource === 'services' && !shopId)) {
      setItems([]); setTotal(0); setLoading(false); setError('');
      return;
    }
    const controller = new AbortController();
    setItems([]); setTotal(0); setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      listResourcePage<ReferenceItem>(resource, { page: 1, pageSize: 100, search: search.trim(), ...(shopId ? { shopId: String(shopId) } : {}) }, controller.signal)
        .then(result => { if (!controller.signal.aborted) { setItems(result.items); setTotal(result.total); } })
        .catch(err => { if (!controller.signal.aborted) { setItems([]); setError(err instanceof Error ? err.message : '选项加载失败'); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [resource, search, shopId, disabled]);
  const selected = Array.isArray(value) ? value.map(String) : value == null || value === '' ? [] : [String(value)];
  const optionItems: ReferenceItem[] = [...selected.filter(id => !items.some(item => String(item.id) === id)).map(id => ({ id, name: `当前记录 #${id}` })), ...items];
  const choose = (id: string, checked: boolean) => onChange(checked ? [...selected, id] : selected.filter(item => item !== id));
  if (resource === 'services' && !shopId) return <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">请先明确选择所属门店，再选择本店服务。</p>;
  if (disabled) return <input readOnly value={selected.join(', ') || '—'} className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500" />;
  return <div className="space-y-2">
    <input type="search" aria-label="搜索可选记录" value={search} disabled={resource === 'services' && !shopId} onChange={event => setSearch(event.target.value)} placeholder={resource === 'services' && !shopId ? '请先选择门店' : '按名称搜索'} className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {multiple ? <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-3">{optionItems.map(item => <label key={item.id} className="flex items-center gap-3 py-2 text-sm"><input type="checkbox" checked={selected.includes(String(item.id))} onChange={event => choose(String(item.id), event.target.checked)} />{item.name ?? item.title ?? item.email ?? '#' + item.id} <span className="text-xs text-slate-400">#{item.id}</span></label>)}{!optionItems.length && <span className="text-sm text-slate-400">{loading ? '正在加载…' : '暂无可选记录'}</span>}</div> : <select required={required} value={selected[0] ?? ''} onChange={event => { onSelect?.(optionItems.find(item => String(item.id) === event.target.value)); onChange(event.target.value); }} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">{loading ? '正在加载…' : '请选择'}</option>{optionItems.map(item => <option key={item.id} value={String(item.id)}>{item.name ?? item.title ?? item.email ?? '#' + item.id}{item.email && item.name ? ` · ${item.email}` : ''} (#{item.id}){item.status === 'SUSPENDED' || item.isActive === false ? ' · 已停用' : ''}</option>)}</select>}
    {total > 100 && <p className="text-xs text-slate-500">找到 {total} 条，显示前 100 条。请输入更完整的名称缩小范围。</p>}
  </div>;
}
