<template>
  <div v-if="visible" class="fixed inset-0 z-[1000] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto select-none font-sans text-gray-800">
    <!-- Main Modal Body: Straight visual borders, no rounded corners -->
    <div class="bg-white border-2 border-slate-900 shadow-2xl w-full max-w-5xl flex flex-col box-sharp relative animated fadeIn">
      
      <!-- Top Session Control Ribbon -->
      <div class="bg-[#1e293b] text-white px-6 py-3.5 flex items-center justify-between border-b border-slate-950 box-sharp">
        <div class="flex items-center gap-2.5">
          <span class="inline-block w-2.5 h-2.5 bg-emerald-500 animate-pulse box-sharp"></span>
          <span class="text-xs font-black uppercase tracking-widest font-mono text-emerald-400">POSSESSED SESSION</span>
          <span class="text-slate-500 font-mono">|</span>
          <p class="text-xs font-semibold text-slate-300">
            管理员专线附身沙盒：当前正在以分店运营官角色监管该实体的全部财务、客户流量与折线记录。
          </p>
        </div>
        
        <!-- Right Custom Header (Crucial Requirement) -->
        <div class="flex items-center gap-4 text-xs font-bold">
          <div class="flex items-center gap-1 bg-slate-800 border border-slate-700 px-3 py-1 text-slate-200 uppercase font-mono tracking-wider box-sharp">
            <span>STORE-ID:</span>
            <span class="text-emerald-400 font-black">{{ store?.id }}</span>
          </div>
          
          <!-- Dropdown container and welcome banner -->
          <div class="flex items-center gap-2 bg-[#48a1a1]/10 border border-[#48a1a1]/30 pl-3.5 pr-3 py-1 text-emerald-300 relative box-sharp">
            <span class="select-none text-[11px] font-extrabold text-teal-150">欢迎回来, {{ store?.name }}</span>
            
            <!-- Conditional Branch Dropdown -->
            <div v-if="store?.hasBranches" class="relative inline-block text-left" style="border-radius: 0px !important;">
              <button 
                type="button"
                @click.stop="toggleDropdown"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 hover:bg-slate-800 bg-slate-900/40 border border-teal-600/30 text-[10px] text-white font-extrabold tracking-wide hover:text-white transition-all cursor-pointer box-sharp rounded-none"
                style="border-radius: 0px !important;"
              >
                <span>{{ currentBranch?.name || '选择分店' }}</span>
                <span class="text-[9px] font-mono tracking-tight text-teal-300 select-none">∨</span>
              </button>

              <!-- Simulated Dropdown: strict zero border radius -->
              <div 
                v-if="dropdownOpen" 
                class="absolute right-0 mt-2.5 w-72 bg-white text-slate-800 border-2 border-slate-900 shadow-2xl z-50 py-1 box-sharp"
                style="border-radius: 0px !important;"
              >
                <div class="px-3.5 py-1.5 bg-slate-100 text-[10px] font-black text-slate-500 uppercase border-b border-slate-200 select-none tracking-wider">
                  📂 下属分店分支目录
                </div>
                <!-- Dropdown items loop -->
                <button 
                  v-for="branch in store?.branchList" 
                  :key="branch.id"
                  @click="handleSelectBranch(branch)"
                  type="button"
                  class="w-full text-left text-xs font-bold px-3.5 py-2 hover:bg-[#48a1a1] hover:text-white transition-colors border-b border-slate-100 last:border-0 flex items-center justify-between cursor-pointer rounded-none"
                  :class="currentBranch?.id === branch.id ? 'bg-[#48a1a1]/10 text-[#48a1a1] font-black' : 'text-slate-700'"
                  style="border-radius: 0px !important;"
                >
                  <span class="truncate pr-2">{{ branch.name }}</span>
                  <span class="font-mono text-[9px] text-gray-400 group-hover:text-teal-200">{{ branch.code }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Statistics Body Layout -->
      <div class="grid grid-cols-1 lg:grid-cols-12 border-b border-slate-200/80">
        
        <!-- Left Side (8 cols): ECharts simulated Live Chart -->
        <div class="lg:col-span-8 p-6 space-y-4 border-r border-slate-200/80 relative">
          <!-- Chart Header -->
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest font-mono">Operational Metrics Curve</h4>
              <h3 class="text-sm font-extrabold text-slate-800">
                分店 7 日滚动营业实收折线图 (ECharts Engine Simulator)
              </h3>
            </div>
            
            <div class="flex items-center gap-3 text-[10px] font-bold text-gray-500">
              <span class="flex items-center gap-1"><span class="w-2.5 h-1 bg-[#48a1a1] box-sharp"></span> 营业收入 (USD)</span>
              <span class="font-mono bg-slate-50 border border-slate-200 px-2 py-0.5 box-sharp uppercase select-none">
                Timeframe: Last 7 Days
              </span>
            </div>
          </div>

          <!-- The Live Interactive SVG Graph With Strict Zero Border Loading State -->
          <div class="h-64 border border-slate-200/80 p-2 relative bg-slate-50/50 box-sharp flex items-center justify-center">
            
            <!-- Loading indicator -->
            <div v-if="chartLoading" class="absolute inset-0 bg-white/80 z-20 flex flex-col items-center justify-center gap-3 transition-opacity">
              <div class="w-8 h-8 border-2 border-t-transparent border-[#48a1a1] animate-spin box-sharp"></div>
              <span class="text-[10px] font-bold text-[#48a1a1] uppercase tracking-wider font-mono">Reloading branch data streams...</span>
            </div>

            <!-- Fully Hand-crafted highly responsive spline line SVG -->
            <svg v-else class="w-full h-full" viewBox="0 0 540 240">
              <!-- Grid background lines -->
              <line x1="40" y1="40" x2="520" y2="40" stroke="#f1f5f9" stroke-width="1.5" />
              <line x1="40" y1="100" x2="520" y2="100" stroke="#f1f5f9" stroke-width="1.5" />
              <line x1="40" y1="160" x2="520" y2="160" stroke="#f1f5f9" stroke-width="1.5" />
              <line x1="40" y1="220" x2="520" y2="220" stroke="#cbd5e1" stroke-width="1" />
              <line x1="40" y1="40" x2="40" y2="220" stroke="#cbd5e1" stroke-width="1" />

              <!-- Y-axis coordinates labels -->
              <text x="32" y="44" class="text-[9px] fill-gray-400 font-mono font-bold text-right" text-anchor="end">150+ %</text>
              <text x="32" y="104" class="text-[9px] fill-gray-400 font-mono font-bold text-right" text-anchor="end">100 %</text>
              <text x="32" y="164" class="text-[9px] fill-gray-400 font-mono font-bold text-right" text-anchor="end">50 %</text>
              <text x="32" y="224" class="text-[9px] fill-gray-400 font-mono font-bold text-right" text-anchor="end">0</text>

              <!-- Interactive Area Gradient below line path -->
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#48a1a1" stop-opacity="0.32" />
                  <stop offset="100%" stop-color="#48a1a1" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path :d="gradientPath" fill="url(#chartGrad)" />

              <!-- Main Curve spline path -->
              <path :d="curvePath" fill="none" stroke="#48a1a1" stroke-width="2.5" />

              <!-- Data dots overlay -->
              <g v-for="(val, idx) in chartPoints" :key="idx">
                <circle 
                  :cx="val.x" 
                  :cy="val.y" 
                  r="4" 
                  fill="#ffffff" 
                  stroke="#48a1a1" 
                  stroke-width="2.5" 
                  class="cursor-pointer hover:r-5 hover:fill-amber-400 hover:stroke-slate-900 transition-all duration-150"
                  @mouseenter="activePointIdx = idx"
                  @mouseleave="activePointIdx = null"
                />
                
                <!-- Micro tooltip label inside graph -->
                <text 
                  v-if="activePointIdx === idx" 
                  :x="val.x" 
                  :y="val.y - 10" 
                  class="text-[9px] font-bold fill-slate-900 text-center font-mono" 
                  text-anchor="middle"
                >
                  {{ currentBranch?.chartData[idx] }}%
                </text>
              </g>

              <!-- X-axis Day labels -->
              <g v-for="(day, idx) in dayNames" :key="idx">
                <text 
                  :x="40 + idx * 80" 
                  y="235" 
                  class="text-[9px] fill-gray-500 font-mono font-bold" 
                  text-anchor="middle"
                >
                  {{ day }}
                </text>
              </g>
            </svg>
          </div>

          <!-- Bottom tips -->
          <div class="flex items-center gap-2 bg-slate-50 border border-slate-200/80 p-3 text-[11px] font-medium text-slate-550 box-sharp select-none">
            <span class="text-teal-650 shrink-0">💡 分析研判:</span>
            <span>由于本统计区间内的理疗热度呈季节性攀升，{{ currentBranch?.name }} 的主轴业务正趋于全负荷状态。建议协调理疗师休假，避免承接负荷失序导致口碑下滑。</span>
          </div>
        </div>

        <!-- Right Side (4 cols): Main Summary Stats Cards -->
        <div class="lg:col-span-4 p-6 bg-slate-50/50 space-y-4">
          <div class="border-b border-gray-200 pb-2">
            <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest font-mono">Real-time Performance Key indicators</h4>
            <h3 class="text-sm font-black text-slate-900">核心维度实况概览</h3>
          </div>

          <div v-if="chartLoading" class="min-h-56 flex flex-col items-center justify-center gap-2">
             <div class="w-6 h-6 border-2 border-t-transparent border-[#48a1a1] animate-spin box-sharp"></div>
             <span class="text-[9px] font-black text-gray-400 uppercase tracking-wide">Syncing metrics...</span>
          </div>

          <div v-else class="space-y-4">
            <!-- Metric 1: Today's Revenue -->
            <div class="bg-white border-2 border-slate-900 p-4 relative box-sharp flex flex-col space-y-1">
              <span class="text-[10px] font-black text-[#48a1a1] uppercase tracking-wider font-mono">今日营业收入 (USD)</span>
              <div class="flex items-baseline gap-1 pt-1">
                <span class="text-xs text-slate-400 font-bold">$</span>
                <span class="text-2xl font-black text-slate-900 font-mono select-all">{{ currentBranch?.revenue || '0.00' }}</span>
              </div>
              <div class="text-[10px] text-gray-400 font-semibold flex items-center gap-1 select-none">
                <span class="text-emerald-500 font-bold">↑ +14.2%</span>相比于昨日同一节点
              </div>
            </div>

            <!-- Metric 2: Orders Count -->
            <div class="bg-white border-2 border-slate-900 p-4 relative box-sharp flex flex-col space-y-1">
              <span class="text-[10px] font-black text-[#48a1a1] uppercase tracking-wider font-mono">今日履约单量 (Today Appointments)</span>
              <div class="flex items-baseline gap-1 pt-1">
                <span class="text-2xl font-black text-slate-900 font-mono select-all">{{ currentBranch?.orders || 0 }}</span>
                <span class="text-xs text-slate-400 font-bold">单</span>
              </div>
              <div class="text-[10px] text-gray-400 font-semibold flex items-center gap-1 select-none">
                <span class="text-emerald-500 font-bold">● 100% 接单率</span> 零延误履约中
              </div>
            </div>

            <!-- Metric 3: Active Technicians -->
            <div class="bg-white border-2 border-slate-900 p-4 relative box-sharp flex flex-col space-y-1">
              <span class="text-[10px] font-black text-[#48a1a1] uppercase tracking-wider font-mono">今日在岗技师 (Active Specialists)</span>
              <div class="flex items-baseline gap-1 pt-1">
                <span class="text-2xl font-black text-slate-900 font-mono select-all">{{ currentBranch?.techs || 0 }}</span>
                <span class="text-xs text-slate-400 font-bold">位理疗师</span>
              </div>
              <div class="text-[10px] text-gray-400 font-semibold flex items-center gap-1 select-none">
                <span class="inline-block w-2 h-2 bg-emerald-500 box-sharp"></span> 均已在班、轮换休息状态
              </div>
            </div>

            <!-- Metric 4: Customer Score -->
            <div class="bg-white border-2 border-slate-900 p-4 relative box-sharp flex flex-col space-y-1">
              <span class="text-[10px] font-black text-[#48a1a1] uppercase tracking-wider font-mono">顾客综合评分星级</span>
              <div class="flex items-center gap-2 pt-1">
                <span class="text-2xl font-black text-amber-500 font-mono select-all">★ {{ currentBranch?.rating || '5.0' }}</span>
                <span class="text-xs text-slate-400 font-bold">分</span>
              </div>
              <div class="text-[10px] text-[#48a1a1] font-bold flex items-center gap-1 select-none">
                根据近 60 天的 2,400+ 好评反馈自动测算
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Action Panel with mandatory straight corners -->
      <div class="bg-slate-50 px-6 py-4 flex items-center justify-between box-sharp">
        <div class="flex items-center gap-2 text-[11px] text-slate-500 font-semibold">
          <span>当前分店环境：</span>
          <span class="text-[#48a1a1] font-mono select-all font-bold">[{{ currentBranch?.code }}] / {{ currentBranch?.name }}</span>
        </div>
        
        <div class="flex items-center gap-2">
          <button 
            type="button" 
            @click="handleClose"
            class="el-button text-xs font-black border-2 border-slate-900 bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-600 text-slate-900 px-6 py-2.5 transition-all cursor-pointer box-sharp rounded-none active:scale-[0.98]"
            style="border-radius: 0px !important;"
          >
            退出附身管理员模式
          </button>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';

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

interface StoreItem {
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
  businessStatus: string;
  syncTime: string;
  hasBranches?: boolean;
  branchList?: BranchItem[];
}

const props = defineProps<{
  visible: boolean;
  store: StoreItem | null;
}>();

const emit = defineEmits(['update:visible', 'close']);

// Local states
const dropdownOpen = ref(false);
const chartLoading = ref(false);
const activePointIdx = ref<number | null>(null);

// Active Branch reference
const currentBranch = ref<BranchItem | null>(null);

// X-axis Days
const dayNames = ['5/30', '5/31', '6/01', '6/02', '6/03', '6/04', '今日'];

// Keep track of toggle dropdown
const toggleDropdown = () => {
  dropdownOpen.value = !dropdownOpen.value;
};

// Handle selecting a branch
const handleSelectBranch = (branch: BranchItem) => {
  if (currentBranch.value?.id === branch.id) {
    dropdownOpen.value = false;
    return;
  }
  dropdownOpen.value = false;
  chartLoading.value = true;
  
  // Simulate data reloading for stats and charts dynamically
  setTimeout(() => {
    currentBranch.value = branch;
    chartLoading.value = false;
  }, 450);
};

// Initialize branch reference when store changes
watch(
  () => props.store,
  (newStore) => {
    if (newStore) {
      if (newStore.hasBranches && newStore.branchList && newStore.branchList.length > 0) {
        currentBranch.value = { ...newStore.branchList[0] };
      } else {
        // Fallback mockup as single branch for seamless UI display
        currentBranch.value = {
          id: newStore.id,
          name: newStore.name,
          code: newStore.code,
          revenue: '2,480.00',
          orders: 22,
          techs: 5,
          rating: '4.9',
          chartData: [45, 60, 52, 80, 65, 85, 95]
        };
      }
    } else {
      currentBranch.value = null;
    }
  },
  { immediate: true }
);

// Close events
const handleClose = () => {
  dropdownOpen.value = false;
  emit('update:visible', false);
  emit('close');
};

// Click outside helper to close dropdown
const handleDocumentClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.relative')) {
    dropdownOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

// Spline generator functions to compute custom beautifully curved paths inside SVG
const curvePath = computed(() => {
  if (!currentBranch.value || !currentBranch.value.chartData) return '';
  const data = currentBranch.value.chartData;
  const points = data.map((val, i) => {
    const x = 40 + i * 80;
    const y = 220 - (val / 160) * 180;
    return { x, y };
  });

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cpX1 = p0.x + 30;
    const cpY1 = p0.y;
    const cpX2 = p1.x - 30;
    const cpY2 = p1.y;
    d += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
  }
  return d;
});

const gradientPath = computed(() => {
  const line = curvePath.value;
  if (!line || !currentBranch.value || !currentBranch.value.chartData) return '';
  const idxMax = currentBranch.value.chartData.length - 1;
  const endX = 40 + idxMax * 80;
  return `${line} L ${endX} 220 L 40 220 Z`;
});

const chartPoints = computed(() => {
  if (!currentBranch.value || !currentBranch.value.chartData) return [];
  return currentBranch.value.chartData.map((val, i) => {
    return {
      x: 40 + i * 80,
      y: 220 - (val / 160) * 180
    };
  });
});
</script>

<style scoped>
.box-sharp {
  border-radius: 0 tracking-wide !important;
}

:deep(.el-card),
:deep(.el-button),
:deep(.el-dropdown),
:deep(.el-dropdown-menu),
:deep(.el-dropdown-item),
:deep(.el-dialog),
:deep(.el-tag) {
  border-radius: 0px !important;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

.animated {
  animation-duration: 0.2s;
  animation-fill-mode: both;
}

.fadeIn {
  animation-name: fadeIn;
}
</style>
