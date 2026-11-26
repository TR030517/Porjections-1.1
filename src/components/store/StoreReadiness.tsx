import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Info, RefreshCw } from 'lucide-react';
import type { ReadinessAction, ReadinessCheck, ShopReadiness } from '../../api/shopReadiness';
import { ReadinessLoader, bookingConfigurationLinks, readinessActionLabel, type ReadinessLoadState } from './readinessModel';

export function BookingConfigurationLinks({ data, onAction }: { data: ShopReadiness; onAction: (action: ReadinessAction) => void }) {
  const links = bookingConfigurationLinks(data);
  if (!links.length) return null;
  return <section aria-label="预约与收单待完善" className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"><h4 className="text-sm font-semibold text-amber-900">预约与门店收单待完善</h4><p className="mt-1 text-xs leading-6 text-amber-800">顾客预约需要营业时段、时区、可预约项目和足够技师；收单邮箱用于通知门店，不影响门店公开与独立登录。以下入口直接打开本店对应设置。</p><ul className="mt-3 divide-y divide-amber-200/60">{links.map(check => <li key={check.key} className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800">{check.label}</p><p className="mt-1 text-xs leading-6 text-slate-600">{check.detail}</p></div><button type="button" onClick={() => onAction(check.action)} className="store-secondary-button">{check.actionLabel}<ArrowRight className="h-3 w-3" /></button></li>)}</ul></section>;
}

function CheckRows({ checks, muted, onAction }: { checks: ReadinessCheck[]; muted?: boolean; onAction: (action: ReadinessAction) => void }) {
  return <ul className="divide-y divide-slate-100">{checks.map(check => <li key={check.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"><span className={'mt-0.5 shrink-0 ' + (muted ? 'text-slate-400' : check.state === 'PASS' ? 'text-teal-600' : check.state === 'ATTENTION' ? 'text-amber-600' : 'text-slate-400')}>{check.state === 'PASS' ? <Check className="h-4 w-4" /> : check.state === 'ATTENTION' ? <AlertCircle className="h-4 w-4" /> : <Info className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-700">{check.label}<span className={'ml-2 text-xs font-normal ' + (!muted && check.state === 'ATTENTION' ? 'text-amber-700' : 'text-slate-400')}>{check.state === 'PASS' ? '已具备' : check.state === 'INFO' ? '提示' : muted ? '准备提醒' : '需完善'}</span></p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-slate-500">{check.detail}</p>{check.action && <button type="button" onClick={() => onAction(check.action!)} className="mt-1 inline-flex items-center gap-1 py-1 text-xs font-medium text-teal-700 hover:underline">{readinessActionLabel(check.action)}<ArrowRight className="h-3 w-3" /></button>}</div></li>)}</ul>;
}
function Group({ title, checks, statusCheck, onAction }: { title: string; checks: ReadinessCheck[]; statusCheck?: ReadinessCheck; onAction: (action: ReadinessAction) => void }) {
  const findings = checks.filter(check => check.state === 'ATTENTION').length;
  return (
    <details open={findings > 0 || statusCheck?.state === 'ATTENTION'} className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
        {title}
        <span className={'ml-3 text-xs font-normal ' + (findings ? 'text-amber-700' : 'text-slate-400')}>
          {findings ? findings + ' 项需完善' : '查看 ' + checks.length + ' 项检查'}
        </span>
      </summary>
      <div className="border-t border-slate-100 p-4"><CheckRows checks={checks} onAction={onAction} /></div>
      {statusCheck && <div className="border-t border-slate-100 p-4"><CheckRows checks={[statusCheck]} onAction={onAction} /></div>}
    </details>
  );
}
export function ReadinessStatusCards({ data }: { data: ShopReadiness }) {
  const bookingFindings = data.booking.checks.some(check => check.state === 'ATTENTION') || data.summary.activeServices === 0 || data.summary.activeServicesWithFindings > 0;
  const cards = [
    { title: '顾客展示', status: data.publication.publicVisible ? '已发布' : '未公开', detail: data.publication.ready ? '发布资料已具备。' : '发布资料仍有待完善项。' },
    { title: '商家登录', status: data.access.loginReady ? '具备登录条件' : '尚未开放登录', detail: '独立账号状态单独管理，不随发布自动启用。' },
    { title: '线上预约', status: !data.booking.enabled ? '预约开关已关闭' : bookingFindings ? '开关已开启 · 配置待完善' : '开关已开启 · 配置检查通过', detail: `${data.summary.activeServices} 个启用服务；实际可约时间仍按营业时间、技师和已有占用计算。` },
  ];
  return <div className="grid gap-3 sm:grid-cols-3" aria-label="已保存的三类营业状态">{cards.map(card => <section key={card.title} className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="text-xs font-medium text-slate-500">{card.title}</h4><p className="mt-2 text-sm font-semibold text-slate-900">{card.status}</p><p className="mt-2 text-xs leading-6 text-slate-500">{card.detail}</p></section>)}</div>;
}
export default function StoreReadiness({ shopId, revision, dirty, onAction }: { shopId: string; revision: number; dirty: boolean; onAction: (action: ReadinessAction) => void }) {
  const [loader] = useState(() => new ReadinessLoader());
  const [state, setState] = useState<ReadinessLoadState>({ shopId, loading: true, data: null, error: '' });
  const [reload, setReload] = useState(0), [filter, setFilter] = useState<'all' | 'active' | 'disabled'>('all');
  useEffect(() => {
    const read = () => { void loader.read(shopId, setState); }; read(); window.addEventListener('focus', read);
    return () => { window.removeEventListener('focus', read); loader.cancel(); };
  }, [loader, shopId, revision, reload]);
  const current = state.shopId === shopId ? state : null, data = current?.data;
  const services = data?.services.filter(service => filter === 'all' || service.isActive === (filter === 'active')) ?? [];
  return <section aria-label="门店营业准备检查" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-slate-900">营业准备检查</h3><p className="mt-1 text-xs leading-6 text-slate-500">检查服务器已保存的当前配置，分别核对展示、登录、预约与门店收单；不自动发布或启用。</p></div><button type="button" disabled={!current || current.loading} onClick={() => setReload(value => value + 1)} className="store-secondary-button"><RefreshCw className={'h-4 w-4 ' + (current?.loading ? 'animate-spin' : '')} />重新检查</button></div>
    {dirty && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">当前有未保存修改。以下结果只对应服务器已保存的资料；保存后会重新检查。切换本店资料分区保留草稿，前往其他页面会先确认是否放弃。</p>}
    {!current || current.loading ? <p role="status" className="rounded-xl border border-slate-200 bg-slate-50/60 p-5 text-sm text-slate-500">正在检查已保存配置…</p> : current.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{current.error} 检查未完成，未显示旧结果。可重新检查。</p> : data && <>
      <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-4"><p className="text-sm font-semibold text-slate-800">{data.shop.name} <span className="text-xs font-normal text-slate-400">#{data.shop.id}</span></p><p className="mt-2 text-xs leading-5 text-slate-500">已保存快照 · 检查于 {new Date(data.checkedAt).toLocaleString('zh-CN', { hour12: false })}（本机时间）。以下三类状态分别管理。</p></div>
      <ReadinessStatusCards data={data} />
      <BookingConfigurationLinks data={data} onAction={onAction} />
      <Group
        title="发布资料与展示状态"
        checks={data.publication.checks.filter(check => check.key !== 'publicStatus')}
        statusCheck={data.publication.checks.find(check => check.key === 'publicStatus')}
        onAction={onAction}
      />
      <Group title="独立账号登录" checks={data.access.checks} onAction={onAction} />
      <Group title="预约设置与门店收单" checks={data.booking.checks} onAction={onAction} />
      <section aria-label="逐项目预约配置" className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="font-semibold text-slate-800">项目与接待配置</h4><p className="mt-1 text-xs leading-6 text-slate-500">启用 {data.summary.activeServices} 项 · 其中 {data.summary.activeServicesWithFindings} 项需完善 · 停用 {data.summary.disabledServices} 项</p></div><label className="text-xs text-slate-500"><span className="sr-only">筛选检查项目</span><select aria-label="筛选检查项目" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="rounded-lg border border-slate-200 bg-white px-3 py-2"><option value="all">全部项目</option><option value="active">启用项目</option><option value="disabled">停用项目</option></select></label></div>{services.map(service => <details key={service.id} open={service.isActive && service.checks.some(check => check.state === 'ATTENTION')} className="rounded-xl border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-3 text-sm leading-6 text-slate-700"><span className="font-semibold">{service.name}</span><span className={'ml-2 rounded px-2 py-1 text-xs ' + (service.isActive ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500')}>{service.isActive ? '已启用' : '已停用'}</span><span className="mt-1 block text-xs text-slate-400">项目 #{service.id} · {service.mode === 'VARIANTS' ? '独立规格价格' : '原项目价格'}{!service.isActive && ' · 仅供准备，不计入启用项目待完善数量'}</span></summary><div className="space-y-3 border-t border-slate-100 p-4"><CheckRows checks={service.checks} muted={!service.isActive} onAction={onAction} /></div></details>)}{!services.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">{data.services.length ? '此筛选下没有项目。' : '尚未建立服务项目，请从预约检查中的入口完善。'}</p>}</section>
      <Group title="顾客页面展示建议（可选）" checks={data.presentation.checks} onAction={onAction} />
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><h4 className="text-xs font-semibold text-slate-600">检查范围</h4><ul className="mt-2 space-y-1 text-xs leading-6 text-slate-500">{data.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
    </>}
  </section>;
}
