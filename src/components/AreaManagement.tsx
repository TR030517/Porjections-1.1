import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, ChevronLeft, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { listResources, createResource, updateResource, deleteResource, ResourceId } from '../api/resources';

import { useConfirmation } from './Confirmation';

interface StateArea {
  id: ResourceId;
  abbr: string;
  english: string;
  chinese: string;
  status: '启用' | '禁用';
  updatedTime: string;
  sort: number;
}

interface CityArea {
  id: ResourceId;
  abbr?: string;
  stateId: ResourceId;
  english: string;
  chinese: string;
  status: '启用' | '禁用';
  updatedTime: string;
  zipCode?: string;
  sort: number;
}

interface RegionRecord extends StateArea {
  kind: 'state' | 'city';
  parentId?: ResourceId;
  stateId?: ResourceId;
  zipCode?: string;
}

function toStateArea(item: RegionRecord): StateArea {
  return { ...item, abbr: item.abbr || '' };
}

function toCityArea(item: RegionRecord): CityArea {
  return { ...item, stateId: item.parentId ?? item.stateId ?? '' };
}

export default function AreaManagement() {
  const confirm = useConfirmation();
  const [states, setStates] = useState<StateArea[]>([]);
  const [cities, setCities] = useState<CityArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadRegions = async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      const items = await listResources<RegionRecord>('regions', { kind: currentView === 'states' ? 'state' : 'city', parentId: currentView === 'cities' ? selectedState?.id : undefined, search: keyword.trim() }, signal);
      if (signal?.aborted) return;
      if (currentView === 'states') setStates(items.map(toStateArea));
      else setCities(items.map(toCityArea));
    } catch (error) {
      if (!signal?.aborted) { if (currentView === 'states') setStates([]); else setCities([]); setLoadError(error instanceof Error ? error.message : '地区数据加载失败，请重试。'); }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  const [currentView, setCurrentView] = useState<'states' | 'cities'>('states');
  const [selectedState, setSelectedState] = useState<StateArea | null>(null);
  
  // Search state
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadRegions(controller.signal), 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [currentView, selectedState?.id, keyword]);

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
    setFormError('');
    setEditingState(null);
    setStateForm({ abbr: '', chinese: '', english: '', sort: 100, status: '启用' });
    setStateModalOpen(true);
  };

  const openEditState = (stateArea: StateArea) => {
    setFormError('');
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
    setFormError('');
    setEditingCity(null);
    setCityForm({ abbr: '', chinese: '', english: '', zipCode: '', sort: 100, status: '启用' });
    setCityModalOpen(true);
  };

  const openEditCity = (cityArea: CityArea) => {
    setFormError('');
    setEditingCity(cityArea);
    setCityForm({
      abbr: cityArea.abbr || '',
      chinese: cityArea.chinese,
      english: cityArea.english,
      zipCode: cityArea.zipCode || '',
      sort: cityArea.sort,
      status: cityArea.status
    });
    setCityModalOpen(true);
  };

  const handleStateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError('');
    const payload = { ...stateForm, kind: 'state', updatedTime: new Date().toISOString().replace('T', ' ').substring(0, 19) };
    try {
      const result = editingState
        ? await updateResource<RegionRecord>('regions', editingState.id, payload)
        : await createResource<RegionRecord>('regions', payload);
      const saved = toStateArea(result);
      setStates(previous => editingState ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
      if (selectedState?.id === saved.id) setSelectedState(saved);
      setStateModalOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '地区保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const handleCitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedState || saving) return;
    setSaving(true);
    setFormError('');
    const payload = {
      ...cityForm,
      kind: 'city',
      parentId: selectedState.id,
      stateId: selectedState.id,
      updatedTime: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };
    try {
      const result = editingCity
        ? await updateResource<RegionRecord>('regions', editingCity.id, payload)
        : await createResource<RegionRecord>('regions', payload);
      const saved = toCityArea(result);
      setCities(previous => editingCity ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
      setCityModalOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '城市保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const toggleStateStatus = async (id: ResourceId) => {
    const state = states.find(item => item.id === id);
    if (!state || saving) return;
    setSaving(true);
    setActionError('');
    try {
      const saved = toStateArea(await updateResource<RegionRecord>('regions', id, { status: state.status === '启用' ? '禁用' : '启用' }));
      setStates(previous => previous.map(item => item.id === saved.id ? saved : item));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '状态更新失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const toggleCityStatus = async (id: ResourceId) => {
    const city = cities.find(item => item.id === id);
    if (!city || saving) return;
    setSaving(true);
    setActionError('');
    try {
      const saved = toCityArea(await updateResource<RegionRecord>('regions', id, { status: city.status === '启用' ? '禁用' : '启用' }));
      setCities(previous => previous.map(item => item.id === saved.id ? saved : item));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '状态更新失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const deleteState = async (id: ResourceId) => {
    if (saving || !await confirm({ title: '删除地区', message: '确认删除该地区？仍有所属城市的地区无法删除，请先处理城市。', confirmLabel: '删除' })) return;
    setSaving(true);
    setActionError('');
    try {
      await deleteResource('regions', id);
      setStates(previous => previous.filter(item => item.id !== id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '地区删除失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const deleteCity = async (id: ResourceId) => {
    if (saving || !await confirm({ title: '删除城市', message: '该城市将从服务器删除，是否继续？', confirmLabel: '删除' })) return;
    setSaving(true);
    setActionError('');
    try {
      await deleteResource('regions', id);
      setCities(previous => previous.filter(item => item.id !== id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '城市删除失败，请重试。');
    } finally {
      setSaving(false);
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
    <div className="min-w-0 space-y-6 text-sm leading-relaxed">
      <p className="text-xs text-slate-500">每次最多显示 500 条匹配记录，可按英文名称缩小查询范围。</p>
      {/* Top action header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          {currentView === 'cities' && selectedState && (
            <button onClick={() => { setCurrentView('states'); setKeyword(''); }} className="mb-3 flex items-center gap-1 text-[13px] text-slate-500 transition-colors hover:text-[#48a1a1]">
              <ChevronLeft className="h-4 w-4" />返回地区列表
            </button>
          )}
          <h2 className="page-heading">{currentView === 'states' ? '地区管理' : '城市管理'}</h2>
          <p className="page-description">{currentView === 'states' ? '维护 Massajoy2.0 平台中的州、省与城市。' : `${selectedState?.chinese || ''} · 管理该地区所属城市。`}</p>
        </div>
        <button disabled={loading || saving || Boolean(loadError)} onClick={currentView === 'states' ? openAddState : openAddCity} className="flex shrink-0 items-center gap-2 rounded-lg bg-[#48a1a1] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#3d8b8b]">
          <Plus className="h-4 w-4" />{currentView === 'states' ? '新增州 / 省' : '新增城市'}
        </button>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <span>{loadError}</span>
          <button type="button" onClick={() => void loadRegions()} disabled={loading} className="rounded-lg border border-amber-300 bg-white px-3 py-2">重新加载</button>
        </div>
      )}
      {actionError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{actionError}</div>}

      {/* Filter / Search Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-white p-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-md">
          <label htmlFor="area-search" className="mb-2 block text-[13px] font-medium text-slate-600">地区名称</label>
          <div className="relative">
            <input id="area-search" type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={currentView === 'states' ? '按地区英文名称查询' : '按城市英文名称查询'} className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-2 pl-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-[#48a1a1]/20" />
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        </div>
        <span className="py-2 text-[13px] text-slate-500">筛选条件实时生效</span>
      </div>

      {/* Content views */}
      <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-white">
        {currentView === 'states' ? (
          /* STATES VIEW */
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: 980 }}>
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">ID</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">缩写</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">英文名称</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">中文名称</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">状态</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">更新时间</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-16 text-center text-sm text-slate-500">正在加载地区数据…</td></tr>
                ) : filteredStates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400 text-sm">
                      {loadError ? '地区数据暂不可用，请稍后重新加载。' : '没有找到匹配的地区数据。'}
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
                            "text-[13px] font-medium px-2 py-0.5 rounded-full",
                            state.status === '启用' ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"
                          )}>
                            {state.status}
                          </span>
                          <button 
                            disabled={saving} aria-label={`切换${state.chinese}启用状态`}
                            onClick={() => void toggleStateStatus(state.id)}
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
                      <td className="whitespace-nowrap px-6 py-4 text-[13px] text-slate-500">{state.updatedTime}</td>
                      <td className="px-6 py-4 text-sm text-center">
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                          <button 
                            disabled={saving} onClick={() => openEditState(state)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600 transition-colors hover:border-[#48a1a1] hover:text-[#48a1a1]"
                          >
                            编辑
                          </button>
                          <button 
                            onClick={() => { 
                              setSelectedState(state); 
                              setCurrentView('cities'); 
                              setKeyword(''); 
                            }}
                            className="rounded-lg bg-teal-50 px-3 py-2 text-[13px] text-teal-700 transition-colors hover:bg-teal-100"
                          >
                            城市列表
                          </button>
                          <button 
                            disabled={saving} onClick={() => void deleteState(state.id)}
                            className="rounded-lg px-3 py-2 text-[13px] text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
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
            <table className="w-full text-left" style={{ minWidth: 980 }}>
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">ID</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">邮编</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">英文名称</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">中文名称</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">状态</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600">更新时间</th>
                  <th className="px-6 py-4 text-[13px] font-semibold text-gray-600 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-16 text-center text-sm text-slate-500">正在加载城市数据…</td></tr>
                ) : filteredCities.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400 text-sm">
                      没有符合条件的城市，请调整筛选条件或新增城市。
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
                      <td className="px-6 py-4 text-[13px] text-slate-500">{city.zipCode || '—'}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{city.english}</td>
                      <td className="px-6 py-4 text-sm text-gray-800 font-medium">{city.chinese}</td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[13px] font-medium px-2 py-0.5 rounded-full",
                            city.status === '启用' ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"
                          )}>
                            {city.status}
                          </span>
                          <button 
                            disabled={saving} aria-label={`切换${city.chinese}启用状态`}
                            onClick={() => void toggleCityStatus(city.id)}
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
                      <td className="whitespace-nowrap px-6 py-4 text-[13px] text-slate-500">{city.updatedTime}</td>
                      <td className="px-6 py-4 text-sm text-center">
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                          <button 
                            disabled={saving} onClick={() => openEditCity(city)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600 transition-colors hover:border-[#48a1a1] hover:text-[#48a1a1]"
                          >
                            编辑
                          </button>
                          <button 
                            disabled={saving} onClick={() => void deleteCity(city.id)}
                            className="rounded-lg px-3 py-2 text-[13px] text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
          <span>共 {currentView === 'states' ? filteredStates.length : filteredCities.length} 条</span>
          <span>窄屏可横向滚动查看</span>
        </div>
      </div>

      {/* STATE MODAL (州管理) */}
      <AnimatePresence>
        {stateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 sm:p-5">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              role="dialog" aria-modal="true" className="flex max-h-[90dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-5 sm:px-6">
                <h3 className="text-lg font-semibold text-slate-900">{editingState ? '编辑州 / 省' : '新增州 / 省'}</h3>
                <button 
                  disabled={saving} onClick={() => setStateModalOpen(false)}
                  aria-label="关闭地区编辑" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleStateSubmit} className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6">
                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">缩写</label>
                  <input 
                    type="text" 
                    required
                    value={stateForm.abbr}
                    onChange={(e) => setStateForm(prev => ({ ...prev, abbr: e.target.value }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: AL"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">中文名称</label>
                  <input 
                    type="text" 
                    required
                    value={stateForm.chinese}
                    onChange={(e) => setStateForm(prev => ({ ...prev, chinese: e.target.value }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: 阿拉巴马州"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">英文名称</label>
                  <input 
                    type="text" 
                    required
                    value={stateForm.english}
                    onChange={(e) => setStateForm(prev => ({ ...prev, english: e.target.value }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: Alabama"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">排序</label>
                  <input 
                    type="number" 
                    value={stateForm.sort}
                    onChange={(e) => setStateForm(prev => ({ ...prev, sort: Number(e.target.value) }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">状态</label>
                  <div className="flex items-center gap-6 text-sm">
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

                <div className="sticky -bottom-5 -mx-5 flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:-bottom-6 sm:-mx-6 sm:px-6">
                  {formError && <div role="alert" className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
                  <button 
                    type="button"
                    disabled={saving} onClick={() => setStateModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded-lg"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    disabled={saving}
                    className="disabled:opacity-60 px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {saving ? '保存中…' : '保存'}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 sm:p-5">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              role="dialog" aria-modal="true" className="flex max-h-[90dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-5 sm:px-6">
                <h3 className="text-lg font-semibold text-slate-900">{editingCity ? '编辑城市' : '新增城市'}</h3>
                <button 
                  disabled={saving} onClick={() => setCityModalOpen(false)}
                  aria-label="关闭地区编辑" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCitySubmit} className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6">
                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">州</label>
                  <input 
                    type="text" 
                    disabled
                    value={selectedState?.chinese || ''}
                    className="bg-gray-100 border border-slate-200 cursor-not-allowed rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">城市名称 (缩写)</label>
                  <input 
                    type="text" 
                    value={cityForm.abbr}
                    onChange={(e) => setCityForm(prev => ({ ...prev, abbr: e.target.value }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="可选，例如: AU"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">城市名称 (中文)</label>
                  <input 
                    type="text" 
                    required
                    value={cityForm.chinese}
                    onChange={(e) => setCityForm(prev => ({ ...prev, chinese: e.target.value }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="中文城市名称，例如: 奥本"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">城市名称 (英文)</label>
                  <input 
                    type="text" 
                    required
                    value={cityForm.english}
                    onChange={(e) => setCityForm(prev => ({ ...prev, english: e.target.value }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="英文城市名称，例如: Auburn"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">邮编</label>
                  <input 
                    type="text" 
                    value={cityForm.zipCode}
                    onChange={(e) => setCityForm(prev => ({ ...prev, zipCode: e.target.value }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                    placeholder="例如: 36830"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">排序</label>
                  <input 
                    type="number" 
                    value={cityForm.sort}
                    onChange={(e) => setCityForm(prev => ({ ...prev, sort: Number(e.target.value) }))}
                    className="bg-gray-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#48a1a1]/20"
                  />
                </div>

                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-5">
                  <label className="text-[13px] font-semibold text-slate-600">状态</label>
                  <div className="flex items-center gap-6 text-sm">
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

                <div className="sticky -bottom-5 -mx-5 flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:-bottom-6 sm:-mx-6 sm:px-6">
                  {formError && <div role="alert" className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
                  <button 
                    type="button"
                    disabled={saving} onClick={() => setCityModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded-lg"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    disabled={saving}
                    className="disabled:opacity-60 px-5 py-2 bg-[#48a1a1] hover:bg-[#3d8b8b] text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {saving ? '保存中…' : '保存'}
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
