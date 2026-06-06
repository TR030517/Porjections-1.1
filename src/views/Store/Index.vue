<template>
  <div class="store-index-container font-sans text-gray-800 p-6 select-none bg-[#f8fafc] min-h-screen">
    <!-- Breadcrumb -->
    <div class="mb-4 flex items-center gap-2 text-xs text-gray-400">
      <span>门店运营中心</span>
      <span>/</span>
      <span class="text-gray-600 font-bold">门店网点管理 (Index.vue)</span>
    </div>

    <!-- Green Header Card for Store Management -->
    <div class="el-card border border-gray-200 bg-white shadow-sm mb-6 box-sharp overflow-hidden">
      <!-- Header Area with Green Background -->
      <div class="bg-gradient-to-r from-[#48a1a1] to-[#3a8484] p-5 text-white box-sharp">
        <h2 class="text-base font-extrabold flex items-center gap-2">
          <span class="bg-white/20 p-1.5 text-lg leading-none select-none">🏪</span>
          门店网点管理列表
        </h2>
        <p class="text-xs text-teal-100/90 mt-1 font-medium">
          管理区域联盟与各级分店的运营配置、管理人员账号与地理状态。修改将实时应用到前台搜索。
        </p>
      </div>

      <!-- Filters Form Container -->
      <div class="p-5 bg-slate-50 border-b border-gray-150">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- State Filter -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-gray-600">所属美联邦/州 (State)</label>
            <input 
              type="text" 
              v-model="stateQuery" 
              placeholder="例如: Colorado, Illinois..." 
              class="el-input text-xs bg-white border border-gray-200 px-3 py-2 text-gray-800 focus:outline-none focus:border-[#48a1a1] focus:ring-1 focus:ring-[#48a1a1]" 
            />
          </div>

          <!-- City Filter -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-gray-600">所属城市 (City)</label>
            <input 
              type="text" 
              v-model="cityQuery" 
              placeholder="例如: Littleton, Oak Forest..." 
              class="el-input text-xs bg-white border border-gray-200 px-3 py-2 text-gray-800 focus:outline-none focus:border-[#48a1a1] focus:ring-1 focus:ring-[#48a1a1]" 
            />
          </div>

          <!-- Store Name Filter -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-gray-600">门店/公司名称 (Store Name)</label>
            <input 
              type="text" 
              v-model="nameQuery" 
              placeholder="请输入关键字进行模糊搜寻..." 
              class="el-input text-xs bg-white border border-gray-200 px-3 py-2 text-gray-800 focus:outline-none focus:border-[#48a1a1] focus:ring-1 focus:ring-[#48a1a1]" 
            />
          </div>
        </div>

        <!-- Filter Action Row -->
        <div class="flex justify-end gap-2.5 pt-4 mt-2 border-t border-gray-200/50">
          <button 
            type="button" 
            @click="handleReset"
            class="el-button text-xs font-bold px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 cursor-pointer text-center select-none box-sharp transition-colors"
          >
            清空重设
          </button>
          <button 
            type="button" 
            @click="handleSearch"
            class="el-button text-xs font-bold px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white border border-transparent cursor-pointer text-center select-none box-sharp transition-all"
          >
            快速检索
          </button>
        </div>
      </div>

      <!-- Main Data Table Area -->
      <div class="p-4 overflow-x-auto">
        <el-table 
          :data="filteredStores" 
          border 
          class="w-full text-xs box-sharp"
          style="border-radius: 0 !important;"
        >
          <!-- ID Column -->
          <el-table-column label="ID" width="70" align="center">
            <template #default="{ row }">
              <span class="font-mono font-bold text-gray-700 select-all">{{ row.id }}</span>
            </template>
          </el-table-column>

          <!-- Logo Column -->
          <el-table-column label="门店标识" width="80" align="center">
            <template #default="{ row }">
              <div class="w-10 h-10 bg-slate-50 border border-gray-150 inline-flex items-center justify-center text-xl box-sharp select-none overflow-hidden mx-auto">
                <img 
                  v-if="row.logoUrl" 
                  :src="row.logoUrl" 
                  alt="Logo" 
                  class="w-full h-full object-cover" 
                  referrerpolicy="no-referrer"
                />
                <span v-else>{{ row.logo }}</span>
              </div>
            </template>
          </el-table-column>

          <!-- External Direct Code Column -->
          <el-table-column label="外部直属代码" width="130" align="center">
            <template #default="{ row }">
              <span class="inline-block px-2 py-0.5 border border-blue-200 text-blue-700 bg-blue-50/30 text-[10px] font-bold font-mono tracking-wide box-sharp uppercase">
                {{ row.code }}
              </span>
            </template>
          </el-table-column>

          <!-- Store name Column -->
          <el-table-column label="门店公司全称" min-width="180">
            <template #default="{ row }">
              <div class="space-y-1">
                <div class="font-extrabold text-[#3a8484] text-sm select-all">
                  {{ row.name }}
                </div>
                <div class="text-[10px] text-gray-400 font-medium truncate max-w-sm">
                  {{ row.subtitle }}
                </div>
              </div>
            </template>
          </el-table-column>

          <!-- Address Column -->
          <el-table-column label="具体省市地址" min-width="160">
            <template #default="{ row }">
              <div class="space-y-0.5 font-medium">
                <div class="text-gray-800 text-[11px] select-all">{{ row.address }}</div>
                <div class="text-[10px] text-gray-400 font-mono tracking-tight select-all">
                  {{ row.city }}, {{ row.state }} {{ row.zipCode }}
                </div>
              </div>
            </template>
          </el-table-column>

          <!-- Contact Column -->
          <el-table-column label="主要联系工具" width="160">
            <template #default="{ row }">
              <div class="space-y-1.5 font-medium">
                <div class="flex items-center gap-1.5 text-[11px] text-gray-700">
                  <span class="text-xs text-gray-400 select-none">📞</span>
                  <span class="font-mono select-all">{{ row.phone }}</span>
                </div>
                <div class="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <span class="text-xs text-gray-400 select-none">✉️</span>
                  <span class="font-mono select-all">{{ row.email }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <!-- Data status Column -->
          <el-table-column label="数据状态" width="90" align="center">
            <template #default="{ row }">
              <span class="inline-flex items-center justify-center px-2 py-0.5 border border-emerald-500 text-emerald-600 bg-transparent text-[10px] font-extrabold box-sharp font-sans">
                {{ row.dataStatus }}
              </span>
            </template>
          </el-table-column>

          <!-- Business status Column -->
          <el-table-column label="营业状态" width="95" align="center">
            <template #default="{ row }">
              <span 
                :class="[
                  'inline-flex items-center justify-center px-2 py-0.5 border text-[10px] font-extrabold box-sharp',
                  row.businessStatus === '营业中' 
                    ? 'bg-[#48a1a1]/10 border-[#48a1a1] text-[#48a1a1]' 
                    : 'bg-amber-50 border-amber-300 text-amber-600'
                ]"
              >
                {{ row.businessStatus }}
              </span>
            </template>
          </el-table-column>

          <!-- Sync time Column -->
          <el-table-column label="同步于" width="140" align="center">
            <template #default="{ row }">
              <span class="font-mono text-[11px] text-gray-500 select-none">{{ row.syncTime }}</span>
            </template>
          </el-table-column>

          <!-- Actions Column -->
          <el-table-column label="操作" width="280" align="center">
            <template #default="{ row }">
              <div class="flex items-center justify-center gap-2">
                <el-button @click="handleEdit(row)" style="border-radius: 0;">编辑配置</el-button>
                <el-button type="primary" @click="handleEnter(row)" style="border-radius: 0;">进入</el-button>
                <el-button type="danger" @click="handleDelete(row)" style="border-radius: 0;">删除</el-button>
              </div>
            </template>
          </el-table-column>

          <!-- Empty Row Safeguard -->
          <template #empty>
            <div class="text-center py-16 text-gray-400 bg-gray-50/50 border border-dashed border-gray-200">
              暂无匹配的门店或网点，请修改过滤条件。
            </div>
          </template>
        </el-table>
      </div>
    </div>

    <!-- Alert / Interaction feedback Overlay and dialog simulator -->
    <div v-if="dialogVisible" class="fixed inset-0 bg-slate-900/40 z-[999] flex items-center justify-center p-4">
      <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-sm flex flex-col box-sharp">
        <div class="bg-slate-900 text-white px-5 py-3 flex items-center justify-between box-sharp">
          <span class="text-xs font-bold tracking-wider">{{ dialogTitle }}</span>
          <button @click="dialogVisible = false" class="text-gray-400 hover:text-white cursor-pointer font-bold text-base">×</button>
        </div>
        <div class="p-5 space-y-4 text-xs">
          <p class="leading-relaxed text-gray-700">{{ dialogMessage }}</p>

          <!-- Simple edit form in configurations option -->
          <div v-if="isEditingConfig" class="space-y-3 pt-1">
            <div class="space-y-1">
              <label class="font-bold text-gray-600 block">修改分店公司名称:</label>
              <input 
                type="text" 
                v-model="simulatedForm.name" 
                class="w-full bg-slate-50 border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] box-sharp" 
              />
            </div>
            <div class="space-y-1">
              <label class="font-bold text-gray-600 block">修改主营业务副标题:</label>
              <input 
                type="text" 
                v-model="simulatedForm.subtitle" 
                class="w-full bg-slate-50 border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:border-[#48a1a1] box-sharp" 
              />
            </div>
            <div class="space-y-1">
              <label class="font-bold text-gray-600 block">数据与环境状态:</label>
              <select v-model="simulatedForm.businessStatus" class="w-full bg-slate-50 border border-gray-200 px-3 py-2 text-xs box-sharp">
                <option value="营业中">营业中</option>
                <option value="休息中">休息中</option>
              </select>
            </div>
          </div>

          <!-- Dialog footer with strict zero radius -->
          <div class="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button @click="dialogVisible = false" class="px-4 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-650 font-bold box-sharp">
              取消
            </button>
            <button @click="submitSimulatedAction" class="px-5 py-1.5 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white font-bold box-sharp">
              确定
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- The Full Screen Centered Applet StoreStatsDialog -->
    <StoreStatsDialog 
      :visible="statsDialogVisible || dashboardVisible" 
      :store="activeStore" 
      @update:visible="statsDialogVisible = $event; dashboardVisible = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessageBox } from 'element-plus';
import StoreStatsDialog from './StoreStatsDialog.vue';

interface BranchItem {
  id: number;
  name: string;
  code: string;
  revenue: string;
  orders: number;
  techs: number;
  rating: string;
  chartData: number[];
}

interface StoreItemModel {
  id: number;
  name: string;
  subtitle: string;
  logo: string;
  logoUrl?: string;
  code: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string;
  dataStatus: string;
  businessStatus: '营业中' | '休息中';
  syncTime: string;
  hasBranches: boolean;
  branchList: BranchItem[];
}

const storesList = ref<StoreItemModel[]>([
  {
    id: 3246,
    name: 'Ariva Spa',
    subtitle: 'Littleton Premium Hot Stone Massage & Chiropractic',
    logo: '🌿',
    logoUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=120&h=120&q=80',
    code: 'EXT-CO-3246',
    address: '6728 W Coal Mine Ave A110',
    city: 'Littleton',
    state: 'Colorado',
    zipCode: '80123',
    phone: '303-475-1111',
    email: 'arivamassage@gmail.com',
    dataStatus: '正常',
    businessStatus: '营业中',
    syncTime: '2026-05-29 10:07:23',
    hasBranches: true,
    branchList: [
      { id: 324601, name: 'Ariva Spa - Littleton Headquarter (Denver Area)', code: 'EXT-CO-324601', revenue: '4,850.00', orders: 48, techs: 12, rating: '4.9', chartData: [40, 65, 50, 85, 75, 120, 95] },
      { id: 324602, name: 'Ariva Spa - Highlands Ranch Express Store', code: 'EXT-CO-324602', revenue: '2,930.00', orders: 29, techs: 6, rating: '4.8', chartData: [30, 45, 55, 40, 80, 65, 70] },
      { id: 324603, name: 'Ariva Spa - Boulder Luxury Oasis', code: 'EXT-CO-324603', revenue: '6,120.00', orders: 52, techs: 15, rating: '5.0', chartData: [50, 80, 70, 90, 110, 130, 140] }
    ]
  },
  {
    id: 3221,
    name: 'Roes Spa',
    subtitle: 'Classic Swedish Therapies & Facial Revitalization',
    logo: '💆',
    logoUrl: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=120&h=120&q=80',
    code: 'EXT-IL-3221',
    address: '6054 W 159th St',
    city: 'Oak Forest',
    state: 'Illinois',
    zipCode: '60452',
    phone: '312-283-8685',
    email: 'roesspa9@gmail.com',
    dataStatus: '正常',
    businessStatus: '营业中',
    syncTime: '2026-05-23 10:19:05',
    hasBranches: true,
    branchList: [
      { id: 322101, name: 'Roes Spa - Oak Forest Central', code: 'EXT-IL-322101', revenue: '3,210.00', orders: 32, techs: 8, rating: '4.8', chartData: [35, 50, 45, 60, 55, 75, 90] },
      { id: 322102, name: 'Roes Spa - Orland Park Franchise', code: 'EXT-IL-322102', revenue: '1,890.00', orders: 19, techs: 4, rating: '4.7', chartData: [20, 30, 25, 40, 35, 50, 45] }
    ]
  },
  {
    id: 3255,
    name: 'Littleton Chiropractic Care',
    subtitle: 'Aesthetic Chiropractic & Joint Adjustment Center',
    logo: '🏥',
    logoUrl: 'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?auto=format&fit=crop&w=120&h=120&q=80',
    code: 'EXT-CO-3255',
    address: '1244 S Littleton Rd Suite B',
    city: 'Littleton',
    state: 'Colorado',
    zipCode: '80120',
    phone: '303-911-3030',
    email: 'care@littletonchiro.com',
    dataStatus: '正常',
    businessStatus: '休息中',
    syncTime: '2026-05-31 08:44:12',
    hasBranches: false,
    branchList: []
  }
]);

// Search Queries
const stateQuery = ref('');
const cityQuery = ref('');
const nameQuery = ref('');

// Dialog states
const dialogVisible = ref(false);
const dialogTitle = ref('');
const dialogMessage = ref('');
const isEditingConfig = ref(false);
const activeStore = ref<StoreItemModel | null>(null);

// Store Stats Full Screen Dialog Visibility
const statsDialogVisible = ref(false);
const dashboardVisible = ref(false);

const simulatedForm = ref({
  name: '',
  subtitle: '',
  businessStatus: '营业中' as '营业中' | '休息中'
});

// Computed Search Filters
const filteredStores = computed(() => {
  return storesList.value.filter(st => {
    const matchState = !stateQuery.value.trim() || 
                       st.state.toLowerCase().includes(stateQuery.value.trim().toLowerCase());
    const matchCity = !cityQuery.value.trim() || 
                      st.city.toLowerCase().includes(cityQuery.value.trim().toLowerCase());
    const matchName = !nameQuery.value.trim() || 
                      st.name.toLowerCase().includes(nameQuery.value.trim().toLowerCase()) ||
                      st.subtitle.toLowerCase().includes(nameQuery.value.trim().toLowerCase());
    return matchState && matchCity && matchName;
  });
});

const handleSearch = () => {
  // Computed list handles state search automatically. Just trigger dialog feedback on demand.
};

const handleReset = () => {
  stateQuery.value = '';
  cityQuery.value = '';
  nameQuery.value = '';
};

const handleEditConfig = (store: StoreItemModel) => {
  activeStore.value = store;
  isEditingConfig.value = true;
  simulatedForm.value = {
    name: store.name,
    subtitle: store.subtitle,
    businessStatus: store.businessStatus
  };
  dialogTitle.value = `⚙️ 编辑门店网点配置 (ID: ${store.id})`;
  dialogMessage.value = `正在编辑专属门店的物理环境、服务主攻项目与数据属性状态。`;
  dialogVisible.value = true;
};

const handleEnterStore = (store: StoreItemModel) => {
  activeStore.value = store;
  isEditingConfig.value = false;
  // Open the customized StoreStatsDialog instead of simple info dialog
  statsDialogVisible.value = true;
  dashboardVisible.value = true;
};

const handleDeleteStore = (store: StoreItemModel) => {
  activeStore.value = store;
  isEditingConfig.value = false;
  dialogTitle.value = `⚠️ 警告：物理删除确认`;
  dialogMessage.value = `您确定要从当前系统层中物理卸载并注销门店 [${store.name}] (UID: ${store.id}) 吗？本操作将永久消除该店下的全部礼品卡、技师关系记录且不可退回。`;
  dialogVisible.value = true;
};

const submitSimulatedAction = () => {
  if (isEditingConfig.value && activeStore.value) {
    // Save state locally
    const found = storesList.value.find(s => s.id === activeStore.value!.id);
    if (found) {
      found.name = simulatedForm.value.name;
      found.subtitle = simulatedForm.value.subtitle;
      found.businessStatus = simulatedForm.value.businessStatus;
    }
  } else if (dialogTitle.value.includes('删除') && activeStore.value) {
    storesList.value = storesList.value.filter(s => s.id !== activeStore.value!.id);
  }
  dialogVisible.value = false;
};

const handleEdit = (row: StoreItemModel) => {
  handleEditConfig(row);
};

const handleEnter = (row: StoreItemModel) => {
  ElMessageBox.confirm(
    '是否确认进入 [' + ((row as any).companyName || row.name) + '] 商家端后台',
    '提示',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    activeStore.value = row;
    dashboardVisible.value = true;
    statsDialogVisible.value = true;
  }).catch(() => {
    // 取消进入
  });
};

const handlePay = (row: StoreItemModel) => {
  ElMessageBox.alert(
    `当前选定的美疗门店 [${row.name}] 双通道聚合支付接口已配置完毕。(Stripe POS & Stripe On-Site Checkout 与系统底层服务完成联络就绪)。`,
    '支付结算安全体系配备',
    {
      confirmButtonText: '查看确认',
      type: 'success',
    }
  );
};

const handleLink = (row: StoreItemModel) => {
  ElMessageBox.alert(
    `前台预约/礼品卡分销之系统重定向物理短代码建立完成：\n\n短链路径: https://arivaspa.com/s/${row.code.toLowerCase()}`,
    '生成分店短链接成功',
    {
      confirmButtonText: '复制完成',
      type: 'success',
    }
  );
};

const handleDelete = (row: StoreItemModel) => {
  handleDeleteStore(row);
};
</script>

<style scoped>
/* Strict visual redline: eliminate border radius globally using deep selectors */
:deep(.el-card),
:deep(.el-button),
:deep(.el-input),
:deep(.el-input__inner),
:deep(.el-tag),
:deep(.el-dialog),
:deep(.el-table),
:deep(.el-card__header) {
  border-radius: 0px !important;
}

/* Local selectors for solid fallback rendering */
.box-sharp,
.el-card,
.el-button,
.el-input,
.el-tag,
table,
thead,
tbody,
tr,
th,
td,
span,
select,
option,
input {
  border-radius: 0px !important;
}
</style>
