import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, Ban, Copy, Check, ChevronLeft, ChevronRight, MapPin, Plus, RefreshCw, Search, Store, Upload } from 'lucide-react';
import { deleteResource, listResourcePage, updateResource } from '../api/resources';
import { ApiError } from '../api/session';
import type { ResourceId, ResourceQuery } from '../api/resources';
import { useAuthStore } from '../stores/authStore';
import { useConfirmation } from './Confirmation';
import StoreWorkspace from './store/StoreWorkspace';
import StorePublicIntake from './store/StorePublicIntake';
import StoreCopySettings from './StoreCopySettings';
import { getAdminCopySnapshot, subscribeAdminCopy } from '../stores/adminCopyStore';
import { readPendingIntake } from './store/publicIntakeModel';
import type { StoreWorkspaceLifecycleListener, StoreBusinessView } from './store/StoreWorkspace';
import { merchantWorkspaceUrl } from '../utils/merchantWorkspaceUrl';
import type { StoreBusinessTarget } from './store/StoreBusinessSettings';
import { STATUS } from './store/storeModel';
import { safePreviewImageUrl } from './store/StoreCustomerPreview';
import type { StoreItem } from './store/types';
import { storeAccountSummary } from '../utils/storeAccountStatus';
import { applyStoreShortLink, reconcileStoreShortLinkDrafts, savedStoreShortLink, storeShortLinkDraft } from '../utils/storeShortLink';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope } from './store/businessScope';
import type { ReadinessAction, ReadinessSection } from '../api/shopReadiness';
import { readinessSelection } from './store/readinessModel';
import { publicShopProfile } from '../../backend/src/common/shop-public-profile';
import { SHOP_SEARCH_MAX_LENGTH } from '../../backend/src/common/shop-search';
import { locationPage, locationPageSize } from '../utils/adminLocation';
import { customerSiteOrigin } from '../utils/customerSiteUrl';
import { storePublicUrl } from './store/StorePublicLink';
import './store/storeStudio.css';

function initialFilters(query?: ResourceQuery) {
  return {
    search: typeof query?.search === 'string' ? query.search.trim().slice(0, SHOP_SEARCH_MAX_LENGTH) : '',
    status: typeof query?.status === 'string' && Object.hasOwn(STATUS, query.status) ? query.status : '',
  };
}
function StoreLogo({ item }: { item: StoreItem }) {
  const [failed, setFailed] = useState('');
  const media = publicShopProfile({ studioProfile: { logoUrl: item.logoUrl, bannerUrl: item.bannerUrl, gallery: item.gallery } });
  const src = safePreviewImageUrl(item.thumbnail ?? media.thumbnail ?? '');
  return <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-teal-100 bg-teal-50 text-lg text-teal-700">
    {src && failed !== src ? <img src={src} alt={item.name ? item.name + ' Logo' : ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} className="h-full w-full object-cover" /> : item.logo ? <span className="truncate px-1">{item.logo}</span> : <Store className="h-5 w-5" />}
  </span>;
}
function StoreIdentity({ item }: { item: StoreItem }) {
  return <div className="flex min-w-0 items-center gap-3">
    <StoreLogo item={item} />
    <div className="min-w-0"><StoreName item={item} />
      {item.subtitle && <span className="mt-0.5 block max-w-64 truncate text-xs text-slate-500">{item.subtitle}</span>}
    </div>
  </div>;
}
function StoreName({ item }: { item: StoreItem }) {
  let publicUrl: string | null = null;
  try {
    if (typeof window !== 'undefined') publicUrl = storePublicUrl(item.canonicalPath, customerSiteOrigin(window.location.origin));
  } catch { /* An invalid site origin must not produce a guessed customer link. */ }
  const linkTitle = publicUrl
    ? item.publicVisible === true ? '在新窗口打开门店顾客页面' : '在新窗口打开顾客页面；门店当前未对外开放'
    : '保存有效短链后可打开顾客页面';
  const indicatorClass = 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium';
  return <div className="flex min-w-0 items-center gap-2">
    <span title={item.name} className="min-w-0 truncate font-semibold leading-6 text-slate-800">{item.name}</span>
    {publicUrl ? <a href={publicUrl} target="_blank" rel="noopener noreferrer" title={linkTitle}
      aria-label={'打开 ' + item.name + ' 的顾客页面（新窗口）'}
      className={indicatorClass + ' text-teal-700 hover:bg-teal-50 hover:text-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600'}>
      <span>顾客页</span><ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
    </a> : <span title={linkTitle} aria-label={linkTitle} className={indicatorClass + ' cursor-not-allowed text-slate-400'}>
      <span>顾客页</span><ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
    </span>}
  </div>;
}
function StoreShortLink({ item, value, saving, saveBlocked, unverified, onChange, onSave }: { item: StoreItem; value: string; saving: boolean; saveBlocked: boolean; unverified: boolean; onChange: (value: string) => void; onSave: () => void }) {
  const current = item.canonicalShortName ?? item.shortName ?? '';
  const dirty = value.trim().toLowerCase() !== current;
  const preview = storeShortLinkDraft(value);
  return <div className="min-w-52 space-y-1">
    <div className="flex items-center gap-1.5">
      <input type="text" value={value} maxLength={100} autoComplete="off" spellCheck={false} aria-label={'门店短链 ' + item.name}
        onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && dirty && preview && !saveBlocked) { event.preventDefault(); onSave(); } }}
        disabled={saving || unverified} className="store-control min-w-0 px-2.5! py-1.5! text-sm" />
      {dirty && <button type="button" disabled={saving || saveBlocked || !preview} onClick={onSave} className="store-icon-button h-8 w-8 shrink-0" aria-label={'保存 ' + item.name + ' 的短链'} title="保存短链"><Check className="h-4 w-4" /></button>}
    </div>
    <span className={'block text-xs '+(value.trim() && !preview ? 'text-red-600' : 'truncate text-slate-400')}>{preview?.path ?? (value.trim() ? '需为 3–100 个英文字母或数字，可用单个横线分隔' : '请输入门店短链')}</span>
    {unverified && <span className="block text-xs text-amber-700">保存结果待核对，请刷新门店列表。</span>}
  </div>;
}
function Status({ item }: { item: StoreItem }) {
  return <span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-medium '+(item.status==='APPROVED'?'bg-teal-50 text-teal-700':item.status==='REJECTED'?'bg-red-50 text-red-700':item.status==='PENDING'?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-500')}>{STATUS[item.status] ?? '状态未提供'}</span>;
}
function Readiness({ item, disabled, onOpen }: { item: StoreItem; disabled?: boolean; onOpen: () => void }) {
  const checks = (item.publicationChecklist ?? []).filter(check=>typeof check.complete==='boolean');
  const missing = checks.filter(check=>!check.complete);
  return <button type="button" disabled={disabled} onClick={onOpen} aria-label={'检查 ' + item.name + ' 的营业准备'} className="inline-flex items-center gap-1.5 text-left text-xs text-teal-700 underline-offset-4 hover:underline">{item.publicationReady && <Check className="h-3.5 w-3.5" />}{item.publicationReady ? '发布资料齐全' : checks.length ? missing.length+' 项发布资料待完善' : '待核对发布资料'}</button>;
}
export default function StoreManagement({ openStoreId, onStoreOpened, initialQuery, onQueryChange, onNavigateStore, onManageAccountAccess, onReadinessAction, initialWorkspaceSection, initialBusinessTarget, onLifecycleChange }: {
  openStoreId?: ResourceId | null;
  onStoreOpened?: () => void;
  initialQuery?: ResourceQuery;
  onQueryChange?: (query: ResourceQuery) => void;
  onNavigateStore?: (view: StoreBusinessView, item: StoreItem) => void;
  onManageAccountAccess?: (item: StoreItem) => void;
  onReadinessAction?: (action: ReadinessAction, item: StoreItem) => void;
  initialWorkspaceSection?: ReadinessSection;
  initialBusinessTarget?: StoreBusinessTarget;
  onLifecycleChange?: StoreWorkspaceLifecycleListener;
}) {
  const { isStoreManager, user } = useAuthStore();
  const confirm = useConfirmation();
  const scope = useBusinessScope(undefined, false);
  const [items,setItems] = useState<StoreItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const shortLinkSave = useRef<symbol | null>(null);
  const [shortLinkDrafts,setShortLinkDrafts] = useState<Record<string,string>>({});
  const [savingShortLinkId,setSavingShortLinkId] = useState<string|null>(null);
  const [unverifiedShortLinks,setUnverifiedShortLinks] = useState<string[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [reload,setReload] = useState(0);
  const [workspaceSection, setWorkspaceSection] = useState<ReadinessSection | undefined>();
  const [workspaceBusinessTarget, setWorkspaceBusinessTarget] = useState<StoreBusinessTarget | undefined>();
  const [keyword,setKeyword] = useState(()=>initialFilters(initialQuery).search);
  const [search,setSearch] = useState(()=>initialFilters(initialQuery).search);
  const [statusDraft,setStatusDraft] = useState(()=>initialFilters(initialQuery).status);
  const [status,setStatus] = useState(()=>initialFilters(initialQuery).status);
  const [page,setPage] = useState(()=>locationPage(initialQuery?.page));
  const [pageSize,setPageSize] = useState(()=>locationPageSize(initialQuery?.pageSize,[25,50,100],25));
  const [total,setTotal] = useState(0);
  const [editing,setEditing] = useState<StoreItem|null|undefined>(undefined);
  useLayoutEffect(() => { if (editing === undefined) onLifecycleChange?.(EMPTY_BUSINESS_LIFECYCLE); }, [editing, onLifecycleChange]);
  useLayoutEffect(() => () => onLifecycleChange?.(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  const [busy,setBusy] = useState(false);
  const [showIntake,setShowIntake] = useState(false);
  const [copySource,setCopySource] = useState<{ id?: string } | null>(null);
  const copySnapshot = useSyncExternalStore(subscribeAdminCopy, getAdminCopySnapshot, getAdminCopySnapshot);
  const pendingCopy = copySnapshot.actorId === String(user?.id) && copySnapshot.operation !== null;
  useEffect(() => { setCopySource(null); }, [user?.id]);
  const [intakePending,setIntakePending] = useState(false);
  const updateIntakePending=()=>{try{setIntakePending(!!user&&!!readPendingIntake(window.sessionStorage,String(user.id)));}catch{setIntakePending(false);}};
  useEffect(()=>{setShowIntake(false);updateIntakePending();},[user?.id]);
  const navigationFilters = JSON.stringify(initialFilters(initialQuery));
  useEffect(()=>{shortLinkSave.current=null;setSavingShortLinkId(null);setUnverifiedShortLinks([]);setShortLinkDrafts({});setNotice('');setEditing(undefined);},[scope.actorId]);
  useEffect(()=>{
    const controller=new AbortController(), current=scope.capture(), checking=new Set(unverifiedShortLinks); setLoading(true); setError('');
    if(!current()){setItems([]);setTotal(0);setLoading(false);return()=>controller.abort();}
    listResourcePage<StoreItem>('stores',{page,pageSize,search,status},controller.signal)
      .then(result=>{if(!controller.signal.aborted&&current()){const before=itemsRef.current;setItems(result.items);setShortLinkDrafts(previous=>reconcileStoreShortLinkDrafts(previous,before,result.items));setUnverifiedShortLinks(previous=>previous.filter(id=>!checking.has(id)||!result.items.some(item=>String(item.id)===id)));setTotal(result.total);if(page>1&&!result.items.length)setPage(Math.max(1,Math.ceil(result.total/pageSize)));}})
      .catch(err=>{if(!controller.signal.aborted&&current()){setItems([]);setTotal(0);setError(err instanceof Error?err.message:'门店加载失败');}})
      .finally(()=>{if(!controller.signal.aborted&&current())setLoading(false);});
    return ()=>controller.abort();
  },[page,pageSize,search,status,reload,scope.actorId,scope.capture]);
  useEffect(()=>{
    const next=JSON.parse(navigationFilters) as ReturnType<typeof initialFilters>;
    setKeyword(next.search);setSearch(next.search);setStatusDraft(next.status);setStatus(next.status);setPage(locationPage(initialQuery?.page));setPageSize(locationPageSize(initialQuery?.pageSize,[25,50,100],25));setEditing(undefined);
  },[navigationFilters,initialQuery?.page,initialQuery?.pageSize]);
  useEffect(()=>{
    onQueryChange?.({search,status,page,pageSize,storeSection:initialQuery?.storeSection});
  },[search,status,page,pageSize,initialQuery?.storeSection,onQueryChange]);
  useEffect(()=>{
    if(openStoreId==null)return;
    const controller=new AbortController(), current=scope.capture();
    if(!current())return()=>controller.abort();
    listResourcePage<StoreItem>('stores',{shopId:openStoreId,pageSize:1},controller.signal)
      .then(result=>{if(controller.signal.aborted||!current())return;const target=readinessSelection(result.items,String(openStoreId));if(!target)throw new Error('目标门店未找到或返回结果不匹配，当前未打开其他门店。');setWorkspaceSection(initialWorkspaceSection);setWorkspaceBusinessTarget(initialBusinessTarget);setEditing(target);onStoreOpened?.();})
      .catch(err=>{if(!controller.signal.aborted&&current()){setError(err instanceof Error?err.message:'门店资料加载失败');onStoreOpened?.();}});
    return ()=>controller.abort();
  },[openStoreId, initialWorkspaceSection, initialBusinessTarget,scope.actorId,scope.capture]);
  const disable=async(item:StoreItem)=>{
    if(busy||!await confirm({title:'停用门店',message:'停用后门店将停止对外展示，历史资料与订单保留。是否继续？',confirmLabel:'停用门店'}))return;
    setBusy(true);setError('');setNotice('');
    try{await deleteResource('stores',item.id);setNotice(item.name+' 已停用。');setReload(value=>value+1);}
    catch(err){setError(err instanceof Error?err.message:'停用失败');}
    finally{setBusy(false);}
  };
  const saveShortLink=async(item:StoreItem)=>{
    const key=String(item.id), draft=storeShortLinkDraft(shortLinkDrafts[key]??''), current=scope.capture();
    if(!draft||shortLinkSave.current||unverifiedShortLinks.includes(key)||loading||!current())return;
    const attempt=Symbol('short-link-save'); shortLinkSave.current=attempt;
    setSavingShortLinkId(key);setError('');setNotice('');
    try{
      const response=await updateResource<StoreItem>('stores',item.id,{shortName:draft.shortName});
      if(!current())return;
      const saved=savedStoreShortLink(response,item.id,draft.shortName);
      setItems(previous=>previous.map(row=>applyStoreShortLink(row,saved)));
      setShortLinkDrafts(previous=>({...previous,[key]:saved.shortName}));
      setNotice(item.name+' 的顾客页面短链已保存。');
      // Cancel any older list read and resolve the current filter using the saved canonical link.
      setReload(value=>value+1);
    }catch(err){if(current()){setError(err instanceof Error?err.message:'短链保存失败，请刷新门店列表核对。');if(!(err instanceof ApiError&&err.status>=400&&err.status<500&&![408,429].includes(err.status)))setUnverifiedShortLinks(previous=>previous.includes(key)?previous:[...previous,key]);}}
    finally{if(shortLinkSave.current===attempt){shortLinkSave.current=null;if(current())setSavingShortLinkId(null);}}
  };
  const actions=(item:StoreItem)=><div className="flex flex-wrap items-center gap-2">
    <button type="button" disabled={savingShortLinkId===String(item.id)||unverifiedShortLinks.includes(String(item.id))} onClick={()=>{setNotice('');setWorkspaceSection(undefined);setWorkspaceBusinessTarget(undefined);setEditing(item);}} className="store-open-button">编辑门店<ArrowUpRight className="h-3.5 w-3.5" /></button><a href={merchantWorkspaceUrl('/?shopId='+encodeURIComponent(item.id))} target="_blank" rel="noopener noreferrer" className="store-secondary-button">商家工作区</a>{user?.role==='ADMIN'&&<button type="button" aria-label={'复制 '+item.name+' 的已保存设置'} onClick={()=>setCopySource({id:String(item.id)})} className="store-secondary-button"><Copy className="h-3.5 w-3.5"/>复制设置</button>}
    {!isStoreManager&&item.status!=='SUSPENDED'&&<button type="button" disabled={busy} onClick={()=>void disable(item)} className="store-icon-button hover:text-red-600" aria-label={'停用 '+item.name} title="停用门店"><Ban className="h-4 w-4" /></button>}
  </div>;
  const openReadiness = (item: StoreItem) => { setNotice(''); setWorkspaceSection('review'); setWorkspaceBusinessTarget(undefined); setEditing(item); };
  return <div className="app-page store-directory">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-heading">门店管理</h1><p className="page-description">让每家门店保持自己的样子。管理品牌展示、营业设置与门店业务。</p></div><div className="flex flex-wrap gap-3">{user?.role==='ADMIN'&&<button type="button" onClick={()=>setCopySource({})} className="store-secondary-button"><Copy className="h-4 w-4"/>{pendingCopy?'核对上次复制':'复制门店设置'}</button>}{user?.role==='ADMIN'&&<button type="button" disabled={loading&&!intakePending} onClick={()=>setShowIntake(true)} className="store-secondary-button"><Upload className="h-4 w-4" />{intakePending?'导入结果待核对':'导入资料'}</button>}{!isStoreManager&&<button type="button" onClick={()=>{setNotice('');setWorkspaceSection('basic');setWorkspaceBusinessTarget(undefined);setEditing(null);}} className="store-primary-button"><Plus className="h-4 w-4" />新增门店</button>}</div></div>
    <form onSubmit={event=>{event.preventDefault();setSearch(keyword.trim());setStatus(statusDraft);setPage(1);setReload(value=>value+1);}} className="surface-panel flex flex-wrap items-end gap-3 p-5">
      <label className="min-w-0 flex-[1_1_260px] space-y-2 text-sm text-slate-500"><span>查找门店</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input type="search" maxLength={SHOP_SEARCH_MAX_LENGTH} value={keyword} onChange={event=>setKeyword(event.target.value)} placeholder="门店名称、短链或网址" className="store-control pl-9!" /></span></label>
      <label className="min-w-36 flex-[0_1_180px] space-y-2 text-sm text-slate-500"><span>发布状态</span><select value={statusDraft} onChange={event=>setStatusDraft(event.target.value)} className="store-control"><option value="">全部状态</option>{Object.entries(STATUS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <button className="store-primary-button">查询</button><button type="button" onClick={()=>{setKeyword('');setSearch('');setStatusDraft('');setStatus('');setPage(1);setReload(value=>value+1);}} className="store-secondary-button">重置</button><button type="button" disabled={loading} onClick={()=>setReload(value=>value+1)} className="store-icon-button" aria-label="刷新门店列表"><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')} /></button>
    </form>
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-800">{notice}</p>}
    <section className="surface-panel overflow-hidden" aria-label="门店列表">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-800">{status?STATUS[status as keyof typeof STATUS]+'门店':'全部门店'}<span className="ml-2 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">{loading||error?'—':total}</span></h2><span className="text-xs text-slate-400">{isStoreManager?'当前账户有权管理的门店':'进入工作室编辑资料并预览顾客展示'}</span></div>
      {loading?<p role="status" className="py-16 text-center text-sm text-slate-400">正在加载门店…</p>:!items.length?<div className="flex flex-col items-center py-16 text-center"><span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400"><Store className="h-6 w-6" /></span><p className="text-sm font-medium text-slate-600">{error?'门店未能加载':'没有匹配的门店'}</p><p className="mt-2 text-xs text-slate-400">{error?'请重新加载后再试。':'调整查询条件，或新增一家门店。'}</p></div>:<>
        <div className="store-directory-table overflow-x-auto"><table className="min-w-[1260px] text-left"><thead><tr><th>序号</th><th>短链</th><th>Logo</th><th>店名</th><th>联系与地址</th><th>独立登录账号 / 历史经营者</th><th>发布状态</th><th>管理</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map(item=><tr key={item.id} className="hover:bg-slate-50/70">
          <td className="whitespace-nowrap text-sm text-slate-500">{item.id}</td><td><StoreShortLink item={item} value={shortLinkDrafts[String(item.id)]??item.canonicalShortName??item.shortName??''} saving={savingShortLinkId===String(item.id)} saveBlocked={savingShortLinkId!==null||unverifiedShortLinks.includes(String(item.id))} unverified={unverifiedShortLinks.includes(String(item.id))} onChange={value=>setShortLinkDrafts(previous=>({...previous,[String(item.id)]:value}))} onSave={()=>void saveShortLink(item)}/></td><td><StoreLogo item={item}/></td><td className="max-w-56"><StoreName item={item}/>{item.subtitle&&<p className="mt-1 max-w-56 truncate text-xs text-slate-500">{item.subtitle}</p>}</td><td><div className="max-w-60 space-y-1 text-sm text-slate-600"><p className="line-clamp-2">{item.address||'地址待完善'}</p><p className="text-xs text-slate-400">{[item.city,item.state,item.zipCode].filter(Boolean).join(', ')||'地区待完善'}</p><p className="pt-1 text-xs text-slate-500">{item.phones?.[0]||'联系电话待完善'}</p>{item.emails?.[0]&&<p className="max-w-60 truncate text-xs text-slate-400">{item.emails[0]}</p>}</div></td>
          <td><p className="max-w-56 break-all text-sm text-slate-600">{storeAccountSummary(item).label}</p><p className="mt-1 text-xs text-slate-400">历史经营者 #{item.ownerId} · 账本归属不变</p></td><td><div className="space-y-2"><Status item={item}/><div><Readiness item={item} disabled={savingShortLinkId===String(item.id)||unverifiedShortLinks.includes(String(item.id))} onOpen={()=>openReadiness(item)}/></div></div></td><td>{actions(item)}</td>
        </tr>)}</tbody></table></div>
        <div className="store-directory-cards divide-y divide-slate-100">{items.map(item=><article key={item.id} className="space-y-4 p-5"><div className="flex items-start justify-between gap-3"><StoreIdentity item={item}/><Status item={item}/></div><div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm"><span className="text-slate-400">序号</span><span className="text-slate-600">{item.id}</span><span className="text-slate-400">短链</span><StoreShortLink item={item} value={shortLinkDrafts[String(item.id)]??item.canonicalShortName??item.shortName??''} saving={savingShortLinkId===String(item.id)} saveBlocked={savingShortLinkId!==null||unverifiedShortLinks.includes(String(item.id))} unverified={unverifiedShortLinks.includes(String(item.id))} onChange={value=>setShortLinkDrafts(previous=>({...previous,[String(item.id)]:value}))} onSave={()=>void saveShortLink(item)}/></div><div className="flex gap-2 text-xs leading-6 text-slate-500"><MapPin className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400"/><span>{[item.address,item.city,item.state].filter(Boolean).join(', ')||'地址待完善'}</span></div><p className="break-all text-xs text-slate-500">{storeAccountSummary(item).label}</p><div className="flex flex-wrap items-center justify-between gap-3"><Readiness item={item} disabled={savingShortLinkId===String(item.id)||unverifiedShortLinks.includes(String(item.id))} onOpen={()=>openReadiness(item)}/>{actions(item)}</div></article>)}</div>
      </>}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500"><span>{loading||error?'—':'共 '+total+' 家门店'} · 第 {page} / {Math.max(1,Math.ceil(total/pageSize))} 页</span><div className="flex items-center gap-2"><label className="flex items-center gap-2">每页<select aria-label="每页门店数" value={pageSize} onChange={event=>{setPageSize(locationPageSize(event.target.value,[25,50,100],25));setPage(1);}} className="store-control w-auto!">{[25,50,100].map(value=><option key={value} value={value}>{value} 条</option>)}</select></label><button type="button" aria-label="上一页门店" disabled={loading||page<=1} onClick={()=>setPage(value=>value-1)} className="store-icon-button"><ChevronLeft className="h-4 w-4"/></button><button type="button" aria-label="下一页门店" disabled={loading||page*pageSize>=total||page>=100000} onClick={()=>setPage(value=>value+1)} className="store-icon-button"><ChevronRight className="h-4 w-4"/></button></div></footer>
    </section>
    {editing!==undefined&&<StoreWorkspace onLifecycleChange={onLifecycleChange} key={editing?.id??'new-store'} initialSection={workspaceSection} initialBusinessTarget={workspaceBusinessTarget} item={editing} isStoreManager={isStoreManager} onClose={()=>setEditing(undefined)} onSaved={saved=>{setEditing(saved);setReload(value=>value+1);}} onNavigateStore={onNavigateStore} onManageAccountAccess={user?.role==='ADMIN'?onManageAccountAccess:undefined} onReadinessAction={onReadinessAction} onCopySettings={user?.role==='ADMIN'?item=>{setEditing(undefined);setCopySource({id:String(item.id)});}:undefined}/>}
    {copySource&&user?.role==='ADMIN'&&<StoreCopySettings key={String(user.id)} actorId={String(user.id)} initialSourceShopId={copySource.id} onClose={()=>setCopySource(null)} onApplied={()=>setReload(value=>value+1)}/>}
    {showIntake&&user?.role==='ADMIN'&&<StorePublicIntake key={String(user.id)} actorId={String(user.id)} templateShops={loading||error?[]:items} templateScope={`当前筛选第${page}页`} onClose={()=>{setShowIntake(false);updateIntakePending();}} onPendingChange={updateIntakePending} onImported={()=>setReload(value=>value+1)}/>}
  </div>;
}
