import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, Search, Plus, Trash2, Key, Settings, X, RotateCcw } from 'lucide-react';
import { useUserStore } from '../../stores/user';
import { Role } from '../../utils/roleEnum';

interface AdminStruct {
  id: number;
  username: string;
  account: string;
  role: 'SUPER_ADMIN' | 'PLATFORM_ADMIN';
  createdDate: string;
  permissions: string[];
}

export default function AdminManagement() {
  const { currentRole, setCurrentRole } = useUserStore();

  // Memorable state for the SUPER_ADMIN's own password
  const [superAdminPass, setSuperAdminPass] = useState('admin123');

  // List of Platform Admins (role: PLATFORM_ADMIN) to manage
  const [adminsList, setAdminsList] = useState<AdminStruct[]>([
    { 
      id: 10001, 
      username: '区域运营高级主审', 
      account: 'platform_reviewer_1', 
      role: 'PLATFORM_ADMIN', 
      createdDate: '2026-03-24 16:51:30', 
      permissions: ['统计与仪表分析看板', '店铺信息编册与审核'] 
    },
    { 
      id: 10002, 
      username: '全国营销推广专员', 
      account: 'market_promoter', 
      role: 'PLATFORM_ADMIN', 
      createdDate: '2026-04-05 09:12:44', 
      permissions: ['优惠促销卡生成', '用户服务核销监察'] 
    },
    { 
      id: 10003, 
      username: '商户状态安全审查特员', 
      account: 'safety_officer_col', 
      role: 'PLATFORM_ADMIN', 
      createdDate: '2026-05-18 14:02:11', 
      permissions: ['系统行为日志调看', '店铺信息编册与审核'] 
    }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals status
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [isEditingSelf, setIsEditingSelf] = useState(false);
  const [targetAccountLabel, setTargetAccountLabel] = useState('');
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '' });
  const [passwordFormError, setPasswordFormError] = useState('');

  const [scopeModalVisible, setScopeModalVisible] = useState(false);
  const [targetPlatformAdmin, setTargetPlatformAdmin] = useState<AdminStruct | null>(null);
  const [tempPermissions, setTempPermissions] = useState<string[]>([]);
  
  const [addAdminModalVisible, setAddAdminModalVisible] = useState(false);
  const [addForm, setAddForm] = useState({
    account: '',
    username: '',
    password: '',
    permissions: [] as string[]
  });
  const [addFormError, setAddFormError] = useState('');

  const scopeOptions = [
    '统计与仪表分析看板',
    '高级商户账号注销权',
    '优惠促销卡生成',
    '店铺信息编册与审核',
    '用户服务核销监察',
    '系统行为日志调看'
  ];

  const filteredAdmins = adminsList.filter(a => 
    a.username.toLowerCase().includes(searchQuery.toLowerCase()) || 
    a.account.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleReset = () => {
    setSearchQuery('');
  };

  // 1. Password edit triggering for SUPER_ADMIN themselves (Requires Old Password validation)
  const handleConfigureSelfPassword = () => {
    setIsEditingSelf(true);
    setTargetAccountLabel('超级大区系统管理员自身 (founder_ariva)');
    setPasswordForm({ oldPassword: '', newPassword: '' });
    setPasswordFormError('');
    setPasswordModalVisible(true);
  };

  // 2. Password edit triggering for Subordinate (Does NOT require Old Password validation)
  const handleChangeSubordinatePassword = (admin: AdminStruct) => {
    setIsEditingSelf(false);
    setTargetAccountLabel(`${admin.username} (${admin.account})`);
    setPasswordForm({ oldPassword: '', newPassword: '' });
    setPasswordFormError('');
    setPasswordModalVisible(true);
  };

  // Submitting password edits
  const submitPasswordForm = () => {
    setPasswordFormError('');

    if (!passwordForm.newPassword || passwordForm.newPassword.length < 5) {
      setPasswordFormError('设定的新密码格式错误：不可少于 5 位安全控制字符。');
      return;
    }

    if (isEditingSelf) {
      if (passwordForm.oldPassword !== superAdminPass) {
        setPasswordFormError('旧密码核验不匹配！无法更新最高管理员密钥。');
        return;
      }
      setSuperAdminPass(passwordForm.newPassword);
      alert(`🔑 身份凭证审核成功。您的最高系统管理员登录密码已被重写为: [${passwordForm.newPassword}]！`);
    } else {
      alert(`🔑 下级修改成功！成功为 ${targetAccountLabel} 直接变更登录密码为: [${passwordForm.newPassword}]！已实时同步底层。`);
    }

    setPasswordModalVisible(false);
  };

  // Platform permission scope adjusting
  const handleTweakSubordinateScope = (admin: AdminStruct) => {
    setTargetPlatformAdmin(admin);
    setTempPermissions([...(admin.permissions || [])]);
    setScopeModalVisible(true);
  };

  const submitScopeForm = () => {
    if (targetPlatformAdmin) {
      setAdminsList(adminsList.map(a => 
        a.id === targetPlatformAdmin.id 
          ? { ...a, permissions: [...tempPermissions] } 
          : a
      ));
      alert(`🛡️ 权限集已覆盖！成功重配下属 [${targetPlatformAdmin.username}] 的平台管理视角权限范围。`);
    }
    setScopeModalVisible(false);
  };

  // Physically deletes a platform admin
  const handleDeletePlatformAdmin = (admin: AdminStruct) => {
    if (window.confirm(`🔒 安全警示：您确定要注销并删除平台管理员 [${admin.username} / ${admin.account}] 吗？该操作物理不可逆。`)) {
      setAdminsList(adminsList.filter(a => a.id !== admin.id));
      alert('已成功将此平台管理员移出项目在册名录。');
    }
  };

  // Add Admin Account Modal Triggering
  const handleOpenAddAdminModal = () => {
    setAddForm({
      account: '',
      username: '',
      password: '',
      permissions: ['统计与仪表分析看板', '店铺信息编册与审核']
    });
    setAddFormError('');
    setAddAdminModalVisible(true);
  };

  const submitAddAdminForm = () => {
    setAddFormError('');

    if (!addForm.account || addForm.account.trim().length === 0) {
      setAddFormError('管理员登录账号名(Account)不可留空！');
      return;
    }
    if (!addForm.username || addForm.username.trim().length === 0) {
      setAddFormError('管理员描述名称(Username)不可留空！');
      return;
    }
    if (!addForm.password || addForm.password.length < 5) {
      setAddFormError('初始控制密码不可短于 5 位关键控制字符！');
      return;
    }

    const exists = adminsList.some(a => a.account.toLowerCase() === addForm.account.trim().toLowerCase());
    if (exists) {
      setAddFormError(`管理员账号 [${addForm.account}] 已存在，无法重复录入！`);
      return;
    }

    const newAdmin: AdminStruct = {
      id: Date.now() % 100000,
      account: addForm.account.trim(),
      username: addForm.username.trim(),
      role: 'PLATFORM_ADMIN',
      createdDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
      permissions: [...addForm.permissions]
    };

    setAdminsList([newAdmin, ...adminsList]);
    alert(`✨ 签署录入成功！成功为 ${newAdmin.username} (${newAdmin.account}) 开辟登录渠道，角色默认为 PLATFORM_ADMIN。`);
    setAddAdminModalVisible(false);
  };

  // GUARD CHECK: Only SUPER_ADMIN has functional display here
  if (currentRole !== Role.SUPER_ADMIN) {
    return (
      <div className="space-y-6 select-none font-sans antialiased text-gray-800">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>系统管理</span>
          <span>/</span>
          <span className="text-gray-600 font-bold">高级系统管理员页面</span>
        </div>

        <div className="bg-red-50 border-2 border-red-500 p-8 text-center space-y-4 max-w-2xl mx-auto my-12" style={{ borderRadius: '0px' }}>
          <span className="inline-block text-3xl">⚠️</span>
          <h2 className="text-base font-black text-red-900 uppercase tracking-widest font-mono">访问权限受限 | ACCESS RESTRICTED</h2>
          <p className="text-xs text-red-700 leading-relaxed max-w-md mx-auto">
            抱歉，该管理模块属于系统最高级别的安全隔离区。您的当前角色身份为 
            <span className="font-bold bg-red-200 text-red-900 px-1.5 py-0.5 ml-1 font-mono">[{currentRole}]</span>。
            只有超级系统管理员 (<span className="font-bold underline">SUPER_ADMIN</span>) 才被允许在此处管理平台运营人员。
          </p>
          <div className="pt-2">
            <button 
              type="button"
              onClick={() => setCurrentRole(Role.SUPER_ADMIN)} 
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition-all border-none"
              style={{ borderRadius: '0px' }}
            >
              附身为 SUPER_ADMIN 解锁进入
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
        <span className="text-gray-600 font-bold">高级系统管理员 (Admin List)</span>
      </div>

      {/* SUPER_ADMIN active header bar */}
      <div className="bg-slate-900 text-white p-5 border-l-4 border-[#48a1a1] flex flex-wrap items-center justify-between gap-4" style={{ borderRadius: '0px' }}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 bg-emerald-400 animate-pulse"></span>
            <span className="text-xs font-black uppercase tracking-widest font-mono text-emerald-400">Active Session Status</span>
          </div>
          <h3 className="text-sm font-black">
            当前登入：超级创始人 (Account: <span className="font-mono text-[#48a1a1]">founder_ariva</span>)
          </h3>
          <p className="text-[11px] text-gray-400">
            管理员密码修改规范：可以直接修改下属平台管理员密码（无需其旧密码验证）。但若尝试修改自身密码，必须通过您目前的在册旧密码核实。
          </p>
        </div>
        <button 
          type="button" 
          onClick={handleConfigureSelfPassword}
          className="text-xs font-bold bg-slate-800 hover:bg-slate-700 text-[#48a1a1] border border-[#48a1a1]/30 px-4 py-2 transition-all cursor-pointer"
          style={{ borderRadius: '0px' }}
        >
          🔐 修改最高管理员自身密码 (需验证旧密码)
        </button>
      </div>

      {/* Primary Card - strict straight-corner style */}
      <div className="bg-white border-2 border-slate-900 shadow-lg overflow-hidden" style={{ borderRadius: '0px' }}>
        <div className="bg-slate-50 border-b-2 border-slate-900 px-6 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderRadius: '0px' }}>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-zinc-800 text-white font-mono text-[10px] font-bold tracking-wider" style={{ borderRadius: '0px' }}>
              EL-CARD
            </span>
            <div>
              <h4 className="text-xs font-bold text-slate-400 font-mono uppercase">Privileged administrator roster</h4>
              <h3 className="text-sm font-black text-gray-900">平台后台主要管理员 (PLATFORM_ADMIN) 数据矩阵</h3>
            </div>
          </div>
          <span className="text-xs bg-red-50 text-red-700 px-2.5 py-1 font-mono font-bold border border-red-200" style={{ borderRadius: '0px' }}>
            SUPER_ADMIN 专属授权
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
                placeholder="搜索在册管理员账号 / 描述..."
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
              清空
            </button>
          </div>

          <button
            onClick={handleOpenAddAdminModal}
            className="px-4 py-1.5 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
            style={{ borderRadius: '0px' }}
          >
            <Plus className="w-4 h-4" />
            新增平台管理账号
          </button>
        </div>

        {/* Directory table */}
        <div className="p-6 bg-white overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse border-2 border-slate-900" style={{ borderRadius: '0px' }}>
            <thead>
              <tr className="bg-slate-100 text-slate-800 border-b-2 border-slate-900 font-bold">
                <th className="p-3 border-r border-slate-200 font-mono">UID</th>
                <th className="p-3 border-r border-slate-200">登录主账号 / Account</th>
                <th className="p-3 border-r border-slate-200">描述姓名 / Username</th>
                <th className="p-3 border-r border-slate-200">系统权限角色</th>
                <th className="p-3 border-r border-slate-200">注册挂载时间</th>
                <th className="p-3 border-r border-slate-200">已授权平台模块</th>
                <th className="p-3 text-center">安全管控操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredAdmins.map((admin) => (
                <tr key={admin.id} className="hover:bg-gray-50 border-b border-gray-200 transition-colors">
                  <td className="p-3 border-r border-slate-200 font-mono font-bold">{admin.id}</td>
                  <td className="p-3 border-r border-slate-200 font-mono font-bold text-slate-950">{admin.account}</td>
                  <td className="p-3 border-r border-slate-200 font-bold text-gray-700">{admin.username}</td>
                  <td className="p-3 border-r border-slate-200">
                    <span 
                      style={{ borderRadius: '0px' }}
                      className="px-2 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 text-[10px] font-bold font-mono tracking-wide"
                    >
                      {admin.role}
                    </span>
                  </td>
                  <td className="p-3 border-r border-slate-200 font-mono text-gray-400">{admin.createdDate}</td>
                  <td className="p-3 border-r border-slate-200">
                    <div className="flex flex-wrap gap-1">
                      {admin.permissions.map((perm) => (
                        <span 
                          key={perm}
                          style={{ borderRadius: '0px' }}
                          className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-slate-800 text-[9px] font-semibold"
                        >
                          ✓ {perm}
                        </span>
                      ))}
                      {admin.permissions.length === 0 && (
                        <span className="text-red-500 font-bold text-[9px]">🚨 未授予任何视图功能</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button 
                        onClick={() => handleChangeSubordinatePassword(admin)}
                        style={{ borderRadius: '0px' }}
                        className="text-[10px] font-black bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1.5 cursor-pointer flex items-center gap-1 border border-transparent"
                      >
                        <Key className="w-3 h-3" />
                        修改下级密码
                      </button>
                      <button 
                        onClick={() => handleTweakSubordinateScope(admin)}
                        style={{ borderRadius: '0px' }}
                        className="text-[10px] font-bold bg-white border border-slate-900 hover:bg-slate-100 text-slate-800 px-2.5 py-1.5 cursor-pointer flex items-center gap-1"
                      >
                        <Settings className="w-3 h-3" />
                        授权范围
                      </button>
                      <button 
                        onClick={() => handleDeletePlatformAdmin(admin)}
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
              {filteredAdmins.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400 bg-gray-50 border border-dashed border-gray-200">
                    未查找到任何匹配规则的安全系统管理员账户信息。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DIALOG 1: PASSWORD MODIFICATION MODAL */}
      {passwordModalVisible && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col" style={{ borderRadius: '0px' }}>
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950">
              <span className="text-xs font-black tracking-widest uppercase font-mono text-emerald-400">ACCESS KEY TWEAKER</span>
              <button onClick={() => setPasswordModalVisible(false)} className="text-slate-400 hover:text-white cursor-pointer font-bold font-mono text-lg select-none">×</button>
            </div>
            
            <div className="p-5 space-y-4 text-xs">
              <div className="border-b border-gray-100 pb-2">
                <h4 className="text-xs font-black text-slate-800">
                  🔒 控制端安全密钥更改: <span className="text-[#48a1a1] font-mono">[{targetAccountLabel}]</span>
                </h4>
                {isEditingSelf ? (
                  <p className="text-[10px] text-red-600 font-bold mt-1">
                    ⚠️ 安全警戒：这是您自己在册的最高系统管理员密码，一经更改将即时踢出旧会话，须输入旧密码核验。
                  </p>
                ) : (
                  <p className="text-[10px] text-emerald-600 font-semibold mt-1">
                    ➡️ 下属修改通道：您正在强行覆盖下级平台管理员登录凭证，请直接写入设定值，无需旧密码核算。
                  </p>
                )}
              </div>

              <div className="space-y-3">
                {isEditingSelf && (
                  <div className="space-y-1">
                    <label className="block font-bold text-gray-650">请输入旧的管理员控制密码 (Current Old Password)</label>
                    <input 
                      type="password" 
                      placeholder="初始默认密码测试为: admin123"
                      value={passwordForm.oldPassword} 
                      onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-widest" 
                      style={{ borderRadius: '0px' }}
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block font-bold text-gray-650">
                    {isEditingSelf ? '设置高强度的安全新密码 (New Password)' : '直接设置分配新密码 (Direct New Password)'}
                  </label>
                  <input 
                    type="password" 
                    placeholder="请输入新安全控制密码 (最低 5 位)" 
                    value={passwordForm.newPassword} 
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-widest" 
                    style={{ borderRadius: '0px' }}
                  />
                </div>
              </div>

              {passwordFormError && (
                <div className="bg-red-50 border border-red-300 p-2 text-red-650 font-bold select-none text-[10px]" style={{ borderRadius: '0px' }}>
                  ❌ 访问拦截：{passwordFormError}
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
                  onClick={submitPasswordForm}
                  style={{ borderRadius: '0px' }}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-850 text-white font-black cursor-pointer text-xs transition-colors"
                >
                  批准更新配置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG 2: ADJUST SCOPE PERMISSIONS FOR PLATFORM_ADMIN */}
      {scopeModalVisible && targetPlatformAdmin && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col" style={{ borderRadius: '0px' }}>
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950">
              <span className="text-xs font-black tracking-widest uppercase font-mono text-emerald-400">TWEAK BOARD ACCESSES</span>
              <button onClick={() => setScopeModalVisible(false)} className="text-slate-400 hover:text-white cursor-pointer font-bold font-mono text-lg select-none">×</button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <h4 className="text-xs font-black text-slate-800">
                  设置主要的系统功能访问权及范围: {targetPlatformAdmin.username}
                </h4>
                <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">
                  勾选之范围将会写入其对应的 PLATFORM_ADMIN 会话控制令牌中。
                </p>
              </div>

              <div className="space-y-2.5 bg-slate-50 border border-slate-200 p-4" style={{ borderRadius: '0px' }}>
                {scopeOptions.map((opt) => (
                  <label 
                    key={opt}
                    className="flex items-start gap-2 cursor-pointer font-semibold text-gray-700 hover:text-slate-900 select-none"
                  >
                    <input 
                      type="checkbox" 
                      value={opt}
                      checked={tempPermissions.includes(opt)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setTempPermissions([...tempPermissions, opt]);
                        } else {
                          setTempPermissions(tempPermissions.filter(p => p !== opt));
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
                  onClick={() => setScopeModalVisible(false)}
                  style={{ borderRadius: '0px' }}
                  className="px-4 py-2 border border-blue-150 text-gray-600 font-semibold cursor-pointer text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitScopeForm}
                  style={{ borderRadius: '0px' }}
                  className="px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-black cursor-pointer text-xs transition-colors"
                >
                  一键覆盖权限
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG 3: SIGN AND CREATE PLATFORM_ADMIN */}
      {addAdminModalVisible && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col" style={{ borderRadius: '0px' }}>
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950">
              <span className="text-xs font-black tracking-widest uppercase font-mono text-emerald-400">CREATE PLATFORM ADM</span>
              <button onClick={() => setAddAdminModalVisible(false)} className="text-slate-400 hover:text-white cursor-pointer font-bold font-mono text-lg select-none">×</button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="border-b border-gray-100 pb-2">
                <h4 className="text-xs font-black text-slate-800">
                  ➕ 签约并新增平台管理员账户
                </h4>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  为团队内新加入的高级平台运营人员提供单独的特定管理员。
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="block font-bold text-gray-700">登录账号 (Account) *物理主键</label>
                  <input 
                    type="text" 
                    placeholder="如: regional_coordinator_west"
                    value={addForm.account} 
                    onChange={(e) => setAddForm({ ...addForm, account: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono font-bold" 
                    style={{ borderRadius: '0px' }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-bold text-gray-700">平台管理员特定姓名 (Username)</label>
                  <input 
                    type="text" 
                    placeholder="如: 西南区营销核销主审关"
                    value={addForm.username} 
                    onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1]" 
                    style={{ borderRadius: '0px' }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-bold text-gray-700">配置登录初始安全密码 (Password)</label>
                  <input 
                    type="password" 
                    placeholder="请设定不低于 5 位高强度通用密码"
                    value={addForm.password} 
                    onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-widest" 
                    style={{ borderRadius: '0px' }}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block font-bold text-gray-750">默认携带的平台操作访问范围:</label>
                  <div className="space-y-1 bg-slate-50 border border-slate-300 p-2 max-h-32 overflow-y-auto" style={{ borderRadius: '0px' }}>
                    {scopeOptions.map((opt) => (
                      <label 
                        key={opt + '_init_tsx'}
                        className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 text-[11px] select-none font-semibold"
                      >
                        <input 
                          type="checkbox" 
                          checked={addForm.permissions.includes(opt)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAddForm({ ...addForm, permissions: [...addForm.permissions, opt] });
                            } else {
                              setAddForm({ ...addForm, permissions: addForm.permissions.filter(p => p !== opt) });
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
                <div className="bg-red-50 border border-red-355 p-2 text-red-650 font-bold select-none text-[10px]" style={{ borderRadius: '0px' }}>
                  ❌ 数据冲突: {addFormError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => setAddAdminModalVisible(false)}
                  style={{ borderRadius: '0px' }}
                  className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 font-semibold cursor-pointer text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitAddAdminForm}
                  style={{ borderRadius: '0px' }}
                  className="px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-black cursor-pointer text-xs transition-colors"
                >
                  签约并授权录入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
