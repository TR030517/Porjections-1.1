import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, Image as ImageIcon, ImageOff, Plus, Trash2, X } from 'lucide-react';
import { MANAGED_MEDIA_PATH, ShopMediaUploadRecoveryError, type UploadedShopMedia } from '../../utils/mediaDraft';

export const STORE_MEDIA_MAX_IMAGES = 20;
export const STORE_MEDIA_MAX_URL_LENGTH = 500;

export interface StoreMediaEditorProps {
  kind: 'logo' | 'banner' | 'gallery';
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onUpload?: (file:File)=>Promise<string | UploadedShopMedia>;
  previewUrls?: ReadonlyMap<string, string>;
  resourceLabel?: string;
}

/** Match Studio's saved media contract; this does not fetch or verify an image. */
export function validateStoreMediaUrl(value: string): string | null {
  const input = value.trim();
  if (input.length > STORE_MEDIA_MAX_URL_LENGTH) return `图片地址不能超过 ${STORE_MEDIA_MAX_URL_LENGTH} 个字符。`;
  if (MANAGED_MEDIA_PATH.test(input)) return null;
  if (!/^https:\/\//i.test(input) || /[\s\\\u0000-\u001f\u007f]/u.test(input)) return '请使用有效的 HTTPS 图片地址。';
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return null;
  } catch { /* Keep malformed links out of image sources. */ }
  return '请使用有效的 HTTPS 图片地址，且地址不能包含用户名或密码。';
}

export function parseStoreMediaUrls(value: string): string[] {
  return value.split(/\r?\n/u).map(url => url.trim()).filter(Boolean);
}

export function dedupeStoreMediaUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  return urls.map(url => url.trim()).filter(url => {
    if (!url) return false;
    let key = url;
    try { key = new URL(url).href; } catch { /* Preserve an existing invalid link so it can be removed. */ }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function addStoreMediaUrls(value: string, additions: string): { value: string; error: string | null } {
  const incoming = parseStoreMediaUrls(additions);
  if (!incoming.length) return { value, error: '请先粘贴图片地址，每行一条。' };
  for (let index = 0; index < incoming.length; index += 1) {
    const error = validateStoreMediaUrl(incoming[index]);
    if (error) return { value, error: `第 ${index + 1} 条：${error}` };
  }
  const urls = dedupeStoreMediaUrls([...parseStoreMediaUrls(value), ...incoming]);
  if (urls.length > STORE_MEDIA_MAX_IMAGES) return { value, error: `图库最多 ${STORE_MEDIA_MAX_IMAGES} 张图片，请减少地址后再添加。` };
  return { value: urls.join('\n'), error: null };
}

export function moveStoreMediaUrl(value: string, index: number, direction: -1 | 1): string {
  const urls = dedupeStoreMediaUrls(parseStoreMediaUrls(value));
  const nextIndex = index + direction;
  if (!Number.isInteger(index) || index < 0 || index >= urls.length || nextIndex < 0 || nextIndex >= urls.length) return value;
  [urls[index], urls[nextIndex]] = [urls[nextIndex], urls[index]];
  return urls.join('\n');
}

/** A drop may only reorder the exact draft in which its gesture began. */
export function dropStoreMediaUrl(value: string, snapshot: string, source: string, target: string): string | null {
  if (value !== snapshot) return null;
  const urls = dedupeStoreMediaUrls(parseStoreMediaUrls(value));
  const from = urls.indexOf(source), to = urls.indexOf(target);
  if (from < 0 || to < 0 || from === to) return null;
  urls.splice(to, 0, urls.splice(from, 1)[0]);
  return urls.join('\n');
}

function MediaPreview({ url, source, kind, label }: { url: string; source: string; kind: StoreMediaEditorProps['kind']; label: string }) {
  const [failed, setFailed] = useState(false);
  const valid = !!url && !validateStoreMediaUrl(url);
  const shape = kind === 'logo' ? 'h-28 w-28 shrink-0' : kind === 'banner' ? 'aspect-[16/6] w-full' : 'aspect-[4/3] w-full';
  return <div className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 ${shape}`}>
    {valid && !failed ? <img src={source} alt={label} draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`h-full w-full ${kind === 'logo' ? 'object-contain p-2' : 'object-cover'}`} /> : <div className="flex flex-col items-center gap-1 px-2 py-1 text-center text-slate-500">
      {url ? <ImageOff className="h-5 w-5" aria-hidden="true" /> : <ImageIcon className="h-5 w-5" aria-hidden="true" />}
      <span className="text-xs leading-5">{!url ? '尚未设置图片' : !valid ? '地址待修正' : '图片暂时无法加载'}</span>
      {valid && failed && <button type="button" className={buttonClass} aria-label={`重新加载${label}`}
        onPointerDown={event => event.stopPropagation()} onClick={() => setFailed(false)}>重新加载</button>}
    </div>}
  </div>;
}

const inputClass = 'block w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#48a1a1] focus:ring-2 focus:ring-[#48a1a1]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';
const buttonClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-[#48a1a1]/40 hover:bg-[#f0f9f9] hover:text-[#287c7c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#48a1a1]/40 disabled:cursor-not-allowed disabled:opacity-40';

export default function StoreMediaEditor({ kind, value, onChange, disabled = false, onUpload, previewUrls, resourceLabel = '门店' }: StoreMediaEditorProps) {
  const id = useId();
  const linkInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading,setUploading]=useState(false),[uploadError,setUploadError]=useState('');
  const [restartUpload, setRestartUpload] = useState(false);
  const selected=useRef<{file:File;value:string;kind:StoreMediaEditorProps['kind'];revision:number}|null>(null),fileInput=useRef<HTMLInputElement>(null),alive=useRef(true);
  const uploadLocked=useRef(false),draftRevision=useRef(0),previousDraft=useRef({value,kind});
  if(previousDraft.current.value!==value||previousDraft.current.kind!==kind){previousDraft.current={value,kind};draftRevision.current++;selected.current=null;}
  const galleryList = useRef<HTMLOListElement>(null);
  const live = useRef({ value, kind, disabled: disabled || uploading, onChange });
  live.current = { value, kind, disabled: disabled || uploading, onChange };
  const changeValue=(next:string)=>{draftRevision.current++;selected.current=null;setUploadError('');setNotice('');live.current.onChange(next);};
  const preview = (url: string, label: string) => {
    const source = previewUrls?.get(url.trim()) ?? url.trim();
    return <MediaPreview key={`${kind}:${url.trim()}:${source}`} url={url} source={source} kind={kind} label={label} />;
  };
  const gesture = useRef<{ pointerId: number; source: string; snapshot: string; startX: number; startY: number; active: boolean; handle: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<{ source: string; target: string | null } | null>(null);
  const cancelDrag = () => {
    const previous = gesture.current;
    gesture.current = null; setDrag(null);
    if (previous?.handle.hasPointerCapture(previous.pointerId)) previous.handle.releasePointerCapture(previous.pointerId);
  };
  useEffect(() => { cancelDrag(); }, [value, kind, disabled, uploading]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !gesture.current?.active) return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    };
    const blur = () => cancelDrag();
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    return () => {
      gesture.current = null;
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const dropTarget = (x: number, y: number): string | null => {
    const card = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-store-gallery-card]');
    return card && galleryList.current?.contains(card) ? card.dataset.storeGalleryCard ?? null : null;
  };
  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, source: string) => {
    if (live.current.disabled || gesture.current || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, source, snapshot: live.current.value, startX: event.clientX, startY: event.clientY, active: false, handle: event.currentTarget };
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (live.current.disabled || current.snapshot !== live.current.value) { cancelDrag(); return; }
    if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
    current.active = true; event.preventDefault();
    const target = dropTarget(event.clientX, event.clientY);
    setDrag(previous => previous?.source === current.source && previous.target === target ? previous : { source: current.source, target });
  };
  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const target = dropTarget(event.clientX, event.clientY);
    const next = current.active && alive.current && !live.current.disabled && target
      ? dropStoreMediaUrl(live.current.value, current.snapshot, current.source, target) : null;
    cancelDrag();
    if (next !== null) { changeValue(next); setNotice('已调整图片顺序，保存资料后生效。'); }
  };
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const upload=async(file:File)=>{if(!alive.current||!onUpload||live.current.disabled||uploadLocked.current)return;
    const attempt={file,value:live.current.value,kind:live.current.kind,revision:draftRevision.current};selected.current=attempt;uploadLocked.current=true;setUploading(true);setUploadError('');setRestartUpload(false);setNotice('');
    const current=()=>alive.current&&selected.current===attempt&&attempt.revision===draftRevision.current&&attempt.value===live.current.value&&attempt.kind===live.current.kind;
    try {
      const result = await onUpload(file);
      if (!current()) return;
      const { url, replacesUrl } = typeof result === 'string' ? { url: result } : result;
      const gallery = parseStoreMediaUrls(live.current.value).map(value => value === replacesUrl ? url : value);
      const next = attempt.kind === 'gallery' ? addStoreMediaUrls(gallery.join('\n'), url) : { value: url, error: null };
      if (next.error) throw new Error(next.error);
      changeValue(next.value);
      setNotice(`文件已上传并加入草稿；点击保存后才更新${resourceLabel}。`);
    } catch (error) {
      if (current()) {
        setRestartUpload(error instanceof ShopMediaUploadRecoveryError && error.restart);
        setUploadError(error instanceof Error ? error.message : '上传失败，原有草稿保留。');
      }
    }
    finally{uploadLocked.current=false;if(alive.current)setUploading(false);}
  };
  const retryCurrent=()=>{const attempt=selected.current;return !!attempt&&attempt.revision===draftRevision.current&&attempt.value===live.current.value&&attempt.kind===live.current.kind;};
  const currentUploadError=retryCurrent()?uploadError:'';
  const fileControls=<div className="space-y-2"><div className="flex flex-wrap items-center gap-3"><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`上传${kind==='logo'?'Logo':kind==='banner'?'封面':'图库'}图片`} className="sr-only" disabled={disabled||uploading||!onUpload} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(file);}} /><button type="button" className={buttonClass} disabled={disabled||uploading||!onUpload||(kind==='gallery'&&parseStoreMediaUrls(value).length>=STORE_MEDIA_MAX_IMAGES)} onClick={()=>fileInput.current?.click()}>{uploading?'正在上传并验证…':'上传真实图片文件'}</button>{currentUploadError&&<button type="button" className={buttonClass} disabled={disabled||uploading} onClick={()=>{const attempt=selected.current;if(attempt&&retryCurrent())void upload(attempt.file);}}>{restartUpload ? '重新上传原文件' : '原样重试'}</button>}</div><p className="text-xs leading-5 text-slate-500">{onUpload?'JPEG / PNG / WebP，最多 8 MiB、8192 像素边长、2500 万像素。文件先暂存，保存资料后绑定；放弃编辑会清理未保存文件。':'请先创建门店，再上传归属本店的文件。现有 HTTPS 图片链接仍可编辑。'}</p>{currentUploadError&&<p role="alert" className="text-xs leading-5 text-red-600">{currentUploadError} 原有图片和草稿保留。</p>}</div>;

  if (kind !== 'gallery') {
    const label = kind === 'logo' ? 'Logo 图片' : '横幅图片';
    const error = value.trim() ? validateStoreMediaUrl(value) : null;
    return <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className={`flex min-w-0 gap-4 ${kind === 'logo' ? 'flex-col sm:flex-row sm:items-center' : 'flex-col'}`}>
        {preview(value, label)}
        <div className="min-w-0 flex-1 space-y-2">
          <label htmlFor={`${id}-url`} className="block text-[13px] font-medium text-slate-700">{label}地址</label>
          <input ref={node => { linkInput.current = node; node?.setCustomValidity(error ?? ''); }} id={`${id}-url`} type="text" inputMode="url" value={value} disabled={disabled} maxLength={STORE_MEDIA_MAX_URL_LENGTH} onChange={event => changeValue(event.target.value)} className={inputClass} placeholder="https://example.com/image.jpg" aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} />
          <p id={`${id}-help`} className="text-xs leading-5 text-slate-500">可编辑 HTTPS 图片链接或上传后返回的受管地址；留空表示清除已保存图片。</p>
          {resourceLabel === '门店' && <p className="text-xs leading-5 text-slate-500">{kind === 'logo'
            ? 'Logo 会完整显示，建议使用方形图片。'
            : '封面会从中心裁切以适应横向版面，建议把重要内容放在图片中间。'}</p>}
          {error && <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={disabled} onClick={() => { linkInput.current?.focus(); linkInput.current?.select(); }} className={buttonClass}>{value.trim() ? '替换链接' : '填写链接'}</button>
            <button type="button" disabled={disabled || !value} onClick={() => { changeValue(''); setNotice(''); }} className={buttonClass}><X className="h-3.5 w-3.5" aria-hidden="true" />清除图片</button>
          </div>
          {fileControls}
          {notice&&<p role="status" className="text-xs text-[#287c7c]">{notice}</p>}
        </div>
      </div>
    </div>;
  }

  const urls = dedupeStoreMediaUrls(parseStoreMediaUrls(value));
  const invalidIndex = urls.findIndex(url => !!validateStoreMediaUrl(url));
  const galleryError = urls.length > STORE_MEDIA_MAX_IMAGES ? `图库最多 ${STORE_MEDIA_MAX_IMAGES} 张，请删除超出部分。` : invalidIndex >= 0 ? `第 ${invalidIndex + 1} 张：${validateStoreMediaUrl(urls[invalidIndex])}` : '';
  const addImages = () => {
    if (disabled) return;
    const result = addStoreMediaUrls(value, draft);
    setAddError(result.error ?? ''); setNotice('');
    if (result.error) return;
    const added = parseStoreMediaUrls(result.value).length - urls.length;
    changeValue(result.value); setDraft('');
    setNotice(added > 0 ? `已添加 ${added} 张图片，重复地址已自动合并。` : '这些图片已在图库中，未重复添加。');
  };

  return <div className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-[13px] font-medium text-slate-700">门店图库</h4>
      <span className="text-xs tabular-nums text-slate-500">{urls.length} / {STORE_MEDIA_MAX_IMAGES} 张</span>
    </div>
    <p className="text-xs leading-5 text-slate-500">相册图片会从中心裁切以适应展示区域。可拖动图片或用前移、后移按钮排序，保存资料后生效。</p>
    {fileControls}
    {galleryError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">{galleryError}</p>}
    {urls.length ? <ol ref={galleryList} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="图库图片及显示顺序">
      {urls.map((url, index) => <li key={url} data-store-gallery-card={url} className={`min-w-0 space-y-3 rounded-xl border bg-slate-50/60 p-3 transition ${drag?.target === url && drag.source !== url ? 'border-teal-500 ring-2 ring-teal-300/60' : 'border-slate-200'} ${drag?.source === url ? 'opacity-50' : ''}`}>
        <div className={`relative select-none ${disabled || uploading ? '' : 'cursor-grab active:cursor-grabbing'}`} style={{ touchAction: disabled || uploading ? 'auto' : 'none' }} onPointerDown={event => beginDrag(event, url)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={event => { if (gesture.current?.pointerId === event.pointerId) cancelDrag(); }} onLostPointerCapture={event => { if (gesture.current?.pointerId === event.pointerId) cancelDrag(); }}>
          {preview(url, `图库第 ${index + 1} 张图片`)}
          {urls.length > 1 && <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-[11px] text-slate-600 shadow-sm"><GripVertical className="h-3.5 w-3.5" />拖动排序</span>}
        </div>
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium tabular-nums text-slate-600">第 {index + 1} 张</span><button type="button" disabled={disabled} aria-label={`删除第 ${index + 1} 张图片`} onClick={() => { changeValue(urls.filter((_, itemIndex) => itemIndex !== index).join('\n')); setNotice(''); }} className={`${buttonClass} !border-transparent !bg-transparent !px-2 hover:!bg-red-50 hover:!text-red-600`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />删除</button></div>
        <p className="break-all text-xs leading-5 text-slate-500" title={url}>{url}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled || index === 0} aria-label={`向前移动第 ${index + 1} 张图片`} onClick={() => { changeValue(moveStoreMediaUrl(value, index, -1)); setNotice(''); }} className={buttonClass}><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />前移</button>
          <button type="button" disabled={disabled || index === urls.length - 1} aria-label={`向后移动第 ${index + 1} 张图片`} onClick={() => { changeValue(moveStoreMediaUrl(value, index, 1)); setNotice(''); }} className={buttonClass}>后移<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </div>
      </li>)}
    </ol> : <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500"><ImageIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" /><span>图库为空，粘贴图片地址即可添加。</span></div>}
    <div className="space-y-2 border-t border-slate-100 pt-4">
      <label htmlFor={`${id}-add`} className="block text-[13px] font-medium text-slate-700">添加图片地址</label>
      <textarea id={`${id}-add`} rows={3} value={draft} disabled={disabled} onChange={event => { setDraft(event.target.value); setAddError(''); setNotice(''); }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); addImages(); } }} className={inputClass} placeholder="每行粘贴一条 HTTPS 图片地址" aria-invalid={!!addError} aria-describedby={`${id}-help${addError ? ` ${id}-error` : ''}`} />
      <p id={`${id}-help`} className="text-xs leading-5 text-slate-500">每个地址最多 {STORE_MEDIA_MAX_URL_LENGTH} 个字符，图库最多 {STORE_MEDIA_MAX_IMAGES} 张。粘贴后点击添加，或按 Ctrl / ⌘ + Enter。</p>
      {addError && <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-red-600">{addError}</p>}
      <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={disabled || !draft.trim()} onClick={addImages} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#48a1a1] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#3d8b8b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#48a1a1]/40 disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4" aria-hidden="true" />添加到图库</button>{notice && <p role="status" className="text-xs leading-5 text-[#287c7c]">{notice}</p>}</div>
    </div>
  </div>;
}
