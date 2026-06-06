import React, { useState } from 'react';
import { Search, Plus, Edit2, Trash2, Calendar, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

// We import/define predefined stores to match the ones in our system
const PRESET_STORES = [
  { id: 3246, shortName: 'ArivaSpa', logo: '🏥', name: 'Ariva Spa', address: '6728 W Coal Mine Ave A110, Littleton, CO 80123, USA' },
  { id: 3221, shortName: 'Roesspa', logo: '💆', name: 'Roes spa', address: '6054 W 159th St, Oak Forest, IL 60452, USA' },
];

interface Coupon {
  id: number;
  type: 'general' | 'merchant';
  name: string;
  amount: number; // e.g., 10
  threshold: number; // e.g., 50
  description: string;
  startDate: string;
  endDate: string;
  status: '正常' | '关闭';
  updateDate: string;
  // Merchant specific
  merchantShortLink?: string;
  merchantName?: string;
}

const initialCoupons: Coupon[] = [
  {
    id: 1001,
    type: 'general',
    name: '新人体验代金券',
    amount: 10,
    threshold: 50,
    description: '新注册用户专享立减券，满50美元可用',
    startDate: '2026-05-01',
    endDate: '2026-12-31',
    status: '正常',
    updateDate: '2026-05-30'
  },
  {
    id: 1002,
    type: 'general',
    name: '端午节专享通用券',
    amount: 15,
    threshold: 80,
    description: '端午佳节全平台通用立减券',
    startDate: '2026-06-15',
    endDate: '2026-06-25',
    status: '正常',
    updateDate: '2026-05-30'
  },
  {
    id: 2001,
    type: 'merchant',
    name: 'Ariva Spa 专属满减券',
    amount: 20,
    threshold: 100,
    description: 'Ariva Spa 门店专属体验券',
    startDate: '2026-05-30',
    endDate: '2026-08-30',
    status: '正常',
    updateDate: '2026-05-30',
    merchantShortLink: 'ArivaSpa',
    merchantName: 'Ariva Spa'
  },
  {
    id: 2002,
    type: 'merchant',
    name: 'Roes Spa 诚意折扣券',
    amount: 30,
    threshold: 150,
    description: 'Roes Spa 首单特别礼遇券',
    startDate: '2026-05-30',
    endDate: '2026-09-30',
    status: '关闭',
    updateDate: '2026-05-29',
    merchantShortLink: 'Roesspa',
    merchantName: 'Roes spa'
  }
];

export default function CouponManagement() {
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons);
  const [activeTab, setActiveTab] = useState<'general' | 'merchant'>('general');
  const [searchText, setSearchText] = useState('');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);

  // Form states
  const [formType, setFormType] = useState<'general' | 'merchant'>('general');
  const [formName, setFormName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formThreshold, setFormThreshold] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formStatus, setFormStatus] = useState<'正常' | '关闭'>('正常');

  // Merchant shortlink states
  const [merchantShortLink, setMerchantShortLink] = useState('');
  const [searchedShortLink, setSearchedShortLink] = useState<string | null>(null);
  const [matchedStore, setMatchedStore] = useState<typeof PRESET_STORES[0] | null>(null);
  const [searchFeedback, setSearchFeedback] = useState<{ status: 'success' | 'not_found' | 'idle', message: string }>({
    status: 'idle',
    message: ''
  });

  // Filters the coupon list
  const filteredCoupons = coupons.filter(item => {
    if (item.type !== activeTab) return false;
    if (searchText.trim() === '') return true;
    return item.name.toLowerCase().includes(searchText.toLowerCase()) || 
           (item.merchantShortLink && item.merchantShortLink.toLowerCase().includes(searchText.toLowerCase())) ||
           (item.merchantName && item.merchantName.toLowerCase().includes(searchText.toLowerCase()));
  });

  // Handle validating / searching for merchant short link
  const handleSearchShortLink = (linkToSearch: string) => {
    const trimmed = linkToSearch.trim();
    if (!trimmed) {
      setSearchFeedback({
        status: 'idle',
        message: '请输入有效短链进行查询'
      });
      setMatchedStore(null);
      setSearchedShortLink(null);
      return;
    }
    
    setSearchedShortLink(trimmed);
    const foundStore = PRESET_STORES.find(
      s => s.shortName.toLowerCase() === trimmed.toLowerCase()
    );

    if (foundStore) {
      setMatchedStore(foundStore);
      setSearchFeedback({
        status: 'success',
        message: `✓ 匹配成功！已成功关联商家: ${foundStore.logo} ${foundStore.name}`
      });
    } else {
      setMatchedStore(null);
      setSearchFeedback({
        status: 'not_found',
        message: `⚠ 未找到该商家短链，提交后系统将以输入的主键进行本地关联`
      });
    }
  };

  const handleOpenAdd = () => {
    setEditingCoupon(null);
    setFormType(activeTab);
    setFormName('');
    setFormAmount('');
    setFormThreshold('');
    setFormDescription('');
    setFormStartDate('');
    setFormEndDate('');
    setFormStatus('正常');
    setMerchantShortLink('');
    setSearchedShortLink(null);
    setMatchedStore(null);
    setSearchFeedback({ status: 'idle', message: '' });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setFormType(coupon.type);
    setFormName(coupon.name);
    setFormAmount(coupon.amount.toString());
    setFormThreshold(coupon.threshold ? coupon.threshold.toString() : '');
    setFormDescription(coupon.description);
    setFormStartDate(coupon.startDate);
    setFormEndDate(coupon.endDate);
    setFormStatus(coupon.status);
    
    if (coupon.type === 'merchant' && coupon.merchantShortLink) {
      setMerchantShortLink(coupon.merchantShortLink);
      setSearchedShortLink(coupon.merchantShortLink);
      const foundStore = PRESET_STORES.find(
        s => s.shortName.toLowerCase() === coupon.merchantShortLink?.toLowerCase()
      );
      if (foundStore) {
        setMatchedStore(foundStore);
        setSearchFeedback({
          status: 'success',
          message: `✓ 匹配成功！已关联商家: ${foundStore.logo} ${foundStore.name}`
        });
      } else {
        setMatchedStore(null);
        setSearchFeedback({
          status: 'success',
          message: `已关联：${coupon.merchantName || coupon.merchantShortLink}`
        });
      }
    } else {
      setMerchantShortLink('');
      setSearchedShortLink(null);
      setMatchedStore(null);
      setSearchFeedback({ status: 'idle', message: '' });
    }
    setIsModalOpen(true);
  };

  const handleDelete = (id: number) => {
    if (window.confirm('确定要删除此优惠券吗？')) {
      setCoupons(prev => prev.filter(c => c.id !== id));
    }
  };

  const handleToggleStatus = (id: number) => {
    setCoupons(prev => prev.map(c => c.id === id ? {
      ...c,
      status: c.status === '正常' ? '关闭' : '正常',
      updateDate: new Date().toISOString().split('T')[0]
    } : c));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName.trim()) {
      alert('请输入优惠券名称');
      return;
    }
    if (!formAmount || isNaN(Number(formAmount))) {
      alert('请输入有效的优惠金额');
      return;
    }

    if (formType === 'merchant') {
      if (!merchantShortLink.trim()) {
        alert('请输入商家短链进行绑定');
        return;
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const thresholdNum = formThreshold === '' || isNaN(Number(formThreshold)) ? 0 : Number(formThreshold);

    if (editingCoupon) {
      // Edit
      setCoupons(prev => prev.map(c => {
        if (c.id === editingCoupon.id) {
          const updated: Coupon = {
            ...c,
            name: formName,
            amount: Number(formAmount),
            threshold: thresholdNum,
            description: formDescription,
            startDate: formStartDate || todayStr,
            endDate: formEndDate || todayStr,
            status: formStatus,
            updateDate: todayStr
          };
          if (formType === 'merchant') {
            updated.merchantShortLink = merchantShortLink.trim();
            updated.merchantName = matchedStore ? matchedStore.name : merchantShortLink.trim();
          }
          return updated;
        }
        return c;
      }));
    } else {
      // Add new
      const nextId = coupons.length > 0 ? Math.max(...coupons.map(c => c.id)) + 1 : 1001;
      const newCoupon: Coupon = {
        id: nextId,
        type: formType,
        name: formName,
        amount: Number(formAmount),
        threshold: thresholdNum,
        description: formDescription,
        startDate: formStartDate || todayStr,
        endDate: formEndDate || todayStr,
        status: formStatus,
        updateDate: todayStr
      };

      if (formType === 'merchant') {
        newCoupon.merchantShortLink = merchantShortLink.trim();
        newCoupon.merchantName = matchedStore ? matchedStore.name : merchantShortLink.trim();
      }

      setCoupons(prev => [newCoupon, ...prev]);
    }

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('general')}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
              activeTab === 'general' ? "bg-[#48a1a1] text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            通用优惠券
          </button>
          <button
            onClick={() => setActiveTab('merchant')}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
              activeTab === 'merchant' ? "bg-[#48a1a1] text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            商家优惠券
          </button>
        </div>
        
        <button 
          onClick={handleOpenAdd}
          className="flex items-center gap-2 bg-[#48a1a1] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#3d8b8b] transition-colors"
        >
          <Plus className="w-4 h-4" />
          新增
        </button>
      </div>

      {/* Filter Box */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-end gap-3">
        <div className="flex-1 max-w-sm">
          <label className="text-xs font-medium text-gray-500 block mb-1.5">券名</label>
          <div className="relative">
            <input 
              type="text" 
              placeholder="请输入券名"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
            />
            {searchText && (
              <button 
                onClick={() => setSearchText('')}
                className="absolute right-10 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-200 text-gray-400 text-xs"
              >
                ✕
              </button>
            )}
            <Search className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
          </div>
        </div>
        <button className="bg-[#48a1a1] text-white p-2.5 rounded-lg hover:bg-[#3d8b8b] transition-colors">
          <Search className="w-4 h-4" />
        </button>
      </div>

      {/* Grid List Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">ID</th>
                <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">卡名</th>
                {activeTab === 'merchant' && (
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600 animate-fade-in">对应商家 / 短链</th>
                )}
                <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">优惠额度</th>
                <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">满额度</th>
                <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">有效时间</th>
                <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">状态</th>
                <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">更新日期</th>
                <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredCoupons.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'merchant' ? 9 : 8} className="px-6 py-12 text-center text-gray-400 text-sm">
                    暂无数据
                  </td>
                </tr>
              ) : (
                filteredCoupons.map((row, idx) => (
                  <motion.tr 
                    key={row.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm text-gray-500 font-mono">{row.id}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                      {row.name}
                      {row.description && (
                        <p className="text-xs text-gray-400 font-normal mt-0.5 max-w-xs truncate">{row.description}</p>
                      )}
                    </td>
                    {activeTab === 'merchant' && (
                      <td className="px-6 py-4 text-sm">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-700 text-xs">
                            {row.merchantName || '自营/特殊商户'}
                          </span>
                          <span className="text-[10px] bg-sky-50 text-sky-600 border border-sky-100 rounded px-1.5 py-0.5 mt-1 self-start font-mono">
                            {row.merchantShortLink || '无'}
                          </span>
                        </div>
                      </td>
                    )}
                    <td className="px-6 py-4 text-sm text-pink-600 font-bold font-mono">
                      ${row.amount}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                      {row.threshold > 0 ? `$${row.threshold}` : '无门槛'}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-gray-400" />
                        <span>{row.startDate} ~ {row.endDate}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded-full",
                          row.status === '正常' ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"
                        )}>
                          {row.status}
                        </span>
                        <button
                          onClick={() => handleToggleStatus(row.id)}
                          className={cn(
                            "w-8 h-4 rounded-full relative transition-colors duration-200 focus:outline-none",
                            row.status === '正常' ? "bg-[#48a1a1]" : "bg-gray-200"
                          )}
                        >
                          <span 
                            className={cn(
                              "w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all shadow-sm",
                              row.status === '正常' ? "right-0.5" : "left-0.5"
                            )} 
                          />
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500 font-mono">{row.updateDate}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <button 
                          onClick={() => handleOpenEdit(row)}
                          className="p-1 px-2.5 text-xs text-[#48a1a1] hover:bg-[#eef8f8] bg-gray-50 border border-gray-100 rounded font-medium transition-colors"
                        >
                          编辑
                        </button>
                        <button 
                          onClick={() => handleDelete(row.id)}
                          className="p-1 px-2.5 text-xs text-red-500 hover:bg-red-50 bg-gray-50 border border-gray-100 rounded font-medium transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info matching general page components */}
        <div className="p-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <div>共 {filteredCoupons.length} 条</div>
          <div className="flex items-center gap-2 bg-gray-50 px-3 py-1 rounded">
             <span>15条/页</span>
          </div>
        </div>
      </div>

      {/* Edit / Add Dialog */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-semibold text-gray-800">
                  {editingCoupon ? '编辑优惠券' : `新增${formType === 'merchant' ? '商家' : '通用'}优惠券`}
                </h3>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
                
                {/* Dynamic Switch or Indicator for Type (only in adding, or display permanently) */}
                {!editingCoupon && (
                  <div className="flex items-center justify-between p-3 bg-sky-50/50 rounded-lg border border-sky-100 text-xs text-sky-700">
                    <span className="font-semibold">优惠券类型:</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormType('general');
                          setSearchFeedback({ status: 'idle', message: '' });
                        }}
                        className={cn(
                          "px-2 py-1 rounded transition-all",
                          formType === 'general' ? "bg-[#48a1a1] text-white shadow" : "bg-white text-gray-600 border border-gray-200"
                        )}
                      >
                        通用优惠券
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFormType('merchant');
                          if (merchantShortLink) handleSearchShortLink(merchantShortLink);
                        }}
                        className={cn(
                          "px-2 py-1 rounded transition-all",
                          formType === 'merchant' ? "bg-[#48a1a1] text-white shadow" : "bg-white text-gray-600 border border-gray-200"
                        )}
                      >
                        商家优惠券
                      </button>
                    </div>
                  </div>
                )}

                {/* CRITICAL FEATURE INPUT: Merchant Short Link ("商家短链") for Merchant Type Coupons */}
                {formType === 'merchant' && (
                  <div className="space-y-2 p-3.5 bg-[#f0f9f9]/60 border border-[#48a1a1]/15 rounded-lg">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                        <span className="text-red-500">*</span> 商家短链 (唯一商家码)
                      </label>
                      
                      {/* Short links suggestion fast clicks */}
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                        <span>常用短链:</span>
                        {PRESET_STORES.map(s => (
                          <button
                            key={s.shortName}
                            type="button"
                            onClick={() => {
                              setMerchantShortLink(s.shortName);
                              handleSearchShortLink(s.shortName);
                            }}
                            className="text-blue-600 hover:underline bg-white border border-gray-100 rounded px-1"
                          >
                            {s.shortName}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input 
                          type="text"
                          value={merchantShortLink}
                          onChange={(e) => {
                            setMerchantShortLink(e.target.value);
                            // Clear state on typing if desired, but we let them search
                          }}
                          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20 font-mono"
                          placeholder="请输入唯一的商家短链，例如: ArivaSpa"
                          required
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSearchShortLink(merchantShortLink)}
                        className="bg-[#48a1a1] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#3d8b8b] transition-colors shadow-xs py-2 shrink-0 flex items-center gap-1"
                      >
                        <Search className="w-3.5 h-3.5" />
                        验证
                      </button>
                    </div>

                    {/* Search Feedback Info Area */}
                    {searchFeedback.status !== 'idle' && (
                      <div className={cn(
                        "text-xs p-2 rounded flex items-start gap-1.5 animate-fade-in",
                        searchFeedback.status === 'success' 
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                          : "bg-amber-50 text-amber-700 border border-amber-100"
                      )}>
                        {searchFeedback.status === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-semibold">{searchFeedback.message}</p>
                          {matchedStore && (
                            <p className="text-[10px] text-emerald-600 mt-0.5">
                              商铺名称: {matchedStore.name} | 详情: {matchedStore.address}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 优惠券名 */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700 block">
                    <span className="text-red-500">*</span> 优惠券名
                  </label>
                  <input 
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="请输入优惠券名称，如：双十一体验代金券"
                    required
                  />
                </div>

                {/* 优惠金额 */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700 block">
                    <span className="text-red-500">*</span> 优惠金额
                  </label>
                  <input 
                    type="number"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20 font-mono"
                    placeholder="请输入优惠立减金额 (美元)"
                    required
                    min="1"
                  />
                </div>

                {/* 满额度 */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700 block">满额度</label>
                  <input 
                    type="number"
                    value={formThreshold}
                    onChange={(e) => setFormThreshold(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20 font-mono"
                    placeholder="请输入满减门槛金额，不填或为0则无门槛"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">为0或空永久立减优惠额度</p>
                </div>

                {/* 说明 */}
                <div className="space-y-1 font-sans">
                  <label className="text-xs font-semibold text-gray-700 block">使用说明</label>
                  <textarea 
                    rows={2.5}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="输入该优惠券的使用限制与相关备注..."
                  />
                </div>

                {/* Dates selection */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-700 block text-gray-600">有效开始时间</label>
                    <input 
                      type="date"
                      value={formStartDate}
                      onChange={(e) => setFormStartDate(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-700 block text-gray-600">有效结束时间</label>
                    <input 
                      type="date"
                      value={formEndDate}
                      onChange={(e) => setFormEndDate(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    />
                  </div>
                </div>

                {/* Status Selection */}
                <div className="space-y-1 pt-1">
                  <label className="text-xs font-semibold text-gray-700 block">状态</label>
                  <div className="flex items-center gap-6 mt-1 text-sm text-gray-700">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="couponStatus"
                        checked={formStatus === '正常'}
                        onChange={() => setFormStatus('正常')}
                        className="text-[#48a1a1] focus:ring-[#48a1a1] cursor-pointer"
                      />
                      <span>正常</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="couponStatus"
                        checked={formStatus === '关闭'}
                        onChange={() => setFormStatus('关闭')}
                        className="text-[#48a1a1] focus:ring-[#48a1a1] cursor-pointer"
                      />
                      <span>关闭</span>
                    </label>
                  </div>
                </div>

              </form>

              {/* Action operations buttons */}
              <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  className="px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white rounded-lg text-sm font-medium transition-colors shadow-xs"
                >
                  提交
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
