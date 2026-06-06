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
  Lightbulb,
  ShieldAlert,
  Tag,
  Building,
  Store,
  Hourglass,
  Package
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

// Beautiful high-contrast visual preset gradients/colors
const PRESET_CARD_GRADIENTS = [
  { id: 'gradient-teal', name: 'Tiffany蓝-深孔雀绿', class: 'bg-gradient-to-br from-[#4dbab0] to-[#2a7b7a]' },
  { id: 'gradient-rose', name: '极简金沙-古典绛红', class: 'bg-gradient-to-br from-[#f43f5e] to-[#9f1239]' },
  { id: 'gradient-indigo', name: '极光幽紫-暗夜靛蓝', class: 'bg-gradient-to-br from-[#6366f1] to-[#31108f]' },
  { id: 'gradient-amber', name: '日落暖橙-焦糖咖棕', class: 'bg-gradient-to-br from-[#f59e0b] to-[#7c2d12]' },
  { id: 'gradient-emerald', name: '森林深绿-常春藤绿', class: 'bg-gradient-to-br from-[#10b981] to-[#064e3b]' },
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
  
  // Simulation Modals for Redemption and Buy
  const [redeemCard, setRedeemCard] = useState<PurchasedGiftCard | null>(null);
  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false);
  const [selectedShopCardForBuy, setSelectedShopCardForBuy] = useState<GiftCard | null>(null);
  const [buyPhone, setBuyPhone] = useState('');

  // Form Field States (Shop Gift Card/Multi-session template)
  const [formName, setFormName] = useState('');
  const [formShortLink, setFormShortLink] = useState('ArivaSpa');
  const [formTotalUsages, setFormTotalUsages] = useState(5);
  const [formValidityDays, setFormValidityDays] = useState(180);
  const [formInventory, setFormInventory] = useState(100);
  const [formIntro, setFormIntro] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPresetGradient, setFormPresetGradient] = useState('bg-gradient-to-br from-[#4dbab0] to-[#2a7b7a]');
  const [formBoundServices, setFormBoundServices] = useState<string[]>(['60Mins Body Massage']);
  const [formSalesStatus, setFormSalesStatus] = useState<'售卖中' | '已停售'>('售卖中');

  // Short Link validation inside forms
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
      console.error('Failed to load coupon/card system data', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Auto preset feedback for first load or search matching ArivaSpa
    const initialStore = PRESET_STORES.find(s => s.shortName.toLowerCase() === 'arivaspa');
    if (initialStore) {
      setMatchedStore(initialStore);
      setSearchFeedback({
        status: 'success',
        message: '✓ 系统预设：已匹配官方直营旗舰店 Ariva Spa'
      });
    }
  }, []);

  // Filter based on query and tab
  const filteredShopCards = shopCards.filter(card => {
    if (activeTab !== 'shop') return false;
    const kw = searchText.trim().toLowerCase();
    if (!kw) return true;
    return card.templateName.toLowerCase().includes(kw) || 
           card.intro.toLowerCase().includes(kw) ||
           card.boundServices.some(s => s.toLowerCase().includes(kw));
  });

  const filteredPurchasedCards = purchasedCards.filter(card => {
    if (activeTab !== 'purchased') return false;
    const kw = searchText.trim().toLowerCase();
    if (!kw) return true;
    return card.cardName.toLowerCase().includes(kw) || 
           card.userPhone.toLowerCase().includes(kw) ||
           card.id.toLowerCase().includes(kw);
  });

  // Short link verification trigger
  const handleVerifyShortLink = (linkStr: string) => {
    const trimmed = linkStr.trim();
    if (!trimmed) {
      setSearchFeedback({ status: 'idle', message: '请输入有效的门店短链直连码' });
      setMatchedStore(null);
      return;
    }

    const store = PRESET_STORES.find(s => s.shortName.toLowerCase() === trimmed.toLowerCase());
    if (store) {
      setMatchedStore(store);
      // Auto populate services list bound if currently empty
      if (formBoundServices.length === 0) {
        setFormBoundServices([store.services[0]]);
      }
      setSearchFeedback({
        status: 'success',
        message: `✓ 验证成功！已直接绑定关联至特定实体门店：${store.logo} ${store.name}`
      });
    } else {
      setMatchedStore(null);
      setSearchFeedback({
        status: 'not_found',
        message: '⚠ 暂时无此直营店直连码。您可以先存放在本地，或建议使用 [ArivaSpa] 或 [Roesspa]'
      });
    }
  };

  // Open template creation
  const handleOpenAdd = () => {
    setEditingCard(null);
    setFormName('');
    setFormShortLink('ArivaSpa');
    setFormTotalUsages(5);
    setFormValidityDays(180);
    setFormInventory(100);
    setFormIntro('');
    setFormDescription('');
    setFormPresetGradient('bg-gradient-to-br from-[#4dbab0] to-[#2a7b7a]');
    setFormBoundServices(['60Mins Body Massage']);
    setFormSalesStatus('售卖中');
    
    const initialStore = PRESET_STORES.find(s => s.shortName.toLowerCase() === 'arivaspa');
    if (initialStore) {
      setMatchedStore(initialStore);
      setSearchFeedback({
        status: 'success',
        message: '✓ 系统预设：已匹配官方直营旗舰店 Ariva Spa'
      });
    } else {
      setMatchedStore(null);
      setSearchFeedback({ status: 'idle', message: '' });
    }
    setIsModalOpen(true);
  };

  // Open template edit
  const handleOpenEdit = (card: GiftCard) => {
    setEditingCard(card);
    setFormName(card.templateName);
    
    // Attempt parsing shortLink based on cardId or predefined
    const potentialLink = String(card.cardId).includes('ARIV') ? 'ArivaSpa' : 'Roesspa';
    setFormShortLink(potentialLink);
    setFormTotalUsages(card.totalUsages);
    setFormValidityDays(card.validityDays);
    setFormInventory(card.inventory);
    setFormIntro(card.intro);
    setFormDescription(card.description);
    setFormPresetGradient(card.imagePreset || 'bg-gradient-to-br from-[#4dbab0] to-[#2a7b7a]');
    setFormBoundServices(card.boundServices);
    setFormSalesStatus(card.salesStatus);
    
    const store = PRESET_STORES.find(s => s.shortName.toLowerCase() === potentialLink.toLowerCase());
    if (store) {
      setMatchedStore(store);
      setSearchFeedback({
        status: 'success',
        message: `✓ 已成功载入并绑定直营门店配置：${store.logo} ${store.name}`
      });
    } else {
      setMatchedStore(null);
      setSearchFeedback({ status: 'idle', message: '' });
    }

    setIsModalOpen(true);
  };

  // Service checkbox toggle helper
  const handleToggleService = (service: string) => {
    if (formBoundServices.includes(service)) {
      setFormBoundServices(prev => prev.filter(s => s !== service));
    } else {
      setFormBoundServices(prev => [...prev, service]);
    }
  };

  // Save current template
  const handleSaveCardTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('请先设定项目次卡/团购券名称');
      return;
    }
    if (formBoundServices.length === 0) {
      alert('请至少绑定一个具体的消费及护理项目名称');
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
        boundServices: formBoundServices,
        salesStatus: formSalesStatus
      };
      await createGiftCardTemplate(temp);
    }

    setIsModalOpen(false);
    loadData();
  };

  const handleDeleteCard = async (card: GiftCard) => {
    if (window.confirm(`确定要彻底删除该项目次卡模版 [${card.templateName}] 吗？删除后前台可能无法继续上架该券。`)) {
      try {
        await deleteGiftCardTemplate(card.cardId);
        loadData();
      } catch (err: any) {
        alert(`删除失败: ${err.message}`);
      }
    }
  };

  // Simulating instant buy matching Groupon protocols
  const handleOpenBuySimulator = (card: GiftCard) => {
    setSelectedShopCardForBuy(card);
    setBuyPhone('138-0013-8000');
    setIsBuyModalOpen(true);
  };

  const executeSimulatedPurchase = async () => {
    if (!buyPhone.trim()) {
      alert('请输入用户的取券提领手机号码');
      return;
    }
    if (!selectedShopCardForBuy) return;

    try {
      setLoading(true);
      const purchasedItem = await simulatePurchase(selectedShopCardForBuy.cardId, buyPhone);
      setIsBuyModalOpen(false);
      setActiveTab('purchased');
      await loadData();
      alert(`🎉 购买渠道模拟核发成功！\n系统极速响应并生成了该买家手机 [${buyPhone}] 兑领的 Groupon 折扣多项目核销券码：\n${purchasedItem.id}\n已自动帮您跳转至已购券/码核销列表查看。`);
    } catch (err: any) {
      alert(`购买核发失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Action: Redeem check
  const handleDeductOneTime = async () => {
    if (!redeemCard) return;
    try {
      const updated = await redeemGiftCardUsage(redeemCard.id);
      setRedeemCard(updated);
      setSelectedShopCardForBuy(null);
      await loadData();
      alert('📌 成功核销扣减 1 次该理疗项目权益！对应服务明细已在后台录单。');
    } catch (err: any) {
      alert(`核销失败: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upper header section with Tabs and Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex bg-slate-100 p-1 border border-slate-200 rounded-none">
          <button
            onClick={() => setActiveTab('shop')}
            className={cn(
              "px-5 py-2 rounded-none text-xs font-bold transition-all flex items-center gap-2 cursor-pointer uppercase tracking-wider",
              activeTab === 'shop' ? "bg-slate-900 text-white shadow-xs font-black" : "text-gray-500 hover:text-slate-800"
            )}
            id="tab-shop-templates"
          >
            <Layers className="w-3.5 h-3.5" />
            次卡与团购项目模版 (配置端)
          </button>
          <button
            onClick={() => setActiveTab('purchased')}
            className={cn(
              "px-5 py-2 rounded-none text-xs font-bold transition-all flex items-center gap-2 cursor-pointer uppercase tracking-wider",
              activeTab === 'purchased' ? "bg-slate-900 text-white shadow-xs font-black" : "text-gray-500 hover:text-slate-800"
            )}
            id="tab-purchased-records"
          >
            <Ticket className="w-3.5 h-3.5" />
            所有已售核销券码 (核销端)
          </button>
        </div>
        
        {activeTab === 'shop' && (
          <button 
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white px-5 py-2.5 rounded-none text-xs font-bold transition-colors cursor-pointer border border-[#48a1a1] uppercase tracking-wider active:scale-[0.99]"
            id="btn-add-ticket-template"
          >
            <Plus className="w-4 h-4 shrink-0" />
            录入全新直营项目次卡券
          </button>
        )}
      </div>

      {/* Business logic alert box (业务逻辑说明框) */}
      <div className="bg-[#f0f9f9] border border-[#48a1a1]/25 rounded-none p-4 flex gap-3 text-xs text-[#3d8b8b] leading-relaxed relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-[#48a1a1]/5 rounded-full translate-x-8 -translate-y-8 select-none pointer-events-none" />
        <Lightbulb className="w-5 h-5 text-[#48a1a1] shrink-0 mt-0.5 animate-pulse" />
        <div className="space-y-1">
          <span className="font-bold block text-sm text-slate-800">项目次卡/团购多服务券核心架构与规则：</span>
          <p className="text-gray-600">
            为了满足大健康直营连锁店的管理要求，系统<b>彻底弃用任何储值卡/预付充值等理财风险理疗概念</b>。全平台统一采用<b>『服务次数型次卡』</b>。每一个模板由所属直营门店制作发行，绑定精准的一项或多项特色物理服务（如: 60Mins Body Massage 尊享疗程），一客一码一手机绑定，到店后出示由前台执行消费扣次，无信托风险。
          </p>
        </div>
      </div>

      {/* Search Filter Container with exact rounded-none */}
      <div className="bg-white p-4 rounded-none border border-slate-200 flex flex-col md:flex-row items-stretch md:items-end gap-3 shadow-none">
        <div className="flex-1 max-w-md">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
            {activeTab === 'shop' ? '输入要检索的项目券名或绑定服务护理内容' : '检索卡密码 / 已购券名 / 用户绑定的手机号'}
          </label>
          <div className="flex">
            <div className="relative flex-1">
              <input 
                type="text" 
                placeholder={activeTab === 'shop' ? "例如: 经典理疗、Massage..." : "例如: GP- 或 手机号码检配..."}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-none pl-3.5 pr-10 py-2 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#48a1a1] font-mono text-gray-800"
                id="search-input-field"
              />
              {searchText && (
                <button 
                  onClick={() => setSearchText('')}
                  type="button"
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs hover:text-slate-700 cursor-pointer p-1"
                >
                  ✕
                </button>
              )}
            </div>
            <button 
              type="button"
              className="bg-slate-900 border border-slate-900 hover:bg-slate-800 text-white px-5 py-2 rounded-none flex items-center justify-center transition-colors cursor-pointer"
              id="search-trigger-btn"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Synchronizing State Holder */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-500 text-xs font-mono tracking-widest uppercase">
          <span className="inline-block animate-spin mr-3 text-[#48a1a1]">⏳</span>
          正在同步云端沙盒次卡核心存储器...
        </div>
      )}

      {/* RENDER VIEW TAB 1: Shop Gift Card Templates (GRID CART LAYOUT WITH rounded-none) */}
      {!loading && activeTab === 'shop' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in" id="coupon-templates-grid">
          {filteredShopCards.length === 0 ? (
            <div className="col-span-full bg-white rounded-none border border-dashed border-slate-300 py-16 text-center text-slate-400 text-xs font-medium uppercase tracking-wider">
              没有找到匹配任何设定的项目次卡模版。您可以点击右上角快速录入配置。
            </div>
          ) : (
            filteredShopCards.map((card) => {
              const isAriva = String(card.cardId).includes('ARIV') || String(card.templateName).includes('Ariva');
              const isRoes = String(card.cardId).includes('ROES') || String(card.templateName).includes('Roes');
              const storeAbbr = isAriva ? 'ArivaSpa' : isRoes ? 'Roesspa' : 'Spa-Central';
              const storeNameFull = isAriva ? 'Ariva Spa' : isRoes ? 'Roes spa' : 'Ariva & Roes Spa';
              
              // Find matching or fallback preset color based on setting
              const gradientSelectedClass = card.imagePreset || 'bg-gradient-to-br from-[#4dbab0] to-[#2a7b7a]';

              return (
                <div
                  key={card.cardId}
                  className="bg-white rounded-none border border-slate-200/90 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow relative"
                  style={{ borderWidth: '1px' }}
                  id={`card-${card.cardId}`}
                >
                  {/* UPPER HALF: Colored Ticket Face (彩色票面) */}
                  <div className={cn("p-5 text-white relative flex flex-col justify-between h-44 rounded-none", gradientSelectedClass)}>
                    {/* Semi-transparent pattern decorates */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white/10 to-transparent pointer-events-none" />
                    
                    {/* Top Row: Store Name & ID */}
                    <div className="flex items-center justify-between z-10">
                      <div className="flex items-center gap-1.5">
                        <Store className="w-3.5 h-3.5 text-white/90" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/95">
                          {storeNameFull}
                        </span>
                      </div>
                      <span className="bg-white/20 px-2 py-0.5 text-[9px] font-mono tracking-wider">
                        {card.cardId}
                      </span>
                    </div>

                    {/* Middle Row: Thick Bold Card Name */}
                    <div className="my-auto z-10 pr-10">
                      <h4 className="text-lg font-black tracking-tight leading-snug text-white inline-block drop-shadow-xs line-clamp-2">
                        {card.templateName}
                      </h4>
                    </div>

                    {/* Bottom Row: Specs & Dashed circle stamp */}
                    <div className="flex items-end justify-between z-10">
                      <div className="space-y-0.5 text-[11px] font-medium text-white/90">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-yellow-300" />
                          <span>可享受原厂护理次数：<strong className="text-yellow-300 font-bold text-xs">{card.totalUsages}次</strong></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-white/80" />
                          <span>凭券核发核销有效天数：<strong>{card.validityDays}天</strong></span>
                        </div>
                      </div>

                      {/* Stylized physical circle dashed stamp in right-bottom (带有虚线圈的标识) */}
                      <div className="absolute right-3.5 bottom-3.5 w-16 h-16 rounded-full border-2 border-dashed border-white/40 flex flex-col items-center justify-center select-none rotate-12 bg-white/5 backdrop-blur-3xs">
                        <span className="text-[7px] font-black tracking-widest text-white/50 uppercase">GROUPON</span>
                        <span className="text-[8px] font-bold text-white/80 tracking-tight">VOUCHER</span>
                        <span className="text-[6px] font-mono text-white/40">★ VALID ★</span>
                      </div>
                    </div>
                  </div>

                  {/* LOWER HALF: White details area (白色详情区) */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4 bg-white rounded-none">
                    <div className="space-y-3">
                      {/* Short Description */}
                      {card.intro && (
                        <div>
                          <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider mb-1">
                            卡项官方推广导言
                          </span>
                          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 p-2 rounded-none font-sans leading-relaxed">
                            {card.intro}
                          </p>
                        </div>
                      )}

                      {/* Bound treatments list explicitly */}
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider mb-1.5">
                          绑定的实体店物理治疗项目明细
                        </span>
                        {card.boundServices.length === 0 ? (
                          <div className="text-xs text-slate-400 italic">暂无绑定具体护理项</div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {card.boundServices.map(srv => (
                              <span 
                                key={srv} 
                                className="text-[10px] bg-slate-100 text-slate-700 font-mono font-semibold border border-slate-200/60 px-2 py-0.5 rounded-none flex items-center gap-1"
                              >
                                <Scissors className="w-2.5 h-2.5 text-[#48a1a1] shrink-0" />
                                {srv}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Technical Specs: stock & status */}
                      <div className="grid grid-cols-2 gap-2 pt-1.5 text-xs text-slate-500 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>
                            库存余量: <strong className="text-slate-800 font-mono">{card.inventory} 张</strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-slate-400 text-[11px]">销售：</span>
                          <span className={cn(
                            "px-2 py-0.5 text-[9px] font-bold tracking-wider rounded-none uppercase",
                            card.salesStatus === '售卖中' ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-slate-100 border border-slate-200 text-slate-400"
                          )}>
                            {card.salesStatus}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Footer Row: Operations bar */}
                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(card)}
                          className="bg-transparent border border-transparent text-slate-500 hover:text-[#48a1a1] hover:border-slate-200 p-1.5 rounded-none text-xs font-bold font-sans cursor-pointer flex items-center gap-1 transition-colors"
                          title="编辑该多项次套卡参数"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>修改</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCard(card)}
                          className="bg-transparent border border-transparent text-slate-500 hover:text-rose-600 hover:border-slate-200 p-1.5 rounded-none text-xs font-bold font-sans cursor-pointer flex items-center gap-1 transition-colors"
                          title="从系统库永久移除此券"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>删除</span>
                        </button>
                      </div>

                      {/* Orange Rectangular "模拟购买" Button (在白色详情区右下角，提供一个橙色的『模拟购买』直角按钮) */}
                      <button
                        onClick={() => handleOpenBuySimulator(card)}
                        type="button"
                        className="bg-[#f97316] hover:bg-[#ea580c] active:scale-[0.98] text-white px-4 py-2 text-xs font-bold tracking-wider rounded-none border border-transparent cursor-pointer flex items-center gap-1.5 shadow-xs transition-colors"
                        id={`btn-buy-sim-${card.cardId}`}
                      >
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        <span>模拟购买</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* RENDER VIEW TAB 2: Purchased Groupon Voucher List (核销记录) */}
      {!loading && activeTab === 'purchased' && (
        <div className="bg-white border border-slate-200 rounded-none overflow-hidden animate-fade-in" id="purchased-records-table-container">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 tracking-wider flex items-center gap-1.5 uppercase">
              <Ticket className="w-4 h-4 text-[#48a1a1]" />
              已生成的 Groupon / 渠道引流项目消费次卡实名列表
            </span>
            <span className="text-[10px] font-mono text-slate-400">TOTAL: {filteredPurchasedCards.length} CODES</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/50 text-slate-600 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="px-5 py-3.5 font-mono">核销串码 (Unique Coupon ID)</th>
                  <th className="px-5 py-3.5">引流次卡名称</th>
                  <th className="px-5 py-3.5">买家实名绑定手机</th>
                  <th className="px-5 py-3.5">可用余额次数</th>
                  <th className="px-5 py-3.5">最后截止期限</th>
                  <th className="px-5 py-3.5">服务当前状态</th>
                  <th className="px-5 py-3.5 text-right">核销联动管理</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {filteredPurchasedCards.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-slate-400 text-xs italic">
                      暂无购买扣减记录。请前往第一个标签页，点击各个项目次卡底部的橙色【模拟购买】来自动录入激活该买家券串。
                    </td>
                  </tr>
                ) : (
                  filteredPurchasedCards.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5 font-mono font-bold text-[#48a1a1] uppercase select-all tracking-wider text-xs">
                        {row.id}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-slate-900">
                        {row.cardName}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{row.userPhone}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2.5 py-0.5 font-mono font-bold text-xs rounded-none border",
                            row.remainingCount === 0 
                              ? "bg-slate-50 text-slate-400 border-slate-200" 
                              : "bg-emerald-50 text-emerald-850 border-emerald-200"
                          )}>
                            {row.remainingCount} 次
                          </span>
                          <span className="text-[10px] text-slate-400">/ 满 {row.totalCount}次</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 font-mono">
                        {row.validityEndDate} 止
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          "px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-none border",
                          row.status === '正常' 
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                            : "bg-slate-100 text-slate-400 border-slate-200"
                        )}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setRedeemCard(row)}
                          disabled={row.remainingCount === 0}
                          type="button"
                          className={cn(
                            "px-3 py-1.5 text-xs font-bold rounded-none uppercase tracking-wider border cursor-pointer active:scale-95 transition-all",
                            row.remainingCount === 0 
                              ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed" 
                              : "bg-[#48a1a1] hover:bg-[#3d8b8b] text-white border-[#48a1a1]"
                          )}
                          id={`btn-verify-redeem-${row.id}`}
                        >
                          核销使用 / 扫码扣减
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE / EDIT TEMP_CARD DRAWER (RIGHT PANEL WITH rounded-none) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 z-50 flex justify-end backdrop-blur-3xs" id="template-modal-backdrop">
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              className="bg-white border-l border-slate-200 w-full max-w-lg h-full flex flex-col rounded-none relative overflow-hidden"
              id="template-modal-container"
            >
              {// Modal Header
              }
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-4 bg-[#48a1a1] rounded-none" />
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-widest">
                    {editingCard ? `编辑项目次卡配置档案 (${editingCard.cardId})` : '录入全新直营项目次卡券'}
                  </span>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-800 transition-colors cursor-pointer"
                  id="btn-close-template-drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {// Form Body scrollables
              }
              <form onSubmit={handleSaveCardTemplate} className="p-6 space-y-5 overflow-y-auto flex-1 text-xs text-slate-700">
                
                {/* Visual Cover selector with rounded-none */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">选择票面背景视觉主题</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {PRESET_CARD_GRADIENTS.map(gra => {
                      const isSelected = formPresetGradient === gra.class;
                      return (
                        <button
                          key={gra.id}
                          type="button"
                          onClick={() => setFormPresetGradient(gra.class)}
                          className={cn(
                            "p-2 text-[10px] rounded-none text-white font-mono font-bold transition-all relative border cursor-pointer leading-tight h-14 text-left flex flex-col justify-between",
                            gra.class,
                            isSelected ? "border-slate-850 ring-2 ring-slate-800" : "border-transparent"
                          )}
                        >
                          <span className="w-full text-right text-[8px] opacity-70">★</span>
                          <span className="truncate w-full">{gra.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Name */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    <span className="text-rose-500 font-bold">*</span> 次卡/套票名称
                  </label>
                  <input 
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-none px-3 py-2 text-xs text-slate-800 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#48a1a1]"
                    placeholder="如: ArivaSpa 全身平衡解压舒缓3次尊享卡"
                    id="input-card-name"
                  />
                </div>

                {/* Shortlink matching selector */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-none space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                      <span className="text-rose-500 font-bold">*</span> 连锁门店匹配直连短码
                    </label>
                  </div>
                  
                  <div className="flex gap-2">
                    <select
                      value={formShortLink}
                      onChange={(e) => setFormShortLink(e.target.value)}
                      className="flex-1 bg-white border border-slate-200 rounded-none px-3.5 py-1.5 text-xs text-slate-800 focus:outline-none"
                      id="select-matched-store-shortlink"
                    >
                      <option value="ArivaSpa">ArivaSpa (官方授权旗舰店)</option>
                      <option value="Roesspa">Roesspa (中西部金牌旗舰店)</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleVerifyShortLink(formShortLink)}
                      className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-1.5 rounded-none text-xs font-bold uppercase tracking-wider cursor-pointer"
                      id="btn-trigger-fetch"
                    >
                      验证直连
                    </button>
                  </div>

                  {searchFeedback.status !== 'idle' && (
                    <div className={cn(
                      "text-[11px] p-2.5 rounded-none flex items-start gap-1.5 font-bold leading-normal border",
                      searchFeedback.status === 'success' ? "bg-emerald-50 border-emerald-200 text-emerald-850" : "bg-amber-50 border-amber-200 text-amber-800"
                    )}>
                      <div>{searchFeedback.message}</div>
                    </div>
                  )}
                </div>

                {/* Bound services check box */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    <span className="text-rose-500 font-bold">*</span> 锁定或包含的护理项目详情
                  </label>
                  {matchedStore ? (
                    <div className="border border-slate-200 bg-slate-50/50 p-2.5 rounded-none grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {matchedStore.services.map(srv => {
                        const isChecked = formBoundServices.includes(srv);
                        return (
                          <label 
                            key={srv} 
                            className={cn(
                              "flex items-center gap-2 rounded-none p-2 border cursor-pointer text-xs transition-colors",
                              isChecked ? "bg-[#eef8f8] border-[#48a1a1] font-bold text-[#2a7b7a]" : "bg-white border-slate-100 hover:bg-slate-50 text-slate-600"
                            )}
                          >
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleService(srv)}
                              className="text-[#48a1a1] focus:ring-0 rounded-none cursor-pointer"
                            />
                            <span className="truncate">{srv}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="border border-dashed border-slate-300 p-4 rounded-none text-xs text-slate-400 bg-slate-50">
                      请先选择并点击上方的 “验证直连” 来联动读取该连锁店的官方治疗配制模板。
                    </div>
                  )}

                  <div className="space-y-1 mt-2">
                    <span className="text-[10px] text-slate-400 block">手动核对或自定义绑定的护理服务（用英文逗号相隔）：</span>
                    <input 
                      type="text" 
                      value={formBoundServices.join(', ')}
                      onChange={(e) => {
                        const items = e.target.value.split(',').map(item => item.trim()).filter(item => item !== '');
                        setFormBoundServices(items);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-none px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:bg-white"
                      placeholder="例如: 60Mins Body Massage, 30Mins Hot Stone Therapy"
                      id="input-services-manual"
                    />
                  </div>
                </div>

                {/* Math configurations */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
                      可享次卡权益
                    </label>
                    <div className="relative">
                      <input 
                        type="number"
                        required
                        min="1"
                        max="100"
                        value={formTotalUsages}
                        onChange={(e) => setFormTotalUsages(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-none px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none"
                        id="input-total-usages"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold">次</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
                      有效天数 (天)
                    </label>
                    <div className="relative">
                      <input 
                        type="number"
                        required
                        min="1"
                        max="3650"
                        value={formValidityDays}
                        onChange={(e) => setFormValidityDays(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-none px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none"
                        id="input-validity-days"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold">天</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
                      单店库存配额
                    </label>
                    <div className="relative">
                      <input 
                        type="number"
                        required
                        min="0"
                        max="10000"
                        value={formInventory}
                        onChange={(e) => setFormInventory(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-none px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none"
                        id="input-inventory"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold">张</span>
                    </div>
                  </div>
                </div>

                {/* Intro */}
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">次卡简略说明</label>
                  <textarea 
                    rows={2}
                    value={formIntro}
                    onChange={(e) => setFormIntro(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-none px-3 py-2 text-xs text-slate-800 focus:outline-none"
                    placeholder="输入该卡券简单副标题宣传句，例如: 极致温石解压，全套五次贵宾服务..."
                    id="textarea-intro"
                  />
                </div>

                {/* Detailed description */}
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">消费细节及预约规则描述</label>
                  <textarea 
                    rows={3}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-none px-3 py-2 text-xs text-slate-800 focus:outline-none"
                    placeholder="输入关于该套券的详细条约，如: 周末通用、需提前24小时致电前台客服匹配技师预约。"
                    id="textarea-description"
                  />
                </div>

                {/* Sales state selector */}
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">销售与架上状态</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input 
                        type="radio" 
                        name="salesStatus"
                        checked={formSalesStatus === '售卖中'}
                        onChange={() => setFormSalesStatus('售卖中')}
                        className="text-[#48a1a1] focus:ring-0 rounded-none cursor-pointer"
                      />
                      <span className="font-bold text-slate-700">常规架上公开售卖中</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input 
                        type="radio" 
                        name="salesStatus"
                        className="text-[#48a1a1] focus:ring-0 rounded-none cursor-pointer"
                        checked={formSalesStatus === '已停售'}
                        onChange={() => setFormSalesStatus('已停售')}
                      />
                      <span className="font-semibold text-slate-400">临时停用停售下架</span>
                    </label>
                  </div>
                </div>

              </form>

              {/* Drawer footer with exact rounded-none */}
              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-none text-xs text-slate-500 bg-white hover:bg-slate-100 transition-colors cursor-pointer font-bold uppercase tracking-wider"
                  id="btn-cancel-template-drawer"
                >
                  取消配置
                </button>
                <button
                  onClick={handleSaveCardTemplate}
                  type="button"
                  className="px-5 py-2 bg-slate-900 border border-slate-900 hover:bg-slate-800 text-white rounded-none text-xs font-bold uppercase tracking-wider cursor-pointer active:scale-95 transition-all"
                  id="btn-confirm-template-drawer"
                >
                  确认保存并同步后台
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: BUY SIMULATOR (WITH STRICT rounded-none) */}
      <AnimatePresence>
        {isBuyModalOpen && selectedShopCardForBuy && (
          <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-3xs" id="buy-sim-backdrop">
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="bg-white rounded-none shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden"
              id="buy-sim-container"
            >
              <div className="bg-slate-900 p-4 text-white flex justify-between items-center rounded-none">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="text-yellow-400 w-4.5 h-4.5" />
                  API 渠道模拟消费者快速购买下单
                </h3>
                <button 
                  onClick={() => setIsBuyModalOpen(false)} 
                  className="text-white/70 hover:text-white cursor-pointer"
                  id="btn-close-buy-sim"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-6 space-y-4 text-xs text-slate-700">
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-none space-y-2 text-[11px]">
                  <p className="text-slate-400 font-bold uppercase">模拟卡券来源主体：</p>
                  <p className="font-bold text-slate-800 text-xs">
                    {selectedShopCardForBuy.templateName}
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-slate-200/50 text-[10px] text-slate-500 font-mono">
                    <div>模板卡号: {selectedShopCardForBuy.cardId}</div>
                    <div className="text-right">额度: {selectedShopCardForBuy.totalUsages}次次卡</div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    实名买家提领手机号 (用于扫码提领匹配)
                  </label>
                  <input 
                    type="text"
                    value={buyPhone}
                    onChange={(e) => setBuyPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-none px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#48a1a1]"
                    placeholder="如: 138-0013-8000"
                    id="input-buy-user-phone"
                  />
                  <p className="text-[10px] text-slate-400 leading-normal">
                    * 前端模拟购买将呼叫 <b>simulatePurchase</b> 核心逻辑，从库存库中扣除一张，并联动生成符合 Groupon 标准校验体系的 16 位随机电子码串。
                  </p>
                </div>

                <div className="pt-2 flex justify-end gap-2.5">
                  <button
                    onClick={() => setIsBuyModalOpen(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200 rounded-none text-xs font-semibold uppercase tracking-wider cursor-pointer"
                    id="btn-cancel-buy-sim"
                  >
                    取消交易
                  </button>
                  <button
                    onClick={executeSimulatedPurchase}
                    className="px-5 py-2 bg-[#f97316] hover:bg-[#ea580c] text-white border border-[#f97316] rounded-none text-xs font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
                    id="btn-confirm-buy-sim"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    确认模拟生成券
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: REDEEM VERIFICATION (WITH ABSOLUTE SPECIFIC DESIGN & rounded-none) */}
      <AnimatePresence>
        {redeemCard && (
          <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-3xs" id="redeem-modal-backdrop">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="bg-white rounded-none shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
              id="redeem-modal-container"
            >
              {/* Header looks like a physical Groupon voucher top card */}
              <div className="bg-slate-900 p-5 text-white relative rounded-none">
                <div className="absolute top-4 right-4 bg-white/20 border border-white/20 px-3 py-1 rounded-none text-[9px] font-mono tracking-widest uppercase">
                  Groupon Standard Voucher
                </div>
                <h4 className="text-base font-black text-white pr-20 uppercase tracking-tight">
                  {redeemCard.cardName}
                </h4>
                <p className="text-[11px] text-[#4dbab0] mt-1 font-mono tracking-wider font-bold">
                  实体消费串码: {redeemCard.id}
                </p>
              </div>

              {/* Content sections */}
              <div className="p-6 space-y-5 text-xs text-slate-700">
                <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-200/60 p-4 rounded-none text-[11px] font-mono text-slate-600">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider mb-0.5">
                      持有人绑定电话：
                    </span>
                    <span className="font-bold text-slate-900 text-xs"> 
                      {redeemCard.userPhone}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider mb-0.5">
                      本券截至失效期：
                    </span>
                    <span className="font-bold text-slate-900"> 
                      {redeemCard.validityEndDate}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    包含的单店特属物理疗法护理项:
                  </h5>
                  <div className="bg-[#f0f9f9] border border-[#48a1a1]/25 rounded-none p-4 space-y-1.5">
                    <p className="text-xs text-slate-800 font-bold flex items-center gap-1.5 font-sans">
                      <Scissors className="w-4 h-4 text-[#48a1a1] shrink-0" />
                      <span>本次特许享受护理项目：</span>
                    </p>
                    <p className="text-xs text-slate-600 font-semibold leading-relaxed pl-5 font-mono">
                      {shopCards.find(sc => sc.templateName === redeemCard.cardName || sc.cardId === redeemCard.cardId)
                        ?.boundServices.join(', ') || "60Mins Body Massage 物理疗法项目"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-none">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider mb-0.5">
                      卡券剩余可用次数
                    </span>
                    <span className="text-2xl font-black text-[#48a1a1] font-mono">
                      {redeemCard.remainingCount} <span className="text-xs text-slate-400 font-bold">次</span>
                    </span>
                  </div>
                  
                  {redeemCard.remainingCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleDeductOneTime}
                      className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 rounded-none text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-xs uppercase tracking-wider active:scale-95"
                      id="btn-execute-single-redeem"
                    >
                      <UserCheck className="w-4 h-4 shrink-0" />
                      一键扣减1次并核销
                    </button>
                  ) : (
                    <div className="bg-slate-100 text-slate-400 text-xs px-4 py-2 border border-slate-100 rounded-none font-bold uppercase tracking-widest select-none">
                      已核销完毕
                    </div>
                  )}
                </div>
              </div>

              {/* Close Row */}
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setRedeemCard(null)}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs border border-slate-900 rounded-none font-black uppercase tracking-wider cursor-pointer active:scale-95 transition-all"
                  id="btn-close-redeem-modal"
                >
                  关闭核销视窗
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
