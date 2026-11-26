import { useEffect, useRef, useState } from 'react';
import { getProjectCatalog } from '../../api/projectCatalog';
import { sendProjectAddOn } from '../../api/projectAddOns';
import { readProjectCatalogPage, type ProjectCatalogAddOn } from '../../utils/projectCatalog';
import { buildProjectAddOnPayload, projectAddOnDraft, ProjectAddOnAttempt, type ProjectAddOnDraft } from '../../utils/projectAddOns';
import { exactProjectId, projectWriteAllowed } from '../../utils/projectRuleEdits';
import { useConfirmation } from '../Confirmation';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycleListener } from './businessScope';

const control = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-50';
interface Editor { id?: string; draft: ProjectAddOnDraft; original: string; identity: string; attempt: ProjectAddOnAttempt; }
interface AddOnReview { rows: ProjectCatalogAddOn[]; identity: string; sourceKey: string; attempt: ProjectAddOnAttempt; current: () => boolean; }
export interface StoreProjectAddOnsProps {
  shopId: string; serviceId: string; items: ProjectCatalogAddOn[]; disabled: boolean; beforeWrite: () => boolean;
  onLifecycleChange: BusinessLifecycleListener; onSaved: () => void;
}
function amount(value: number | null) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? (value / 100).toFixed(2) + ' USD' : '价格待核对'; }

/** Independent sibling form: no store form, money collection or resource policy mutation. */
export default function StoreProjectAddOns({ shopId, serviceId, items, disabled, beforeWrite, onLifecycleChange, onSaved }: StoreProjectAddOnsProps) {
  const scope = useBusinessScope(shopId), confirm = useConfirmation();
  const identity = String(scope.actorId) + ':' + shopId + ':' + serviceId;
  const sourceKey = JSON.stringify(items);
  const live = useRef({ identity, generation: 0, sourceKey, disabled, beforeWrite });
  if (live.current.identity !== identity) live.current = { identity, generation: live.current.generation + 1, sourceKey, disabled, beforeWrite };
  else { live.current.sourceKey = sourceKey; live.current.disabled = disabled; live.current.beforeWrite = beforeWrite; }
  const [listing, setListing] = useState(items), [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [reviewed, setReviewed] = useState<AddOnReview | null>(null), [outdated, setOutdated] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true), locked = useRef(false), editorRef = useRef(editor), editRevision = useRef(0), unknownRef = useRef(false), outdatedRef = useRef(false); editorRef.current = editor;
  const reviewRef = useRef<AddOnReview | null>(null);
  if (reviewRef.current && (reviewRef.current.identity !== identity || reviewRef.current.sourceKey !== sourceKey)) reviewRef.current = null;
  const dirty = !!editor && JSON.stringify(editor.draft) !== editor.original;
  const validScope = !!exactProjectId(shopId) && !!exactProjectId(serviceId) && items.every(row => exactProjectId(row.id) && row.serviceId === serviceId);
  const mismatch = !!editor && editor.identity !== identity;
  const renderedRevision = editRevision.current, renderedGeneration = live.current.generation, eventScope = scope.captureEvent();
  const currentEvent = () => mounted.current && renderedRevision === editRevision.current && renderedGeneration === live.current.generation && eventScope();
  const replaceEditor = (next: Editor | null) => { editRevision.current++; editorRef.current = next; setEditor(next); };
  const capture = () => { const generation = live.current.generation, currentScope = scope.capture(); return () => mounted.current && generation === live.current.generation && currentScope(); };
  const reviewCurrent = (review: AddOnReview | null) => !!review && reviewRef.current === review && review.identity === live.current.identity
    && review.sourceKey === live.current.sourceKey && review.attempt === editorRef.current?.attempt && review.current();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onLifecycleChange({ dirty, busy: busy || !!editor, unknown }); }, [dirty, busy, editor, unknown, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  useEffect(() => {
    if (editorRef.current) { outdatedRef.current = true; setOutdated(true); return; }
    setListing(items); outdatedRef.current = false; setOutdated(false);
  // Do not overwrite a pending or unknown attempt with a new parent snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, identity]);
  useEffect(() => {
    if (!dirty && !unknown) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, unknown]);
  const open = (item?: ProjectCatalogAddOn) => {
    const current = capture();
    if (!currentEvent() || locked.current || editorRef.current || live.current.disabled || !validScope || !projectWriteAllowed(current, live.current.beforeWrite) || item && item.serviceId !== serviceId) return;
    const draft = projectAddOnDraft(item); replaceEditor({ id: item?.id, draft, original: JSON.stringify(draft), identity, attempt: new ProjectAddOnAttempt() });
    unknownRef.current = false; setUnknown(false); reviewRef.current = null; setReviewed(null); outdatedRef.current = false; setOutdated(false); setError(''); setNotice('');
  };
  const close = async () => {
    if (!currentEvent() || locked.current || unknownRef.current || !editor || editorRef.current !== editor) return;
    const current = capture();
    if (dirty && !await confirm({ title: '放弃附加项草稿', message: '本次附加项修改尚未保存，是否放弃？', confirmLabel: '放弃草稿' })) return;
    if (!current() || !currentEvent() || locked.current || unknownRef.current || editorRef.current !== editor) return;
    replaceEditor(null); setListing(items); outdatedRef.current = false; setOutdated(false); setError('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (!currentEvent() || locked.current || !editor || editorRef.current !== editor || mismatch || unknownRef.current || outdatedRef.current || live.current.disabled || !validScope || !dirty && editor.id !== undefined) return;
    const current = capture(), attempt = editor.attempt;
    if (!projectWriteAllowed(current, live.current.beforeWrite)) return;
    let payload; try { payload = buildProjectAddOnPayload(editor.draft); } catch (value) { setError(value instanceof Error ? value.message : '请核对附加项资料。'); return; }
    if (!projectWriteAllowed(current, live.current.beforeWrite)) return;
    editRevision.current++; locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await attempt.save({ shopId, serviceId, id: editor.id, payload, current,
        beforeWrite: () => !live.current.disabled && live.current.beforeWrite(), send: sendProjectAddOn });
      if (!current() || !saved || editorRef.current !== editor) return;
      setListing(rows => [...rows.filter(row => row.id !== saved.id), saved]); replaceEditor(null); unknownRef.current = false; setUnknown(false); outdatedRef.current = false; setOutdated(false);
      setNotice('附加项已确认保存，正在同步本店目录与价目。');
      try { onSaved(); } catch { setError('附加项已保存，但目录刷新未完成，请重新载入核对。'); }
    } catch (value) {
      if (!current()) return;
      unknownRef.current = attempt.state === 'UNKNOWN'; setUnknown(unknownRef.current); reviewRef.current = null; setReviewed(null);
      setError((value instanceof Error ? value.message : '附加项保存结果暂未确认。') + (attempt.state === 'UNKNOWN' ? ' 请求可能已经保存；保留当前草稿，勿重复提交。' : ' 当前草稿保留，请核对后再保存。'));
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const readBack = async () => {
    if (!currentEvent() || locked.current || !unknownRef.current || !editor || editorRef.current !== editor || mismatch || !validScope) return;
    const current = capture(), attempt = editor.attempt, query = { search: '', status: 'all' as const, page: 1, pageSize: 1, serviceId };
    locked.current = true; setBusy(true); setError(''); setNotice(''); reviewRef.current = null; setReviewed(null);
    try {
      const page = readProjectCatalogPage(await getProjectCatalog(shopId, query), shopId, query);
      if (!current()) return;
      if (sourceKey !== live.current.sourceKey || editorRef.current?.attempt !== attempt) throw Error('当前目录或编辑已变化，请重新只读载入后核对。');
      const project = page.items.find(row => row.id === serviceId);
      if (!project) throw Error('未能读取当前项目，不能据此认定上次未保存。');
      const review = { rows: project.addOns, identity, sourceKey, attempt, current };
      reviewRef.current = review; setListing(review.rows); setReviewed(review); setNotice('已只读载入当前项目的附加项，请对照保留草稿核对。列表中未找到某项，不自动等于上次未创建。');
    } catch (value) { if (current()) setError((value instanceof Error ? value.message : '只读核对失败。') + ' 上次结果仍待核对，页面不会自动重试写入。'); }
    finally { locked.current = false; if (current()) setBusy(false); }
  };
  const finishUnknown = async () => {
    const review = reviewRef.current;
    if (!currentEvent() || locked.current || !unknownRef.current || mismatch || !validScope || !reviewCurrent(review)) return;
    if (!await confirm({ title: '结束待核对编辑', message: '请先自行保留需要的草稿并对照当前附加项。结束后重新载入页面核对目录；不会再次提交，也不判定上次未创建。', confirmLabel: '结束并重新载入', tone: 'primary' })) return;
    if (locked.current || !reviewCurrent(review)) return;
    window.location.reload();
  };
  const set = <Key extends keyof ProjectAddOnDraft>(key: Key, value: ProjectAddOnDraft[Key]) => {
    if (!currentEvent() || !editor || editorRef.current !== editor || locked.current || unknownRef.current || outdatedRef.current || live.current.disabled || mismatch || !validScope) return;
    replaceEditor({ ...editor, draft: { ...editor.draft, [key]: value } }); setError(''); setNotice('');
  };
  const fieldsDisabled = disabled || busy || unknown || mismatch || outdated || !validScope;
  return <section aria-label="当前项目附加项" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-slate-900">本项目附加项</h4><p className="mt-2 text-xs leading-6 text-slate-500">附加项只随当前主项目选择，不增加预约分钟，不能单独预约。价格为明确美元金额，可为0；保存不收款，也不自动启用主项目。</p></div><button type="button" disabled={disabled || busy || !!editor || !validScope || listing.length >= 50} onClick={() => open()} className="rounded-lg bg-teal-700 px-3 py-2 text-sm text-white disabled:opacity-40">新增附加项</button></div>
    {!validScope && <p role="alert" className="text-sm text-red-700">附加项与当前门店项目不匹配，请刷新核对；未打开其他项目。</p>}
    <div className="divide-y divide-slate-100">{listing.filter(item => item.serviceId === serviceId).map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><strong className="text-sm text-slate-800">{item.name}</strong><p className="mt-1 text-xs text-slate-500">{amount(item.priceCents)} · {item.isActive ? '附加项已启用' : '附加项已停用'} · 排序 {item.sortOrder ?? '待核对'}</p>{item.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.description}</p>}</div><button type="button" disabled={disabled || busy || !!editor || !validScope} onClick={() => open(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-teal-700 disabled:opacity-40">编辑附加项</button></article>)}</div>
    {!listing.length && <p className="text-sm text-slate-500">本项目尚无附加项，无需为了开放预约额外新增。</p>}
    {(outdated || mismatch) && <p role="alert" className="text-sm text-amber-800">当前项目或目录已有变化，草稿保留；请放弃旧草稿后重新选择，不能保存到其他项目。</p>}
    {editor && <form onSubmit={save} className="space-y-4 rounded-lg bg-slate-50 p-4"><h5 className="font-medium">{editor.id ? '编辑附加项' : '新增本项目附加项'}</h5>
      <fieldset disabled={fieldsDisabled} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm sm:col-span-2"><span>附加项名称 *</span><input className={control} required maxLength={100} value={editor.draft.name} onChange={event => set('name', event.target.value)} /></label>
        <label className="space-y-2 text-sm"><span>价格（美元） *</span><input className={control} required inputMode="decimal" maxLength={12} value={editor.draft.price} onChange={event => set('price', event.target.value)} /></label>
        <label className="space-y-2 text-sm"><span>排序 *</span><input className={control} required type="number" min={0} max={10000} step={1} value={editor.draft.sortOrder} onChange={event => set('sortOrder', event.target.value)} /></label>
        <label className="space-y-2 text-sm sm:col-span-2"><span>附加项说明</span><textarea className={control} rows={3} maxLength={1000} value={editor.draft.description} onChange={event => set('description', event.target.value)} /></label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={editor.draft.isActive} onChange={event => set('isActive', event.target.checked)} /><span>启用此附加项；主项目暂停时仍不可选择，不改变其他附加项。</span></label>
      </fieldset>
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={fieldsDisabled || !dirty && !!editor.id} className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? '正在处理…' : '保存本附加项'}</button><button type="button" disabled={busy || unknown} onClick={() => void close()} className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-40">放弃本次编辑</button></div>
    </form>}
    {unknown && <div role="alert" className="space-y-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900"><p>上次写入结果待核对，重复新增和保存已锁定。请保留草稿，并只读载入当前附加项核对。</p><div className="flex flex-wrap gap-3"><button type="button" disabled={busy || mismatch} onClick={() => void readBack()} className="underline disabled:opacity-40">只读载入当前附加项</button><button type="button" disabled={busy || mismatch || !validScope || !reviewCurrent(reviewed)} onClick={() => void finishUnknown()} className="underline disabled:opacity-40">结束本次编辑并重新载入页面</button></div></div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}{notice && <p role="status" className="text-sm leading-6 text-teal-700">{notice}</p>}
  </section>;
}
