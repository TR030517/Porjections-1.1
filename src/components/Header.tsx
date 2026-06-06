import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronDown, 
  ShieldAlert, 
  Sparkles, 
  User, 
  Lock, 
  LogOut, 
  Store, 
  MapPin, 
  Check, 
  Settings,
  X,
  AlertCircle
} from 'lucide-react';
import { useAuthStore, Role } from '../stores/authStore';
import { useShopStore } from '../stores/shop';

export default function Header() {
  const { currentRole, setCurrentRole, roleLabel } = useAuthStore();
  const { currentStoreId, setCurrentStoreId, hasBranches, branchList } = useShopStore();

  // User details
  const userName = "Admin - Ariva Spa";

  // Menu Toggle States
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isStoreDropdownOpen, setIsStoreDropdownOpen] = useState(false);

  // Password Modification Modal States
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [verificationMethod, setVerificationMethod] = useState<'password' | 'code'>('password');
  const [oldPassword, setOldPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatusMsg, setPasswordStatusMsg] = useState('');

  // Refs for closing on clicks outside
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Verification code countdown timer
  useEffect(() => {
    let timer: any;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);
  const storeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
      if (storeDropdownRef.current && !storeDropdownRef.current.contains(event.target as Node)) {
        setIsStoreDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Pre-configured platform stores for SUPER_ADMIN or PLATFORM_ADMIN
  const platformStores = [
    { id: 3246, name: 'Ariva Spa (总部旗舰店)' },
    { id: 3221, name: 'Roes Spa (经典分院)' },
    { id: 3280, name: 'Oasis Health & Wellness (温和按摩中心)' },
    { id: 3295, name: 'Lilac Mineral Hot Springs (丁香氡温泉会馆)' }
  ];

  // Helper selector options mapping based on current role
  const getSelectableShops = () => {
    if (currentRole === Role.SUPER_ADMIN || currentRole === Role.PLATFORM_ADMIN) {
      return platformStores;
    } else if (currentRole === Role.STORE_MANAGER) {
      if (hasBranches) {
        // Boss's primary store (Ariva Spa ID 3246) + branch list from state
        return [
          { id: 3246, name: 'Ariva Spa (旗舰总店)' },
          ...branchList.map(b => ({ id: b.id, name: b.name }))
        ];
      }
    }
    return [];
  };

  const selectableShops = getSelectableShops();
  const currentSelectedShop = selectableShops.find(s => s.id === currentStoreId) || selectableShops[0] || { id: 3246, name: 'Ariva Spa' };

  // Render check for selector visibility
  const showShopSelector = (currentRole === Role.SUPER_ADMIN || currentRole === Role.PLATFORM_ADMIN) || 
                            (currentRole === Role.STORE_MANAGER && hasBranches === true);

  // Emulate sending verification code
  const handleSendCode = () => {
    if (countdown > 0) return;
    setIsCodeSent(true);
    setCountdown(60);
    setPasswordStatusMsg('✅ 模拟验证码已飞信投递至绑定的安全端：a859****@gmail.com。测试码: MASSAGE777');
    setVerificationCode('MASSAGE777');
  };

  // Handle password submission with roles & security-checks
  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (verificationMethod === 'password') {
      if (!oldPassword) {
        setPasswordStatusMsg('❌ 身份校验失败：请输入当前旧密码确认。');
        return;
      }
    } else {
      if (!verificationCode) {
        setPasswordStatusMsg('❌ 身份校验失败：请输入收到的安全验证码。');
        return;
      }
      if (verificationCode.trim() !== 'MASSAGE777') {
        setPasswordStatusMsg('❌ 校验失败：验证码无效，请使用模拟核准码: MASSAGE777');
        return;
      }
    }

    if (!newPassword || !confirmPassword) {
      setPasswordStatusMsg('❌ 密码重置失败：请输入完整的新密码参数。');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatusMsg('❌ 错误：两次输入的新密码不一致，请重试！');
      return;
    }

    setPasswordStatusMsg('✅ 身份核准无误！新密码已安全载入本地持久层。');
    setTimeout(() => {
      setIsPasswordModalOpen(false);
      setOldPassword('');
      setVerificationCode('');
      setCountdown(0);
      setIsCodeSent(false);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStatusMsg('');
    }, 1800);
  };

  const handleLogout = () => {
    if (window.confirm('您确定要安全退出当前管理后台系统登录态吗？')) {
      alert('已模拟退出登录成功，工作会话已结束。');
      // For demonstration let's fallback role to user
      setCurrentRole(Role.USER);
    }
  };

  return (
    <header 
      style={{ borderRadius: '0px' }}
      className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-8 fixed top-0 right-0 left-60 z-10 antialiased font-sans select-none rounded-none"
    >
      {/* LEFT AREA: Role Context Indicator & Global Shop Context Select */}
      <div className="flex items-center gap-4">
        {/* Dynamic Multi-role Switch Prompt */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 font-mono bg-gray-50 px-2 py-1 border border-gray-200/60 rounded-none" style={{ borderRadius: '0px' }}>
            RBAC 运营中
          </span>
          <div className="flex items-center gap-1 text-[11px] text-[#48a1a1]">
            <Sparkles className="w-3 h-3" />
            <span>当前身份：<b>{roleLabel}</b></span>
          </div>
        </div>

        {/* SHOP LOGICAL SELECTOR & TAG (EL-SELECT & EL-TAG REACT PORT) */}
        {currentRole === Role.STORE_MANAGER ? (
          <div className="flex items-center gap-2 pl-4 border-l border-gray-100">
            <span className="text-xs text-gray-400 font-medium">经营门店：</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-800 flex items-center gap-1">
                <Store className="w-3.5 h-3.5 text-[#48a1a1]" />
                <span>Ariva Spa</span>
              </span>
              
              {hasBranches && (
                <div className="relative">
                  <select
                    value={currentStoreId || 3246}
                    onChange={(e) => setCurrentStoreId(Number(e.target.value))}
                    className="bg-gray-50 border border-gray-200 text-xs text-gray-750 px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#48a1a1]/50 font-sans font-semibold cursor-pointer"
                    style={{ borderRadius: '0px' }}
                  >
                    <option value={3246}>旗舰总店</option>
                    {branchList.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name.replace('Ariva Spa - ', '')}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {hasBranches && (
                <span 
                  style={{ borderRadius: '0px' }}
                  className="bg-zinc-800 text-white font-mono text-[9px] font-bold tracking-widest px-2 py-1 select-none border border-zinc-700 rounded-none uppercase"
                >
                  连锁
                </span>
              )}
            </div>
          </div>
        ) : (
          showShopSelector && (
            <div className="flex items-center gap-2 pl-4 border-l border-gray-100 relative" ref={storeDropdownRef}>
              <span className="text-xs text-gray-400 font-medium">经营门店：</span>
              
              {/* Custom styled select selector mimicking el-select */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsStoreDropdownOpen(!isStoreDropdownOpen)}
                  style={{ borderRadius: '0px' }}
                  className="bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 text-xs text-gray-800 px-3 py-1.5 flex items-center gap-2 transition-all cursor-pointer font-sans font-medium rounded-none focus:outline-none focus:ring-1 focus:ring-[#48a1a1]/50"
                >
                  <Store className="w-3.5 h-3.5 text-[#48a1a1]" />
                  <span>{currentSelectedShop.name}</span>
                  <ChevronDown className="w-3 h-3 text-gray-400" />
                </button>

                {/* Custom Dropdown Option Panel */}
                {isStoreDropdownOpen && (
                  <div 
                    style={{ borderRadius: '0px' }}
                    className="absolute left-0 mt-1 w-72 bg-white border border-gray-200 shadow-xl z-50 rounded-none overflow-hidden max-h-64 overflow-y-auto"
                  >
                    <p className="text-[10px] uppercase font-bold text-gray-400 px-3 py-2 bg-slate-50 border-b border-gray-100 tracking-wider">
                      🌐 全平台入驻门店巡查
                    </p>
                    
                    {selectableShops.map((shop) => {
                      const isSelected = shop.id === currentStoreId;
                      return (
                        <button
                          key={shop.id}
                          type="button"
                          onClick={() => {
                            setCurrentStoreId(shop.id);
                            setIsStoreDropdownOpen(false);
                          }}
                          style={{ borderRadius: '0px' }}
                          className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition-colors border-b border-gray-50 last:border-0 rounded-none cursor-pointer ${
                            isSelected 
                              ? 'bg-[#eef8f8] text-[#48a1a1] font-bold' 
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3 h-3 shrink-0 opacity-75" />
                            <span>{shop.name}</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* BRAND BRANCH TAG (EL-TAG CUSTOM PORT) */}
              {hasBranches && (
                <span 
                  style={{ borderRadius: '0px' }}
                  className="bg-zinc-800 text-white font-mono text-[9px] font-bold tracking-widest px-2 py-1 select-none border border-zinc-700 rounded-none uppercase"
                >
                  连锁
                </span>
              )}
            </div>
          )
        )}
      </div>

      {/* RIGHT AREA: Role Switch Selection & Profile Dropdown (el-dropdown) */}
      <div className="flex items-center gap-4">
        {/* Quick Role Tester Selector */}
        <div className="flex items-center gap-1.5 bg-gray-50/50 p-1 border border-gray-100">
          <label htmlFor="top-role-select" className="text-[10px] text-gray-400 font-bold tracking-wider uppercase pl-1">
            RBAC调试
          </label>
          <select
            id="top-role-select"
            value={currentRole}
            onChange={(e) => setCurrentRole(e.target.value as Role)}
            className="bg-white border border-gray-200 text-[11px] text-gray-700 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#48a1a1] cursor-pointer font-medium font-sans rounded-none"
            style={{ borderRadius: '0px' }}
          >
            <option value={Role.SUPER_ADMIN}>⚙️ SUPER_ADMIN (系统超级管理)</option>
            <option value={Role.PLATFORM_ADMIN}>🛡️ PLATFORM_ADMIN (平台常规运营)</option>
            <option value={Role.STORE_MANAGER}>🏪 STORE_MANAGER (自主商家店长)</option>
            <option value={Role.USER}>👥 USER (普通客户 - 模拟硬隔离)</option>
          </select>
        </div>

        <div className="h-4 w-px bg-gray-200" />

        {/* ACCOUNT INFO DROPDOWN (EL-DROPDOWN REACT CUSTOM PORT) */}
        <div className="relative" ref={userDropdownRef}>
          <button
            type="button"
            onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
            style={{ borderRadius: '0px' }}
            className="flex items-center gap-2.5 px-3 py-1.5 bg-white hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-all cursor-pointer rounded-none focus:outline-none"
          >
            <div 
              style={{ borderRadius: '0px' }}
              className="w-7 h-7 bg-teal-550/10 text-[#48a1a1] flex items-center justify-center font-bold text-sm border border-[#48a1a1]/25 rounded-none"
            >
              A
            </div>
            
            <div className="text-left font-sans">
              <span className="text-[11px] text-gray-400 block font-bold tracking-tight">欢迎回来,</span>
              <span className="text-xs font-semibold text-gray-800 flex items-center gap-1">
                <span>{userName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </span>
            </div>
          </button>

          {/* el-dropdown-menu custom popup panel */}
          {isUserDropdownOpen && (
            <div 
              style={{ borderRadius: '0px' }}
              className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 shadow-xl z-50 py-1 rounded-none overflow-hidden"
            >
              <div className="px-3 py-2 border-b border-gray-100 bg-slate-50/50">
                <p className="text-xs font-bold text-gray-900 truncate">{userName}</p>
                <p className="text-[9px] text-[#48a1a1] font-mono mt-0.5 truncate">{roleLabel}</p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsUserDropdownOpen(false);
                  setIsPasswordModalOpen(true);
                }}
                style={{ borderRadius: '0px' }}
                className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 cursor-pointer transition-colors rounded-none font-sans"
              >
                <Lock className="w-3.5 h-3.5 text-gray-400" />
                <span>修改密码</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsUserDropdownOpen(false);
                  handleLogout();
                }}
                style={{ borderRadius: '0px' }}
                className="w-full text-left px-4 py-2.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer transition-colors border-t border-gray-100 rounded-none font-sans"
              >
                <LogOut className="w-3.5 h-3.5 text-red-400" />
                <span>退出登录</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL WINDOW FOR CHANGING PASSWORD (STRICT ZERO CORNERS DESIGN) */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4 antialiased">
          <div 
            style={{ borderRadius: '0px' }}
            className="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm overflow-hidden flex flex-col rounded-none"
          >
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider">
                <Lock className="w-4 h-4 text-[#48a1a1]" />
                <span>修改管理员系统密码</span>
              </div>
              <button 
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                className="text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Verification Method Selection Tabs */}
            <div className="flex border-b border-gray-150 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setVerificationMethod('password');
                  setPasswordStatusMsg('');
                }}
                style={{ borderRadius: '0px' }}
                className={`flex-1 text-center py-2.5 text-xs font-bold transition-colors cursor-pointer rounded-none border-b-2 ${
                  verificationMethod === 'password'
                    ? 'border-[#48a1a1] text-[#48a1a1] bg-slate-55/10'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-slate-50'
                }`}
              >
                旧密码核验
              </button>
              <button
                type="button"
                onClick={() => {
                  setVerificationMethod('code');
                  setPasswordStatusMsg('');
                }}
                style={{ borderRadius: '0px' }}
                className={`flex-1 text-center py-2.5 text-xs font-bold transition-colors cursor-pointer rounded-none border-b-2 ${
                  verificationMethod === 'code'
                    ? 'border-[#48a1a1] text-[#48a1a1] bg-slate-55/10'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-slate-50'
                }`}
              >
                验证码核验
              </button>
            </div>

            <form onSubmit={handlePasswordSubmit} className="p-5 space-y-4 text-xs font-sans flex-1 overflow-y-auto">
              {verificationMethod === 'password' ? (
                <div className="space-y-1">
                  <label className="font-semibold text-gray-700 block">
                    当前旧密码 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    style={{ borderRadius: '0px' }}
                    className="w-full bg-slate-50 border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#48a1a1] rounded-none focus:bg-white"
                    placeholder="请输入您的旧账户密码"
                  />
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <label className="font-semibold text-gray-700 block">
                      绑定安全检测邮箱
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-1 bg-slate-50 border border-gray-200 px-3 py-2 text-xs font-mono text-gray-400 select-all flex items-center">
                        a8584***@gmail.com
                      </div>
                      <button
                        type="button"
                        onClick={handleSendCode}
                        disabled={countdown > 0}
                        style={{ borderRadius: '0px' }}
                        className={`px-3 py-2 text-xs font-bold transition-all border shrink-0 cursor-pointer rounded-none ${
                          countdown > 0
                            ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-slate-900 border-slate-900 hover:bg-slate-800 text-white'
                        }`}
                      >
                        {countdown > 0 ? `${countdown}s 后重新发` : '发送验证码'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-gray-700 block">
                      请输入 6 位验证码 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      style={{ borderRadius: '0px' }}
                      className="w-full bg-slate-50 border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#48a1a1] rounded-none focus:bg-white font-mono"
                      placeholder="请输入投递的验证码(MASSAGE777)"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">
                      模拟提示: 发送后可以使用预设验证码 <code className="bg-amber-50 text-amber-600 px-1 font-mono font-bold">MASSAGE777</code> 来通过校验
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold text-gray-700 block">
                  设置新密码 <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{ borderRadius: '0px' }}
                  className="w-full bg-slate-50 border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#48a1a1] rounded-none focus:bg-white"
                  placeholder="请输入符合复杂度的安全新密码"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-gray-700 block">
                  确认您的新密码 <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ borderRadius: '0px' }}
                  className="w-full bg-slate-50 border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#48a1a1] rounded-none focus:bg-white"
                  placeholder="请再次键起新密码以确认核准"
                />
              </div>

              {passwordStatusMsg && (
                <div className="flex items-start gap-1.5 p-2.5 bg-slate-50 text-[11px] leading-relaxed select-none border border-gray-150">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-slate-600 mt-0.5" />
                  <span>{passwordStatusMsg}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3.5 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => setIsPasswordModalOpen(false)}
                  style={{ borderRadius: '0px' }}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 font-medium rounded-none cursor-pointer text-xs"
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{ borderRadius: '0px' }}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-none cursor-pointer text-xs transition-colors"
                >
                  确认保存新凭证
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
