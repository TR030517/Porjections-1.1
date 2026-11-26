import React, { useState } from 'react';
import { BarChart3, MapPin, Ticket, Users, ClipboardCheck, Store, ShoppingCart, Banknote, Settings, Briefcase, FileText, Monitor, ChevronDown, ChevronRight, X } from 'lucide-react';
import { ViewId, NavItem } from '../types';
import { cn } from '../lib/utils';
import { useAuthStore } from '../stores/authStore';
import { canAccessView } from '../permission';
export const navItems: NavItem[] = [
  { id: 'dashboard', label: '运营概览', icon: 'BarChart3' },
  { id: 'store-list', label: '门店管理', icon: 'Store', children: [{ id: 'store-list', label: '门店列表' }, { id: 'store-application', label: '门店申请' }] },
  { id: 'industries', label: '行业管理', icon: 'Briefcase' },
  { id: 'area-management', label: '地区管理', icon: 'MapPin' },
  { id: 'coupon-management', label: '卡券管理', icon: 'Ticket', children: [{ id: 'coupon-management', label: '优惠券' }, { id: 'gift-card-management', label: '礼品卡产品' }] },
  { id: 'service-orders', label: '订单管理', icon: 'ShoppingCart', children: [{ id: 'service-orders', label: '服务订单' }, { id: 'gift-card-orders', label: '礼品卡订单' }] },
  { id: 'user-list', label: '用户列表', icon: 'Users' },
  { id: 'post-sales', label: '售后申请', icon: 'ClipboardCheck' },
  { id: 'withdrawal-list', label: '提现记录', icon: 'Banknote' },
  { id: 'help-list', label: '内容管理', icon: 'FileText', children: [{id:'help-list',label:'平台公告'},{id:'banner-list',label:'首页轮播'}] },
  { id: 'platform-settings', label: '平台设置', icon: 'Settings' },
  { id: 'notification-operations', label: '通知运营', icon: 'FileText' },
  { id: 'audit-logs', label: '操作审计', icon: 'ClipboardCheck' },
  { id: 'admin-list', label: '账户管理', icon: 'Monitor', children: [{ id: 'admin-list', label: '管理员账户' }, { id: 'merchant-list', label: '商家账号与关联' }] },
];
const icons: Record<string, any> = { BarChart3, MapPin, Ticket, Users, ClipboardCheck, Store, ShoppingCart, Banknote, Settings, Briefcase, FileText, Monitor };
export default function Sidebar({ currentView, onViewChange, isOpen = false, onClose }: { currentView: ViewId; onViewChange: (view: ViewId) => void; isOpen?: boolean; onClose?: () => void }) {
  const { currentRole } = useAuthStore();
  const [expanded, setExpanded] = useState<string[]>([]);
  const items = navItems.map(item => ({ ...item, children: item.children?.filter(child => canAccessView(currentRole, child.id)) })).filter(item => item.children ? item.children.length > 0 : canAccessView(currentRole, item.id));
  return <aside className={cn('app-sidebar', isOpen && 'is-open')} aria-label="主导航">
    <div className="flex h-20 shrink-0 items-center gap-3 border-b border-slate-100 px-5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand"><Store className="h-5 w-5 text-white" /></span><div className="flex-1"><span className="text-xl font-semibold text-slate-800">Massajoy2.0</span><p className="mt-0.5 text-xs text-slate-500">运营管理平台</p></div><button type="button" className="mobile-menu-toggle text-slate-500" aria-label="关闭导航" onClick={onClose}><X className="h-5 w-5" /></button></div>
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">{items.map(item => {
      const Icon = icons[item.icon];
      const active = currentView === item.id || item.children?.some(child => child.id === currentView);
      const isExpanded = expanded.includes(item.id) || Boolean(item.children?.some(child => child.id === currentView));
      return <div key={item.id}><button type="button" aria-expanded={item.children ? isExpanded : undefined} aria-current={!item.children && active ? 'page' : undefined} onClick={() => item.children ? setExpanded(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id]) : onViewChange(item.id)} className={cn('flex w-full items-center justify-between rounded-lg px-3 py-3 text-sm font-medium', active ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-50')}><span className="flex items-center gap-3"><Icon className="h-4 w-4" />{item.label}</span>{item.children && (isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}</button>{item.children && isExpanded && <div className="ml-5 mt-1 space-y-1 border-l border-slate-100 pl-3">{item.children.map(child => <button key={child.id} type="button" aria-current={currentView === child.id ? 'page' : undefined} onClick={() => onViewChange(child.id)} className={cn('w-full rounded-lg px-3 py-2.5 text-left text-sm', currentView === child.id ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-50')}>{child.label}</button>)}</div>}</div>;
    })}</nav>
    <div className="border-t border-slate-100 px-6 py-4 text-xs text-slate-400">权限由服务器管理</div>
  </aside>;
}
