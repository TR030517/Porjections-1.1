import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import TablePage from './components/TablePage';
import AreaManagement from './components/AreaManagement';
import CouponManagement from './components/CouponManagement';
import GiftCardManagement from './components/GiftCardManagement';
import StoreManagement from './components/StoreManagement';
import AdminManagement from './views/system/AdminManagement';
import MerchantManagement from './views/system/MerchantManagement';
import { ViewId } from './types';
import { Edit2, Trash2, ShieldAlert } from 'lucide-react';
import { cn } from './lib/utils';
import { useUserStore } from './stores/user';
import { useShopStore } from './stores/shop';
import { canAccessView } from './permission';

// Mock Data
const users = [
  { id: 2097, avatar: '👤', username: 'Ariva Admin', email: 'a85840301@gmail.com', status: '启用', regDate: '2026-05-30 07:20:12' },
  { id: 2096, avatar: '👤', username: 'Martina Nathan', email: 'natemartina@gmail.com', status: '启用', regDate: '2026-05-30 06:56:11' },
  { id: 2095, avatar: '👤', username: 'Jkpstars', email: 'jkpstars12@gmail.com', status: '启用', regDate: '2026-05-30 01:24:30' },
  { id: 2094, avatar: '👤', username: 'Geis Darcy', email: 'darcylynne@yahoo.com', status: '启用', regDate: '2026-05-29 09:06:29' },
  { id: 2093, avatar: '👤', username: 'Nguyen Mai', email: 'mtnguyen2626@gmail.com', status: '启用', regDate: '2026-05-29 08:00:41' },
];

const coupons = [];

const admins = [
  { id: 1, role: '管理员', username: 'admin', account: 'admin', loginCount: 293, status: '启用', lastLogin: '2026-04-15 06:42:21' },
  { id: 2, role: 'TEST', username: 'yehua123', account: 'yehua', loginCount: 35, status: '启用', lastLogin: '2026-04-14 09:21:41' },
];

const stores = [
  { id: 3246, shortName: 'ArivaSpa', logo: '🏥', name: 'Ariva Spa', address: '6728 W Coal Mine Ave A110, Littleton, CO 80123, USA', phone: '303-475-1111', email: 'arivamassage@gmail.com', status: '启用', createdDate: '2026-05-29 10:07:23' },
  { id: 3221, shortName: 'Roesspa', logo: '💆', name: 'Roes spa', address: '6054 W 159th St, Oak Forest, IL 60452, USA', phone: '312-283-8685', email: 'roesspa9@gmail.com', status: '启用', createdDate: '2026-05-23 10:19:05' },
];

const serviceOrders = [
  { id: 614, orderNo: '20260528356700003', amount: '80.00', actualPay: '80.00', status: '已取消', user: 'Syed', store: 'gem 7', date: '2026-05-28 12:11:35' },
  { id: 613, orderNo: '20260528309200002', amount: '30.00', actualPay: '0.00', status: '已完成', user: 'Ashlee', store: 'Happy Feet', date: '2026-05-28 03:39:30' },
];

export default function App() {
  const [currentView, setCurrentView] = useState<ViewId>('dashboard');
  const { currentRole, roleLabel } = useUserStore();
  const { hasBranches, branchList } = useShopStore();

  // Route guarding watcher: redirects any invalid view choices instantly
  useEffect(() => {
    if (!canAccessView(currentRole, currentView)) {
      console.warn(`[Permission Guard] Non-accessible route "${currentView}" selected under role "${currentRole}". Redirecting.`);
      setCurrentView('dashboard');
    }
  }, [currentRole, currentView]);

  const renderView = () => {
    // Secondary render safety check
    if (!canAccessView(currentRole, currentView)) {
      return (
        <div className="bg-red-50 border border-red-200 p-8 rounded-none text-center space-y-4 max-w-xl mx-auto my-12 antialiased">
          <ShieldAlert className="w-12 h-12 text-red-600 mx-auto" />
          <h2 className="text-base font-bold text-gray-900">访问受限 (Permission Denied)</h2>
          <p className="text-xs text-gray-600 leading-relaxed">
            当前身份为 <span className="font-bold text-red-600">[{roleLabel}]</span>，不支持访问
            <span className="font-semibold text-gray-800 font-mono bg-gray-150 px-1 py-0.5 rounded-none"> {currentView} </span> 模块。
            该模块属于平台级专用功能，已被多级角色权限隔离。
          </p>
          <button 
            type="button"
            onClick={() => setCurrentView('dashboard')}
            className="px-4 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-bold text-xs rounded-none cursor-pointer transition-colors"
          >
            返回台面仪表盘
          </button>
        </div>
      );
    }

    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'area-management':
        return <AreaManagement />;
      case 'user-list':
        return (
          <TablePage 
            title="用户列表"
            onAdd={() => {}}
            filters={[
              { label: '用户', placeholder: '用户名' },
              { label: '邮箱', placeholder: '邮箱' }
            ]}
            columns={[
              { key: 'id', label: 'ID' },
              { key: 'avatar', label: '头像', render: (v) => <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-lg">{v}</div> },
              { key: 'username', label: '用户名' },
              { key: 'email', label: '邮箱' },
              { key: 'status', label: '状态', render: (v) => (
                <div className="flex items-center gap-2">
                  <span className="text-[#48a1a1] font-medium">{v}</span>
                  <div className="w-8 h-4 bg-[#48a1a1] rounded-full relative">
                    <div className="w-3 h-3 bg-white rounded-full absolute right-0.5 top-0.5"></div>
                  </div>
                </div>
              )},
              { key: 'regDate', label: '注册日期' },
              { key: 'actions', label: '操作', render: () => (
                <div className="flex items-center gap-2">
                  <button className="p-1.5 text-gray-400 hover:text-blue-500 rounded border border-gray-100"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button className="p-1.5 text-gray-400 hover:text-red-500 rounded border border-gray-100"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            ]}
            data={users}
          />
        );
      case 'store-list':
        return (
          <StoreManagement />
        );
      case 'service-orders':
        return (
          <TablePage 
            title="服务订单"
            filters={[
              { label: '所属用户', placeholder: '所属用户' },
              { label: '所属店铺', placeholder: '所属店铺' },
              { label: '服务人名称', placeholder: '服务人名称' }
            ]}
            columns={[
              { key: 'id', label: 'ID' },
              { key: 'orderNo', label: '订单号' },
              { key: 'amount', label: '订单金额' },
              { key: 'user', label: '用户名' },
              { key: 'store', label: '所属门店' },
              { key: 'status', label: '订单状态', render: (v) => (
                <span className={cn(
                  "px-2 py-1 rounded text-xs font-medium",
                  v === '已完成' ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                )}>{v}</span>
              )},
              { key: 'date', label: '创建时间' },
              { key: 'actions', label: '操作', render: () => (
                <div className="flex items-center gap-1">
                  <button className="px-2 py-1 bg-blue-500 text-white text-xs rounded">修改</button>
                  <button className="px-2 py-1 bg-red-500 text-white text-xs rounded">删除</button>
                </div>
              )}
            ]}
            data={serviceOrders}
          />
        );
      case 'coupon-management':
        return (
          <CouponManagement />
        );
      case 'gift-card-management':
        return (
          <GiftCardManagement />
        );
      case 'admin-list':
        return (
          <AdminManagement />
        );
      case 'merchant-list':
        return (
          <MerchantManagement />
        );
      default:
        return (
          <div className="bg-white p-20 rounded-xl border border-gray-100 shadow-sm text-center text-gray-400">
            <h2 className="text-xl font-medium mb-2">{currentView} 正在开发中...</h2>
            <p>该页面功能尚未实现，目前仅展示 Dashboard、用户列表和管理员列表。</p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <div className="pl-60">
        <Header />
        <main className="pt-24 px-8 pb-8">
          {renderView()}
        </main>
      </div>
    </div>
  );
}
