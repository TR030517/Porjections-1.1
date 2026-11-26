import { readServiceDurationKind, SERVICE_DURATION_LABELS } from '../utils/serviceDuration';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Check, CheckCheck, ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { getAccessOverview, type AccessShop } from '../api/accountAccess';
import { getCopyHistory, previewCopy, type CopyAddOnChange, type CopyAddOnReasonCode, type CopyHistory, type CopyInput, type CopyKind, type CopyPreview, type CopyResult } from '../api/storeCopy';
import { checkAdminCopy, finishAdminCopy, getAdminCopySnapshot, retryAdminCopy, startAdminCopy, subscribeAdminCopy } from '../stores/adminCopyStore';
import PriceMenuPreview from './store/PriceMenuPreview';
import CopyMenuLinks from './store/CopyMenuLinks';
import './store/storeStudio.css';

type ShopChoice = Pick<AccessShop, 'id' | 'name' | 'status'>;
const kindLabels: Record<CopyKind, string> = { HOURS: '营业时间', PRICE_MENU: '项目与价目（含预约关联）', CATALOG: '旧版目录复制记录', ADD_ONS: '附加项目（只加价，不加时）' };
const addOnReasonLabels: Record<CopyAddOnReasonCode, string> = { NEW: '可新建', MAIN_NOT_FOUND: '目标缺少主服务', AMBIGUOUS_MAIN: '主服务对应不唯一', DUPLICATE_SOURCE_NAME: '来源同名附加项目重复', TARGET_NAME_EXISTS: '目标已有同名附加项目', TARGET_LIMIT: '目标主服务已达配置上限' };
const statusLabels: Record<string, string> = { APPROVED: '已发布', PENDING: '待审核', REJECTED: '已拒绝', SUSPENDED: '已停用' };
const terminalStates = new Set(['APPLIED', 'REJECTED', 'NOT_APPLIED']);
const notifiedReceipts = new Set<string>();
const errorText = (error: unknown) => error instanceof Error && /[\u3400-\u9fff]/u.test(error.message) ? error.message : '请求未能完成，请保留原操作并稍后核对。';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const dateText = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间待核对';
const sameInput = (left: CopyInput, right: CopyInput) => left.sourceShopId === right.sourceShopId && left.targetShopId === right.targetShopId && left.kind === right.kind;

function hoursText(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '尚未设置营业时间';
  const hours = value as Record<string, unknown>;
  return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day, index) => {
    const name = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index], raw = hours[day];
    if (raw === undefined || raw === null) return `${name}：未设置`;
    const periods = (Array.isArray(raw) ? raw : [raw]).filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'));
    const open = periods.filter(row => row.closed !== true && typeof row.open === 'string' && typeof row.close === 'string');
    return name + '：' + (open.length ? open.map(row => `${row.open}–${row.close}`).join('、') : periods.some(row => row.closed === true) || Array.isArray(raw) && !raw.length ? '休息' : '格式待核对');
  }).join('\n');
}

function CatalogPreview({ services }: { services: NonNullable<CopyPreview['changes']['services']> }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(services.length / 20)), current = Math.min(page, pages - 1);
  const start = current * 20, shown = services.slice(start, start + 20);
  return <div className="space-y-3">
    <p className="text-sm leading-6 text-slate-500">仅新增独立、停用的服务与规格；同名冲突项跳过。技师、房间、排班、附加项目与预约历史均不复制，启用前须核对目标店资源。完成后请选择“附加项目（只加价，不加时）”，独立预览并确认其主服务对应关系。</p>
    <p role="status" className="text-xs text-slate-500">共 {services.length} 项；{services.length ? `当前显示第 ${start + 1}–${start + shown.length} 项` : '来源店没有服务项目'}。分页只控制预览，确认时按完整签名数据执行。</p>
    {shown.length > 0 && <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[480px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">服务项目</th><th className="px-4 py-3 font-medium">拟执行</th><th className="px-4 py-3 font-medium">说明</th></tr></thead><tbody>{shown.map(service => <tr key={service.sourceId} className="border-t border-slate-100"><td className="px-4 py-3 text-slate-700">{service.name}<span className="ml-2 rounded bg-teal-50 px-2 py-1 text-xs text-teal-700">{SERVICE_DURATION_LABELS[readServiceDurationKind(service.durationKind)]}</span><span className="mt-1 block text-xs text-slate-400">#{service.sourceId}</span></td><td className="whitespace-nowrap px-4 py-3 text-teal-700">{service.action === 'CREATE' ? '新增停用草稿' : '跳过并保留目标'}</td><td className="px-4 py-3 text-xs leading-5 text-slate-500">{service.reason || '按本次预览执行'}</td></tr>)}</tbody></table></div>}
    {pages > 1 && <nav aria-label="服务复制预览分页" className="flex flex-wrap items-center justify-end gap-3"><button type="button" className="store-secondary-button" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft className="h-4 w-4" />上一页</button><span className="text-xs text-slate-500">第 {current + 1} / {pages} 页</span><button type="button" className="store-secondary-button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>下一页<ChevronRight className="h-4 w-4" /></button></nav>}
  </div>;
}

function AddOnsPreview({ addOns }: { addOns: CopyAddOnChange[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(addOns.length / 20)), current = Math.min(page, pages - 1);
  const start = current * 20, shown = addOns.slice(start, start + 20);
  const creates = addOns.filter(item => item.action === 'CREATE').length;
  return <div className="space-y-3">
    <p className="rounded-xl border border-teal-100 bg-teal-50/40 p-4 text-sm leading-6 text-teal-800">只在明确匹配的目标主服务下新建停用的附加配置，来源已停用的项目也保持新建停用。同名而时长类型不同不匹配，请核对来源与目标类型。同名已有配置和无法明确匹配的主服务保留并跳过；请在目标店核对价格和主服务，再手动启用。</p>
    <p role="status" className="text-xs leading-6 text-slate-500">完整计划 {addOns.length} 项：拟新建 {creates} 项，跳过 {addOns.length - creates} 项；{shown.length ? `当前显示第 ${start + 1}–${start + shown.length} 项，每页最多 20 项。` : '来源店没有附加项目。'}分页只改变预览范围，确认会应用完整签名计划。</p>
    {shown.length > 0 && <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">来源主服务 → 目标主服务</th><th className="px-4 py-3 font-medium">附加项目与说明</th><th className="px-4 py-3 font-medium">价格（美元）</th><th className="px-4 py-3 font-medium">来源状态／排序</th><th className="px-4 py-3 font-medium">拟执行</th><th className="px-4 py-3 font-medium">原因</th></tr></thead><tbody>{shown.map(item => <tr key={item.sourceId} className="border-t border-slate-100 align-top">
      <td className="max-w-[260px] break-words px-4 py-3 text-xs leading-6 text-slate-600"><span className="block">{item.sourceServiceName} · #{item.sourceServiceId}<span className="ml-1 text-teal-700">{SERVICE_DURATION_LABELS[readServiceDurationKind(item.sourceDurationKind)]}</span></span><span aria-hidden="true">↓</span>{item.targetServiceId !== null && <span className="ml-1 text-teal-700">{SERVICE_DURATION_LABELS[readServiceDurationKind(item.targetDurationKind)]}</span>}<span className="block">{item.targetServiceId === null ? '未确定目标主服务，跳过此项' : `${item.targetServiceName} · #${item.targetServiceId}`}</span></td>
      <td className="max-w-[260px] break-words px-4 py-3 text-slate-700">{item.name}<span className="mt-1 block text-xs text-slate-400">来源附加项目 #{item.sourceId}</span>{item.description !== null && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-500">{item.description}</p>}</td>
      <td className="whitespace-nowrap px-4 py-3 text-slate-700">USD ${(item.priceCents / 100).toFixed(2)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-xs leading-6 text-slate-500">{item.sourceActive ? '来源已启用' : '来源已停用'}<span className="block">排序 {item.sortOrder}</span></td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-teal-700">{item.action === 'CREATE' ? '新建停用配置' : '跳过，保留目标'}</td>
      <td className="max-w-[260px] break-words px-4 py-3 text-xs leading-6 text-slate-500"><span className="block font-medium text-slate-700">{addOnReasonLabels[item.reasonCode]}</span>{item.reason}</td>
    </tr>)}</tbody></table></div>}
    {pages > 1 && <nav aria-label="附加项目复制预览分页" className="flex flex-wrap items-center justify-end gap-3"><button type="button" className="store-secondary-button" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft className="h-4 w-4" />上一页</button><span className="text-xs text-slate-500">第 {current + 1} / {pages} 页</span><button type="button" className="store-secondary-button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>下一页<ChevronRight className="h-4 w-4" /></button></nav>}
  </div>;
}

function ShopSelector({ label, value, search, choices, excluded, disabled, onSearch, onChange, id }: {
  label: string; value: string; search: string; choices: ShopChoice[]; excluded: string; disabled: boolean;
  onSearch: (value: string) => void; onChange: (value: string) => void; id: string;
}) {
  const term = search.trim().toLocaleLowerCase();
  const available = choices.filter(shop => shop.id !== excluded);
  const filtered = available.filter(shop => shop.id === value || !term || `${shop.name} ${shop.id}`.toLocaleLowerCase().includes(term));
  const unavailable = value && !available.some(shop => shop.id === value);
  return <div className="space-y-2"><label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input id={`${id}-search`} type="search" aria-label={`搜索${label}`} className="store-control" style={{ paddingLeft: 36 }} value={search} disabled={disabled} onChange={event => onSearch(event.target.value)} placeholder="按店名或门店编号查找" /></div><select id={id} aria-label={label} className="store-control" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">请明确选择{label}</option>{unavailable && <option value={value} disabled>原选择不可用，请重新选择</option>}{filtered.map(shop => <option key={shop.id} value={shop.id}>{shop.name} · #{shop.id} · {statusLabels[shop.status] || '状态待核对'}</option>)}</select><p className="text-xs leading-5 text-slate-400">{term ? `搜索显示 ${filtered.length} 家（保留当前选择），可选共 ${available.length} 家。` : `可选 ${available.length} 家，包含当前列表其他分页的门店。`}</p></div>;
}

export interface StoreCopySettingsProps {
  actorId: string;
  initialSourceShopId?: string;
  onClose: () => void;
  onApplied?: (result: CopyResult) => void;
}
export default function StoreCopySettings(props: StoreCopySettingsProps) {
  return <StoreCopySettingsDialog key={props.actorId} {...props} />;
}

function StoreCopySettingsDialog({ actorId, initialSourceShopId, onClose, onApplied }: StoreCopySettingsProps) {
  const id = useId(), snapshot = useSyncExternalStore(subscribeAdminCopy, getAdminCopySnapshot, getAdminCopySnapshot);
  const sessionReady = snapshot.actorId === actorId;
  const operation = sessionReady && snapshot.operation?.actorId === actorId ? snapshot.operation : null;
  const [source, setSource] = useState(initialSourceShopId ?? ''), [target, setTarget] = useState(''), [kind, setKind] = useState<CopyKind>('HOURS');
  const [sourceSearch, setSourceSearch] = useState(''), [targetSearch, setTargetSearch] = useState('');
  const [shops, setShops] = useState<ShopChoice[]>([]), [accessLoading, setAccessLoading] = useState(true), [accessError, setAccessError] = useState(''), [accessRevision, setAccessRevision] = useState(0);
  const [preview, setPreview] = useState<{ input: CopyInput; data: CopyPreview } | null>(null), [previewBusy, setPreviewBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [clock, setClock] = useState(Date.now());
  const [history, setHistory] = useState<CopyHistory | null>(null), [historyPage, setHistoryPage] = useState(1), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState(''), [historyRevision, setHistoryRevision] = useState(0);
  const live = useRef(false), previewVersion = useRef(0), previewController = useRef<AbortController | null>(null), previewLock = useRef(false), actionLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null), dialog = useRef<HTMLElement>(null), appliedCallback = useRef(onApplied); appliedCallback.current = onApplied;
  const current = () => live.current && getAdminCopySnapshot().actorId === actorId;
  const name = (shopId: string) => sessionReady && shops.find(shop => shop.id === shopId)?.name || '门店名称待核对';
  const input: CopyInput = { sourceShopId: source, targetShopId: target, kind };
  const valid = sessionReady && !accessLoading && !accessError && source !== target && validId(source) && validId(target) && shops.some(shop => shop.id === source) && shops.some(shop => shop.id === target);
  const originalBusy = operation?.state === 'IN_FLIGHT' || operation?.state === 'CHECKING';
  const originalUnresolved = Boolean(operation && !terminalStates.has(operation.state));
  const locked = Boolean(operation) || !sessionReady || accessLoading;
  const matchingPreview = preview && sameInput(preview.input, input) ? preview.data : null;
  const shownPreview = sessionReady ? operation?.preview ?? matchingPreview : null, shownInput = operation?.input ?? input;
  const expired = Boolean(matchingPreview && Date.parse(matchingPreview.expiresAt) <= clock);

  const invalidatePreview = () => {
    previewVersion.current++; previewController.current?.abort(); previewController.current = null; previewLock.current = false;
    setPreviewBusy(false); setPreview(null); setConfirmed(false); setError(''); setNotice('');
  };
  useEffect(() => {
    live.current = true; const previous = document.activeElement as HTMLElement | null; heading.current?.focus();
    return () => { live.current = false; previewVersion.current++; previewController.current?.abort(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!sessionReady) { invalidatePreview(); setShops([]); setAccessLoading(false); return; }
    const controller = new AbortController(); setAccessLoading(true); setAccessError('');
    getAccessOverview(controller.signal).then(data => {
      if (!current() || controller.signal.aborted) return;
      if (data.shops.some(shop => !validId(shop.id) || typeof shop.name !== 'string' || typeof shop.status !== 'string') || new Set(data.shops.map(shop => shop.id)).size !== data.shops.length) throw new Error('无法核对完整门店列表，请刷新权限后重试。');
      setShops(data.shops.map(({ id, name, status }) => ({ id, name, status })));
    }).catch(error => { if (current() && !controller.signal.aborted) setAccessError(errorText(error)); }).finally(() => { if (current() && !controller.signal.aborted) setAccessLoading(false); });
    return () => controller.abort();
  }, [actorId, sessionReady, accessRevision]);
  useEffect(() => {
    if (!sessionReady) { setHistory(null); return; }
    const controller = new AbortController(); setHistoryLoading(true); setHistoryError(''); setHistory(null);
    getCopyHistory(historyPage, 20, controller.signal).then(data => {
      if (!current() || controller.signal.aborted) return;
      const last = Math.max(1, Math.ceil(data.total / 20));
      if (historyPage > last) { setHistoryPage(last); return; }
      setHistory(data);
    }).catch(error => { if (current() && !controller.signal.aborted) setHistoryError(errorText(error)); }).finally(() => { if (current() && !controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [actorId, sessionReady, historyPage, historyRevision, operation?.result?.operationId]);
  useEffect(() => {
    if (!matchingPreview || operation) return;
    setClock(Date.now()); const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [matchingPreview, operation]);
  useEffect(() => {
    if (!current() || operation?.state !== 'APPLIED' || !operation.result || !appliedCallback.current) return;
    const key = `${actorId}:${operation.result.operationId}`;
    if (notifiedReceipts.has(key)) return;
    notifiedReceipts.add(key);
    if (notifiedReceipts.size > 200) notifiedReceipts.delete(notifiedReceipts.values().next().value!);
    try { appliedCallback.current(operation.result); } catch { setNotice('设置已保存，门店列表可手动刷新核对。'); }
  }, [actorId, operation?.state, operation?.result, onApplied]);

  const requestPreview = async () => {
    if (!current() || previewLock.current || actionLock.current || getAdminCopySnapshot().operation || !valid) return;
    invalidatePreview(); const version = previewVersion.current, captured = structuredClone(input), controller = new AbortController();
    previewController.current = controller; previewLock.current = true; setPreviewBusy(true);
    try {
      const data = await previewCopy(captured, controller.signal);
      if (current() && !controller.signal.aborted && previewVersion.current === version && !getAdminCopySnapshot().operation) { setPreview({ input: captured, data }); setClock(Date.now()); }
    } catch (error) { if (current() && !controller.signal.aborted && previewVersion.current === version) setError(errorText(error)); }
    finally { if (current() && previewVersion.current === version) { previewLock.current = false; setPreviewBusy(false); } }
  };
  const apply = async () => {
    if (!current() || actionLock.current || previewLock.current || getAdminCopySnapshot().operation || !valid || !confirmed || !matchingPreview) return;
    if (Date.parse(matchingPreview.expiresAt) <= Date.now()) { invalidatePreview(); setError('本次预览已过期，请重新生成并核对。'); return; }
    actionLock.current = true; setError(''); setNotice('');
    try { await startAdminCopy(structuredClone(input), matchingPreview); }
    catch (error) { if (current()) setError(errorText(error)); }
    finally { actionLock.current = false; }
  };
  const recover = async (retry: boolean) => {
    const original = getAdminCopySnapshot().operation;
    if (!current() || actionLock.current || original?.state !== 'UNKNOWN' || original.actorId !== actorId) return;
    actionLock.current = true; setError('');
    try { if (retry) await retryAdminCopy(); else await checkAdminCopy(); }
    catch (error) { if (current()) setError(errorText(error)); }
    finally { actionLock.current = false; }
  };
  const finish = () => {
    const original = getAdminCopySnapshot().operation;
    if (!current() || actionLock.current || !original || !terminalStates.has(original.state)) return;
    try {
      finishAdminCopy(); invalidatePreview(); setSource(original.input.sourceShopId); setTarget(''); setKind(original.input.kind === 'CATALOG' ? 'PRICE_MENU' : original.input.kind); setSourceSearch(''); setTargetSearch('');
    } catch (error) { if (current()) setError(errorText(error)); }
  };
  const leave = () => { previewVersion.current++; previewController.current?.abort(); if (live.current) onClose(); };
  const refreshAccess = () => { if (!current() || accessLoading) return; invalidatePreview(); setAccessRevision(value => value + 1); };
  const confirmationText = kind === 'CATALOG'
    ? `已核对来源与目标，确认仅向 ${name(target)}（#${target}）新增停用的服务与规格，同名冲突项跳过；启用前另行核对本店资源。`
    : kind === 'ADD_ONS' ? `已核对两店主服务对应与每项美元价格，确认仅向 ${name(target)}（#${target}）新建停用的附加配置；不修改主服务、已有加项或预约历史，跳过项按本次完整预览保留。`
    : kind === 'PRICE_MENU' ? `已核对目标 ${name(target)}（#${target}）与全部关联映射，确认替换其价目并连接目标服务；新配置停用，已有目录、启停与历史订单保留，不开启在线预约或账号。`
    : `已核对来源与目标，确认用来源店已保存的${kindLabels[kind]}替换 ${name(target)}（#${target}）的现有${kindLabels[kind]}。`;
  const missingSource = sessionReady && !operation && Boolean(source) && !accessLoading && !accessError && !shops.some(shop => shop.id === source);
  const historyPages = Math.max(1, Math.ceil((history?.total ?? 0) / 20));

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-2 sm:p-5">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={previewBusy || originalBusy} className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[href],[tabindex="0"]') ?? [])].filter(item => item.getClientRects().length > 0);
        if (!controls.length) { event.preventDefault(); return; }
        const focused = document.activeElement as HTMLElement;
        if (event.shiftKey && (focused === controls[0] || !controls.includes(focused))) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && (focused === controls.at(-1) || !controls.includes(focused))) { event.preventDefault(); controls[0].focus(); }
      }
    }}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7"><div><h2 ref={heading} tabIndex={-1} id={`${id}-title`} className="flex items-center gap-2 text-lg font-semibold text-slate-900"><CheckCheck className="h-5 w-5 text-teal-700" />复制门店设置</h2><p id={`${id}-description`} className="mt-1 text-sm leading-6 text-slate-500">公司管理员可选择全部门店；每次确认仅应用到一家目标店。只复制服务器已保存内容，工作室未保存草稿不参与。</p></div><button type="button" onClick={leave} className="store-icon-button shrink-0" aria-label="关闭复制设置"><X className="h-5 w-5" /></button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain bg-slate-50/60 px-5 py-5 sm:px-7">
        <p className="rounded-xl border border-teal-100 bg-teal-50/50 p-4 text-sm leading-6 text-teal-800">项目与价目统一复制，并自动映射目标预约项目；不必维护两套价目。新建资源全部停用，已有目标配置保留启停；有名称或规则冲突时先处理后再复制。营业时间可单独复制。地址、电话、账号、人员和订单各店保留，不会开启在线预约。</p>
        {!sessionReady && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">管理员身份已改变或尚未完成核对，本窗口不可提交。请关闭后在当前账号下重新打开。</p>}
        {snapshot.storageWarning && sessionReady && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">{snapshot.storageWarning}</p>}
        {(operation?.error || error) && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{operation?.error || error}</p>}
        {notice && <p role="status" className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-800">{notice}</p>}

        {operation && <section aria-label="原复制操作" className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-5"><h3 className="font-semibold text-slate-800">{operation.restored ? '已恢复原操作核对标识' : '原复制操作'}</h3><dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-slate-500">原来源门店</dt><dd className="mt-1 break-words text-slate-800">{name(operation.input.sourceShopId)}<span className="block text-xs text-slate-500">#{operation.input.sourceShopId}</span></dd></div><div><dt className="text-xs text-slate-500">原目标门店</dt><dd className="mt-1 break-words text-slate-800">{name(operation.input.targetShopId)}<span className="block text-xs text-slate-500">#{operation.input.targetShopId}</span></dd></div><div><dt className="text-xs text-slate-500">复制内容</dt><dd className="mt-1 text-slate-800">{kindLabels[operation.input.kind]}</dd></div></dl>
          {originalBusy && <p role="status" className="text-sm leading-6 text-amber-900">{operation.state === 'CHECKING' ? '正在只读查询原操作结果。' : '正在等待原复制结果。'}关闭窗口不会取消原请求，稍后可从平台复制入口继续核对。</p>}
          {operation.state === 'UNKNOWN' && <><p className="text-sm leading-6 text-amber-900">原结果尚未确认，不能开始新复制。查询只读取原结果；明确重试时使用原来源、目标、签名与请求键，不会创建另一笔复制。后续权限错误不能证明原请求失败。</p>{operation.restored && <p className="text-xs leading-5 text-slate-500">刷新恢复不保存价目、服务和附加项目的预览明细，也不会自动查询、复制或重试。</p>}<div className="flex flex-wrap gap-3"><button type="button" disabled={!sessionReady} className="store-secondary-button" onClick={() => void recover(false)}><RefreshCw className="h-4 w-4" />查询原操作结果</button><button type="button" disabled={!sessionReady} className="store-secondary-button" onClick={() => void recover(true)}>按完全相同的原请求重试</button></div></>}
          {operation.state === 'APPLIED' && operation.result && <p role="status" className="rounded-xl border border-teal-100 bg-white p-4 text-sm leading-6 text-teal-800">服务器已确认复制成功。{operation.result.kind === 'HOURS' ? '目标店营业时间已替换，时区保持目标店原值。' : operation.result.kind === 'PRICE_MENU' ? `目标店项目与价目已统一复制，共 ${operation.result.groups ?? 0} 组、${operation.result.created} 项。` : operation.result.kind === 'ADD_ONS' ? `已新建 ${operation.result.created} 项停用附加配置，跳过 ${operation.result.skipped} 项。请在目标店核对主服务与价格后，再明确启用。` : `已新增 ${operation.result.created} 项停用服务，跳过 ${operation.result.skipped} 项同名冲突。请核对资源后再启用。附加项目未包含在本目录复制中；结束此记录后，可选择“附加项目”独立生成预览。`}<span className="mt-2 block text-xs text-slate-500">操作编号：{operation.result.operationId}</span></p>}
          {operation.state === 'REJECTED' && <p role="status" className="text-sm leading-6 text-amber-900">服务器已拒绝首次请求，此前没有结果未知的提交。关闭此操作记录后，可修正选择并重新预览。</p>}
          {operation.state === 'NOT_APPLIED' && <p role="status" className="text-sm leading-6 text-slate-600">服务器已确认原请求未执行，签名预览已过期。结束此记录后，才能生成新的预览。</p>}
          {terminalStates.has(operation.state) && <button type="button" disabled={!sessionReady} className="store-secondary-button" onClick={finish}>结束此记录，准备下一次复制</button>}
        </section>}

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5" aria-label="复制来源与目标"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-slate-800">{operation ? '当前操作已固定门店与内容' : '选择来源与目标'}</h3><button type="button" disabled={!sessionReady || accessLoading} className="store-secondary-button" onClick={refreshAccess}><RefreshCw className={`h-4 w-4${accessLoading ? ' animate-spin' : ''}`} />{accessLoading ? '正在加载全部门店…' : '刷新门店与权限'}</button></div>
          {accessError && <p role="alert" className="text-sm leading-6 text-red-700">{accessError} 当前选择保留，但无法生成新预览或提交；请重试刷新。已有原操作仍可单独查询核对。</p>}
          {missingSource && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-800">指定来源门店无效、已删除或当前账号不可访问。系统没有替换成其他门店，请明确重新选择来源。</p>}
          <label htmlFor={`${id}-kind`} className="block space-y-2 text-sm font-medium text-slate-700"><span>要复制的设置</span><select id={`${id}-kind`} className="store-control" value={operation?.input.kind ?? kind} disabled={locked} onChange={event => { invalidatePreview(); setKind(event.target.value as CopyKind); }}><option value="HOURS">营业时间</option><option value="PRICE_MENU">项目与价目（含预约关联）</option>{operation?.input.kind === 'CATALOG' && <option value="CATALOG">旧版目录复制记录</option>}<option value="ADD_ONS">附加项目（只加价，不加时）</option></select></label>
          <div className="grid gap-5 md:grid-cols-2"><ShopSelector id={`${id}-source`} label="来源门店" value={operation?.input.sourceShopId ?? source} search={sourceSearch} choices={sessionReady ? shops : []} excluded={operation?.input.targetShopId ?? target} disabled={locked} onSearch={setSourceSearch} onChange={value => { invalidatePreview(); setSource(value); if (value === target) setTarget(''); }} /><ShopSelector id={`${id}-target`} label="目标门店" value={operation?.input.targetShopId ?? target} search={targetSearch} choices={sessionReady ? shops : []} excluded={operation?.input.sourceShopId ?? source} disabled={locked} onSearch={setTargetSearch} onChange={value => { invalidatePreview(); setTarget(value); }} /></div>
          {!operation && <button type="button" className="store-secondary-button" disabled={!valid || previewBusy} onClick={() => void requestPreview()}><RefreshCw className={`h-4 w-4${previewBusy ? ' animate-spin' : ''}`} />{previewBusy ? '正在生成签名预览…' : matchingPreview ? '重新生成预览' : '生成预览'}</button>}
        </section>

        {shownPreview && <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5" aria-label="核对实际变化"><div><h3 className="font-semibold text-slate-800">核对实际变化</h3><p className="mt-2 text-sm leading-6 text-slate-600">{shownPreview.summary}</p><p className="mt-2 text-xs leading-5 text-slate-500">{name(shownInput.sourceShopId)} · #{shownInput.sourceShopId} → {name(shownInput.targetShopId)} · #{shownInput.targetShopId}；{kindLabels[shownInput.kind]}。预览有效期至 {dateText(shownPreview.expiresAt)}。</p></div>
          {shownPreview.changes.hours && <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h4 className="text-sm font-medium text-slate-700">目标当前营业时间</h4><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-600">{hoursText(shownPreview.changes.hours.from)}</pre></div><div className="rounded-xl border border-teal-100 bg-teal-50/30 p-4"><h4 className="text-sm font-medium text-teal-800">目标拟用营业时间</h4><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-600">{hoursText(shownPreview.changes.hours.to)}</pre></div><p className="text-xs leading-5 text-slate-500 sm:col-span-2">按目标店本地时间解释营业时段；时区、地址与电话保持目标店原值。</p></div>}
          {shownPreview.changes.priceMenu && <><div className="grid min-w-0 gap-5 lg:grid-cols-2"><div className="min-w-0 rounded-xl border border-slate-200 p-4"><h4 className="mb-3 text-sm font-semibold text-slate-700">目标当前项目与价目</h4><PriceMenuPreview key={`${shownPreview.previewHash}:from`} value={shownPreview.changes.priceMenu.from} language="zh" showImages={false} /></div><div className="min-w-0 rounded-xl border border-teal-100 p-4"><h4 className="mb-3 text-sm font-semibold text-teal-800">拟复制的项目与价目</h4><PriceMenuPreview key={`${shownPreview.previewHash}:to`} value={shownPreview.changes.priceMenu.to} language="zh" showImages={false} /></div></div><p className="text-xs leading-5 text-slate-500">分批展开只改变显示范围；确认仍应用完整价目与关联计划。目标原目录和历史订单保留；新建资源停用，复用资源保留目标状态。</p>{shownPreview.changes.priceMenu.catalogLinks && <CopyMenuLinks key={shownPreview.previewHash} links={shownPreview.changes.priceMenu.catalogLinks} />}{shownPreview.changes.priceMenu.omittedManagedImages > 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">将省略 {shownPreview.changes.priceMenu.omittedManagedImages} 张来源店专属受管图片；价目文字保留，如需图片请在目标店另行上传。</p>}</>}
          {shownPreview.changes.services && <CatalogPreview key={shownPreview.previewHash} services={shownPreview.changes.services} />}
          {shownPreview.changes.addOns && <AddOnsPreview key={shownPreview.previewHash} addOns={shownPreview.changes.addOns} />}
          {!operation && <><label className="flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50/40 p-4 text-sm leading-6 text-slate-700"><input type="checkbox" checked={confirmed} disabled={!valid || previewBusy || expired} className="mt-1 h-4 w-4 shrink-0 accent-teal-700" onChange={event => setConfirmed(event.target.checked)} /><span>{confirmationText}</span></label>{expired && <p role="alert" className="text-sm text-amber-800">预览已过期，请重新生成并核对后确认。</p>}<button type="button" className="store-primary-button" disabled={!valid || !confirmed || previewBusy || expired} onClick={() => void apply()}><Check className="h-4 w-4" />确认应用到 {name(target)}</button></>}
        </section>}

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5" aria-label="本人近期成功复制"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-slate-800">本人近期成功复制</h3><button type="button" className="store-secondary-button" disabled={!sessionReady || historyLoading} onClick={() => setHistoryRevision(value => value + 1)}><RefreshCw className={`h-4 w-4${historyLoading ? ' animate-spin' : ''}`} />刷新历史</button></div><p className="text-xs leading-5 text-slate-500">仅显示当前账号仍有权限访问的门店之间的成功操作。未查到记录不能据此判断结果未知的原请求失败。</p>
          {historyError && <p role="alert" className="text-sm text-red-700">{historyError}</p>}{historyLoading && <p role="status" className="text-sm text-slate-500">正在加载复制记录…</p>}
          {sessionReady && history && <><p role="status" className="text-xs text-slate-500">共 {history.total} 条；每页 20 条。</p>{history.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-3 font-medium">时间</th><th className="px-3 py-3 font-medium">来源 → 目标</th><th className="px-3 py-3 font-medium">配置</th><th className="px-3 py-3 font-medium">结果</th></tr></thead><tbody>{history.items.map(item => <tr key={item.operationId} className="border-t border-slate-100"><td className="px-3 py-3 text-xs text-slate-500">{dateText(item.createdAt)}</td><td className="px-3 py-3 text-xs leading-6 text-slate-600">{item.sourceShopName} · #{item.sourceShopId}<br />→ {item.targetShopName} · #{item.targetShopId}</td><td className="px-3 py-3 text-xs text-slate-600">{kindLabels[item.kind]}</td><td className="px-3 py-3 text-xs text-slate-500">{item.kind === 'HOURS' ? '已替换营业时间' : item.kind === 'PRICE_MENU' ? `已替换 ${item.created} 项价目` : item.kind === 'ADD_ONS' ? `新建 ${item.created} 项停用附加配置，跳过 ${item.skipped} 项` : `新增 ${item.created} 项停用服务，跳过 ${item.skipped} 项`}</td></tr>)}</tbody></table></div> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂无本人成功复制记录。</p>}<nav aria-label="复制历史分页" className="flex flex-wrap items-center justify-end gap-3"><button type="button" className="store-secondary-button" disabled={historyLoading || historyPage <= 1} onClick={() => setHistoryPage(value => value - 1)}><ChevronLeft className="h-4 w-4" />上一页</button><span className="text-xs text-slate-500">第 {historyPage} / {historyPages} 页</span><button type="button" className="store-secondary-button" disabled={historyLoading || historyPage >= historyPages} onClick={() => setHistoryPage(value => value + 1)}>下一页<ChevronRight className="h-4 w-4" /></button></nav></>}
        </section>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-7"><p role="status" className="max-w-3xl text-xs leading-5 text-slate-500">{originalUnresolved ? '关闭只收起窗口，原操作与核对标识保留。可从平台复制入口恢复；结果确认前不会开始新复制。' : operation ? '已核对的结果会保留至您明确结束此记录。' : previewBusy ? '正在读取服务器已保存设置，尚未写入。' : '先预览并明确确认，才会写入所选的一家目标门店。'}</p><button type="button" className="store-secondary-button" onClick={leave}>{originalUnresolved ? '关闭并保留核对标识' : '关闭'}</button></footer>
    </section>
  </div>;
}
