<template>
  <div class="merchant-management-container font-sans text-gray-800 select-none p-6">
    <!-- Breadcrumb Indicator -->
    <div class="mb-4 flex items-center gap-2 text-xs text-gray-400">
      <span>系统管理</span>
      <span>/</span>
      <span class="text-gray-600 font-bold">商家账号管理 (merchant.vue)</span>
    </div>

    <!-- el-card mock parent container with aggressive sharp headers and zero rounded edges -->
    <div class="el-card box-sharp border border-gray-200 bg-white">
      <!-- Search Filter Panel Area -->
      <div class="el-card-header border-b border-gray-150 p-4 bg-slate-50 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="text-sm font-bold text-gray-800 flex items-center gap-1.5">
            <span class="bg-[#48a1a1] w-2 h-4 block"></span>
            商圈店长主账号检索
          </span>
          <span class="text-[10px] bg-orange-100 text-orange-850 px-2.5 py-0.5 border border-orange-200 font-mono tracking-wider font-bold">
            SUPER_ADMIN 和 PLATFORM_ADMIN 级权限可用
          </span>
        </div>
        <div class="flex items-center gap-2">
          <input 
            type="text" 
            v-model="searchQuery" 
            placeholder="账号/绑定店铺..." 
            class="el-input font-sans text-xs bg-white border border-gray-200 px-3 py-1.5 focus:outline-none focus:border-[#48a1a1] w-56" 
          />
          <button 
            type="button" 
            @click="handleSearch"
            class="el-button px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition-colors"
          >
            筛选
          </button>
          <button 
            type="button" 
            @click="handleReset"
            class="el-button text-xs px-3 py-1.5 bg-gray-100 border border-gray-200 hover:bg-gray-150 text-gray-600 cursor-pointer"
          >
            重置
          </button>
          <button 
            type="button" 
            @click="handleAddMerchant"
            class="el-button px-4 py-1.5 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-bold text-xs cursor-pointer transition-colors"
          >
            分配商盟店长账号
          </button>
        </div>
      </div>

      <!-- Main Data Table Area -->
      <div class="el-table-wrapper p-4 overflow-x-auto">
        <table class="el-table w-full text-xs text-left border-collapse border border-gray-150">
          <thead>
            <tr class="bg-gray-100 text-gray-550 border-b border-gray-150 font-bold">
              <th class="p-3 border-r border-gray-150 font-mono">UID</th>
              <th class="p-3 border-r border-gray-150">商家主账号 / 登录邮箱</th>
              <th class="p-3 border-r border-gray-150">绑定店铺名称 (Principal Store)</th>
              <th class="p-3 border-r border-gray-150 text-center">旗下分店数量</th>
              <th class="p-3 border-r border-gray-150">最后在线操作</th>
              <th class="p-3 border-r border-gray-150 text-center">状态</th>
              <th class="p-3 text-center">核心控制操作</th>
            </tr>
          </thead>
          <tbody>
            <tr 
              v-for="merchant in filteredMerchants" 
              :key="merchant.id" 
              class="hover:bg-gray-50 border-b border-gray-150 transition-colors"
            >
              <td class="p-3 border-r border-gray-150 font-mono font-bold">{{ merchant.id }}</td>
              <td class="p-3 border-r border-gray-150 font-bold text-gray-900 font-mono">{{ merchant.managerAccount }}</td>
              <td class="p-3 border-r border-gray-150 text-gray-700">
                <div class="flex items-center gap-1.5 font-bold">
                  <span>🏪</span>
                  <span>{{ merchant.storeName }}</span>
                </div>
              </td>
              <td class="p-3 border-r border-gray-150 text-center">
                <span class="font-mono bg-zinc-800 text-white font-bold text-[10px] px-2 py-0.5 border border-zinc-700">
                  {{ merchant.branchesCount }} 间分店
                </span>
              </td>
              <td class="p-3 border-r border-gray-150 font-mono text-slate-500">{{ merchant.updatedDate }}</td>
              <td class="p-3 border-r border-gray-150 text-center">
                <span 
                  :class="[
                    'inline-flex items-center gap-1.5 px-2.5 py-0.5 border text-[10px] font-bold',
                    merchant.status === '启用' ? 'bg-emerald-50 border-emerald-250 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'
                  ]"
                >
                  <span class="w-1.5 h-1.5" :style="{ backgroundColor: merchant.status === '启用' ? '#10b981' : '#ef4444' }"></span>
                  {{ merchant.status }}
                </span>
              </td>
              <td class="p-3 text-center">
                <div class="flex items-center justify-center gap-1.5">
                  <button 
                    type="button" 
                    @click="handleResetPassword(merchant)"
                    class="el-button text-[10px] font-bold bg-[#48a1a1] hover:bg-[#3d8b8b] text-white px-2.5 py-1.5 transition-colors border border-transparent"
                  >
                    重置密码
                  </button>
                  <button 
                    type="button" 
                    @click="handlePermissionControl(merchant)"
                    class="el-button text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 transition-colors border border-gray-200"
                  >
                    权限管控
                  </button>
                  <button 
                    type="button" 
                    @click="handleDeleteMerchant(merchant.id)"
                    class="el-button text-[10px] font-bold bg-red-100 hover:bg-red-200 text-red-600 px-2.5 py-1.5 transition-colors border border-red-200"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="filteredMerchants.length === 0">
              <td colspan="7" class="text-center py-12 text-gray-400 bg-gray-50 border border-dashed border-gray-200">
                暂未匹配到任何自主商家店长账号实体。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modals for Action Feedback Simulator -->
    <div v-if="showModal" class="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4">
      <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col">
        <div class="bg-slate-900 text-white px-5 py-3 flex items-center justify-between">
          <span class="text-xs font-bold tracking-wider">{{ modalTitle }}</span>
          <button @click="showModal = false" class="text-gray-400 hover:text-white cursor-pointer font-bold">×</button>
        </div>
        <div class="p-5 space-y-4 text-xs">
          <p class="leading-relaxed text-gray-700">{{ modalMessage }}</p>
          <div v-if="isResetPasswordForm" class="space-y-2">
            <input 
              type="password" 
              placeholder="请输入全新重置商户二级管理密码..." 
              v-model="simulatedNewPass" 
              class="w-full bg-slate-50 border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1]" 
            />
          </div>
          <div v-if="isMerchantPermissionForm" class="space-y-1.5">
            <label class="font-bold block text-gray-500">商户专享子页权限受控:</label>
            <div class="space-y-1 bg-gray-50 p-2 border border-gray-200">
              <label class="flex items-center gap-1.5"><input type="checkbox" checked /> 🎟️ 面膜/按摩优惠卡发放权限</label>
              <label class="flex items-center gap-1.5"><input type="checkbox" checked /> 💳 旗下连锁所有门店分店修改权</label>
              <label class="flex items-center gap-1.5"><input type="checkbox" checked /> 📊 本店自主提现结转申请权限</label>
            </div>
          </div>
          <div class="flex justify-end gap-1.5 pt-2 border-t border-gray-100">
            <button @click="showModal = false" class="px-4 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600">
              取消
            </button>
            <button @click="submitSimulatedAction" class="px-5 py-1.5 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-bold">
              确认修改并保存
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
  status: '启用' | '禁用';
}

const merchantsList = ref<MerchantStruct[]>([
  { id: 101, managerAccount: 'boss_ariva@arivaspa.com', storeName: 'Ariva Spa 总部旗舰店', branchesCount: 3, updatedDate: '2026-06-02 18:24:11', status: '启用' },
  { id: 102, managerAccount: 'manager_roes@roesspa.com', storeName: 'Roes Spa 经典分院', branchesCount: 0, updatedDate: '2026-06-03 10:45:30', status: '启用' },
  { id: 103, managerAccount: 'boss_oasis@oasiswell.org', storeName: 'Oasis Health (温和按摩中心)', branchesCount: 1, updatedDate: '2026-05-29 08:12:00', status: '启用' },
  { id: 104, managerAccount: 'lilac_springs@mineralhot.com', storeName: 'Lilac Mineral Hot Springs', branchesCount: 5, updatedDate: '2026-06-01 14:02:11', status: '禁用' }
]);

const searchQuery = ref('');
const showModal = ref(false);
const modalTitle = ref('');
const modalMessage = ref('');
const simulatedNewPass = ref('');
const isResetPasswordForm = ref(false);
const isMerchantPermissionForm = ref(false);
const activeMerchant = ref<MerchantStruct | null>(null);

const filteredMerchants = computed(() => {
  if (!searchQuery.value) return merchantsList.value;
  const q = searchQuery.value.toLowerCase();
  return merchantsList.value.filter(m => 
    m.managerAccount.toLowerCase().includes(q) || 
    m.storeName.toLowerCase().includes(q)
  );
});

const handleSearch = () => {
  // Controlled by computed
};

const handleReset = () => {
  searchQuery.value = '';
};

const handleAddMerchant = () => {
  modalTitle.value = '➕ 分配商盟自主管理店长账号';
  modalMessage.value = '在平台数据库中为新签约商家授予店长专享登录凭据：';
  isResetPasswordForm.value = false;
  isMerchantPermissionForm.value = true;
  simulatedNewPass.value = '';
  showModal.value = true;
};

const handleResetPassword = (merchant: MerchantStruct) => {
  activeMerchant.value = merchant;
  modalTitle.value = '🔑 重置商家店长密码 - ' + merchant.managerAccount;
  modalMessage.value = '请输入用于代替该商户当前登录密钥的新明文密码，完成后系统将会实时覆写数据库：';
  isResetPasswordForm.value = true;
  isMerchantPermissionForm.value = false;
  simulatedNewPass.value = '';
  showModal.value = true;
};

const handlePermissionControl = (merchant: MerchantStruct) => {
  activeMerchant.value = merchant;
  modalTitle.value = '🛡️ 商圈店长特定权限调整 - ' + merchant.storeName;
  modalMessage.value = '调整该商户账号在其关联的分店网络中的子模块操作与核销范围：';
  isResetPasswordForm.value = false;
  isMerchantPermissionForm.value = true;
  showModal.value = true;
};

const handleDeleteMerchant = (id: number) => {
  if (confirm('🔒 安全核验：您确定要注销并永久删除该商家店长管理账号吗？其绑定的门店和相关分店配置不会物理删除，但店长账户将彻底失效崩溃。')) {
    merchantsList.value = merchantsList.value.filter(m => m.id !== id);
    alert('商家账号删除成功！对应的数据接口鉴权令牌已被平台同步封杀。');
  }
};

const submitSimulatedAction = () => {
  showModal.value = false;
  alert('改动已生效！已向该店长端的主控制台分发最新的安全凭证映射。');
};
</script>

<style scoped>
/* Force strict sharp square aesthetic and styling rules to prevent visual design breaking */
.box-sharp,
.el-card,
.el-input,
.el-button,
.el-tag,
table,
th,
td {
  border-radius: 0px !important;
}

.el-table th {
  background-color: #f1f5f9;
  color: #475569;
}
</style>
