import { useEffect, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, RefreshCw, Save } from 'lucide-react';
import { ApiError, subscribeSession } from '../../api/session';
import { getStoreAccountCredentials, saveStoreAccountCredentials, type StoreAccountCredentials as Credentials, type StoreAccountCredentialsInput } from '../../api/accountAccess';
import type { ResourceId } from '../../api/resources';
import { newMerchantAccountDraft } from '../../utils/merchantAccountDraft';
import { publicEmail } from '../../utils/publicContacts';
import { useConfirmation } from '../Confirmation';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycleListener } from './businessScope';

interface CredentialDraft { email: string; password: string; }
interface PendingSave { input: StoreAccountCredentialsInput; expectedStatus: string | null; }
const draftFrom = (data: Credentials, suggestedEmail?: string): CredentialDraft => ({ email: data.email ?? (data.userId === null ? suggestedEmail ?? '' : ''), password: data.password ?? '' });
const changedPassword = (draft: CredentialDraft, initial: CredentialDraft) => draft.password !== '' && draft.password !== initial.password;

export default function StoreAccountCredentials({ shopId, suggestedEmail, disabled = false, onLifecycleChange, onSaved }: {
  shopId: ResourceId; suggestedEmail?: string; disabled?: boolean;
  onLifecycleChange?: BusinessLifecycleListener; onSaved?: (value: Credentials) => void;
}) {
  const scope = useBusinessScope(shopId), identity = `${scope.actorId}:${shopId}`, confirm = useConfirmation();
  const mounted = useRef(true), operation = useRef<symbol | null>(null), live = useRef({ identity, generation: 0, disabled });
  if (live.current.identity !== identity) { live.current = { identity, generation: live.current.generation + 1, disabled }; operation.current = null; }
  else live.current.disabled = disabled;
  const capture = () => { const generation = live.current.generation, own = scope.capture(); return () => mounted.current && identity === live.current.identity && generation === live.current.generation && own(); };
  const [data, setData] = useState<Credentials | null>(null), [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const [initial, setInitial] = useState<CredentialDraft>({ email: '', password: '' }), [draft, setDraft] = useState<CredentialDraft>({ email: '', password: '' });
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [pending, setPending] = useState<PendingSave | null>(null);
  const [recoveryConflict, setRecoveryConflict] = useState<string | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revealedIdentity, setRevealedIdentity] = useState<string | null>(null);
  const loaded = scope.actorId !== null && loadedIdentity === identity && data !== null;
  const dirty = loaded && (draft.email.trim().toLowerCase() !== initial.email.trim().toLowerCase() || changedPassword(draft, initial));
  const locked = disabled || loading || saving || !loaded || !!pending;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => subscribeSession(() => setRevealedIdentity(null)), []);
  useEffect(() => { onLifecycleChange?.({ dirty, busy: saving, unknown: !!pending }); }, [dirty, saving, pending, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange?.(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  const accept = (value: Credentials) => { const next = draftFrom(value, suggestedEmail); setData(value); setInitial(next); setDraft(next); setLoadedIdentity(identity); setRevealedIdentity(null); };
  useEffect(() => {
    const abort = new AbortController(), current = capture(), token = Symbol('read-account-credentials'); operation.current = token;
    setData(null); setLoadedIdentity(null); setInitial({ email: '', password: '' }); setDraft({ email: '', password: '' }); setPending(null); setRecoveryConflict(null); setLoading(true); setSaving(false); setError(''); setNotice('');
    if (!current()) { operation.current = null; setLoading(false); return () => abort.abort(); }
    void getStoreAccountCredentials(String(shopId), abort.signal).then(value => { if (!abort.signal.aborted && current() && operation.current === token) accept(value); })
      .catch(e => { if (!abort.signal.aborted && current() && operation.current === token) setError(e instanceof Error ? e.message : '账号设置读取失败。'); })
      .finally(() => { if (!abort.signal.aborted && current() && operation.current === token) { operation.current = null; setLoading(false); } });
    return () => abort.abort();
  }, [identity]);
  const update = (key: keyof CredentialDraft, value: string) => { if (locked || operation.current || !capture()()) return; setDraft(previous => ({ ...previous, [key]: value })); setNotice(''); setError(''); };
  const save = async (retry?: PendingSave) => {
    const current = capture();
    if (operation.current || loading || saving || live.current.disabled || !current() || !loaded || !data || pending && !retry || !retry && data.userId !== null && !dirty) return;
    let submitted = retry;
    if (!submitted) {
      const email = draft.email.trim().toLowerCase(), emailChanged = data.userId === null || email !== (data.email ?? '').toLowerCase(), passwordChanged = changedPassword(draft, initial);
      if (emailChanged && !publicEmail(email)) { setError('请填写有效的商家登录邮箱。'); return; }
      if (passwordChanged) {
        const bytes = new TextEncoder().encode(draft.password).length;
        if (bytes < 6 || bytes > 72 || draft.password.trim() !== draft.password || /[\u0000\r\n]/u.test(draft.password)) { setError('密码至少 6 位、最多 72 UTF-8 字节，可使用纯数字；首尾不可留空或包含换行。'); return; }
      }
      submitted = { expectedStatus: data.accountStatus, input: {
        ...(emailChanged ? { email } : {}),
        ...(passwordChanged ? { password: draft.password } : {}), expectedUserId: data.userId,
        version: data.version, requestKey: crypto.randomUUID(), reason: '管理员在门店工作室设置商家账号密码',
      } };
    }
    const token = Symbol('save-account-credentials'); operation.current = token; setSaving(true); setRecoveryConflict(null); setError(''); setNotice('');
    try {
      const result = await saveStoreAccountCredentials(String(shopId), submitted.input);
      if (!current() || operation.current !== token) return;
      const expectedStatus = submitted.input.expectedUserId === null ? 'SUSPENDED' : submitted.expectedStatus;
      if (result.accountStatus !== expectedStatus) throw new ApiError('账号状态与保存前不一致，请核对原请求；当前页面不会启用账号。');
      accept(result); setPending(null); setNotice(result.accountStatus === 'SUSPENDED' ? '商家账号密码已保存，账号仍禁用；门店发布状态未变。' : '商家账号密码已保存，原登录权限和门店发布状态保持不变。'); onSaved?.(result);
    } catch (e) {
      if (!current() || operation.current !== token) return;
      const ambiguous = !!retry || !(e instanceof ApiError) || !e.status || e.status === 408 || e.status >= 500;
      if (ambiguous) setPending(submitted);
      const conflict = e instanceof ApiError && ['SHOP_CREDENTIALS_STALE', 'SHOP_CREDENTIALS_REPLAY_CHANGED'].includes(e.code ?? '') ? e.code! : null;
      if (retry && conflict) setRecoveryConflict(conflict);
      setError(retry && conflict ? conflict === 'SHOP_CREDENTIALS_REPLAY_CHANGED' ? '原保存已执行，但账号设置之后又被修改。请重新读取当前账号并核对，不会恢复旧密码。' : '账号设置已经变化，原请求未执行。请重新读取当前账号并核对，原草稿暂保留。' : (e instanceof Error ? e.message : '账号设置保存失败。') + (ambiguous ? ' 保存结果尚未确认；原输入与请求标识已保留，请核对原保存结果。' : ' 当前输入已保留。'));
    } finally { if (current() && operation.current === token) { operation.current = null; setSaving(false); } }
  };
  const reload = async (reconcile = false) => {
    const current = capture(); if (operation.current || saving || loading || pending && !(reconcile && recoveryConflict) || !current() || live.current.disabled) return;
    if ((dirty || pending) && !await confirm({ title: '载入已保存的账号设置', message: pending ? '服务器已明确报告账号版本冲突。将放弃原账号草稿，载入当前账号邮箱和可查看密码进行核对，不重发旧密码；门店其他资料不受影响。' : '这会放弃尚未保存的账号邮箱或密码草稿，门店其他资料不受影响。', confirmLabel: '放弃账号草稿并载入' })) return;
    if (!current() || live.current.disabled) return;
    const token = Symbol('reload-account-credentials'); operation.current = token; setRevealedIdentity(null); setLoading(true); setError(''); setNotice('');
    try { const result = await getStoreAccountCredentials(String(shopId)); if (current() && operation.current === token) { accept(result); setPending(null); setRecoveryConflict(null); setNotice('已载入当前商家账号设置，请按当前值核对。'); } }
    catch (e) { if (current() && operation.current === token) setError(e instanceof Error ? e.message : '账号设置读取失败，原输入保留。'); }
    finally { if (current() && operation.current === token) { operation.current = null; setLoading(false); } }
  };
  const copy = async (kind: 'email' | 'password') => {
    const current = capture(); if (!current() || !loaded) return;
    const value = draft[kind]; if (!value) return;
    try { await navigator.clipboard.writeText(value); if (current()) setNotice(kind === 'email' ? '已复制当前登录邮箱；未保存的修改仍需保存。' : changedPassword(draft, initial) ? '已复制密码草稿，保存账号设置后生效。' : '已复制已保存的密码。'); }
    catch { if (current()) setError('复制未成功，请选中对应内容手动复制。'); }
  };
  return <div className="space-y-4" aria-label="商家账号密码设置" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); void save(); } }}>
    <p className="text-xs leading-6 text-slate-500">使用邮箱登录；登录邮箱与专用预约通知收件邮箱分别维护。这里仅保存账号密码，保留原登录权限，不改变门店发布状态。</p>
    {loaded && data && <p className={'rounded-lg px-3 py-2 text-xs ' + (data.accountStatus === 'SUSPENDED' ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600')}>{data.userId === null ? '尚未绑定独立账号；保存后创建并绑定，初始保持禁用。' : data.accountStatus === 'SUSPENDED' ? '独立账号已禁用，修改邮箱或密码后仍保持禁用。' : data.accountStatus === 'ACTIVE' ? '独立账号已启用；本区域不提供启用或停用操作。' : data.accountStatus === 'DELETED' ? '独立账号已删除，请由平台核对绑定。' : '账号状态待核对。'}</p>}
    {loaded && data?.email?.toLowerCase().endsWith('@pending.massajoy.test') && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">临时邮箱，待替换为客户邮箱。此临时地址不用于接收邮件；预约通知收件邮箱请在专用设置中单独核对并验证。</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}{notice && <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm leading-6 text-teal-800">{notice}</p>}
    {pending && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><p>{recoveryConflict ? '原请求已出现明确的版本冲突，请载入当前设置核对后再开始新修改。' : '请先核对原保存结果。原请求会使用同一个标识重试，不会另生成密码或启用登录。'}</p><button type="button" disabled={saving || loading || disabled} onClick={() => recoveryConflict ? void reload(true) : void save(pending)} className="store-secondary-button mt-2">{saving || loading ? '核对中…' : recoveryConflict ? '重新读取当前账号并核对' : '核对原保存结果'}</button></div>}
    {loading && <p role="status" className="text-sm text-slate-500">正在读取本店账号设置…</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <div><label htmlFor={`store-account-email-${shopId}`} className="mb-2 block text-sm font-medium text-slate-600">邮箱登录账号</label><div className="flex items-center gap-2"><input id={`store-account-email-${shopId}`} type="email" autoComplete="off" maxLength={255} disabled={locked} value={loaded ? draft.email : ''} onChange={event => update('email', event.target.value)} placeholder="shop@example.com" className="store-control min-w-0" /><button type="button" disabled={!loaded || !draft.email} onClick={() => void copy('email')} title="复制邮箱登录账号" aria-label="复制邮箱登录账号" className="store-icon-button shrink-0"><Copy className="h-4 w-4" /></button></div></div>
      <div><label htmlFor={`store-account-password-${shopId}`} className="mb-2 block text-sm font-medium text-slate-600">商家登录密码</label><div className="flex items-center gap-2"><input id={`store-account-password-${shopId}`} type={loaded && revealedIdentity === identity ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={72} disabled={locked} value={loaded ? draft.password : ''} onChange={event => update('password', event.target.value)} placeholder={data?.userId ? '暂无可查看密码，可重新设置' : '保存时自动生成8位字母数字'} className="store-control min-w-0 font-mono" /><button type="button" disabled={!loaded || !draft.password || loading || saving} onClick={() => setRevealedIdentity(previous => previous === identity ? null : identity)} aria-label={revealedIdentity === identity ? '隐藏商家登录密码' : '显示商家登录密码'} aria-pressed={revealedIdentity === identity} className="store-icon-button shrink-0">{revealedIdentity === identity ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button type="button" disabled={!loaded || !draft.password} onClick={() => void copy('password')} title="复制登录密码" aria-label="复制登录密码" className="store-icon-button shrink-0"><Copy className="h-4 w-4" /></button></div></div>
    </div>
    <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={locked} onClick={() => update('password', newMerchantAccountDraft().password)} className="store-secondary-button"><RefreshCw className="h-4 w-4" />随机生成8位密码</button><button type="button" disabled={locked || data?.userId !== null && !dirty} onClick={() => void save()} className="store-primary-button"><Save className="h-4 w-4" />{saving ? '保存中…' : '保存账号设置'}</button><button type="button" disabled={disabled || saving || loading || !!pending} onClick={() => void reload()} className="store-secondary-button">{dirty ? '放弃账号草稿并载入' : '重新读取账号'}</button></div>
    <p className="text-xs leading-6 text-slate-400">手动密码最少 6 位，可使用纯数字；留空保留原密码。随机密码为 8 位字母加数字，点击保存后生效。历史密码没有可读取记录时，需重新生成并保存后才能查看。</p>
  </div>;
}
