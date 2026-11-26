import React, { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { customerSiteOrigin } from '../../utils/customerSiteUrl';

/** Only the server's canonical saved path may be shared. Draft text and numeric
 * legacy IDs never become customer links in the admin UI. */
export function storePublicUrl(path: unknown, origin: string): string | null {
  if (typeof path !== 'string' || !/^\/s\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) return null;
  try { const url = new URL(path, origin); return url.origin === origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export default function StorePublicLink({ path, publicVisible, draftPending = false }: { path?: string | null; publicVisible?: boolean; draftPending?: boolean }) {
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const url = typeof window === 'undefined' ? null : storePublicUrl(path, customerSiteOrigin(window.location.origin));
  const copy = async () => {
    setNotice(''); setFailed(false);
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setNotice('已复制顾客页面链接。'); }
    catch { setFailed(true); setNotice('复制未完成，请选中地址手动复制。'); }
  };
  return <section aria-label="顾客独立页面链接" className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-800">顾客独立入口</h3><p className="mt-1 text-xs leading-5 text-slate-500">使用已保存的门店短名。更名后原链接继续指向此店。</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={!url} onClick={() => void copy()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:text-teal-700 disabled:opacity-40"><Copy className="h-3.5 w-3.5" />复制链接</button>{url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:text-teal-700"><ExternalLink className="h-3.5 w-3.5" />打开顾客页</a>}</div></div>
    {url ? <input aria-label="已保存的完整顾客链接" readOnly value={url} onFocus={event => event.currentTarget.select()} className="mt-3 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600" /> : <p className="mt-3 text-xs text-slate-500">保存有效短名后显示真实链接。</p>}
    {url && draftPending && <p role="status" className="mt-2 text-xs leading-5 text-amber-700">当前有未保存资料。此入口打开服务器已保存的顾客页面，本次草稿仅显示在工作室预览中；打开顾客页会保留当前草稿。</p>}
    {url && publicVisible !== true && <p className="mt-2 text-xs leading-5 text-amber-700">门店当前未对外开放，链接将显示门店不可用；保存资料不等于通过发布审核。</p>}
    {notice && <p role={failed ? 'alert' : 'status'} className={'mt-2 text-xs leading-5 ' + (failed ? 'text-red-600' : 'text-teal-700')}>{notice}</p>}
  </section>;
}
