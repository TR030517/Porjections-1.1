import React from 'react';
import { Search, Plus, Edit2, Trash2, MoreHorizontal, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
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
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          {tabs && (
            <div className="flex items-center bg-gray-100 p-1 rounded-lg">
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                    activeTab === tab ? "bg-[#48a1a1] text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>
        {onAdd && (
          <button 
            onClick={onAdd}
            className="flex items-center gap-2 bg-[#48a1a1] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#3d8b8b] transition-colors"
          >
            <Plus className="w-4 h-4" />
            新增
          </button>
        )}
      </div>

      {/* Filters */}
      {filters && filters.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex flex-wrap gap-4 items-end">
          {filters.map((filter, idx) => (
            <div key={idx} className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-gray-500 block mb-1.5">{filter.label}</label>
              <div className="relative">
                <input 
                  type={filter.type || 'text'} 
                  placeholder={filter.placeholder}
                  className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                />
                <Search className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>
          ))}
          <button className="bg-[#48a1a1] text-white p-2 rounded-lg hover:bg-[#3d8b8b] transition-colors">
            <Search className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                {columns.map(col => (
                  <th key={col.key} className="px-6 py-4 text-[13px] font-semibold text-gray-600">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-12 text-center text-gray-400 text-sm">
                    暂无数据
                  </td>
                </tr>
              ) : (
                data.map((row, idx) => (
                  <motion.tr 
                    key={idx}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="hover:bg-gray-50/50 transition-colors"
                  >
                    {columns.map(col => (
                      <td key={col.key} className="px-6 py-4 text-sm text-gray-600">
                        {col.render ? col.render(row[col.key], row) : row[col.key]}
                      </td>
                    ))}
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination placeholder */}
        <div className="p-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <div>共 {data.length} 条</div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2">
                <span>15条/页</span>
                <ChevronDown className="w-3.5 h-3.5" />
             </div>
             <div className="flex items-center gap-1">
                <button className="px-2 py-1 rounded bg-gray-50 hover:bg-gray-100">&lt;</button>
                <button className="px-2 py-1 rounded bg-[#48a1a1] text-white">1</button>
                <button className="px-2 py-1 rounded bg-gray-50 hover:bg-gray-100">&gt;</button>
             </div>
             <div className="flex items-center gap-1">
                <span>前往</span>
                <input type="text" className="w-8 border border-gray-100 rounded text-center py-0.5" defaultValue="1" />
                <span>页</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
