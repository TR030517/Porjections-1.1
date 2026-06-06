<template>
  <div class="merchant-account-container font-sans text-gray-800 select-none p-6">
    <!-- Breadcrumb Indicator -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2 text-xs text-gray-400">
        <span>系统管理</span>
        <span>/</span>
        <span class="text-gray-600 font-bold">商家账号管理 (merchant-account.vue)</span>
      </div>
      
      <!-- Sandbox testing overrides -->
      <div class="flex items-center gap-2 bg-slate-100 border border-slate-200 px-3 py-1 text-xs">
        <span class="text-gray-500 font-bold">模拟切换用户角色 (测试用):</span>
        <select 
          v-model="currentRole"
          class="bg-white border border-gray-300 text-[11px] font-bold px-1.5 py-0.5 outline-none rounded-none"
          style="border-radius: 0px !important;"
        >
          <option value="SUPER_ADMIN">SUPER_ADMIN (可看，具备完全删增权)</option>
          <option value="PLATFORM_ADMIN">PLATFORM_ADMIN (可看，具备基本重置密码权)</option>
          <option value="STORE_MANAGER">STORE_MANAGER (被完全隔离屏蔽)</option>
        </select>
      </div>
    </div>

    <!-- GUARD BLOCK: Only SUPER_ADMIN and PLATFORM_ADMIN can view this file -->
    <div v-if="currentRole !== 'SUPER_ADMIN' && currentRole !== 'PLATFORM_ADMIN'" class="bg-amber-50 border-2 border-amber-500 p-8 text-center space-y-4 max-w-2xl mx-auto my-12 animated fadeIn rounded-none" style="border-radius: 0px !important;">
      <span class="inline-block text-3xl">⚠️</span>
      <h2 class="text-sm font-black text-amber-900 uppercase tracking-widest font-mono">未授权的会话区域 | AUTHORIZATION BLOCK</h2>
      <p class="text-xs text-amber-700 leading-relaxed max-w-md mx-auto font-semibold">
        当前会话已被隔离。模块 (merchant-account.vue) 仅对超级系统管理员 (SUPER_ADMIN) 
        以及平台主要运营管理员 (PLATFORM_ADMIN) 物理可见及授权。
        由于您当前的角色为 <span class="bg-amber-250 text-amber-900 px-1.5 py-0.5 font-mono">[{{ currentRole }}]</span> 商家店长，此挂载入口已被物理封锁。
      </p>
      <div class="pt-2">
        <button 
          type="button"
          @click="currentRole = 'PLATFORM_ADMIN'" 
          class="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition-all border-none rounded-none"
          style="border-radius: 0px !important;"
        >
          附身为 PLATFORM_ADMIN 进行联管
        </button>
      </div>
    </div>

    <!-- MAIN INTERFACE: PRIVILEGED ROLES ONLY -->
    <div v-else class="space-y-6 animated fadeIn animate-none">
      <!-- Self Password Section Banner for the operating Administrator to experience change own password checking -->
      <div class="bg-slate-100 border-2 border-slate-900 p-5 flex flex-wrap items-center justify-between gap-4 rounded-none" style="border-radius: 0px !important;">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="inline-block w-2.5 h-2.5 bg-[#48a1a1] shrink-0"></span>
            <span class="text-xs font-black uppercase tracking-wider text-slate-700">操作管理员专属：自身密码强更验证通道</span>
          </div>
          <p class="text-xs text-gray-600">
            当代表您自己级别（{{ currentRole }} - 登入口: <span class="font-mono font-bold text-gray-800">admin_channel</span>）进行个人密码重更时，需要通过在册旧密码核实。
          </p>
        </div>
        <button 
          type="button" 
          @click="handleConfigureSelfPassword"
          class="el-button text-xs font-bold bg-white hover:bg-slate-50 text-slate-800 border-2 border-slate-900 px-4 py-2 cursor-pointer rounded-none active:scale-[0.98]"
          style="border-radius: 0px !important;"
        >
          🔑 修改当前管理员自身密码 (需输入旧密码)
        </button>
      </div>

      <!-- Main card container -->
      <div class="el-card border-2 border-slate-900 bg-white shadow-xl rounded-none animate-none" style="border-radius: 0px !important;">
        <!-- Header -->
        <div class="el-card-header border-b-2 border-slate-900 p-5 bg-slate-50 flex flex-wrap items-center justify-between gap-4 rounded-none" style="border-radius: 0px !important;">
          <div class="space-y-0.5">
            <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest font-mono">Merchant account directories</h4>
            <h3 class="text-sm font-black text-slate-900">商圈店长（STORE_MANAGER）主账号及使用权限管理</h3>
          </div>

          <div class="flex items-center gap-2">
            <input 
              type="text" 
              v-model="searchQuery" 
              placeholder="搜索商家主账号 / 绑定店铺..." 
              class="el-input font-sans text-xs bg-white border border-gray-350 px-3 py-1.5 focus:outline-none focus:border-[#48a1a1] w-56 rounded-none" 
              style="border-radius: 0px !important;"
            />
            <button 
              type="button" 
              @click="handleReset"
              class="el-button text-xs font-bold px-3 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-205 text-gray-600 cursor-pointer rounded-none"
              style="border-radius: 0px !important;"
            >
              重置
            </button>
            <button 
              type="button" 
              @click="handleOpenAddMerchant"
              class="el-button px-4 py-1.5 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-bold text-xs cursor-pointer transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              ➕ 开辟并签署商盟店长账号 (STORE_MANAGER)
            </button>
          </div>
        </div>

        <!-- Table data listing of STORE_MANAGERs -->
        <div class="p-6 overflow-x-auto">
          <table class="w-full text-xs text-left border-collapse border-2 border-slate-900 rounded-none font-sans" style="border-radius: 0px !important;">
            <thead>
              <tr class="bg-slate-100 text-slate-800 border-b-2 border-slate-900 font-bold">
                <th class="p-3 border-r border-slate-900 font-mono">UID</th>
                <th class="p-3 border-r border-slate-900">商家店长登录邮箱 / Principal Account</th>
                <th class="p-3 border-r border-slate-900">绑定的主要店铺名称 / Connected Principal Store</th>
                <th class="p-3 border-r border-slate-900 text-center">旗下拥有的连锁分店数</th>
                <th class="p-3 border-r border-slate-900 font-mono text-center">最后操作核实时间</th>
                <th class="p-3 border-r border-slate-900 text-center font-bold">自主特权配置范围</th>
                <th class="p-3 text-center">二级账号安全管控</th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="merchant in filteredMerchants" 
                :key="merchant.id"
                class="hover:bg-slate-50 border-b border-gray-200 last:border-b-0 transition-colors"
              >
                <!-- ID -->
                <td class="p-3 border-r border-slate-200 font-mono font-bold">{{ merchant.id }}</td>
                
                <!-- Manager Account -->
                <td class="p-3 border-r border-slate-200 font-mono font-bold text-slate-900">{{ merchant.managerAccount }}</td>
                
                <!-- Bound Principal Store -->
                <td class="p-3 border-r border-slate-200 font-bold text-gray-700">
                  <span class="inline-block bg-[#eef8f8] border border-[#cbd5e1] text-[#48a1a1] px-2 py-0.5 rounded-none" style="border-radius: 0px !important;">
                    🏨 {{ merchant.storeName }}
                  </span>
                </td>
                
                <!-- Branches Count -->
                <td class="p-3 border-r border-slate-200 text-center font-mono font-bold">
                  <span class="inline-block bg-slate-900 text-slate-200 px-2 py-0.5 rounded-none text-[10px]" style="border-radius: 0px !important;">
                    {{ merchant.branchesCount }} 物理分支店
                  </span>
                </td>
                
                <!-- Update date -->
                <td class="p-3 border-r border-slate-200 text-center font-mono text-gray-500">{{ merchant.updatedDate }}</td>
                
                <!-- System usage privileges listing -->
                <td class="p-3 border-r border-slate-200 font-semibold text-[10px] text-gray-650">
                  <div class="flex flex-wrap gap-1">
                    <span 
                      v-for="priv in merchant.privileges" 
                      :key="priv" 
                      class="bg-slate-100 border border-gray-200 px-1.5 py-0.5 text-zinc-700 text-[9px] font-bold rounded-none"
                      style="border-radius: 0px !important;"
                    >
                      ✓ {{ priv }}
                    </span>
                    <span v-if="!merchant.privileges || merchant.privileges.length === 0" class="text-rose-600 font-mono text-[9px]">
                      🚨 冻结全部功能(纯展示模式)
                    </span>
                  </div>
                </td>

                <!-- Action column -->
                <td class="p-3 text-center">
                  <div class="flex items-center justify-center gap-1.5">
                    <button 
                      type="button" 
                      @click="handleResetMerchantPassword(merchant)"
                      class="text-[10px] font-bold bg-[#48a1a1] hover:bg-[#3d8b8b] text-white px-2.5 py-1.5 cursor-pointer rounded-none"
                      style="border-radius: 0px !important;"
                    >
                      重置商家密码
                    </button>
                    <button 
                      type="button" 
                      @click="handleAdjustMerchantPermissions(merchant)"
                      class="text-[10px] font-bold bg-white border border-slate-900 hover:bg-slate-100 text-slate-900 px-2.5 py-1.5 cursor-pointer rounded-none"
                      style="border-radius: 0px !important;"
                    >
                      调整系统使用权限
                    </button>
                    <button 
                      type="button" 
                      @click="handleRemoveMerchantAccount(merchant)"
                      class="text-[10px] font-bold bg-red-50 border border-red-300 hover:bg-red-100 text-red-650 px-2.5 py-1.5 cursor-pointer rounded-none"
                      style="border-radius: 0px !important;"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="filteredMerchants.length === 0">
                <td colspan="7" class="text-center py-16 text-gray-400 bg-slate-50 border border-dashed border-gray-300">
                  当前表格暂无任何在册签署的商盟店长（STORE_MANAGER）主账户匹配。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- DIALOG MODAL 1: Password reset/modify overlay (FORCE SQUARE EDGES) -->
    <div v-if="passwordModalVisible" class="fixed inset-0 z-[2000] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col rounded-none animate-none" style="border-radius: 0px !important;">
        <!-- Header -->
        <div class="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-zinc-950 rounded-none animate-none" style="border-radius: 0px !important;">
          <span class="text-xs font-black tracking-widest font-mono text-emerald-450 uppercase">ACCOUNT ACCESS RESET</span>
          <button @click="passwordModalVisible = false" class="text-gray-400 hover:text-white cursor-pointer font-bold text-lg select-none">×</button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-4 text-xs font-sans">
          <div class="border-b border-gray-100 pb-2">
            <h4 class="text-xs font-black text-slate-800">
              🔒 密码变更：针对 <span class="text-[#48a1a1]">[{{ targetAccountLabel }}]</span>
            </h4>
            <p v-if="isEditingSelf" class="text-[10px] text-red-600 font-bold mt-1">
              ⚠️ 核验规则：由于您正在更改您自身的管理员密钥，必须键入旧密码以供平台底层做合法身份核准！
            </p>
            <p v-else class="text-[10px] text-emerald-600 font-bold mt-1">
              ⚠️ 下级直更：您是以高层管理员身份代表店长配置明文凭据。对方密码将无需通过旧密码验证即可实时更迭生效。
            </p>
          </div>

          <!-- Fields -->
          <div class="space-y-3">
            <!-- Old password verification field (Admins editing SELF only) -->
            <div v-if="isEditingSelf" class="space-y-1">
              <label class="block font-semibold text-gray-600">请输入旧的管理员登录密码 (Current Account Password)</label>
              <input 
                type="password" 
                v-model="passwordForm.oldPassword" 
                placeholder="初次模拟默认密码为: admin123"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-widest rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>

            <!-- New password field -->
            <div class="space-y-1">
              <label class="block font-semibold text-gray-600">
                {{ isEditingSelf ? '设置高强度的安全新密码 (New Password)' : '直接设置分配新密码 (Direct New Password)' }}
              </label>
              <input 
                type="password" 
                v-model="passwordForm.newPassword" 
                placeholder="请输入新安全控制密码 (不低于5位)"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-widest rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>
          </div>

          <div v-if="passwordFormError" class="bg-red-50 border border-red-300 p-2 text-red-700 text-[10px] font-bold rounded-none" style="border-radius: 0px !important;">
            ❌ 系统拦截：{{ passwordFormError }}
          </div>

          <!-- Footer buttons -->
          <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button 
              type="button" 
              @click="passwordModalVisible = false" 
              class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 font-bold hover:text-slate-800 transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              取消
            </button>
            <button 
              type="button" 
              @click="submitPasswordForm" 
              class="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-black transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              物理生效密码
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- DIALOG MODAL 2: Adjust System Permissions (STORE_MANAGER) -->
    <div v-if="privilegeModalVisible" class="fixed inset-0 z-[2000] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col rounded-none" style="border-radius: 0px !important;">
        <!-- Header -->
        <div class="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950 rounded-none" style="border-radius: 0px !important;">
          <span class="text-xs font-black tracking-widest uppercase font-mono text-emerald-450">TWEAK MERCHANT SYSTEM USAGE</span>
          <button @click="privilegeModalVisible = false" class="text-gray-400 hover:text-white cursor-pointer font-bold text-lg select-none">×</button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-4 text-xs font-sans">
          <div>
            <h4 class="text-xs font-black text-slate-800">
              调整系统使用权限: {{ targetMerchantItem?.managerAccount }}
            </h4>
            <p class="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">
              设定该商家账号在其关联店铺主页能运行的系统管理特权或业务子面板。
            </p>
          </div>

          <div class="space-y-2.5 bg-slate-50 border border-slate-200 p-4 rounded-none" style="border-radius: 0px !important;">
            <label 
              v-for="opt in privilegeOptions" 
              :key="opt"
              class="flex items-start gap-2 cursor-pointer font-semibold text-gray-700 hover:text-slate-900"
            >
              <input 
                type="checkbox" 
                :value="opt" 
                v-model="tempPrivileges" 
                class="mt-0.5 cursor-pointer"
              />
              <span>{{ opt }}</span>
            </label>
          </div>

          <!-- Footer buttons -->
          <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button 
              type="button" 
              @click="privilegeModalVisible = false" 
              class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 font-bold hover:text-slate-800 transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              取消
            </button>
            <button 
              type="button" 
              @click="submitPrivilegeForm" 
              class="px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-black transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              确定更改授权
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- DIALOG MODAL 3: Add/Create STORE_MANAGER Account -->
    <div v-if="addMerchantModalVisible" class="fixed inset-0 z-[2000] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col rounded-none" style="border-radius: 0px !important;">
        <!-- Header -->
        <div class="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950 rounded-none" style="border-radius: 0px !important;">
          <span class="text-xs font-black tracking-wider uppercase font-mono text-emerald-450">AUTHENTICATE NEW STORE AGENT</span>
          <button @click="addMerchantModalVisible = false" class="text-gray-400 hover:text-white cursor-pointer font-bold text-lg select-none">×</button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-4 text-xs font-sans">
          <div class="border-b border-slate-100 pb-2">
            <h4 class="text-xs font-black text-slate-800">
              新增签署商盟店长管理账号
            </h4>
            <p class="text-[10px] text-gray-400 mt-0.5">
              为入驻物理门店签约高特权的店长(STORE_MANAGER)主账号并绑定对应的店铺实体。
            </p>
          </div>

          <!-- Fields -->
          <div class="space-y-3">
            <div class="space-y-1">
              <label class="block font-bold text-gray-700">店长主账号 (邮箱 / Account Email)</label>
              <input 
                type="email" 
                v-model="addForm.managerAccount" 
                placeholder="例如: boss_aurora@spaclinic.io"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>

            <div class="space-y-1">
              <label class="block font-bold text-gray-700">关联绑定的主要门店 (Principal Store Mapping)</label>
              <select 
                v-model="addForm.storeName" 
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] rounded-none select-none"
                style="border-radius: 0px !important;"
              >
                <option value="Ariva Spa 总部旗舰店">Ariva Spa 总部旗舰店 (ID: 3246)</option>
                <option value="Roes Spa 经典分院">Roes Spa 经典分院 (ID: 3221)</option>
                <option value="Littleton Chiropractic">Littleton Chiropractic (ID: 3255)</option>
                <option value="Aurora Massage Station">Aurora Massage Station (ID: 3290)</option>
              </select>
            </div>

            <div class="space-y-1">
              <label class="block font-bold text-gray-700">下辖连锁分店数量 (Initial Branch Volume)</label>
              <input 
                type="number" 
                v-model="addForm.branchesCount" 
                min="0"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>

            <div class="space-y-1">
              <label class="block font-bold text-gray-700">设定店长账号初始安全密码 (Access Code)</label>
              <input 
                type="password" 
                v-model="addForm.password" 
                placeholder="设置 5 位以上的初始登录重更密码"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>

            <!-- Privilege configuration check -->
            <div class="space-y-1.5">
              <label class="block font-bold text-gray-750">默认授权携带的系统特权能力:</label>
              <div class="space-y-1 bg-slate-50 border border-slate-300 p-2.5 rounded-none" style="border-radius: 0px !important;">
                <label 
                  v-for="opt in privilegeOptions" 
                  :key="opt + '_init'"
                  class="flex items-center gap-1.5 cursor-pointer hover:text-slate-900"
                >
                  <input 
                    type="checkbox" 
                    :value="opt" 
                    v-model="addForm.privileges" 
                    class="cursor-pointer"
                  />
                  <span class="text-[11px]">{{ opt }}</span>
                </label>
              </div>
            </div>
          </div>

          <!-- Error Feedback -->
          <div v-if="addFormError" class="bg-red-50 border border-red-300 p-2 text-red-650 text-[10px] font-semibold rounded-none" style="border-radius: 0px !important;">
            ❌ 数据冲突：{{ addFormError }}
          </div>

          <!-- Footer Buttons -->
          <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button 
              type="button" 
              @click="addMerchantModalVisible = false" 
              class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 font-bold hover:text-slate-800 transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              放弃并退出
            </button>
            <button 
              type="button" 
              @click="submitAddMerchantForm" 
              class="px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-black transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              批准注册签署
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface MerchantStruct {
  id: number;
  managerAccount: string;
  storeName: string;
  branchesCount: number;
  updatedDate: string;
  privileges: string[];
}

// Sandbox role simulation hook
const currentRole = ref<'SUPER_ADMIN' | 'PLATFORM_ADMIN' | 'STORE_MANAGER'>('SUPER_ADMIN');

// Operating Admin's own current mock password (starts as 'admin123')
const loggedInAdminPassword = ref('admin123');

// Preset state list of registered STORE_MANAGERs 
const merchantsList = ref<MerchantStruct[]>([
  { 
    id: 90021, 
    managerAccount: 'boss_ariva@arivaspa.com', 
    storeName: 'Ariva Spa 总部旗舰店', 
    branchesCount: 3, 
    updatedDate: '2026-06-02 18:24:11',
    privileges: ['面膜/按摩优惠卡发放权限', '连锁所有分店（hasBranches）注册修改权']
  },
  { 
    id: 90022, 
    managerAccount: 'manager_roes@roesspa.com', 
    storeName: 'Roes Spa 经典分院', 
    branchesCount: 2, 
    updatedDate: '2026-06-03 10:45:30',
    privileges: ['面膜/按摩优惠卡发放权限', '自主申请提现经营利润查看权']
  },
  { 
    id: 90023, 
    managerAccount: 'boss_oasis@oasiswell.org', 
    storeName: 'Oasis Health (温和按摩中心)', 
    branchesCount: 0, 
    updatedDate: '2026-05-29 08:12:00',
    privileges: ['自主申请提现经营利润查看权']
  },
  { 
    id: 90024, 
    managerAccount: 'lilac_springs@mineralhot.com', 
    storeName: 'Lilac Mineral Hot Springs', 
    branchesCount: 5, 
    updatedDate: '2026-06-01 14:02:11',
    privileges: ['全部功能冻结(纯展示模式)']
  }
]);

const searchQuery = ref('');

// Password Modal triggers
const passwordModalVisible = ref(false);
const isEditingSelf = ref(false);
const targetAccountLabel = ref('');
const passwordForm = ref({
  oldPassword: '',
  newPassword: ''
});
const passwordFormError = ref('');
const targetMerchantItem = ref<MerchantStruct | null>(null);

// Privileges editing overlays
const privilegeModalVisible = ref(false);
const tempPrivileges = ref<string[]>([]);
const privilegeOptions = [
  '面膜/按摩优惠卡发放权限',
  '连锁所有分店（hasBranches）注册修改权',
  '自主申请提现经营利润查看权',
  '客客流量统计导出分析权',
  '自研项目理疗服务设定权'
];

// Add Merchant overlays
const addMerchantModalVisible = ref(false);
const addForm = ref({
  managerAccount: '',
  storeName: 'Ariva Spa 总部旗舰店',
  branchesCount: 0,
  password: '',
  privileges: ['面膜/按摩优惠卡发放权限'] as string[]
});
const addFormError = ref('');

// Filter computation
const filteredMerchants = computed(() => {
  if (!searchQuery.value) return merchantsList.value;
  const q = searchQuery.value.toLowerCase();
  return merchantsList.value.filter(m => 
    m.managerAccount.toLowerCase().includes(q) || 
    m.storeName.toLowerCase().includes(q)
  );
});

const handleReset = () => {
  searchQuery.value = '';
};

// Admin's own password adjustment - REQUIRES OLD PASSWORD verification
const handleConfigureSelfPassword = () => {
  isEditingSelf.value = true;
  targetAccountLabel.value = `当前操作管理员账号 (My Account: ${currentRole.value})`;
  passwordForm.value.oldPassword = '';
  passwordForm.value.newPassword = '';
  passwordFormError.value = '';
  targetMerchantItem.value = null;
  passwordModalVisible.value = true;
};

// Reset subordinate STORE_MANAGER password - direct password setup!
const handleResetMerchantPassword = (merchant: MerchantStruct) => {
  isEditingSelf.value = false;
  targetAccountLabel.value = `${merchant.managerAccount} (物理ID: ${merchant.id})`;
  passwordForm.value.oldPassword = '';
  passwordForm.value.newPassword = '';
  passwordFormError.value = '';
  targetMerchantItem.value = merchant;
  passwordModalVisible.value = true;
};

// Submit password modal state
const submitPasswordForm = () => {
  passwordFormError.value = '';

  if (!passwordForm.value.newPassword || passwordForm.value.newPassword.length < 5) {
    passwordFormError.value = '新密码长度不合规，不可少于 5 位关键控制字符！';
    return;
  }

  // Self editing: Check old password
  if (isEditingSelf.value) {
    if (passwordForm.value.oldPassword !== loggedInAdminPassword.value) {
      passwordFormError.value = '您输入的当前管理员旧密码核验有误！更新失败！';
      return;
    }
    loggedInAdminPassword.value = passwordForm.value.newPassword;
    alert(`🔑 管理员身份确认成功。您的自身登录密钥已被重设为：[${passwordForm.value.newPassword}]！`);
  } 
  // Subordinate editing: Write directly with zero verification check
  else {
    alert(`🔑 下级重更成功！商家店长 ${targetAccountLabel.value} 的登录密码已被直接写为：[${passwordForm.value.newPassword}]！`);
  }

  passwordModalVisible.value = false;
};

// Open privileges overlay
const handleAdjustMerchantPermissions = (merchant: MerchantStruct) => {
  targetMerchantItem.value = merchant;
  tempPrivileges.value = [...(merchant.privileges || [])];
  privilegeModalVisible.value = true;
};

// Save privileges scopes
const submitPrivilegeForm = () => {
  if (targetMerchantItem.value) {
    const idx = merchantsList.value.findIndex(m => m.id === targetMerchantItem.value!.id);
    if (idx !== -1) {
      merchantsList.value[idx].privileges = [...tempPrivileges.value];
    }
    alert(`🛡️ 权限已覆盖！成功重定店主 [${targetMerchantItem.value.managerAccount}] 的自营控制台操作权限。`);
  }
  privilegeModalVisible.value = false;
};

// Remove merchant account
const handleRemoveMerchantAccount = (merchant: MerchantStruct) => {
  if (confirm(`🔒 强力注销核实：您确定要一键永久切断商家店长 (${merchant.managerAccount}) 的登录核销资格吗？绑定的主要实体和分店物理卡不会被删除：`)) {
    merchantsList.value = merchantsList.value.filter(m => m.id !== merchant.id);
    alert(`商家主账号已被永久移除并封阻！`);
  }
};

const handleOpenAddMerchant = () => {
  addForm.value.managerAccount = '';
  addForm.value.storeName = 'Ariva Spa 总部旗舰店';
  addForm.value.branchesCount = 0;
  addForm.value.password = '';
  addForm.value.privileges = ['面膜/按摩优惠卡发放权限'];
  addFormError.value = '';
  addMerchantModalVisible.value = true;
};

// Save newly generated store manager account
const submitAddMerchantForm = () => {
  addFormError.value = '';

  if (!addForm.value.managerAccount || !addForm.value.managerAccount.includes('@')) {
    addFormError.value = '店长主账号登录邮箱名不合规（须包含 @ 符号）！';
    return;
  }
  if (!addForm.value.password || addForm.value.password.length < 5) {
    addFormError.value = '密码不可留空且长度不得低于 5 位！';
    return;
  }

  // Duplicate email checks
  const exists = merchantsList.value.some(m => m.managerAccount.toLowerCase() === addForm.value.managerAccount.trim().toLowerCase());
  if (exists) {
    addFormError.value = `该商家店长邮编 [${addForm.value.managerAccount}] 已经被锁定，无法重复签约录入！`;
    return;
  }

  const newMerchant: MerchantStruct = {
    id: 90000 + (Date.now() % 1000),
    managerAccount: addForm.value.account = addForm.value.managerAccount.trim(),
    storeName: addForm.value.storeName,
    branchesCount: Number(addForm.value.branchesCount) || 0,
    updatedDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
    privileges: [...addForm.value.privileges]
  };

  merchantsList.value.unshift(newMerchant);
  alert(`✨ 商盟签约大功告成！已为分店店长 [${newMerchant.managerAccount}] 分配登录卡并在后台完成对 [${newMerchant.storeName}] 的绑定挂载！`);
  addMerchantModalVisible.value = false;
};
</script>

<style scoped>
.animated {
  animation-duration: 0.2s;
  animation-fill-mode: both;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

.fadeIn {
  animation-name: fadeIn;
}

/* Strict zero rounded corners requested */
*,
.el-card,
.el-input,
.el-button,
select,
input,
table,
th,
td {
  border-radius: 0px !important;
}
</style>
