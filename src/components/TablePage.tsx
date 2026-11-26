import React from 'react';
import { Search, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface Column {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
}

interface TablePageProps {
  title: string;
  columns: Column[];
  data: any[];
  onAdd?: () => void;
  filters?: { label: string; placeholder: string; type?: string }[];
  tabs?: string[];
}

export default function TablePage({ title, columns, data, onAdd, filters, tabs }: TablePageProps) {
  const [activeTab, setActiveTab] = React.useState(tabs?.[0]);

  return (
    <div className="app-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-heading">{title}</h1>
          <p className="page-description">{title === '用户列表' ? '查看用户资料、账号状态与注册信息。' : '查看服务订单、关联门店与订单处理状态。'}</p>
        </div>
        {onAdd && <button onClick={onAdd} className="flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-[#3d8b8b]"><Plus className="h-4 w-4" />新增用户</button>}
      </div>
      {tabs && <div className="flex flex-wrap gap-2">{tabs.map(tab => <button key={tab} onClick={() => setActiveTab(tab)} className={cn('rounded-lg px-4 py-2 text-sm font-medium', activeTab === tab ? 'bg-brand text-white' : 'bg-white text-slate-500')}>{tab}</button>)}</div>}
      {filters && filters.length > 0 && (
        <div className="surface-panel flex flex-wrap items-end gap-4 p-5 sm:p-6">
          {filters.map((filter, index) => (
            <label key={index} className="min-w-0 flex-[1_1_200px] space-y-2 text-sm text-slate-500">
              <span>{filter.label}</span>
              <input type={filter.type || 'text'} placeholder={filter.placeholder} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/15" />
            </label>
          ))}
          <button className="flex min-h-10 items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-[#3d8b8b]"><Search className="h-4 w-4" />查询</button>
        </div>
      )}
      <section className="surface-panel overflow-hidden" aria-label={title}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="text-sm font-semibold text-slate-800">{title}</h2><span className="text-xs text-slate-400">共 {data.length} 条记录</span></div>
        <div className="overflow-x-auto">
          <table className="min-w-[850px] text-left">
            <thead><tr className="border-b border-slate-100">{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.length === 0 ? <tr><td colSpan={columns.length} className="py-16 text-center text-slate-400">暂无数据</td></tr> : data.map((row, index) => (
                <tr key={row.id ?? index} className="text-slate-600 transition-colors hover:bg-slate-50/70">{columns.map(column => <td key={column.key}>{column.render ? column.render(row[column.key], row) : row[column.key]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-5 py-4 text-sm text-slate-500 sm:px-6">
          <span>共 {data.length} 条 · 15 条 / 页</span>
          <div className="flex items-center gap-2"><button disabled aria-label="上一页" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-300"><ChevronLeft className="h-4 w-4" /></button><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white">1</span><button disabled aria-label="下一页" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-300"><ChevronRight className="h-4 w-4" /></button></div>
        </div>
      </section>
    </div>
  );
}
