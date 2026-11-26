import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ArrowLeft, RefreshCw, Users, X } from 'lucide-react';
import { ApiError, subscribeSession } from '../api/session';
import { shopStore } from '../stores/shop';
import { getTechnicianStore, type TechnicianStore } from '../api/storeTechnicians';
import { getShopStaffing, setShopStaffing, updateStaffProfile } from '../api/shopStaffing';
import { staffingDisplayName, type StaffMember, type StaffingSnapshot } from '../utils/shopStaffing';
import { createStaffingEditor, type StaffingEditorState } from '../utils/staffingEditor';
import { createTechnicianContextGuard, scopedId } from '../utils/storeTechniciansModel';
import { safePublicMediaUrl } from '../../backend/src/common/shop-public-profile';
import { useConfirmation } from './Confirmation';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycleListener } from './store/businessScope';

const primary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#287C7C] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 disabled:opacity-40';
const control = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-50';
const frozen = (state: StaffingEditorState) => state.outcome === 'UNKNOWN' || state.outcome === 'CONFLICT';
type Profile = { name: string; bio: string; avatarUrl: string };

export function StaffingCountPanel({ state, disabled, onChange, onSave, onRead, onReviewed }: {
  state: StaffingEditorState; disabled: boolean; onChange: (value: number | null) => void; onSave: () => void; onRead: () => void; onReviewed: () => void;
}) {
  return <section className="surface-panel space-y-4 p-5 sm:p-6" aria-label="设置店内技师人数"><h2 className="flex items-center gap-2 font-semibold text-slate-800"><Users className="h-5 w-5 text-teal-700" />店内技师人数</h2><p className="text-sm leading-6 text-slate-500">只需设置人数。默认承接本店全部项目，跟随门店营业时间，无须逐人配置。</p>
    <div className="flex flex-wrap items-end gap-3"><label className="w-40 space-y-2 text-sm text-slate-600"><span>技师人数</span><input type="number" inputMode="numeric" min={0} max={100} step={1} value={state.target ?? ''} disabled={disabled || state.loading || state.saving || frozen(state) || !state.verified || !state.snapshot?.canManageStaff} onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))} className={control} /></label><button type="button" disabled={disabled || state.loading || state.saving || frozen(state) || !state.verified || !state.snapshot?.canManageStaff || state.target === state.snapshot.activeCount} className={primary} onClick={onSave}>{state.saving ? '保存中…' : '保存人数'}</button><button type="button" disabled={disabled || state.saving || state.loading} className={secondary} onClick={onRead}><RefreshCw className="h-4 w-4" />{frozen(state) ? '重新读取并核对' : '刷新人数'}</button></div>
    <p className="text-xs leading-6 text-slate-500">当前已启用 {state.snapshot?.activeCount ?? '—'} 人。情侣、四手项目同时占用两位技师；减少人数保留历史资料，有预约占用时会受到保护。</p>
    {state.verified && !state.loading && state.snapshot?.activeCount === 0 && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">本店尚未设置可接单技师。请输入门店实际人数并保存；人数为 0 时顾客无法预约，系统不会推定人数。</p>}
    {state.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state.error}</p>}{frozen(state) && state.reviewed && state.verified && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><span>已重新读取当前 {state.snapshot?.activeCount} 人，原目标 {state.target} 人，请核对。</span><button type="button" className={secondary} onClick={onReviewed}>已核对，继续调整</button></div>}
    {state.outcome === 'SAVED' && <p role="status" className="text-sm text-teal-700">人数已保存。所有启用技师自动承接本店全部项目。</p>}
  </section>;
}

export function TechnicianTeam({ storeName, rows, onEdit, onReservations, disabled = false }: {
  storeName: string; rows: StaffMember[]; onEdit: (row: StaffMember) => void; onReservations: (id: string) => void; disabled?: boolean;
}) {
  return <details className="surface-panel overflow-hidden"><summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-700">单独设置技师资料（可选） · {rows.length} 人</summary><div aria-label={storeName + '技师资料'} className="border-t border-slate-100 px-5">{!rows.length ? <p className="py-5 text-sm text-slate-500">设置上方人数后会自动生成技师，不必逐个新增。</p> : rows.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-4 last:border-0"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-50 text-teal-700">{safePublicMediaUrl(row.avatarUrl) ? <img src={safePublicMediaUrl(row.avatarUrl)!} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Users className="h-4 w-4" />}</div><div><h3 className="break-words text-sm font-medium text-slate-800">{staffingDisplayName(row.name)}</h3><p className="mt-1 text-xs text-slate-500">{row.isActive ? '已启用' : '已停用，历史资料保留'}{row.scheduleMode === 'CUSTOM' ? ' · 已有个人特殊安排' : ''}</p></div></div><div className="flex gap-2"><button type="button" disabled={disabled} className={secondary} onClick={() => onEdit(row)}>基本信息</button><button type="button" disabled={disabled} className={secondary} onClick={() => onReservations(row.id)}>特殊安排</button></div></article>)}</div></details>;
}

export default function StoreStaffing({ shopId, onStoreList, onBack, onReservations, embedded = false, refreshRevision = 0, onLifecycleChange, onChanged }: {
  shopId: unknown; onStoreList: () => void; onBack: (shopId: string) => void; onReservations: (shopId: string, therapistId: string) => void;
  embedded?: boolean; refreshRevision?: number; onLifecycleChange?: BusinessLifecycleListener; onChanged?: () => void;
}) {
  const selected = scopedId(shopId), scope = useBusinessScope(embedded && selected ? selected : undefined), confirm = useConfirmation();
  const actor = useRef<string | null>(scope.actorId ? String(scope.actorId) : null); actor.current = scope.actorId ? String(scope.actorId) : null;
  const context = useRef({ selected, embedded }); context.current = { selected, embedded };
  const identity = () => actor.current && context.current.selected && (context.current.embedded || scopedId(shopStore.currentStoreId) === context.current.selected) ? { actorId: actor.current, shopId: context.current.selected } : null;
  const [guard] = useState(() => createTechnicianContextGuard(identity));
  const [store, setStore] = useState<TechnicianStore | null>(null), [editor, setEditor] = useState<StaffMember | null>(null);
  const [profile, setProfile] = useState<Profile>({ name: '', bio: '', avatarUrl: '' }), [savingProfile, setSavingProfile] = useState(false), [error, setError] = useState('');
  const [profilePending, setProfilePending] = useState<{ id: string; changes: Partial<Profile> } | null>(null);
  const [profileReview, setProfileReview] = useState<StaffingSnapshot | null>(null);
  const flags = useRef({ editor: false, busy: false, unknown: false }); flags.current = { editor: !!editor, busy: savingProfile, unknown: !!profilePending };
  const [controller] = useState(() => createStaffingEditor({ identity, canWrite: () => !flags.current.editor && !flags.current.busy && !flags.current.unknown && !!identity(), read: getShopStaffing, write: (id, payload) => setShopStaffing(id, payload.targetActiveCount, payload.expectedRevision) }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const refresh = useRef({ scope: '', revision: refreshRevision });
  const countDirty = !!state.snapshot && state.target !== state.snapshot.activeCount;
  const profileDirty = !!editor && (profile.name !== editor.name || profile.bio !== (editor.bio ?? '') || profile.avatarUrl !== (editor.avatarUrl ?? ''));
  const dirty = countDirty || profileDirty, unknown = frozen(state) || !!profilePending;
  useEffect(() => {
    guard.sync(); controller.syncIdentity(); const abort = new AbortController(), ticket = guard.capture();
    if (selected && actor.current) { void controller.load(abort.signal, false); void getTechnicianStore(selected, abort.signal).then(value => { if (ticket?.current() && !abort.signal.aborted) setStore(value); }).catch(() => {}); }
    const session = subscribeSession(next => { actor.current = next?.role === 'ADMIN' ? scopedId(next.id) : null; guard.sync(); controller.syncIdentity(); });
    const shops = shopStore.subscribe(() => { guard.sync(); controller.syncIdentity(); });
    return () => { abort.abort(); session(); shops(); guard.dispose(); controller.dispose(); };
  }, [selected, scope.actorId, embedded, guard, controller]);
  useEffect(() => {
    const scopeKey = String(scope.actorId) + ':' + String(selected);
    // The identity effect already starts a fresh initial read. Keep later
    // sibling-save requests pending while a local read/write is in flight.
    if (refresh.current.scope !== scopeKey) { refresh.current = { scope: scopeKey, revision: refreshRevision }; return; }
    if (refresh.current.revision === refreshRevision || state.loading || state.saving || savingProfile) return;
    refresh.current.revision = refreshRevision;
    void controller.refresh();
  }, [refreshRevision, selected, scope.actorId, state.loading, state.saving, savingProfile, controller]);
  useEffect(() => { setEditor(null); setStore(null); setProfilePending(null); setProfileReview(null); setSavingProfile(false); flags.current = { editor: false, busy: false, unknown: false }; setError(''); }, [selected, scope.actorId]);
  useEffect(() => { onLifecycleChange?.({ dirty, busy: state.saving || savingProfile, unknown }); }, [dirty, state.saving, savingProfile, unknown, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange?.(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty || state.saving || savingProfile || unknown) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, state.saving, savingProfile, unknown]);
  const navigate = async (work: () => void) => { if (state.saving || savingProfile || unknown) return; const ticket = guard.capture(); if (dirty && !await confirm({ title: '放弃未保存修改？', message: '当前输入尚未保存。', confirmLabel: '放弃修改' })) return; if (ticket?.current()) work(); };
  const saveCount = async () => { const ticket = guard.capture(), before = state.snapshot?.revision; await controller.save(); const after = controller.getSnapshot(); if (ticket?.current() && after.outcome === 'SAVED' && after.snapshot?.revision !== before) onChanged?.(); };
  const open = (person: StaffMember) => { if (!state.snapshot?.canManageStaff || countDirty || unknown || state.saving || savingProfile || person.shopId !== selected || !guard.capture()?.current()) return; flags.current.editor = true; setEditor(person); setProfile({ name: person.name, bio: person.bio ?? '', avatarUrl: person.avatarUrl ?? '' }); setError(''); };
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); event.stopPropagation(); const ticket = guard.capture();
    if (!editor || !selected || !ticket?.current() || flags.current.busy || flags.current.unknown || savingProfile || unknown || !profileDirty) return;
    const changes: Partial<Profile> = {};
    if (profile.name !== editor.name) { if (!profile.name.trim() || profile.name.trim().length > 100) { setError('姓名须为1至100字。'); return; } changes.name = profile.name.trim(); }
    if (profile.bio !== (editor.bio ?? '')) { if (profile.bio.length > 5000) { setError('修改后的简介须不超过5000字。'); return; } changes.bio = profile.bio; }
    if (profile.avatarUrl !== (editor.avatarUrl ?? '')) { if (profile.avatarUrl.trim() && !safePublicMediaUrl(profile.avatarUrl.trim())) { setError('请填写有效的HTTPS或已受管图片地址。'); return; } changes.avatarUrl = profile.avatarUrl.trim(); }
    flags.current.busy = true; setSavingProfile(true); setProfileReview(null); setError('');
    try {
      await updateStaffProfile(selected, editor.id, changes); if (!ticket.current()) return;
      const refreshed = await controller.load(); if (!ticket.current()) return;
      const latest = controller.getSnapshot(), row = latest.snapshot?.therapists.find(person => person.id === editor.id && person.shopId === selected);
      if (!refreshed || !latest.verified || !row || Object.entries(changes).some(([key, value]) => row[key as keyof StaffMember] !== value && !(value === '' && row[key as keyof StaffMember] === null))) throw new Error('资料已提交，但最新人员资料尚未核对到本次修改；原输入已保留，请只读核对，勿重复提交。');
      setEditor(null); flags.current.editor = false; onChanged?.();
    }
    catch (cause) { if (ticket.current()) { setError(cause instanceof Error ? cause.message : '资料结果待核对。'); if (!(cause instanceof ApiError && [400, 401, 403, 404, 409, 429].includes(cause.status ?? 0))) { flags.current.unknown = true; setProfilePending({ id: editor.id, changes }); } } }
    finally { if (ticket.current()) { flags.current.busy = false; setSavingProfile(false); } }
  };
  const checkProfile = async () => { const original = profilePending, ticket = guard.capture(); if (!original || !await controller.load() || !ticket?.current()) return; const snapshot = controller.getSnapshot().snapshot; if (!snapshot) return; const row = snapshot.therapists.find(person => person.id === original.id && person.shopId === selected); if (row && Object.entries(original.changes).every(([key, value]) => row[key as keyof StaffMember] === value || value === '' && row[key as keyof StaffMember] === null)) { setProfilePending(null); setProfileReview(null); setEditor(null); setError(''); onChanged?.(); } else { setProfileReview(snapshot); setError('已重新读取，尚未核对到原修改；请比较下方服务器资料，继续只读核对或明确结束本次操作。'); } };
  const endProfileReview = async () => { const ticket = guard.capture(), reviewed = profileReview, latest = controller.getSnapshot(); if (!profilePending || !reviewed || latest.snapshot !== reviewed || !latest.verified || latest.loading || latest.saving) return; if (await confirm({ title: '结束本次资料核对？', message: '原修改可能仍会完成，结束不会撤销保存。请先核对已读取的人员资料，再开始新的修改。', confirmLabel: '已核对，结束本次操作' }) && ticket?.current()) { const current = controller.getSnapshot(); if (current.snapshot !== reviewed || !current.verified || current.loading || current.saving) { setError('人员资料已再次刷新，请重新只读核对后再结束。'); return; } setProfilePending(null); setProfileReview(null); setEditor(null); setError(''); } };
  const profileReviewReady = !!profileReview && profileReview === state.snapshot && state.verified && !state.loading && !state.saving;
  const profileReadBack = profileReviewReady ? profileReview?.therapists.find(person => person.id === profilePending?.id && person.shopId === selected) : undefined;
  return <div className={embedded ? 'space-y-5' : 'app-page space-y-5'}>{!embedded && <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="page-heading">{store ? store.name + ' · 技师人数' : '技师人数'}</h1><p className="page-description">先设置人数，个人资料和特殊安排按需填写。</p></div>{!embedded && <div className="flex gap-2"><button type="button" className={secondary} onClick={() => void navigate(onStoreList)}><ArrowLeft className="h-4 w-4" />门店列表</button>{selected && <button type="button" className={secondary} onClick={() => void navigate(() => onBack(selected))}>返回本店</button>}</div>}</header>}
    {!selected || !actor.current ? <p className="surface-panel p-5 text-sm text-slate-500">请先选择具体门店。</p> : <><StaffingCountPanel state={state} disabled={!!editor || savingProfile || !!profilePending} onChange={controller.changeTarget} onSave={() => void saveCount()} onRead={() => void controller.load()} onReviewed={controller.acknowledgeReview} />{state.snapshot && <TechnicianTeam storeName={store?.name ?? '本店'} rows={state.snapshot.therapists} disabled={countDirty || state.saving || savingProfile || unknown || !state.snapshot.canManageStaff} onEdit={open} onReservations={id => void navigate(() => onReservations(selected, id))} />}</>}
    {editor && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"><section role="dialog" aria-modal="true" aria-label="技师基本信息" className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5"><header className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{staffingDisplayName(editor.name)} · 基本信息</h2><button type="button" aria-label="关闭技师资料" disabled={savingProfile || !!profilePending} onClick={() => void navigate(() => setEditor(null))}><X className="h-5 w-5" /></button></header><form onSubmit={saveProfile} className="space-y-4"><fieldset disabled={savingProfile || !!profilePending} className="space-y-4 border-0 p-0"><label className="block space-y-2 text-sm text-slate-600"><span>姓名</span><input required value={profile.name} maxLength={100} onChange={event => setProfile(value => ({ ...value, name: event.target.value }))} className={control} /></label><label className="block space-y-2 text-sm text-slate-600"><span>照片地址（选填）</span><input value={profile.avatarUrl} onChange={event => setProfile(value => ({ ...value, avatarUrl: event.target.value }))} className={control} /></label><label className="block space-y-2 text-sm text-slate-600"><span>简介（选填）</span><textarea rows={3} value={profile.bio} onChange={event => setProfile(value => ({ ...value, bio: event.target.value }))} className={control} /></label></fieldset>{error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}{profilePending && <>{profileReviewReady && <div role="status" className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"><p className="font-medium">最新已保存的人员资料</p>{profileReadBack ? <><p>姓名：{staffingDisplayName(profileReadBack.name)}</p><p className="whitespace-pre-wrap break-words">简介：{profileReadBack.bio || '未填写'}</p><p className="break-all">照片地址：{profileReadBack.avatarUrl || '未填写'}</p></> : <p>原技师已不在本店人员名单中；结束后不会向其他人员保存。</p>}</div>}<div className="flex flex-wrap gap-2"><button type="button" disabled={state.loading} className={secondary} onClick={() => void checkProfile()}>只读核对原修改</button><button type="button" disabled={!profileReviewReady} className={secondary} onClick={() => void endProfileReview()}>结束本次核对</button></div></>}<div className="flex justify-end gap-2"><button type="button" disabled={savingProfile || !!profilePending} className={secondary} onClick={() => void navigate(() => setEditor(null))}>取消</button><button type="submit" disabled={savingProfile || !!profilePending || !profileDirty} className={primary}>保存基本信息</button></div></form></section></div>}
  </div>;
}
