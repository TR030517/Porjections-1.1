import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, RefreshCw, ShieldCheck, X } from 'lucide-react';
import OperationalPage from './OperationalPage';
import { operations } from '../config/operations';
import { accountPermissions, accountPermissionLabels, bindShopAccount, createAndBindShopAccount, getAccessOverview, matchingCreatedBinding, prepareCreateAndBind, resetMerchantPassword, revokeAssociation, saveAssociation, type AccessOverview, type AccountPermission, type AssociationGrant, type CreateAndBindInput, type CreateAndBindResult } from '../api/accountAccess';
import { ApiError } from '../api/session';
import { merchantWorkspaceUrl } from '../utils/merchantWorkspaceUrl';

type Editor = { kind: 'bind' | 'create'; shopId: string } | { kind: 'grant'; grant?: AssociationGrant } | { kind: 'revoke'; grant: AssociationGrant } | { kind: 'password'; userId: string };
type PendingCreation = Omit<CreateAndBindInput, 'password'>;
const control = 'store-control';
const shopStatusLabels: Record<string, string> = { PENDING: '待审核', APPROVED: '已发布', REJECTED: '已拒绝', SUSPENDED: '已停用' };
function randomCharacters(alphabet: string, length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}
function randomInitialPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const characters = [randomCharacters(letters, 1), randomCharacters(digits, 1), randomCharacters(letters + digits, 6)].join('').split('');
  const order = crypto.getRandomValues(new Uint8Array(characters.length));
  for (let index = characters.length - 1; index > 0; index--) {
    const target = order[index] % (index + 1);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }
  return characters.join('');
}
export default function AccountAccessManagement({ initialShopId, initialTab = 'access', onBack }: { initialShopId?: string; initialTab?: 'access' | 'accounts'; onBack?: () => void } = {}) {
  const [tab, setTab] = useState(initialTab);
  const [scopeShopId, setScopeShopId] = useState(initialShopId ?? '');
  const [shopSearch, setShopSearch] = useState(''), [shopPage, setShopPage] = useState(1), [shopPageSize, setShopPageSize] = useState(25);
  const [data, setData] = useState<AccessOverview | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0), [editor, setEditor] = useState<Editor | null>(null), [busy, setBusy] = useState(false);
  const [source, setSource] = useState(''), [target, setTarget] = useState(''), [userId, setUserId] = useState(''), [reason, setReason] = useState(''), [password, setPassword] = useState(''), [permissions, setPermissions] = useState<AccountPermission[]>([]);
  const [loginName, setLoginName] = useState(''), [accountName, setAccountName] = useState(''), [email, setEmail] = useState(''), [phone, setPhone] = useState('');
  const [credentialReveal, setCredentialReveal] = useState<{ email: string; password: string; shopName: string } | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreation | null>(null);
  const createKey = useRef('');
  const alive = useRef(true), lock = useRef(false), cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (tab !== 'access') return;
    const controller = new AbortController(); setLoading(true); setError('');
    getAccessOverview(controller.signal).then(result => { if (!controller.signal.aborted) setData(result); }).catch(err => { if (!controller.signal.aborted) { setData(null); setError(err instanceof Error ? err.message : '加载失败'); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, tab]);
  const close = () => { if (lock.current) return; setEditor(null); setPassword(''); setReason(''); };
  useEffect(() => { if (editor) cancel.current?.focus(); }, [editor]);
  const open = (next: Editor) => {
    if (next.kind === 'create' && pendingCreate) { setError('上次创建结果仍未知，请先核对最新绑定，不要再次创建。'); return; }
    setEditor(next); setError(''); setReason(''); setPassword(''); setUserId('');
    setLoginName(next.kind === 'create' ? `shop-${next.shopId}-${randomCharacters('abcdefghijklmnopqrstuvwxyz0123456789', 8)}` : ''); setAccountName(next.kind === 'create' ? shopName(next.shopId) : ''); setEmail(next.kind === 'create' ? data?.shops.find(shop => shop.id === next.shopId)?.email ?? '' : ''); setPhone(''); setPassword(next.kind === 'create' ? randomInitialPassword() : ''); createKey.current = next.kind === 'create' ? crypto.randomUUID() : '';
    setSource(next.kind === 'grant' ? next.grant?.sourceShopId ?? '' : ''); setTarget(next.kind === 'grant' ? next.grant?.targetShopId ?? '' : '');
    setPermissions(next.kind === 'grant' ? accountPermissions.filter(permission => next.grant?.permissions.includes(permission)) : []);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editor || lock.current || !data) return;
    if (!reason.trim() || reason.trim().length > 1000) { setError('请填写 1–1000 字的操作原因。'); return; }
    if (editor.kind === 'grant') {
      if (!source || !target || source === target || !permissions.length) { setError('请选择不同的来源门店、目标门店及至少一项权限。'); return; }
      if (permissions.some(p => ['BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE'].includes(p)) && !permissions.includes('BOOKINGS_READ')) { setError('预约处理、收款或退款权限必须同时包含查看预约。'); return; }
    }
    const resetUserId = editor.kind === 'password' ? editor.userId || userId : '';
    if (editor.kind === 'password') { if (!resetUserId) { setError('请选择需要重置密码的商家账号。'); return; } const bytes = new TextEncoder().encode(password).length; if (bytes < 6 || bytes > 72) { setError('新密码须为 6–72 个 UTF-8 字节。'); return; } }
    let creation: CreateAndBindInput | null = null;
    if (editor.kind === 'create') {
      if (pendingCreate) return;
      try { creation = prepareCreateAndBind({ shopId: editor.shopId, loginName, name: accountName, password, email, phone, reason, idempotencyKey: createKey.current }); }
      catch (err) { setError(err instanceof Error ? err.message : '创建信息无效。'); return; }
    }
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let created: CreateAndBindResult | null = null;
      if (creation) created = await createAndBindShopAccount(creation);
      if (editor.kind === 'bind') { const result = await bindShopAccount(editor.shopId, userId, reason.trim()); if (String(result.binding?.shopId) !== editor.shopId || String(result.binding?.userId) !== userId) throw new Error('绑定结果无法确认，请刷新核对。'); }
      if (editor.kind === 'grant') { const result = await saveAssociation(source, target, permissions, reason.trim()); if (String(result.grant?.sourceShopId) !== source || String(result.grant?.targetShopId) !== target || result.grant?.status !== 'ACTIVE') throw new Error('授权结果无法确认，请刷新核对。'); }
      if (editor.kind === 'revoke') { const result = await revokeAssociation(editor.grant.id, reason.trim()); if (result.grant?.status !== 'REVOKED') throw new Error('撤销结果无法确认，请刷新核对。'); }
      if (editor.kind === 'password') { const result = await resetMerchantPassword(resetUserId, password, reason.trim()); if (!result.reset || String(result.userId) !== resetUserId) throw new Error('密码重置结果无法确认。'); }
      if (alive.current) { if (creation) { setPendingCreate(null); setCredentialReveal({ email: creation.email, password: creation.password, shopName: shopName(creation.shopId) }); } setEditor(null); setPassword(''); setReason(''); setNotice(editor.kind === 'password' ? '密码已重置，该账户原有会话已撤销；原登录权限不变。' : creation ? created?.binding.accountStatus === 'SUSPENDED' ? '独立账号已创建并绑定，仍保持禁用；历史经营归属与账本未改变。' : '原创建结果已核对，账号当前状态保持不变；历史经营归属与账本未改变。' : '操作已完成，正在读取最新授权。'); setRevision(value => value + 1); }
    } catch (err) {
      if (alive.current) {
        const unknown = creation && (!(err instanceof ApiError) || !err.status || err.status === 408 || err.status >= 500);
        if (unknown) { const { password: _secret, ...marker } = creation; setPendingCreate(marker); setError('创建并绑定结果未知，原输入与请求标识已保留。请核对最新结果；核对只读取授权，不会重新提交密码。关闭或离开页面会清除密码。'); }
        else setError(err instanceof Error ? err.message : '操作失败，当前输入已保留。');
      }
    }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const checkCreation = async () => {
    if (!pendingCreate || lock.current) return;
    const original = pendingCreate; lock.current = true; setBusy(true); setError('');
    try {
      const current = await getAccessOverview();
      if (!alive.current) return;
      setData(current);
      const binding = matchingCreatedBinding(current, original.shopId, original.email);
      if (binding) {
        setPendingCreate(null); setEditor(null); setPassword(''); setReason('');
      setNotice(`已核实门店 #${original.shopId} 当前绑定登录邮箱 ${original.email}，${binding.accountStatus === 'SUSPENDED' ? '账号仍禁用' : '账号当前具备登录条件'}。此核对仅确认当前绑定，不确认上次请求收据或密码；请勿再次创建。`);
      } else {
        const actual = current.shops.find(shop => shop.id === original.shopId)?.binding;
        setError(actual ? '当前绑定邮箱与原输入不符，或账号状态异常。原请求仍未确认，请由公司核对，勿重复创建。' : '尚未读取到匹配绑定，不能据此断定原请求未执行。请稍后再次核对，勿重复创建。');
      }
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : '核对失败，原请求仍保留。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const shopName = (id: string) => data?.shops.find(shop => String(shop.id) === String(id))?.name ?? `门店 #${id}`;
  const shopOptions = data?.shops.filter(shop => shop.binding?.accountStatus === 'ACTIVE' && shop.binding.loginReady && shop.status !== 'SUSPENDED') ?? [];
  const scopedShops = data?.shops.filter(shop => !scopeShopId || shop.id === scopeShopId) ?? [];
  const search = shopSearch.trim().toLowerCase();
  const filteredShops = search ? scopedShops.filter(shop => [shop.name, shop.id, `#${shop.id}`, shop.email, shop.binding?.email].some(value => String(value ?? '').toLowerCase().includes(search))) : scopedShops;
  const shopPages = Math.max(1, Math.ceil(filteredShops.length / shopPageSize)), currentShopPage = Math.min(shopPage, shopPages);
  const visibleShops = filteredShops.slice((currentShopPage - 1) * shopPageSize, currentShopPage * shopPageSize);
  const viewLocked = busy || Boolean(editor) || Boolean(pendingCreate);
  const canChangeView = () => !lock.current && !editor && !pendingCreate;
  useEffect(() => { setShopPage(page => Math.min(page, shopPages)); }, [shopPages]);
  const visibleGrants = data?.grants.filter(grant => !scopeShopId || grant.sourceShopId === scopeShopId || grant.targetShopId === scopeShopId) ?? [];
  return <div className="app-page">
    <div>{onBack && <button type="button" disabled={viewLocked} onClick={() => { if (canChangeView()) onBack(); }} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-teal-700"><ArrowLeft className="h-4 w-4" />返回门店检查</button>}<h1 className="page-heading">商家账号与门店权限</h1><p className="page-description">每店独立登录，公司管理员配置关联权限；切店保留实际操作者，账本归属保持独立。</p></div>
    {scopeShopId && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-100 bg-teal-50/40 p-4"><p className="text-sm text-teal-900">当前核对门店：{shopName(scopeShopId)} <span className="text-xs text-slate-500">#{scopeShopId} · 以下绑定与关联按此店筛选</span></p><button type="button" disabled={viewLocked} onClick={() => { if (canChangeView()) { setScopeShopId(''); setShopPage(1); } }} className="store-secondary-button">查看全部门店</button></div>}
    <nav aria-label="商家账号管理" className="flex flex-wrap gap-2"><button type="button" disabled={viewLocked} onClick={() => { if (canChangeView()) setTab('access'); }} className={tab === 'access' ? 'store-primary-button' : 'store-secondary-button'}>门店绑定与关联</button><button type="button" disabled={viewLocked} onClick={() => { if (canChangeView()) setTab('accounts'); }} className={tab === 'accounts' ? 'store-primary-button' : 'store-secondary-button'}>创建与管理账户</button></nav>
    {pendingCreate && <div role="status" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>创建结果待核对：{shopName(pendingCreate.shopId)} · #{pendingCreate.shopId}，原登录邮箱 <strong>{pendingCreate.email}</strong>。当前页面保留原请求标识；不会自动重发密码。关闭或离开会清除密码，离页后请先核对门店绑定再发起新创建。</p><button type="button" disabled={busy} className="store-secondary-button" onClick={() => void checkCreation()}>{busy ? '正在核对…' : '核对最新结果（只读）'}</button></div>}
    {tab === 'accounts' ? <OperationalPage config={operations['merchant-list']!} /> : <>
      <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={loading || busy} className="store-secondary-button" onClick={() => setRevision(value => value + 1)}><RefreshCw className="h-4 w-4" />刷新授权</button><button type="button" disabled={!data || loading || busy} className="store-primary-button" onClick={() => open({ kind: 'grant' })}><ShieldCheck className="h-4 w-4" />配置门店关联</button><button type="button" disabled={!data || loading || busy} className="store-secondary-button" onClick={() => open({ kind: 'password', userId: '' })}>重置账号密码</button><a href={merchantWorkspaceUrl('/copy-config')} target="_blank" rel="noopener noreferrer" className="store-secondary-button">营业时间 / 价目复制</a><p className="text-xs text-slate-500">关联是单向授权，不共享密码，也不转移历史经营者。</p></div>
      {loading ? <p role="status" className="surface-panel p-6 text-sm text-slate-500">正在加载账户与门店…</p> : data && <>
      <section aria-label="独立门店账号" className="surface-panel overflow-hidden">
        <div className="space-y-4 border-b border-slate-100 p-5"><h2 className="text-sm font-semibold">独立门店账号</h2><div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-[1_1_260px] space-y-2 text-sm text-slate-500"><span>查找门店账号</span><input type="search" aria-label="查找门店账号" maxLength={255} placeholder="门店名称、ID或邮箱" value={shopSearch} disabled={viewLocked} className={control} onChange={event => { if (canChangeView()) { setShopSearch(event.target.value); setShopPage(1); } }} /></label><button type="button" disabled={viewLocked || !shopSearch} className="store-secondary-button" onClick={() => { if (canChangeView()) { setShopSearch(''); setShopPage(1); } }}>清除搜索</button></div><p className="text-xs text-slate-500">搜索当前范围内全部门店，分页仅改变显示行数。</p></div>
        <div className="overflow-x-auto"><table className="min-w-[850px] text-left"><thead><tr><th>门店</th><th>登录账户</th><th>账户状态</th><th>操作</th></tr></thead><tbody>{visibleShops.map(shop => <tr key={shop.id} className={scopeShopId === shop.id ? "bg-teal-50/30" : undefined}><td>{shop.name}<p className="mt-1 text-xs text-slate-400">#{shop.id} · {shopStatusLabels[shop.status] ?? '状态待核对'}</p></td><td>{shop.binding ? <>{shop.binding.name || '未填写姓名'}<p className="mt-1 text-xs text-slate-500">{shop.binding.email || '登录邮箱待完善'} · #{shop.binding.userId}</p></> : <span className="text-amber-700">独立账号待绑定</span>}</td><td>{!shop.binding ? '—' : shop.binding.accountStatus !== 'ACTIVE' ? '已停用' : shop.binding.loginReady ? '可登录' : '登录条件未就绪'}</td><td><div className="flex flex-wrap gap-2">{!shop.binding ? <><button disabled={Boolean(pendingCreate) || busy} className="store-primary-button" onClick={() => open({ kind: 'create', shopId: String(shop.id) })}>创建并绑定</button><button disabled={pendingCreate?.shopId === shop.id || busy} className="store-secondary-button" onClick={() => open({ kind: 'bind', shopId: String(shop.id) })}>选择已有账号</button></> : <button className="store-secondary-button" onClick={() => open({ kind: 'password', userId: String(shop.binding!.userId) })}>重置密码</button>}<a className="store-secondary-button" href={merchantWorkspaceUrl('/?shopId='+encodeURIComponent(shop.id))} target="_blank" rel="noopener noreferrer">进入商家工作区</a></div></td></tr>)}</tbody></table></div>
        {!visibleShops.length && <p role="status" className="p-6 text-sm text-slate-500">{!scopedShops.length ? scopeShopId ? '未找到目标门店的绑定记录，请刷新核对；当前未显示其他门店。' : '暂无门店。请先在门店管理创建。' : '没有匹配的门店账号，请调整搜索条件。'}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-sm text-slate-500"><span role="status" aria-label="门店账号分页状态">{`共 ${filteredShops.length} 家 · 第 ${currentShopPage} / ${shopPages} 页 · 显示 ${filteredShops.length ? (currentShopPage - 1) * shopPageSize + 1 : 0}–${Math.min(currentShopPage * shopPageSize, filteredShops.length)}`}</span><div className="flex items-center gap-2"><select aria-label="门店账号每页条数" value={shopPageSize} disabled={viewLocked} className="rounded-lg border border-slate-200 px-2 py-2" onChange={event => { const size = Number(event.target.value); if (canChangeView() && [25, 50, 100].includes(size)) { setShopPageSize(size); setShopPage(1); } }}>{[25, 50, 100].map(size => <option key={size} value={size}>{size} 条 / 页</option>)}</select><button type="button" aria-label="门店账号上一页" disabled={viewLocked || currentShopPage <= 1} className="store-secondary-button" onClick={() => { if (canChangeView()) setShopPage(Math.max(1, currentShopPage - 1)); }}><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="门店账号下一页" disabled={viewLocked || currentShopPage >= shopPages} className="store-secondary-button" onClick={() => { if (canChangeView()) setShopPage(Math.min(shopPages, currentShopPage + 1)); }}><ChevronRight className="h-4 w-4" /></button></div></div>
      </section>
        <section className="surface-panel overflow-hidden"><h2 className="border-b border-slate-100 p-5 text-sm font-semibold">公司配置的门店关联</h2><div className="overflow-x-auto"><table className="min-w-[850px] text-left"><thead><tr><th>来源账号门店 → 可访问门店</th><th>已授权限</th><th>状态</th><th>操作</th></tr></thead><tbody>{visibleGrants.map(grant => <tr key={grant.id}><td>{shopName(grant.sourceShopId)} → {shopName(grant.targetShopId)}</td><td><div className="flex max-w-md flex-wrap gap-1">{grant.permissions.map(permission => <span key={permission} className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{accountPermissionLabels[permission as AccountPermission] ?? permission}</span>)}</div></td><td>{grant.status === 'ACTIVE' ? '授权记录启用' : '已撤销'}</td><td><div className="flex gap-2"><button className="store-secondary-button" onClick={() => open({ kind: 'grant', grant })}>{grant.status === 'ACTIVE' ? '调整权限' : '重新授权'}</button>{grant.status === 'ACTIVE' && <button className="store-secondary-button text-red-700" onClick={() => open({ kind: 'revoke', grant })}>撤销</button>}</div></td></tr>)}</tbody></table></div>{!visibleGrants.length && <p className="p-6 text-sm text-slate-500">{scopeShopId ? "该店暂无关联授权。" : "暂无关联。各门店账号仅访问自己的门店。"}</p>}</section>
      </>}
    </>}
    {notice && <p role="status" className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-800">{notice}</p>}{credentialReveal && <section aria-label="新建门店账号凭据" className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-emerald-950">{credentialReveal.shopName} 的独立登录信息</h2><p className="mt-1 text-xs text-emerald-800">本次密码已显示。后续可在门店工作室的“商家账号密码设置”中查看或重置；新建账号仍保持禁用。</p></div><button type="button" className="store-icon-button" aria-label="关闭登录信息" onClick={() => setCredentialReveal(null)}><X className="h-4 w-4" /></button></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-emerald-200 bg-white px-3 py-2"><span className="block text-xs text-slate-500">登录邮箱</span><span className="break-all text-sm font-medium text-slate-900">{credentialReveal.email}</span></div><div className="rounded-lg border border-emerald-200 bg-white px-3 py-2"><span className="block text-xs text-slate-500">初始密码</span><span className="font-mono text-sm font-semibold text-slate-900">{credentialReveal.password}</span></div></div><button type="button" className="store-secondary-button" onClick={() => void navigator.clipboard?.writeText(`登录邮箱：${credentialReveal.email}\n初始密码：${credentialReveal.password}`)}><Copy className="h-4 w-4" />复制登录信息</button></section>}{error && !editor && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {editor && data && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4"><section role="dialog" aria-modal="true" aria-labelledby="account-action-title" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onKeyDown={event => { if (event.key === 'Escape') close(); if (event.key === 'Tab') { const nodes = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)'); const first=nodes[0],last=nodes[nodes.length-1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}>
      <div className="mb-5 flex items-center justify-between gap-3"><h2 id="account-action-title" className="text-lg font-semibold">{editor.kind === 'create' ? '创建并绑定独立账号' : editor.kind === 'bind' ? '绑定独立门店账号' : editor.kind === 'grant' ? '配置单向关联权限' : editor.kind === 'revoke' ? '撤销关联授权' : '重置商家密码'}</h2><button type="button" disabled={busy} onClick={close} aria-label="关闭" className="store-icon-button"><X className="h-4 w-4" /></button></div>
      <form onSubmit={event => void submit(event)} className="space-y-4"><fieldset disabled={busy || (editor.kind === 'create' && Boolean(pendingCreate))} className="space-y-4">
        {editor.kind === 'create' && <>
          <p className="text-sm leading-6 text-slate-600">为 {shopName(editor.shopId)} 创建独立商家账号并立即绑定，两步在服务端同一事务完成。新账号保持禁用；设置密码不会启用登录，也不会修改历史经营归属或账本。</p>
          <label className="block space-y-2 text-sm"><span>账户姓名</span><input className={control} required maxLength={100} value={accountName} onChange={event => setAccountName(event.target.value)} /></label>
          <label className="block space-y-2 text-sm"><span>登录邮箱</span><input className={control} type="email" autoComplete="email" required maxLength={255} value={email} onChange={event => setEmail(event.target.value)} placeholder="店铺日常使用的客户邮箱" /><span className="block text-xs text-slate-500">默认带入门店联系邮箱，可在此调整。</span></label>
          <div className="flex items-end gap-2"><label className="block min-w-0 flex-1 space-y-2 text-sm"><span>初始密码</span><input className={control} type="text" autoComplete="new-password" required minLength={6} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} /></label><button type="button" className="store-secondary-button shrink-0" onClick={() => setPassword(randomInitialPassword())}>重新生成</button></div>
          <p className="text-xs text-slate-500">系统默认生成 8 位字母和数字组合；密码可手动设置，最少 6 个字符，最多 72 UTF-8 字节。</p>
          <label className="block space-y-2 text-sm"><span>电话（可选）</span><input className={control} type="tel" maxLength={20} pattern="\+[1-9][0-9]{7,14}" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+1…" /></label>
        </>}
        {editor.kind === 'bind' && <><p className="text-sm text-slate-600">{shopName(editor.shopId)}。绑定后用于独立登录；不会修改历史 owner 或账本。</p><label className="block space-y-2 text-sm"><span>未绑定且已具备登录条件的商家账号</span><select className={control} required value={userId} onChange={event => setUserId(event.target.value)}><option value="">请选择</option>{data.accounts.filter(account => !account.boundShopId && account.status === 'ACTIVE' && account.loginReady === true).map(account => <option key={account.id} value={account.id}>{account.loginName || account.email || '账号 #' + account.id} · {account.name || '未填写姓名'} · #{account.id}</option>)}</select></label><p className="text-xs text-slate-500">没有合适账户时，取消后使用该门店的“创建并绑定”，一次完成账号和绑定。未具备登录条件的旧账号不能选择；已绑定关系不能在此覆盖。</p></>}
        {editor.kind === 'grant' && <><label className="block space-y-2 text-sm"><span>来源门店（使用其独立账号）</span><select className={control} required value={source} onChange={event => setSource(event.target.value)}><option value="">请选择</option>{shopOptions.map(shop => <option key={shop.id} value={shop.id}>{shop.name} · #{shop.id}</option>)}</select></label><label className="block space-y-2 text-sm"><span>允许访问的目标门店</span><select className={control} required value={target} onChange={event => setTarget(event.target.value)}><option value="">请选择</option>{shopOptions.filter(shop => String(shop.id) !== source).map(shop => <option key={shop.id} value={shop.id}>{shop.name} · #{shop.id}</option>)}</select></label><fieldset className="rounded-xl border border-slate-200 p-4"><legend className="px-1 text-sm">明确授予的权限</legend><div className="grid gap-3 sm:grid-cols-2">{accountPermissions.filter(permission => data.permissions.includes(permission)).map(permission => <label key={permission} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={permissions.includes(permission)} onChange={event => setPermissions(previous => event.target.checked ? [...previous, permission] : previous.filter(item => item !== permission))} />{accountPermissionLabels[permission]}</label>)}</div></fieldset><p className="text-xs leading-5 text-slate-500">来源和目标都需已绑定有效独立账号，授权仅单向生效。仅授予快捷复制时，账号只可进入复制工作台并复制营业时间与展示价目；服务目录、预约、门店资料、地址与电话仍须分别授权。复制操作不会复制地址、电话、账号、账本或订单。</p></>}
        {editor.kind === 'revoke' && <p className="text-sm text-slate-600">撤销 {shopName(editor.grant.sourceShopId)} 对 {shopName(editor.grant.targetShopId)} 的关联访问；历史操作记录保留。</p>}
        {editor.kind === 'password' && <>{!editor.userId && <label className="block space-y-2 text-sm"><span>商家账号</span><select className={control} required value={userId} onChange={event => setUserId(event.target.value)}><option value="">请选择</option>{data.accounts.map(account => <option key={account.id} value={account.id}>{account.email || account.loginName || '账号 #' + account.id} · {account.name || '未填写姓名'} · #{account.id}{account.status === 'SUSPENDED' ? ' · 已停用' : ''}</option>)}</select></label>}<label className="block space-y-2 text-sm"><span>新密码（最少 6 个字符，最多 72 UTF-8 字节）</span><input className={control} type="text" autoComplete="new-password" required minLength={6} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} /></label><p className="text-xs text-slate-500">服务端成功后撤销该商家账号已有会话。</p></>}
        <label className="block space-y-2 text-sm"><span>操作原因</span><textarea className={control} required maxLength={1000} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="记录业务目的，请勿填写密码或客户隐私" /></label>
      </fieldset>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-3"><button ref={cancel} type="button" disabled={busy} onClick={close} className="store-secondary-button">取消</button>{editor.kind === 'create' && pendingCreate ? <button type="button" disabled={busy} className="store-primary-button" onClick={() => void checkCreation()}>{busy ? '正在核对…' : '核对最新结果'}</button> : <button disabled={busy} className="store-primary-button">{busy ? '正在提交…' : '确认提交'}</button>}</div></form>
    </section></div>}
  </div>;
}
