import { useEffect, useRef, useState } from 'react';
import { updateResource } from '../../api/resources';
import { ApiError } from '../../api/session';
import { getProjectCatalog } from '../../api/projectCatalog';
import { readProjectCatalogPage, type ProjectCatalogItem } from '../../utils/projectCatalog';
import { PROJECT_METADATA_CATEGORIES, buildProjectMetadataPatch, projectMetadataDraft, projectMetadataFingerprint, projectMetadataIdentity, projectMetadataSourceKey, verifyProjectMetadataReceipt, type ProjectMetadataDraft } from '../../utils/projectMetadata';
import { durationFieldLabel, durationHelp, SERVICE_DURATION_KINDS, SERVICE_DURATION_LABELS } from '../../utils/serviceDuration';
import { useConfirmation } from '../Confirmation';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycleListener } from './businessScope';

const control = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-500';
export interface StoreProjectMetadataProps { project: ProjectCatalogItem; disabled: boolean; beforeWrite: () => boolean; onLifecycleChange: BusinessLifecycleListener; onSaved: () => void | Promise<void>; }

export default function StoreProjectMetadata({ project, disabled, beforeWrite, onLifecycleChange, onSaved }: StoreProjectMetadataProps) {
  const scope = useBusinessScope(project.shopId), confirm = useConfirmation();
  const [baseline, setBaseline] = useState(project), [draft, setDraft] = useState(() => projectMetadataDraft(project));
  const [busy, setBusy] = useState(false), [outdated, setOutdated] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [unknown, setUnknown] = useState(false), [reviewed, setReviewed] = useState<ProjectCatalogItem | null>(null);
  const mounted = useRef(true), locked = useRef(false), dirtyRef = useRef(false), unknownRef = useRef(false), editRevision = useRef(0);
  const reviewRef = useRef<{ project: ProjectCatalogItem; current: () => boolean } | null>(null);
  const identity = projectMetadataIdentity(project), baselineIdentity = projectMetadataIdentity(baseline), sourceKey = projectMetadataSourceKey(project);
  const live = useRef({ identity, generation: 0, disabled, beforeWrite });
  if (live.current.identity !== identity) live.current = { identity, generation: live.current.generation + 1, disabled, beforeWrite };
  else { live.current.disabled = disabled; live.current.beforeWrite = beforeWrite; }
  const dirty = projectMetadataFingerprint(draft, baseline.hasVariants) !== projectMetadataFingerprint(projectMetadataDraft(baseline), baseline.hasVariants);
  dirtyRef.current = dirty;
  const mismatch = baselineIdentity !== identity;
  const renderedRevision = editRevision.current, eventScope = scope.captureEvent();
  const currentEvent = () => renderedRevision === editRevision.current && eventScope();
  const capture = () => { const generation = live.current.generation, currentScope = scope.capture(); return () => mounted.current && generation === live.current.generation && currentScope(); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onLifecycleChange({ dirty, busy, unknown }); }, [dirty, busy, unknown, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  useEffect(() => {
    if (projectMetadataSourceKey(baseline) === sourceKey) return;
    reviewRef.current = null; setReviewed(null);
    if (dirtyRef.current || locked.current || unknownRef.current) { setOutdated(true); return; }
    editRevision.current++;
    setBaseline(project); setDraft(projectMetadataDraft(project)); setOutdated(false); setError(''); setNotice('');
  // Source keys describe the parent's returned data. Dirty drafts remain until explicitly discarded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);
  const set = <Key extends keyof ProjectMetadataDraft>(key: Key, value: ProjectMetadataDraft[Key]) => {
    if (!currentEvent() || live.current.disabled || locked.current || unknownRef.current || mismatch) return;
    editRevision.current++;
    setDraft(current => ({ ...current, [key]: value })); setError(''); setNotice('');
  };
  const reset = () => {
    if (!currentEvent() || locked.current || unknownRef.current) return;
    editRevision.current++;
    setBaseline(project); setDraft(projectMetadataDraft(project)); setOutdated(false); setError(''); setNotice('已载入当前已保存的项目资料。');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (!currentEvent() || locked.current || unknownRef.current || live.current.disabled || mismatch || outdated || !dirty || !live.current.beforeWrite()) return;
    const current = capture();
    let payload;
    try { payload = buildProjectMetadataPatch(baseline, draft); } catch (value) { setError(value instanceof Error ? value.message : '请核对项目资料。'); return; }
    if (!Object.keys(payload).length) { setDraft(projectMetadataDraft(baseline)); setError(''); setNotice('没有需要保存的实际变更。'); return; }
    // The synchronous parent check also protects a price-menu draft or identity change before dispatch.
    if (!current() || live.current.disabled || !live.current.beforeWrite()) return;
    editRevision.current++;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    let persisted = false;
    try {
      const saved = await updateResource<unknown>('services', baseline.id, payload);
      if (!current()) return;
      verifyProjectMetadataReceipt(saved, baseline, payload);
      persisted = true;
      setNotice('项目保存回执已收到，正在只读核对当前项目资料。');
      const query = { search: '', status: 'all' as const, page: 1, pageSize: 1, serviceId: baseline.id };
      const page = readProjectCatalogPage(await getProjectCatalog(baseline.shopId, query), baseline.shopId, query);
      if (!current()) return;
      const actual = page.items.find(item => item.id === baseline.id);
      if (!actual) throw Error('保存后未能读取当前项目，请保留草稿并核对。');
      const next = { ...actual, ...verifyProjectMetadataReceipt(actual, baseline, payload) };
      setBaseline(next); setDraft(projectMetadataDraft(next)); setOutdated(false); setNotice('项目资料已保存，正在同步本店目录。');
      await onSaved();
      if (current()) setNotice('本服务共同资料已保存，且已重新读取本店目录与关联展示行。');
    } catch (value) {
      if (current()) {
        const uncertain = persisted || !(value instanceof ApiError && value.status >= 400 && value.status < 500 && value.status !== 408);
        unknownRef.current = uncertain; setUnknown(uncertain); reviewRef.current = null; setReviewed(null);
        setError((value instanceof Error ? value.message : '保存结果暂未能确认。') + (uncertain ? ' 请求可能已经保存，当前草稿保留；请只读核对服务器资料后再继续。' : ' 本次请求未获接受，当前草稿保留，可修改后再保存。'));
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const readBack = async () => {
    if (!currentEvent() || locked.current || !unknownRef.current || mismatch) return;
    const current = capture(), query = { search: '', status: 'all' as const, page: 1, pageSize: 1, serviceId: project.id };
    if (!current()) return;
    locked.current = true; setBusy(true); setError(''); setReviewed(null); reviewRef.current = null;
    try {
      const page = readProjectCatalogPage(await getProjectCatalog(project.shopId, query), project.shopId, query);
      if (!current()) return;
      const actual = page.items.find(item => item.id === project.id);
      if (!actual) throw Error('未能读取当前项目，不能据此认定上次未保存。');
      reviewRef.current = { project: actual, current }; setReviewed(actual);
      setNotice('已只读载入服务器项目资料。下方保留本次草稿，请对照后明确采用服务器资料；不会自动重发。');
    } catch (value) { if (current()) setError((value instanceof Error ? value.message : '只读核对失败。') + ' 上次保存结果仍待核对，草稿与提交锁保持。'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const adoptReviewed = async () => {
    const review = reviewRef.current;
    if (!currentEvent() || locked.current || !unknownRef.current || !review || mismatch || !review.current()) return;
    locked.current = true; setBusy(true);
    try {
      if (!await confirm({ title: '采用服务器项目资料', message: '这会放弃当前保留的草稿，采用刚读取的服务器资料，并刷新本店目录。不会再次提交上次请求。', confirmLabel: '采用服务器资料', tone: 'primary' })) return;
      if (reviewRef.current !== review || !review.current()) return;
      editRevision.current++;
      setBaseline(review.project); setDraft(projectMetadataDraft(review.project)); setOutdated(false);
      unknownRef.current = false; setUnknown(false); reviewRef.current = null; setReviewed(null); setError(''); setNotice('已采用服务器资料，正在同步本店目录。');
      try { await onSaved(); if (review.current()) setNotice('已采用服务器资料，并已重新读取本店目录。'); } catch { if (review.current()) { unknownRef.current = true; setUnknown(true); setError('已采用服务器资料，但目录刷新未完成，请只读核对后再继续。'); } }
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const fieldsDisabled = disabled || busy || unknown || mismatch;
  const kind = SERVICE_DURATION_KINDS.includes(draft.durationKind as typeof SERVICE_DURATION_KINDS[number]) ? draft.durationKind : '';
  return <section aria-label="项目资料编辑" className="rounded-xl border border-teal-100 bg-white p-4">
    <h4 className="font-semibold text-slate-900">服务共同资料</h4>
    <p className="mt-2 text-xs leading-6 text-slate-500">名称、类别、说明和主项目启停在这里维护。顾客看到的已关联项目同步使用这些资料；历史订单快照保留。</p>
    {baseline.hasVariants && <p className="mt-3 rounded-lg bg-teal-50 p-3 text-xs leading-6 text-teal-800">本项目有 {baseline.variantCount} 个规格。名称、类别、说明及主项目开关为整组共用；各规格价格和时长在下方“规格与价格”维护。</p>}
    {(outdated || mismatch) && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-800">已保存的项目资料或当前选择已有变化，当前草稿保留。请先自行保留需要的内容，再明确载入最新资料后编辑。</p>}
    {unknown && <div role="alert" className="mt-3 space-y-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900"><p>上次保存结果待核对，编辑、重复提交及放弃到旧资料已锁定。请先读取服务器当前项目资料。</p>
      {reviewed && <div className="space-y-1 rounded-lg bg-white p-3"><strong>服务器当前资料：{reviewed.name}</strong><p>类别：{PROJECT_METADATA_CATEGORIES.find(item => item.value === reviewed.category)?.label ?? reviewed.category ?? '未填写'} · {reviewed.isActive ? '已启用' : '已暂停'}</p>{reviewed.hasVariants ? <p>{reviewed.variantCount} 个规格，价格和时长在项目选项维护。</p> : <p>时长／预约预留：{reviewed.durationMin ?? '待核对'} 分钟 · 价格：{projectMetadataDraft(reviewed).price || '待核对'} USD</p>}<p className="whitespace-pre-wrap">说明：{reviewed.description || '未填写'}</p></div>}
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || mismatch} onClick={() => void readBack()} className="underline disabled:opacity-40">只读核对服务器资料</button><button type="button" disabled={busy || mismatch || !reviewed} onClick={() => void adoptReviewed()} className="underline disabled:opacity-40">采用服务器资料并结束本次编辑</button></div></div>}
    <form onSubmit={save} className="mt-4 space-y-4">
      <fieldset disabled={fieldsDisabled} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-600"><span>项目名称 *</span><input className={control} maxLength={200} required value={draft.name} onChange={event => set('name', event.target.value)} /></label>
        <label className="space-y-2 text-sm text-slate-600"><span>项目类别 *</span><select className={control} required value={draft.category} onChange={event => set('category', event.target.value)}><option value="">请选择项目类别</option>{PROJECT_METADATA_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {!baseline.hasVariants && <>
          <label className="space-y-2 text-sm text-slate-600"><span>项目时长类型 *</span><select className={control} required value={kind} onChange={event => set('durationKind', event.target.value)}><option value="">请选择时长类型</option>{SERVICE_DURATION_KINDS.map(value => <option key={value} value={value}>{SERVICE_DURATION_LABELS[value]}</option>)}</select></label>
          <label className="space-y-2 text-sm text-slate-600"><span>{kind ? durationFieldLabel(kind) : '服务时长／预约预留（分钟）'} *</span><input type="number" min={5} max={240} step={1} required className={control} value={draft.durationMin} onChange={event => set('durationMin', event.target.value)} /></label>
          <label className="space-y-2 text-sm text-slate-600"><span>项目价格（美元） *</span><input type="text" inputMode="decimal" maxLength={12} required className={control} value={draft.price} onChange={event => set('price', event.target.value)} /></label>
          <p className="text-xs leading-6 text-slate-500 sm:col-span-2">{kind ? durationHelp(kind) : '请明确选择时长类型。'} 不在此修改顾客人数、所需技师数或场地规则。</p>
        </>}
        <label className="space-y-2 text-sm text-slate-600 sm:col-span-2"><span>项目说明</span><textarea rows={3} maxLength={10000} className={control} value={draft.description} onChange={event => set('description', event.target.value)} /></label>
        <label className="flex items-start gap-2 text-sm leading-6 text-slate-600 sm:col-span-2"><input type="checkbox" className="mt-1 accent-teal-700" checked={draft.isActive} onChange={event => set('isActive', event.target.checked)} /><span>启用主项目<span className="block text-xs text-slate-500">暂停会阻止本项目及全部规格接受新预约，已有订单保留；单独规格启停在下方“规格与价格”维护。</span></span></label>
      </fieldset>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}
      {notice && <p role="status" className="text-xs leading-6 text-teal-700">{notice}</p>}
      <p className="text-xs leading-6 text-slate-500">仅保存当前服务的共同资料；同一服务的已关联展示行随之同步，规格价格及其他门店资料使用各自的保存按钮。</p><div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={fieldsDisabled || outdated || !dirty} className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">{busy ? '正在处理项目资料…' : '保存本服务共同资料'}</button><button type="button" disabled={busy || unknown || !dirty && !outdated && !mismatch} onClick={reset} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-600 disabled:opacity-40">{outdated || mismatch ? '放弃本次修改并载入最新资料' : '放弃未保存修改'}</button><span className="text-xs text-slate-500">{unknown ? '保存结果待核对' : dirty ? '有未保存的项目资料修改' : '与本页读取的项目资料一致'}</span></div>
    </form>
  </section>;
}
