import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, ShieldAlert, ShieldCheck, HelpCircle, Store, Briefcase, Plus, Check, Scissors } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { useUserStore } from '../stores/user';
import { useShopStore } from '../stores/shop';
import { Role } from '../utils/roleEnum';

const data = [
  { name: '2023-01-01', value: 50 },
  { name: '2023-05-03', value: 45 },
  { name: '2023-09-02', value: 60 },
  { name: '2024-01-02', value: 55 },
  { name: '2024-05-03', value: 70 },
  { name: '2024-09-02', value: 85 },
  { name: '2025-01-02', value: 120 },
  { name: '2025-05-04', value: 450 },
  { name: '2025-09-03', value: 780 },
  { name: '2026-01-03', value: 920 },
  { name: '2026-05-05', value: 850 },
];

const stats = [
  { label: '访客访问次数', value: '221701' },
  { label: '会员访问次数', value: '5564' },
  { label: '会员访问人数', value: '1403' },
  { label: '会员预约次数', value: '399' },
  { label: '会员预约人数', value: '257' },
  { label: '服务订单总数', value: '27' },
  { label: '服务订单总额', value: '247' },
  { label: '礼品卡订单总数', value: '8' },
  { label: '礼品卡订单总额', value: '424' },
  { label: '礼品卡使用次数', value: '12' },
  { label: '礼品卡使用人数', value: '7' },
  { label: '优惠券使用次数', value: '27' },
  { label: '优惠券使用人数', value: '9' },
  { label: '待审核商家总数', value: '5' },
  { label: '理疗师总数', value: '951' },
  { label: '动态总数', value: '4' },
];

export default function Dashboard() {
  const { currentRole, isSuperAdmin, isPlatformAdmin, isStoreManager, roleLabel } = useUserStore();
  const { currentStoreId, hasBranches, setHasBranches, branchList, setBranchList, setCurrentStoreId } = useShopStore();

  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');
  const [newBranchPhone, setNewBranchPhone] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAddBranch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName) return;
    const newId = Math.floor(Math.random() * 10000) + 324601;
    setBranchList([...branchList, {
      id: newId,
      name: newBranchName,
      address: newBranchAddress || '美国科罗拉多丹佛测试分店地址',
      phone: newBranchPhone || '303-475-9999'
    }]);
    setNewBranchName('');
    setNewBranchAddress('');
    setNewBranchPhone('');
    setShowAddForm(false);
  };

  const handleRemoveBranch = (id: number) => {
    setBranchList(branchList.filter(b => b.id !== id));
  };

  const getFormattedDate = (date: Date) => {
    try {
      return date.toISOString().split('T')[0];
    } catch (e) {
      return '2026-05-30';
    }
  };

  const getSevenDaysAgo = () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return getFormattedDate(d);
  };

  const [timeRange, setTimeRange] = useState<'7days' | 'custom'>('7days');
  const [startDate, setStartDate] = useState(getSevenDaysAgo());
  const [endDate, setEndDate] = useState(getFormattedDate(new Date()));
  const [region, setRegion] = useState('all');

  const [activeToggles, setActiveToggles] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {
      '旗下商家数量': true,
      '用户总数': true,
    };
    stats.forEach(s => {
      initial[s.label] = true;
    });
    return initial;
  });

  const toggleSwitch = (label: string) => {
    setActiveToggles(prev => ({ ...prev, [label]: !prev[label] }));
  };

  useEffect(() => {
    if (timeRange === '7days') {
      setStartDate(getSevenDaysAgo());
      setEndDate(getFormattedDate(new Date()));
    }
  }, [timeRange]);

  return (
    <div className="space-y-6 select-none font-sans antialiased text-gray-800">
      {/* RBAC ROLE && STORE BRANCH STATUS CENTER */}
      <div className="bg-white border border-gray-150 rounded-none shadow-sm overflow-hidden">
        <div className="bg-slate-50 border-b border-gray-150 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-teal-550/10 text-[#48a1a1] rounded-none">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div>
              <h4 className="text-sm font-bold text-gray-805">多级角色权限（RBAC）与商家分店数据联动面板</h4>
              <p className="text-[10px] text-gray-400 font-mono mt-0.5 uppercase tracking-wide">Dynamic Role-Based Access Control & Branched Store States</p>
            </div>
          </div>
          <span className="text-xs bg-[#eef8f8] text-[#48a1a1] px-2.5 py-1 font-mono font-bold border border-[#48a1a1]/10">
            RBAC STATE: MOUNTED
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
          {/* Left Column: Role Details & Access Scope */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider font-mono">
                当前角色系统职责 (Role Profile)
              </span>
              <div className="flex items-start gap-3 bg-[#f8fafc] p-4 border border-gray-100">
                <div className="text-2xl mt-0.5 select-none shrink-0">
                  {currentRole === Role.SUPER_ADMIN && '⚙️'}
                  {currentRole === Role.PLATFORM_ADMIN && '🛡️'}
                  {currentRole === Role.STORE_MANAGER && '🏪'}
                  {currentRole === Role.USER && '👥'}
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <span>{roleLabel}</span>
                    <span className="font-mono text-[10px] font-normal text-slate-400 bg-gray-100 px-1.5 py-0.5">({currentRole})</span>
                  </p>
                  <p className="text-xs text-gray-550 leading-relaxed font-normal">
                    {isSuperAdmin && '拥有本后台系统的终极统管权限、包含平台全局仪表统计、地区层级设置、优惠活动及礼品卡全局控制权、系统管理(管理员/角色/包管理)等所有的顶特权菜单。'}
                    {isPlatformAdmin && '主要平台常设运营管理员。拥有运营中台几乎所有常规页面（如访问趋势分析、卡卷维护、售后审查、店铺入驻审核、提现清算列表）的操作。不可直接删除超级管理员账号。'}
                    {isStoreManager && '商家端自主维护身份。只能访问与其直接挂钩的商家模块（如商户门店卡券规则配置、卡券兑换核销、以及由 Pinia 状态树映射的分店矩阵），所有涉及「系统管理」、「平台设置」、「提现列表」的菜单都将对其动态隐蔽并在守卫端强制阻止。'}
                    {currentRole === Role.USER && '普通C端微信或Web端数据主，此系统底层完全将其屏蔽，不为其提供控制后台面板的登入态，触发硬隔离保护。'}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#f0f9f9]/50 border border-[#48a1a1]/15 p-4 rounded-none space-y-2 text-xs">
              <p className="font-bold text-gray-805 flex items-center gap-1.5 text-xs text-[#357575]">
                <ShieldAlert className="w-4 h-4 text-[#48a1a1]" />
                权限动态响应测试细则：
              </p>
              <ul className="list-disc pl-4 space-y-1.5 text-slate-650 leading-relaxed">
                <li>请使用顶部 Header 右侧的<b>【切换身份】</b>组件在不同身份之间跳转。</li>
                <li>切换到 <b className="text-orange-600 font-mono">STORE_MANAGER</b> 时，左侧 Sidebar 中的平台级机密页面 <b>系统管理</b>(管理员列表/角色/包) 与 <b>平台设置、提现、用户列表</b> 将被动态裁剪。</li>
                <li>若此时试图硬改变路由或直接访问特权页面，<b className="font-mono bg-white px-1">src/permission.ts</b> 路由级别生命周期守卫将实时捕捉，跳转拦截并阻断渲染。</li>
              </ul>
            </div>
          </div>

          {/* Right Column: Branching List (shopStore linkage) */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider font-mono">
                店主所属分店数据 (Store Branches State)
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-sans">旗下拥有连锁分店:</span>
                <button
                  type="button"
                  onClick={() => setHasBranches(!hasBranches)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-bold border transition-all cursor-pointer rounded-none",
                    hasBranches 
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" 
                      : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100"
                  )}
                >
                  {hasBranches ? '✅ 包含分店 (true)' : '❌ 无分店 (false)'}
                </button>
              </div>
            </div>

            <div className="bg-gray-50 p-4 border border-gray-150 space-y-3.5 rounded-none">
              <div className="flex items-center justify-between text-xs border-b border-gray-200/80 pb-2 bg-white/50 p-2">
                <div>
                  <span className="text-slate-400">名下主店号：</span>
                  <span className="font-mono font-bold text-gray-800">{currentStoreId || 'N/A'} (ArivaSpa)</span>
                </div>
                <div>
                  <span className="text-slate-400">分店总计：</span>
                  <span className="font-mono font-bold text-[#48a1a1]">{hasBranches ? branchList.length : 0} 间</span>
                </div>
              </div>

              {hasBranches && branchList.length > 0 ? (
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {branchList.map((branch) => (
                    <div key={branch.id} className="bg-white border border-gray-150 p-2.5 flex items-center justify-between text-xs hover:border-[#48a1a1] transition-all">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Store className="w-3.5 h-3.5 text-[#48a1a1]" />
                          <p className="font-bold text-gray-800">{branch.name}</p>
                        </div>
                        <p className="text-[10px] text-gray-400 font-mono mt-1">
                          分店ID: <span className="text-gray-600 font-bold">{branch.id}</span> | 电话: <span className="text-gray-600 font-bold">{branch.phone}</span>
                        </p>
                        <p className="text-[10px] text-gray-500 font-sans mt-0.5">{branch.address}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveBranch(branch.id)}
                        className="text-red-500 hover:text-red-600 font-bold cursor-pointer text-[10px] hover:bg-red-50 px-2 py-1.5 border border-dashed border-transparent hover:border-red-100 transition-all rounded-none"
                      >
                        删除分店
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-xs text-gray-400 bg-white border border-dashed border-gray-200">
                  {hasBranches ? '当前没有任何连锁分店实体，请在下方点击添加分店' : '当前设置关闭了连锁分店 (hasBranches flag is false)'}
                </div>
              )}

              {hasBranches && (
                <div className="pt-2 border-t border-gray-200">
                  {!showAddForm ? (
                    <button
                      type="button"
                      onClick={() => setShowAddForm(true)}
                      className="w-full h-8 flex items-center justify-center gap-1 bg-white hover:bg-[#eef8f8] border border-gray-200 hover:border-[#48a1a1] text-[#48a1a1] text-xs font-bold transition-all cursor-pointer rounded-none"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      新增测试分店数据实体
                    </button>
                  ) : (
                    <form onSubmit={handleAddBranch} className="space-y-2 p-3 bg-white border border-gray-150 rounded-none">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-gray-400 block font-medium">分店名称</label>
                          <input
                            type="text"
                            required
                            placeholder="如: Ariva Spa West"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:border-[#48a1a1] font-sans rounded-none"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-gray-400 block font-medium">分店热线</label>
                          <input
                            type="text"
                            placeholder="如: 303-475-8888"
                            value={newBranchPhone}
                            onChange={(e) => setNewBranchPhone(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:border-[#48a1a1] font-sans rounded-none"
                          />
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[10px] text-gray-400 block font-medium">分店地址</label>
                        <input
                          type="text"
                          placeholder="输入美国科罗拉多或其他物理地址"
                          value={newBranchAddress}
                          onChange={(e) => setNewBranchAddress(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:border-[#48a1a1] font-sans rounded-none"
                        />
                      </div>
                      <div className="flex justify-end gap-1.5 pt-1.5">
                        <button
                          type="button"
                          onClick={() => setShowAddForm(false)}
                          className="px-3 h-6 bg-gray-150 text-gray-500 text-[10px] cursor-pointer hover:bg-gray-200 rounded-none transition-colors"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          className="px-4 h-6 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white text-[10px] font-bold cursor-pointer rounded-none transition-colors"
                        >
                          确认添加
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-6">
        {/* Chart Section */}
        <div className="col-span-8 bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold text-gray-800">访问趋势</h3>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-[#48a1a1] rounded-full"></span>
              <span className="text-xs text-gray-500">访问</span>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#999' }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#999' }} 
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#48a1a1" 
                  strokeWidth={2} 
                  dot={{ r: 4, fill: '#48a1a1', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Filter Section */}
        <div className="col-span-4 bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">统计时间</label>
              <select 
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as '7days' | 'custom')}
                className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20 cursor-pointer"
              >
                <option value="7days">近7日</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">开始时间</label>
                <input 
                  type="date" 
                  value={startDate} 
                  disabled={timeRange === '7days'}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-xs disabled:opacity-60 disabled:cursor-not-allowed" 
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">结束时间</label>
                <input 
                  type="date" 
                  value={endDate} 
                  disabled={timeRange === '7days'}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-xs disabled:opacity-60 disabled:cursor-not-allowed" 
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">筛选地区</label>
              <select 
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20 cursor-pointer"
              >
                <option value="all">所有</option>
                <option value="state">州</option>
                <option value="city">城市</option>
              </select>
            </div>
          </div>
          <button className="w-full bg-[#7bc144] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-[#6ab033] transition-colors mt-4">
            查询
          </button>
        </div>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-2 gap-6">
        {/* Card 1: 旗下商家数量 */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col justify-between relative overflow-hidden group">
          <div className="p-6 pb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-gray-500">旗下商家数量</span>
              <button 
                onClick={() => toggleSwitch('旗下商家数量')}
                className="w-8 h-4 rounded-full relative transition-colors duration-200 focus:outline-none"
                style={{ backgroundColor: activeToggles['旗下商家数量'] ? '#48a1a1' : '#e5e7eb' }}
              >
                <span 
                  className={cn(
                    "w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all shadow-sm",
                    activeToggles['旗下商家数量'] ? "right-0.5" : "left-0.5"
                  )} 
                />
              </button>
            </div>
            <div className="text-center py-2">
              <span className="text-3xl font-bold text-gray-950">1093</span>
            </div>
          </div>
          <button className="w-full bg-gray-50/80 hover:bg-[#f0f9f9] text-xs text-gray-500 hover:text-[#48a1a1] transition-all py-2 border-t border-gray-50 font-medium">
            前往
          </button>
        </div>

        {/* Card 2: 用户总数 */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col justify-between relative overflow-hidden group">
          <div className="p-6 pb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-gray-500">用户总数</span>
              <button 
                onClick={() => toggleSwitch('用户总数')}
                className="w-8 h-4 rounded-full relative transition-colors duration-200 focus:outline-none"
                style={{ backgroundColor: activeToggles['用户总数'] ? '#48a1a1' : '#e5e7eb' }}
              >
                <span 
                  className={cn(
                    "w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all shadow-sm",
                    activeToggles['用户总数'] ? "right-0.5" : "left-0.5"
                  )} 
                />
              </button>
            </div>
            <div className="text-center py-2">
              <span className="text-3xl font-bold text-gray-950">2009</span>
            </div>
          </div>
          <button className="w-full bg-gray-50/80 hover:bg-[#f0f9f9] text-xs text-gray-500 hover:text-[#48a1a1] transition-all py-2 border-t border-gray-50 font-medium">
            前往
          </button>
        </div>
      </div>

      {/* Grid Stats */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat, idx) => {
          const isToggledOn = activeToggles[stat.label] !== false;
          return (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
              className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col justify-between relative overflow-hidden group"
            >
              <div className="p-4 pb-3">
                <div className="flex justify-between items-center mb-2 gap-2">
                  <span className="text-[11px] font-semibold text-gray-500 truncate">{stat.label}</span>
                  <button 
                    onClick={() => toggleSwitch(stat.label)}
                    className="w-7 h-3.5 rounded-full relative transition-colors duration-200 focus:outline-none shrink-0"
                    style={{ backgroundColor: isToggledOn ? '#48a1a1' : '#e5e7eb' }}
                  >
                    <span 
                      className={cn(
                        "w-2.5 h-2.5 bg-white rounded-full absolute top-0.5 transition-all shadow-xs",
                        isToggledOn ? "right-0.5" : "left-0.5"
                      )} 
                    />
                  </button>
                </div>
                <div className="text-center py-1">
                  <span className="text-lg font-bold text-gray-950 font-mono">{stat.value}</span>
                </div>
              </div>
              <button className="w-full bg-gray-50/80 hover:bg-[#f0f9f9] text-[10px] text-gray-500 hover:text-[#48a1a1] transition-all py-1.5 border-t border-gray-50 font-medium">
                前往
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
