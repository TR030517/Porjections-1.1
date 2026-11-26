import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Input, Modal, Select, Space } from 'antd';
import { checkedGuestInput, getBookingTherapists, getGuestBookingSlots, quoteGuestBooking, type BookingTherapist, type GuestBookingInput, type GuestBookingQuote, type GuestBookingReceipt } from '../../api/bookings';
import { getAssistedBookingServices, type AssistedBookingService, type AssistedBookingSlots } from '../../api/merchant';
import { currentShopAllows, isCurrentShop, useShopId } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import { useMerchantDraftProtection } from '../../components/MerchantDraftGuard';
import { money } from '../../utils/feedback';
import { createGuestBookingModel } from './guestBookingModel';
import type { CalendarAssistedSelection } from './CalendarActionsPanel';
import { validDate } from './calendarModel';
import './guestBooking.css';

export interface GuestAssistedProps {
  shopId: string; shopName?: string; initialSelection?: CalendarAssistedSelection; initialTimezone?: string;
  onClose: () => void; onExisting: () => void; onCreated: (receipt: GuestBookingReceipt, showDetails?: boolean) => void;
}
type SlotSearch =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; result: AssistedBookingSlots }
  | { status: 'error'; message: string };

/** Deliberately excludes contacts, account identifiers, request keys and access links. */
export function guestBookingVoucher(receipt: GuestBookingReceipt, shopName: string) {
  return `Reservation request\nReference: ${receipt.result.bookingNo}\nShop: ${shopName.replace(/[\r\n\u0000-\u001f]/g, ' ')}\nCreated pending shop confirmation.\nPay at store. No online payment collected.\nContact the shop to confirm the current details.\nThis reference does not grant access to an account or booking.`;
}
export default function GuestAssistedBookingModal({ shopId, shopName = '当前门店', initialSelection, initialTimezone, onClose, onExisting, onCreated }: GuestAssistedProps) {
  const actorId = useAuthStore(state => String(state.merchant?.id ?? ''));
  const { can, refreshing, loading } = useShopId(), canManage = can('BOOKINGS_MANAGE');
  const alive = useRef(false), busyRef = useRef(false), liveRevision = useRef(0);
  const current = () => alive.current && String(useAuthStore.getState().merchant?.id ?? '') === actorId && isCurrentShop(shopId);
  const allowed = () => current() && currentShopAllows(shopId, 'BOOKINGS_MANAGE');
  const model = useMemo(() => createGuestBookingModel(actorId, shopId, allowed), [actorId, shopId]);
  const recovery = useSyncExternalStore(model.subscribe, model.getSnapshot), original = useRef(recovery.pending?.command).current;
  const [name, setName] = useState(original?.contact.name ?? ''), [phone, setPhone] = useState(original?.contact.phone ?? ''), [email, setEmail] = useState(original?.contact.email ?? '');
  const [source, setSource] = useState<'PHONE' | 'WALK_IN'>(original?.guestSource ?? 'PHONE');
  const [serviceId, setServiceId] = useState(original?.serviceId ?? ''), [variantId, setVariantId] = useState(original?.variantId ?? '');
  const [date, setDate] = useState(original?.date ?? (initialSelection && validDate(initialSelection.date) ? initialSelection.date : ''));
  const [startTime, setStartTime] = useState(original?.startTime ?? ''), [notes, setNotes] = useState(original?.notes ?? '');
  const [preferredIds, setPreferredIds] = useState<string[]>(original?.preferredTherapistIds ?? []);
  const [services, setServices] = useState<(AssistedBookingService & { requiredStaffCount?: number; participantCount?: number })[]>([]), [therapists, setTherapists] = useState<BookingTherapist[]>([]);
  const [slotSearch, setSlotSearch] = useState<SlotSearch>({ status: 'idle' });
  const [slotSearchAttempt, setSlotSearchAttempt] = useState(0);
  const [loadingTherapists, setLoadingTherapists] = useState(false);
  const [quote, setQuote] = useState<GuestBookingQuote | null>(null), [quoteBusy, setQuoteBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const preferredTime = useRef(original?.startTime ?? initialSelection?.startTime), preferredDate = useRef(original?.date ?? initialSelection?.date), quoteRef = useRef<{ value: GuestBookingQuote; fingerprint: string } | null>(null);
  const input = (): GuestBookingInput => ({ contact: { name, phone, email: email || null }, guestSource: source, serviceId, ...(variantId ? { variantId } : {}), date, startTime, preferredTherapistIds: preferredIds, ...(notes.trim() ? { notes: notes.trim() } : {}) });
  const liveInput = useRef(input()); liveInput.current = input();
  const locked = recovery.busy || recovery.pending !== null || recovery.corrupt || quoteBusy;
  const lockedRef = useRef(locked); lockedRef.current = locked;
  const dirty = !recovery.receipt && Boolean(name || phone || email || serviceId || notes || preferredIds.length || startTime);
  useMerchantDraftProtection(shopId, dirty, locked, () => busyRef.current || Boolean(model.getSnapshot().pending) || model.getSnapshot().corrupt);
  useEffect(() => { alive.current = true; model.activate(); return () => { alive.current = false; liveRevision.current++; model.dispose(); }; }, [model]);
  const invalidate = () => { quoteRef.current = null; setQuote(null); setError(''); };
  const edit = (action: () => void) => { if (!allowed() || lockedRef.current || busyRef.current) return; action(); invalidate(); };
  useEffect(() => {
    if (!allowed() || recovery.pending || recovery.corrupt) return;
    const controller = new AbortController();
    void getAssistedBookingServices(shopId, controller.signal).then(result => { if (!controller.signal.aborted && allowed()) setServices(result); })
      .catch(reason => { if (!controller.signal.aborted && current()) setError(reason instanceof Error ? reason.message : '无法加载服务。'); });
    return () => controller.abort();
  }, [actorId, shopId, canManage, refreshing, loading, !!recovery.pending, recovery.corrupt]);
  const service = services.find(row => row.id === serviceId), variants = service?.variants.filter(row => row.isActive) ?? [];
  const requiredStaff = service?.requiredStaffCount ?? service?.participantCount ?? 1;
  const missingSlotInput = !service ? '先选择预约服务'
    : service.hasVariants && !variantId ? '先选择服务规格'
    : !validDate(date) ? '先选择预约日期' : '';
  const slots = slotSearch.status === 'ready' ? slotSearch.result : null;
  const availableTimes = (slots?.slots ?? []).filter(slot => slot.available).map(slot => ({ value: slot.time, label: slot.time }));
  const timePlaceholder = missingSlotInput || {
    idle: '时段尚未查询',
    loading: '正在查询可预约时段…',
    error: '时段查询失败',
    ready: availableTimes.length ? '选择可预约时段' : '所选条件下无可预约时段',
  }[slotSearch.status];
  useEffect(() => {
    if (recovery.pending || recovery.corrupt || !allowed()) return;
    setTherapists([]);
    if (!serviceId) return;
    const controller = new AbortController(); setLoadingTherapists(true);
    void getBookingTherapists(shopId, controller.signal).then(result => { if (!controller.signal.aborted && allowed()) setTherapists(result); })
      .catch(reason => { if (!controller.signal.aborted && current()) setError(reason instanceof Error ? reason.message : '无法加载可选技师。'); })
      .finally(() => { if (!controller.signal.aborted && current()) setLoadingTherapists(false); });
    return () => controller.abort();
  }, [actorId, shopId, serviceId, canManage, refreshing, loading, !!recovery.pending, recovery.corrupt]);
  useEffect(() => {
    if (recovery.pending || recovery.corrupt) return;
    if (!allowed() || missingSlotInput) {
      setSlotSearch({ status: 'idle' });
      setStartTime('');
      return;
    }
    setStartTime(''); invalidate();
    const controller = new AbortController();
    setSlotSearch({ status: 'loading' });
    void getGuestBookingSlots(shopId, { serviceId, variantId: variantId || undefined, date, preferredTherapistIds: preferredIds }, controller.signal).then(result => {
      if (controller.signal.aborted || !allowed()) return;
      setSlotSearch({ status: 'ready', result });
      const preferred = preferredTime.current;
      if (preferred && date === preferredDate.current) {
        preferredTime.current = undefined;
        if ((!initialTimezone || initialTimezone === result.timezone) && result.slots.some(slot => slot.available && slot.time === preferred)) { setStartTime(preferred); setNotice('已核对最新可用时段并带入日历时间；仍需核价后提交。'); }
        else setNotice('日历所选时间不可用或门店时区已改变，请重新选择可用时段。');
      }
    }).catch(reason => {
      if (!controller.signal.aborted && allowed()) {
        setSlotSearch({ status: 'error', message: reason instanceof Error ? reason.message : '请稍后重试。' });
      }
    });
    return () => controller.abort();
  }, [actorId, shopId, serviceId, variantId, date, preferredIds.join(','), missingSlotInput, slotSearchAttempt, canManage, refreshing, loading, !!recovery.pending, recovery.corrupt]);
  const makeQuote = async () => {
    if (!allowed() || busyRef.current || lockedRef.current) return;
    let checked: GuestBookingInput;
    try { checked = checkedGuestInput(liveInput.current); if (!slots?.slots.some(slot => slot.available && slot.time === checked.startTime)) throw new Error('请从最新可用时段中选择预约时间。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '请核对联系人和预约信息。'); return; }
    const fingerprint = JSON.stringify(checked), revision = ++liveRevision.current;
    busyRef.current = true; setQuoteBusy(true); invalidate();
    try {
      const result = await quoteGuestBooking(shopId, checked);
      if (!allowed() || revision !== liveRevision.current) return;
      if (fingerprint !== JSON.stringify(checkedGuestInput(liveInput.current))) throw new Error('核价期间预约内容已改变，请重新核价。');
      if (slots && slots.timezone !== result.timezone) throw new Error('门店时区已变化，请重新选择日期和时段。');
      quoteRef.current = { value: result, fingerprint }; setQuote(result);
    } catch (reason) { if (current() && revision === liveRevision.current) setError(reason instanceof Error ? reason.message : '核价失败。'); }
    finally { if (current() && revision === liveRevision.current) { busyRef.current = false; setQuoteBusy(false); } }
  };
  const submit = async () => {
    if (!allowed() || busyRef.current || lockedRef.current || !quoteRef.current) return;
    const verified = quoteRef.current;
    try {
      const checked = checkedGuestInput(liveInput.current);
      if (JSON.stringify(checked) !== verified.fingerprint) { invalidate(); throw new Error('预约资料已改变，请重新核价。'); }
      if (Date.parse(verified.value.quoteExpiresAt) <= Date.now()) { invalidate(); throw new Error('报价已过期，请重新核价。'); }
      busyRef.current = true;
      try { await model.execute({ ...checked, requestKey: crypto.randomUUID(), quoteHash: verified.value.quoteHash, quoteExpiresAt: verified.value.quoteExpiresAt }); }
      finally { if (current()) busyRef.current = false; }
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : '创建结果未确认。'); }
  };
  const leave = async (existing = false) => {
    if (!current() || lockedRef.current || busyRef.current || model.getSnapshot().pending || model.getSnapshot().corrupt) return;
    if (dirty && !await modal.confirm({ title: '放弃首次客预约草稿？', content: '尚未创建预约，当前联系人和所选服务将被放弃。', okText: '放弃草稿', cancelText: '继续填写' })) return;
    if (current() && !lockedRef.current && !model.getSnapshot().pending) { if (existing) onExisting(); else onClose(); }
  };
  const finish = (details: boolean) => {
    if (!allowed() || busyRef.current) return;
    const receipt = model.getSnapshot().receipt;
    if (!receipt || !model.acknowledge()) return;
    onCreated(receipt, details);
  };
  const chosenNames = (ids: string[]) => ids.map(id => therapists.find(row => row.id === id)?.name ?? `技师 #${id}`).join('、');
  const pending = recovery.pending?.command;
  return <Modal open title="首次电话／到店客预约" width={760} footer={null} destroyOnHidden closable={!locked} maskClosable={false} keyboard={false} onCancel={() => void leave()}>
    {modalContext}
    <div className="guest-booking-form">
      {!recovery.receipt && <Space wrap><Button disabled={locked} onClick={() => void leave(true)}>选择本店受权老客</Button><Button type="primary" disabled>首次电话／到店客</Button></Space>}
      <Alert showIcon type="info" title="只记录本次联系人，不注册或关联账号。" description="默认创建待接单预约申请、到店付款，不在线扣款。姓名、电话或邮箱不会用于查询已有账号；填邮箱也不代表已授权收信。" />
      {(error || recovery.error) && <Alert showIcon type="error" title={error || recovery.error} />}
      {recovery.receipt ? <section aria-label="首次客预约创建回执" className="guest-booking-result">
        <Alert showIcon type="success" title={`预约申请已创建：${recovery.receipt.result.bookingNo}`} description="创建时为待接单、到店付款，尚未确认接单，也未收款。请打开详情核对最新状态并单独确认接单。" />
        <p>未关联顾客账号；不能承诺出现在顾客的“我的预约”。未授权的顾客邮件不会发送，商家通知按门店设置处理。</p>
        <Space wrap><Button type="primary" onClick={() => finish(true)}>查看详情／确认接单</Button><Button onClick={async () => { const receipt = model.getSnapshot().receipt; if (!allowed() || !receipt) return; try { await navigator.clipboard.writeText(guestBookingVoucher(receipt, shopName)); if (current()) setNotice('已复制精简预约凭证，不含电话、邮箱或账号访问链接。'); } catch { if (current()) setError('未能复制，请手动记录预约编号。'); } }}>复制预约凭证</Button><Button onClick={() => finish(false)}>完成并返回日历</Button></Space>
      </section> : pending ? <section aria-label="首次客预约原请求恢复" className="guest-booking-result">
        <Alert showIcon type="warning" title={recovery.pending?.notExecuted ? '原请求已确认未执行' : '原请求结果未确认，不能重新创建'} description="原联系人、服务、技师选择和请求编号已保存。关闭或刷新后仍恢复原请求；只有服务端锁定核对后才能恢复草稿重新核价。" />
        <div className="guest-booking-summary"><div>原请求：{pending.date} {pending.startTime}（创建时门店当地时间）</div><div>联系人：{pending.contact.name} · {pending.contact.phone}</div><div>来源：{pending.guestSource === 'PHONE' ? '电话客' : '到店客'} · 未关联账号</div><div>邮箱：{pending.contact.email ? '已记录，未授权，不发送顾客邮件' : '未填写邮箱，不发送顾客邮件'}</div></div>
        <Space wrap><Button disabled={recovery.busy || recovery.pending?.notExecuted} loading={recovery.busy} onClick={() => void model.query()}>查询原请求结果</Button><Button disabled={recovery.busy || recovery.pending?.notExecuted} loading={recovery.busy} onClick={() => void model.reconcile()}>锁定核对原请求</Button>{recovery.pending?.notExecuted && <Button type="primary" onClick={() => { if (allowed()) { preferredTime.current = pending.startTime; preferredDate.current = pending.date; if (model.resumeDraft()) { invalidate(); setNotice('已恢复原联系人和预约草稿；原请求编号已封存，请重新核价。'); } } }}>恢复原草稿并重新核价</Button>}</Space>
      </section> : !recovery.corrupt ? <>
        <div className="guest-booking-fields">
          <label>来访来源<Select aria-label="首次客来源" disabled={locked} value={source} options={[{ value: 'PHONE', label: '电话客' }, { value: 'WALK_IN', label: '到店客' }]} onChange={value => edit(() => setSource(value))} /></label>
          <label>客人姓名（必填）<Input aria-label="首次客姓名" disabled={locked} maxLength={200} value={name} onChange={event => edit(() => setName(event.target.value))} /></label>
          <label>国际电话（必填）<Input aria-label="首次客国际电话" disabled={locked} type="tel" maxLength={40} placeholder="+1 202 555 0100" value={phone} onChange={event => edit(() => setPhone(event.target.value))} /></label>
          <label>邮箱（可空）<Input aria-label="首次客邮箱" disabled={locked} type="email" maxLength={255} value={email} onChange={event => edit(() => setEmail(event.target.value))} /></label>
        </div>
        <Alert showIcon type="info" title={email.trim() ? '邮箱仅作本次记录，尚未授权，不发送顾客邮件。' : '未填写邮箱，不发送顾客邮件。'} />
        <label>预约服务<Select aria-label="首次客预约服务" disabled={locked} value={serviceId || undefined} placeholder="选择本店真实可预约服务" options={services.map(row => ({ value: row.id, label: row.name }))} onChange={value => edit(() => { setServiceId(value); setVariantId(''); setPreferredIds([]); })} /></label>
        {service?.hasVariants && <label>服务规格<Select aria-label="首次客服务规格" disabled={locked} value={variantId || undefined} placeholder="选择服务规格" options={variants.map(row => ({ value: row.id, label: `${row.name} · ${row.durationMin}分钟 · ${money(row.priceCents, 'usd')}` }))} onChange={value => edit(() => setVariantId(value))} /></label>}
        <label>技师（可指定或无偏好）<Select mode="multiple" maxCount={Math.min(2, requiredStaff)} aria-label="首次客指定技师" disabled={locked || !serviceId || loadingTherapists} loading={loadingTherapists} value={preferredIds} placeholder="无偏好，由系统分配" options={therapists.map(row => ({ value: row.id, label: row.name }))} onChange={value => edit(() => setPreferredIds(value))} /></label>
        <p className="guest-booking-hint">留空表示无偏好。{service ? `当前服务需${requiredStaff}位技师。` : ''}指定技师会同时用于查空档、核价和创建，服务器核对实际需求。</p>
        <div className="guest-booking-fields"><label>日期（门店当地）<Input aria-label="首次客预约日期" type="date" disabled={locked} value={date} onChange={event => edit(() => setDate(event.target.value))} /></label>
          <label>可用时间
            <Select
              aria-label="首次客可用时间"
              disabled={locked || !availableTimes.length || !!missingSlotInput}
              loading={slotSearch.status === 'loading' && !missingSlotInput}
              value={startTime || undefined}
              placeholder={timePlaceholder}
              options={availableTimes}
              onChange={value => edit(() => setStartTime(value))}
            />
          </label>
        </div>
        {!missingSlotInput && slotSearch.status === 'error' && <Alert
          showIcon type="error" title="无法查询可预约时段" description={slotSearch.message}
          action={<Button
            disabled={locked || !canManage || refreshing || loading}
            onClick={() => edit(() => setSlotSearchAttempt(attempt => attempt + 1))}
          >重试查询时段</Button>}
        />}
        <p className="guest-booking-hint">门店当地时间 · {slots?.timezone ?? initialTimezone ?? '待服务器读取门店时区'}{slots ? ` · 预约占用 ${slots.durationMin} 分钟` : ''}</p>
        <label>预约备注<Input.TextArea aria-label="首次客预约备注" disabled={locked} rows={2} maxLength={500} value={notes} onChange={event => edit(() => setNotes(event.target.value))} /></label>
        {quote && <Alert showIcon type="success" title={`服务器核价：${money(quote.totalCents, quote.currency)} · 到店付款`} description={`${quote.localDate} ${quote.localStartTime} · ${quote.timezone} · ${quote.durationMin}分钟。${quote.requestedTherapistIds.length ? `已指定：${chosenNames(quote.requestedTherapistIds)}。` : `无技师偏好；本次核价分配：${chosenNames(quote.assignedTherapistIds)}。`}资源变化会要求重新核价；创建后仍需单独确认接单，不会收款。`} />}
        <Space wrap><Button disabled={locked} onClick={() => void leave()}>取消</Button><Button loading={quoteBusy} disabled={locked || !serviceId || !startTime || !name.trim() || !phone.trim()} onClick={() => void makeQuote()}>{quote ? '重新核价' : '核对首次客预约'}</Button>{quote && <Button type="primary" loading={recovery.busy} disabled={locked} onClick={() => void submit()}>创建预约申请</Button>}</Space>
      </> : null}
      {notice && <Alert showIcon type="info" title={notice} />}
    </div>
  </Modal>;
}
