import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { getCalendarActionOptions, getCalendarBlock, type BlockPurpose, type BlockScope, type CalendarActionOptions, type CalendarBlock, type CalendarCommand } from '../../api/calendarActions';
import type { CalendarEvent } from '../../api/bookingCalendar';
import { currentShopAllows, isCurrentShop } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import { shopLocal } from '../../utils/reservationTime';
import { useMerchantDraftProtection } from '../../components/MerchantDraftGuard';
import { createCalendarActionModel } from './calendarActionModel';

interface Draft { purpose: BlockPurpose; scope: BlockScope; resourceId: string; startLocal: string; endLocal: string; reason: string }
export interface CalendarAssistedSelection { date: string; startTime?: string }
interface Props {
  shopId: string; timezone: string; date?: string; startTime?: string; event?: CalendarEvent; disabled: boolean;
  onAssisted?: (selection: CalendarAssistedSelection) => void; onChanged: () => void; onClose: () => void; onLockChange: (locked: boolean) => void;
}
export default function CalendarActionsPanel({ shopId, timezone, date, startTime, event, disabled, onAssisted, onChanged, onClose, onLockChange }: Props) {
  const actorId = String(useAuthStore(state => state.merchant?.id) ?? '');
  const allowed = currentShopAllows(shopId, 'RESERVATION_CONFIG');
  const navigate = useNavigate(), [modal, modalContext] = Modal.useModal();
  const [options, setOptions] = useState<CalendarActionOptions | null>(null), [block, setBlock] = useState<CalendarBlock | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [baseline, setBaseline] = useState(''), [selectedTime, setSelectedTime] = useState('');
  const [loading, setLoading] = useState(false), [readError, setReadError] = useState(''), [notice, setNotice] = useState('');
  const readGeneration = useRef(0), alive = useRef(false), selectionRef = useRef('');
  const loadedSelection = useRef<string | undefined>(undefined);
  const dateValue = date ?? (event ? shopLocal(event.startAt, timezone).slice(0, 10) : undefined);
  const selection = `${date ?? ''}:${startTime ?? ''}:${event?.id ?? ''}`; selectionRef.current = selection;
  const current = () => alive.current && actorId === String(useAuthStore.getState().merchant?.id ?? '') && isCurrentShop(shopId);
  const canConfig = () => current() && currentShopAllows(shopId, 'RESERVATION_CONFIG');
  const model = useMemo(() => createCalendarActionModel(actorId, shopId, () => canConfig()), [actorId, shopId]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;
  const dirtyRef = useRef(dirty), lockChangeRef = useRef(onLockChange);
  dirtyRef.current = dirty; lockChangeRef.current = onLockChange;
  const locked = state.busy || state.pending !== null || state.corrupt;
  useMerchantDraftProtection(shopId, dirty, state.busy, () => model.getSnapshot().pending !== null || model.getSnapshot().corrupt);
  useEffect(() => { alive.current = true; model.activate(); return () => { alive.current = false; readGeneration.current++; model.dispose(); }; }, [model]);
  useLayoutEffect(() => { onLockChange(locked || dirty); }, [locked, dirty, onLockChange]);
  useLayoutEffect(() => () => lockChangeRef.current(false), []);
  const loadContext = async (preserveDraft = false) => {
    const generation = ++readGeneration.current, originalSelection = selectionRef.current;
    if (!dateValue || !canConfig()) { setOptions(null); setBlock(null); return; }
    setLoading(true); setReadError('');
    try {
      const [nextOptions, nextBlock] = await Promise.all([getCalendarActionOptions(shopId, dateValue), event?.blockId ? getCalendarBlock(shopId, event.blockId) : Promise.resolve(null)]);
      if (!canConfig() || generation !== readGeneration.current || originalSelection !== selectionRef.current) return;
      if (nextOptions.timezone !== timezone || nextBlock && nextBlock.timezone !== timezone) throw new Error('门店时区已改变，请刷新门店资料后再操作。');
      setOptions(nextOptions); setBlock(nextBlock);
      if (!preserveDraft && nextBlock) {
        const next: Draft = { purpose: nextBlock.purpose, scope: nextBlock.scope, resourceId: nextBlock.resourceId ?? '', startLocal: shopLocal(nextBlock.startAt, timezone), endLocal: shopLocal(nextBlock.endAt, timezone), reason: nextBlock.reason };
        setDraft(next); setBaseline(JSON.stringify(next));
      }
    } catch (error) { if (current() && generation === readGeneration.current && originalSelection === selectionRef.current) { setReadError(error instanceof Error ? error.message : '无法读取当前营业事件。'); setOptions(null); setBlock(null); } }
    finally { if (current() && generation === readGeneration.current && originalSelection === selectionRef.current) setLoading(false); }
  };
  useEffect(() => {
    const changedSelection = loadedSelection.current !== selection;
    loadedSelection.current = selection;
    setOptions(null); setBlock(null);
    if (changedSelection) { setNotice(''); setSelectedTime(startTime ?? ''); if (!state.pending) { setDraft(null); setBaseline(''); } }
    void loadContext(!changedSelection && draft !== null);
    return () => { readGeneration.current++; };
  }, [selection, timezone, actorId, shopId, allowed]);
  useEffect(() => {
    if (!state.receipt || !canConfig()) return;
    setNotice(state.receipt.action === 'CLOSE_DAY' ? '当天已停止接收新预约；已有预约没有自动取消。' : state.receipt.action === 'REOPEN_DAY' ? '所选日期的临时闭店已解除；其他营业规则仍生效，实际可约时段会重新核对。已有预约保持。' : state.receipt.action === 'RELEASE' ? '区间已解除，相关可预约时段将重新核对。' : '日历区间已保存。');
    setDraft(null); setBaseline(''); model.clearReceipt();
    void loadContext();
    if (state.receipt.result.blockId) {
      const committed = state.receipt, originalSelection = selectionRef.current;
      void getCalendarBlock(shopId, committed.result.blockId!).then(latest => {
        if (!canConfig() || originalSelection !== selectionRef.current) return;
        if (latest.timezone !== timezone || latest.version < committed.result.version!) throw new Error('保存已提交，但无法核对保存后的区间版本，请重新读取当前事件。');
      }).catch(error => { if (canConfig() && originalSelection === selectionRef.current) setReadError((error instanceof Error ? error.message : '无法回读已保存区间。') + ' 原操作已确认成功，请勿重复提交。'); });
    }
    onChanged(); // Complete-range reload; the next selection fetches the private current version.
  }, [state.receipt]);
  const startDraft = (purpose: BlockPurpose) => {
    if (disabled || locked || model.getSnapshot().pending || !canConfig() || !options || !dateValue) return;
    const startLocal = `${dateValue}T${selectedTime || '09:00'}`;
    const end = new Date(startLocal + 'Z'); end.setUTCHours(end.getUTCHours() + 1);
    const next: Draft = { purpose, scope: 'SHOP', resourceId: '', startLocal, endLocal: end.toISOString().slice(0, 16), reason: '' };
    onLockChange(true); setDraft(next); setBaseline(''); setNotice('');
  };
  const command = (action: CalendarCommand['action']): CalendarCommand => ({ requestKey: crypto.randomUUID(), action, expectedTimezone: timezone,
    ...(action === 'UPDATE' || action === 'RELEASE' ? { blockId: block!.id, expectedVersion: block!.version } : {}),
    ...(action === 'CREATE' || action === 'UPDATE' ? { purpose: draft!.purpose, scope: draft!.scope, ...(draft!.scope === 'SHOP' ? {} : { resourceId: draft!.resourceId }), startLocal: draft!.startLocal, endLocal: draft!.endLocal, reason: draft!.reason.trim() } : {}),
    ...(action === 'CLOSE_DAY' || action === 'REOPEN_DAY' ? { date: dateValue, expectedSettingsHash: options!.settingsHash } : {}) });
  const execute = async (value: CalendarCommand) => {
    onLockChange(true);
    try { await model.execute(value); }
    finally { if (current()) { const latest = model.getSnapshot(); onLockChange(latest.busy || latest.pending !== null || latest.corrupt || dirtyRef.current); } }
  };
  const save = async () => { if (!disabled && !locked && !loading && canConfig() && options && draft && (!event?.blockId || block?.status === 'ACTIVE')) await execute(command(block ? 'UPDATE' : 'CREATE')); };
  const scopeLabel = (scope: BlockScope, resourceId: string | null) => scope === 'SHOP' ? '全店 · 所有技师与场地' : `${scope === 'THERAPIST' ? '指定技师' : '指定场地'} · ${options?.resources.find(resource => resource.type === scope && resource.id === resourceId)?.name ?? '尚未选择或当前资源不可用'}`;
  const localRangeLabel = (start: string, end: string) => `${start ? start.replace('T', ' ') : '待填写开始时间'} — ${end ? end.replace('T', ' ') : '待填写结束时间'}`;
  const release = async () => {
    if (disabled || locked || !canConfig() || !block || block.status !== 'ACTIVE') return;
    const target = block, context = selectionRef.current;
    const approved = await modal.confirm({ title: '解除这个日历区间？', content: `${scopeLabel(block.scope, block.resourceId)}。${localRangeLabel(shopLocal(block.startAt, timezone), shopLocal(block.endAt, timezone))}（${timezone}）。仅恢复这个区间的可预约性，不创建订单，也不会取消已有预约；其他营业限制仍然生效。`, okText: '确认解除', cancelText: '保留区间' });
    if (approved && canConfig() && context === selectionRef.current && target === block && !model.getSnapshot().pending && !model.getSnapshot().busy) await execute(command('RELEASE'));
  };
  const closeDay = async () => {
    if (disabled || locked || loading || !canConfig() || !options || options.closed || !dateValue) return;
    const original = options, context = selectionRef.current;
    const approved = await modal.confirm({ title: `关闭 ${dateValue}？`, content: `作用范围：全店，所有技师与场地。日期：${dateValue} 全天，00:00 至次日 00:00。门店时区：${timezone}。停止接收新预约；已有预约不会自动取消。若与有效预约冲突，请先逐一处理原预约；保存时以服务端实时校验为准。`, okText: '确认关闭当天', cancelText: '保持营业' });
    if (approved && canConfig() && context === selectionRef.current && original === options && !model.getSnapshot().pending && !model.getSnapshot().busy) await execute(command('CLOSE_DAY'));
  };
  const reopenDay = async () => {
    if (disabled || locked || loading || dirtyRef.current || !canConfig() || !options?.temporaryClosure || !options.closed || !dateValue) return;
    const original = options, context = selectionRef.current, source = options.temporaryClosure;
    const approved = await modal.confirm({ title: `恢复 ${dateValue} 当天营业？`,
      content: `门店时区：${timezone}。当前来源：临时闭店 ${source.startDate} — ${source.endDate}。仅解除 ${dateValue}，区间内其他日期、其他营业限制及已有预约保持；实际时段仍须实时核对。`,
      okText: '确认恢复当天', cancelText: '保留闭店' });
    if (approved && canConfig() && context === selectionRef.current && original === options && !dirtyRef.current && !model.getSnapshot().pending && !model.getSnapshot().busy) await execute(command('REOPEN_DAY'));
  };
  const close = async () => {
    const latest = model.getSnapshot();
    if (disabled || latest.busy || latest.pending !== null || latest.corrupt) return;
    const context = selectionRef.current;
    if (dirtyRef.current && !await modal.confirm({ title: '放弃这个区间的未保存修改？', okText: '放弃修改', cancelText: '继续编辑' })) return;
    const afterConfirmation = model.getSnapshot();
    if (!current() || context !== selectionRef.current || afterConfirmation.busy || afterConfirmation.pending !== null || afterConfirmation.corrupt) return;
    dirtyRef.current = false;
    setDraft(null); setBaseline(''); setNotice(''); onLockChange(false); onClose();
  };
  const setField = (field: keyof Draft, value: string) => { if (!disabled && !locked && canConfig() && !model.getSnapshot().pending) { setDraft(previous => previous ? { ...previous, [field]: value, ...(field === 'scope' ? { resourceId: '' } : {}) } : previous); } };
  if (!dateValue && !state.pending && !state.corrupt && !notice) return modalContext;
  return <section className="booking-calendar-actions" aria-label="日期与时段操作">{modalContext}
    <div className="booking-calendar-selection-title"><h3>{event?.blockId ? '调整不可预约时间' : '选择操作'}</h3><Button disabled={disabled || locked} onClick={() => void close()}>关闭操作面板</Button></div>
    {notice && <Alert type="success" showIcon title={notice} />}
    {state.pending && <Alert type="warning" showIcon title="有一项日历操作结果尚未确认" description={`原用途：${state.pending.command.action} · ${state.pending.command.startLocal ?? state.pending.command.date ?? state.pending.command.blockId}。原参数与请求编号已锁定；未确认前不能发送另一条命令。`} />}
    {(state.error || readError) && <Alert type="error" showIcon title={state.error || readError} />}
    {!allowed && <Alert type="info" showIcon title="当前账号没有营业配置权限，只展示日历摘要。" description="内部原因、操作者和配置详情未读取。" />}
    {state.pending && <Space wrap><Button disabled={disabled || state.busy || !allowed} loading={state.busy} onClick={() => void model.reconcile()}>查询确定结果</Button>{state.pending.notExecuted && <><Button disabled={disabled || state.busy || !allowed} onClick={() => void model.retry()}>按原参数重新提交</Button><Button disabled={disabled || state.busy || !allowed} onClick={() => { if (model.discard()) { setNotice('已明确放弃未执行的原请求；草稿仍保留，请重读当前版本后保存。'); void loadContext(true); } }}>放弃未执行请求</Button></>}</Space>}
    {!state.pending && !state.corrupt && dateValue && <>
      {date && <div className="booking-calendar-date-actions"><label>选择起始时刻（可选）<Input aria-label="日期操作起始时刻" type="time" value={selectedTime} disabled={disabled || !!draft} onChange={event => setSelectedTime(event.target.value)} /></label>
        {onAssisted && currentShopAllows(shopId, 'BOOKINGS_MANAGE') && <div className="booking-calendar-new-booking"><div><strong>为顾客安排服务</strong><p>代客填写联系人、服务和可约时间，创建正式预约订单。</p></div><Button disabled={disabled || !!draft} type="primary" size="large" onClick={() => { if (current() && currentShopAllows(shopId, 'BOOKINGS_MANAGE')) onAssisted({ date: dateValue, ...(selectedTime ? { startTime: selectedTime } : {}) }); }}>新增预约</Button></div>}
        {allowed && <details className="booking-calendar-availability"><summary>可预约范围设置<span>临时闭店、时段停约与内部占用</span></summary><div className="booking-calendar-availability-body"><p className="booking-calendar-note">仅调整门店或指定资源的可预约时间。内部占用用于会议、自用等安排，不会创建顾客订单或收款。</p><Space wrap><Button disabled={disabled || loading || !options || !!draft} onClick={() => startDraft('TIME_BLOCK')}>屏蔽这个时段</Button><Button disabled={disabled || loading || !options || !!draft} onClick={() => startDraft('INTERNAL_OCCUPANCY')}>登记内部占用</Button><Button disabled={disabled || loading || !options || !!draft || options.closed} onClick={() => void closeDay()}>{options?.closed ? '当天已闭店' : '关闭当天'}</Button></Space></div></details>}
        <p className="booking-calendar-note">日历空白不代表可预约。新增预约会重新核对可约时间与报价；范围设置会在保存时核对资源冲突。</p>
      </div>}
      {loading && <div role="status"><Spin size="small" /> 正在核对当前营业配置…</div>}
      {allowed && options?.temporaryClosure && <div className="booking-calendar-date-actions"><p className="booking-calendar-note">临时闭店来源：{options.temporaryClosure.startDate} — {options.temporaryClosure.endDate}。只恢复所选日期；营业时间、提前量、技师请假和其他时段停约仍分别生效。</p><Button disabled={disabled || loading || !!draft} onClick={() => void reopenDay()}>恢复当天营业</Button></div>}
      {allowed && !loading && options && !options.temporaryClosure && event?.eventType === 'SHOP_CLOSURE' && <Alert type="info" showIcon title="当前日期没有可解除的临时闭店" description="请核对最新日历及营业设置；其他规则需要在对应入口调整，不会在这里覆盖。" />}
      {event && !event.blockId && allowed && <Button disabled={disabled} onClick={() => { if (canConfig()) { const query = new URLSearchParams({ shopId, tab: event.eventType === 'ROOM_MAINTENANCE' ? 'rooms' : event.eventType === 'THERAPIST_TIME_OFF' ? 'therapists' : 'hours' }); const therapist = event.resources.find(resource => resource.type === 'THERAPIST'); if (therapist) query.set('therapistId', therapist.id); navigate('/reservations?' + query); } }}>前往现有营业设置处理{event.eventType === 'THERAPIST_TIME_OFF' ? '技师请假' : event.eventType === 'ROOM_MAINTENANCE' ? '场地维护' : '闭店'}</Button>}
      {allowed && (readError || state.error) && <Button disabled={disabled || loading} onClick={() => void loadContext(true)}>重读当前版本并保留草稿</Button>}
      {allowed && block && <div className="booking-calendar-block-meta"><span>版本 {block.version} · {block.status === 'ACTIVE' ? '生效中' : '已解除'}</span><span>操作者：{block.operator.name}</span><span>当前原因：{block.reason}</span></div>}
      {allowed && draft && <div className="booking-calendar-action-form">
        <Alert type="info" showIcon title={draft.purpose === 'INTERNAL_OCCUPANCY' ? '内部占用 · 门店自用区间' : '时段停约 · 停止接收新预约'} description="该对象没有顾客、订单、价格或收款；不会发送顾客预约成功邮件。已有预约不会被自动取消。" />
        <label>用途<Select aria-label="区间用途" value={draft.purpose} disabled={disabled || block?.status === 'RELEASED'} options={[{ value: 'INTERNAL_OCCUPANCY', label: '内部占用' }, { value: 'TIME_BLOCK', label: '时段停约' }]} onChange={value => setField('purpose', value)} /></label>
        <label>作用范围<Select aria-label="区间作用范围" value={draft.scope} disabled={disabled || !!block} options={[{ value: 'SHOP', label: '全店' }, { value: 'THERAPIST', label: '指定技师' }, { value: 'ROOM', label: '指定场地' }]} onChange={value => setField('scope', value)} /></label>
        {draft.scope !== 'SHOP' && <label>本店资源<Select aria-label="区间资源" value={draft.resourceId || undefined} disabled={disabled || !!block} placeholder="选择对应资源" options={(options?.resources ?? []).filter(resource => resource.type === draft.scope).map(resource => ({ value: resource.id, label: resource.name }))} onChange={value => setField('resourceId', value)} /></label>}
        <div className="booking-calendar-local-times"><label>开始时间（门店当地）<Input aria-label="区间开始时间" type="datetime-local" value={draft.startLocal} disabled={disabled || block?.status === 'RELEASED'} onChange={event => setField('startLocal', event.target.value)} /></label><label>结束时间（门店当地，可跨日）<Input aria-label="区间结束时间" type="datetime-local" value={draft.endLocal} disabled={disabled || block?.status === 'RELEASED'} onChange={event => setField('endLocal', event.target.value)} /></label></div>
        <label>内部原因<Input.TextArea aria-label="区间原因" value={draft.reason} maxLength={500} rows={3} disabled={disabled || block?.status === 'RELEASED'} onChange={event => setField('reason', event.target.value)} /></label>
        <section className="booking-calendar-action-preview" aria-label="保存前影响预览"><h4>保存前确认</h4><dl><div><dt>设置用途</dt><dd>{draft.purpose === 'INTERNAL_OCCUPANCY' ? '内部占用 · 门店自用安排' : '时段停约 · 暂停接收新预约'}</dd></div><div><dt>作用范围</dt><dd>{scopeLabel(draft.scope, draft.resourceId)}</dd></div><div><dt>日期与时段</dt><dd>{localRangeLabel(draft.startLocal, draft.endLocal)}</dd></div><div><dt>区间类型</dt><dd>{draft.startLocal.endsWith('T00:00') && draft.endLocal.endsWith('T00:00') ? '全天区间 · 结束日期不包含在内' : '指定时段 · 可跨日，结束时刻不占用'}</dd></div><div><dt>门店时区</dt><dd>{timezone}</dd></div><div><dt>已有预约</dt><dd>保持原订单，不会自动取消或改期。资源冲突由服务端在保存时实时校验。</dd></div></dl><p className="booking-calendar-note">夏令时跳过或重复的时间需要改选明确时刻；此预览不代表已通过冲突校验。</p></section>
        <Space wrap><Button type="primary" disabled={disabled || loading || !options || block?.status === 'RELEASED' || !draft.reason.trim()} onClick={() => void save()}>{block ? '保存区间修改' : '保存日历区间'}</Button>{block?.status === 'ACTIVE' && <Button danger disabled={disabled} onClick={() => void release()}>解除区间</Button>}<Button disabled={disabled} onClick={() => void close()}>放弃修改并关闭</Button></Space>
      </div>}
    </>}
  </section>;
}
