import { durationFieldLabel, durationHelp, readServiceDurationKind, serviceDurationLabel, SERVICE_DURATION_LABELS, type ServiceDurationKind } from '../utils/serviceDuration';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronRight, Clock3, DoorOpen, Info, Plus, RefreshCw, Settings2, Users, X } from 'lucide-react';
import { getReservationConfig, removeReservationResource, saveReservationResource, updateReservationPolicy, updateShopPaymentPolicy, updateTherapistScheduleMode } from '../api/reservations';
import { ApiError } from '../api/session';
import type { ResourceId } from '../api/resources';
import type { ReservationConfig, ReservationForm, ReservationFormKind, ReservationPolicy, ReservationResource, ReservationRoom, ReservationService, ReservationTherapist } from '../types/reservations';
import { buildReservationPayload, reservationVariantPriceDraft, localReservationTime, minuteLabel, RESERVATION_WEEKDAYS, ROOM_LABELS } from '../utils/reservationForm';
import { useShopStore } from '../stores/shop';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycleListener } from './store/businessScope';
import { useConfirmation } from './Confirmation';
import ResourcePicker from './ResourcePicker';
import type { ReadinessTab } from '../api/shopReadiness';
import { readinessSelection } from './store/readinessModel';
import { confirmProjectWrite, exactProjectId, focusedReservationService, projectWriteAllowed, reservationRulesTab } from '../utils/projectRuleEdits';
import { reservationRemovalMatches, reservationSaveMatches } from '../utils/reservationWriteReadback';

const control = 'block w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50 disabled:text-slate-400';
const primary = 'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#287C7C] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#226b6b] disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const action = 'rounded-md px-2 py-1.5 text-sm font-medium text-[#287C7C] hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50';
type Tab = 'services' | 'therapists' | 'rooms';
interface EditorState { scopeKey: string; durationKind?: ServiceDurationKind; kind: ReservationFormKind; id?: ResourceId; context: string; form: ReservationForm; original: string; }
const titles: Record<ReservationFormKind, string> = { schedule: '技师排班方式', policy: '服务预约策略', variants: '服务规格', shifts: '每周班次', 'time-off': '技师休假', rooms: '房间 / 独占座位', maintenance: '空间维护' };
function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }
function price(cents: number) { return Number.isSafeInteger(cents) && cents >= 0 ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD' }).format(cents / 100) : '金额待核对'; }
function Status({ active }: { active: boolean }) { return <span className={'inline-flex shrink-0 rounded-md px-2 py-1 text-xs ' + (active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500')}>{active ? '已启用' : '已停用'}</span>; }
function Field({ label, children, hint, wide = false }: { label: string; children: React.ReactNode; hint?: string; wide?: boolean }) {
  return <label className={'block min-w-0 space-y-2 text-sm text-slate-600 ' + (wide ? 'sm:col-span-2' : '')}><span className="font-medium">{label}</span>{children}{hint && <span className="block text-xs font-normal leading-5 text-slate-500">{hint}</span>}</label>;
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-sm leading-6 text-slate-500">{children}</p>; }
function Section({ title, description, button, children }: { title: string; description?: string; button?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[#E5EAF0] bg-white p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-base font-semibold text-slate-800">{title}</h2>{description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}</div>{button}</div>{children}</section>;
}
function PaymentPolicyPanel({ config, saving, onSave, onDirtyChange }: { config: ReservationConfig; saving: boolean; onSave: (enabled: boolean) => Promise<void>; onDirtyChange?: (dirty: boolean) => void }) {
  const enabled = config.paymentPolicy?.payAtStoreEnabled;
  const [value, setValue] = useState(enabled === true);
  useEffect(() => { setValue(enabled === true); }, [enabled]);
  useEffect(() => { onDirtyChange?.(value !== enabled); }, [value, enabled, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (value === enabled) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [value, enabled]);
  return <Section title="到店付款政策" description="新门店默认关闭。开启后顾客可选择到店付款，商家接受预约不等于已收款。" button={<button type="button" disabled={saving || typeof enabled !== 'boolean' || value === enabled} onClick={() => void onSave(value)} className={primary}>{saving ? '保存中…' : '保存付款政策'}</button>}><label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={value} disabled={saving || typeof enabled !== 'boolean'} onChange={event => setValue(event.target.checked)} className="h-4 w-4 accent-[#287C7C]" />允许顾客选择到店付款</label><p className="mt-3 text-xs leading-6 text-slate-500">待商家确认前仍是限时预占；接受后保留资源。须在订单详情登记已实际收到的款项，足额且服务结束后才能完成。收退款登记只记已发生事实，不发起实际退款或银行转账；既有订单按原付款方式处理。</p></Section>;
}
function period(start: string, end: string, timezone: string | null) {
  try { return localReservationTime(start, timezone).replace('T', ' ') + ' — ' + localReservationTime(end, timezone).replace('T', ' '); }
  catch { return start + ' — ' + end + '（UTC）'; }
}
function validZone(timezone: string | null) { try { if (!timezone) return false; new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); return true; } catch { return false; } }
function uncertainWrite(error: unknown) { return !(error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408); }
function exceptionReadback(config: ReservationConfig, editor: EditorState) {
  if (editor.kind === 'schedule' || editor.kind === 'shifts' || editor.kind === 'time-off') {
    const person = config.therapists.find(row => String(row.id) === String(editor.kind === 'schedule' ? editor.id : editor.form.therapistId)
      || (editor.kind === 'shifts' ? row.shifts.some(shift => String(shift.id) === String(editor.id)) : editor.kind === 'time-off' && row.timeOff.some(item => String(item.id) === String(editor.id))));
    if (!person) return '原技师未在当前门店名单中。';
    if (editor.kind === 'schedule') return person.name + '：' + (person.scheduleMode === 'CUSTOM' ? '个人例外排班' : '跟随门店营业时间');
    const rows = editor.kind === 'shifts'
      ? person.shifts.map(row => `${RESERVATION_WEEKDAYS[row.weekday]} ${minuteLabel(row.startMin)}–${minuteLabel(row.endMin)} · ${row.isActive ? '已启用' : '已停用'}`)
      : person.timeOff.map(row => period(row.startAtUtc, row.endAtUtc, config.timezone) + (row.reason ? ' · ' + row.reason : ''));
    return person.name + '\n' + (rows.join('\n') || '暂无已保存记录。');
  }
  if (editor.kind === 'rooms') return config.rooms.map(row => `${row.name} · ${ROOM_LABELS[row.roomType]} · ${row.isActive ? '已启用' : '已停用'}`).join('\n') || '暂无已保存空间。';
  if (editor.kind === 'maintenance') {
    const room = config.rooms.find(row => String(row.id) === String(editor.form.roomId) || row.maintenance.some(item => String(item.id) === String(editor.id)));
    return room ? room.name + '\n' + (room.maintenance.map(row => period(row.startAtUtc, row.endAtUtc, config.timezone) + (row.reason ? ' · ' + row.reason : '')).join('\n') || '暂无已保存维护。') : '原空间未在当前门店名单中。';
  }
  const service = config.services.find(row => String(row.id) === String(editor.kind === 'policy' ? editor.id : editor.form.serviceId) || row.variants.some(item => String(item.id) === String(editor.id)));
  if (!service) return '原服务未在当前门店目录中。';
  return service.name + '\n' + (editor.kind === 'policy'
    ? `${service.participantCount} 位顾客 / ${service.requiredStaffCount} 位技师；${service.requiredRoomType ? ROOM_LABELS[service.requiredRoomType] : '不绑定空间'}；技师缓冲 ${service.staffBufferMin} 分钟；空间缓冲 ${service.roomBufferMin} 分钟。`
    : service.variants.map(row => `${row.name} · ${row.durationMin} 分钟 · ${price(row.priceCents)} · ${row.isActive ? '已启用' : '已停用'}`).join('\n') || '暂无已保存规格。');
}

function ReservationEditor({ editor, setEditor, timezone, saving, error, onClose, onSave, recovery }: {
  editor: EditorState; setEditor: React.Dispatch<React.SetStateAction<EditorState | null>>; timezone: string | null;
  saving: boolean; error: string; onClose: () => void; onSave: (event: React.FormEvent) => void; recovery?: React.ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; heading.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  const form = editor.form;
  const change = (key: string, value: string | boolean) => setEditor(previous => previous ? { ...previous, form: { ...previous.form, [key]: value } } : previous);
  const priceBasisControl = <Field label="收费方式" wide><p className="rounded-lg bg-slate-50 p-3">整次订单总价 · 不按顾客或技师人数重复计算</p></Field>;
  const input = (key: string, label: string, options: { type?: string; step?: number; min?: number; max?: number; maxLength?: number; hint?: string; required?: boolean; pattern?: string; wide?: boolean } = {}) => <Field label={label} wide={options.wide} hint={options.hint}><input className={control} type={options.type ?? 'text'} required={options.required !== false} min={options.min} max={options.max} maxLength={options.maxLength} step={options.type === 'number' ? options.step ?? 1 : options.type === 'datetime-local' ? 60 : undefined} pattern={options.pattern} value={String(form[key] ?? '')} onChange={event => change(key, event.target.value)} /></Field>;
  const active = <label className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 sm:col-span-2"><input type="checkbox" checked={form.isActive === true} onChange={event => change('isActive', event.target.checked)} />启用此{editor.kind === 'variants' ? '规格' : editor.kind === 'shifts' ? '班次' : '空间'}</label>;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/45 p-3 sm:p-6"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="reservation-editor-title" className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving) onClose(); }
    if (event.key === 'Tab') { event.stopPropagation(); const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])].filter(element => element.getClientRects().length > 0); if (!controls.length) return; if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === heading.current)) { event.preventDefault(); controls.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); } }
  }}><header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5"><div><h2 id="reservation-editor-title" ref={heading} tabIndex={-1} className="text-lg font-semibold text-slate-900 outline-none">{editor.kind === 'policy' ? '编辑' : editor.id == null ? '新增' : '编辑'}{titles[editor.kind]}</h2><p className="mt-1 break-words text-sm text-slate-500">{editor.context}</p></div><button type="button" aria-label="关闭编辑" disabled={saving} onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50"><X className="h-5 w-5" /></button></header>
    <form onSubmit={onSave} className="flex min-h-0 flex-col"><div className="min-h-0 overflow-y-auto p-5 sm:p-6">{error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}<fieldset disabled={saving} className="grid min-w-0 grid-cols-1 gap-5 border-0 p-0 sm:grid-cols-2">
      {editor.kind === 'variants' && <>{input('name', '规格名称 *', { maxLength: 100, wide: true })}{priceBasisControl}<Field label="继承主服务类型"><p className="rounded-lg bg-slate-50 p-3">{SERVICE_DURATION_LABELS[readServiceDurationKind(editor.durationKind)]}（规格不可单独改变类型）</p></Field>{input('durationMin', durationFieldLabel(editor.durationKind) + ' *', { type: 'number', min: 5, max: 240, hint: durationHelp(editor.durationKind) })}{input('priceUsd', '整次订单固定价格（USD）*', { type: 'number', min: 0.01, max: 100000, step: 0.01, hint: '输入美元，最多两位小数，例如 100.25。时长与固定价格独立填写，不按时长推算。' })}{input('sortOrder', '排序 *', { type: 'number', min: 0, max: 10000 })}<Field label="币种"><p className="rounded-lg bg-slate-50 p-3 text-slate-700">USD · 美元</p></Field>{active}<p className="text-xs leading-6 text-slate-500 sm:col-span-2">新规格默认整次总价，请核对金额。改价只影响新预约，历史预约保留原价格快照。存在规格后，顾客必须明确选择规格；全部停用不会回退旧价格。</p></>}
      {editor.kind === 'policy' && <>{priceBasisControl}<Field label="服务方式 *" hint="情侣与四手均按一次预约填写总价，技师须互不相同且属于本店且处于可用时段。"><select className={control} value={String(form.participantCount) + ':' + String(form.requiredStaffCount ?? form.participantCount)} onChange={event => { const [participantCount, requiredStaffCount] = event.target.value.split(':'); setEditor(previous => previous ? { ...previous, form: { ...previous.form, participantCount, requiredStaffCount, priceBasis: 'PER_BOOKING', ...(participantCount === '2' && previous.form.requiredRoomType !== 'COUPLE' ? { requiredRoomType: '' } : {}) } } : previous); }}><option value="1:1">单人 · 1 位顾客 / 1 位技师</option><option value="2:2">情侣 · 2 位顾客 / 2 位技师</option><option value="1:2">四手 · 1 位顾客 / 2 位技师</option></select></Field><Field label="所需技师"><p className="rounded-lg bg-slate-50 p-3 text-slate-700">{form.requiredStaffCount === '2' || form.participantCount === '2' ? '本店 2 位不同技师' : '本店 1 位技师'}</p></Field><Field label="所需空间（可选）" hint="不绑定空间时只按技师排班；绑定后会同时检查并占用该空间。" wide><select className={control} value={String(form.requiredRoomType)} onChange={event => change('requiredRoomType', event.target.value)}><option value="">不绑定空间</option>{Object.entries(ROOM_LABELS).filter(([value]) => form.participantCount !== '2' || value === 'COUPLE').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>{input('staffBufferMin', '员工收尾缓冲（分钟）*', { type: 'number', min: 0, max: 120, hint: '缓冲期间技师仍被占用，必须处于可用时段内。' })}{input('roomBufferMin', '房间清理缓冲（分钟）*', { type: 'number', min: 0, max: 120, hint: '房间在服务后继续独占的清理时间。' })}<p className="rounded-lg bg-teal-50 p-3 text-xs leading-6 text-teal-800 sm:col-span-2">独立规格使用各自的固定价格。价格不按人数、技师数或时长推算，未来占用冲突由服务端拒绝。多段组合预约仅支持单人单技师。</p></>}
      {editor.kind === 'schedule' && <Field label="排班方式 *" wide><select className={control} value={String(form.scheduleMode)} onChange={event => change('scheduleMode', event.target.value)}><option value="SHOP">跟随门店营业时间</option><option value="CUSTOM">个人例外排班</option></select><p className="mt-3 text-xs leading-6 text-slate-500">默认跟随门店；个人例外只在已启用班次内接待。两种方式都扣除休假与已有占用。切换时服务端会核对未来预约。</p></Field>}
      {editor.kind === 'shifts' && <><Field label="每周星期 *"><select className={control} value={String(form.weekday)} onChange={event => change('weekday', event.target.value)}>{RESERVATION_WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></Field><Field label="时区"><p className="break-words rounded-lg bg-slate-50 p-3 text-sm">{timezone || '未配置；请先完善门店时区'}</p></Field>{input('startTime', '开始时间 *', { type: 'time' })}{input('endTime', '结束时间 *', { pattern: '([01][0-9]|2[0-3]):[0-5][0-9]|24:00', hint: 'HH:mm；当天午夜可填 24:00。跨日班次请拆为两天。' })}{active}<p className="text-xs leading-6 text-slate-500 sm:col-span-2">按门店当地时间每周重复。还需满足门店营业时间、技师工作时间、休假及已有占用；启用班次不代表所有时段都可约。</p></>}
      {editor.kind === 'rooms' && <>{input('name', '空间名称 *', { maxLength: 100, wide: true })}<Field label="空间类型 *"><select className={control} value={String(form.roomType)} onChange={event => change('roomType', event.target.value)}>{Object.entries(ROOM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="容量"><p className="rounded-lg bg-slate-50 p-3 text-slate-700">{form.roomType === 'COUPLE' ? '2 人' : '1 人'} · 每单独占</p></Field>{active}<p className="text-xs leading-6 text-slate-500 sm:col-span-2">独占座位按单个座位建立；不要将整间共享足疗大厅当作一个座位。双人房容量固定为 2，其余空间为 1。</p></>}
      {(editor.kind === 'time-off' || editor.kind === 'maintenance') && <><p className="rounded-lg bg-teal-50 p-3 text-sm leading-6 text-teal-800 sm:col-span-2">按门店当地时间填写：{timezone || '时区未配置'}。保存时转换为 UTC；夏令时中不存在或重复的时间会被拒绝。</p>{input('startLocal', '开始日期时间 *', { type: 'datetime-local', wide: true })}{input('endLocal', '结束日期时间 *', { type: 'datetime-local', wide: true })}<Field label="说明" wide><textarea rows={3} maxLength={500} value={String(form.reason ?? '')} onChange={event => change('reason', event.target.value)} className={control} /></Field></>}
    </fieldset></div><footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-white p-5"><p className="basis-full text-xs leading-5 text-slate-500">{editor.kind === 'variants' ? '仅保存当前规格的名称、USD价格、时长和启停，并同步已关联展示行；不会保存其他门店资料。' : editor.kind === 'policy' ? '仅保存当前服务的接待人数、场地与缓冲；不修改规格价格或历史订单。' : '仅保存当前' + titles[editor.kind] + '。门店其他资料需在对应位置保存。'}</p>{recovery || <><button type="button" disabled={saving} onClick={onClose} className={secondary}>取消</button><button type="submit" disabled={saving} className={primary}>{saving ? '保存中…' : editor.kind === 'variants' ? '保存当前规格' : editor.kind === 'policy' ? '保存本服务预约规则' : '保存' + titles[editor.kind]}</button></>}</footer></form>
  </section></div>;
}

export default function ReservationSettings({ onBack, onManageQualifications, initialServiceId, initialVariantId, variantFocusRevision = 0, variantFocusPending = true, onVariantFocused, initialTherapistId, initialTab, explicitShopId, embedded = false, onLifecycleChange, onChanged, revision = 0, selectionRevision = 0, serviceOnly = false, resourcesOnly = false, disabled: editingDisabled = false, initialRulesOpen = false, beforeWrite }: { disabled?: boolean; initialRulesOpen?: boolean; resourcesOnly?: boolean; serviceOnly?: boolean; beforeWrite?: () => boolean; onBack: () => void; onManageQualifications: () => void; initialServiceId?: string; initialVariantId?: string; variantFocusRevision?: number; variantFocusPending?: boolean; onVariantFocused?: () => void; initialTherapistId?: string; initialTab?: ReadinessTab; explicitShopId?: ResourceId; embedded?: boolean; onLifecycleChange?: BusinessLifecycleListener; onChanged?: () => void | Promise<void>; revision?: number; selectionRevision?: number }) {
  const { setCurrentStoreId } = useShopStore();
  const scope = useBusinessScope(explicitShopId);
  const focusedScopeValid = !!exactProjectId(explicitShopId) && !!exactProjectId(initialServiceId);
  const shopId = serviceOnly ? focusedScopeValid ? explicitShopId : undefined : scope.shopId;
  const identity = String(scope.actorId) + ':' + String(shopId) + ':' + (serviceOnly ? initialServiceId : 'all');
  const operation = useRef<symbol | null>(null), unknownWrite = useRef(false);
  const live = useRef({ identity, generation: 0, beforeWrite, editingDisabled });
  if (live.current.identity !== identity) { live.current = { identity, generation: live.current.generation + 1, beforeWrite, editingDisabled }; operation.current = null; unknownWrite.current = false; }
  else { live.current.beforeWrite = beforeWrite; live.current.editingDisabled = editingDisabled; }
  const capture = () => { const generation = live.current.generation, currentScope = scope.capture(); return () => mounted.current && identity === live.current.identity && generation === live.current.generation && currentScope(); };
  const gate = (current: () => boolean) => !live.current.editingDisabled && projectWriteAllowed(current, () => !live.current.beforeWrite || live.current.beforeWrite());
  const confirm = useConfirmation();
  const [config, setConfig] = useState<ReservationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<Tab>(reservationRulesTab(initialTab, serviceOnly, resourcesOnly));
  const visibleTab = reservationRulesTab(tab, serviceOnly, resourcesOnly);
  const [serviceId, setServiceId] = useState(initialServiceId ?? '');
  const [therapistId, setTherapistId] = useState(initialTherapistId ?? '');
  const [roomId, setRoomId] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false), [confirming, setConfirming] = useState(false);
  const [unknown, setUnknown] = useState(false), [reviewedConfig, setReviewedConfig] = useState<ReservationConfig | null>(null);
  const [policyDirty, setPolicyDirty] = useState(false);
  const editorDirty = !!editor && JSON.stringify(editor.form) !== editor.original;
  useEffect(() => { onLifecycleChange?.({ dirty: editorDirty || policyDirty, busy: saving || confirming || !!editor, unknown }); }, [editorDirty, policyDirty, saving, confirming, editor, unknown, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange?.(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  useEffect(() => { if (initialTab || serviceOnly || resourcesOnly) setTab(reservationRulesTab(initialTab, serviceOnly, resourcesOnly)); if (initialServiceId !== undefined) setServiceId(initialServiceId); if (initialTherapistId !== undefined) setTherapistId(initialTherapistId); }, [initialTab, initialServiceId, initialTherapistId, selectionRevision, serviceOnly, resourcesOnly]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSaving(false); setConfirming(false); setUnknown(false); setReviewedConfig(null); setPolicyDirty(false); setFormError(''); }, [identity]);
  useEffect(() => {
    if (!unknown && (!editor || JSON.stringify(editor.form) === editor.original)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editor, unknown]);
  useEffect(() => {
    // Sibling saves cannot dismiss an unresolved write or overwrite its draft.
    if (operation.current || unknownWrite.current) return;
    setEditor(null); setNotice(''); setConfig(null); setError('');
    if (shopId == null) { setLoading(false); return; }
    const controller = new AbortController(), current = capture(); setLoading(true);
    getReservationConfig(shopId, controller.signal).then(result => { if (!controller.signal.aborted && current()) setConfig(result); }).catch(err => { if (!controller.signal.aborted && current()) setError(errorText(err)); }).finally(() => { if (!controller.signal.aborted && current()) setLoading(false); });
    return () => controller.abort();
  }, [shopId, reload, scope.actorId, revision, serviceOnly, initialServiceId]);
  const open = (kind: ReservationFormKind, context: string, form: ReservationForm, id?: ResourceId) => {
    if (operation.current || unknownWrite.current || saving || confirming || policyDirty || !gate(capture()) || serviceOnly && (!service || !['variants', 'policy'].includes(kind)) || resourcesOnly && !serviceOnly && ['variants', 'policy'].includes(kind)) return;
    const scopedForm = kind === 'variants' ? { ...form, requiredStaffCount: String(service?.requiredStaffCount ?? 1) } : form;
    setFormError(''); setNotice(''); setEditor({ scopeKey: identity, kind, context, form: scopedForm, id, durationKind: kind === 'variants' ? readServiceDurationKind(service?.durationKind) : undefined, original: JSON.stringify(scopedForm) });
  };
  const close = async () => {
    if (operation.current || unknownWrite.current || saving || !editor) return;
    const current = capture();
    if (JSON.stringify(editor.form) !== editor.original && !await confirm({ title: '放弃本次编辑', message: '本次修改尚未保存，是否关闭编辑？', confirmLabel: '放弃修改' })) return;
    if (!current()) return;
    setEditor(null);
  };
  const refreshAfterWrite = async (message: string, matches: (value: ReservationConfig) => boolean) => {
    const current = capture();
    setNotice('');
    try { const result = await getReservationConfig(shopId!); if (mounted.current && current()) { setConfig(result); if (!matches(result)) throw new Error('最新设置尚未确认本次修改，请核对对应记录。'); setError(''); setNotice(message); } }
    catch (err) { if (mounted.current && current()) { setError('操作结果尚未完成核对。请只读重新载入核对，不要重复提交。' + errorText(err)); } throw err; }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); event.stopPropagation(); if (operation.current || unknownWrite.current || saving || confirming || !editor || shopId == null || !config || editor.scopeKey !== identity) return;
    const current = capture(); if (!gate(current)) return;
    setFormError('');
    let payload: Record<string, unknown>;
    try { payload = buildReservationPayload(editor.kind, editor.form, config.timezone, editor.id == null); }
    catch (err) { setFormError(errorText(err)); return; }
    if (!gate(current)) return;
    const token = Symbol('reservation-save'); operation.current = token; setSaving(true); setReviewedConfig(null);
    let persisted = false;
    try {
      let savedId = editor.id;
      if (editor.kind === 'policy') await updateReservationPolicy(shopId, editor.id!, payload as unknown as ReservationPolicy);
      else if (editor.kind === 'schedule') await updateTherapistScheduleMode(shopId, editor.id!, payload.scheduleMode as 'SHOP' | 'CUSTOM');
      else {
        const result = await saveReservationResource(shopId, editor.kind, payload, editor.id);
        savedId = result.id;
        if (mounted.current && current() && editor.kind === 'rooms') setRoomId(String(result.id));
      }
      persisted = true;
      if (!mounted.current || !current()) return;
      await refreshAfterWrite((editor.kind === 'variants' ? '规格“' + String(editor.form.name) + '”' : editor.kind === 'policy' ? '服务“' + editor.context + '”的预约规则' : titles[editor.kind]) + '已保存，并已重新读取服务器设置。', value => savedId != null && reservationSaveMatches(config, value, editor.kind, savedId, payload, editor.id == null));
      if (current()) { await onChanged?.(); if (current()) setEditor(null); }
    } catch (err) { if (mounted.current && current()) { setNotice(''); const uncertain = persisted || uncertainWrite(err); if (uncertain) { unknownWrite.current = true; setUnknown(true); } setFormError((uncertain ? '保存结果待核对，已阻止重复提交；请只读重新载入并核对。' : '') + errorText(err)); } }
    finally { if (mounted.current && current() && operation.current === token) { operation.current = null; setSaving(false); } }
  };
  const remove = async (kind: ReservationResource, id: ResourceId, label: string) => {
    const current = capture(); if (!current() || operation.current || unknownWrite.current || editor || policyDirty || confirming || saving || shopId == null || !config || serviceOnly && (kind !== 'variants' || !service?.variants.some(row => String(row.id) === String(id))) || resourcesOnly && !serviceOnly && kind === 'variants') return;
    const physical = kind === 'time-off' || kind === 'maintenance';
    const token = Symbol('reservation-remove'); operation.current = token; setConfirming(true); setReviewedConfig(null);
    let dispatched = false, persisted = false;
    try {
      await confirmProjectWrite(current, () => !live.current.beforeWrite || live.current.beforeWrite(),
        () => confirm({ title: (physical ? '删除' : '停用') + titles[kind], message: physical ? '将删除“' + label + '”的阻断时段。已有预约不会自动取消或改期，是否继续？' : '停用“' + label + '”后不再用于新的预约配置，历史记录保留。已有冲突将由服务器拒绝，是否继续？', confirmLabel: physical ? '删除时段' : '确认停用' }),
        async () => {
          setSaving(true); setError(''); setNotice('');
          dispatched = true; await removeReservationResource(shopId, kind, id); persisted = true;
          if (mounted.current && current()) { await refreshAfterWrite(physical ? '阻断时段已删除。' : '已停用，并已刷新设置。', value => reservationRemovalMatches(config, value, kind, id)); if (current()) await onChanged?.(); }
        });
    } catch (err) { if (mounted.current && current()) { const uncertain = persisted || dispatched && uncertainWrite(err); if (uncertain) { unknownWrite.current = true; setUnknown(true); } setError((uncertain ? '操作结果未知，已阻止重复提交；请只读重新载入并核对。' : '') + errorText(err)); } }
    finally { if (mounted.current && current() && operation.current === token) { operation.current = null; setSaving(false); setConfirming(false); } }
  };
  const service = serviceOnly ? focusedReservationService(config?.services, explicitShopId, initialServiceId) : readinessSelection(config?.services, serviceId);
  const requestedVariantId = exactProjectId(initialVariantId);
  const focusedVariantId = serviceOnly && requestedVariantId && service?.variants.some(variant => exactProjectId(variant.id) === requestedVariantId) ? requestedVariantId : undefined;
  const focusedVariantRow = useRef<HTMLTableRowElement | null>(null), handledVariantFocus = useRef('');
  const variantFocusKey = JSON.stringify([identity, focusedVariantId, variantFocusRevision]);
  useEffect(() => {
    if (!variantFocusPending || !focusedVariantId || loading || editor || saving || confirming || unknown || !focusedVariantRow.current || handledVariantFocus.current === variantFocusKey) return;
    handledVariantFocus.current = variantFocusKey;
    focusedVariantRow.current.focus({ preventScroll: true });
    focusedVariantRow.current.scrollIntoView({ block: 'center', inline: 'nearest' });
    onVariantFocused?.();
  }, [focusedVariantId, variantFocusKey, variantFocusPending, onVariantFocused, loading, editor, saving, confirming, unknown]);
  const therapist = readinessSelection(config?.therapists, therapistId);
  const room = config?.rooms.find(item => String(item.id) === roomId) ?? config?.rooms[0];
  const timezoneReady = validZone(config?.timezone ?? null);
  const savePaymentPolicy = async (enabled: boolean) => {
    const current = capture(); if (serviceOnly || resourcesOnly || operation.current || unknownWrite.current || saving || confirming || editor || shopId == null || !current()) return;
    const token = Symbol('reservation-payment'); operation.current = token; setConfirming(true); setReviewedConfig(null);
    let dispatched = false, persisted = false;
    try {
      await confirmProjectWrite(current, () => !live.current.beforeWrite || live.current.beforeWrite(),
        () => confirm({ title: enabled ? '开启到店付款' : '关闭新的到店付款', message: enabled ? '顾客可提交到店付预约。商家须及时接受并真实登记收款，系统不会自动向顾客扣款。' : '关闭后不再提供新的到店付款选择，既有订单的付款方式和实收记录保留。', confirmLabel: '保存政策' }),
        async () => {
          setSaving(true); setError(''); setNotice('');
          dispatched = true; await updateShopPaymentPolicy(shopId, enabled); persisted = true;
          if (current()) { await refreshAfterWrite('付款政策已保存，并已读取服务端结果。', value => value.paymentPolicy?.payAtStoreEnabled === enabled); if (current()) await onChanged?.(); }
        });
    } catch (err) { if (mounted.current && current()) { const uncertain = persisted || dispatched && uncertainWrite(err); if (uncertain) { unknownWrite.current = true; setUnknown(true); } setError((uncertain ? '付款政策结果未知，已阻止重复提交；请只读重新载入并核对。' : '') + errorText(err)); } }
    finally { if (mounted.current && current() && operation.current === token) { operation.current = null; setSaving(false); setConfirming(false); } }
  };
  const reviewUnknown = async () => {
    const current = capture();
    if (!current() || !unknownWrite.current || operation.current || shopId == null) return;
    const token = Symbol('reservation-readback'); operation.current = token; setSaving(true); setReviewedConfig(null);
    try { const value = await getReservationConfig(shopId); if (current() && operation.current === token) { setConfig(value); setReviewedConfig(value); setError(''); } }
    catch (cause) { if (current() && operation.current === token) setError('只读核对失败，原操作仍待核对。' + errorText(cause)); }
    finally { if (current() && operation.current === token) { operation.current = null; setSaving(false); } }
  };
  const finishUnknown = async () => {
    const current = capture(), reviewed = reviewedConfig;
    if (!current() || !unknownWrite.current || operation.current || !reviewed || reviewed !== config) return;
    const token = Symbol('reservation-finish-review'); operation.current = token; setConfirming(true);
    try {
      if (!await confirm({ title: '结束本次操作核对？', message: '请先核对已重新读取的设置。原请求可能仍会完成，结束不会撤销或重试原请求；后续只按最新设置另行编辑。', confirmLabel: '已核对，结束本次操作' }) || !current() || operation.current !== token) return;
      await onChanged?.(); if (!current()) return;
      unknownWrite.current = false; setUnknown(false); setReviewedConfig(null); setEditor(null); setFormError(''); setError(''); setNotice('已结束本次核对，请依据最新设置继续编辑。');
    } catch (cause) { if (current()) setError('最新目录仍未完成核对，当前输入与重复提交锁保持。' + errorText(cause)); }
    finally { if (current() && operation.current === token) { operation.current = null; setConfirming(false); } }
  };
  const recovery = unknown ? <div className="w-full space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">
    <p>原操作结果未知，当前输入已保留。请只读重新载入并核对，明确结束后才可继续修改。</p>
    {reviewedConfig && reviewedConfig === config && <><p className="font-medium">最新已保存设置（门店当地时间）</p>{editor ? <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs">{exceptionReadback(reviewedConfig, editor)}</pre> : <p>已重新载入下方设置列表，请核对原操作对应的记录。</p>}</>}
    {error && <p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={saving || confirming} className={secondary} onClick={() => void reviewUnknown()}>只读重新载入并核对</button><button type="button" disabled={saving || confirming || !reviewedConfig || reviewedConfig !== config} className={secondary} onClick={() => void finishUnknown()}>已核对，结束本次操作</button></div>
  </div> : undefined;
  const intervalForm = (record?: { startAtUtc: string; endAtUtc: string; reason: string | null }): ReservationForm => ({ startLocal: record ? localReservationTime(record.startAtUtc, config!.timezone) : '', endLocal: record ? localReservationTime(record.endAtUtc, config!.timezone) : '', reason: record?.reason ?? '' });
  const select = <T extends { id: ResourceId; name: string; isActive: boolean },>(label: string, items: T[], value: T | undefined, onChange: (id: string) => void) => <label className="block max-w-lg space-y-2 text-sm text-slate-600"><span className="font-medium">{label}</span><select className={control} value={String(value?.id ?? '')} disabled={saving || unknown || !items.length} onChange={event => onChange(event.target.value)}>{!value && <option value="">{items.length ? '请重新选择' : '暂无记录'}</option>}{items.map(item => <option key={item.id} value={item.id}>{item.name}{item.isActive ? '' : ' · 已停用'}</option>)}</select></label>;
  const add = (label: string, callback: () => void, disabled = false) => <button type="button" disabled={editingDisabled || unknown || saving || confirming || !!editor || policyDirty || disabled} className={primary} onClick={callback}><Plus className="h-4 w-4" />{label}</button>;
  const editButton = (callback: () => void, disabled = false) => <button type="button" disabled={editingDisabled || unknown || saving || confirming || !!editor || policyDirty || disabled} className={action} onClick={callback}>编辑</button>;
  const stopButton = (kind: ReservationResource, id: ResourceId, label: string, active = true) => <button type="button" disabled={editingDisabled || unknown || saving || confirming || !!editor || policyDirty || !active} className="rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40" onClick={() => void remove(kind, id, label)}>{kind === 'time-off' || kind === 'maintenance' ? '删除' : '停用'}</button>;
  const openPolicy = (item: ReservationService) => open('policy', item.name, { participantCount: String(item.participantCount), requiredStaffCount: String(item.requiredStaffCount), requiredRoomType: item.requiredRoomType ?? '', staffBufferMin: String(item.staffBufferMin), roomBufferMin: String(item.roomBufferMin), priceBasis: 'PER_BOOKING' }, item.id);
  const newVariant = (item: ReservationService) => open('variants', item.name, { serviceId: String(item.id), name: '', durationMin: '', priceUsd: '', priceBasis: 'PER_BOOKING', sortOrder: '0', isActive: true });
  const newShift = (item: ReservationTherapist) => open('shifts', item.name, { therapistId: String(item.id), weekday: '1', startTime: '', endTime: '', isActive: true });
  const roomForm = (item?: ReservationRoom): ReservationForm => ({ name: item?.name ?? '', roomType: item?.roomType ?? 'SINGLE', isActive: item?.isActive ?? true });
  return <div className={embedded ? "min-w-0 space-y-5" : "app-page min-w-0 space-y-6"}><header className="flex flex-wrap items-start justify-between gap-4"><div>{!embedded && <button type="button" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#287C7C]" disabled={saving || confirming || unknown} onClick={onBack}><ArrowLeft className="h-4 w-4" />返回门店工作室</button>}<h1 className="page-heading">{serviceOnly ? "规格与价格" : "预约设置"}</h1><p className="page-description">{serviceOnly ? "同一服务下的实际规格；预约人数与资源规则可在下方展开。" : "配置服务规格、人员班次和空间资源，让可约时段与实际接待能力一致。"}</p></div><button type="button" disabled={loading || saving || confirming || unknown || !!editor || editorDirty || policyDirty || shopId == null} onClick={() => setReload(value => value + 1)} className={secondary}><RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} />重新加载</button></header>
    {shopId == null ? serviceOnly ? <p role="alert">请明确选择本店项目后再读取预约规则；当前未打开其他项目。</p> : <Section title="选择门店" description="预约设置按门店独立管理。请先选择当前账户可管理的门店。"><div className="max-w-md"><ResourcePicker resource="stores" value="" onChange={value => setCurrentStoreId(String(value) || null)} /></div></Section> : <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-100 bg-[#F0F9F9] px-5 py-4"><p className="text-sm font-medium text-teal-800">当前门店 #{shopId}<span className="ml-3 break-all text-xs font-normal text-teal-700">{config?.timezone ? '当地时区：' + config.timezone : '时区尚未提供'}</span></p><span className="text-xs leading-5 text-teal-700">单人 / 情侣 / 四手 · 每项独立规格</span></div>
      {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm leading-6 text-teal-800"><Check className="mt-1 h-4 w-4 shrink-0" />{notice}</p>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{error}<button type="button" disabled={loading || saving || confirming || unknown} onClick={() => setReload(value => value + 1)} className="ml-3 underline">重试加载</button></div>}
      {unknown && !editor && recovery}
      {loading ? <p role="status" className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">正在加载预约设置…</p> : config && <>
        {!serviceOnly && !resourcesOnly && config.orderOnly !== true && <PaymentPolicyPanel key={String(shopId)} config={config} saving={saving || confirming || unknown || !!editor} onSave={savePaymentPolicy} onDirtyChange={setPolicyDirty} />}
        {!serviceOnly && !timezoneReady && <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800"><Info className="mt-1 h-4 w-4 shrink-0" />门店时区未配置或无效。请先返回门店工作室完善时区；休假和维护的新增、编辑暂不可用。</p>}
        {!serviceOnly && <nav aria-label="预约设置分区" className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">{([{ id: 'services', label: '规格与策略', icon: Settings2 }, { id: 'therapists', label: '技师排班', icon: Users }, { id: 'rooms', label: '空间与维护', icon: DoorOpen }] as const).filter(item => !resourcesOnly || item.id !== 'services').map(item => <button key={item.id} type="button" disabled={saving || confirming || unknown} aria-current={visibleTab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)} className={'flex shrink-0 items-center gap-2 rounded-lg px-4 py-3 text-sm ' + (visibleTab === item.id ? 'bg-teal-50 font-semibold text-[#287C7C]' : 'text-slate-500 hover:bg-slate-50')}><item.icon className="h-4 w-4" />{item.label}</button>)}</nav>}
        {visibleTab === 'services' && <div className="space-y-6"><Section title="服务项目" description={serviceOnly ? '管理当前项目的规格与预约规则；名称、类别和主开关在上方“服务共同资料”中维护。' : '选择本店项目，管理规格与预约规则；新增服务请进入门店“服务与价格”。'}>{serviceOnly ? <p className="font-semibold text-slate-800">{service?.name ?? '当前选定项目待核对'}</p> : select('选择服务', config.services, service, setServiceId)}{service && <p className="mt-3 text-sm text-slate-600">{serviceDurationLabel(service.durationKind, service.durationMin)}。{durationHelp(service.durationKind)}</p>}{!service && <div className="mt-4"><Empty>{serviceId ? '未找到所选项目 #' + serviceId + '，请核对门店并重新选择项目。' : '当前门店尚无服务项目。请先建立服务，再配置预约规则。'}</Empty></div>}</Section>{service && <>
          <Section title="服务规格" description={durationHelp(service.durationKind) + ' 规格继承主服务类型，各自配置预约占用与整次订单固定金额；历史预约保留原快照。'} button={add('新增规格', () => newVariant(service))}>{service.variants.length ? <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm" aria-label="当前服务规格与价格"><thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="p-3">规格名称</th><th className="p-3">占用时长</th><th className="p-3">整次订单价格（USD）</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead><tbody>{service.variants.map(variant => <tr key={variant.id} ref={String(variant.id) === focusedVariantId ? focusedVariantRow : undefined} tabIndex={String(variant.id) === focusedVariantId ? -1 : undefined} aria-label={String(variant.id) === focusedVariantId ? "当前定位规格：" + variant.name : undefined} className={"border-b border-slate-100 last:border-0 " + (String(variant.id) === focusedVariantId ? "bg-teal-50 outline-none ring-2 ring-inset ring-teal-400" : "")}><td className="p-3 font-medium text-slate-800">{variant.name}<span className="mt-1 block text-xs font-normal text-slate-400">排序 {variant.sortOrder}</span></td><td className="p-3 text-slate-600">{serviceDurationLabel(service.durationKind, variant.durationMin)}</td><td className="p-3 font-medium text-slate-800">{price(variant.priceCents)}</td><td className="p-3"><Status active={variant.isActive} /></td><td className="p-3"><div className="flex gap-1">{editButton(() => open('variants', service.name, { name: variant.name, durationMin: String(variant.durationMin), priceUsd: reservationVariantPriceDraft(variant.priceCents), priceBasis: 'PER_BOOKING', sortOrder: String(variant.sortOrder), isActive: variant.isActive }, variant.id))}{stopButton('variants', variant.id, variant.name, variant.isActive)}</div></td></tr>)}</tbody></table></div> : <Empty>尚无独立规格，旧服务使用其原有时长与价格。添加规格后，预约必须明确选择规格；全部规格停用后不会回退旧价格。</Empty>}</Section>
          <details open={initialRulesOpen} className="rounded-xl border border-slate-200 bg-white"><summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-700">预约规则 · 人数、场地与缓冲</summary><div className="p-3"><Section title="预约策略" description="情侣为两客两技师，四手为一客两技师；两名技师须互不相同且来自本店，填写整次预约总价。" button={<button type="button" disabled={editingDisabled || saving || confirming || unknown || !!editor} onClick={() => openPolicy(service)} className={secondary}>编辑策略<ChevronRight className="h-4 w-4" /></button>}><dl className="grid grid-cols-1 gap-5 text-sm sm:grid-cols-2 xl:grid-cols-4">{[['收费方式', '整次订单总价'], ['默认固定价格', price(service.priceCents)], ['服务 / 技师人数', service.participantCount + ' 人 / ' + service.requiredStaffCount + ' 位技师'], ['所需空间', service.requiredRoomType ? ROOM_LABELS[service.requiredRoomType] : '不绑定空间'], ['员工收尾缓冲', service.staffBufferMin + ' 分钟'], ['房间清理缓冲', service.roomBufferMin + ' 分钟']].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-2 font-medium text-slate-800">{value}</dd></div>)}</dl></Section></div></details>
        </>}</div>}
        {visibleTab === 'therapists' && <div className="space-y-6"><Section title="本店技师团队" description="技师默认跟随门店营业时间，也可设置个人例外班次；本店全部技师自动承接本店项目，仍须核对工作时间、休假与已有占用。" button={<button type="button" disabled={saving || confirming || unknown} onClick={onManageQualifications} className={secondary}>管理本店技师<ChevronRight className="h-4 w-4" /></button>}>{select('选择技师', config.therapists, therapist, setTherapistId)}{therapist ? <div className="mt-4 flex flex-wrap items-start gap-3"><Status active={therapist.isActive} /><p className="min-w-0 flex-1 text-sm leading-6 text-slate-500">服务范围：本店全部项目。情侣、四手项目按同一时段需要两位不同技师计算。</p></div> : <div className="mt-4"><Empty>{therapistId ? "未找到所选技师 #" + therapistId + "，请核对门店并重新选择技师。" : "当前门店尚无技师。请先在本店技师团队添加技师。"}</Empty></div>}</Section>{therapist && <details open={!!initialTherapistId} className="rounded-xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold text-slate-700">个人工作时间与休假（可选）</summary><div className="mt-5 space-y-5"><Section title="排班方式" description="跟随门店营业时间为默认方式；需要个人不同工作时间时再启用例外。" button={editButton(() => open('schedule', therapist.name, { scheduleMode: therapist.scheduleMode ?? 'SHOP' }, therapist.id))}><p className="text-sm font-medium text-teal-800">{therapist.scheduleMode === 'CUSTOM' ? '个人例外排班' : '跟随门店营业时间'}</p><p className="mt-2 text-xs leading-6 text-slate-500">{therapist.scheduleMode === 'CUSTOM' ? '仅在下方启用班次内可接待，休假和已有预约继续扣除。' : '无需逐人重复填写营业时段；休假和已有预约继续扣除。下方班次仅在切换为个人例外后生效。'}</p></Section>
          <Section title="个人例外班次" description="个人例外模式下使用这些班次，可分段表示午休；跟随门店模式继续使用营业时间。" button={add('新增班次', () => newShift(therapist))}>{therapist.shifts.length ? <div className="divide-y divide-slate-100">{therapist.shifts.map(shift => <article key={shift.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div className="flex flex-wrap items-center gap-3 text-sm text-slate-700"><CalendarDays className="h-4 w-4 text-[#48A1A1]" /><span>{RESERVATION_WEEKDAYS[shift.weekday]} · {minuteLabel(shift.startMin)}–{minuteLabel(shift.endMin)}</span><Status active={shift.isActive} /></div><div className="flex gap-1">{editButton(() => open('shifts', therapist.name, { weekday: String(shift.weekday), startTime: minuteLabel(shift.startMin), endTime: minuteLabel(shift.endMin), isActive: shift.isActive }, shift.id))}{stopButton('shifts', shift.id, RESERVATION_WEEKDAYS[shift.weekday] + '班次', shift.isActive)}</div></article>)}</div> : <Empty>{therapist.scheduleMode === 'CUSTOM' ? '个人例外尚未配置班次，该技师暂不可预约。' : '默认跟随门店营业时间，无需逐人重复添加班次。'}</Empty>}</Section>
          <Section title="休假 / 临时离岗" description="阻断指定日期时间，不改变每周班次。下列时间按门店时区显示。" button={add('添加休假', () => open('time-off', therapist.name, { ...intervalForm(), therapistId: String(therapist.id) }), !timezoneReady)}>{therapist.timeOff.length ? <div className="divide-y divide-slate-100">{therapist.timeOff.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div className="min-w-0"><p className="break-words text-sm text-slate-700">{period(item.startAtUtc, item.endAtUtc, config.timezone)}</p>{item.reason && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-slate-500">{item.reason}</p>}</div><div className="flex gap-1">{editButton(() => open('time-off', therapist.name, intervalForm(item), item.id), !timezoneReady)}{stopButton('time-off', item.id, therapist.name + '休假')}</div></article>)}</div> : <Empty>没有已配置的休假或临时离岗时段。</Empty>}</Section>
        </div></details>}</div>}
        {visibleTab === 'rooms' && <div className="space-y-6"><Section title="房间与独占座位" description="每项为可独立分配的物理资源。单人房 / 独占座位容量为 1，双人房为 2；共享大厅请逐座建立。" button={add('新增空间', () => open('rooms', '当前门店 #' + shopId, roomForm()))}>{select('选择空间', config.rooms, room, setRoomId)}{room ? <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600"><Status active={room.isActive} /><span>{ROOM_LABELS[room.roomType]} · 容量 {room.capacity} 人 · 每单独占</span><div className="ml-auto flex gap-1">{editButton(() => open('rooms', room.name, roomForm(room), room.id))}{stopButton('rooms', room.id, room.name, room.isActive)}</div></div> : <div className="mt-4"><Empty>尚无空间资源。需要房间的服务必须先配置匹配的可用空间。</Empty></div>}</Section>{room && <Section title="维护 / 暂停使用时段" description="在指定日期时间阻断该空间。已有预约不自动取消，冲突由服务器检查。" button={add('添加维护', () => open('maintenance', room.name, { ...intervalForm(), roomId: String(room.id) }), !timezoneReady)}>{room.maintenance.length ? <div className="divide-y divide-slate-100">{room.maintenance.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div className="min-w-0"><p className="break-words text-sm text-slate-700">{period(item.startAtUtc, item.endAtUtc, config.timezone)}</p>{item.reason && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-slate-500">{item.reason}</p>}</div><div className="flex gap-1">{editButton(() => open('maintenance', room.name, intervalForm(item), item.id), !timezoneReady)}{stopButton('maintenance', item.id, room.name + '维护')}</div></article>)}</div> : <Empty>没有已配置的维护时段。</Empty>}</Section>}</div>}
        <p className="flex items-start gap-2 text-xs leading-6 text-slate-500"><Clock3 className="mt-1 h-4 w-4 shrink-0" />配置完成不等于当前可预约。服务端还会核对发布状态、预约开关、营业时间、技师启停、班次、休假、空间维护及实际占用；付款通过专用流程处理。</p>
      </>}
    </>}
    {editor && editor.scopeKey === identity && config && <ReservationEditor key={editor.kind + ':' + (editor.id ?? 'new')} editor={editor} setEditor={setEditor} timezone={config.timezone} saving={saving || unknown || confirming} error={formError} recovery={recovery} onClose={() => void close()} onSave={event => void save(event)} />}
  </div>;
}
