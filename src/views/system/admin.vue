<template>
  <div class="admin-management-container font-sans text-gray-800 select-none p-6">
    <!-- Breadcrumb Indicator -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2 text-xs text-gray-400">
        <span>系统管理</span>
        <span>/</span>
        <span class="text-gray-600 font-bold">高级系统管理员 (admin.vue)</span>
      </div>
      
      <!-- Interactive Sandbox Toolbar for easy testing of different role profiles -->
      <div class="flex items-center gap-2 bg-slate-100 border border-slate-200 px-3 py-1 text-xs">
        <span class="text-gray-500 font-bold">模拟切换用户角色 (测试用):</span>
        <select 
          v-model="currentRole" 
          @change="handleRoleOverride"
          class="bg-white border border-gray-300 text-[11px] font-bold px-1.5 py-0.5 outline-none rounded-none"
          style="border-radius: 0px !important;"
        >
          <option value="SUPER_ADMIN">SUPER_ADMIN (系统最高管理员 - 可见)</option>
          <option value="PLATFORM_ADMIN">PLATFORM_ADMIN (主要后台管理员 - 被隔离)</option>
          <option value="STORE_MANAGER">STORE_MANAGER (商家店长管理员 - 被隔离)</option>
        </select>
      </div>
    </div>

    <!-- GUARD BLOCK: Only SUPER_ADMIN can see this functional section -->
    <div v-if="currentRole !== 'SUPER_ADMIN'" class="bg-red-50 border-2 border-red-500 p-8 text-center space-y-4 max-w-2xl mx-auto my-12 animated fadeIn rounded-none" style="border-radius: 0px !important;">
      <span class="inline-block text-3xl">⚠️</span>
      <h2 class="text-base font-black text-red-900 uppercase tracking-widest font-mono">访问权限受限 | ACCESS RESTRICTED</h2>
      <p class="text-xs text-red-700 leading-relaxed max-w-md mx-auto font-medium">
        抱歉，该管理模块 (admin.vue) 属于系统最高级别的安全隔离区。您的当前角色身份为 
        <span class="font-bold bg-red-200 text-red-900 px-1.5 py-0.5 font-mono">[{{ currentRole }}]</span>。
        只有真实超级系统管理员 (<span class="font-bold underline">SUPER_ADMIN</span>) 才被允许对平台后台管理员进行物理编删除、特定权限授权以及安全密码的强行变定。
      </p>
      <div class="pt-2">
        <button 
          type="button"
          @click="currentRole = 'SUPER_ADMIN'" 
          class="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition-all border-none rounded-none"
          style="border-radius: 0px !important;"
        >
          附身为 SUPER_ADMIN 物理穿透
        </button>
      </div>
    </div>

    <!-- MAIN INTERFACE: SUPER_ADMIN ONLY -->
    <div v-else class="space-y-6 animated fadeIn">
      <!-- Top banner for Current Logged In Admin Profile -->
      <div class="bg-slate-900 text-white p-5 border-l-4 border-[#48a1a1] flex flex-wrap items-center justify-between gap-4 rounded-none" style="border-radius: 0px !important;">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="inline-block w-2.5 h-2.5 bg-emerald-400 animate-pulse"></span>
            <span class="text-xs font-black uppercase tracking-widest font-mono text-emerald-450">Active Session Status</span>
          </div>
          <h3 class="text-sm font-black">
            当前登入：超级创始人 (Account: <span class="font-mono text-[#48a1a1]">founder_ariva</span>)
          </h3>
          <p class="text-[11px] text-gray-400">
            管理员密码修改规范：在此后台中作为 SUPER_ADMIN，您可以<span class="text-emerald-300">直接修改下级平台管理员密码</span>（无需其旧密码验证）。但若尝试<span class="text-amber-300">修改自身密码时，必须通过旧密码验证</span>。
          </p>
        </div>
        <button 
          type="button" 
          @click="handleConfigureSelfPassword"
          class="el-button text-xs font-bold bg-slate-800 hover:bg-slate-700 text-[#48a1a1] border border-[#48a1a1]/30 px-4 py-2 transition-all cursor-pointer rounded-none"
          style="border-radius: 0px !important;"
        >
          🔐 修改自身安全登录密码 (需验证旧密码)
        </button>
      </div>

      <!-- Main card structure -->
      <div class="el-card border-2 border-slate-900 bg-white shadow-xl rounded-none" style="border-radius: 0px !important;">
        <div class="el-card-header border-b-2 border-slate-900 p-4 bg-slate-50 flex flex-wrap items-center justify-between gap-4 rounded-none" style="border-radius: 0px !important;">
          <div class="space-y-0.5">
            <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest font-mono">Platform administrator directory</h4>
            <h3 class="text-sm font-black text-slate-900">平台后台主要管理员（PLATFORM_ADMIN）控制矩阵</h3>
          </div>
          
          <div class="flex items-center gap-2">
            <input 
              type="text" 
              v-model="searchQuery" 
              placeholder="检索平台管理员账号 / 描述..." 
              class="el-input font-sans text-xs bg-white border border-gray-350 px-3 py-1.5 focus:outline-none focus:border-[#48a1a1] w-56 rounded-none" 
              style="border-radius: 0px !important;"
            />
            <button 
              type="button" 
              @click="handleReset"
              class="el-button text-xs font-bold px-3 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 text-gray-700 cursor-pointer rounded-none"
              style="border-radius: 0px !important;"
            >
              清空
            </button>
            <button 
              type="button" 
              @click="handleAddNewPlatformAdmin"
              class="el-button px-4 py-1.5 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-bold text-xs cursor-pointer transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              ➕ 签署并创建 PLATFORM_ADMIN 账号
            </button>
          </div>
        </div>

        <!-- Data table of PLATFORM_ADMIN accounts -->
        <div class="p-6 overflow-x-auto">
          <table class="w-full text-xs text-left border-collapse border-2 border-slate-900 rounded-none font-sans" style="border-radius: 0px !important;">
            <thead>
              <tr class="bg-slate-100 text-slate-800 border-b-2 border-slate-900 font-bold">
                <th class="p-3 border-r border-slate-900 font-mono">ID</th>
                <th class="p-3 border-r border-slate-900">主要管理员账号 / Account</th>
                <th class="p-3 border-r border-slate-900">管理员特定姓名 / Description</th>
                <th class="p-3 border-r border-slate-900 text-center">对应安全权限级别</th>
                <th class="p-3 border-r border-slate-900 font-mono">初次在册创建时间</th>
                <th class="p-3 border-r border-slate-900 text-center">当前系统平台授权范围</th>
                <th class="p-3 text-center">安全决策控制行为</th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="admin in filteredPlatformAdmins" 
                :key="admin.id" 
                class="hover:bg-slate-50 border-b border-gray-200 last:border-b-0 transition-colors"
              >
                <!-- Numeric ID -->
                <td class="p-3 border-r border-slate-200 font-mono font-bold">{{ admin.id }}</td>
                
                <!-- Account Name -->
                <td class="p-3 border-r border-slate-200 font-mono font-bold text-slate-950">{{ admin.account }}</td>
                
                <!-- Screen Name -->
                <td class="p-3 border-r border-slate-200 font-bold text-gray-700">{{ admin.username }}</td>
                
                <!-- Role tag -->
                <td class="p-3 border-r border-slate-200 text-center">
                  <span class="inline-block px-2.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 font-black text-[9px] font-mono tracking-wider rounded-none" style="border-radius: 0px !important;">
                    👉 {{ admin.role }}
                  </span>
                </td>
                
                <!-- Registration date -->
                <td class="p-3 border-r border-slate-200 font-mono text-gray-500">{{ admin.createdDate }}</td>
                
                <!-- Permissions checklist label -->
                <td class="p-3 border-r border-slate-200 text-[10px] font-semibold text-gray-650">
                  <div class="flex flex-wrap gap-1">
                    <span 
                      v-for="perm in admin.permissions" 
                      :key="perm" 
                      class="bg-slate-150 border border-gray-200 px-1.5 py-0.5 text-slate-800 text-[9px] font-bold rounded-none"
                      style="border-radius: 0px !important;"
                    >
                      ✓ {{ perm }}
                    </span>
                    <span v-if="!admin.permissions || admin.permissions.length === 0" class="text-rose-600 font-mono text-[9px]">
                      🚨 空(无平台任何管理视图)
                    </span>
                  </div>
                </td>

                <!-- Actions -->
                <td class="p-3 text-center">
                  <div class="flex items-center justify-center gap-1.5">
                    <button 
                      type="button" 
                      @click="handleChangeSubordinatePassword(admin)"
                      class="text-[10px] font-black bg-slate-900 border border-slate-950 hover:bg-slate-800 text-white px-2.5 py-1.5 cursor-pointer rounded-none"
                      style="border-radius: 0px !important;"
                    >
                      修改下级密码
                    </button>
                    <button 
                      type="button" 
                      @click="handleTweakSubordinateScope(admin)"
                      class="text-[10px] font-black bg-white border border-slate-900 hover:bg-slate-100 text-slate-800 px-2.5 py-1.5 cursor-pointer rounded-none"
                      style="border-radius: 0px !important;"
                    >
                      调整管理权限范围
                    </button>
                    <button 
                      type="button" 
                      @click="handleDeletePlatformAdmin(admin)"
                      class="text-[10px] font-black bg-red-50 border border-red-350 hover:bg-red-100 text-red-650 px-2.5 py-1.5 cursor-pointer rounded-none"
                      style="border-radius: 0px !important;"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="filteredPlatformAdmins.length === 0">
                <td colspan="7" class="text-center py-16 text-gray-400 bg-slate-50 border border-dashed border-gray-300">
                  没有匹配到任何满足特定条件的平台级管理员（PLATFORM_ADMIN）账号记录。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- DIALOG MODAL 1: Password Adjustment Dialog (FORCE STRAIGHT ZERO-RADIUS CORNERS) -->
    <div v-if="passwordModalVisible" class="fixed inset-0 z-[2000] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col rounded-none" style="border-radius: 0px !important;">
        <!-- Header -->
        <div class="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950 rounded-none" style="border-radius: 0px !important;">
          <div class="flex items-center gap-2">
            <span class="font-mono text-emerald-450 tracking-widest font-black text-[10px] uppercase">SECURITY SYSTEM KEY</span>
          </div>
          <button @click="passwordModalVisible = false" class="text-gray-400 hover:text-white cursor-pointer font-bold text-lg select-none">×</button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-4 text-xs font-sans">
          <!-- Heading notice -->
          <div class="border-b border-slate-100 pb-2">
            <h4 class="text-xs font-black text-slate-800 flex items-center gap-1">
              <span>🔒 安全密码变定 </span>
              <span class="text-[#48a1a1]">[{{ targetAccountLabel }}]</span>
            </h4>
            <p v-if="isEditingSelf" class="text-[10px] text-red-600 font-bold mt-1">
              ※ 安全警示：您正在尝试更改系统最高管理员自身的登录会话密钥。为了您的身份安全，此次必须通过您当前的旧密码验证。
            </p>
            <p v-else class="text-[10px] text-emerald-600 font-bold mt-1">
              ※ 当前操作模式：在下级或下属平台管理员角色密码强更通道。最高管理员可以直接输入新密码重写底层凭据。
            </p>
          </div>

          <!-- Input fields area -->
          <div class="space-y-3">
            <!-- CURRENT/OLD PASSWORD FIELD (Self editing ONLY) -->
            <div v-if="isEditingSelf" class="space-y-1">
              <label class="block font-bold text-gray-700">超级管理员验证：当前旧密码 (Current Old Password)</label>
              <input 
                type="password" 
                v-model="passwordForm.oldPassword" 
                placeholder="请输入您目前的最高初始密码(默认: admin123)"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-widest rounded-none"
                style="border-radius: 0px !important;"
              />
              <span class="text-[9px] text-gray-400 block font-sans">
                测试向导：旧密码必须准确匹配。预设登录密钥可在本页直接变写。
              </span>
            </div>

            <!-- NEW PASSWORD FIELD -->
            <div class="space-y-1">
              <label class="block font-bold text-gray-700">
                {{ isEditingSelf ? '设置高强度的安全新密码 (New Password)' : '直接设置分配新密码 (Direct New Password)' }}
              </label>
              <input 
                type="password" 
                v-model="passwordForm.newPassword" 
                placeholder="请输入您希望配置的 6-18 位新明文控制密码"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono tracking-widest rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>
          </div>

          <!-- Error Feedback Indicator in straight layout -->
          <div v-if="passwordFormError" class="bg-red-50 border border-red-300 p-2.5 text-red-700 text-[11px] font-semibold rounded-none" style="border-radius: 0px !important;">
            ❌ 验证阻断：{{ passwordFormError }}
          </div>

          <!-- Footer Buttons -->
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
              确认保全密钥
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- DIALOG MODAL 2: platform permission scope editor (PLATFORM_ADMIN) -->
    <div v-if="scopeModalVisible" class="fixed inset-0 z-[2000] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col rounded-none" style="border-radius: 0px !important;">
        <!-- Header -->
        <div class="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950 rounded-none" style="border-radius: 0px !important;">
          <span class="text-xs font-black tracking-wider uppercase font-mono text-emerald-450">TWEAK PLATFORM ADM SCOPE</span>
          <button @click="scopeModalVisible = false" class="text-gray-400 hover:text-white cursor-pointer font-bold text-lg select-none">×</button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-4 text-xs font-sans">
          <div>
            <h4 class="text-xs font-black text-slate-800">
              设置主要的系统功能访问权及范围: {{ targetPlatformAdmin?.username }}
            </h4>
            <p class="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wider">
              勾选之范围将会写入其对应的 PLATFORM_ADMIN 会话控制令牌中。
            </p>
          </div>

          <div class="space-y-2.5 bg-slate-50 border border-slate-200 p-4 rounded-none" style="border-radius: 0px !important;">
            <label 
              v-for="opt in scopeOptions" 
              :key="opt"
              class="flex items-start gap-2 cursor-pointer font-semibold text-gray-700 hover:text-slate-900"
            >
              <input 
                type="checkbox" 
                :value="opt" 
                v-model="tempPermissions" 
                class="mt-0.5 cursor-pointer"
              />
              <span>{{ opt }}</span>
            </label>
          </div>

          <!-- Footer Buttons -->
          <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button 
              type="button" 
              @click="scopeModalVisible = false" 
              class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 font-bold hover:text-slate-800 transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              取消
            </button>
            <button 
              type="button" 
              @click="submitScopeForm" 
              class="px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-black transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              一键保存覆盖权限
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- DIALOG MODAL 3: ADD PLATFORM_ADMIN ACCOUNT -->
    <div v-if="addAdminModalVisible" class="fixed inset-0 z-[2000] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col rounded-none" style="border-radius: 0px !important;">
        <!-- Header -->
        <div class="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-950 rounded-none" style="border-radius: 0px !important;">
          <span class="text-xs font-black tracking-wider uppercase font-mono text-emerald-450">CREATE PLATFORM ADMIN</span>
          <button @click="addAdminModalVisible = false" class="text-gray-400 hover:text-white cursor-pointer font-bold text-lg select-none">×</button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-4 text-xs font-sans">
          <div class="border-b border-slate-100 pb-2">
            <h4 class="text-xs font-black text-slate-800">
              ➕ 签约并新增平台管理员账户
            </h4>
            <p class="text-[10px] text-gray-400 mt-0.5">
              为团队内新加入的高级平台运营人员提供单独的特定管理员卡。
            </p>
          </div>

          <!-- Fields -->
          <div class="space-y-3">
            <div class="space-y-1">
              <label class="block font-bold text-gray-700">登录账号 (Account - 物理唯一识别符)</label>
              <input 
                type="text" 
                v-model="addForm.account" 
                placeholder="例如: brand_admin_east"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>

            <div class="space-y-1">
              <label class="block font-bold text-gray-700">平台管理员显示姓名/描述 (Username Description)</label>
              <input 
                type="text" 
                v-model="addForm.username" 
                placeholder="例如: 华东区联合大区主运营官"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>

            <div class="space-y-1">
              <label class="block font-bold text-gray-700">初始登录控制密码 (Password)</label>
              <input 
                type="password" 
                v-model="addForm.password" 
                placeholder="设置 6 位以上的高强度秘密登录控制字符"
                class="w-full bg-slate-50 border border-slate-350 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] font-mono rounded-none"
                style="border-radius: 0px !important;"
              />
            </div>

            <!-- Initial Permission Scopes -->
            <div class="space-y-1.5">
              <label class="block font-bold text-gray-750">默认携带的平台操作访问权范围:</label>
              <div class="space-y-1 bg-slate-50 border border-slate-300 p-2.5 rounded-none max-h-32 overflow-y-auto" style="border-radius: 0px !important;">
                <label 
                  v-for="opt in scopeOptions" 
                  :key="opt + '_init'"
                  class="flex items-center gap-1.5 cursor-pointer hover:text-slate-900"
                >
                  <input 
                    type="checkbox" 
                    :value="opt" 
                    v-model="addForm.permissions" 
                    class="cursor-pointer"
                  />
                  <span class="text-[11px]">{{ opt }}</span>
                </label>
              </div>
            </div>
          </div>

          <!-- Error display -->
          <div v-if="addFormError" class="bg-red-50 border border-red-300 p-2 text-red-650 text-[10px] font-semibold rounded-none" style="border-radius: 0px !important;">
            ❌ 系统拦截：{{ addFormError }}
          </div>

          <!-- Footer Buttons -->
          <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button 
              type="button" 
              @click="addAdminModalVisible = false" 
              class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 font-bold hover:text-slate-800 transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              放弃
            </button>
            <button 
              type="button" 
              @click="submitAddAdminForm" 
              class="px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-black transition-colors rounded-none"
              style="border-radius: 0px !important;"
            >
              保存并录入系统目录
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface AdminStruct {
  id: number;
  username: string;
  account: string;
  role: 'SUPER_ADMIN' | 'PLATFORM_ADMIN';
  createdDate: string;
  permissions: string[];
}

// Current interactive role state (defaults to SUPER_ADMIN so SUPER_ADMIN view can be properly checked by default)
const currentRole = ref<'SUPER_ADMIN' | 'PLATFORM_ADMIN' | 'STORE_MANAGER'>('SUPER_ADMIN');

// Simulated memory storage of super admins' own password (starts as 'admin123')
const superAdminPassword = ref('admin123');

// List of target PLATFORM_ADMIN items (strictly manages PLATFORM_ADMIN)
const platformAdminsList = ref<AdminStruct[]>([
  { 
    id: 10001, 
    account: 'platform_reviewer_1', 
    username: '区域运营高级主审', 
    role: 'PLATFORM_ADMIN', 
    createdDate: '2026-03-24 16:51:30',
    permissions: ['统计与仪表分析看板', '店铺信息编册与审核']
  },
  { 
    id: 10002, 
    account: 'market_promoter', 
    username: '全国营销推广专员', 
    role: 'PLATFORM_ADMIN', 
    createdDate: '2026-04-05 09:12:44',
    permissions: ['优惠促销卡生成', '用户服务核销监察']
  },
  { 
    id: 10003, 
    account: 'safety_officer_col', 
    username: '商户状态安全审查特员', 
    role: 'PLATFORM_ADMIN', 
    createdDate: '2026-05-18 14:02:11',
    permissions: ['系统行为日志调看', '店铺信息编册与审核']
  }
]);

const searchQuery = ref('');

// Password Modal parameters
const passwordModalVisible = ref(false);
const isEditingSelf = ref(false);
const targetAccountLabel = ref('');
const passwordForm = ref({
  oldPassword: '',
  newPassword: ''
});
const passwordFormError = ref('');
const targetAdminItem = ref<AdminStruct | null>(null);

// Scope Permission Modal parameters
const scopeModalVisible = ref(false);
const targetPlatformAdmin = ref<AdminStruct | null>(null);
const tempPermissions = ref<string[]>([]);
const scopeOptions = [
  '统计与仪表分析看板',
  '高级商户账号注销权',
  '优惠促销卡生成',
  '店铺信息编册与审核',
  '用户服务核销监察',
  '系统行为日志调看'
];

// Add Admin modal parameters
const addAdminModalVisible = ref(false);
const addForm = ref({
  account: '',
  username: '',
  password: '',
  permissions: [] as string[]
});
const addFormError = ref('');

// Sub-arrays for calculations
const filteredPlatformAdmins = computed(() => {
  if (!searchQuery.value) return platformAdminsList.value;
  const q = searchQuery.value.toLowerCase();
  return platformAdminsList.value.filter(a => 
    a.account.toLowerCase().includes(q) || 
    a.username.toLowerCase().includes(q)
  );
});

// Sync manual role selector override (custom for this high quality testing UI)
const handleRoleOverride = () => {
  console.log(`[Simulator] Role overridden manually to: ${currentRole.value}`);
};

const handleReset = () => {
  searchQuery.value = '';
};

// Modifies the SUPER_ADMIN themselves - MUST require old password
const handleConfigureSelfPassword = () => {
  isEditingSelf.value = true;
  targetAccountLabel.value = '超级系统管理员自身 (founder_ariva)';
  passwordForm.value.oldPassword = '';
  passwordForm.value.newPassword = '';
  passwordFormError.value = '';
  targetAdminItem.value = null;
  passwordModalVisible.value = true;
};

// Modifies subordinate PLATFORM_ADMIN account - direct password insertion!
const handleChangeSubordinatePassword = (admin: AdminStruct) => {
  isEditingSelf.value = false;
  targetAccountLabel.value = `${admin.username} (${admin.account})`;
  passwordForm.value.oldPassword = '';
  passwordForm.value.newPassword = '';
  passwordFormError.value = '';
  targetAdminItem.value = admin;
  passwordModalVisible.value = true;
};

// Submit security settings form
const submitPasswordForm = () => {
  passwordFormError.value = '';
  
  if (!passwordForm.value.newPassword || passwordForm.value.newPassword.length < 5) {
    passwordFormError.value = '设定的新密码不可低于 5 个字符，强度不合规！';
    return;
  }

  // 1. Own password edit - REQUIRES verification
  if (isEditingSelf.value) {
    if (passwordForm.value.oldPassword !== superAdminPassword.value) {
      passwordFormError.value = '旧密码核验不匹配！无法重置最高控制密码！';
      return;
    }
    // Set new self-password
    superAdminPassword.value = passwordForm.value.newPassword;
    alert(`🔑 最高管理员密码已被重新写为：[${passwordForm.value.newPassword}]！`);
  } 
  // 2. Subordinate password edit - DOES NOT require old password verification
  else {
    alert(`🔑 成功为平台管理员 ${targetAccountLabel.value} 直接更替登录密码为：[${passwordForm.value.newPassword}]！已完成同步分发。`);
  }

  // Close modal on successful update
  passwordModalVisible.value = false;
};

// Open scope overlay 
const handleTweakSubordinateScope = (admin: AdminStruct) => {
  targetPlatformAdmin.value = admin;
  tempPermissions.value = [...(admin.permissions || [])];
  scopeModalVisible.value = true;
};

// Submit platform permissions scopes
const submitScopeForm = () => {
  if (targetPlatformAdmin.value) {
    const idx = platformAdminsList.value.findIndex(a => a.id === targetPlatformAdmin.value!.id);
    if (idx !== -1) {
      platformAdminsList.value[idx].permissions = [...tempPermissions.value];
    }
    alert(`🛡️ 成功为下级 [${targetPlatformAdmin.value.username}] 重新写定其在册平台视图和操作权限集！`);
  }
  scopeModalVisible.value = false;
};

// Triggers subordinate physical removal
const handleDeletePlatformAdmin = (admin: AdminStruct) => {
  if (confirm(`🔒 安全核验：您确定要注销并永久移出平台管理员 [${admin.username} / ${admin.account}] 吗？该操作物理不可逆。`)) {
    platformAdminsList.value = platformAdminsList.value.filter(a => a.id !== admin.id);
    alert(`物理注销成功。该账号的底层会话凭证及挂载态已被一键斩断。`);
  }
};

const handleAddNewPlatformAdmin = () => {
  addForm.value.account = '';
  addForm.value.username = '';
  addForm.value.password = '';
  addForm.value.permissions = ['统计与仪表分析看板', '店铺信息编册与审核'];
  addFormError.value = '';
  addAdminModalVisible.value = true;
};

// Physically stores new PLATFORM_ADMIN account inside reactive structure
const submitAddAdminForm = () => {
  addFormError.value = '';

  if (!addForm.value.account || addForm.value.account.trim().length === 0) {
    addFormError.value = '平台管理员登录账号名不可留空！';
    return;
  }
  if (!addForm.value.username || addForm.value.username.trim().length === 0) {
    addFormError.value = '平台管理员描述姓名不可留空！';
    return;
  }
  if (!addForm.value.password || addForm.value.password.length < 5) {
    addFormError.value = '请指定密码且不可短于 5 位安全范围！';
    return;
  }

  // Duplicate checks
  const exists = platformAdminsList.value.some(a => a.account.toLowerCase() === addForm.value.account.trim().toLowerCase());
  if (exists) {
    addFormError.value = `登录账号名: [${addForm.value.account}] 已在册，物理命名冲突！`;
    return;
  }

  const newAdmin: AdminStruct = {
    id: Date.now() % 100000,
    account: addForm.value.account.trim(),
    username: addForm.value.username.trim(),
    role: 'PLATFORM_ADMIN',
    createdDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
    permissions: [...addForm.value.permissions]
  };

  platformAdminsList.value.unshift(newAdmin);
  alert(`✨ 签署在册成功！成功录入新账号 ${newAdmin.username} (${newAdmin.account})，初始角色锁定为 PLATFORM_ADMIN。`);
  addAdminModalVisible.value = false;
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
