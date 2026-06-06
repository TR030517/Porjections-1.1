import React, { useState } from 'react';
import { Search, Plus, Edit2, Trash2, ChevronLeft, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface StateArea {
  id: number;
  abbr: string;
  english: string;
  chinese: string;
  status: '启用' | '禁用';
  updatedTime: string;
  sort: number;
}

interface CityArea {
  id: number;
  stateId: number;
  english: string;
  chinese: string;
  status: '启用' | '禁用';
  updatedTime: string;
  zipCode?: string;
  sort: number;
}

// Global initial state data
const initialStates: StateArea[] = [
  { id: 54, abbr: 'AL', english: 'Alabama', chinese: '阿拉巴马州', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 55, abbr: 'AK', english: 'Alaska', chinese: '阿拉斯加州', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 56, abbr: 'AZ', english: 'Arizona', chinese: '亚利桑那州', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 59, abbr: 'AR', english: 'Arkansas', chinese: '阿肯色州', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 60, abbr: 'CA', english: 'California', chinese: '加利福尼亚', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 61, abbr: 'CO', english: 'Colorado', chinese: '科罗拉多', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 62, abbr: 'CT', english: 'Connecticut', chinese: '康涅狄格省', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 63, abbr: 'DE', english: 'Delaware', chinese: '特拉华', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 64, abbr: 'DC', english: 'District of Columbia', chinese: '哥伦比亚特区', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 65, abbr: 'FL', english: 'Florida', chinese: '佛罗里达', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 66, abbr: 'GA', english: 'Georgia', chinese: '佐治亚', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 67, abbr: 'HI', english: 'Hawaii', chinese: '夏威夷', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 68, abbr: 'ID', english: 'Idaho', chinese: '爱达荷', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 69, abbr: 'IL', english: 'Illinois', chinese: '伊利诺伊', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
  { id: 70, abbr: 'IN', english: 'Indiana', chinese: '印第安纳', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100 },
];

const initialCities: CityArea[] = [
  { id: 3763, stateId: 54, english: 'Auburn', chinese: '奥本', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '36830' },
  { id: 3764, stateId: 54, english: 'Birmingham', chinese: '伯明翰', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '35201' },
  { id: 3765, stateId: 54, english: 'Dothan', chinese: '多森', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '36301' },
  { id: 3766, stateId: 54, english: 'Florence/Muscle Shoals', chinese: '弗洛伦萨/马斯尔肖尔斯', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '35630' },
  { id: 3767, stateId: 54, english: 'Gadsden-Anniston', chinese: '加兹登/安尼斯顿', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '35901' },
  { id: 3768, stateId: 54, english: 'Huntsville-Decatur', chinese: '亨茨维尔/迪凯特', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '35801' },
  { id: 3769, stateId: 54, english: 'Mobile', chinese: '莫比尔', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '36601' },
  { id: 3770, stateId: 54, english: 'Montgomery', chinese: '蒙哥马利', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '36101' },
  { id: 3771, stateId: 54, english: 'Tuscaloosa', chinese: '塔斯卡卢萨', status: '启用', updatedTime: '2025-05-28 14:43:49', sort: 100, zipCode: '35401' },
];

export default function AreaManagement() {
  const [states, setStates] = useState<StateArea[]>(initialStates);
  const [cities, setCities] = useState<CityArea[]>(initialCities);
  const [currentView, setCurrentView] = useState<'states' | 'cities'>('states');
  const [selectedState, setSelectedState] = useState<StateArea | null>(null);
  
  // Search state
  const [keyword, setKeyword] = useState('');

  // Modals view controllers
  const [stateModalOpen, setStateModalOpen] = useState(false);
  const [editingState, setEditingState] = useState<StateArea | null>(null);

  const [cityModalOpen, setCityModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<CityArea | null>(null);

  // States modal forms
  const [stateForm, setStateForm] = useState({
    abbr: '',
    chinese: '',
    english: '',
    sort: 100,
    status: '启用' as '启用' | '禁用'
  });

  // Cities modal forms
  const [cityForm, setCityForm] = useState({
    abbr: '', // Empty in screenshot, but editable if they desire
    chinese: '',
    english: '',
    zipCode: '',
    sort: 100,
    status: '启用' as '启用' | '禁用'
  });

  // Handle Opening modas
  const openAddState = () => {
    setEditingState(null);
    setStateForm({ abbr: '', chinese: '', english: '', sort: 100, status: '启用' });
    setStateModalOpen(true);
  };

  const openEditState = (stateArea: StateArea) => {
    setEditingState(stateArea);
    setStateForm({
      abbr: stateArea.abbr,
      chinese: stateArea.chinese,
      english: stateArea.english,
      sort: stateArea.sort,
      status: stateArea.status
    });
    setStateModalOpen(true);
  };

  const openAddCity = () => {
    setEditingCity(null);
    setCityForm({ abbr: '', chinese: '', english: '', zipCode: '', sort: 100, status: '启用' });
    setCityModalOpen(true);
  };

  const openEditCity = (cityArea: CityArea) => {
    setEditingCity(cityArea);
    setCityForm({
      abbr: '',
      chinese: cityArea.chinese,
      english: cityArea.english,
      zipCode: cityArea.zipCode || '',
      sort: cityArea.sort,
      status: cityArea.status
    });
    setCityModalOpen(true);
  };

  // Submit states form
  const handleStateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    if (editingState) {
      // Update
      setStates(prev => prev.map(s => s.id === editingState.id ? {
        ...s,
        abbr: stateForm.abbr,
        chinese: stateForm.chinese,
        english: stateForm.english,
        sort: Number(stateForm.sort),
        status: stateForm.status,
        updatedTime: nowStr
      } : s));
    } else {
      // Add
      const nextId = states.length > 0 ? Math.max(...states.map(s => s.id)) + 1 : 1;
      const newState: StateArea = {
        id: nextId,
        abbr: stateForm.abbr,
        chinese: stateForm.chinese,
        english: stateForm.english,
        sort: Number(stateForm.sort),
        status: stateForm.status,
        updatedTime: nowStr
      };
      setStates(prev => [...prev, newState]);
    }
    setStateModalOpen(false);
  };

  // Submit cities form
  const handleCitySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedState) return;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (editingCity) {
      setCities(prev => prev.map(c => c.id === editingCity.id ? {
        ...c,
        chinese: cityForm.chinese,
        english: cityForm.english,
        zipCode: cityForm.zipCode,
        sort: Number(cityForm.sort),
        status: cityForm.status,
        updatedTime: nowStr
      } : c));
    } else {
      const nextId = cities.length > 0 ? Math.max(...cities.map(c => c.id)) + 1 : 1001;
      const newCity: CityArea = {
        id: nextId,
        stateId: selectedState.id,
        chinese: cityForm.chinese,
        english: cityForm.english,
        zipCode: cityForm.zipCode,
        sort: Number(cityForm.sort),
        status: cityForm.status,
        updatedTime: nowStr
      };
      setCities(prev => [...prev, newCity]);
    }
    setCityModalOpen(false);
  };

  // Toggle state status inline
  const toggleStateStatus = (id: number) => {
    setStates(prev => prev.map(s => s.id === id ? { ...s, status: s.status === '启用' ? '禁用' : '启用' } : s));
  };

  // Toggle city status inline
  const toggleCityStatus = (id: number) => {
    setCities(prev => prev.map(c => c.id === id ? { ...c, status: c.status === '启用' ? '禁用' : '启用' } : c));
  };

  // Delete State
  const deleteState = (id: number) => {
    if (window.confirm('您确定要删除该地区吗？')) {
      setStates(prev => prev.filter(s => s.id !== id));
      setCities(prev => prev.filter(c => c.stateId !== id)); // Cascade delete cities
    }
  };

  // Delete City
  const deleteCity = (id: number) => {
    if (window.confirm('您确定要删除该城市吗？')) {
      setCities(prev => prev.filter(c => c.id !== id));
    }
  };

  // Filter listings based on search key
  const filteredStates = states.filter(s => 
    s.chinese.toLowerCase().includes(keyword.toLowerCase()) ||
    s.english.toLowerCase().includes(keyword.toLowerCase()) ||
    s.abbr.toLowerCase().includes(keyword.toLowerCase())
  );

  const filteredCities = selectedState ? cities.filter(c => 
    c.stateId === selectedState.id && (
      c.chinese.toLowerCase().includes(keyword.toLowerCase()) ||
      c.english.toLowerCase().includes(keyword.toLowerCase())
    )
  ) : [];

  return (
    <div className="space-y-6">
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          {currentView === 'cities' && selectedState ? (
            <button 
              onClick={() => { setCurrentView('states'); setKeyword(''); }} 
              className="flex items-center gap-1 text-sm font-semibold text-gray-800 hover:text-[#48a1a1] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>省份: 【{selectedState.chinese}】</span>
            </button>
          ) : (
            <h2 className="text-lg font-bold text-gray-800">地区管理</h2>
          )}
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button 
            onClick={currentView === 'states' ? openAddState : openAddCity}
            className="flex items-center gap-1.5 bg-[#48a1a1] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#3d8b8b] transition-colors shadow-sm cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>新增</span>
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <input 
            type="text" 
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="关键字查询"
            className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20 placeholder-gray-400"
          />
          <Search className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
        </div>
      </div>

      {/* Content views */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {currentView === 'states' ? (
          /* STATES VIEW */
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">ID</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">州名称 (缩写)</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">州名称 (英文)</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">州名称 (中文)</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">状态</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">更新时间</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredStates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400 text-sm">
                      没有找到匹配的地区数据。
                    </td>
                  </tr>
                ) : (
                  filteredStates.map((state) => (
                    <motion.tr 
                      key={state.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm text-gray-600">{state.id}</td>
                      <td className="px-6 py-4 text-sm text-gray-800 font-medium">{state.abbr || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{state.english}</td>
                      <td className="px-6 py-4 text-sm text-gray-800 font-medium">{state.chinese}</td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            state.status === '启用' ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"
                          )}>
                            {state.status}
                          </span>
                          <button 
                            onClick={() => toggleStateStatus(state.id)}
                            className="w-8 h-4 bg-gray-200 rounded-full relative transition-colors focus:outline-none"
                            style={{ backgroundColor: state.status === '启用' ? '#48a1a1' : '#e5e7eb' }}
                          >
                            <span 
                              className={cn(
                                "w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all",
                                state.status === '启用' ? "right-0.5" : "left-0.5"
                              )} 
                            />
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 font-mono">{state.updatedTime}</td>
                      <td className="px-6 py-4 text-sm text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            onClick={() => openEditState(state)}
                            className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                          >
                            编辑
                          </button>
                          <button 
                            onClick={() => { 
                              setSelectedState(state); 
                              setCurrentView('cities'); 
                              setKeyword(''); 
                            }}
                            className="px-2.5 py-1 text-xs text-white bg-[#48a1a1] hover:bg-[#3d8b8b] rounded transition-colors"
                          >
                            市列表
                          </button>
                          <button 
                            onClick={() => deleteState(state.id)}
                            className="px-2.5 py-1 text-xs text-white bg-red-400 hover:bg-red-500 rounded transition-colors"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* CITIES VIEW */
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">ID</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">州名称 (缩写)</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">州名称 (英文)</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">州名称 (中文)</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">状态</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">更新时间</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredCities.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400 text-sm">
                      没有找到该省下的城市数据。
                    </td>
                  </tr>
                ) : (
                  filteredCities.map((city) => (
                    <motion.tr 
                      key={city.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm text-gray-600">{city.id}</td>
                      <td className="px-6 py-4 text-sm text-gray-400">-</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{city.english}</td>
                      <td className="px-6 py-4 text-sm text-gray-800 font-medium">{city.chinese}</td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            city.status === '启用' ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"
                          )}>
                            {city.status}
                          </span>
                          <button 
                            onClick={() => toggleCityStatus(city.id)}
                            className="w-8 h-4 bg-gray-200 rounded-full relative transition-colors focus:outline-none"
                            style={{ backgroundColor: city.status === '启用' ? '#48a1a1' : '#e5e7eb' }}
                          >
                            <span 
                              className={cn(
                                "w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all",
                                city.status === '启用' ? "right-0.5" : "left-0.5"
                              )} 
                            />
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 font-mono">{city.updatedTime}</td>
                      <td className="px-6 py-4 text-sm text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            onClick={() => openEditCity(city)}
                            className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                          >
                            编辑
                          </button>
                          <button 
                            onClick={() => deleteCity(city.id)}
                            className="px-2.5 py-1 text-xs text-white bg-red-400 hover:bg-red-500 rounded transition-colors"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer info & pagination */}
        <div className="p-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <div>共 {currentView === 'states' ? filteredStates.length : filteredCities.length} 条</div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-1.5">
                <span>15条/页</span>
             </div>
             <div className="flex items-center gap-1">
                <button className="px-2.5 py-1 rounded bg-gray-50 border border-gray-200/50 hover:bg-gray-100">&lt;</button>
                <button className="px-2.5 py-1 rounded bg-[#48a1a1] text-white">1</button>
                <button className="px-2.5 py-1 rounded bg-gray-50 border border-gray-200/50 hover:bg-gray-100">&gt;</button>
             </div>
             <div className="flex items-center gap-1">
                <span>前往</span>
                <input type="text" className="w-8 border border-gray-100 rounded text-center py-0.5 focus:outline-none focus:ring-1 focus:ring-[#48a1a1]" defaultValue="1" />
                <span>页</span>
             </div>
          </div>
        </div>
      </div>

      {/* STATE MODAL (州管理) */}
      <AnimatePresence>
        {stateModalOpen && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-[600px] overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-semibold text-gray-800">州管理</h3>
                <button 
                  onClick={() => setStateModalOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:bg-gray-150 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleStateSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">州名称 (缩写)</label>
                  <input 
                    type="text" 
                    value={stateForm.abbr}
                    onChange={(e) => setStateForm(prev => ({ ...prev, abbr: e.target.value }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: AL"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">州名称 (中文)</label>
                  <input 
                    type="text" 
                    required
                    value={stateForm.chinese}
                    onChange={(e) => setStateForm(prev => ({ ...prev, chinese: e.target.value }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: 阿拉巴马州"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">州名称 (英文)</label>
                  <input 
                    type="text" 
                    required
                    value={stateForm.english}
                    onChange={(e) => setStateForm(prev => ({ ...prev, english: e.target.value }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: Alabama"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">排序</label>
                  <input 
                    type="number" 
                    value={stateForm.sort}
                    onChange={(e) => setStateForm(prev => ({ ...prev, sort: Number(e.target.value) }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">状态</label>
                  <div className="col-span-2 flex items-center gap-6 text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="stateStatus"
                        checked={stateForm.status === '启用'}
                        onChange={() => setStateForm(prev => ({ ...prev, status: '启用' }))}
                        className="text-[#48a1a1] focus:ring-[#48a1a1]"
                      />
                      <span>开启</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="stateStatus"
                        checked={stateForm.status === '禁用'}
                        onChange={() => setStateForm(prev => ({ ...prev, status: '禁用' }))}
                        className="text-[#48a1a1] focus:ring-[#48a1a1]"
                      />
                      <span>禁用</span>
                    </label>
                  </div>
                </div>

                <div className="pt-4 flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setStateModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded-lg"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    提交
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CITY MODAL (城市管理) */}
      <AnimatePresence>
        {cityModalOpen && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-[600px] overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-semibold text-gray-800">城市管理</h3>
                <button 
                  onClick={() => setCityModalOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:bg-gray-150 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCitySubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">州</label>
                  <input 
                    type="text" 
                    disabled
                    value={selectedState?.chinese || ''}
                    className="col-span-2 bg-gray-100 border border-gray-250 cursor-not-allowed rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">城市名称 (缩写)</label>
                  <input 
                    type="text" 
                    value={cityForm.abbr}
                    onChange={(e) => setCityForm(prev => ({ ...prev, abbr: e.target.value }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="可选，例如: AU"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">城市名称 (中文)</label>
                  <input 
                    type="text" 
                    required
                    value={cityForm.chinese}
                    onChange={(e) => setCityForm(prev => ({ ...prev, chinese: e.target.value }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="中文城市名称，例如: 奥本"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">城市名称 (英文)</label>
                  <input 
                    type="text" 
                    required
                    value={cityForm.english}
                    onChange={(e) => setCityForm(prev => ({ ...prev, english: e.target.value }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="英文城市名称，例如: Auburn"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">邮编</label>
                  <input 
                    type="text" 
                    value={cityForm.zipCode}
                    onChange={(e) => setCityForm(prev => ({ ...prev, zipCode: e.target.value }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: 36830"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">排序</label>
                  <input 
                    type="number" 
                    value={cityForm.sort}
                    onChange={(e) => setCityForm(prev => ({ ...prev, sort: Number(e.target.value) }))}
                    className="col-span-2 bg-gray-50 border border-gray-150 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 items-center">
                  <label className="text-xs font-semibold text-gray-600 text-right pr-2">状态</label>
                  <div className="col-span-2 flex items-center gap-6 text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="cityStatus"
                        checked={cityForm.status === '启用'}
                        onChange={() => setCityForm(prev => ({ ...prev, status: '启用' }))}
                        className="text-[#48a1a1] focus:ring-[#48a1a1]"
                      />
                      <span>开启</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="cityStatus"
                        checked={cityForm.status === '禁用'}
                        onChange={() => setCityForm(prev => ({ ...prev, status: '禁用' }))}
                        className="text-[#48a1a1] focus:ring-[#48a1a1]"
                      />
                      <span>禁用</span>
                    </label>
                  </div>
                </div>

                <div className="pt-4 flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setCityModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded-lg"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    提交
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
