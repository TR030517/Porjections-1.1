import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, FileSpreadsheet, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { applyCatalogImport, catalogImportResult, checkCatalogText, previewCatalogImport, resolveCatalogImport, CATALOG_CATEGORIES, CATALOG_MAX_BYTES, type CatalogPreview, type CatalogReceipt, type CatalogResult } from '../api/catalogImport';
import { CATALOG_EXAMPLE, CATALOG_TEMPLATE, clearPendingCatalog, readPendingCatalog, sameCatalogPending, savePendingCatalog, type PendingCatalogImport } from '../utils/catalogImportModel';
import { useConfirmation } from './Confirmation';
import ResourcePicker from './ResourcePicker';

interface Draft { shopId: string; text: string }
interface PreviewState { value: CatalogPreview; input: Draft; version: number }
const errorText = (error: unknown) => error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '请求未完成，请检查网络并保留标识，稍后核对结果。';
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const money = (cents: number) => 'USD ' + (cents / 100).toFixed(2);
function localPending(actorId: string) { try { return readPendingCatalog(window.sessionStorage, actorId); } catch { return null; } }
function Summary({ values }: { values: Array<[string, number]> }) {
  return <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{values.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-semibold text-slate-800">{value}</dd></div>)}</dl>;
}

export default function CatalogImport({ actorId, fixedShopId, onClose, onImported, onConfigure }: {
  actorId: string; fixedShopId?: string; onClose: () => void; onImported: (receipt: CatalogReceipt) => void;
  onConfigure: (shopId: string, serviceId: string) => void;
}) {
  const confirm = useConfirmation();
  const [capturedShop] = useState(fixedShopId ?? '');
  const [draft, setDraft] = useState<Draft>(() => ({ shopId: capturedShop, text: '' }));
  const [preview, setPreview] = useState<PreviewState | null>(null), [receipt, setReceipt] = useState<CatalogReceipt | null>(null);
  const [pending, setPending] = useState<PendingCatalogImport | null>(() => localPending(actorId));
  const [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(''), [closing, setClosing] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [filename, setFilename] = useState('');
  const live = useRef(false), operation = useRef(''), version = useRef(0), previewController = useRef<AbortController | null>(null);
  const draftRef = useRef(draft), pendingRef = useRef(pending), receiptRef = useRef(receipt), closeLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null), panel = useRef<HTMLElement>(null), fileInput = useRef<HTMLInputElement>(null);
  draftRef.current = draft; pendingRef.current = pending; receiptRef.current = receipt;
  useEffect(() => {
    live.current = true; const previous = document.activeElement as HTMLElement | null; heading.current?.focus();
    const leaving = (event: BeforeUnloadEvent) => {
      if (draftRef.current.text && !receiptRef.current || operation.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leaving);
    return () => { live.current = false; version.current++; previewController.current?.abort(); window.removeEventListener('beforeunload', leaving); if (previous?.isConnected) previous.focus(); };
  }, []);
  const updateDraft = (next: Draft, nextFilename = '') => {
    if (pendingRef.current || receiptRef.current || closeLock.current || operation.current && operation.current !== 'preview') return;
    version.current++; previewController.current?.abort(); previewController.current = null;
    operation.current = ''; setBusy(''); draftRef.current = next; setDraft(next); setFilename(nextFilename);
    setPreview(null); setAgreed(false); setError(''); setNotice('');
  };
  const leave = async () => {
    if (operation.current && operation.current !== 'preview' || closeLock.current) return;
    closeLock.current = true; setClosing(true);
    try {
      if (draftRef.current.text && !pendingRef.current && !receiptRef.current && !await confirm({ title: '关闭服务草稿导入', message: '未提交的表格与预览将放弃，已保存的项目不受影响。是否关闭？', confirmLabel: '放弃草稿并关闭' })) return;
      if (live.current) { version.current++; previewController.current?.abort(); onClose(); }
    } finally { closeLock.current = false; if (live.current) setClosing(false); }
  };
  const readFile = async (file: File) => {
    if (operation.current || pendingRef.current || receiptRef.current || closeLock.current) return;
    operation.current = 'reading'; setBusy('reading'); const ownVersion = ++version.current;
    setError(''); setNotice(''); setPreview(null); setAgreed(false);
    try {
      if (file.size > CATALOG_MAX_BYTES) throw new Error('文件超过 60 KiB，请分成最多 100 行的小批次。');
      const text = checkCatalogText(await file.text());
      if (live.current && ownVersion === version.current) { const next = { ...draftRef.current, text }; draftRef.current = next; setDraft(next); setFilename(file.name); }
    } catch (err) { if (live.current && ownVersion === version.current) setError(errorText(err)); }
    finally { if (live.current && ownVersion === version.current) { operation.current = ''; setBusy(''); } }
  };
  const makePreview = async () => {
    if (operation.current || pendingRef.current || receiptRef.current || closeLock.current) return;
    operation.current = 'preview'; setBusy('preview'); setError(''); setNotice(''); setPreview(null); setAgreed(false);
    const input = { ...draftRef.current }, ownVersion = version.current;
    const controller = new AbortController(); previewController.current = controller;
    try {
      const value = await previewCatalogImport(input.shopId, input.text, controller.signal);
      if (live.current && !controller.signal.aborted && ownVersion === version.current) setPreview({ value, input, version: ownVersion });
    } catch (err) { if (live.current && !controller.signal.aborted && ownVersion === version.current) setError(errorText(err)); }
    finally { if (live.current && ownVersion === version.current) { operation.current = ''; setBusy(''); } }
  };
  const finish = (expected: PendingCatalogImport, result: Exclude<CatalogResult, { found: false }>) => {
    // Neither a stale request nor an old editor can remove a newer recovery marker.
    try {
      const current = readPendingCatalog(window.sessionStorage, actorId);
      if (current && !sameCatalogPending(current, expected)) return;
      clearPendingCatalog(window.sessionStorage, expected);
    } catch { /* The checked terminal server result remains authoritative. */ }
    if (!live.current || !sameCatalogPending(pendingRef.current, expected)) return;
    pendingRef.current = null; setPending(null); setPreview(null); setAgreed(false); setError(''); version.current++;
    if (result.state === 'APPLIED') {
      receiptRef.current = result.receipt; setReceipt(result.receipt); setNotice('服务器已确认整批导入结果。'); onImported(result.receipt);
    } else setNotice('服务器已确认本次未导入，并已结束该请求。可修正表格后重新预览。');
  };
  const apply = async () => {
    if (operation.current || pendingRef.current || receiptRef.current || closeLock.current || !preview || !preview.value.canApply || !agreed) return;
    if (preview.version !== version.current || preview.input.shopId !== draftRef.current.shopId || preview.input.text !== draftRef.current.text
      || !preview.value.expiresAt || Date.parse(preview.value.expiresAt) <= Date.now()) {
      setPreview(null); setAgreed(false); setError('表格、门店或预览有效期已变化，请重新预览。'); return;
    }
    operation.current = 'apply'; setBusy('apply'); setError(''); setNotice('');
    const marker: PendingCatalogImport = { actorId, shopId: preview.input.shopId, requestKey: `catalog-import:${crypto.randomUUID()}`, packageDigest: preview.value.packageDigest, createdAt: new Date().toISOString() };
    try { savePendingCatalog(window.sessionStorage, marker); }
    catch (err) { setError('本次尚未提交。' + errorText(err) + ' 浏览器需要能够保留结果核对标识。'); operation.current = ''; setBusy(''); return; }
    pendingRef.current = marker; setPending(marker);
    try { finish(marker, { found: true, state: 'APPLIED', receipt: await applyCatalogImport(preview.input.shopId, preview.input.text, preview.value, marker.requestKey) }); }
    catch (err) { if (live.current && sameCatalogPending(pendingRef.current, marker)) { setError(errorText(err)); setNotice('导入结果尚待核对，系统不会自动重复提交。请查询结果或核对并结束该请求。'); } }
    finally { operation.current = ''; if (live.current) setBusy(''); }
  };
  const check = async (resolve: boolean) => {
    const marker = pendingRef.current;
    if (!marker || operation.current || closeLock.current) return;
    operation.current = resolve ? 'resolve' : 'check'; setBusy(operation.current); setError(''); setNotice('');
    try {
      const result = resolve ? await resolveCatalogImport(marker) : await catalogImportResult(marker);
      if (result.found === true) finish(marker, result);
      else if (live.current && sameCatalogPending(pendingRef.current, marker)) setNotice('暂未找到最终收据，不能据此判断失败。可稍后查询，或核对并结束本次请求。');
    } catch (err) { if (live.current && sameCatalogPending(pendingRef.current, marker)) setError(errorText(err)); }
    finally { operation.current = ''; if (live.current) setBusy(''); }
  };
  const clearDraft = () => {
    if (operation.current || pendingRef.current || closeLock.current) return;
    receiptRef.current = null; setReceipt(null); version.current++;
    const next = { shopId: capturedShop || draftRef.current.shopId, text: '' }; draftRef.current = next; setDraft(next);
    setPreview(null); setAgreed(false); setFilename(''); setError(''); setNotice('');
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([CATALOG_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'massajoy-catalog-USD.csv'; link.click(); URL.revokeObjectURL(url);
  };
  const example = async () => {
    if (operation.current || pendingRef.current || receiptRef.current || closeLock.current) return;
    if (draftRef.current.text && !await confirm({ title: '替换为示例表格', message: '当前未提交的表格将替换为示例。示例仅用于了解格式，正式导入前请改为真实英文项目名称与价目。', confirmLabel: '填入示例', tone: 'primary' })) return;
    if (live.current) updateDraft({ ...draftRef.current, text: CATALOG_EXAMPLE });
  };
  const editingBlocked = closing || !!pending || !!receipt || !!busy && busy !== 'preview';
  const blocked = closing || !!busy;
  const currentPreview = preview?.value;
  const keyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); void leave(); }
    if (event.key === 'Tab') {
      const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]') ?? [])].filter(node => node.getClientRects().length > 0);
      if (!nodes.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === nodes[0] || document.activeElement === heading.current)) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
    }
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/35 p-2 sm:p-5">
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby="catalog-import-title" aria-describedby="catalog-import-description" aria-busy={!!busy} onKeyDown={keyboard} className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7"><div><h2 ref={heading} tabIndex={-1} id="catalog-import-title" className="text-lg font-semibold text-slate-900 outline-none">批量导入预约服务草稿</h2><p id="catalog-import-description" className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">从 Excel 粘贴或读取 CSV，为单家门店新增停用的预约项目和规格。此导入不会发布顾客价目；日常新增与上架请使用门店工作室的“服务与价格”。</p></div><button type="button" aria-label="关闭服务草稿导入" disabled={blocked && busy !== 'preview'} onClick={() => void leave()} className="store-icon-button"><X className="h-5 w-5" /></button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-[#F5F7FA] px-5 py-5 sm:px-7">
        {error && <p role="alert" className="whitespace-pre-wrap break-words rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-teal-100 bg-teal-50/60 p-4 text-sm leading-6 text-teal-800">{notice}</p>}
        {pending ? <section aria-label="待核对的服务草稿导入" className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-5"><h3 className="font-semibold text-slate-800">导入结果待核对</h3><p className="text-sm leading-6 text-slate-600">核对标识已保留，关闭后可重新打开此入口继续。查询结果只读取状态；“核对并结束”会等待服务器给出最终结果，并阻止已结束请求随后写入。</p><dl className="space-y-2 text-xs text-slate-500"><div><dt className="inline">目标门店：</dt><dd className="inline">#{pending.shopId}</dd></div><div><dt className="inline">提交时间：</dt><dd className="inline">{date(pending.createdAt)}</dd></div><div><dt className="inline">请求标识：</dt><dd className="inline break-all font-mono">{pending.requestKey}</dd></div></dl><div className="flex flex-wrap gap-3"><button type="button" disabled={blocked} onClick={() => void check(false)} className="store-secondary-button"><RefreshCw className="h-4 w-4" />{busy === 'check' ? '正在查询…' : '查询导入结果'}</button><button type="button" disabled={blocked} onClick={() => void check(true)} className="store-primary-button">{busy === 'resolve' ? '正在核对并结束…' : '核对并结束本次请求'}</button></div><p className="text-xs leading-5 text-slate-500">这里只保存账号、门店和核对标识，原表格与服务草稿内容不会写入浏览器会话存储。</p></section> : receipt ? <section aria-label="服务草稿导入收据" className="space-y-5"><div className="flex items-center gap-2 font-semibold text-teal-800"><ShieldCheck className="h-5 w-5" />服务器已确认整批保存</div><Summary values={[[ '新增项目', receipt.summary.createdServices ], [ '新增规格', receipt.summary.createdVariants ], [ '保留原项目', receipt.summary.skippedServices ]]} /><p className="text-sm leading-6 text-slate-500">门店 #{receipt.shopId}。新项目与规格均已停用，也未写入顾客价目。请进入服务与价格工作区，核对规格和顾客展示，再检查技师排班后按需启用。</p><div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><ul className="divide-y divide-slate-100">{receipt.created.map(item => <li key={item.serviceId} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-slate-800">{item.name}</p><p className="mt-1 text-xs text-slate-400">项目 #{item.serviceId} · 新增 {item.variantIds.length} 个规格 · 已停用</p><p className="mt-1 break-all text-xs text-slate-400">规格：{item.variantIds.map(id => '#' + id).join('、')}</p></div><button type="button" className="store-secondary-button" onClick={() => onConfigure(receipt.shopId, item.serviceId)}>进入服务与价格配置</button></li>)}</ul>{receipt.skipped.length > 0 && <div className="border-t border-slate-100 bg-slate-50 p-4"><h4 className="text-sm font-medium text-slate-600">已有同名同类项目已整组保留</h4><ul className="mt-2 space-y-2 text-xs text-slate-500">{receipt.skipped.map((item, index) => <li key={index}>{item.name} · {item.existingIds.map(id => '#' + id).join('、')}</li>)}</ul></div>}<p className="break-all border-t border-slate-100 px-4 py-3 text-xs text-slate-400">收据 {receipt.operationId} · {date(receipt.appliedAt)}</p></div></section> : <>
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-semibold text-slate-800">1. 选择门店并准备表格</h3>{capturedShop ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">本次固定门店 #{capturedShop}，预览时请核对门店名称。</p> : <fieldset disabled={editingBlocked} className="space-y-2"><legend className="mb-2 text-sm text-slate-600">目标门店 *</legend><ResourcePicker resource="stores" value={draft.shopId} onChange={value => updateDraft({ ...draftRef.current, shopId: String(value) })} disabled={editingBlocked} required /></fieldset>}<p className="rounded-lg bg-teal-50/60 p-4 text-xs leading-6 text-teal-900">仅录入 USD 固定价格，时长 30–120 分钟，单人、每人价。新项目和规格均停用，不会写入顾客价目。已有同名同类项目整组跳过，保留其全部原配置。</p><div className="flex flex-wrap gap-3"><button type="button" disabled={editingBlocked || !!busy} onClick={download} className="store-secondary-button"><Download className="h-4 w-4" />下载空白模板（USD）</button><input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" aria-label="选择服务草稿 CSV 或 TSV 文件" className="sr-only" disabled={editingBlocked || !!busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file); }} /><button type="button" disabled={editingBlocked || !!busy} onClick={() => fileInput.current?.click()} className="store-secondary-button"><FileSpreadsheet className="h-4 w-4" />读取 CSV / TSV 文件</button><button type="button" disabled={editingBlocked || !!busy} onClick={() => void example()} className="store-secondary-button">填入格式示例</button></div><label className="block space-y-2 text-sm text-slate-600"><span>粘贴服务草稿表 *</span><textarea rows={9} maxLength={CATALOG_MAX_BYTES} disabled={editingBlocked} value={draft.text} onChange={event => updateDraft({ ...draftRef.current, text: event.target.value })} placeholder="项目名称&#9;服务类型&#9;时长(分钟)&#9;价格(USD)&#9;说明" className="store-control font-mono text-xs leading-6" /></label><div className="space-y-1 text-xs leading-6 text-slate-500"><p>支持 Excel 制表符表格与带引号的 CSV，最多 60 KiB、100 行、50 个项目，每项目最多 10 个不同的时长。</p><p>必填表头：项目名称、服务类型、时长(分钟)、价格(USD)；说明可选。英文表头见模板。项目名称与说明将面向顾客展示，请填写英文。</p><p>服务类型填写按摩、足疗、拔罐、刮痧、头疗、其他，或对应类型代码。美元金额不含货币符号，最多两位小数，系统不会按时长推算价格。</p>{filename && <p>当前文件：{filename}</p>}</div></section>
          {currentPreview && <section aria-label="服务草稿导入预览" className="space-y-4"><div><h3 className="font-semibold text-slate-800">2. 核对项目、规格与跳过项</h3><p className="mt-2 text-sm leading-6 text-slate-500">目标门店：<strong className="font-semibold text-slate-700">{currentPreview.shop.name}</strong> · #{currentPreview.shop.id}。保存时会再次核对门店和原服务目录是否变化。</p></div><Summary values={[[ '原表格行数', currentPreview.summary.inputRows ], [ '合并重复行', currentPreview.summary.duplicateRows ], [ '项目组数', currentPreview.summary.groups ], [ '将新增项目', currentPreview.summary.newServices ], [ '将新增规格', currentPreview.summary.newVariants ], [ '整组保留已有', currentPreview.summary.skippedServices ]]} />{currentPreview.groups.map(group => <details key={group.key} open className="overflow-hidden rounded-xl border border-slate-200 bg-white"><summary className="cursor-pointer p-4 text-sm text-slate-600"><span className="font-semibold text-slate-800">{group.name}</span><span className="ml-2 text-xs text-slate-400">{CATALOG_CATEGORIES[group.category]}</span><span className={'ml-3 rounded-md px-2 py-1 text-xs ' + (group.action === 'CREATE' ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-600')}>{group.action === 'CREATE' ? '新增并停用' : '已有项目，整组跳过'}</span><span className="mt-2 block text-xs leading-5 text-slate-400">来源行：{group.sourceRows.join('、')}</span></summary><div className="space-y-3 border-t border-slate-100 p-4"><p className="text-xs leading-6 text-slate-500">{group.reason || (group.action === 'CREATE' ? '新增单人每人价项目及独立规格，全部停用。' : '保留已有项目及其规格，本次不覆盖也不追加。')}{group.existingIds.length > 0 && <span> 现有项目 {group.existingIds.map(id => '#' + id).join('、')}。</span>}</p>{group.description && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{group.description}</p>}<ul className="divide-y divide-slate-100">{group.variants.map(variant => <li key={variant.durationMin} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="text-slate-700">{variant.durationMin} 分钟<span className="ml-2 text-xs text-slate-400">顾客规格名：{variant.name}</span></span><span className="font-medium tabular-nums text-slate-800">{money(variant.priceCents)} / 人</span><span className="w-full text-xs text-slate-400">来源行：{variant.sourceRows.join('、')}{group.action === 'SKIP' ? ' · 以上为来源内容，本次不写入原项目' : ' · 导入后停用'}</span></li>)}</ul></div></details>)}{currentPreview.canApply ? <label className="flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50/50 p-4 text-sm leading-6 text-slate-600"><input type="checkbox" disabled={blocked} checked={agreed} onChange={event => setAgreed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-teal-600" /><span>已核对门店、英文名称、USD 价格及来源行，确认整批仅新增停用的项目与规格，已有同名同类项目整组保留。</span></label> : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">本批全部为已有项目，无需导入。可调整表格后重新预览。</p>}</section>}
        </>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-7"><p role="status" className="text-xs leading-5 text-slate-400">{busy === 'apply' ? '正在提交整批内容，请勿重复操作…' : busy === 'preview' ? '正在核对服务目录…' : busy === 'reading' ? '正在读取文件…' : pending ? '请先核对上次导入结果。' : receipt ? '服务草稿已保存，仍处于停用状态。' : currentPreview?.expiresAt ? '预览有效期至 ' + date(currentPreview.expiresAt) : '先预览，确认后才写入。'}</p><div className="flex flex-wrap gap-3"><button type="button" disabled={blocked && busy !== 'preview'} onClick={() => void leave()} className="store-secondary-button">{receipt ? '完成' : '关闭'}</button>{!pending && (receipt ? <button type="button" onClick={clearDraft} className="store-primary-button">继续下一批</button> : <><button type="button" disabled={blocked || !draft.shopId || !draft.text.trim()} onClick={() => void makePreview()} className="store-secondary-button"><RefreshCw className={'h-4 w-4 ' + (busy === 'preview' ? 'animate-spin' : '')} />{currentPreview ? '重新预览' : '预览草稿'}</button>{currentPreview?.canApply && <button type="button" disabled={blocked || !agreed} onClick={() => void apply()} className="store-primary-button"><Check className="h-4 w-4" />确认新增 {currentPreview.summary.newServices} 个停用项目</button>}</>)}</div></footer>
    </section>
  </div>;
}
