import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Plus, RefreshCw, Search, X } from 'lucide-react';
import { createResource, deleteResource, listResourcePage, updateResource, type ResourceId } from '../api/resources';
import { abandonBannerMedia, confirmBannerMedia, uploadBannerMedia } from '../api/bannerMedia';
import { ApiError } from '../api/session';
import { operations } from '../config/operations';
import { BannerDraftSession } from '../utils/bannerDraft';
import { buildOperationPayload, localPublicationInput } from '../utils/operationForm';
import { useConfirmation } from './Confirmation';
import ResourcePicker from './ResourcePicker';
import StoreMediaEditor, { validateStoreMediaUrl } from './store/StoreMediaEditor';

type TargetType = 'NONE' | 'SHOP_DETAIL' | 'CATEGORY' | 'COUPON_CENTER' | 'EXTERNAL_URL';
interface BannerItem {
  id: ResourceId; title: string; imageUrl: string; targetType: TargetType; targetValue: string | null;
  sortOrder: number; isActive: boolean; startAt: string; endAt: string | null; publicationState?: string;
}
interface BannerForm {
  title: string; imageUrl: string; targetType: TargetType; targetValue: string;
  sortOrder: string; isActive: boolean; startAt: string; endAt: string;
}
const targets: Record<TargetType, string> = { NONE: '仅展示', SHOP_DETAIL: '门店详情', CATEGORY: '服务类型', COUPON_CENTER: '优惠券中心', EXTERNAL_URL: '外部页面' };
const categories = operations.services.fields!.find(field => field.key === 'category')!.options!;
const states: Record<string, string> = { DRAFT: '草稿 / 停用', SCHEDULED: '待发布', LIVE: '展示中', EXPIRED: '已过期' };
const control = 'store-control';
const secondary = 'store-secondary-button';
const primary = 'store-primary-button';
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未设置';

function initialForm(item: BannerItem | null): BannerForm {
  return { title: item?.title ?? '', imageUrl: item?.imageUrl ?? '', targetType: item?.targetType ?? 'NONE', targetValue: item?.targetValue ?? '',
    sortOrder: String(item?.sortOrder ?? 0), isActive: item?.isActive ?? false, startAt: localPublicationInput(item?.startAt), endAt: localPublicationInput(item?.endAt) };
}
function checkedSave(item: BannerItem, expected: Record<string, unknown>, original: BannerItem | null) {
  const image = (value: unknown) => { if (typeof value !== 'string') return ''; try { return new URL(value).href; } catch { return value; } };
  if (!item || !/^[1-9]\d{0,18}$/.test(String(item.id)) || original && String(item.id) !== String(original.id)
    || item.title !== expected.title || image(item.imageUrl) !== image(expected.imageUrl)
    || item.targetType !== expected.targetType || (item.targetValue ?? '') !== (expected.targetValue ?? '')
    || item.sortOrder !== expected.sortOrder || item.isActive !== expected.isActive
    || !Number.isFinite(Date.parse(item.startAt)) || expected.startAt && Date.parse(item.startAt) !== Date.parse(String(expected.startAt))
    || (expected.endAt == null ? Boolean(item?.endAt) : Date.parse(item.endAt ?? '') !== Date.parse(String(expected.endAt)))) {
    throw new Error('保存结果无法确认，请保留草稿并核对轮播列表，暂勿重复新增。');
  }
  return item;
}

function Thumbnail({ value, title }: { value: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="flex aspect-[16/6] w-36 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
    {!failed && value && !validateStoreMediaUrl(value) ? <img src={value} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" /> : <ImageIcon aria-label="轮播图片待完善" className="h-6 w-6 text-slate-400" />}
  </div>;
}

function BannerEditor({ item, onClose, onSaved }: { item: BannerItem | null; onClose: (message?: string) => void; onSaved: (item: BannerItem, cleanupFailures: number) => void }) {
  const confirm = useConfirmation();
  const [form, setForm] = useState(() => initialForm(item));
  const baseline = useRef(JSON.stringify(initialForm(item)));
  const [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false), [closing, setClosing] = useState(false);
  const [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const live = useRef(false), session = useRef<BannerDraftSession | null>(null);
  const lock = useRef({ saving: false, uploading: false, closing: false });
  const closeButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ form, uncertain }); latest.current = { form, uncertain };
  const dirty = JSON.stringify(form) !== baseline.current;
  const blocked = saving || uploading || closing || uncertain;

  useEffect(() => {
    live.current = true;
    const draftSession = new BannerDraftSession({ upload: uploadBannerMedia, confirm: confirmBannerMedia, abandon: abandonBannerMedia });
    session.current = draftSession;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const leaving = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current.form) !== baseline.current || lock.current.uploading || lock.current.saving) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leaving);
    return () => { live.current = false; session.current = null; void draftSession.dispose(); window.removeEventListener('beforeunload', leaving); previous?.focus(); };
  }, []);

  const change = <K extends keyof BannerForm>(key: K, value: BannerForm[K]) => {
    if (lock.current.saving || lock.current.uploading || lock.current.closing || latest.current.uncertain) return;
    setForm(previous => ({ ...previous, [key]: value, ...(key === 'targetType' ? { targetValue: '' } : {}) }));
    setError('');
  };
  const upload = async (file: File) => {
    const ownSession = session.current;
    if (!ownSession || lock.current.saving || lock.current.uploading || lock.current.closing || latest.current.uncertain) throw new Error('请等待当前操作结束。');
    lock.current.uploading = true; setUploading(true); setError('');
    try {
      const url = await ownSession.upload(file);
      if (!live.current || session.current !== ownSession) throw new Error('轮播编辑已结束，上传结果不会应用到其他记录。');
      // A close confirmation may be open. Commit this owned result even while
      // ordinary edits are locked, so cancelling close retains the uploaded image.
      setForm(previous => ({ ...previous, imageUrl: url }));
      return url;
    } finally {
      lock.current.uploading = false;
      if (live.current && session.current === ownSession) setUploading(false);
    }
  };
  const close = async () => {
    if (lock.current.saving || lock.current.closing) return;
    lock.current.closing = true; setClosing(true);
    try {
      const current = latest.current;
      if ((JSON.stringify(current.form) !== baseline.current || lock.current.uploading || current.uncertain) && !await confirm({
        title: current.uncertain ? '关闭并核对保存结果' : '放弃本次轮播编辑',
        message: current.uncertain ? '本次保存结果尚未确认，可能已经生效。关闭后先核对列表；已绑定图片会保留，只有未保存的暂存图片会清理。' : '未保存的修改不会生效，本次未使用的上传文件将清理。是否关闭？',
        confirmLabel: current.uncertain ? '关闭并核对' : '放弃编辑',
      })) return;
      if (!live.current) return;
      const failures = await session.current?.dispose() ?? 0;
      if (!live.current) return;
      onClose(current.uncertain ? '请先核对轮播列表，确认保存结果后再操作，避免重复新增。' : failures ? '编辑已关闭，部分未保存图片暂未清理，服务将继续回收过期文件。' : undefined);
    } finally { lock.current.closing = false; if (live.current) setClosing(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current.saving || lock.current.uploading || lock.current.closing || latest.current.uncertain || !session.current) return;
    const ownSession = session.current;
    let payload: Record<string, unknown>;
    try {
      const mediaError = validateStoreMediaUrl(form.imageUrl); if (mediaError) throw new Error(mediaError);
      if (!Object.hasOwn(targets, form.targetType)) throw new Error('请选择有效的跳转类型。');
      if (form.targetType === 'SHOP_DETAIL' && !/^[1-9]\d{0,18}$/.test(form.targetValue)) throw new Error('请选择要跳转的门店。');
      if (form.targetType === 'CATEGORY' && !categories.some(category => category.value === form.targetValue)) throw new Error('请选择服务类型。');
      if (form.targetType === 'EXTERNAL_URL') {
        let valid = false;
        try { const url = new URL(form.targetValue.trim()); valid = url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { /* Report in the form below. */ }
        if (!valid) throw new Error('外部跳转地址须为不含账号密码的有效 HTTPS 地址。');
      }
      payload = buildOperationPayload(operations['banner-list'].fields!, { ...form }, Boolean(item));
      if (form.targetType === 'EXTERNAL_URL') {
        payload.targetValue = new URL(form.targetValue.trim()).href;
        if (String(payload.targetValue).length > 255) throw new Error('规范化后的外部跳转地址不能超过 255 个字符。');
      }
    } catch (err) { setError(err instanceof Error ? err.message : '请检查轮播资料。'); return; }
    lock.current.saving = true; setSaving(true); setError('');
    try {
      const saved = checkedSave(item ? await updateResource<BannerItem>('banners', item.id, payload) : await createResource<BannerItem>('banners', payload), payload, item);
      const failures = await ownSession.saved(saved.imageUrl);
      if (live.current && session.current === ownSession) onSaved(saved, failures);
    } catch (err) {
      if (live.current && session.current === ownSession) {
        const unknown = !(err instanceof ApiError) || !err.status || err.status >= 500;
        setUncertain(unknown);
        setError((err instanceof Error ? err.message : '保存失败，原有草稿保留。') + (unknown ? ' 请关闭编辑并核对列表，确认前不要重复提交。' : ' 草稿与上传图片保留，可修正后重试。'));
      }
    } finally { lock.current.saving = false; if (live.current && session.current === ownSession) setSaving(false); }
  };
  const keyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); void close(); }
    if (event.key === 'Tab') {
      const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')).filter(node => node.offsetParent !== null);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/35 p-3 sm:p-6">
    <section role="dialog" aria-modal="true" aria-labelledby="banner-editor-title" onKeyDown={keyboard} className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5"><div><h2 id="banner-editor-title" className="text-lg font-semibold text-slate-900">{item ? '编辑首页轮播' : '新增首页轮播'}</h2><p className="mt-1 text-xs leading-5 text-slate-500">选择图片并填写展示内容，点击保存后才更新。默认保存为草稿。</p></div><button ref={closeButton} type="button" disabled={saving || closing} onClick={() => void close()} className="rounded-lg p-2 text-slate-500 disabled:opacity-40" aria-label="关闭轮播编辑"><X className="h-5 w-5" /></button></header>
      <form id="banner-editor-form" onSubmit={save} className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
        <StoreMediaEditor kind="banner" resourceLabel="首页轮播" value={form.imageUrl} disabled={blocked} onChange={value => change('imageUrl', value)} onUpload={upload} />
        <fieldset disabled={blocked} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-600 sm:col-span-2"><span>顾客显示标题 *</span><input required maxLength={200} value={form.title} onChange={event => change('title', event.target.value)} className={control} /><span className="block text-xs leading-5 text-slate-400">此内容会显示给顾客，请填写英文标题。</span></label>
          <label className="space-y-2 text-sm text-slate-600"><span>跳转类型 *</span><select value={form.targetType} onChange={event => change('targetType', event.target.value as TargetType)} className={control}>{Object.entries(targets).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-2 text-sm text-slate-600"><span>显示顺序 *</span><input required type="number" min={0} max={999999} step={1} value={form.sortOrder} onChange={event => change('sortOrder', event.target.value)} className={control} /><span className="block text-xs text-slate-400">数字较小的轮播优先显示。</span></label>
          {form.targetType === 'SHOP_DETAIL' && <fieldset className="space-y-2 text-sm text-slate-600 sm:col-span-2"><legend>选择门店 *</legend><ResourcePicker resource="stores" required disabled={blocked} value={form.targetValue} onChange={value => change('targetValue', String(value))} /><p className="text-xs leading-5 text-slate-400">支持按门店名称搜索。只有已发布且符合展示条件的门店会在顾客端显示跳转。</p></fieldset>}
          {form.targetType === 'CATEGORY' && <label className="space-y-2 text-sm text-slate-600 sm:col-span-2"><span>服务类型 *</span><select required value={form.targetValue} onChange={event => change('targetValue', event.target.value)} className={control}><option value="">请选择服务类型</option>{categories.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>}
          {form.targetType === 'EXTERNAL_URL' && <label className="space-y-2 text-sm text-slate-600 sm:col-span-2"><span>外部 HTTPS 地址 *</span><input required type="url" maxLength={255} placeholder="https://example.com" value={form.targetValue} onChange={event => change('targetValue', event.target.value)} className={control} /><span className="block text-xs leading-5 text-slate-400">顾客点击后打开该网页，请核对目标内容和地址。</span></label>}
          <label className="space-y-2 text-sm text-slate-600"><span>开始时间（当前设备时区）</span><input type="datetime-local" step={1} value={form.startAt} onChange={event => change('startAt', event.target.value)} className={control} /><span className="block text-xs text-slate-400">新增时留空表示保存后可立即展示，仍须勾选启用。</span></label>
          <label className="space-y-2 text-sm text-slate-600"><span>结束时间（当前设备时区）</span><input type="datetime-local" step={1} value={form.endAt} onChange={event => change('endAt', event.target.value)} className={control} /><span className="block text-xs text-slate-400">留空表示长期有效，保存时转换为明确的时间。</span></label>
          <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 sm:col-span-2"><input type="checkbox" checked={form.isActive} onChange={event => change('isActive', event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-teal-600" /><span>启用轮播<span className="mt-1 block text-xs leading-5 text-slate-400">勾选并保存后，按展示时间和目标有效性向顾客展示。未勾选时保留为草稿。</span></span></label>
        </fieldset>
        {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{error}</p>}
      </form>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4"><p role="status" className="text-xs text-slate-500">{saving ? '正在保存并核对结果…' : uploading ? '图片上传验证中…' : closing ? '正在关闭并清理暂存图片…' : uncertain ? '保存结果待核对' : dirty ? '有未保存的修改' : '资料尚未修改'}</p><div className="flex flex-wrap gap-3"><button type="button" disabled={saving || closing} onClick={() => void close()} className={secondary}>{uncertain ? '关闭并核对列表' : '取消'}</button><button type="submit" form="banner-editor-form" disabled={blocked} className={primary}>{saving ? '正在保存…' : form.isActive ? '保存轮播' : '保存草稿'}</button></div></footer>
    </section>
  </div>;
}

export default function BannerManagement() {
  const confirm = useConfirmation();
  const [items, setItems] = useState<BannerItem[]>([]), [total, setTotal] = useState(0);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState(''), [active, setActive] = useState('');
  const [filters, setFilters] = useState({ search: '', isActive: '' });
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ key: number; item: BannerItem | null } | null>(null);
  const sequence = useRef(0), alive = useRef(false), mutation = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    listResourcePage<BannerItem>('banners', { page, pageSize, ...filters }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setItems(result.items); setTotal(result.total);
      if (!result.items.length && result.total > 0 && page > 1) setPage(Math.max(1, Math.ceil(result.total / pageSize)));
    }).catch(err => { if (!controller.signal.aborted) { setItems([]); setTotal(0); setError(err instanceof Error ? err.message : '轮播列表读取失败，请刷新。'); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, pageSize, filters, revision]);
  const open = (item: BannerItem | null) => { if (!mutation.current) { setNotice(''); setEditor({ key: ++sequence.current, item }); } };
  const disable = async (item: BannerItem) => {
    if (mutation.current) return;
    mutation.current = true;
    try {
      if (!await confirm({ title: '停用首页轮播', message: `“${item.title}”将不再对顾客展示，图片和配置会保留，之后仍可重新启用。`, confirmLabel: '确认停用' }) || !alive.current) return;
      setBusy(true); setError('');
      await deleteResource('banners', item.id);
      if (alive.current) { setNotice('轮播已停用，原有图片与资料保留。'); setRevision(value => value + 1); }
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : '停用结果无法确认，请刷新核对。'); }
    finally { mutation.current = false; if (alive.current) setBusy(false); }
  };
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return <div className="app-page">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-heading">首页轮播</h1><p className="page-description">上传本地图片或使用现有图片链接，设置展示顺序、时间与跳转。顾客显示内容请使用英文。</p></div><div className="flex flex-wrap gap-3"><button type="button" className={secondary} disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw className="h-4 w-4" />刷新</button><button type="button" disabled={busy} className={primary} onClick={() => open(null)}><Plus className="h-4 w-4" />新增轮播</button></div></header>
    <form onSubmit={event => { event.preventDefault(); setFilters({ search: search.trim().slice(0, 100), isActive: active }); setPage(1); }} className="surface-panel flex flex-wrap items-end gap-4 p-5"><label className="min-w-48 flex-1 space-y-2 text-xs text-slate-500"><span>搜索标题</span><input type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="输入轮播标题" className={control} /></label><label className="space-y-2 text-xs text-slate-500"><span>启用状态</span><select value={active} onChange={event => setActive(event.target.value)} className={control}><option value="">全部</option><option value="true">启用</option><option value="false">草稿 / 停用</option></select></label><button type="submit" className={secondary}><Search className="h-4 w-4" />查询</button><button type="button" className={secondary} onClick={() => { setSearch(''); setActive(''); setFilters({ search: '', isActive: '' }); setPage(1); }}>重置</button></form>
    {notice && <p role="status" className="surface-panel border-teal-100 bg-teal-50/50 p-4 text-sm leading-6 text-teal-800">{notice}</p>}
    {error && <p role="alert" className="surface-panel border-red-100 bg-red-50/50 p-4 text-sm leading-6 text-red-700">{error}</p>}
    <section className="surface-panel overflow-hidden" aria-busy={loading} aria-label="首页轮播列表"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr>{['图片 / 标题', '跳转目标', '顺序', '状态', '展示时间（本机时间）', '操作'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={6} className="py-12 text-center text-sm text-slate-500">正在读取轮播…</td></tr> : !items.length ? <tr><td colSpan={6} className="py-12 text-center text-sm text-slate-500">{error ? '读取失败，请刷新重试。' : '暂无符合条件的轮播，可新增并保存为草稿。'}</td></tr> : items.map(item => <tr key={item.id}><td><div className="flex items-center gap-4"><Thumbnail key={`${revision}:${item.imageUrl}`} value={item.imageUrl} title={item.title} /><div className="max-w-56"><p className="break-words font-medium text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-400">#{item.id}</p></div></div></td><td className="max-w-56 text-sm text-slate-600"><p>{targets[item.targetType] ?? '目标待核对'}</p>{item.targetValue && <p className="mt-1 break-all text-xs text-slate-400">{item.targetType === 'CATEGORY' ? categories.find(category => category.value === item.targetValue)?.label ?? '服务类型待核对' : item.targetType === 'SHOP_DETAIL' ? `门店 #${item.targetValue}` : item.targetValue}</p>}</td><td className="text-sm tabular-nums text-slate-600">{item.sortOrder}</td><td><span className={'whitespace-nowrap rounded-md px-2 py-1 text-xs ' + (item.publicationState === 'LIVE' ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-500')}>{states[item.publicationState ?? ''] ?? '状态待核对'}</span></td><td className="whitespace-nowrap text-xs leading-6 text-slate-500"><p>开始：{time(item.startAt)}</p><p>结束：{item.endAt ? time(item.endAt) : '长期有效'}</p></td><td><div className="flex flex-wrap gap-3 text-sm"><button type="button" disabled={busy} onClick={() => open(item)} className="font-medium text-teal-700 disabled:opacity-40">编辑</button>{item.isActive && <button type="button" disabled={busy} onClick={() => void disable(item)} className="text-red-700 disabled:opacity-40">停用</button>}</div></td></tr>)}</tbody></table></div><footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-sm text-slate-500"><span>{loading || error ? '—' : `共 ${total} 条`} · 第 {page} / {pages} 页</span><div className="flex items-center gap-3"><label className="flex items-center gap-2">每页<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-lg border border-slate-200 px-2 py-2">{[25, 50, 100].map(size => <option key={size} value={size}>{size} 条</option>)}</select></label><button type="button" aria-label="上一页" disabled={loading || page <= 1} className={secondary} onClick={() => setPage(value => value - 1)}><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="下一页" disabled={loading || page >= pages} className={secondary} onClick={() => setPage(value => value + 1)}><ChevronRight className="h-4 w-4" /></button></div></footer></section>
    {editor && <BannerEditor key={editor.key} item={editor.item} onClose={message => { setEditor(null); if (message) setNotice(message); setRevision(value => value + 1); }} onSaved={(saved, failures) => { setEditor(null); setNotice(`轮播“${saved.title}”已保存。` + (failures ? ' 部分未使用的暂存图片将由服务继续回收。' : '')); setRevision(value => value + 1); }} />}
  </div>;
}
