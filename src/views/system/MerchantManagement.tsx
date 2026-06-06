import React, { useState } from 'react';
import { Search, Plus, Trash2, Key, Settings, X, RotateCcw, Store, ShieldAlert, Check } from 'lucide-react';
import { useUserStore } from '../../stores/user';
import { Role } from '../../utils/roleEnum';

interface MerchantStruct {
  id: number;
  managerAccount: string;
  storeName: string;
  branchesCount: number;
  updatedDate: string;
  statusPrivileges: string[];
}

export default function MerchantManagement() {
  const { currentRole, setCurrentRole } = useUserStore();

  const [merchantsList, setMerchantsList] = useState<MerchantStruct[]>([
    { 
      id: 20001, 
      managerAccount: 'boss_ariva@arivaspa.com', 
      storeName: 'Ariva Spa 总部旗舰店', 
      branchesCount: 3, 
      updatedDate: '2026-06-02 18:24:11', 
      statusPrivileges: ['分销与核销配置权', '连锁分店创建与修改权', '自行提下结款申请'] 
    },
    { 
      id: 20002, 
      managerAccount: 'manager_roes@roesspa.com', 
      storeName: 'Roes Spa 经典分院', 
      branchesCount: 0, 
      updatedDate: '2026-06-03 10:45:30', 
      statusPrivileges: ['分销与核销配置权'] 
    },
    { 
      id: 20003, 
      managerAccount: 'boss_oasis@oasiswell.org', 
      storeName: 'Oasis Health (温和按摩中心)', 
      branchesCount: 1, 
      updatedDate: '2026-05-29 08:12:00', 
      statusPrivileges: ['分销与核销配置权', '自行提下结款申请'] 
    },
    { 
      id: 20004, 
      managerAccount: 'lilac_springs@mineralhot.com', 
      storeName: 'Lilac Mineral Hot Springs', 
      branchesCount: 5, 
      updatedDate: '2026-06-01 14:02:11', 
      statusPrivileges: ['分销与核销配置权', '连锁分店创建与修改权'] 
    }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal states
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [targetMerchantLabel, setTargetMerchantLabel] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [privilegeModalVisible, setPrivilegeModalVisible] = useState(false);
  const [targetMerchantItem, setTargetMerchantItem] = useState<MerchantStruct | null>(null);
  const [tempPrivileges, setTempPrivileges] = useState<string[]>([]);

  const [addMerchantModalVisible, setAddMerchantModalVisible] = useState(false);
  const [addForm, setAddForm] = useState({
    managerAccount: '',
    storeName: '',
    branchesCount: 0,
    password: '',
    privileges: [] as string[]
  });
  const [addFormError, setAddFormError] = useState('');

  const privilegeOptions = [
    '分销与核销配置权',
    '连锁分店创建与修改权',
    '自行提下结款申请',
    '敏感商业流水导出权',
    '营销活动自行发布权'
  ];

  const filteredMerchants = merchantsList.filter(m => 
    m.managerAccount.toLowerCase().includes(searchQuery.toLowerCase()) || 
    m.storeName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleReset = () => {
    setSearchQuery('');
  };

  // 1. Password reset triggering for merchant (Admins modify subordinates DIRECTLY, no old password validation)
  const handleTriggerResetPassword = (merchant: MerchantStruct) => {
    setTargetMerchantLabel(`${merchant.storeName} (${merchant.managerAccount})`);
    setNewPassword('');
    setPasswordError('');
    setPasswordModalVisible(true);
  };

  const submitResetForm = () => {
    setPasswordError('');
    if (!newPassword || newPassword.length < 5) {
      setPasswordError('新密码复杂度不足：必须设定 5 位以上登录控制字符。');
      return;
    }

    alert(`🔑 密钥修改指令就绪！成功直接重置 [${targetMerchantLabel}] 登录密码为: [${newPassword}]！`);
    setPasswordModalVisible(false);
  };

  // 2. Adjusting system usage permissions for merchant
  const handleTriggerTweakPrivilege = (merchant: MerchantStruct) => {
    setTargetMerchantItem(merchant);
    setTempPrivileges([...(merchant.statusPrivileges || [])]);
    setPrivilegeModalVisible(true);
  };

  const submitPrivilegeForm = () => {
    if (targetMerchantItem) {
      setMerchantsList(merchantsList.map(m => 
        m.id === targetMerchantItem.id 
          ? { ...m, statusPrivileges: [...tempPrivileges] } 
          : m
      ));
      alert(`🛡️ 系统授权重置完毕！【${targetMerchantItem.storeName}】的功能管理权限树已完成重写。`);
    }
    setPrivilegeModalVisible(false);
  };

  // 3. Deleting store manager accounts (physical deletion simulation)
  const handleDeleteMerchantAccount = (merchant: MerchantStruct) => {
    if (window.confirm(`🔒 删销警示：确定物理移出商家管理员账号 [${merchant.managerAccount}] 吗？\n警告：该操作将导致店主及其旗下 [${merchant.branchesCount}] 间分销店铺无法正常登入！`)) {
      setMerchantsList(merchantsList.filter(m => m.id !== merchant.id));
      alert('已成功销毁该店长账户及其底层会话访问。');
    }
  };

  // 4. Open Adding merchant accounts (STORE_MANAGER generation)
  const handleOpenAddMerchantModal = () => {
    setAddForm({
      managerAccount: '',
      storeName: '',
      branchesCount: 0,
      password: '',
      privileges: ['分销与核销配置权']
    });
    setAddFormError('');
    setAddMerchantModalVisible(true);
  };

  const submitAddMerchantForm = () => {
    setAddFormError('');

    if (!addForm.managerAccount || addForm.managerAccount.trim().length === 0) {
      setAddFormError('商家登录邮箱/主账号名不可留空！');
      return;
    }
    if (!addForm.storeName || addForm.storeName.trim().length === 0) {
      setAddFormError('关联的主要门店公司全称不可留空！');
      return;
    }
    if (!addForm.password || addForm.password.length < 5) {
      setAddFormError('初始安全控制密码不可短于 5 位安全字符！');
      return;
    }

    const exists = merchantsList.some(m => m.managerAccount.trim().toLowerCase() === addForm.managerAccount.trim().toLowerCase());
    if (exists) {
      setAddFormError(`登录主账号名 [${addForm.managerAccount}] 在系统中已在册，不可重复绑定！`);
      return;
    }

    const newMerchant: MerchantStruct = {
      id: Date.now() % 100000,
      managerAccount: addForm.managerAccount.trim(),
      storeName: addForm.storeName.trim(),
      branchesCount: Number(addForm.branchesCount) || 0,
      updatedDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
      statusPrivileges: [...addForm.privileges]
    };

    setMerchantsList([newMerchant, ...merchantsList]);
    alert(`✨ 授权开通成功！已成功录入商家店长 [${newMerchant.storeName}]，即刻起其支持使用当前账户通过登录并完成店铺核销。`);
    setAddMerchantModalVisible(false);
  };

  // GATING LOGIC: BOTH SUPER_ADMIN and PLATFORM_ADMIN can access merchant-account list.
  const isAuthorized = currentRole === Role.SUPER_ADMIN || currentRole === Role.PLATFORM_ADMIN;

  if (!isAuthorized) {
    return (
      <div className="space-y-6 select-none font-sans antialiased text-gray-800">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>系统管理</span>
          <span>/</span>
          <span className="text-gray-600 font-bold">商家主账号管理 (merchant-account.vue counterpart)</span>
        </div>

        <div className="bg-red-50 border-2 border-red-500 p-8 text-center space-y-4 max-w-2xl mx-auto my-12" style={{ borderRadius: '0px' }}>
          <span className="inline-block text-3xl">⚠️</span>
          <h2 className="text-base font-black text-red-900 uppercase tracking-widest font-mono">访问权限受限 | RESTRICED PATH</h2>
          <p className="text-xs text-red-700 leading-relaxed max-w-md mx-auto">
            抱歉，该管理模块属于系统商盟级核心名单隔离区。您的当前角色身份为 
            <span className="font-bold bg-red-200 text-red-900 px-1.5 py-0.5 ml-1 font-mono">[{currentRole}]</span>。
            仅超级管理员 (<span className="font-bold underline">SUPER_ADMIN</span>) 与平台管理员 (<span className="font-bold underline">PLATFORM_ADMIN</span>) 可以审视此数据。
          </p>
          <div className="pt-2">
            <button 
              type="button"
              onClick={() => setCurrentRole(Role.PLATFORM_ADMIN)} 
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition-all border-none"
              style={{ borderRadius: '0px' }}
            >
              附身为 PLATFORM_ADMIN 解锁进入
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 select-none font-sans antialiased text-gray-800">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span>系统管理</span>
        <span>/</span>
        <span className="text-gray-600 font-bold">商家主账号管理 (Merchant Account List)</span>
      </div>

      <div className="bg-slate-50 border border-gray-300 p-5 flex flex-wrap items-center justify-between gap-4" style={{ borderRadius: '0px' }}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 bg-cyan-600"></span>
            <span className="text-[11px] font-black uppercase tracking-widest font-mono text-cyan-600">Merchant Gating Enabled</span>
          </div>
          <h3 className="text-sm font-black text-gray-900">
            管理员直属重置机制: 无需商户提供原密码，直接覆盖
          </h3>
          <p className="text-[11px] text-gray-500">
            店主和各个具体门店管理员(STORE_MANAGER)的底层权限可在此由具有 PLATFORM_ADMIN 或更高权限的会话来进行灵活挂载与注销。
          </p>
        </div>
        <div className="text-xs bg-slate-900 text-white px-3.5 py-1.5 font-mono" style={{ borderRadius: '0px' }}>
          ROLE: <span className="text-cyan-400 font-bold">{currentRole}</span>
        </div>
      </div>

      {/* Primary Card - strict straight-corner style */}
      <div className="bg-white border-2 border-slate-900 shadow-lg overflow-hidden" style={{ borderRadius: '0px' }}>
        <div className="bg-slate-50 border-b-2 border-slate-900 px-6 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderRadius: '0px' }}>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-zinc-800 text-white font-mono text-[10px] font-bold tracking-wider" style={{ borderRadius: '0px' }}>
              EL-CARD
            </span>
            <div>
              <h4 className="text-xs font-bold text-slate-400 font-mono uppercase">Merchant login control matrix</h4>
              <h3 className="text-sm font-black text-gray-900">直营店长与商盟管理员 (STORE_MANAGER) 在册账册</h3>
            </div>
          </div>
          <span className="text-xs bg-cyan-50 text-cyan-700 px-2.5 py-1 font-mono font-bold border border-cyan-200" style={{ borderRadius: '0px' }}>
            商盟级账户控制台
          </span>
        </div>

        {/* Filters and Buttons */}
        <div className="p-6 border-b border-gray-150 flex flex-wrap items-center justify-between gap-4 bg-white">
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索商家登录主邮箱 / 关联主店铺名称..."
                className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-300 focus:border-[#48a1a1] text-xs focus:outline-none w-64"
                style={{ borderRadius: '0px' }}
              />
            </div>
            
            <button
              onClick={handleReset}
              className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-650 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
              style={{ borderRadius: '0px' }}
            >
              <RotateCcw className="w-3 h-3" />
              清空重设
            </button>
          </div>

          <button
            onClick={handleOpenAddMerchantModal}
            className="px-4 py-1.5 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
            style={{ borderRadius: '0px' }}
          >
            <Plus className="w-4 h-4" />
            签约并新增店长账号
          </button>
        </div>

        {/* Directory table */}
        <div className="p-6 bg-white overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse border-2 border-slate-900" style={{ borderRadius: '0px' }}>
            <thead>
              <tr className="bg-slate-100 text-slate-800 border-b-2 border-slate-900 font-bold">
                <th className="p-3 border-r border-slate-200 font-mono">UID</th>
                <th className="p-3 border-r border-slate-200">商家主账号 / 登录邮箱</th>
                <th className="p-3 border-r border-slate-200">关联之主店铺名称 (Principal Store)</th>
                <th className="p-3 border-r border-slate-200 text-center">绑定旗下分店数量</th>
                <th className="p-3 border-r border-slate-200">授权核备时间</th>
                <th className="p-3 border-r border-slate-200">商户系统特许使用权</th>
                <th className="p-3 text-center">高级安全重置操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredMerchants.map((merchant) => (
                <tr key={merchant.id} className="hover:bg-gray-50 border-b border-gray-200 transition-colors">
                  <td className="p-3 border-r border-slate-200 font-mono font-bold">{merchant.id}</td>
                  <td className="p-3 border-r border-slate-200 font-mono font-bold text-[#48a1a1]">{merchant.managerAccount}</td>
                  <td className="p-3 border-r border-slate-200">
                    <div className="flex items-center gap-1 text-slate-950 font-bold">
                      <Store className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>{merchant.storeName}</span>
                    </div>
                  </td>
                  <td className="p-3 border-r border-slate-200 text-center">
                    <span 
                      style={{ borderRadius: '0px' }}
                      className="px-2 py-0.5 border border-slate-900 bg-slate-900 text-white text-[10px] font-mono tracking-wider font-bold"
                    >
                      {merchant.branchesCount} Branches
                    </span>
                  </td>
                  <td className="p-3 border-r border-slate-200 font-mono text-gray-400">{merchant.updatedDate}</td>
                  <td className="p-3 border-r border-slate-200">
                    <div className="flex flex-wrap gap-1">
                      {merchant.statusPrivileges.map((priv) => (
                        <span 
                          key={priv}
                          style={{ borderRadius: '0px' }}
                          className="bg-cyan-50 border border-cyan-100 text-cyan-800 text-[10px] font-semibold px-2 py-0.5"
                        >
                          ● {priv}
                        </span>
                      ))}
                      {merchant.statusPrivileges.length === 0 && (
                        <span className="text-red-500 font-bold text-[9px]">🚨 所有子系统特许禁用</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button 
                        onClick={() => handleTriggerResetPassword(merchant)}
                        style={{ borderRadius: '0px' }}
                        className="text-[10px] font-black bg-[#48a1a1] hover:bg-[#3d8b8b] text-white px-2.5 py-1.5 cursor-pointer flex items-center gap-1 border border-transparent"
                      >
                        <Key className="w-3 h-3" />
                        重置密码
                      </button>
                      <button 
                        onClick={() => handleTriggerTweakPrivilege(merchant)}
                        style={{ borderRadius: '0px' }}
                        className="text-[10px] font-bold bg-white border border-slate-900 hover:bg-slate-100 text-slate-800 px-2.5 py-1.5 cursor-pointer flex items-center gap-1"
                      >
                        <Settings className="w-3 h-3" />
                        调整权限
                      </button>
                      <button 
                        onClick={() => handleDeleteMerchantAccount(merchant)}
                        style={{ borderRadius: '0px' }}
                        className="text-[10px] font-semibold bg-red-50 hover:bg-red-100 text-red-650 px-2.5 py-1.5 border border-red-200 cursor-pointer flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredMerchants.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400 bg-gray-50 border border-dashed border-gray-200">
                    暂无分配任何商盟合作店主账号信息。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DIALOG 1: DIRECT MERCHANT PASSWORD MODAL */}
      {passwordModalVisible && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col" style={{ borderRadius: '0px' }}>
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950">
              <span className="text-xs font-black tracking-widest uppercase font-mono text-cyan-400">RESET LOCK KEY</span>
              <button onClick={() => setPasswordModalVisible(false)} className="text-slate-400 hover:text-white cursor-pointer font-bold font-mono text-lg select-none">×</button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="border-b border-gray-100 pb-2">
                <h4 className="text-xs font-black text-slate-800 leading-normal">
                  🔐 安全指令：强制覆盖下方商家的店长密码
                </h4>
                <p className="font-semibold text-slate-500 font-mono text-[10px] mt-1">
                  TARGET: {targetMerchantLabel}
                </p>
                <div className="bg-orange-50 border border-orange-200 p-2 text-orange-700 text-[10px] mt-2" style={{ borderRadius: '0px' }}>
                  💡 作为高级管理人员，您的密码覆盖机制将会对商家主账号即时起效，无需验证其以往在册旧密码。
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-gray-650">直接分配设定的登录新密码 (New Password) *最低 5 位</label>
                <input 
                  type="password" 
                  placeholder="请输入明文新密码配置" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-wider font-semibold" 
                  style={{ borderRadius: '0px' }}
                />
              </div>

              {passwordError && (
                <div className="bg-red-50 border border-red-300 p-2 text-red-650 font-bold select-none text-[10px]" style={{ borderRadius: '0px' }}>
                  ❌ 审定拒绝：{passwordError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => setPasswordModalVisible(false)}
                  style={{ borderRadius: '0px' }}
                  className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 font-semibold cursor-pointer text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitResetForm}
                  style={{ borderRadius: '0px' }}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-850 text-white font-black cursor-pointer text-xs transition-colors"
                >
                  批准重置密码
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG 2: ADJUST MERCHANT PRIVILEGES */}
      {privilegeModalVisible && targetMerchantItem && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col" style={{ borderRadius: '0px' }}>
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950">
              <span className="text-xs font-black tracking-widest uppercase font-mono text-cyan-400">SET PERM PRIVILEGES</span>
              <button onClick={() => setPrivilegeModalVisible(false)} className="text-slate-400 hover:text-white cursor-pointer font-bold font-mono text-lg select-none">×</button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <h4 className="text-xs font-black text-slate-800">
                  调整商家系统使用及功能特许权：
                </h4>
                <p className="text-cyan-600 font-black mt-1">
                  【{targetMerchantItem.storeName}】
                </p>
              </div>

              <div className="space-y-2 bg-slate-50 border border-slate-205 p-4" style={{ borderRadius: '0px' }}>
                {privilegeOptions.map((opt) => (
                  <label 
                    key={opt}
                    className="flex items-start gap-2 cursor-pointer font-semibold text-gray-700 hover:text-slate-900 select-none text-[11px]"
                  >
                    <input 
                      type="checkbox" 
                      value={opt}
                      checked={tempPrivileges.includes(opt)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setTempPrivileges([...tempPrivileges, opt]);
                        } else {
                          setTempPrivileges(tempPrivileges.filter(p => p !== opt));
                        }
                      }}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => setPrivilegeModalVisible(false)}
                  style={{ borderRadius: '0px' }}
                  className="px-4 py-2 border border-gray-300 text-gray-600 font-semibold cursor-pointer text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitPrivilegeForm}
                  style={{ borderRadius: '0px' }}
                  className="px-5 py-2 bg-slate-[#48a1a1] bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-black cursor-pointer text-xs transition-colors"
                >
                  确认调整权限
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG 3: ADD MERCHANT LOGIN DIRECTLY */}
      {addMerchantModalVisible && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col" style={{ borderRadius: '0px' }}>
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950">
              <span className="text-xs font-black tracking-widest uppercase font-mono text-cyan-400">NEW STORE MANAGER</span>
              <button onClick={() => setAddMerchantModalVisible(false)} className="text-slate-400 hover:text-white cursor-pointer font-bold font-mono text-lg select-none">×</button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="border-b border-gray-100 pb-2">
                <h4 className="text-xs font-black text-slate-800">
                  ➕ 分配商盟店长特定分配账号 (STORE_MANAGER)
                </h4>
                <p className="text-[10px] text-gray-400 mt-1">
                  开通签约店主全新账号，授权其登入商家控制后台。
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="block font-bold text-gray-750">商家登录主邮箱 (Manager Account) *登录主键</label>
                  <input 
                    type="email" 
                    placeholder="如: master_spa_west@company.com"
                    value={addForm.managerAccount} 
                    onChange={(e) => setAddForm({ ...addForm, managerAccount: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono font-black" 
                    style={{ borderRadius: '0px' }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-bold text-gray-750">关联的主店铺名称 (Principal Store Name)</label>
                  <input 
                    type="text" 
                    placeholder="如: 西域绿洲高端水疗会所一分店"
                    value={addForm.storeName} 
                    onChange={(e) => setAddForm({ ...addForm, storeName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-bold" 
                    style={{ borderRadius: '0px' }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block font-bold text-gray-700">连锁分店数量</label>
                    <input 
                      type="number" 
                      min="0"
                      value={addForm.branchesCount} 
                      onChange={(e) => setAddForm({ ...addForm, branchesCount: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono font-bold" 
                      style={{ borderRadius: '0px' }}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-bold text-gray-700">初始登录密码</label>
                    <input 
                      type="password" 
                      placeholder="不低于 5 位控制字符"
                      value={addForm.password} 
                      onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-widest" 
                      style={{ borderRadius: '0px' }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-bold text-gray-750">默许配备的特定商家的系统使用特权集:</label>
                  <div className="space-y-1 bg-slate-50 border border-slate-300 p-2 max-h-32 overflow-y-auto" style={{ borderRadius: '0px' }}>
                    {privilegeOptions.map((opt) => (
                      <label 
                        key={opt + '_init_merchant'}
                        className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 text-[11px] select-none font-semibold"
                      >
                        <input 
                          type="checkbox" 
                          checked={addForm.privileges.includes(opt)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAddForm({ ...addForm, privileges: [...addForm.privileges, opt] });
                            } else {
                              setAddForm({ ...addForm, privileges: addForm.privileges.filter(p => p !== opt) });
                            }
                          }}
                          className="cursor-pointer"
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {addFormError && (
                <div className="bg-red-50 border border-red-350 p-2 text-red-650 font-bold select-none text-[10px]" style={{ borderRadius: '0px' }}>
                  ❌ 数据冲突: {addFormError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => setAddMerchantModalVisible(false)}
                  style={{ borderRadius: '0px' }}
                  className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 font-semibold cursor-pointer text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitAddMerchantForm}
                  style={{ borderRadius: '0px' }}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-850 text-white font-black cursor-pointer text-xs transition-colors"
                >
                  批准录入账户
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
