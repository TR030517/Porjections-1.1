import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Plus, 
  Edit2, 
  Trash2, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Ticket, 
  Sparkles, 
  Scissors, 
  Layers, 
  Phone,
  UserCheck,
  Lightbulb
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { GiftCard, PurchasedGiftCard } from '../types/giftcard';
import { 
  getGiftCardTemplates, 
  getPurchasedGiftCards, 
  createGiftCardTemplate, 
  updateGiftCardTemplate, 
  deleteGiftCardTemplate, 
  simulatePurchase,
  redeemGiftCardUsage
} from '../api/coupon';

// Preset Stores and their standard services list for project binding selection
const PRESET_STORES = [
  { 
    id: 3246, 
    shortName: 'ArivaSpa', 
    logo: '🏥', 
    name: 'Ariva Spa', 
    address: '6728 W Coal Mine Ave A110, Littleton, CO 80123, USA',
    services: ['60Mins Body Massage', '90Mins Deep Tissue Massage', '30Mins Hot Stone Therapy', 'Aromatherapy Treatment', 'Facial Glow Treatment']
  },
  { 
    id: 3221, 
    shortName: 'Roesspa', 
    logo: '💆', 
    name: 'Roes spa', 
    address: '6054 W 159th St, Oak Forest, IL 60452, USA',
    services: ['60Mins Swedish Massage', '60Mins Aromatherapy', 'Foot Reflexology', 'Back Pain Treatment', 'Hot Stone Chiropractic']
  },
];

// Beautiful high-contrast visual gradient cards for mock image/styling selection
const PRESET_CARD_GRADIENTS = [
  { id: 'gradient-teal', name: 'Tiffany蓝', class: 'bg-gradient-to-br from-teal-400 to-[#48a1a1]' },
  { id: 'gradient-rose', name: '玫瑰金折红', class: 'bg-gradient-to-br from-rose-400 to-pink-600' },
  { id: 'gradient-indigo', name: '极光幽紫', class: 'bg-gradient-to-br from-indigo-500 to-purple-600' },
  { id: 'gradient-amber', name: '琥珀金橙', class: 'bg-gradient-to-br from-amber-400 to-orange-500' },
  { id: 'gradient-emerald', name: '森林深绿', class: 'bg-gradient-to-br from-emerald-400 to-teal-800' },
];

export default function GiftCardManagement() {
  const [activeTab, setActiveTab] = useState<'shop' | 'purchased'>('shop');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Data States
  const [shopCards, setShopCards] = useState<GiftCard[]>([]);
  const [purchasedCards, setPurchasedCards] = useState<PurchasedGiftCard[]>([]);

  // Modals Controller
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<GiftCard | null>(null);
  
  // Simulation Modals for Redemption (核销) and Quick Buy (卡密生成)
  const [redeemCard, setRedeemCard] = useState<PurchasedGiftCard | null>(null);
  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false);
  const [selectedShopCardForBuy, setSelectedShopCardForBuy] = useState<GiftCard | null>(null);
  const [buyPhone, setBuyPhone] = useState('');

  // Form Field States (Shop Gift Card)
  const [formName, setFormName] = useState('');
  const [formShortLink, setFormShortLink] = useState('');
  const [formTotalUsages, setFormTotalUsages] = useState(5);
  const [formValidityDays, setFormValidityDays] = useState(180);
  const [formInventory, setFormInventory] = useState(100);
  const [formIntro, setFormIntro] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPresetGradient, setFormPresetGradient] = useState('bg-gradient-to-br from-teal-400 to-[#48a1a1]');
  const [formUrl, setFormUrl] = useState('');
  const [formBoundServices, setFormBoundServices] = useState<string[]>([]);
  const [formSalesStatus, setFormSalesStatus] = useState<'售卖中' | '已停售'>('售卖中');

  // Short Link Merchant validation states
  const [searchFeedback, setSearchFeedback] = useState<{ status: 'success' | 'not_found' | 'idle', message: string }>({
    status: 'idle',
    message: ''
  });
  const [matchedStore, setMatchedStore] = useState<typeof PRESET_STORES[0] | null>(null);

  // Fetch initial templates and cards
  const loadData = async () => {
    setLoading(true);
    try {
      const templates = await getGiftCardTemplates();
      const purchased = await getPurchasedGiftCards();
      setShopCards(templates);
      setPurchasedCards(purchased);
    } catch (e) {
      console.error('Failed to load gift card system data', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter lists based on tab and searching keywords
  const filteredShopCards = shopCards.filter(card => {
    if (activeTab !== 'shop') return false;
    const kw = searchText.trim().toLowerCase();
    if (!kw) return true;
    return card.templateName.toLowerCase().includes(kw) || 
           card.intro.toLowerCase().includes(kw) || 
           (card.imagePreset && card.imagePreset.toLowerCase().includes(kw));
  });

  const filteredPurchasedCards = purchasedCards.filter(card => {
    if (activeTab !== 'purchased') return false;
    const kw = searchText.trim().toLowerCase();
    if (!kw) return true;
    return card.cardName.toLowerCase().includes(kw) || 
           card.userPhone.toLowerCase().includes(kw) ||
           card.id.toLowerCase().includes(kw);
  });

  // Short Link verifying trigger
  const handleVerifyShortLink = (linkStr: string) => {
    const trimmed = linkStr.trim();
    if (!trimmed) {
      setSearchFeedback({ status: 'idle', message: '请输入有效的商家短链' });
      setMatchedStore(null);
      return;
    }

    const store = PRESET_STORES.find(s => s.shortName.toLowerCase() === trimmed.toLowerCase());
    if (store) {
      setMatchedStore(store);
      setSearchFeedback({
        status: 'success',
        message: `✓ 验证成功！已关联门店：${store.logo} ${store.name}`
      });
    } else {
      setMatchedStore(null);
      setSearchFeedback({
        status: 'not_found',
        message: '⚠ 暂未在系统中找到此直连码。您可以先输入并在本地暂存，或选用 ArivaSpa、Roesspa 获得官方数据支持。'
      });
    }
  };

  // Open creation modal
  const handleOpenAdd = () => {
    setEditingCard(null);
    setFormName('');
    setFormShortLink('');
    setFormTotalUsages(5);
    setFormValidityDays(180);
    setFormInventory(100);
    setFormIntro('');
    setFormDescription('');
    setFormPresetGradient('bg-gradient-to-br from-teal-400 to-[#48a1a1]');
    setFormUrl('');
    setFormBoundServices([]);
    setFormSalesStatus('售卖中');
    setMatchedStore(null);
    setSearchFeedback({ status: 'idle', message: '' });
    setIsModalOpen(true);
  };

  // Open editing modal
  const handleOpenEdit = (card: GiftCard) => {
    setEditingCard(card);
    setFormName(card.templateName);
    // Find store if matching
    const potentialLink = card.cardId.toString().includes('ARIV') ? 'ArivaSpa' : 'Roesspa';
    setFormShortLink(potentialLink);
    setFormTotalUsages(card.totalUsages);
    setFormValidityDays(card.validityDays);
    setFormInventory(card.inventory);
    setFormIntro(card.intro);
    setFormDescription(card.description);
    setFormPresetGradient(card.imagePreset || 'bg-gradient-to-br from-teal-400 to-[#48a1a1]');
    setFormUrl(card.imageUrl || '');
    setFormBoundServices(card.boundServices);
    setFormSalesStatus(card.salesStatus);
    
    // Quick verify status inside editor
    const store = PRESET_STORES.find(s => s.shortName.toLowerCase() === potentialLink.toLowerCase());
    if (store) {
      setMatchedStore(store);
      setSearchFeedback({
        status: 'success',
        message: `✓ 已成功关联官方门店：${store.logo} ${store.name}`
      });
    } else {
      setMatchedStore(null);
      setSearchFeedback({ status: 'idle', message: '' });
    }

    setIsModalOpen(true);
  };

  const handleDeleteCard = async (id: string | number) => {
    if (window.confirm(`确定要删除礼品卡模板 ${id} 吗？`)) {
      await deleteGiftCardTemplate(id);
      loadData();
    }
  };

  // Service checkbox toggle helper
  const handleToggleService = (service: string) => {
    if (formBoundServices.includes(service)) {
      setFormBoundServices(prev => prev.filter(s => s !== service));
    } else {
      setFormBoundServices(prev => [...prev, service]);
    }
  };

  // Submit template creation or editing
  const handleSaveCardTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('请填写礼品卡名称');
      return;
    }

    if (editingCard) {
      const updated: GiftCard = {
        ...editingCard,
        templateName: formName.trim(),
        totalUsages: formTotalUsages,
        validityDays: formValidityDays,
        inventory: formInventory,
        intro: formIntro.trim(),
        description: formDescription.trim(),
        imagePreset: formPresetGradient,
        imageUrl: formUrl.trim(),
        boundServices: formBoundServices,
        salesStatus: formSalesStatus
      };
      await updateGiftCardTemplate(updated);
    } else {
      const temp: Omit<GiftCard, 'cardId'> = {
        templateName: formName.trim(),
        totalUsages: formTotalUsages,
        validityDays: formValidityDays,
        inventory: formInventory,
        intro: formIntro.trim(),
        description: formDescription.trim(),
        imagePreset: formPresetGradient,
        imageUrl: formUrl.trim(),
        boundServices: formBoundServices,
        salesStatus: formSalesStatus
      };
      await createGiftCardTemplate(temp);
    }

    setIsModalOpen(false);
    loadData();
  };

  // Simulate purchasing workflow
  const handleOpenBuySimulator = (card: GiftCard) => {
    setSelectedShopCardForBuy(card);
    setBuyPhone('303-475-4321');
    setIsBuyModalOpen(true);
  };

  const executeSimulatedPurchase = async () => {
    if (!buyPhone.trim()) {
      alert('请输入用户的取券手机号');
      return;
    }
    if (!selectedShopCardForBuy) return;

    try {
      const purchasedItem = await simulatePurchase(selectedShopCardForBuy.cardId, buyPhone);
      setIsBuyModalOpen(false);
      setActiveTab('purchased');
      loadData();
      alert(`🎉 模拟购买成功！\n系统已模拟 Groupon 接口协议为手机号 ${buyPhone} 生成了随机唯一折扣核销卡：\n${purchasedItem.id}\n已自动切换至已购礼品卡列表展示！`);
    } catch (err: any) {
      alert(`错误：${err.message}`);
    }
  };

  // Perform single validation/deduction click on voucher
  const handleDeductOneTime = async () => {
    if (!redeemCard) return;
    try {
      const updated = await redeemGiftCardUsage(redeemCard.id);
      setRedeemCard(updated);
      loadData();
    } catch (err: any) {
      alert(`核销失败: ${err.message}`);
    }
  };

  // Special bottom card handlers
  const handleSimulatePurchase = async (card: GiftCard) => {
    if (window.confirm('是否为当前账号模拟购买该礼品卡？')) {
      setLoading(true);
      try {
        const purchasedItem = await simulatePurchase(card.cardId, '303-475-4321');
        setActiveTab('purchased');
        await loadData();
        alert(`🎉 模拟购买成功！\n系统已模拟 Groupon 接口协议为当前账号生成了唯一的兑换核销卡：\n${purchasedItem.id}\n已自动切换至已购礼品卡列表展示！`);
      } catch (err: any) {
        alert(`购买失败: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleEdit = (card: GiftCard) => {
    handleOpenEdit(card);
  };

  const handleDelete = async (card: GiftCard) => {
    if (window.confirm(`确定要删除礼品卡模板 [${card.templateName}] 吗？`)) {
      try {
        await deleteGiftCardTemplate(card.cardId);
        await loadData();
      } catch (err: any) {
        alert(`删除失败: ${err.message}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Upper header section with Tabs and Add Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center bg-gray-100 p-1 rounded-none">
          <button
            onClick={() => setActiveTab('shop')}
            className={cn(
              "px-4 py-1.5 rounded-none text-sm font-medium transition-all flex items-center gap-1.5 cursor-pointer",
              activeTab === 'shop' ? "bg-[#48a1a1] text-white shadow-sm font-bold" : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            店铺礼品卡模板
          </button>
          <button
            onClick={() => setActiveTab('purchased')}
            className={cn(
              "px-4 py-1.5 rounded-none text-sm font-medium transition-all flex items-center gap-1.5 cursor-pointer",
              activeTab === 'purchased' ? "bg-[#48a1a1] text-white shadow-sm font-bold" : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Ticket className="w-3.5 h-3.5" />
            所有已购买的礼品卡
          </button>
        </div>
        
        {activeTab === 'shop' && (
          <button 
            onClick={handleOpenAdd}
            className="flex items-center gap-2 bg-[#48a1a1] text-white px-4 py-2 rounded-none text-sm font-medium hover:bg-[#3d8b8b] transition-colors cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />
            + 新增礼品卡
          </button>
        )}
      </div>

      {/* Business logic alert box (业务逻辑说明框 - el-alert light theme, with lamp icon) */}
      <div className="bg-[#f0f9f9] border border-[#48a1a1]/20 rounded-none p-4 flex gap-3 text-xs text-[#3d8b8b] leading-relaxed">
        <Lightbulb className="w-5 h-5 text-[#48a1a1] shrink-0 mt-0.5 animate-pulse" />
        <div>
          <span className="font-semibold block text-sm mb-1 text-gray-800">礼品卡核心逻辑介绍：</span>
          每个礼品卡只能由单个店铺制作发行，对应商铺固定的非平台定价表或具体的护理项目（如 60Mins Body Massage）。客户在抢购或购买成功后将获取到唯一的 Groupon 卡券串码，此洗刷码在到店时出示，商家由管理员手机扫码核对该卡并扣除全部使用次数。则可以通过卡片右下角的【模拟购买】来快速演练前台购买与卡串核销。
        </div>
      </div>

      {/* Search Filter input form */}
      <div className="bg-white p-4 rounded-none border border-gray-100 shadow-sm flex items-end gap-3 animate-fade-in">
        <div className="flex-1 max-w-sm">
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">
            {activeTab === 'shop' ? '输入卡名 / 简介关键字检索' : '输入已购卡名 / 手机号 / 券码检索'}
          </label>
          <div className="flex">
            <div className="relative flex-1">
              <input 
                type="text" 
                placeholder="例如：ArivaSpa"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full bg-gray-50 border border-r-0 border-gray-100 rounded-none pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20 font-mono"
              />
              {searchText && (
                <button 
                  onClick={() => setSearchText('')}
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 text-gray-400 text-xs rounded-none"
                >
                  ✕
                </button>
              )}
            </div>
            <button 
              type="button"
              className="bg-[#48a1a1] hover:bg-[#3d8b8b] text-white px-4 py-2 border border-[#48a1a1] rounded-none flex items-center justify-center transition-colors cursor-pointer"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Loader indicator */}
      {loading && (
        <div className="text-center py-12 text-slate-400 text-sm">
          <span className="inline-block animate-spin mr-2">🕒</span> 正在同步后台数据记录...
        </div>
      )}

      {/* RENDER VIEW TAB 1: Shop Gift Card Templates */}
      {!loading && activeTab === 'shop' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredShopCards.length === 0 ? (
            <div className="col-span-2 bg-white rounded-none border border-dashed py-16 text-center text-gray-400 text-sm">
              暂无匹配的项目次卡，点击右上角新增进行自定义配置
            </div>
          ) : (
            filteredShopCards.map((card) => {
              const isAriva = String(card.cardId).includes('ARIV');
              const isRoes = String(card.cardId).includes('ROES');
              const storeAbbr = isAriva ? 'ArivaSpa' : isRoes ? 'Roesspa' : 'Spa';
              const storeNameFull = isAriva ? 'Ariva Spa' : isRoes ? 'Roes spa' : 'Ariva & Roes Spa';
              // background solid pure colors requested, e.g. blue-green or pinkish-crimson
              const solidBgClass = isAriva ? 'bg-[#48a1a1]' : 'bg-pink-600';

              return (
                <motion.div
                  key={card.cardId}
                  layoutId={card.cardId.toString()}
                  className="bg-white rounded-none border border-gray-200 shadow-sm overflow-hidden flex flex-col justify-between"
                >
                  {/* Visual Card Banner Mock */}
                  <div className={cn("p-6 text-white relative", solidBgClass)}>
                    <div className="absolute top-4 right-4 bg-black/25 text-[10px] px-2.5 py-0.5 rounded-none font-bold uppercase tracking-wider font-mono">
                      {card.cardId}
                    </div>
                    
                    <div className="text-[11px] font-bold tracking-wider uppercase text-white/90 mb-1 flex items-center gap-1">
                      {storeNameFull} ({storeAbbr})
                    </div>
                    <h4 className="text-xl font-bold font-sans drop-shadow-sm mb-3 text-white">{card.templateName}</h4>
                    
                    <div className="flex justify-between items-end mt-4">
                      <div className="text-white/90 space-y-1 text-xs">
                        <div className="flex items-center gap-1">
                          <span>可享总服务次数：<span className="font-black text-yellow-200">{card.totalUsages}</span>次</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span>兑换券有效期限：<span className="font-semibold">{card.validityDays}</span>天</span>
                        </div>
                      </div>
                      {/* Visual Stamp resembling Groupon voucher */}
                      <div className="w-14 h-14 rounded-full border border-dashed border-white/60 flex flex-col items-center justify-center text-[8px] uppercase select-none opacity-85 rotate-6">
                        <span className="font-bold">Groupon</span>
                        <span className="text-[7px]">Voucher</span>
                      </div>
                    </div>
                  </div>

                  {/* Card Descriptions / Details Body */}
                  <div className="p-5 flex-1 space-y-4 text-sm text-gray-700">
                    <div>
                      <h5 className="text-xs font-bold text-gray-400 mb-1">礼品卡简介</h5>
                      <p className="text-xs text-gray-600 bg-gray-50 p-2.5 rounded-none leading-relaxed border border-gray-100">{card.intro || '暂无简介'}</p>
                    </div>

                    <div>
                      <h5 className="text-xs font-bold text-gray-400 mb-1">绑定项目明细描述</h5>
                      <p className="text-xs text-gray-600 bg-gray-50/50 p-2.5 rounded-none leading-relaxed border border-gray-150">{card.description || '暂无具体细节描述'}</p>
                    </div>

                    <div>
                      <h5 className="text-xs font-bold text-gray-400 mb-1.5">已绑定价目服务项目 ({card.boundServices.length})</h5>
                      {card.boundServices.length === 0 ? (
                        <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-none">未设定具体的锁定项目</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {card.boundServices.map(srv => (
                            <span key={srv} className="text-[10px] bg-gray-100 text-gray-600 font-medium px-2 py-1 rounded-none border-none">
                              {srv}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-50">
                      <div>
                        <span>单店库存限制：<strong className="text-gray-900 font-mono text-xs">{card.inventory}张</strong></span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>销售状态：</span>
                        <span className={cn(
                          "font-bold px-1.5 py-0.5 rounded-none text-[10px] border-0",
                          card.salesStatus === '售卖中' ? "bg-emerald-100 text-emerald-800" : "bg-gray-150 text-gray-400"
                        )}>
                          {card.salesStatus}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Template Card Operation Row */}
                  <div className="bg-gray-50/50 px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400 rounded-none">
                    <div>
                      <span>更新时间：2026-06-05</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-sans">
                      <button
                        onClick={() => handleSimulatePurchase(card)}
                        type="button"
                        className="bg-transparent border-none text-orange-600 hover:text-orange-700 hover:bg-orange-50/80 px-2.5 py-1 text-xs font-bold rounded-none transition-colors cursor-pointer"
                      >
                        模拟购买礼券
                      </button>
                      <button
                        onClick={() => handleEdit(card)}
                        type="button"
                        className="bg-transparent border-none text-[#48a1a1] hover:text-[#3d8b8b] hover:bg-teal-50/50 px-2.5 py-1 text-xs font-bold rounded-none transition-colors cursor-pointer"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(card)}
                        type="button"
                        className="bg-transparent border-none text-red-500 hover:text-red-600 hover:bg-red-50 px-2.5 py-1 text-xs font-bold rounded-none transition-colors cursor-pointer"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      )}

      {/* RENDER VIEW TAB 2: Purchased Groupon Voucher List */}
      {!loading && activeTab === 'purchased' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">ID (核销券码)</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">卡名</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">对应商家 / 短链</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">有效时间</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">手机号</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">剩余次数</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">状态</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">更新日期</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredPurchasedCards.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-gray-400 text-sm">
                      暂无购买的次卡记录。您可以在项目次卡模板卡片下方点击<b>“模拟购买”</b>，即可快速入数并核发！
                    </td>
                  </tr>
                ) : (
                  filteredPurchasedCards.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 text-xs font-mono font-bold text-[#48a1a1] select-all">
                        {row.id}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                        {row.cardName}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-700 text-xs text-teal-700">
                            Ariva & Roes System
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-gray-400" />
                          <span>止于 {row.validityEndDate}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 font-mono">
                        <div className="flex items-center gap-1">
                          <Phone className="w-3 h-3 text-gray-400" />
                          <span>{row.userPhone}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "text-sm font-bold font-mono px-2 py-0.5 rounded",
                            row.remainingCount === 0 ? "text-gray-400 bg-gray-100" :
                            row.remainingCount === row.totalCount ? "text-emerald-700 bg-emerald-50" :
                            "text-indigo-700 bg-indigo-50"
                          )}>
                            {row.remainingCount}
                          </span>
                          <span className="text-xs text-gray-400">/ {row.totalCount} 次</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded-full",
                          row.status === '正常' ? "bg-emerald-100 text-emerald-800" :
                          row.status === '已用完' ? "bg-gray-100 text-gray-500" :
                          "bg-red-50 text-red-600"
                        )}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 font-mono">{row.updateDate}</td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setRedeemCard(row)}
                            disabled={row.remainingCount === 0}
                            className={cn(
                              "p-1 px-2.5 text-xs font-bold rounded transition-colors border cursor-pointer",
                              row.remainingCount === 0 
                                ? "bg-gray-100 text-gray-400 cursor-not-allowed border-gray-100" 
                                : "bg-[#48a1a1] border-[#48a1a1] hover:bg-[#3d8b8b] text-white"
                            )}
                          >
                            核销使用
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE / EDIT TEMP_CARD DRAWER */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/40 z-50 flex justify-end">
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className="bg-white shadow-2xl w-full max-w-md h-full flex flex-col rounded-none relative overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-[#48a1a1] rounded-none" />
                  <h3 className="text-sm font-semibold text-gray-800">
                    {editingCard ? `编辑礼品卡模板 (${editingCard.cardId})` : '新增店铺礼品卡'}
                  </h3>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 rounded-none text-gray-400 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form Scroll Body */}
              <form onSubmit={handleSaveCardTemplate} className="p-6 space-y-4 overflow-y-auto flex-1 text-sm text-gray-700">
                
                {/* Skin Cover */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-700 block">自定义背景皮肤</label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_CARD_GRADIENTS.map(gra => (
                      <button
                        key={gra.id}
                        type="button"
                        onClick={() => setFormPresetGradient(gra.class)}
                        className={cn(
                          "px-3 py-2 text-xs rounded-none text-white font-medium transition-all relative cursor-pointer",
                          gra.class
                        )}
                      >
                        {gra.name}
                        {formPresetGradient === gra.class && (
                          <span className="absolute -top-1 -right-1 bg-white border border-slate-400 text-slate-800 rounded-none w-4 h-4 flex items-center justify-center text-[8px] font-bold">
                            ✓
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Name */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700 block">
                    <span className="text-red-500">*</span> 礼品卡名称 (卡名称)
                  </label>
                  <input 
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-none px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: ArivaSpa 全身尊贵排毒热石调理卡"
                  />
                </div>

                {/* Shortlink matching */}
                <div className="p-3.5 bg-slate-50 border border-slate-200/60 rounded-none space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-semibold text-gray-700">
                      商家短链 (唯一匹配方式)
                    </label>
                  </div>
                  
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      required
                      value={formShortLink}
                      onChange={(e) => setFormShortLink(e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-none px-3 py-1.5 text-xs font-mono focus:outline-none"
                      placeholder="如：ArivaSpa 或 Roesspa"
                    />
                    <button
                      type="button"
                      onClick={() => handleVerifyShortLink(formShortLink)}
                      className="bg-[#48a1a1] hover:bg-[#3d8b8b] text-white px-3 py-1.5 rounded-none text-xs font-medium shrink-0 flex items-center gap-1 cursor-pointer"
                    >
                      验证拉取
                    </button>
                  </div>

                  {searchFeedback.status !== 'idle' && (
                    <div className={cn(
                      "text-xs p-2 rounded-none flex items-start gap-1.5",
                      searchFeedback.status === 'success' ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    )}>
                      <div>{searchFeedback.message}</div>
                    </div>
                  )}
                </div>

                {/* Multiselect locked items */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 block">绑定具体服务护理项目</label>
                  {matchedStore ? (
                    <div className="border border-gray-100 bg-gray-50/50 p-2.5 rounded-none grid grid-cols-2 gap-2">
                      {matchedStore.services.map(srv => {
                        const isChecked = formBoundServices.includes(srv);
                        return (
                          <label key={srv} className="flex items-center gap-2 bg-white rounded-none p-1.5 border border-slate-100 hover:bg-slate-50 cursor-pointer text-xs">
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleService(srv)}
                              className="text-[#48a1a1] focus:ring-[#48a1a1] cursor-pointer"
                            />
                            <span className="truncate">{srv}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="border border-dashed p-3 rounded-none text-xs text-plat-400 bg-slate-50">
                      请点击上方的【验证拉取】匹配特定系统门店来联动选择。
                    </div>
                  )}

                  <input 
                    type="text" 
                    value={formBoundServices.join(', ')}
                    onChange={(e) => {
                      const items = e.target.value.split(',').map(item => item.trim()).filter(item => item !== '');
                      setFormBoundServices(items);
                    }}
                    className="w-full bg-gray-50 border border-gray-100 rounded-none px-2.5 py-1.5 text-xs mt-1"
                    placeholder="手动附加或编辑锁定的项目名字，以逗号相隔..."
                  />
                </div>

                {/* Math limits */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-700 block mb-1">可享总服务次数</label>
                    <input 
                      type="number"
                      required
                      min="1"
                      value={formTotalUsages}
                      onChange={(e) => setFormTotalUsages(Number(e.target.value))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-none px-3 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-700 block mb-1">有效期限 (天)</label>
                    <input 
                      type="number"
                      required
                      min="1"
                      value={formValidityDays}
                      onChange={(e) => setFormValidityDays(Number(e.target.value))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-none px-3 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-700 block mb-1">单店库存限制</label>
                    <input 
                      type="number"
                      required
                      min="0"
                      value={formInventory}
                      onChange={(e) => setFormInventory(Number(e.target.value))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-none px-3 py-1.5 text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Intro */}
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">次卡简介</label>
                  <textarea 
                    rows={2}
                    value={formIntro}
                    onChange={(e) => setFormIntro(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-none px-3 py-2 text-xs"
                    placeholder="输入销售推介详情、副标题、简介描述..."
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">项目具体明细描述</label>
                  <textarea 
                    rows={3}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-none px-3 py-2 text-xs"
                    placeholder="输入具体的理疗细节及项目时长配置细节..."
                  />
                </div>

                {/* salesStatus Options */}
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">销售状态</label>
                  <div className="flex gap-4 mt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input 
                        type="radio" 
                        name="salesStatus"
                        checked={formSalesStatus === '售卖中'}
                        onChange={() => setFormSalesStatus('售卖中')}
                        className="text-[#48a1a1]"
                      />
                      <span>售卖中</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input 
                        type="radio" 
                        name="salesStatus"
                        checked={formSalesStatus === '已停售'}
                        onChange={() => setFormSalesStatus('已停售')}
                        className="text-[#48a1a1]"
                      />
                      <span>已停售</span>
                    </label>
                  </div>
                </div>

              </form>

              {/* Action buttons */}
              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border rounded-none text-xs text-gray-500 bg-white hover:bg-gray-100 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveCardTemplate}
                  className="px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white rounded-none text-xs font-semibold transition-colors"
                >
                  确认生效并同步
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: BUY SIMULATOR */}
      <AnimatePresence>
        {isBuyModalOpen && selectedShopCardForBuy && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-none shadow-xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 space-y-4 text-sm text-gray-700">
                <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                  <h3 className="font-bold text-gray-900 flex items-center gap-1 text-sm">
                    <Sparkles className="text-yellow-500 w-5 h-5" />
                    模拟渠道卡券购买下单
                  </h3>
                  <button onClick={() => setIsBuyModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-slate-50 p-4 rounded-none space-y-2 text-xs">
                  <p className="text-slate-500">正在购买：</p>
                  <p className="font-bold text-slate-800 text-sm">{selectedShopCardForBuy.templateName}</p>
                  <p className="text-[#48a1a1] font-semibold">
                    总次数权益：{selectedShopCardForBuy.totalUsages} 次服务
                  </p>
                  <p className="text-gray-500 font-mono">
                    ID：{selectedShopCardForBuy.cardId}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 block">买家手机号码</label>
                  <input 
                    type="text"
                    value={buyPhone}
                    onChange={(e) => setBuyPhone(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-none px-3 py-2 text-sm font-mono focus:outline-none"
                    placeholder="请输入购买用户的手机号码"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setIsBuyModalOpen(false)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-xs rounded-none font-medium"
                  >
                    取消
                  </button>
                  <button
                    onClick={executeSimulatedPurchase}
                    className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-none"
                  >
                    确认模拟购买
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: REDEEM VERIFICATION */}
      <AnimatePresence>
        {redeemCard && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="bg-white rounded-none shadow-xl w-full max-w-lg overflow-hidden border border-gray-100"
            >
              <div className="bg-gradient-to-r from-[#4d9c9c] to-[#367a7a] p-6 text-white relative">
                <div className="absolute top-4 right-4 bg-white/20 backdrop-blur-md px-3 py-1 rounded-none text-[10px] font-mono tracking-wider">
                  GROUPON TICKET
                </div>
                <h4 className="text-lg font-bold">{redeemCard.cardName}</h4>
                <p className="text-xs text-white/90 mt-1 font-mono">券号：{redeemCard.id}</p>
              </div>

              <div className="p-6 space-y-5 text-sm text-gray-700">
                <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-none border border-gray-100 text-xs text-slate-600">
                  <div>
                    <span className="text-[10px] text-gray-400 block font-semibold">买家手机号码：</span>
                    <span className="font-mono font-bold text-gray-900"> {redeemCard.userPhone}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 block font-semibold">截止截止日期：</span>
                    <span> {redeemCard.validityEndDate} 之前</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider block">包含或绑定的专享具体服务护理：</h5>
                  <div className="bg-[#f0f9f9] border border-[#48a1a1]/20 rounded-none p-3.5 space-y-1">
                    <p className="text-xs text-slate-800 font-semibold flex items-center gap-1">
                      <Scissors className="w-3.5 h-3.5 text-[#48a1a1]" />
                      <span>对应享受项目：</span>
                    </p>
                    <p className="text-xs text-slate-600 leading-relaxed font-sans mt-0.5">
                      {shopCards.find(sc => sc.templateName === redeemCard.cardName)?.boundServices.join(', ') || 
                       "60Mins Body Massage 护理, 30Mins Hot Stone Therapy 尊贵套餐项目"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-none">
                  <div>
                    <span className="text-[10px] text-gray-400 block font-medium">卡内权益当前余额</span>
                    <span className="text-2xl font-black text-[#48a1a1] font-mono">
                      {redeemCard.remainingCount} <span className="text-xs text-gray-400 font-normal">次</span>
                    </span>
                  </div>
                  
                  {redeemCard.remainingCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleDeductOneTime}
                      className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-none text-xs font-bold transition-transform flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <UserCheck className="w-4 h-4" />
                      扫码扣减 1 次并核销
                    </button>
                  ) : (
                    <span className="bg-gray-100 text-gray-400 text-xs px-4 py-2 rounded-none font-semibold">
                      已兑换完毕
                    </span>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setRedeemCard(null)}
                  className="px-4 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white text-xs rounded-none font-bold cursor-pointer"
                >
                  关闭窗口
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
