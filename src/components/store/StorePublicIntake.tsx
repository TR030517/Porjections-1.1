import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, FileJson, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import { applyPublicIntake, parseIntakeFile, previewPublicIntake, publicIntakeResult, resolvePublicIntake, PUBLIC_INTAKE_MAX_BYTES, type IntakePackage, type IntakePreview, type IntakeReceipt, type IntakeResult, type IntakeShopPreview } from '../../api/publicIntake';
import { useConfirmation } from '../Confirmation';
import { clearPendingIntake, createIntakeTemplate, intakeFieldValue, readPendingIntake, savePendingIntake, type PendingIntake } from './publicIntakeModel';
import type { StoreItem } from './types';

const fieldLabels = { description: '门店简介', businessHours: '营业时间' };
const stateLabels = { FILL: '补空', UNCHANGED: '相同，无需改动', KEEP_EXISTING: '保留已有内容' };
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后核对。';
function localPending(actorId: string) {
  try { return readPendingIntake(window.sessionStorage, actorId); } catch { return null; }
}
function Summary({ values }: { values: Array<[string, number]> }) {
  return <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{values.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-semibold text-slate-800">{value}</dd></div>)}</dl>;
}

function IntakeShopEvidence({ shop }: { shop: IntakeShopPreview }) {
  const { sourceUrls, currentTarget } = shop;
  return (
    <dl className="grid gap-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="mb-1 text-xs text-slate-500">1.0 来源链接</dt>
        <dd>
          {sourceUrls?.length ? (
            <ul className="space-y-1">
              {sourceUrls.map((url, index) => (
                <li key={index}>
                  <a className="break-all text-teal-700 underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                </li>
              ))}
            </ul>
          ) : '没有可核对的来源链接'}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="mb-1 text-xs text-slate-500">当前 2.0 目标门店</dt>
        <dd className="break-words">
          {currentTarget ? (
            <>
              <p className="font-medium">{currentTarget.name} #{shop.targetShopId}</p>
              <p>短名 {currentTarget.shortName || '未填写'}</p>
              <p>地址 {currentTarget.address || '未填写'}</p>
            </>
          ) : currentTarget === null ? '未找到可核对的目标门店' : <p>{shop.name || '待填写'} #{shop.targetShopId || '待填写'}</p>}
        </dd>
      </div>
    </dl>
  );
}

export default function StorePublicIntake({ actorId, templateShops, templateScope, onClose, onImported, onPendingChange }: {
  actorId: string;
  templateShops: Pick<StoreItem, 'id' | 'name' | 'shortName'>[];
  templateScope: string;
  onClose: () => void;
  onImported: () => void;
  onPendingChange: () => void;
}) {
  const confirm = useConfirmation();
  const [template] = useState(() => ({ shops: templateShops.slice(0, 20), scope: templateScope }));
  const [input, setInput] = useState<IntakePackage | null>(null);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [receipt, setReceipt] = useState<IntakeReceipt | null>(null);
  const [pending, setPending] = useState<PendingIntake | null>(() => localPending(actorId));
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [closing, setClosing] = useState(false);
  const alive = useRef(true), locked = useRef(false), reading = useRef(0), previewController = useRef<AbortController | null>(null);
  const title = useRef<HTMLHeadingElement>(null), dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    title.current?.focus();
    return () => { alive.current = false; reading.current += 1; previewController.current?.abort(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if ((!input || receipt) && !busy) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [input, receipt, busy]);
  const leave = async () => {
    if (locked.current || closing) return;
    setClosing(true);
    try {
      if (input && !pending && !receipt && !await confirm({ title: '关闭资料导入', message: '关闭会放弃本次未提交的文件与预览。已保存的门店资料保留。', confirmLabel: '放弃草稿并关闭' })) return;
      if (alive.current) onClose();
    } finally { if (alive.current) setClosing(false); }
  };
  const upload = async (file: File) => {
    if (locked.current || pending || receipt) return;
    locked.current = true;
    const version = ++reading.current;
    setBusy('reading'); setError(''); setNotice(''); setPreview(null); setAgreed(false); setInput(null); setFilename('');
    try {
      if (file.size > PUBLIC_INTAKE_MAX_BYTES) throw new Error('文件超过60 KiB，请分成最多20家门店的小批次。');
      const data = parseIntakeFile(await file.text());
      if (!alive.current || version !== reading.current) return;
      setInput(data); setFilename(file.name);
    } catch (err) { if (alive.current && version === reading.current) setError(errorText(err)); }
    finally { locked.current = false; if (alive.current && version === reading.current) setBusy(''); }
  };
  const makePreview = async () => {
    if (locked.current || !input || pending || receipt) return;
    locked.current = true; setBusy('preview'); setError(''); setNotice(''); setPreview(null); setAgreed(false);
    const controller = new AbortController(); previewController.current = controller;
    try { const result = await previewPublicIntake(input, controller.signal); if (alive.current && !controller.signal.aborted) setPreview(result); }
    catch (err) { if (alive.current && !controller.signal.aborted) setError(errorText(err)); }
    finally { locked.current = false; if (alive.current) setBusy(''); }
  };
  const finishPending = (expected: PendingIntake, result: Exclude<IntakeResult, { found: false }>) => {
    // Clearing is conditional: a late response cannot remove a newer request marker.
    try { clearPendingIntake(window.sessionStorage, expected); } catch { /* Terminal response remains authoritative. */ }
    if (!alive.current) return;
    setPending(null); setPreview(null); setAgreed(false); setError(''); onPendingChange();
    if (result.state === 'APPLIED') { setReceipt(result.receipt); setNotice('已从服务器核对导入结果。'); onImported(); }
    else setNotice('服务器已确认本次未导入，并已结束该请求。请重新预览后再确认导入。');
  };
  const apply = async () => {
    if (locked.current || !input || !preview?.canApply || !agreed || pending || receipt) return;
    if (!preview.expiresAt || Date.parse(preview.expiresAt) <= Date.now()) { setError('预览已过期，请重新生成预览。'); setPreview(null); setAgreed(false); return; }
    locked.current = true; setBusy('apply'); setError(''); setNotice('');
    const marker: PendingIntake = { actorId, requestKey: `public-intake:${crypto.randomUUID()}`, packageDigest: preview.packageDigest, createdAt: new Date().toISOString() };
    try { savePendingIntake(window.sessionStorage, marker); }
    catch { setError('浏览器无法保留结果核对标识，本次尚未提交。请允许此页面使用会话存储后再试。'); locked.current = false; setBusy(''); return; }
    setPending(marker); onPendingChange();
    try {
      const result = await applyPublicIntake(input, preview, marker.requestKey);
      finishPending(marker, { found: true, state: 'APPLIED', receipt: result });
    } catch (err) {
      // Every failed response may be ambiguous at a proxy or after a session change.
      // Only a terminal server result may release this key for a fresh preview.
      if (alive.current) { setError(errorText(err)); setNotice('导入结果尚待核对。请使用下方核对按钮，系统不会自动再次提交。'); }
    } finally { locked.current = false; if (alive.current) setBusy(''); }
  };
  const check = async (endRequest: boolean) => {
    if (locked.current || !pending) return;
    locked.current = true; setBusy(endRequest ? 'resolve' : 'check'); setError(''); setNotice('');
    try {
      const result = endRequest ? await resolvePublicIntake(pending) : await publicIntakeResult(pending);
      if (!alive.current) return;
      if (result.found === true) finishPending(pending, result);
      else setNotice('暂未找到最终收据，请勿据此判断失败。可稍后再次查询，或“核对并结束本次请求”。');
    } catch (err) { if (alive.current) setError(errorText(err)); }
    finally { locked.current = false; if (alive.current) setBusy(''); }
  };
  const downloadTemplate = () => {
    if (!template.shops.length || locked.current) return;
    const content = createIntakeTemplate(template.shops);
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `massajoy1-public-template-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const clearDraft = () => { if (locked.current || pending) return; setInput(null); setFilename(''); setPreview(null); setReceipt(null); setAgreed(false); setError(''); setNotice(''); };
  const blocked = !!busy || closing;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/35 p-2 sm:p-5">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="store-intake-title" aria-describedby="store-intake-description" aria-busy={!!busy} className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); void leave(); }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),summary,[href],[tabindex="0"]') ?? [])].filter(item => item.getClientRects().length > 0);
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === title.current)) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }
    }}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5"><div><h2 id="store-intake-title" tabIndex={-1} ref={title} className="text-lg font-semibold text-slate-900">导入门店资料</h2><p id="store-intake-description" className="mt-1 text-sm leading-6 text-slate-500">从1.0资料包补全现有门店的简介与营业时间，先预览，再确认。</p></div><button type="button" disabled={blocked} onClick={() => void leave()} className="store-icon-button shrink-0" aria-label="关闭资料导入"><X className="h-5 w-5" /></button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/60 px-5 py-5 sm:px-7">
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm leading-6 text-teal-800">{notice}</p>}
        {pending ? <section className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-5" aria-label="待核对的导入请求"><h3 className="font-semibold text-slate-800">导入结果待核对</h3><p className="text-sm leading-6 text-slate-600">页面保留了本次请求标识。查询只读取结果；“核对并结束”会等待服务器确认，若尚未导入则关闭该请求，阻止延迟请求随后写入。</p><dl className="space-y-2 text-xs text-slate-500"><div><dt className="inline">请求标识：</dt><dd className="inline break-all font-mono text-slate-700">{pending.requestKey}</dd></div><div><dt className="inline">提交时间：</dt><dd className="inline">{new Date(pending.createdAt).toLocaleString('zh-CN', { hour12: false })}</dd></div></dl><div className="flex flex-wrap gap-3"><button type="button" disabled={blocked} onClick={() => void check(false)} className="store-secondary-button"><RefreshCw className={'h-4 w-4 '+(busy === 'check' ? 'animate-spin' : '')} />{busy === 'check' ? '正在查询…' : '查询结果'}</button><button type="button" disabled={blocked} onClick={() => void check(true)} className="store-primary-button">{busy === 'resolve' ? '正在核对并结束…' : '核对并结束本次请求'}</button></div><p className="text-xs leading-5 text-slate-500">关闭后可在同一浏览器标签页重新进入“导入资料”继续核对。原文件和业务内容不会存入浏览器会话存储。</p></section> : receipt ? <section className="space-y-4" aria-label="导入完成"><div className="flex items-center gap-2 font-semibold text-teal-800"><ShieldCheck className="h-5 w-5" />服务器已确认导入</div><Summary values={[[ '本批门店', receipt.summary.shops ], [ '已补全门店', receipt.summary.changedShops ], [ '已补空字段', receipt.summary.changedFields ], [ '无需改动门店', receipt.summary.unchangedShops ]]} /><div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><ul className="space-y-2">{receipt.shops.map(shop => <li key={shop.targetShopId} className="flex flex-wrap items-center justify-between gap-2"><span>2.0门店 #{shop.targetShopId} <span className="text-xs text-slate-400">← 1.0 #{shop.sourceId}</span></span><span className="text-teal-700">{shop.changedFields.length ? shop.changedFields.map(field => fieldLabels[field]).join('、')+'已补全' : '保留已有资料'}</span></li>)}</ul><p className="mt-4 break-all border-t border-slate-100 pt-3 text-xs text-slate-400">收据 {receipt.operationId} · {new Date(receipt.appliedAt).toLocaleString('zh-CN', { hour12: false })}</p></div><p className="text-xs leading-6 text-slate-500">导入不代表门店已发布。登录账号、地址、电话、时区、服务与价格仍需按真实资料完善。</p></section> : <>
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-800">1. 选择资料包</h3><p className="mt-2 text-sm leading-6 text-slate-500">JSON文件，每批1–20家门店，最多60 KiB。匹配须使用明确的1.0来源ID和2.0门店ID。</p></div><button type="button" disabled={blocked || !template.shops.length} onClick={downloadTemplate} className="store-secondary-button"><Download className="h-4 w-4" />下载匹配模板</button></div><p className="text-xs leading-5 text-slate-400">模板范围：{template.scope}，最多前20家（本次{template.shops.length}家）。只预填2.0名称、短名和ID。</p><label className={'flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-teal-200 bg-teal-50/40 p-4 '+(blocked ? 'pointer-events-none opacity-50' : 'hover:bg-teal-50')}><FileJson className="h-6 w-6 shrink-0 text-teal-700" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-700">{filename || '选择JSON文件'}</span><span className="mt-1 block text-xs text-slate-500">{busy === 'reading' ? '正在读取…' : filename ? '点击更换文件，已选文件仅保留在本次页面中' : '文件将在预览时发送到管理服务进行校验'}</span></span><Upload className="h-4 w-4 text-teal-700" /><input type="file" accept=".json,application/json" disabled={blocked} className="sr-only" aria-label="选择门店公开资料JSON文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} /></label><details className="text-xs leading-6 text-slate-500"><summary className="cursor-pointer text-teal-700">如何填写模板</summary><p className="mt-2">保留要导入的门店行，核对targetShopId与match，补入真实sourceId、来源页面sourceUrls，以及简介description。capturedAt应为实际采集的UTC时间。空模板不能直接提交。</p><p className="mt-1">如需营业时间，添加businessHours并完整提供mon、tue、wed、thu、fri、sat、sun；每天使用[{`{"start":"09:00","end":"18:00"}`}]，休息日使用[]，每天最多四段。无法确认的时间不要填写。</p><p className="mt-1">本次只补空简介和营业时间，不覆盖已有值。地址、电话、时区、账号、发布状态和价目不会由此修改；rawCatalog仅供核对，本次不导入价格或服务。</p></details></section>
          {preview && <section className="space-y-4" aria-label="导入预览"><div><h3 className="font-semibold text-slate-800">2. 核对匹配与逐项变化</h3><p className="mt-2 text-sm leading-6 text-slate-500">{preview.summary.invalidShops ? '本批存在错误，须修正文件后重新预览，整批暂不可导入。' : preview.summary.fillFields ? '只有标为“补空”的字段会写入，提交时会再次核对门店资料是否变化。' : '本批没有可补空的字段，已有资料将保留，无需提交。'}</p></div><Summary values={[[ '本批门店', preview.summary.shops ], [ '待补空字段', preview.summary.fillFields ], [ '保留已有字段', preview.summary.keptFields ], [ '存在错误门店', preview.summary.invalidShops ]]} />{preview.summary.rawCatalogItems > 0 && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-slate-500">原始价目 {preview.summary.rawCatalogItems} 项：仅供核对，本次不导入价格或服务，不推断币种与计价方式。</p>}{preview.shops.map((shop, index) => <details key={`${index}:${shop.targetShopId}`} open className="overflow-hidden rounded-xl border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-4 text-sm text-slate-600"><span className="font-semibold text-slate-800">{shop.name || `第${index+1}行`}</span><span className="ml-2 text-xs text-slate-400">2.0 #{shop.targetShopId || '待填写'} ← 1.0 #{shop.sourceId || '待填写'}</span><span className={'ml-3 rounded-full px-2 py-1 text-xs '+(shop.status === 'INVALID' ? 'bg-red-50 text-red-700' : shop.status === 'READY' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500')}>{shop.status === 'INVALID' ? '请修正' : shop.status === 'READY' ? '可补全' : '无需改动'}</span><span className="mt-1 block pl-4 text-xs text-slate-400">资料包中的目标短名 {shop.shortName || '待填写'}</span></summary><div className="space-y-4 border-t border-slate-100 p-4"><IntakeShopEvidence shop={shop} />{shop.issues.length > 0 && <ul className="space-y-1 text-xs leading-6 text-slate-600">{shop.issues.map((issue, issueIndex) => <li key={issueIndex} className={shop.status === 'INVALID' ? 'text-red-700' : ''}>{issue.message}</li>)}</ul>}{shop.fields.map(item => <div key={item.field}><div className="mb-2 flex items-center justify-between gap-3 text-sm"><h4 className="font-medium text-slate-700">{fieldLabels[item.field]}</h4><span className={'text-xs '+(item.state === 'FILL' ? 'text-teal-700' : 'text-slate-500')}>{stateLabels[item.state]}</span></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3"><p className="mb-2 text-xs text-slate-400">当前2.0内容</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{intakeFieldValue(item.current)}</p></div><div className={'rounded-lg p-3 '+(item.state === 'FILL' ? 'bg-teal-50/60' : 'bg-slate-50')}><p className="mb-2 text-xs text-slate-400">1.0来源内容{item.state === 'KEEP_EXISTING' ? '（不覆盖）' : ''}</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{intakeFieldValue(item.incoming)}</p></div></div></div>)}{shop.missing.length > 0 && <p className="border-t border-slate-100 pt-3 text-xs leading-6 text-slate-500">导入后仍需完善：{shop.missing.map(item => item.label).join('、')}。</p>}</div></details>)}{preview.canApply && <label className="flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50/40 p-4 text-sm leading-6 text-slate-600"><input type="checkbox" checked={agreed} disabled={blocked} onChange={event => setAgreed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-teal-600" /><span>已核对匹配门店与补空内容，确认本批仅补全简介和营业时间的空值。</span></label>}</section>}
        </>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-7"><p role="status" className="text-xs text-slate-400">{busy === 'apply' ? '正在提交，请勿关闭页面或重复操作…' : busy === 'preview' ? '正在向服务器核对资料…' : pending ? '请先核对本次结果，再开始新的导入。' : receipt ? '门店列表已刷新。' : preview?.expiresAt ? '本次预览有效期至 '+new Date(preview.expiresAt).toLocaleTimeString('zh-CN', { hour12: false }) : '先预览，确认后才写入。'}</p><div className="flex flex-wrap gap-3"><button type="button" disabled={blocked} onClick={() => void leave()} className="store-secondary-button">{receipt ? '完成' : '关闭'}</button>{!pending && (receipt ? <button type="button" onClick={clearDraft} className="store-primary-button">继续导入下一批</button> : <><button type="button" disabled={blocked || !input} onClick={() => void makePreview()} className="store-secondary-button"><RefreshCw className={'h-4 w-4 '+(busy === 'preview' ? 'animate-spin' : '')} />{preview ? '重新预览' : '预览资料'}</button>{preview?.canApply && <button type="button" disabled={blocked || !agreed} onClick={() => void apply()} className="store-primary-button"><Check className="h-4 w-4" />确认补空 {preview.summary.fillFields} 项</button>}</>)}</div></footer>
    </section>
  </div>;
}
