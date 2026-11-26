import { useCallback, useEffect, useRef, useState } from 'react';
import StoreProjectInventory from './StoreProjectInventory';
import StoreProjectMetadata from './StoreProjectMetadata';
import ReservationSettings from '../ReservationSettings';
import StoreProjectAddOns from './StoreProjectAddOns';
import StoreCatalogCreate from './StoreCatalogCreate';
import { createCatalogObject, readCatalogOperation } from '../../api/reservations';
import { getProjectCatalog } from '../../api/projectCatalog';
import { customerSiteOrigin } from '../../utils/customerSiteUrl';
import { readProjectCatalogPage, type ProjectCatalogItem, type ProjectCatalogQuery, type ProjectMenuAvailability } from '../../utils/projectCatalog';
import type { PriceMenuGroup } from '../../utils/priceMenu';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycle, type BusinessLifecycleListener } from './businessScope';
import { combinedProjectState, projectSiblingsBlocked } from '../../utils/projectRuleEdits';

export function syncUnifiedProjectSelection(serviceId: string, selectLocal: (id: string) => void, selectWorkspace: (id: string) => void) {
  selectLocal(serviceId);
  selectWorkspace(serviceId);
}

export default function StoreUnifiedProjects({ shopId, publicPath, onlineBookingEnabled, bookingLinkPending = false, menu, priceMenuRevision, menuAvailability, revision, selectedServiceId, variantFocus, initialPane = 'metadata', disabled, beforeWrite, onSelectService, onLocateMenu, onLifecycleChange, onChanged }: {
  publicPath?: string | null; onlineBookingEnabled: boolean; bookingLinkPending?: boolean;
  shopId: string; menu: PriceMenuGroup[]; priceMenuRevision: string; menuAvailability: ProjectMenuAvailability; revision: number; selectedServiceId?: string; variantFocus?: { serviceId: string; variantId: string; revision: number }; initialPane?: 'metadata' | 'booking'; disabled: boolean; beforeWrite: () => boolean;
  onSelectService: (serviceId: string) => void; onLocateMenu: (group: number, item: number) => void; onLifecycleChange: BusinessLifecycleListener; onChanged: () => Promise<void>;
}) {
  const scope = useBusinessScope(shopId), alive = useRef(true);
  const eventCurrent = scope.captureEvent();
  const handledVariantFocus = useRef('');
  const variantFocusKey = JSON.stringify([scope.actorId, shopId, variantFocus]);
  const [selected, setSelected] = useState(selectedServiceId);
  const [reload, setReload] = useState(0), [error, setError] = useState(''), [refreshing, setRefreshing] = useState(false), [uncertain, setUncertain] = useState(false);
  const [children, setChildren] = useState<Record<'metadata' | 'booking' | 'addons' | 'catalog', BusinessLifecycle>>({ metadata: EMPTY_BUSINESS_LIFECYCLE, booking: EMPTY_BUSINESS_LIFECYCLE, addons: EMPTY_BUSINESS_LIFECYCLE, catalog: EMPTY_BUSINESS_LIFECYCLE });
  const childrenRef = useRef(children); childrenRef.current = children;
  const metadataLifecycle = useCallback((next: BusinessLifecycle) => { childrenRef.current = { ...childrenRef.current, metadata: next }; setChildren(childrenRef.current); }, []);
  const bookingLifecycle = useCallback((next: BusinessLifecycle) => { childrenRef.current = { ...childrenRef.current, booking: next }; setChildren(childrenRef.current); }, []);
  const addonsLifecycle = useCallback((next: BusinessLifecycle) => { childrenRef.current = { ...childrenRef.current, addons: next }; setChildren(childrenRef.current); }, []);
  const catalogLifecycle = useCallback((next: BusinessLifecycle) => { childrenRef.current = { ...childrenRef.current, catalog: next }; setChildren(childrenRef.current); }, []);
  const child = combinedProjectState(Object.values(children));
  const [linkVariantId, setLinkVariantId] = useState(''), [linkMessage, setLinkMessage] = useState('');
  useEffect(() => { setLinkVariantId(''); setLinkMessage(''); }, [selected]);
  useEffect(() => { setLinkMessage(''); }, [bookingLinkPending, publicPath, onlineBookingEnabled]);
  const childRef = useRef(child); childRef.current = child;
  const navigationRef = useRef({ disabled, refreshing, uncertain }); navigationRef.current = { disabled, refreshing, uncertain };
  const [result, setResult] = useState<{ key: string; project?: ProjectCatalogItem; error?: string }>();
  const key = JSON.stringify([shopId, scope.actorId, selected, revision, reload]);
  const live = useRef(key); live.current = key;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (selectedServiceId && !childRef.current.dirty && !childRef.current.busy && !childRef.current.unknown) setSelected(selectedServiceId); }, [selectedServiceId]);
  useEffect(() => { onLifecycleChange({ dirty: child.dirty, busy: child.busy || refreshing, unknown: child.unknown || uncertain }); }, [child.dirty, child.busy, child.unknown, refreshing, uncertain, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  const load = useCallback(async (query: ProjectCatalogQuery, signal: AbortSignal) => {
    const current = scope.capture(); if (!current()) throw Error('当前门店或登录状态已变化。');
    const value = await getProjectCatalog(shopId, query, signal);
    if (!current()) throw Error('当前门店或登录状态已变化。'); return value;
  }, [shopId, scope.capture]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController(), current = scope.capture(); let active = true;
    const query: ProjectCatalogQuery = { serviceId: selected, search: '', status: 'all', page: 1, pageSize: 1 };
    void load(query, controller.signal).then(raw => {
      const page = readProjectCatalogPage(raw, shopId, query);
      if (!page.items[0]) throw Error('指定项目未找到，未替换为其他项目。');
      if (active && current() && live.current === key) setResult({ key, project: page.items[0] });
    }).catch(e => { if (active && current() && !controller.signal.aborted && live.current === key) setResult({ key, error: e instanceof Error ? e.message : '项目读取失败。' }); });
    return () => { active = false; controller.abort(); };
  }, [key, load, shopId, selected, scope.capture]);
  const navigate = (operation: () => void) => {
    if (!alive.current || !eventCurrent()) return;
    const latestChild = combinedProjectState(Object.values(childrenRef.current)), latest = navigationRef.current;
    if (latest.disabled || latestChild.dirty || latestChild.busy || latestChild.unknown || latest.refreshing || latest.uncertain) { setError('请先保存、取消或核对当前项目编辑，再切换项目或分区。'); return; }
    setError(''); operation();
  };
  const changed = useCallback(async () => {
    if (!alive.current || !eventCurrent()) throw Error('当前门店或登录状态已变化。');
    const current = scope.capture(); setRefreshing(true); setError('');
    try {
      await onChanged();
      if (!alive.current || !current()) throw Error('当前门店或登录状态已变化。');
      setUncertain(false); setReload(v => v + 1);
    }
    catch (e) { if (alive.current && current()) { setUncertain(true); setError('配置可能已经保存，但最新资料未能核对。请只读重新载入后再编辑。' + (e instanceof Error ? e.message : '')); } throw e; }
    finally { if (alive.current && current()) setRefreshing(false); }
  }, [onChanged, scope.capture, scope.actorId, shopId]);
  const write = (own: 'metadata' | 'booking' | 'addons' | 'catalog') => {
    if (projectSiblingsBlocked(childrenRef.current, own)) { setError('请先保存、取消或核对同一服务中另一处编辑；当前草稿保留。'); return false; }
    return !disabled && !uncertain && !refreshing && scope.capture()() && beforeWrite();
  };
  const project = result?.key === key ? result.project : undefined;
  const copyBookingLink = async () => {
    if (bookingLinkPending) { setLinkMessage('预约相关门店资料尚未保存，请先保存门店资料，再复制预约链接。'); return; }
    if (disabled || child.dirty || child.busy || child.unknown || refreshing || uncertain || !scope.capture()()) return;
    if (!project || !publicPath || !/^\/s\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(publicPath) || !project.isActive) return;
    if (!onlineBookingEnabled) { setLinkMessage('本店尚未开启线上预约，当前链接无法下单。'); return; }
    const kinds = ['TIMED', 'PER_SESSION', 'VARIABLE'];
    if (!kinds.includes(String(project.durationKind)) || ![1, 2].includes(project.participantCount ?? 0)
      || ![1, 2].includes(project.requiredStaffCount ?? 0) || (project.requiredStaffCount ?? 0) < (project.participantCount ?? 0)) {
      setLinkMessage('此项目预约规则尚未完整配置，暂不能生成直达链接。'); return;
    }
    const eligible = project.variants.filter(variant => variant.isActive && variant.currency === 'usd'
      && ['PER_PERSON', 'PER_BOOKING'].includes(String(variant.priceBasis)) && Number.isInteger(variant.durationMin)
      && variant.durationMin! >= 5 && variant.durationMin! <= 240 && Number.isInteger(variant.priceCents) && variant.priceCents! > 0 && variant.priceCents! <= 99999999);
    if (project.hasVariants && !eligible.length) { setLinkMessage('此服务没有启用且符合预约条件的规格。'); return; }
    if (project.hasVariants && !linkVariantId) { setLinkMessage('请选择规格后复制链接。'); return; }
    if (project.hasVariants && !eligible.some(variant => variant.id === linkVariantId)) { setLinkMessage('所选规格已不可预约，请刷新后重新选择。'); return; }
    if (!project.hasVariants && (linkVariantId || !Number.isInteger(project.durationMin) || project.durationMin! < 5 || project.durationMin! > 240
      || !Number.isInteger(project.priceCents) || project.priceCents! <= 0 || project.priceCents! > 99999999 || !['PER_PERSON', 'PER_BOOKING'].includes(String(project.priceBasis)))) {
      setLinkMessage('此项目预约时长或价格尚未完整配置，暂不能生成直达链接。'); return;
    }
    try {
      const url = new URL(publicPath, customerSiteOrigin(window.location.origin)); url.searchParams.set('serviceId', project.id);
      if (project.hasVariants) url.searchParams.set('variantId', linkVariantId);
      await navigator.clipboard.writeText(url.toString()); setLinkMessage('顾客预约直达链接已复制。');
    } catch { setLinkMessage('复制失败，请检查浏览器剪贴板权限。'); }
  };
  return <div className="space-y-5"><StoreCatalogCreate key={String(scope.actorId) + ":" + shopId} shopId={shopId} scopeKey={String(scope.actorId) + ':' + shopId} menu={menu} priceMenuRevision={priceMenuRevision} project={project} disabled={disabled || refreshing || uncertain || menuAvailability.status !== 'known' || projectSiblingsBlocked(children, 'catalog')} beforeWrite={() => write('catalog')} isCurrent={() => scope.capture()()} submit={createCatalogObject} readReceipt={readCatalogOperation} onLifecycleChange={catalogLifecycle} onSaved={async receipt => { await changed(); syncUnifiedProjectSelection(receipt.serviceId, setSelected, onSelectService); }} /><StoreProjectInventory shopId={shopId} scopeKey={String(scope.actorId)} load={load} menu={menu} menuAvailability={refreshing ? { status: 'unavailable', reason: 'loading' } : uncertain ? { status: 'unavailable', reason: 'error' } : menuAvailability} revision={revision + ':' + reload} disabled={disabled || child.dirty || child.busy || child.unknown || refreshing || uncertain} selectedServiceId={selected} onSelect={id => navigate(() => syncUnifiedProjectSelection(id, setSelected, onSelectService))} onLocateMenu={(g, i) => navigate(() => onLocateMenu(g, i))} />
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {uncertain && <button type="button" className="store-secondary-button" disabled={refreshing} onClick={() => void changed().catch(() => {})}>只读重新载入并核对</button>}
    {selected && !project && <p role={result?.key === key && result.error ? 'alert' : 'status'}>{result?.key === key ? result.error : '正在读取指定项目…'}</p>}
    {project && <section aria-label="所选服务与价格" className="space-y-5 rounded-xl border border-teal-100 bg-white p-5"><header><h3 className="text-base font-semibold text-slate-800">{project.name}</h3><p className="mt-2 text-xs leading-6 text-slate-500">共同资料、规格与预约规则属于同一服务。下方按对象保存，每次保存后同步服务目录和已关联展示行；历史订单保留原快照。</p></header>
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3"><div className="min-w-56 flex-1"><label className="mb-1 block text-xs text-slate-500">顾客预约直达链接</label>{project.hasVariants ? <select aria-label="预约直达链接服务规格" className="store-control" value={linkVariantId} onChange={event => { setLinkVariantId(event.target.value); setLinkMessage(''); }}><option value="">选择有效规格</option>{project.variants.filter(variant => variant.isActive && variant.currency === 'usd' && ['PER_PERSON', 'PER_BOOKING'].includes(String(variant.priceBasis)) && Number.isInteger(variant.durationMin) && variant.durationMin! >= 5 && variant.durationMin! <= 240 && Number.isInteger(variant.priceCents) && variant.priceCents! > 0 && variant.priceCents! <= 99999999).map(variant => <option key={variant.id} value={variant.id}>{variant.name} · {variant.durationMin} 分钟 · ${((variant.priceCents ?? 0) / 100).toFixed(2)}</option>)}</select> : <p className="m-0 pt-2 text-xs text-slate-500">链接将直接预选此服务。</p>}</div><button type="button" disabled={bookingLinkPending || !publicPath || !onlineBookingEnabled || !project.isActive || disabled || child.dirty || child.busy || child.unknown || refreshing || uncertain} onClick={() => void copyBookingLink()} className="store-secondary-button">复制预约链接</button>{bookingLinkPending && <p role="status" className="m-0 basis-full text-xs text-amber-700">发布状态、预约开关、时区、营业时间或价目预约关联有未保存修改。请先点击底部“保存门店资料”，再复制使用已保存配置的预约链接；当前草稿保留。</p>}{!onlineBookingEnabled && <p className="m-0 basis-full text-xs text-amber-700">本店已保存的线上预约开关尚未开启。</p>}{linkMessage && <p role="status" className="m-0 basis-full text-xs text-slate-600">{linkMessage}</p>}</div>
      <StoreProjectMetadata key={project.id + ':metadata'} project={project} disabled={disabled || refreshing || uncertain || projectSiblingsBlocked(children, 'metadata')} beforeWrite={() => write('metadata')} onLifecycleChange={metadataLifecycle} onSaved={changed} />
      <ReservationSettings key={project.id + ':booking'} explicitShopId={shopId} embedded serviceOnly initialTab="services" initialServiceId={project.id} initialVariantId={variantFocus?.serviceId === project.id ? variantFocus.variantId : undefined} variantFocusRevision={variantFocus?.serviceId === project.id ? variantFocus.revision : undefined} variantFocusPending={handledVariantFocus.current !== variantFocusKey} onVariantFocused={() => { handledVariantFocus.current = variantFocusKey; }} initialRulesOpen={initialPane === 'booking'} revision={revision + reload} disabled={disabled || refreshing || uncertain || projectSiblingsBlocked(children, 'booking')} beforeWrite={() => write('booking')} onBack={() => {}} onManageQualifications={() => {}} onLifecycleChange={bookingLifecycle} onChanged={changed} />
      <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">附加项目（可选）· {project.addOnCount} 个</summary><div className="mt-4"><StoreProjectAddOns key={project.id + ':addons'} shopId={shopId} serviceId={project.id} items={project.addOns} disabled={disabled || refreshing || uncertain || projectSiblingsBlocked(children, 'addons')} beforeWrite={() => write('addons')} onLifecycleChange={addonsLifecycle} onSaved={() => void changed().catch(() => {})} /></div></details>
    </section>}
  </div>;
}
