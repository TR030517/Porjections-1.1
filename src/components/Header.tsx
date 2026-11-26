import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, User, LogOut, Store, Menu, Shield } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { shopStore, useShopStore } from '../stores/shop';
import { listResourcePage, ResourceId } from '../api/resources';
import ResourcePicker from './ResourcePicker';
import AccountSecurityDialog from './AccountSecurityDialog';
import { changeOwnPassword, currentManagementSessionKey, discardManagementSession } from '../api/session';
interface ShopOption { id: ResourceId; name: string; }
export default function Header({ onMenuToggle, onLogoutRequest, onSecurityRequest, onStoreScopeChange, allStoresSelected = false }: { onMenuToggle?: () => void; onLogoutRequest?: () => void | Promise<void>; onSecurityRequest?: () => boolean | Promise<boolean>; onStoreScopeChange?: (shopId: ResourceId | null) => void | Promise<void>; allStoresSelected?: boolean }) {
  const { user, roleLabel, logout } = useAuthStore();
  const { currentStoreId, setCurrentStoreId } = useShopStore();
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [securityOwner, setSecurityOwner] = useState<string | null>(null);
  const sessionKey = currentManagementSessionKey();
  const openSecurity = async () => {
    const owner = currentManagementSessionKey(); setOpen(false);
    if (!owner || onSecurityRequest && !await onSecurityRequest()) return;
    if (currentManagementSessionKey() === owner) setSecurityOwner(owner);
  };
  const shopDropdown = useRef<HTMLDivElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const allStoresSelectedRef = useRef(allStoresSelected);
  allStoresSelectedRef.current = allStoresSelected;
  const load = async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError('');
    try {
      const result = await listResourcePage<ShopOption>('stores', { pageSize: 100 }, controller.signal);
      if (controller.signal.aborted) return;
      if (allStoresSelectedRef.current) {
        shopStore.currentStoreId = null;
        setShops(result.items);
        return;
      }
      const selected = shopStore.currentStoreId;
      if (selected != null && !result.items.some(shop => String(shop.id) === String(selected))) {
        const selectedPage = await listResourcePage<ShopOption>('stores', { shopId: selected, pageSize: 1 }, controller.signal);
        if (controller.signal.aborted) return;
        if (selectedPage.items.length) result.items.push(selectedPage.items[0]);
        else shopStore.currentStoreId = result.items[0]?.id ?? null;
      } else if (selected == null) shopStore.currentStoreId = result.items[0]?.id ?? null;
      setShops(result.items);
    } catch (err) {
      if (!controller.signal.aborted) { setShops([]); shopStore.currentStoreId = null; setError(err instanceof Error ? err.message : '门店加载失败'); }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  useEffect(() => { void load(); return () => pending.current?.abort(); }, [user?.id]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (dropdown.current && !dropdown.current.contains(event.target as Node)) setOpen(false); if (shopDropdown.current && !shopDropdown.current.contains(event.target as Node)) setShopOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setShopOpen(false); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <><header className="app-header flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <button type="button" onClick={onMenuToggle} aria-label="打开导航菜单" className="mobile-menu-toggle items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600"><Menu className="h-5 w-5" /></button>
      <span className="rounded-md bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-700">Massajoy2.0</span>
      <div className="relative min-w-0" ref={shopDropdown}>
        <button type="button" aria-label="选择当前门店" aria-expanded={shopOpen} disabled={loading || !!error || !shops.length} onClick={() => setShopOpen(value => !value)} className="flex max-w-[min(270px,calc(100vw-100px))] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"><Store className="h-4 w-4 shrink-0 text-brand" /><span className="truncate">{loading ? '正在加载门店…' : error ? '门店加载失败' : !shops.length ? '暂无可管理门店' : currentStoreId == null ? '全部可管理门店' : shops.find(shop => String(shop.id) === String(currentStoreId))?.name ?? '门店 #' + currentStoreId}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" /></button>
        {shopOpen && <section aria-label="查询门店" className="absolute left-0 z-50 mt-2 w-[min(360px,calc(100vw-40px))] rounded-xl border border-slate-200 bg-white p-4 shadow-lg"><p className="mb-3 text-sm font-medium text-slate-700">选择业务门店</p><ResourcePicker resource="stores" value={currentStoreId} onSelect={item => { if (item?.name) setShops(previous => previous.some(shop => String(shop.id) === String(item.id)) ? previous : [...previous, {id:item.id,name:item.name!}]); }} onChange={value => { const next = typeof value === 'string' && value ? value : null; setShopOpen(false); if (onStoreScopeChange) void onStoreScopeChange(next); else setCurrentStoreId(next); }} /></section>}
      </div>
      <button type="button" disabled={loading} onClick={() => void load()} className="rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-slate-50">刷新</button>
      <span className="text-xs text-slate-500">公司管理 · 门店业务筛选</span>
      {error && <span role="status" className="max-w-sm text-xs leading-5 text-red-700">{error}</span>}
    </div>
    <div className="relative ml-auto" ref={dropdown}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="账户菜单" className="flex min-h-[38px] items-center gap-2 rounded-lg px-2 text-sm text-slate-700 hover:bg-slate-50"><User className="h-4 w-4" /><span>{user?.name || user?.email || '管理账户'}</span><ChevronDown className="h-3.5 w-3.5" /></button>
      {open && <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3"><p className="text-sm font-medium text-slate-800">{roleLabel}</p><p className="mt-1 break-all text-xs text-slate-500">{user?.email}</p></div>
        <button type="button" onClick={() => void openSecurity()} className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"><Shield className="h-4 w-4" />账号与安全</button>
        <button type="button" onClick={() => { setOpen(false); void (onLogoutRequest ? onLogoutRequest() : logout()); }} className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm text-red-600 hover:bg-red-50"><LogOut className="h-4 w-4" />退出登录</button>
      </div>}
    </div>
  </header>{user && sessionKey && securityOwner === sessionKey && <AccountSecurityDialog key={sessionKey} account={user} sessionKey={sessionKey} changePassword={changeOwnPassword} onClose={() => setSecurityOwner(null)} onReauthenticate={() => { if (discardManagementSession(sessionKey)) setSecurityOwner(null); }} />}</>;
}
