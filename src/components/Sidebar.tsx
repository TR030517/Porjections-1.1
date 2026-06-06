import React, { useState } from 'react';
import { 
  BarChart3, 
  MapPin, 
  Ticket, 
  Users, 
  ClipboardCheck, 
  Store, 
  ShoppingCart, 
  Banknote, 
  Settings, 
  Briefcase, 
  FileText, 
  Monitor,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { ViewId, NavItem } from '../types';
import { cn } from '../lib/utils';
import { useUserStore } from '../stores/user';
import { canAccessView } from '../permission';

const navItems: NavItem[] = [
  { id: 'dashboard', label: '统计', icon: 'BarChart3' },
  { id: 'area-management', label: '地区管理', icon: 'MapPin' },
  { 
    id: 'coupon-management', 
    label: '卡券管理', 
    icon: 'Ticket',
    children: [
      { id: 'coupon-management', label: '优惠券' },
      { id: 'gift-card-management', label: '礼品卡' },
    ]
  },
  { id: 'user-list', label: '用户列表', icon: 'Users' },
  { id: 'post-sales', label: '售后审核', icon: 'ClipboardCheck' },
  { 
    id: 'store-list', 
    label: '门店管理', 
    icon: 'Store',
    children: [
      { id: 'store-application', label: '申请列表' },
      { id: 'store-list', label: '门店列表' },
    ]
  },
  { 
    id: 'service-orders', 
    label: '订单管理', 
    icon: 'ShoppingCart',
    children: [
      { id: 'service-orders', label: '服务订单' },
      { id: 'gift-card-orders', label: '礼品卡订单' },
    ]
  },
  { id: 'withdrawal-list', label: '提现列表', icon: 'Banknote' },
  { id: 'platform-settings', label: '平台设置', icon: 'Settings' },
  { id: 'help-list', label: '内容管理', icon: 'FileText' },
  { 
    id: 'admin-list', 
    label: '系统管理', 
    icon: 'Monitor',
    children: [
      { id: 'admin-list', label: '管理员列表' },
      { id: 'merchant-list', label: '商家账号管理' },
      { id: 'role-management', label: '角色管理' },
      { id: 'package-management', label: '包管理' },
    ]
  },
];

const IconMap: Record<string, any> = {
  BarChart3, MapPin, Ticket, Users, ClipboardCheck, Store, ShoppingCart, Banknote, Settings, Briefcase, FileText, Monitor
};

interface SidebarProps {
  currentView: ViewId;
  onViewChange: (view: ViewId) => void;
}

export default function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const { currentRole } = useUserStore();

  const toggleExpand = (label: string) => {
    setExpandedItems(prev => 
      prev.includes(label) ? prev.filter(i => i !== label) : [...prev, label]
    );
  };

  // Filter items in real-time according to RBAC roles
  const allowedNavItems = navItems.filter(item => {
    if (item.children) {
      // If there are subpages, check if at least one subpage is accessible
      const visibleChildren = item.children.filter(child => canAccessView(currentRole, child.id));
      return visibleChildren.length > 0;
    }
    return canAccessView(currentRole, item.id);
  });

  return (
    <div className="w-60 bg-white border-right border-gray-100 flex flex-col h-screen fixed left-0 top-0 z-20 overflow-y-auto">
      <div className="p-4 flex items-center gap-2 border-b border-gray-100 mb-2">
        <div className="w-8 h-8 bg-[#48a1a1] rounded-full flex items-center justify-center">
          <Store className="text-white w-5 h-5" />
        </div>
        <span className="text-xl font-bold text-[#48a1a1]">MassaJoy</span>
      </div>

      <nav className="flex-1 px-2 space-y-1">
        {allowedNavItems.map((item) => {
          const Icon = IconMap[item.icon];
          const isExpanded = expandedItems.includes(item.label);
          // Only subpages that are permitted are calculated for being active
          const allowedChildren = item.children ? item.children.filter(c => canAccessView(currentRole, c.id)) : [];
          const isActive = currentView === item.id || allowedChildren.some(c => c.id === currentView);

          return (
            <div key={item.label}>
              <button
                onClick={() => item.children ? toggleExpand(item.label) : onViewChange(item.id)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group",
                  isActive ? "text-[#48a1a1] bg-[#f0f9f9]" : "text-gray-600 hover:text-[#48a1a1] hover:bg-gray-50"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn("w-4 h-4", isActive ? "text-[#48a1a1]" : "text-gray-400 group-hover:text-[#48a1a1]")} />
                  <span>{item.label}</span>
                </div>
                {item.children && (
                  isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>

              {item.children && isExpanded && allowedChildren.length > 0 && (
                <div className="mt-1 ml-4 border-l border-gray-100 pl-4 space-y-1">
                  {allowedChildren.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => onViewChange(child.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                        currentView === child.id ? "text-[#48a1a1] bg-[#f0f9f9]" : "text-gray-500 hover:text-[#48a1a1] hover:bg-gray-50"
                      )}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
